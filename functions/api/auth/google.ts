import {
  clientIp,
  fail,
  json,
  readJson,
  userAgent,
  type AppEnv,
} from '../../../server/http';
import { randomId } from '../../../server/crypto';
import {
  createSession,
  sessionCookie,
  toSessionUser,
} from '../../../server/session';
import { verifyGoogleIdToken } from '../../../server/google';

interface GoogleBody {
  /** The `credential` field from Google Identity Services. */
  credential?: unknown;
}

interface Row {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  picture_url: string | null;
  email_verified: number;
  google_sub: string | null;
}

export const onRequestPost: PagesFunction<AppEnv> = async ({ request, env }) => {
  const body = await readJson<GoogleBody>(request);
  if (!body || typeof body.credential !== 'string' || !body.credential) {
    return fail('Missing Google credential.', 400);
  }

  const clientId = (
    env.GOOGLE_CLIENT_ID ||
    env.VITE_GOOGLE_CLIENT_ID ||
    '645594415031-qvf264s8235c1ahueop2ker2idcoda23.apps.googleusercontent.com'
  ).trim();

  let identity;
  try {
    identity = await verifyGoogleIdToken(
      body.credential,
      clientId,
    );
  } catch (error) {
    // Log the specific reason; tell the caller only that it failed.
    console.error('[auth/google] verification failed:', error);
    return fail('Could not verify your Google sign-in.', 401);
  }

  // Match on the Google subject first (it is stable even if the user changes
  // their email), then fall back to the address to link an existing account.
  let user = await env.DB.prepare(
    `SELECT id, email, first_name, last_name, picture_url, email_verified, google_sub
       FROM users WHERE google_sub = ?`,
  )
    .bind(identity.sub)
    .first<Row>();

  if (!user) {
    user = await env.DB.prepare(
      `SELECT id, email, first_name, last_name, picture_url, email_verified, google_sub
         FROM users WHERE email = ?`,
    )
      .bind(identity.email)
      .first<Row>();
  }

  if (user) {
    // Link the Google identity on first use, and refresh the profile fields
    // Google owns. Linking by verified email is safe here precisely because
    // verifyGoogleIdToken rejects tokens whose email is unverified.
    try {
      await env.DB.prepare(
        `UPDATE users
            SET google_sub = COALESCE(google_sub, ?),
                picture_url = COALESCE(?, picture_url),
                first_name = CASE WHEN first_name = '' THEN ? ELSE first_name END,
                last_name  = CASE WHEN last_name  = '' THEN ? ELSE last_name  END,
                email_verified = 1,
                last_login_at = datetime('now'),
                updated_at = datetime('now')
          WHERE id = ?`,
      )
        .bind(
          identity.sub,
          identity.picture,
          identity.firstName,
          identity.lastName,
          user.id,
        )
        .run();
    } catch (error) {
      console.error('[auth/google] profile update failed:', error);
    }

    const token = await createSession(env, user.id, {
      userAgent: userAgent(request),
      ip: clientIp(request),
    });

    return json(
      {
        user: toSessionUser({
          ...user,
          picture_url: user.picture_url ?? identity.picture,
          email_verified: 1,
        }),
      },
      200,
      { 'Set-Cookie': sessionCookie(request, token) },
    );
  }

  // First time we have seen this person: create the account. password_hash stays
  // NULL, which login.ts treats as "cannot sign in with a password".
  const id = randomId('usr');
  try {
    await env.DB.prepare(
      `INSERT INTO users
         (id, email, password_hash, first_name, last_name, picture_url,
          google_sub, email_verified, last_login_at)
       VALUES (?, ?, NULL, ?, ?, ?, ?, 1, datetime('now'))`,
    )
      .bind(
        id,
        identity.email,
        identity.firstName,
        identity.lastName,
        identity.picture,
        identity.sub,
      )
      .run();
  } catch (error) {
    console.error('[auth/google] insert failed:', error);
    return fail('Could not complete Google sign-in.', 500);
  }

  const token = await createSession(env, id, {
    userAgent: userAgent(request),
    ip: clientIp(request),
  });

  return json(
    {
      user: {
        id,
        email: identity.email,
        firstName: identity.firstName,
        lastName: identity.lastName,
        pictureUrl: identity.picture,
        emailVerified: true,
      },
    },
    201,
    { 'Set-Cookie': sessionCookie(request, token) },
  );
};
