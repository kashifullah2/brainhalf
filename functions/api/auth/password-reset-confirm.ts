import {
  clientIp,
  fail,
  json,
  readJson,
  userAgent,
  validatePassword,
  type AppEnv,
} from '../../../server/http';
import { hashPassword, sha256Hex } from '../../../server/crypto';
import {
  createSession,
  revokeAllSessions,
  sessionCookie,
  toSessionUser,
} from '../../../server/session';
import {
  RULES,
  enforceRateLimit,
  ipIdentity,
} from '../../../server/rate-limit';

interface Body {
  token?: unknown;
  password?: unknown;
}

interface TokenRow {
  token_hash: string;
  user_id: string;
  expires_at: string;
  used_at: string | null;
}

export const onRequestPost: PagesFunction<AppEnv> = async ({ request, env }) => {
  // A 256-bit token is not brute-forceable in the abstract, but an endpoint
  // with no limit lets a script hammer the DB with guesses from one IP. The
  // token is one-use and the reset route is itself rate-limited, so the cap
  // here is a backstop against a single point of abuse.
  const limited = await enforceRateLimit(
    env,
    'auth/password-reset-confirm',
    ipIdentity(request),
    RULES.passwordResetConfirm,
  );
  if (limited) return limited;

  const body = await readJson<Body>(request);
  if (!body || typeof body.token !== 'string' || !body.token) {
    return fail('This reset link is not valid.', 400);
  }

  const passwordError = validatePassword(body.password);
  if (passwordError) return fail(passwordError, 400);

  const tokenHash = await sha256Hex(body.token);
  const row = await env.DB.prepare(
    `SELECT token_hash, user_id, expires_at, used_at
       FROM password_reset_tokens WHERE token_hash = ?`,
  )
    .bind(tokenHash)
    .first<TokenRow>();

  // One message for expired, already-used, and non-existent tokens.
  const invalid = () =>
    fail('This reset link has expired or already been used.', 400);

  if (!row || row.used_at) return invalid();

  const expiresAt = Date.parse(`${row.expires_at.replace(' ', 'T')}Z`);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return invalid();

  const passwordHash = await hashPassword(body.password as string);

  try {
    await env.DB.prepare(
      `UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?`,
    )
      .bind(passwordHash, row.user_id)
      .run();

    await env.DB.prepare(
      `UPDATE password_reset_tokens SET used_at = datetime('now') WHERE token_hash = ?`,
    )
      .bind(tokenHash)
      .run();
  } catch (error) {
    console.error('[auth/password-reset-confirm] update failed:', error);
    return fail('Could not reset the password.', 500);
  }

  // A password change signs out every existing device — the point of a reset is
  // often to evict someone who should not be there.
  await revokeAllSessions(env, row.user_id);

  const user = await env.DB.prepare(
    `SELECT id, email, first_name, last_name, picture_url, email_verified
       FROM users WHERE id = ?`,
  )
    .bind(row.user_id)
    .first<{
      id: string;
      email: string;
      first_name: string;
      last_name: string;
      picture_url: string | null;
      email_verified: number;
    }>();

  if (!user) return fail('Could not reset the password.', 500);

  const token = await createSession(env, row.user_id, {
    userAgent: userAgent(request),
    ip: clientIp(request),
  });

  return json({ user: toSessionUser(user) }, 200, {
    'Set-Cookie': sessionCookie(request, token),
  });
};
