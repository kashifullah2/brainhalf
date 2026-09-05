// ---------------------------------------------------------------------------
// Who is an administrator.
//
// This decision used to be made in the browser, in src/context/AuthContext.tsx,
// by substring matching:
//
//   ADMIN_EMAILS = ["kashif", "kashifullah", "kashifullah919@gmail.com", ...]
//   isAdmin = user.email.includes(admin)
//          || user.name.includes(admin)
//          || user.firstName.includes(admin)
//
// Three separate ways in, and every one of them was open:
//
//   * "kashif" as a substring of the email matched kashif@anything.example, and
//     any address containing the letters at all -- notkashif@example.com.
//   * `name` and `firstName` come from the signup form. Registering with the
//     first name "Kashif" made the account an administrator.
//   * the whole check ran client-side, so it could simply be edited in DevTools.
//
// The allowlist is now an exact, case-insensitive match on the verified account
// email, evaluated on the server, and the client is told the answer rather than
// deciding it. Nothing a user can type about themselves takes part.
// ---------------------------------------------------------------------------

import { fail } from './http';
import type { AppEnv } from './http';
import { requireSession, type Authed } from './guard';

/**
 * Accounts that are administrators when ADMIN_EMAILS is not set on the
 * deployment. Kept so the owner is not locked out of an existing deployment by
 * this change; set ADMIN_EMAILS to override it entirely.
 */
const DEFAULT_ADMIN_EMAILS = ['kashifullah919@gmail.com'];

export function adminEmails(env: Pick<AppEnv, 'ADMIN_EMAILS'>): string[] {
  const configured = env.ADMIN_EMAILS?.trim();
  const source = configured ? configured.split(',') : DEFAULT_ADMIN_EMAILS;
  return source
    .map((entry) => entry.trim().toLowerCase())
    // An entry with no "@" cannot be an address, and allowing one is how the
    // bare-substring hole existed in the first place.
    .filter((entry) => entry.length > 0 && entry.includes('@'));
}

export function isAdminEmail(
  env: Pick<AppEnv, 'ADMIN_EMAILS'>,
  email: string | null | undefined,
): boolean {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  if (!normalized) return false;
  return adminEmails(env).includes(normalized);
}

/**
 * Session guard for the admin endpoints. Returns the caller, or a Response to
 * return directly. A signed-in non-admin gets 404 rather than 403 so the
 * existence of the endpoint is not confirmed to an account that may not use it.
 */
export async function requireAdmin(
  request: Request,
  env: AppEnv,
): Promise<Authed | Response> {
  const auth = await requireSession(request, env);
  if (auth instanceof Response) return auth;
  if (!isAdminEmail(env, auth.user.email)) {
    console.warn(`[admin] refused ${new URL(request.url).pathname} for ${auth.user.id}`);
    return fail('Not found.', 404);
  }
  return auth;
}
