import { describe, expect, it } from 'vitest';

import type { AppEnv } from './http';
import { RULES, enforceRateLimit, ipIdentity, userIdentity } from './rate-limit';

// rate-limit.ts had no tests, on the code standing between an anonymous caller and
// 600,000 PBKDF2 iterations per request.

function countingEnv(): AppEnv {
  // Mimics the real INSERT ... ON CONFLICT DO UPDATE ... RETURNING count.
  const counts = new Map<string, number>();
  const make = (args: unknown[]): Record<string, unknown> => ({
    bind: (...next: unknown[]) => make(next),
    first: async () => {
      const key = `${String(args[0])}|${String(args[1])}`;
      const next = (counts.get(key) ?? 0) + 1;
      counts.set(key, next);
      return { count: next };
    },
    run: async () => ({ success: true, meta: { changes: 0 } }),
  });
  return { DB: { prepare: () => make([]) } } as unknown as AppEnv;
}

function failingEnv(): AppEnv {
  const make = (): Record<string, unknown> => ({
    bind: () => make(),
    first: async () => {
      throw new Error('D1 is unavailable');
    },
    run: async () => {
      throw new Error('D1 is unavailable');
    },
  });
  return { DB: { prepare: () => make() } } as unknown as AppEnv;
}

const RULE = { limit: 3, windowSeconds: 60 };

describe('enforceRateLimit', () => {
  it('allows requests up to the limit and refuses the next one', async () => {
    const env = countingEnv();
    for (let i = 0; i < RULE.limit; i++) {
      expect(await enforceRateLimit(env, 'test', 'ip:1.2.3.4', RULE)).toBeNull();
    }
    const limited = await enforceRateLimit(env, 'test', 'ip:1.2.3.4', RULE);
    expect(limited).toBeInstanceOf(Response);
    expect(limited!.status).toBe(429);
    // A client needs to know how long to wait, not just that it was refused.
    expect(Number(limited!.headers.get('Retry-After'))).toBeGreaterThan(0);
  });

  it('keeps identities independent, so one caller cannot lock out the rest', async () => {
    const env = countingEnv();
    for (let i = 0; i < RULE.limit + 2; i++) {
      await enforceRateLimit(env, 'test', 'ip:1.1.1.1', RULE);
    }
    expect(await enforceRateLimit(env, 'test', 'ip:9.9.9.9', RULE)).toBeNull();
  });

  it('keeps routes independent, so hammering OCR cannot block signing in', async () => {
    const env = countingEnv();
    for (let i = 0; i < RULE.limit + 2; i++) {
      await enforceRateLimit(env, 'ocr', 'ip:1.1.1.1', RULE);
    }
    expect(await enforceRateLimit(env, 'auth/login', 'ip:1.1.1.1', RULE)).toBeNull();
  });

  it('skips the limit when there is no identity to attribute it to', async () => {
    // Null means we are not behind the edge. Bucketing every caller under one
    // shared key would let a single client lock out everyone else.
    const env = countingEnv();
    for (let i = 0; i < 50; i++) {
      expect(await enforceRateLimit(env, 'test', null, RULE)).toBeNull();
    }
  });

  it('still bounds a caller when the database counter is unavailable', async () => {
    // This used to fail fully open: a D1 blip removed every limit in the product
    // at once, including on the endpoints that cost CPU and money.
    const env = failingEnv();
    const identity = `ip:fallback-${Math.random()}`;
    let refused = false;
    for (let i = 0; i < RULE.limit + 3; i++) {
      if ((await enforceRateLimit(env, 'test', identity, RULE)) !== null) refused = true;
    }
    expect(refused).toBe(true);
  });
});

describe('identities', () => {
  it('namespaces users and IPs so they cannot collide', () => {
    expect(userIdentity('usr_1')).toBe('user:usr_1');
    expect(ipIdentity(new Request('https://x.test', { headers: { 'CF-Connecting-IP': '1.2.3.4' } }))).toBe(
      'ip:1.2.3.4',
    );
  });

  it('returns null off the edge, where no client IP is supplied', () => {
    expect(ipIdentity(new Request('https://x.test'))).toBeNull();
  });
});

describe('RULES', () => {
  it('gives the premium OCR tier a much tighter budget than the default tier', () => {
    // The premium daily allowance is roughly a tenth of the cheap one, so one
    // large batch of hard scans must not be able to exhaust it.
    expect(RULES.ocrEscalation.limit).toBeLessThan(RULES.ocr.limit);
    expect(RULES.ocrEscalation.message).toBeTruthy();
  });

  it('never lets a window exceed the prune horizon', () => {
    // A window longer than the prune horizon would have its rows deleted while
    // still active, silently resetting the limit.
    for (const rule of Object.values(RULES)) {
      expect(rule.windowSeconds).toBeLessThanOrEqual(86400);
    }
  });
});
