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
import { validSessionSecret } from './runtime-config';
import {
  TOKEN_PREFIX,
  TOKEN_TTL_SECONDS,
  base64urlDecodeString,
  issueToken,
  sha256Hex,
  verifyTokenSignature,
} from './crypto';
import { isAllowedOrigin } from './allowed-origins';
import { getAppSessionToken } from './app-session';

export { isAllowedOrigin };

export const AUTH_COOKIE = 'bh_session';
/** Header the Worker injects after verifying identity. Treated as authoritative
 *  by the Durable Objects *because* the Worker strips any client-supplied copy. */
export const USER_ID_HEADER = 'x-auth-user-id';
/** Query param used for DO WebSocket upgrades where custom headers may not be forwarded. */
export const USER_ID_QUERY_PARAM = '_uid';
export const SESSION_HASH_QUERY_PARAM = '_sid';

export interface AuthenticatedUser {
  userId: string;
}

export interface RegistryEnv {
  REGISTRY: DurableObjectNamespace;
}

/** Origin allowlist — re-exported from ./allowed-origins so the Worker and the
 *  browser share one list. Replaces the previous `Access-Control-Allow-Origin: *`. */
export { ALLOWED_ORIGINS } from './allowed-origins';

export function getSessionSecret(env: any): string {
  if (validSessionSecret(env?.SESSION_SECRET)) {
    return env.SESSION_SECRET;
  }
  throw new Error('SESSION_SECRET must contain at least 32 non-padding characters');
}

