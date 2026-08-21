// ---------------------------------------------------------------------------
// Session issue / lookup / revoke, plus cookie serialisation.
//
// The cookie holds a 256-bit random token. Only its SHA-256 hash is persisted,
// so a dump of the sessions table cannot be replayed as a login.
// ---------------------------------------------------------------------------

import { randomToken, sha256Hex } from './crypto';
import type { AppEnv } from './http';

export const SESSION_COOKIE = 'bh_session';
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days
/** Re-issue the cookie when less than this remains, so active users stay in. */
const REFRESH_WHEN_REMAINING_SECONDS = 60 * 60 * 24 * 7; // 7 days

/** Roughly one call in every SWEEP_EVERY also prunes dead auth rows. */
const SWEEP_EVERY = 50;
/** Rows removed per table per sweep. Bounds what any single request pays for. */
const SWEEP_BATCH = 200;

export interface SessionUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  pictureUrl: string | null;
  emailVerified: boolean;
}

interface UserRow {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  picture_url: string | null;
  email_verified: number;
}

export function toSessionUser(row: UserRow): SessionUser {
  return {
    id: row.id,
    email: row.email,
    firstName: row.first_name,
    lastName: row.last_name,
    pictureUrl: row.picture_url,
    emailVerified: row.email_verified === 1,
  };
}

function expiryIso(secondsFromNow: number): string {
  return new Date(Date.now() + secondsFromNow * 1000)
    .toISOString()
    .replace('T', ' ')
    .slice(0, 19);
}

/**
 * `Secure` is set only for https requests. A browser rejects a Secure cookie
 * sent over plain http, so hardcoding it would break local development at
 * http://localhost and http://127.0.0.1 alike. Cloudflare terminates TLS but
 * `request.url` still reflects the original scheme, so this is accurate in
 * production.
 */
function isSecureContext(request: Request): boolean {
  return new URL(request.url).protocol === 'https:';
}

export function sessionCookie(request: Request, token: string): string {
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    // Lax, not Strict: Strict would drop the cookie on the redirect back from
    // an external identity provider. Lax still blocks cross-site POSTs.
    'SameSite=Lax',
    `Max-Age=${SESSION_TTL_SECONDS}`,
  ];
  if (isSecureContext(request)) parts.push('Secure');
  return parts.join('; ');
}

export function clearedCookieHeader(request: Request): string {
  const parts = [
    `${SESSION_COOKIE}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
  ];
  if (isSecureContext(request)) parts.push('Secure');
  return parts.join('; ');
}

export function readSessionToken(request: Request): string | null {
  const header = request.headers.get('Cookie');
  if (!header) return null;
  for (const pair of header.split(';')) {
    const index = pair.indexOf('=');
    if (index === -1) continue;
    if (pair.slice(0, index).trim() === SESSION_COOKIE) {
      return pair.slice(index + 1).trim() || null;
    }
  }
  return null;
}

export async function createSession(
  env: AppEnv,
  userId: string,
  meta: { userAgent: string | null; ip: string | null },
): Promise<string> {
  const token = randomToken(32);
  const tokenHash = await sha256Hex(token);

  await env.DB.prepare(
    `INSERT INTO sessions (token_hash, user_id, expires_at, user_agent, ip)
     VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(
      tokenHash,
      userId,
      expiryIso(SESSION_TTL_SECONDS),
      meta.userAgent,
      meta.ip,
    )
    .run();

  return token;
}

export interface ResolvedSession {
  user: SessionUser;
  /** Set when the session was close to expiry and the cookie should be re-sent. */
  refreshedToken?: string;
}

/**
 * Resolves the caller's session, or null. Expired rows are deleted on sight so
 * the table self-cleans without a scheduled job.
 */
export async function resolveSession(
  request: Request,
  env: AppEnv,
): Promise<ResolvedSession | null> {
  const token = readSessionToken(request);
  if (!token) return null;

  const tokenHash = await sha256Hex(token);

  const row = await env.DB.prepare(
    `SELECT s.expires_at AS expires_at,
            u.id AS id, u.email AS email, u.first_name AS first_name,
            u.last_name AS last_name, u.picture_url AS picture_url,
            u.email_verified AS email_verified
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?`,
  )
    .bind(tokenHash)
    .first<UserRow & { expires_at: string }>();

  if (!row) return null;

  const expiresAt = Date.parse(`${row.expires_at.replace(' ', 'T')}Z`);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    await env.DB.prepare(`DELETE FROM sessions WHERE token_hash = ?`)
      .bind(tokenHash)
      .run();
    return null;
  }

  const user = toSessionUser(row);

  const remaining = (expiresAt - Date.now()) / 1000;
  if (remaining < REFRESH_WHEN_REMAINING_SECONDS) {
    await env.DB.prepare(
      `UPDATE sessions SET expires_at = ? WHERE token_hash = ?`,
    )
      .bind(expiryIso(SESSION_TTL_SECONDS), tokenHash)
      .run();
    return { user, refreshedToken: token };
  }

  return { user };
}

export async function revokeSession(request: Request, env: AppEnv): Promise<void> {
  const token = readSessionToken(request);
  if (!token) return;
  await env.DB.prepare(`DELETE FROM sessions WHERE token_hash = ?`)
    .bind(await sha256Hex(token))
    .run();
}

/** Used after a password change: every other device is signed out. */
export async function revokeAllSessions(env: AppEnv, userId: string): Promise<void> {
  await env.DB.prepare(`DELETE FROM sessions WHERE user_id = ?`).bind(userId).run();
}

/**
 * Deletes rows that can never authenticate anyone again: sessions past their
 * expiry, and password reset tokens past theirs.
 *
 * There is no scheduled job to put this in. `[triggers]` with a cron is a
 * Workers feature, and wrangler.toml here is a Pages config (it declares
 * `pages_build_output_dir`), so a Pages project has no scheduled handler to
 * register. This follows the prune already in server/rate-limit.ts instead:
 * probabilistic, bounded by LIMIT, and never allowed to fail a request.
 *
 * resolveSession() drops the caller's own expired row on sight, but only that
 * one row. Someone who signs in on a laptop and never comes back leaves theirs
 * behind forever -- along with every reset token that was emailed and ignored.
 * That is what accumulates, and what this collects.
 *
 * Reset tokens are removed on expiry rather than on use, so a token that was
 * used stays for the rest of its hour. Harmless: password-reset-confirm.ts
 * rejects a row with `used_at` set before it looks at anything else.
 */
export async function maybeSweepExpiredAuthRows(env: AppEnv): Promise<void> {
  if (Math.floor(Math.random() * SWEEP_EVERY) !== 0) return;

  try {
    await env.DB.batch([
      env.DB.prepare(
        `DELETE FROM sessions WHERE token_hash IN (
           SELECT token_hash FROM sessions
            WHERE expires_at < datetime('now')
            LIMIT ${SWEEP_BATCH}
         )`,
      ),
      env.DB.prepare(
        `DELETE FROM password_reset_tokens WHERE token_hash IN (
           SELECT token_hash FROM password_reset_tokens
            WHERE expires_at < datetime('now')
            LIMIT ${SWEEP_BATCH}
         )`,
      ),
    ]);
  } catch (error) {
    // A failed sweep is not a failed request. Every read path already treats
    // these rows as dead; this only reclaims the space they take.
    console.error('[session] sweep failed:', error);
  }
}
