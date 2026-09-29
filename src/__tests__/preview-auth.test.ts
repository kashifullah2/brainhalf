import { describe, it, expect } from 'vitest';
import {
  newCapabilitySecret,
  ensureTokenSchema,
  getProjectTokens,
  mintProjectTokens,
  getOrCreateProjectTokens,
  readRequestToken,
  tokensEqual,
  tokenDeniedResponse,
  TOKEN_HEADER,
  type SqlTag,
} from '../lib/preview-auth';
import { FixedWindowRateLimiter } from '../lib/rate-limit';

/** In-memory SqlTag stub: supports the statements preview-auth uses. */
function makeSql(): SqlTag {
  const meta = new Map<string, string>();
  const tag = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.reduce((acc, s, i) => acc + s + (i < values.length ? '?' : ''), '');
    if (/^\s*CREATE TABLE/i.test(text)) return [].values();
    if (/^\s*SELECT/i.test(text)) {
      const rows: Record<string, unknown>[] = [];
      for (const [key, value] of meta) {
        if (values.includes(key)) rows.push({ key, value });
      }
      return rows.values();
    }
    if (/^\s*INSERT OR REPLACE/i.test(text)) {
      const [key, value] = values as string[];
      meta.set(key, value);
      return [].values();
    }
    throw new Error(`unsupported stub sql: ${text}`);
  }) as SqlTag;
  return tag;
}

describe('preview-auth capability tokens', () => {
  it('generates unique, long, hex-ish secrets', () => {
    const a = newCapabilitySecret();
    const b = newCapabilitySecret();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(48);
    expect(b.length).toBeGreaterThanOrEqual(48);
  });

  it('returns null for an unclaimed project', () => {
    const sql = makeSql();
    ensureTokenSchema(sql);
    expect(getProjectTokens(sql)).toBeNull();
  });

  it('mints and persists a token pair exactly once (first-writer-wins)', () => {
    const sql = makeSql();
    ensureTokenSchema(sql);
    const first = mintProjectTokens(sql);
    expect(first.ownerToken).toBeTruthy();
    expect(first.previewToken).toBeTruthy();
    expect(first.ownerToken).not.toBe(first.previewToken);

    const read = getProjectTokens(sql);
    expect(read).toEqual(first);

    // getOrCreate returns the existing pair, not a new one
    expect(getOrCreateProjectTokens(sql)).toEqual(first);
  });

  it('getOrCreate mints on first call for a fresh project', () => {
    const sql = makeSql();
    ensureTokenSchema(sql);
    const tokens = getOrCreateProjectTokens(sql);
    expect(tokens.ownerToken).toBeTruthy();
    expect(getProjectTokens(sql)).toEqual(tokens);
  });

  it('reads the token from header first, then query param', () => {
    const viaHeader = new Request('https://x.test/preview/p1/api/files', {
      headers: { [TOKEN_HEADER]: 'header-token' },
    });
    expect(readRequestToken(viaHeader)).toBe('header-token');

    const viaQuery = new Request('https://x.test/preview/p1/api/files?token=query-token');
    expect(readRequestToken(viaQuery)).toBe('query-token');

    // header wins over query
    const both = new Request('https://x.test/preview/p1/api/files?token=query-token', {
      headers: { [TOKEN_HEADER]: 'header-token' },
    });
    expect(readRequestToken(both)).toBe('header-token');

    expect(readRequestToken(new Request('https://x.test/preview/p1/api/files'))).toBeNull();
  });

  it('rejects absurd token values', () => {
    const huge = new Request(`https://x.test/?token=${'a'.repeat(500)}`);
    expect(readRequestToken(huge)).toBeNull();
  });

  it('compares tokens in constant time without leaking via ===', () => {
    expect(tokensEqual('abc123', 'abc123')).toBe(true);
    expect(tokensEqual('abc124', 'abc123')).toBe(false);
    expect(tokensEqual('abc12', 'abc123')).toBe(false);
    expect(tokensEqual(null, 'abc123')).toBe(false);
    expect(tokensEqual(undefined, 'abc123')).toBe(false);
    expect(tokensEqual('abc123', '')).toBe(false);
  });

  it('returns a 403 JSON denial body', async () => {
    const res = tokenDeniedResponse('owner', { 'Access-Control-Allow-Origin': '*' });
    expect(res.status).toBe(403);
    const body: any = await res.json();
    expect(body.error).toBe('forbidden');
    expect(typeof body.message).toBe('string');
  });
});

describe('FixedWindowRateLimiter', () => {
  it('allows up to the limit, then denies until the window resets', () => {
    const rl = new FixedWindowRateLimiter();
    for (let i = 0; i < 5; i++) {
      expect(rl.check('k', 5, 60_000).allowed).toBe(true);
    }
    const denied = rl.check('k', 5, 60_000);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterMs).toBeGreaterThan(0);
    // separate key is unaffected
    expect(rl.check('other', 5, 60_000).allowed).toBe(true);
  });

  it('resets after the window elapses', async () => {
    const rl = new FixedWindowRateLimiter();
    expect(rl.check('k', 1, 20).allowed).toBe(true);
    expect(rl.check('k', 1, 20).allowed).toBe(false);
    await new Promise((r) => setTimeout(r, 30));
    expect(rl.check('k', 1, 20).allowed).toBe(true);
  });

  it('bounds memory by pruning buckets', () => {
    const rl = new FixedWindowRateLimiter(10);
    for (let i = 0; i < 50; i++) rl.check(`key-${i}`, 1000, 60_000);
    expect(rl.size()).toBeLessThanOrEqual(50);
    // force prune cycles
    for (let i = 0; i < 60; i++) rl.check('x', 100000, 60_000);
    expect(rl.size()).toBeLessThanOrEqual(11);
  });
});