export function authUnavailable(): Response {
  return new Response(JSON.stringify({ error: 'Authentication service unavailable' }), {
    status: 503,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
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
  try {
    const token = extractToken(request);
    const secret = getSessionSecret(env);
    const verified = await verifyTokenSignature(token, secret);
    if (!verified) return null;

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

export async function verifyPreviewSession(request: Request, env: RegistryEnv): Promise<AuthenticatedUser | null> {
  if (!getAppSessionToken(request.headers)) return verifySession(request, env);
  const headers = new Headers(request.headers);
  headers.delete('authorization');
  return verifySession(new Request(request.url, { headers }), env);
}

/** Registry DO singleton lookup (idFromName is stable per deployment). */
export function getRegistry(env: RegistryEnv): DurableObjectStub {
  const id = env.REGISTRY.idFromName('auth');
  return env.REGISTRY.get(id);
}

/* ------------------------------------------------------------------ */
/* WebSocket tickets                                                   */
/* ------------------------------------------------------------------ */

/**
 * A browser cannot set headers on a `new WebSocket(...)`, so the upgrade URL is
 * the only transport available for authenticating the handshake. Putting the
 * 30-day session token there meant it sat in access logs and, with
 * `[observability.traces]` sampling, in trace data. A ticket is a one-time
 * substitute: minted for an already-verified user, valid for one handshake, and
 * deleted on use. See {@link verifyWsTicket}.
 */
export async function issueWsTicket(env: RegistryEnv, userId: string, sessionHash?: string): Promise<string | null> {
  try {
    const registry = getRegistry(env);
    const res = await registry.fetch('https://registry/ws-tickets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, sessionHash }),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { ticket?: string };
    return body.ticket ?? null;
  } catch (err) {
    console.error('WS ticket issuance failed:', err);
    return null;
  }
}

/**
 * Redeem a ticket for the user id it was minted for. The Registry deletes the
 * row as part of the lookup, so this is single-use: a replay always fails. An
 * expired or unknown ticket yields `null`, and the caller must refuse the
 * handshake.
 */
export async function verifyWsTicket(env: RegistryEnv, ticket: string): Promise<string | null> {
  return (await redeemWsIdentity(env, ticket))?.userId ?? null;
}

export async function redeemWsIdentity(env: RegistryEnv, ticket: string): Promise<{ userId: string; sessionHash: string } | null> {
  try {
    const registry = getRegistry(env);
    const res = await registry.fetch('https://registry/ws-tickets/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticket }),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { userId?: string; sessionHash?: string };
    return body.userId ? { userId: body.userId, sessionHash: body.sessionHash || '' } : null;
  } catch (err) {
    console.error('WS ticket verification failed:', err);
    return null;
  }
}

/** Read the `?ticket=` parameter, or `null` when the URL carries none. */
export function extractWsTicket(request: Request): string | null {
  try {
    const value = new URL(request.url).searchParams.get('ticket');
    return value && value.startsWith('bhwt_') ? value : null;
  } catch {
    return null;
  }
}

/**
 * Ensure `projectId` is owned by `userId`, atomically claiming it if it has
 * never been claimed. Returns true when the caller owns it afterwards.
 */
export async function authorizeProject(
  env: RegistryEnv,
  projectId: string,
  userId: string,
  name?: string,
  idempotencyKey?: string
): Promise<{ ok: boolean; status: number }> {
  try {
    const registry = getRegistry(env);
    const res = await registry.fetch('https://registry/projects/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, userId, name, idempotencyKey }),
    });
    return { ok: res.ok, status: res.status };
  } catch (err) {
    console.error('Project authorization failed:', err);
    return { ok: false, status: 500 };
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
  let secret: string;
  try { secret = getSessionSecret(env); } catch { return authUnavailable(); }
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

  const { token } = await issueToken(secret, result.userId, TOKEN_TTL_SECONDS);
  if (!await registerSession(env, token, result.userId)) return authUnavailable();
  return sessionResponse(200, { user: { id: result.userId, email: result.email }, token });
}

export async function handleLogin(
  request: Request,
  env: RegistryEnv
): Promise<Response> {
  let secret: string;
  try { secret = getSessionSecret(env); } catch { return authUnavailable(); }
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

  const { token } = await issueToken(secret, result.userId, TOKEN_TTL_SECONDS);
  if (!await registerSession(env, token, result.userId)) return authUnavailable();
  return sessionResponse(200, { user: { id: result.userId, email: result.email }, token });
}

export async function handleLogout(request: Request, env: RegistryEnv): Promise<Response> {
  let revoked = true;
  const token = extractToken(request);
  if (token) {
    const tokenHash = await sha256Hex(token);
    try {
      const response = await getRegistry(env).fetch('https://registry/sessions', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tokenHash }),
      });
      revoked = response.ok;
    } catch (err) {
      revoked = false;
      console.error('Logout failed:', err);
    }
  }
  // Clear the cookie regardless of the token's state.
  return new Response(JSON.stringify(revoked ? { ok: true } : { error: 'Session revocation could not be confirmed. Please try again.' }), {
    status: revoked ? 200 : 503,
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

async function registerSession(env: RegistryEnv, token: string, userId: string): Promise<boolean> {
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
    const response = await getRegistry(env).fetch('https://registry/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tokenHash, userId, expiresAt }),
    });
    return response.ok;
  } catch (err) {
    console.error('Failed to register session:', err);
    return false;
  }
}

export function sessionResponse(status: number, body: any): Response {
  const token = body?.token as string | undefined;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
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
export function injectUserId(request: Request, userId: string, sessionHash?: string): Request {
  const url = new URL(request.url);
  // Encode userId in both the header (for HTTP requests) and URL param (for
  // WebSocket upgrade requests where custom headers may be stripped by the
  // Cloudflare Workers runtime when forwarding to Durable Objects).
  url.searchParams.set(USER_ID_QUERY_PARAM, userId);
  url.searchParams.delete(SESSION_HASH_QUERY_PARAM);
  if (sessionHash && /^[a-f0-9]{64}$/.test(sessionHash)) url.searchParams.set(SESSION_HASH_QUERY_PARAM, sessionHash);
  const cloned = new Request(url.toString(), request);
  cloned.headers.delete(USER_ID_HEADER);
  cloned.headers.set(USER_ID_HEADER, userId);
  return cloned;
}

/** Read the user id injected by the Worker. Checks URL param first (reliable for
 *  WS upgrades), then falls back to the header (reliable for HTTP). */
export function getRequestUserId(request: Request): string | null {
  try {
    const fromUrl = new URL(request.url).searchParams.get(USER_ID_QUERY_PARAM);
    if (fromUrl) return fromUrl;
  } catch { /* malformed URL */ }
  return request.headers.get(USER_ID_HEADER);
}
