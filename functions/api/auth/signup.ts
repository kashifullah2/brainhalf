import {
  fail,
  isPlausibleEmail,
  json,
  normalizeEmail,
  readJson,
  validatePassword,
  clientIp,
  userAgent,
  type AppEnv,
} from '../../../server/http';
import { hashPassword, randomId } from '../../../server/crypto';
import { createSession, sessionCookie } from '../../../server/session';
import {
  RULES,
  enforceRateLimit,
  ipIdentity,
} from '../../../server/rate-limit';

interface SignupBody {
  firstName?: unknown;
  lastName?: unknown;
  email?: unknown;
  password?: unknown;
}

function cleanName(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, 100) : '';
}

export const onRequestPost: PagesFunction<AppEnv> = async ({ request, env }) => {
  const limited = await enforceRateLimit(
    env,
    'auth/signup',
    ipIdentity(request),
    RULES.signup,
  );
  if (limited) return limited;

  const body = await readJson<SignupBody>(request);
  if (!body) return fail('Request body must be valid JSON.', 400);

  const email = normalizeEmail(body.email);
  if (!isPlausibleEmail(email)) {
    return fail('Enter a valid email address.', 400);
  }

  const passwordError = validatePassword(body.password);
  if (passwordError) return fail(passwordError, 400);

  const firstName = cleanName(body.firstName);
  const lastName = cleanName(body.lastName);
  if (!firstName) return fail('First name is required.', 400);

  const existing = await env.DB.prepare(`SELECT id FROM users WHERE email = ?`)
    .bind(email)
    .first<{ id: string }>();

  // Signup deliberately reveals that an address is taken: the alternative
  // (silently pretending to succeed) leaves a legitimate user with no way to
  // understand why they cannot sign in. Login and password reset do NOT reveal
  // this — see login.ts and password-reset.ts.
  if (existing) {
    return fail('An account with that email already exists.', 409);
  }

  const id = randomId('usr');
  const passwordHash = await hashPassword(body.password as string);

  try {
    await env.DB.prepare(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, last_login_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))`,
    )
      .bind(id, email, passwordHash, firstName, lastName)
      .run();
  } catch (error) {
    // The UNIQUE index is the real arbiter: two concurrent signups for the same
    // address both pass the SELECT above, and one of them lands here.
    if (String(error).includes('UNIQUE')) {
      return fail('An account with that email already exists.', 409);
    }
    console.error('[auth/signup] insert failed:', error);
    return fail('Could not create the account.', 500);
  }

  const token = await createSession(env, id, {
    userAgent: userAgent(request),
    ip: clientIp(request),
  });

  return json(
    {
      user: {
        id,
        email,
        firstName,
        lastName,
        pictureUrl: null,
        emailVerified: false,
      },
    },
    201,
    { 'Set-Cookie': sessionCookie(request, token) },
  );
};
