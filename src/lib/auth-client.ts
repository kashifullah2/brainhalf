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

const TOKEN_KEY = 'bh_session_token';
const USER_KEY = 'bh_session_user';

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
  try {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  } catch {
    /* storage unavailable — session is effectively per-tab */
  }
}

function clear(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  } catch {
    /* ignore */
  }
}

export async function signup(email: string, password: string): Promise<SessionUser> {
  const res = await fetch(`${apiBase()}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json().catch(() => ({ error: 'Signup failed' }));
  if (!res.ok || !body?.token) throw new Error(body?.error || 'Signup failed');
  persist(body.token, body.user);
  return body.user as SessionUser;
}

export async function login(email: string, password: string): Promise<SessionUser> {
  const res = await fetch(`${apiBase()}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json().catch(() => ({ error: 'Login failed' }));
  if (!res.ok || !body?.token) throw new Error(body?.error || 'Login failed');
  persist(body.token, body.user);
  return body.user as SessionUser;
}

export async function logout(): Promise<void> {
  const token = getToken();
  try {
    await fetch(`${apiBase()}/api/auth/logout`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      credentials: 'include',
    });
  } catch {
    /* still clear locally */
  }
  clear();
}

/**
 * Ask the server whether the stored session is still valid. The server checks
 * signature, expiry and revocation — this is the one authoritative answer.
 */
export async function verifyStoredSession(): Promise<SessionUser | null> {
  const token = getToken();
  if (!token) return null;
  try {
    const res = await fetch(`${apiBase()}/api/auth/session`, {
      headers: { Authorization: `Bearer ${token}` },
      credentials: 'include',
    });
    if (!res.ok) {
      clear();
      return null;
    }
    return getUser();
  } catch {
    return null;
  }
}

/**
 * `fetch` that always carries the session token and reacts to auth failure by
 * clearing the stale session and signalling the app to show the login screen.
 */
export async function authFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const token = getToken();
  const headers = new Headers(init.headers || {});
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const res = await fetch(input, { ...init, headers, credentials: 'include' });
  if (res.status === 401 || res.status === 403) {
    clear();
    try {
      window.dispatchEvent(new CustomEvent('bh-session-expired'));
    } catch {
      /* not a browser context */
    }
  }
  return res;
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
 * If the ticket endpoint is unreachable (e.g. the Registry DO hasn't migrated
 * yet), the session token is used as a fallback so the connection can still be
 * established. The server's `onBeforeConnect` already accepts both `?ticket=`
 * and `?token=` — see worker.ts line ~400.
 *
 * Returns the URL unmodified only when *no* credential is available at all.
 */
export async function withWsAuthQuery(wsUrl: string): Promise<string> {
  const separator = wsUrl.includes('?') ? '&' : '?';
  // Prefer a single-use ticket (short-lived, one-time, never in logs)
  const ticket = await getWsTicket();
  if (ticket) {
    return `${wsUrl}${separator}ticket=${encodeURIComponent(ticket)}`;
  }
  // Fallback: use the session token so the connection doesn't fail entirely.
  // The server's verifySession path still accepts this via cookie/query.
  const token = getToken();
  if (token) {
    return `${wsUrl}${separator}token=${encodeURIComponent(token)}`;
  }
  return wsUrl;
}

async function getWsTicket(): Promise<string | null> {
  try {
    const res = await authFetch(`${apiBase()}/api/auth/ws-ticket`, { method: 'POST' });
    if (!res.ok) return null;
    const body = await res.json().catch(() => null);
    const ticket = (body as { ticket?: string } | null)?.ticket;
    return typeof ticket === 'string' && ticket.startsWith('bhwt_') ? ticket : null;
  } catch {
    return null;
  }
}

