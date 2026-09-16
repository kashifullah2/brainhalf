/**
 * Server-side authentication and authorization gate for the Worker edge.
 *
 * Trust model:
 *   1. The client presents a session token via cookie, `Authorization: Bearer`
 *      header, or (for WebSocket / iframe flows where headers are impossible)
 *      the `?token=` query parameter.
 *   2. `verifySession` checks the HMAC signature + expiry **statelessly**, then
 *      confirms against the Registry's `sessions` table so a logged-out or
 *      rotated token is actually dead (real revocation, not just expiry).
 *   3. `authorizeProject` checks project ownership in the Registry.
 *
 * Everything here **fails closed**: missing token, bad signature, expired,
 * unknown project, or an unreachable Registry all deny access rather than
 * degrading to an anonymous mode.
 */
import type { DurableObjectNamespace, DurableObjectStub } from '@cloudflare/workers-types';
import {
  TOKEN_PREFIX,
  TOKEN_TTL_SECONDS,
  base64urlDecodeString,
  issueToken,
  sha256Hex,
  verifyTokenSignature,
} from './crypto';

export const AUTH_COOKIE = 'bh_session';
/** Header the Worker injects after verifying identity. Treated as authoritative
 *  by the Durable Objects *because* the Worker strips any client-supplied copy. */
export const USER_ID_HEADER = 'x-auth-user-id';

export interface AuthenticatedUser {
  userId: string;
}

export interface RegistryEnv {
  REGISTRY: DurableObjectNamespace;
}

/** Origin allowlist — replaces the previous `Access-Control-Allow-Origin: *`. */
const ALLOWED_ORIGINS = new Set<string>([
  'https://brainhalf.com',
  'https://www.brainhalf.com',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:8788',
  'http://127.0.0.1:8788',
]);

export function isAllowedOrigin(origin: string | null | undefined): boolean {
  if (!origin) return false;
  return ALLOWED_ORIGINS.has(origin);
}

/**
 * Session secret. Prefer the configured Wrangler secret; otherwise fall back to
 * a per-isolate random key. We deliberately never ship a hardcoded fallback —
 * an unknown deployment stays *unforgeable* at the cost of losing sessions when
 * the isolate restarts. Local dev sets SESSION_SECRET via `.dev.vars`.
 */
let ephemeralSecret: string | null = null;
export function getSessionSecret(env: any): string {
  if (env?.SESSION_SECRET && typeof env.SESSION_SECRET === 'string' && env.SESSION_SECRET.length >= 32) {
    return env.SESSION_SECRET;
  }
  if (!ephemeralSecret) {
    const bytes = new Uint8Array(48);
    crypto.getRandomValues(bytes);
    ephemeralSecret = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    console.warn(
      'SESSION_SECRET is not configured — using an ephemeral random key. ' +
        'Sessions will not survive an isolate restart. Run: npx wrangler secret put SESSION_SECRET'
    );
  }
  return ephemeralSecret;
}

/** Extract a bearer token from any of the supported transport locations. */
export function extractToken(request: Request): string | null {
  // 1. Authorization: Bearer <token>
  const authHeader = request.headers.get('authorization') || request.headers.get('Authorization');
  if (authHeader) {
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (match) return match[1].trim();
  }

  // 2. Cookie (covers same-origin iframe navigations, e.g. the live preview)
  const cookieHeader = request.headers.get('cookie') || '';
  const cookieMatch = cookieHeader.match(new RegExp(`(?:^|;\\s*)${AUTH_COOKIE}=([^;]+)`));
  if (cookieMatch) return cookieMatch[1].trim();

  // 3. Query parameter (WebSockets cannot set request headers in browsers)
  try {
    const token = new URL(request.url).searchParams.get('token');
    if (token) return token.trim();
  } catch {
    /* not a URL */
  }

  return null;
}

export function unauthorized(message: string = 'Authentication required'): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 401,
    headers: {
      'Content-Type': 'application/json',
      'WWW-Authenticate': `Bearer realm="brainhalf"`,
      Vary: 'Origin',
    },
  });
}

export function forbidden(message: string = 'Forbidden'): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 403,
    headers: { 'Content-Type': 'application/json', Vary: 'Origin' },
  });
}

/**
 * Verify a request's session token end to end: signature, expiry, and
 * revocation. Returns the authenticated user or null — never throws.
 */
export async function verifySession(
  request: Request,
  env: RegistryEnv
): Promise<AuthenticatedUser | null> {
  const token = extractToken(request);
  const secret = getSessionSecret(env);

  const verified = await verifyTokenSignature(token, secret);
  if (!verified) return null;

  // Revocation check against the Registry. A missing/dead session row denies.
  try {
    const registry = getRegistry(env);
    const res = await registry.fetch(`https://registry/sessions/${encodeURIComponent(verified.tokenId)}`);
    if (!res.ok) return null;
    const body = (await res.json()) as { userId?: string };
    if (!body.userId || body.userId !== verified.userId) return null;
    return { userId: verified.userId };
  } catch (err) {
    // Fail closed: if we cannot confirm the session, we do not trust it.
    console.error('Session revocation check failed:', err);
    return null;
  }
}

/** Registry DO singleton lookup (idFromName is stable per deployment). */
export function getRegistry(env: RegistryEnv): DurableObjectStub {
  const id = env.REGISTRY.idFromName('auth');
  return env.REGISTRY.get(id);
}

