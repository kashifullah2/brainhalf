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

export class RateLimiter {
  private readonly windows = new Map<string, RateWindow>();

  constructor(private readonly configs: Record<string, RateLimitConfig>) {}

  check(bucket: string, key: string): RateLimitResult {
    const config = this.configs[bucket];
    if (!config) return { ok: true, retryAfter: 0 };
    const now = Date.now();
    const mapKey = `${bucket}:${key}`;
    const existing = this.windows.get(mapKey);

    if (!existing || existing.resetAt <= now) {
      this.windows.set(mapKey, { count: 1, resetAt: now + config.windowMs });
      // Opportunistic sweep so the map cannot grow without bound in a
      // long-lived isolate.
      if (this.windows.size > MAX_TRACKED_WINDOWS) {
        for (const [k, v] of this.windows) if (v.resetAt <= now) this.windows.delete(k);
      }
      return { ok: true, retryAfter: 0 };
    }

    existing.count++;
    if (existing.count > config.limit) {
      return { ok: false, retryAfter: Math.ceil((existing.resetAt - now) / 1000) };
    }
    return { ok: true, retryAfter: 0 };
  }

  /** For tests and diagnostics: how many windows are currently tracked. */
  get size(): number {
    return this.windows.size;
  }
}
