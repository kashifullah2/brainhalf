// ---------------------------------------------------------------------------
// DELETE /api/account — erase the account and everything it owns.
//
// The right to erasure under GDPR Article 17. There was no way to exercise it:
// Settings offered a "Data & Privacy" tab that promised retention control and
// contained none, and support had no endpoint to call either.
//
// Two safeguards, because this is the most destructive action in the product:
//
//   * the caller must retype their own email address, which a cross-site request
//     cannot know (the middleware's origin check and SameSite=Lax are the first
//     lines; this is the one that survives both being wrong);
//   * it is rate limited, so a stolen session cannot be used to grind through it.
// ---------------------------------------------------------------------------

import { fail, json, normalizeEmail, readJson, type AppEnv } from '../../../server/http';
import { requireSession } from '../../../server/guard';
import { clearedCookieHeader } from '../../../server/session';
import { deleteAccount } from '../../../server/account';
import { enforceRateLimit, userIdentity } from '../../../server/rate-limit';

interface Body {
  /** Must equal the signed-in user's own email address. */
  confirmEmail?: unknown;
}

export const onRequestDelete: PagesFunction<AppEnv> = async ({ request, env }) => {
  const auth = await requireSession(request, env);
  if (auth instanceof Response) return auth;

  const limited = await enforceRateLimit(
    env,
    'account/delete',
    userIdentity(auth.user.id),
    { limit: 5, windowSeconds: 3600 },
  );
  if (limited) return limited;

  const body = await readJson<Body>(request);
  if (normalizeEmail(body?.confirmEmail) !== normalizeEmail(auth.user.email)) {
    return fail(
      'Type your account email address exactly to confirm deletion.',
      400,
    );
  }

  let outcome;
  try {
    outcome = await deleteAccount(env, auth.user.id);
  } catch (error) {
    console.error('[api/account] deletion failed:', error);
    return fail('Could not delete the account. Nothing has been removed.', 500);
  }

  if (!outcome.complete) {
    // Files remain. The account row is deliberately still here, because the
    // document rows are the only record of the remaining object keys.
    return json(
      {
        complete: false,
        objectsDeleted: outcome.objectsDeleted,
        message: 'Still removing your files. Send the request again to continue.',
      },
      200,
    );
  }

  // The session row went with the user, so the cookie is already dead; clearing it
  // stops the browser sending a token that can never resolve again.
  return json({ complete: true, objectsDeleted: outcome.objectsDeleted }, 200, {
    'Set-Cookie': clearedCookieHeader(request),
  });
};
