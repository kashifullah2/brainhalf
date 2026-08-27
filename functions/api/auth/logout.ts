import { json, type AppEnv } from '../../../server/http';
import { clearedCookieHeader, revokeSession } from '../../../server/session';
import {
  RULES,
  enforceRateLimit,
  ipIdentity,
} from '../../../server/rate-limit';

export const onRequestPost: PagesFunction<AppEnv> = async ({ request, env }) => {
  // Logout is low-risk (it only destroys a session), but an attacker flooding
  // it from one IP could waste DB round trips. A generous cap keeps it honest
  // without blocking a legitimate user who clicks "Sign out" a few times.
  const limited = await enforceRateLimit(
    env,
    'auth/logout',
    ipIdentity(request),
    RULES.logout,
  );
  if (limited) return limited;

  // Deletes the server-side row, so the token is dead even if the client keeps
  // a copy of the cookie.
  await revokeSession(request, env);

  return json({ ok: true }, 200, {
    'Set-Cookie': clearedCookieHeader(request),
  });
};
