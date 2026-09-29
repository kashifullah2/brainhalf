/**
 * Tiny fixed-window rate limiter for the public preview backend routes.
 *
 * State lives in the Durable Object instance's memory (per project), so no
 * coordination is needed. Buckets are pruned opportunistically to bound
 * memory. This is abuse friction, not a billing control: the platform's own
 * CPU/rate limits remain the hard backstop.
 */
export class FixedWindowRateLimiter {
  private buckets = new Map<string, { count: number; resetAt: number }>();
  private prunes = 0;

  constructor(private readonly maxBuckets = 2000) {}

  /**
   * Records one hit for `key` and reports whether it is within `limit` hits
   * per `windowMs` window.
   */
  check(key: string, limit: number, windowMs: number): { allowed: boolean; retryAfterMs: number } {
    const now = Date.now();
    this.prunes++;
    if (this.prunes % 50 === 0) this.prune(now);

    let bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      this.buckets.set(key, bucket);
    }
    bucket.count += 1;
    return {
      allowed: bucket.count <= limit,
      retryAfterMs: Math.max(0, bucket.resetAt - now),
    };
  }

  /** Current number of live buckets (exposed for tests/monitoring). */
  size(): number {
    return this.buckets.size;
  }

  private prune(now: number): void {
    if (this.buckets.size <= this.maxBuckets) {
      for (const [k, b] of this.buckets) {
        if (b.resetAt <= now) this.buckets.delete(k);
      }
      return;
    }
    // Over capacity: drop expired buckets first, then oldest by reset time.
    const entries = [...this.buckets.entries()].sort((a, b) => a[1].resetAt - b[1].resetAt);
    const drop = entries.length - this.maxBuckets;
    for (let i = 0; i < drop; i++) this.buckets.delete(entries[i][0]);
  }
}
