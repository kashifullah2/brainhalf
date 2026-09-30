/**
 * Fixed-window rate limiting, shared by the Worker's HTTP gates and the
 * Durable Object's generation gate.
 *
 * Both need the same thing — a per-key counter that resets when its window
 * expires — and both were carrying their own copy. State is module-scoped per
 * limiter instance and therefore per-isolate: in a Workers deployment an
 * isolate is one of many, so a limit is an upper bound on *this* isolate's
 * share of a user's traffic, not a global one. That is the same approximation
 * the Worker already accepted for its auth and model-test buckets, and it is
 * the right one here: the point is to stop one client from saturating a
 * generation path, not to bill usage.
 */

export interface RateLimitConfig {
  limit: number;
  windowMs: number;
}

export interface RateLimitResult {
  ok: boolean;
  /** Seconds until the window resets, when the limit is exceeded. */
  retryAfter: number;
}

interface RateWindow {
  count: number;
  resetAt: number;
}

/** A limiter stops growing once it holds this many windows. */
const MAX_TRACKED_WINDOWS = 5_000;

/**
 * Applied when `check` is called with a bucket that was never configured.
 * Failing closed is deliberate: an unknown bucket is always a programming
 * error (a typo'd or drifted bucket name), and silently allowing unlimited
 * requests would remove the gate entirely. The denial is loud — every call
 * gets a 429-style refusal — so the misconfiguration surfaces immediately
 * instead of quietly disabling protection.
 */
const UNKNOWN_BUCKET_CONFIG: RateLimitConfig = { limit: 0, windowMs: 60_000 };

export class RateLimiter {
  private readonly windows = new Map<string, RateWindow>();

  constructor(private readonly configs: Record<string, RateLimitConfig>) {}

  check(bucket: string, key: string): RateLimitResult {
    const config = this.configs[bucket] ?? UNKNOWN_BUCKET_CONFIG;
    const now = Date.now();
    const mapKey = `${bucket}:${key}`;
    let window = this.windows.get(mapKey);

    if (!window || window.resetAt <= now) {
      window = { count: 0, resetAt: now + config.windowMs };
      this.windows.set(mapKey, window);
      // Opportunistic sweep so the map cannot grow without bound in a
      // long-lived isolate.
      if (this.windows.size > MAX_TRACKED_WINDOWS) {
        for (const [k, v] of this.windows) if (v.resetAt <= now) this.windows.delete(k);
      }
    }

    window.count++;
    if (window.count > config.limit) {
      return { ok: false, retryAfter: Math.ceil((window.resetAt - now) / 1000) };
    }
    return { ok: true, retryAfter: 0 };
  }

  /** For tests and diagnostics: how many windows are currently tracked. */
  get size(): number {
    return this.windows.size;
  }
}
