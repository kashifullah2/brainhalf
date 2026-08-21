import { json, type AppEnv } from '../../../server/http';
import { clearedCookieHeader, revokeSession } from '../../../server/session';

export const onRequestPost: PagesFunction<AppEnv> = async ({ request, env }) => {
  // Deletes the server-side row, so the token is dead even if the client keeps
  // a copy of the cookie.
  await revokeSession(request, env);

  return json({ ok: true }, 200, {
    'Set-Cookie': clearedCookieHeader(request),
  });
};
