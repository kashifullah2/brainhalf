/**
 * Browser-side session helper.
 *
 * The token is stored in localStorage so it can be attached to WebSocket
 * upgrade URLs (browsers cannot set headers on `new WebSocket`). The server
 * *also* sets an httpOnly Secure SameSite=Lax cookie for iframe/navigational
 * flows (the live preview), which JS cannot read — that split is deliberate.
 * Never put the raw token in a navigational URL: it would be readable by any
 * script at that URL, including model-generated preview code.
 */

import { deleteProjectDurably, getProjects, getProjectStorageScope, isEmptyDraftProject, reconcileOwnedProjects, setProjectAccount, updateProjectPublication, type Project } from './project-store';

const TOKEN_KEY = 'bh_session_token';
const USER_KEY = 'bh_session_user';
const GOOGLE_PROMPT_KEY = 'bh_google_pending_prompt';
let sessionRevision = 0;

/**
 * Auth failure that preserves the server's machine-readable error code
 * (e.g. 'EMAIL_VERIFICATION_REQUIRED') so UI can branch on it instead of
 * matching message text.
 */
export class AuthError extends Error {
  readonly code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
  }
}

function authErrorCode(body: unknown): string | undefined {
  return body && typeof body === 'object' && 'code' in body && typeof body.code === 'string' ? body.code : undefined;
}

export function saveGooglePrompt(prompt: { prompt: string } | null): void {
  try {
    if (prompt) sessionStorage.setItem(GOOGLE_PROMPT_KEY, JSON.stringify({ ...prompt, savedAt: Date.now() }));
    else sessionStorage.removeItem(GOOGLE_PROMPT_KEY);
  } catch {}
}

export function takeGooglePrompt(): { prompt: string } | null {
  try {
    const raw = sessionStorage.getItem(GOOGLE_PROMPT_KEY);
    sessionStorage.removeItem(GOOGLE_PROMPT_KEY);
    const value = raw && JSON.parse(raw);
    return value && typeof value.prompt === 'string' && Date.now() - value.savedAt < 15 * 60_000
      ? { prompt: value.prompt } : null;
  } catch { return null; }
}

export async function startGoogleSignIn(): Promise<void> {
  const response = await fetch(`${apiBase()}/api/auth/google/start`, {
    method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project: new URLSearchParams(window.location.search).get('project') }),
    signal: AbortSignal.timeout(20_000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || typeof body?.url !== 'string') throw new Error(body?.error || 'Google sign-in could not start. Please try again.');
  const target = new URL(body.url);
  if (target.origin !== 'https://accounts.google.com') throw new Error('Google sign-in could not start. Please try again.');
  window.location.assign(target.toString());
}

const GOOGLE_ERRORS: Record<string, string> = {
  cancelled: 'Google sign-in was cancelled. Try again or continue with email.',
  expired: 'Google sign-in expired. Please try again.',
  unavailable: 'Google sign-in is not available yet. Please continue with email.',
  existing_account: 'This email already has a BrainHalf account. Sign in with your existing password.',
  unverified: 'Google could not verify your email address. Try another account or continue with email.',
};
let googleCompletion: Promise<SessionUser> | null = null;

/** Deduplicate the one-use exchange across React StrictMode's mount effects. */
export function completeGoogleSignIn(): Promise<SessionUser> | null {
  if (googleCompletion) return googleCompletion;
  const url = new URL(window.location.href);
  const result = url.searchParams.get('google');
  if (!result) return null;
  url.searchParams.delete('google');
  window.history.replaceState({}, '', url.toString());
  googleCompletion = (async () => {
    if (result !== 'complete') throw new Error(GOOGLE_ERRORS[result] || 'Google sign-in could not finish. Please try again.');
    const revision = ++sessionRevision;
    const previousToken = getToken();
    const response = await fetch(`${apiBase()}/api/auth/google/complete`, { method: 'POST', credentials: 'include', signal: AbortSignal.timeout(20_000) });
    const body = await response.json().catch(() => null);
    const user = sessionUser(body?.user);
    if (revision !== sessionRevision || previousToken !== getToken()) throw new Error('Session changed. Sign in again.');
    if (!response.ok || !user || typeof body?.token !== 'string') throw new Error(body?.error || 'Google sign-in could not finish. Please try again.');
    persist(body.token, user);
    await restoreOwnedProjects(body.token);
    if (revision !== sessionRevision || body.token !== getToken()) throw new Error('Session changed. Sign in again.');
    return user;
  })();
  return googleCompletion;
}

export function clearGoogleCompletion(): void { googleCompletion = null; }

export function detachSession(): void {
  sessionRevision += 1;
  setProjectAccount(null);
}

export interface SessionUser {
  id: string;
  email: string;
}