/**
 * Ensure `projectId` is owned by `userId`, atomically claiming it if it has
 * never been claimed. Returns true when the caller owns it afterwards.
 */
export async function authorizeProject(
  env: RegistryEnv,
  projectId: string,
  userId: string,
  name?: string
): Promise<boolean> {
  try {
    const registry = getRegistry(env);
    const res = await registry.fetch('https://registry/projects/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, userId, name }),
    });
    return res.ok;
  } catch (err) {
    console.error('Project authorization failed:', err);
    return false;
  }
}

/** Does `userId` own `projectId` (claiming is *not* implied)? */
export async function isProjectOwner(
  env: RegistryEnv,
  projectId: string,
  userId: string
): Promise<boolean> {
  try {
    const registry = getRegistry(env);
    const res = await registry.fetch(
      `https://registry/projects/owner-check?projectId=${encodeURIComponent(projectId)}&userId=${encodeURIComponent(userId)}`
    );
    if (!res.ok) return false;
    const body = (await res.json()) as { ownerId?: string };
    return !!body.ownerId && body.ownerId === userId;
  } catch (err) {
    console.error('Project ownership check failed:', err);
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Login / signup / logout — Worker-facing helpers                     */
/* ------------------------------------------------------------------ */

export interface SessionCookie {
  name: string;
  value: string;
  maxAgeSeconds: number;
}

export async function handleSignup(
  request: Request,
  env: RegistryEnv
): Promise<Response> {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: 'Invalid request body' });
  }
  const email = String(body?.email || '').trim().toLowerCase();
  const password = String(body?.password || '');

  const registry = getRegistry(env);
  const res = await registry.fetch('https://registry/auth/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const result = (await res.json()) as { userId?: string; email?: string; error?: string };
  if (!res.ok || !result.userId) {
    return json(res.status || 400, { error: result.error || 'Signup failed' });
  }

  const { token } = await issueToken(getSessionSecret(env), result.userId, TOKEN_TTL_SECONDS);
  await registerSession(env, token, result.userId);
  return sessionResponse(200, { user: { id: result.userId, email: result.email }, token });
}

export async function handleLogin(
  request: Request,
  env: RegistryEnv
): Promise<Response> {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: 'Invalid request body' });
  }
  const email = String(body?.email || '').trim().toLowerCase();
  const password = String(body?.password || '');

  const registry = getRegistry(env);
  const res = await registry.fetch('https://registry/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const result = (await res.json()) as { userId?: string; email?: string; error?: string };
  if (!res.ok || !result.userId) {
    return json(res.status || 401, { error: result.error || 'Login failed' });
  }

  const { token } = await issueToken(getSessionSecret(env), result.userId, TOKEN_TTL_SECONDS);
  await registerSession(env, token, result.userId);
  return sessionResponse(200, { user: { id: result.userId, email: result.email }, token });
}

export async function handleLogout(request: Request, env: RegistryEnv): Promise<Response> {
  const token = extractToken(request);
  if (token) {
    const tokenHash = await sha256Hex(token);
    try {
      await getRegistry(env).fetch('https://registry/sessions', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tokenHash }),
      });
    } catch (err) {
      console.error('Logout failed:', err);
    }
  }
  // Clear the cookie regardless of the token's state.
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': `${AUTH_COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`,
      Vary: 'Origin',
    },
  });
}

export async function handleSession(
  request: Request,
  env: RegistryEnv
): Promise<Response> {
  const user = await verifySession(request, env);
  if (!user) return unauthorized('No valid session');
  return json(200, { userId: user.userId });
}

async function registerSession(env: RegistryEnv, token: string, userId: string): Promise<void> {
  const tokenHash = await sha256Hex(token);
  const payloadPart = token.slice(TOKEN_PREFIX.length).split('.')[0];
  // exp comes from the signed payload; recompute it from the token itself so the
  // stored expiry can never drift from what was signed.
  let expiresAt = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
  const payloadJson = base64urlDecodeString(payloadPart);
  if (payloadJson) {
    try {
      const payload = JSON.parse(payloadJson);
      if (typeof payload?.exp === 'number') expiresAt = payload.exp;
    } catch {
      /* keep the default */
    }
  }
  try {
    await getRegistry(env).fetch('https://registry/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tokenHash, userId, expiresAt }),
    });
  } catch (err) {
    console.error('Failed to register session:', err);
  }
}

function sessionResponse(status: number, body: any): Response {
  const token = body?.token as string | undefined;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Vary: 'Origin',
  };
  if (token) {
    headers['Set-Cookie'] =
      `${AUTH_COOKIE}=${token}; Max-Age=${TOKEN_TTL_SECONDS}; Path=/; HttpOnly; Secure; SameSite=Lax`;
  }
  return new Response(JSON.stringify(body), { status, headers });
}

export function json(status: number, body: any): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', Vary: 'Origin' },
  });
}

/**
 * Build a copy of `request` carrying the verified user id, with any
 * client-supplied copy of the header removed first — the DO trusts this header
 * precisely because only the Worker can set it.
 */
export function injectUserId(request: Request, userId: string): Request {
  const cloned = new Request(request, { method: request.method });
  cloned.headers.delete(USER_ID_HEADER);
  cloned.headers.set(USER_ID_HEADER, userId);
  return cloned;
}

/** Read the header the Worker set; `null` when the request bypassed the gate. */
export function getRequestUserId(request: Request): string | null {
  return request.headers.get(USER_ID_HEADER);
}
