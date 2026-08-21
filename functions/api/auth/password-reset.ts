import {
  isPlausibleEmail,
  json,
  normalizeEmail,
  readJson,
  type AppEnv,
} from '../../../server/http';
import { randomToken, sha256Hex } from '../../../server/crypto';
import {
  RULES,
  enforceRateLimit,
  ipIdentity,
} from '../../../server/rate-limit';

interface Body {
  email?: unknown;
}

const TOKEN_TTL_SECONDS = 60 * 60; // 1 hour

function expiryIso(seconds: number): string {
  return new Date(Date.now() + seconds * 1000)
    .toISOString()
    .replace('T', ' ')
    .slice(0, 19);
}

/**
 * Always answers 200 with the same body, whether or not the address exists.
 * Anything else turns this endpoint into an account-enumeration oracle.
 */
export const onRequestPost: PagesFunction<AppEnv> = async ({ request, env }) => {
  // Throttled per IP, never per address, so a 429 still discloses nothing about
  // which accounts exist -- the same property the 200-always response protects.
  const limited = await enforceRateLimit(
    env,
    'auth/password-reset',
    ipIdentity(request),
    RULES.passwordReset,
  );
  if (limited) return limited;

  const body = await readJson<Body>(request);
  const email = normalizeEmail(body?.email);

  const acknowledged = json(
    {
      ok: true,
      message:
        'If an account exists for that address, a reset link is on its way.',
    },
    200,
  );

  if (!isPlausibleEmail(email)) return acknowledged;

  const user = await env.DB.prepare(`SELECT id FROM users WHERE email = ?`)
    .bind(email)
    .first<{ id: string }>();

  if (!user) return acknowledged;

  const token = randomToken(32);

  try {
    // Invalidate any earlier outstanding tokens for this user.
    await env.DB.prepare(
      `UPDATE password_reset_tokens SET used_at = datetime('now')
        WHERE user_id = ? AND used_at IS NULL`,
    )
      .bind(user.id)
      .run();

    await env.DB.prepare(
      `INSERT INTO password_reset_tokens (token_hash, user_id, expires_at)
       VALUES (?, ?, ?)`,
    )
      .bind(await sha256Hex(token), user.id, expiryIso(TOKEN_TTL_SECONDS))
      .run();
  } catch (error) {
    console.error('[auth/password-reset] could not store token:', error);
    return acknowledged;
  }

  const origin = new URL(request.url).origin;
  const resetUrl = `${origin}/reset-password?token=${token}`;

  if (env.EMAIL) {
    try {
      await env.EMAIL.send({
        to: email,
        from: { email: 'noreply@brainhalf.com', name: 'brainhalf' },
        subject: 'Reset your brainhalf password',
        text:
          `Someone asked to reset the password for this address.\n\n` +
          `${resetUrl}\n\n` +
          `The link expires in one hour. If this was not you, ignore this email.`,
      });
    } catch (error) {
      console.error('[auth/password-reset] send failed:', error);
    }
  } else {
    // No EMAIL binding (local dev): log the link instead of silently doing
    // nothing, so the flow is testable.
    console.warn(`[auth/password-reset] no EMAIL binding. Reset URL: ${resetUrl}`);
  }

  return acknowledged;
};