function apiBase(): string {
  if (typeof window === 'undefined') return '';
  const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  // Same-origin in production; configurable for local wrangler dev / E2E tests.
  if (isLocal) {
    return (import.meta.env.VITE_BACKEND_HOST as string | undefined) || window.location.origin;
  }
  return window.location.origin;
}

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function getUser(): SessionUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as SessionUser) : null;
  } catch {
    return null;
  }
}

function persist(token: string, user: SessionUser): void {
  setProjectAccount(user.id);
  try {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  } catch {
    /* storage unavailable — session is effectively per-tab */
  }
}

function clear(): void {
  detachSession();
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  } catch {
    /* ignore */
  }
  try { window.dispatchEvent(new Event('bh-session-expired')); } catch {}
}

function sessionUser(value: unknown): SessionUser | null {
  if (!value || typeof value !== 'object' || !('id' in value) || typeof value.id !== 'string' || !value.id) return null;
  return { id: value.id, email: 'email' in value && typeof value.email === 'string' ? value.email : '' };
}

async function restoreOwnedProjects(token: string): Promise<void> {
  const scope = getProjectStorageScope();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`${apiBase()}/api/projects`, { headers: { Authorization: `Bearer ${token}` }, credentials: 'include', signal: controller.signal });
    const body = await response.json();
    if (!response.ok || getToken() !== token || scope !== getProjectStorageScope() || !Array.isArray(body?.projects)) return;
    const projects = body.projects.filter((project: Project) => project && typeof project.id === 'string' && typeof project.name === 'string' && typeof project.createdAt === 'number' && typeof project.updatedAt === 'number');
    reconcileOwnedProjects(projects);
  } catch {} finally { clearTimeout(timeout); }
}

export async function signup(email: string, password: string): Promise<SessionUser | { verificationRequired: true; message: string }> {
  const revision = ++sessionRevision;
  const previousToken = getToken();
  const res = await fetch(`${apiBase()}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json().catch(() => ({ error: 'Signup failed' }));
  if (res.ok && body?.verificationRequired === true) return { verificationRequired: true, message: body.message || 'Check your email to verify your account, then sign in.' };
  const user = sessionUser(body?.user);
  if (revision !== sessionRevision || previousToken !== getToken()) throw new Error('Session changed. Sign in again.');
  if (!res.ok || typeof body?.token !== 'string' || !user) throw new Error(body?.error || 'Signup failed');
  persist(body.token, user);
  await restoreOwnedProjects(body.token);
  if (revision !== sessionRevision || body.token !== getToken()) throw new Error('Session changed. Sign in again.');
  return user;
}

export async function login(email: string, password: string): Promise<SessionUser> {
  const revision = ++sessionRevision;
  const previousToken = getToken();
  const res = await fetch(`${apiBase()}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json().catch(() => ({ error: 'Login failed' }));
  const user = sessionUser(body?.user);
  if (revision !== sessionRevision || previousToken !== getToken()) throw new Error('Session changed. Sign in again.');
  if (!res.ok || typeof body?.token !== 'string' || !user) throw new AuthError(body?.error || 'Login failed', authErrorCode(body));
  persist(body.token, user);
  await restoreOwnedProjects(body.token);
  if (revision !== sessionRevision || body.token !== getToken()) throw new Error('Session changed. Sign in again.');
  return user;
}

export async function logout(): Promise<void> {
  const token = getToken();
  clear();
  try {
    await fetch(`${apiBase()}/api/auth/logout`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      credentials: 'include',
    });
  } catch {
    /* still clear locally */
  }
}

/**
 * Ask the server whether the stored session is still valid. The server checks
 * signature, expiry and revocation — this is the one authoritative answer.
 */
export async function verifyStoredSession(): Promise<SessionUser | null> {
  const token = getToken();
  const revision = sessionRevision;
  if (!token) { setProjectAccount(null); return null; }
  try {
    const res = await fetch(`${apiBase()}/api/auth/session`, {
      headers: { Authorization: `Bearer ${token}` },
      credentials: 'include',
    });
    const body = await res.json().catch(() => null);
    if (revision !== sessionRevision || getToken() !== token) return null;
    const cached = getUser();
    const user = sessionUser(body?.user) || (typeof body?.userId === 'string' && body.userId ? { id: body.userId, email: cached?.id === body.userId && typeof cached?.email === 'string' ? cached.email : '' } : null);
    if (!res.ok || !user) {
      clear();
      return null;
    }
    persist(token, user);
    await restoreOwnedProjects(token);
    return revision === sessionRevision && getToken() === token ? user : null;
  } catch {
    if (revision === sessionRevision && getToken() === token) setProjectAccount(null);
    return null;
  }
}

/**
 * `fetch` that always carries the session token and reacts to auth failure by
 * clearing the stale session and signalling the app to show the login screen.
 */
