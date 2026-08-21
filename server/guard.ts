// ---------------------------------------------------------------------------
// Session guard for the data endpoints.
//
// Every handler that touches user data starts with requireSession(). The user id
// it returns is the ONLY source of ownership — no endpoint accepts a user id
// from the request, which is what makes cross-account access impossible rather
// than merely discouraged.
// ---------------------------------------------------------------------------

import { fail, type AppEnv } from './http';
import { resolveSession, sessionCookie, type SessionUser } from './session';

export interface Authed {
  user: SessionUser;
  /** Present when the session rolled forward and the cookie must be re-sent. */
  setCookie?: string;
}

/**
 * Returns the caller's identity, or a 401 Response to return directly:
 *
 *   const auth = await requireSession(request, env);
 *   if (auth instanceof Response) return auth;
 */
export async function requireSession(
  request: Request,
  env: AppEnv,
): Promise<Authed | Response> {
  const session = await resolveSession(request, env);
  if (!session) {
    return fail('You need to sign in to do that.', 401);
  }
  return {
    user: session.user,
    setCookie: session.refreshedToken
      ? sessionCookie(request, session.refreshedToken)
      : undefined,
  };
}

/** Merges the rolling-session cookie into a handler's response headers. */
export function authHeaders(auth: Authed): Record<string, string> | undefined {
  return auth.setCookie ? { 'Set-Cookie': auth.setCookie } : undefined;
}

/** Parses a positive integer path parameter, or null when it is not one. */
export function intParam(value: string | string[] | undefined): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export type { SessionUser };
