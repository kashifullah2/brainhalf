// ---------------------------------------------------------------------------
// GET /api/account/export — everything we hold about the caller, as JSON.
//
// The right of access under GDPR Article 15. There was no way to obtain it, on a
// product that ships a privacy policy.
// ---------------------------------------------------------------------------

import { json, type AppEnv } from '../../../server/http';
import { authHeaders, requireSession } from '../../../server/guard';
import { exportUserData } from '../../../server/account';
import { RULES, enforceRateLimit, userIdentity } from '../../../server/rate-limit';

export const onRequestGet: PagesFunction<AppEnv> = async ({ request, env }) => {
  const auth = await requireSession(request, env);
  if (auth instanceof Response) return auth;

  // Six table scans serialised into one response; see RULES.accountExport.
  const limited = await enforceRateLimit(
    env,
    'account/export',
    userIdentity(auth.user.id),
    RULES.accountExport,
  );
  if (limited) return limited;

  const data = await exportUserData(env, auth.user.id);

  // Downloaded rather than rendered: it is the user's own data, and no cache --
  // shared or otherwise -- should keep a copy.
  return json(data, 200, {
    ...authHeaders(auth),
    'Content-Disposition': `attachment; filename="brainhalf-export-${
      new Date().toISOString().slice(0, 10)
    }.json"`,
    'Cache-Control': 'no-store',
  });
};