export async function authFetch(input: string, init: RequestInit = {}, options: { clearOnUnauthorized?: boolean } = {}): Promise<Response> {
  const revision = sessionRevision;
  const token = getToken();
  const headers = new Headers(init.headers || {});
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const res = await fetch(input, { ...init, headers, credentials: 'include' });
  // Advisory polls (e.g. model availability) must not end the session: a 401
  // from a non-auth endpoint can be transient or a backend blip, and clearing
  // here would dump the user out of their workspace mid-session.
  if (res.status === 401 && options.clearOnUnauthorized !== false && revision === sessionRevision && token === getToken()) {
    clear();
  }
  return res;
}

export async function removeProject(projectId: string): Promise<Project[]> {
  const scope = getProjectStorageScope();
  const token = getToken();
  if (!scope.accountId || !token) throw new Error('Sign in before deleting a project.');
  const response = await authFetch(`${apiBase()}/api/projects/${encodeURIComponent(projectId)}`, { method: 'DELETE', signal: AbortSignal.timeout(20_000) });
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.ok !== true) throw new Error(body?.error || 'Deletion could not be confirmed. Your local files are retained; try again.');
  if (scope !== getProjectStorageScope() || token !== getToken()) throw new Error('Account changed during deletion. Sign back in to finish cleanup.');
  return deleteProjectDurably(projectId);
}

/**
 * Best-effort cleanup of abandoned blank projects. Local drafts that never
 * received a first message are deleted on the server too, so they stop
 * counting against the 50-project limit. Called before a new project is
 * created; failures are swallowed so creation is never blocked by cleanup.
 */
export async function purgeEmptyDrafts(): Promise<void> {
  if (!getProjectStorageScope().accountId || !getToken()) return;
  const drafts = getProjects().filter(isEmptyDraftProject);
  for (const draft of drafts) {
    try {
      await removeProject(draft.id);
    } catch {
      // Keep the local draft; the next creation attempt retries the purge.
    }
  }
}

export async function projectPublication(projectId: string, signal: AbortSignal, published?: boolean): Promise<boolean> {
  const token = getToken();
  const scope = getProjectStorageScope();
  const response = await fetch(`${apiBase()}/api/projects/${encodeURIComponent(projectId)}/publication`, {
    method: published === undefined ? 'GET' : 'PUT',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    credentials: 'include',
    signal,
    body: published === undefined ? undefined : JSON.stringify({ published }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || typeof body?.published !== 'boolean') throw new Error(body?.error || 'Could not confirm publication status. Try again.');
  if (scope !== getProjectStorageScope() || token !== getToken()) throw new Error('Account changed while checking publication.');
  updateProjectPublication(projectId, body.published);
  return body.published;
}

/**
 * Fetch a single-use ticket and append it to a WebSocket upgrade URL.
 *
 * Browsers cannot set headers on `new WebSocket`, so the upgrade URL is the one
 * place a credential has to ride in a query string. A ticket is used instead of
 * the session token: it is valid for one handshake, dies within a minute, and
 * is deleted on use, so a value captured from a URL, a log, or a sampled trace
 * is already worthless. The 30-day session token never enters a URL.
 *
 * If the ticket endpoint is unreachable, the URL is returned unmodified: the
 * same-origin session cookie rides with the upgrade automatically. There is no
 * `?token=` fallback — the long-lived token must never appear in a URL.
 */
export async function withWsAuthQuery(wsUrl: string): Promise<string> {
  const revision = sessionRevision;
  const originalToken = getToken();
  const separator = wsUrl.includes('?') ? '&' : '?';
  // Prefer a single-use ticket (short-lived, one-time, never in logs)
  const ticket = await getWsTicket();
  if (revision !== sessionRevision || originalToken !== getToken()) throw new Error('Session changed while connecting');
  if (ticket) {
    return `${wsUrl}${separator}ticket=${encodeURIComponent(ticket)}`;
  }
  return wsUrl;
}

async function getWsTicket(): Promise<string | null> {
  if (prefetchedTicket) {
    const ticket = prefetchedTicket;
    prefetchedTicket = null;
    return ticket;
  }
  return fetchWsTicket();
}

async function fetchWsTicket(): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const res = await authFetch(`${apiBase()}/api/auth/ws-ticket`, { method: 'POST', signal: controller.signal });
    if (!res.ok) return null;
    const body = await res.json().catch(() => null);
    const ticket = (body as { ticket?: string } | null)?.ticket;
    return typeof ticket === 'string' && ticket.startsWith('bhwt_') ? ticket : null;
  } catch {
    if (controller.signal.aborted) throw new Error('The workspace sign-in check timed out. Retry or sign in again.');
    return null;
  } finally { clearTimeout(timeout); }
}

let prefetchedTicket: Promise<string | null> | null = null;

export function prefetchWsTicket(): void {
  if (!getToken()) return;
  prefetchedTicket = fetchWsTicket();
  prefetchedTicket.catch(() => { prefetchedTicket = null; });
}
