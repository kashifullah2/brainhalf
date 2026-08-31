// ---------------------------------------------------------------------------
// Fixed-window rate limiting, backed by D1.
//
// Why the database and not a module-level Map: Pages Functions are stateless and
// consecutive requests may be served by different isolates, so an in-process
// counter would reset constantly and enforce nothing. The increment is done with
// INSERT ... ON CONFLICT DO UPDATE ... RETURNING so two concurrent requests
// cannot both read the same pre-increment value and both be allowed through.
//
// Why this matters beyond brute force: verifying a password runs 600,000 PBKDF2
// iterations (see server/crypto.ts), and login pays the same cost via
// dummyVerify() even for addresses that do not exist. With no limit in front, an
// anonymous caller converts cheap HTTP requests into expensive Worker CPU.
// ---------------------------------------------------------------------------

import { clientIp, json, type AppEnv } from './http';

export interface RateLimitRule {
  /** Requests allowed per window, per identity. */
  limit: number;
  windowSeconds: number;
  /**
   * Shown to the caller. Must stay generic: this fires on endpoints that
   * deliberately do not disclose whether an account exists.
   */
  message?: string;
}

/**
 * Per-route limits. Sized to be invisible to a person using the app normally and
 * useless to a script.
 */
export const RULES: Record<string, RateLimitRule> = {
  login: { limit: 10, windowSeconds: 300 },
  signup: { limit: 5, windowSeconds: 3600 },
  passwordReset: { limit: 5, windowSeconds: 3600 },
  contact: { limit: 5, windowSeconds: 3600 },
  ocr: { limit: 120, windowSeconds: 3600 },
  upload: { limit: 200, windowSeconds: 3600 },
  /**
   * Google ID-token sign-in. Lower than login because the route both verifies a
   * JWT and can create an account, and an attacker burning through it from one
   * IP costs a JWT verification each time.
   */
  googleSignIn: { limit: 10, windowSeconds: 300 },
  /**
   * Password-reset token redemption (the second half of the reset flow). No
   * limit here once meant a brute-force of the 256-bit token — each guess hits
   * the DB. A per-IP cap plus the one-use token keeps it honest.
   */
  passwordResetConfirm: { limit: 10, windowSeconds: 300 },
  /**
   * Logout. Low-risk (only destroys a session), but a flood wastes DB trips.
   * Generous: a real user clicking "Sign out" a few times should never see a 429.
   */
  logout: { limit: 30, windowSeconds: 300 },
  /**
   * The premium OCR tier, used only to re-extract a document the cheap tier read
   * with low confidence. Its daily allowance is roughly 125 pages, an order of
   * magnitude below the cheap tier, so this is a *budget* guard rather than an
   * abuse guard: without it one large batch of hard-to-read scans could exhaust
   * the account's premium quota for the day and degrade everyone else's results.
   *
   * A day-long window rather than an hour because the underlying quota is daily.
   * Note this is the value that forces MAX_WINDOW_SECONDS below to 86400.
   */
  ocrEscalation: {
    limit: 100,
    windowSeconds: 86400,
    message: 'Daily high-accuracy extraction limit reached. Standard extraction still works.',
  },
};

/**
 * Must be >= the largest windowSeconds above. The prune below deletes by absolute
 * age, so a horizon shorter than the longest window would delete rows that are
 * still active for a long-window route.
 */
const MAX_WINDOW_SECONDS = 86400;

/** Roughly one second in every PRUNE_EVERY also runs the cleanup. */
const PRUNE_EVERY = 50;

// ---------------------------------------------------------------------------
// In-isolate fallback, used only when the database counter is unavailable.
//
// The D1 failure path returned null -- fail open -- on the reasoning that a
// transient database problem should not take down login, signup and OCR at once.
// That reasoning still holds, but "fail open" meant every limit in the product
// vanished simultaneously for the duration, on exactly the endpoints where the
// limit is load-bearing: verifying a password is 600,000 PBKDF2 iterations, and
// /api/ocr spends real money upstream.
//
// A module-level counter is not a correct rate limiter -- Pages Functions run
// across many isolates and each keeps its own, so the effective limit is the
// configured one multiplied by however many isolates are warm. It is, however,
// bounded, which is the entire difference from unlimited. It only ever runs while
// D1 is failing.
// ---------------------------------------------------------------------------

