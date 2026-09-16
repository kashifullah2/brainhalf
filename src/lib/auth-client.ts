/**
 * Browser-side session helper.
 *
 * The token is stored in localStorage so it can be attached to WebSocket
 * upgrade URLs (browsers cannot set headers on `new WebSocket`). The server
 * *also* sets an httpOnly Secure SameSite=Lax cookie for iframe/navigational
 * flows (the live preview), which JS cannot read — that split is deliberate.
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

/** Append the session token to a WebSocket URL (browsers cannot set headers). */
export function withTokenQuery(wsUrl: string): string {
  const token = getToken();
  if (!token) return wsUrl;
  const separator = wsUrl.includes('?') ? '&' : '?';
  return `${wsUrl}${separator}token=${encodeURIComponent(token)}`;
}
