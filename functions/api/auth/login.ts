import {
  clientIp,
  fail,
  json,
  normalizeEmail,
  readJson,
  userAgent,
  type AppEnv,
} from '../../../server/http';
import {
  dummyVerify,
  hashPassword,
  verifyPassword,
} from '../../../server/crypto';
import {
  createSession,
  sessionCookie,
  toSessionUser,
} from '../../../server/session';
import {
  RULES,
  enforceRateLimit,
  ipIdentity,
} from '../../../server/rate-limit';

interface LoginBody {
  email?: unknown;
  password?: unknown;
}

interface Row {
  id: string;
  email: string;
  password_hash: string | null;
  first_name: string;
  last_name: string;
  picture_url: string | null;
  email_verified: number;
}

/** One message for every failure mode, so it never leaks which part was wrong. */
const GENERIC_FAILURE = 'Email or password is incorrect.';

export const onRequestPost: PagesFunction<AppEnv> = async ({ request, env }) => {
  // First, ahead of anything expensive: a real verification costs 600,000 PBKDF2
  // iterations, and the dummyVerify() below pays exactly the same for addresses
  // that do not exist. Unthrottled, that is a CPU amplifier as much as it is a
  // brute-force surface.
  const limited = await enforceRateLimit(
    env,
    'auth/login',
    ipIdentity(request),
    RULES.login,
  );
  if (limited) return limited;

  const body = await readJson<LoginBody>(request);
  if (!body) return fail('Request body must be valid JSON.', 400);

  const email = normalizeEmail(body.email);
  const password = typeof body.password === 'string' ? body.password : '';

  if (!email || !password) {
    return fail('Email and password are required.', 400);
  }

  const user = await env.DB.prepare(
    `SELECT id, email, password_hash, first_name, last_name, picture_url, email_verified
       FROM users WHERE email = ?`,
  )
    .bind(email)
    .first<Row>();

  if (!user) {
    // Spend the same CPU as a real verification so response time does not
    // disclose whether the address is registered.
    await dummyVerify(password);
    return fail(GENERIC_FAILURE, 401);
  }

  if (!user.password_hash) {
    // Google-only account: do not confirm that by saying so.
    await dummyVerify(password);
    return fail(GENERIC_FAILURE, 401);
  }

  const { valid, needsRehash } = await verifyPassword(password, user.password_hash);
  if (!valid) {
    return fail(GENERIC_FAILURE, 401);
  }

  // Transparently upgrade hashes stored under weaker parameters.
  if (needsRehash) {
    try {
      await env.DB.prepare(
        `UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?`,
      )
        .bind(await hashPassword(password), user.id)
        .run();
    } catch (error) {
      // A failed upgrade must not block a valid login.
      console.error('[auth/login] rehash failed:', error);
    }
  }

  await env.DB.prepare(`UPDATE users SET last_login_at = datetime('now') WHERE id = ?`)
    .bind(user.id)
    .run();

  const token = await createSession(env, user.id, {
    userAgent: userAgent(request),
    ip: clientIp(request),
  });

  return json({ user: toSessionUser(user) }, 200, {
    'Set-Cookie': sessionCookie(request, token),
  });
};