interface LocalCounter {
  windowStart: number;
  count: number;
}

/** Bounded so a flood of distinct identities cannot grow this without limit. */
const MAX_LOCAL_BUCKETS = 5_000;
const localCounters = new Map<string, LocalCounter>();

function countLocally(bucket: string, windowStart: number): number {
  const existing = localCounters.get(bucket);
  if (existing && existing.windowStart === windowStart) {
    existing.count += 1;
    return existing.count;
  }

  // Wholesale clear rather than an eviction policy: this map only exists during a
  // database outage, and the cheapest correct answer is to start the window again.
  if (localCounters.size >= MAX_LOCAL_BUCKETS) localCounters.clear();

  localCounters.set(bucket, { windowStart, count: 1 });
  return 1;
}

/**
 * Per-IP identity. Cloudflare sets CF-Connecting-IP on every edge request and a
 * client cannot suppress it, so null here means we are not running behind the
 * edge (plain `vite dev`). Null skips the limit rather than bucketing every
 * caller under one shared key, which would let a single caller lock out the rest.
 */
export function ipIdentity(request: Request): string | null {
  const ip = clientIp(request);
  return ip ? `ip:${ip}` : null;
}

/** Preferred on authenticated routes: the account is the meaningful identity. */
export function userIdentity(userId: string): string {
  return `user:${userId}`;
}

/**
 * Counts this request and returns a 429 Response when the identity is over its
 * limit, or null when the request may proceed:
 *
 *   const limited = await enforceRateLimit(env, 'auth/login', ipIdentity(request), RULES.login);
 *   if (limited) return limited;
 */
export async function enforceRateLimit(
  env: AppEnv,
  route: string,
  identity: string | null,
  rule: RateLimitRule,
): Promise<Response | null> {
  if (!identity || !env.DB) return null;

  const nowSeconds = Math.floor(Date.now() / 1000);
  const windowStart = nowSeconds - (nowSeconds % rule.windowSeconds);
  const bucket = `${route}:${identity}`;

  let count: number;
  try {
    const row = await env.DB.prepare(
      `INSERT INTO rate_limits (bucket, window_start, count)
       VALUES (?, ?, 1)
       ON CONFLICT (bucket, window_start)
         DO UPDATE SET count = count + 1
       RETURNING count`,
    )
      .bind(bucket, windowStart)
      .first<{ count: number }>();
    count = row?.count ?? 1;
  } catch (error) {
    // Degrade, loudly, rather than disappear. Failing fully closed would turn a
    // transient database problem into a total outage of login, signup and OCR at
    // once; failing fully open removed every limit in the product at the same
    // moment. The in-isolate counter is the middle: still bounded, just looser.
    console.error(
      `[rate-limit] database counter failed for ${route}; falling back to the in-isolate counter:`,
      error,
    );
    count = countLocally(bucket, windowStart);
  }

  if (count > rule.limit) {
    const retryAfter = Math.max(1, windowStart + rule.windowSeconds - nowSeconds);
    return json(
      { error: rule.message ?? 'Too many requests. Wait a moment and try again.' },
      429,
      { 'Retry-After': String(retryAfter) },
    );
  }

  // Opportunistic cleanup, mirroring how resolveSession() drops expired rows on
  // sight, so the table self-cleans without a scheduled job.
  if (nowSeconds % PRUNE_EVERY === 0) {
    try {
      await env.DB.prepare(`DELETE FROM rate_limits WHERE window_start < ?`)
        .bind(nowSeconds - MAX_WINDOW_SECONDS * 2)
        .run();
    } catch (error) {
      console.error('[rate-limit] prune failed:', error);
    }
  }

  return null;
}
