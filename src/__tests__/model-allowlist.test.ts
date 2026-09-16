import { describe, it, expect } from 'vitest';
import {
  AI_TIMEOUT_MS,
  MAX_OUTPUT_TOKENS,
  MODEL_ALLOWLIST,
  MODEL_TEST_TIMEOUT_MS,
  capTokenLimit,
  resolveModel,
  withTimeout,
} from '../lib/models';
import { handleModelTest } from '../lib/model-tester';

/** The catalog the frontend offers in ChatPanel.tsx — the allowlist must cover it. */
const FRONTEND_CATALOG = [
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  '@cf/openai/gpt-oss-20b',
  '@cf/meta/llama-4-scout-17b-16e-instruct',
  '@cf/openai/gpt-oss-120b',
  '@cf/moonshotai/kimi-k2.7-code',
  '@cf/qwen/qwen2.5-coder-32b-instruct',
  '@cf/qwen/qwen3.8-27b',
  'claude-sonnet-4.6',
  'claude-opus-4.6',
  'minimax-m2.5',
];

describe('P2 Model allowlist — exact match, no substring dispatch', () => {
  it('covers every model the frontend catalog offers', () => {
    for (const id of FRONTEND_CATALOG) {
      expect(resolveModel(id), `frontend model ${id} must be allowlisted`).not.toBeNull();
    }
  });

  it('resolves a cloudflare model to its binding id and ceiling', () => {
    const m = resolveModel('@cf/openai/gpt-oss-20b', 'cloudflare');
    expect(m).not.toBeNull();
    expect(m!.provider).toBe('cloudflare');
    expect(m!.id).toBe('@cf/openai/gpt-oss-20b');
    expect(m!.maxTokens).toBeGreaterThan(0);
  });

  it('disambiguates an anthropic-family model by the provider hint', () => {
    expect(resolveModel('claude-sonnet-4.6', 'anthropic')?.id).toBe('claude-sonnet-4-6');
    expect(resolveModel('claude-sonnet-4.6', 'aws')?.id).toBe('us.anthropic.claude-sonnet-4-6-v1:0');
    // Without a hint the first declared match still resolves.
    expect(resolveModel('claude-sonnet-4.6')).not.toBeNull();
  });

  it('rejects unknown, prefix-extended and suffix-extended ids', () => {
    expect(resolveModel('@cf/meta/llama-3.3-70b-instruct-fp8-fast.evil.example')).toBeNull();
    expect(resolveModel('evil.example/@cf/meta/llama-3.3-70b-instruct-fp8-fast')).toBeNull();
    expect(resolveModel('@cf/anything-not-listed')).toBeNull();
    expect(resolveModel('claude-sonnet-4.6-evil')).toBeNull();
    expect(resolveModel('not-a-model')).toBeNull();
    expect(resolveModel('')).toBeNull();
    expect(resolveModel(null)).toBeNull();
    expect(resolveModel(undefined)).toBeNull();
  });

  it('never matches on a substring: "sonnet"/"opus"/"claude-" alone do not qualify', () => {
    // The old dispatch accepted any id containing these tokens.
    expect(resolveModel('sonnet')).toBeNull();
    expect(resolveModel('opus')).toBeNull();
    expect(resolveModel('claude-')).toBeNull();
    expect(resolveModel('my-claude-sonnet-model')).toBeNull();
  });

  it('exposes the allowlist so an API can echo it to the caller', () => {
    expect(MODEL_ALLOWLIST.length).toBeGreaterThanOrEqual(FRONTEND_CATALOG.length);
    expect(MODEL_ALLOWLIST.map((m) => m.name)).toEqual(expect.arrayContaining(FRONTEND_CATALOG));
  });
});

describe('P2 Token limits — server-side cap', () => {
  it('clamps an oversized client request to the server ceiling', () => {
    const m = resolveModel('@cf/openai/gpt-oss-20b', 'cloudflare')!;
    expect(capTokenLimit(1_000_000, m)).toBe(MAX_OUTPUT_TOKENS);
    expect(capTokenLimit(Infinity, m)).toBe(MAX_OUTPUT_TOKENS);
  });

  it('honours a smaller client request and never the model ceiling', () => {
    const m = resolveModel('@cf/openai/gpt-oss-20b', 'cloudflare')!;
    expect(capTokenLimit(512, m)).toBe(512);
  });

  it('falls back to the model ceiling when the client sends nothing usable', () => {
    const m = resolveModel('claude-sonnet-4.6', 'anthropic')!;
    expect(capTokenLimit(undefined, m)).toBe(m.maxTokens);
    expect(capTokenLimit(null, m)).toBe(m.maxTokens);
    expect(capTokenLimit(0, m)).toBe(m.maxTokens);
    expect(capTokenLimit(-1, m)).toBe(m.maxTokens);
    expect(capTokenLimit(NaN, m)).toBe(m.maxTokens);
  });

  it('never returns a value above MAX_OUTPUT_TOKENS', () => {
    for (const m of MODEL_ALLOWLIST) {
      expect(capTokenLimit(10 ** 9, m)).toBeLessThanOrEqual(MAX_OUTPUT_TOKENS);
    }
  });
});

describe('P2 Outbound AI timeouts', () => {
  it('resolves with the underlying value when the call is fast enough', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 2000, 'fast-call')).resolves.toBe('ok');
  });

  it('rejects when the call outlives the deadline', async () => {
    const slow = new Promise((resolve) => setTimeout(resolve, 3000));
    await expect(withTimeout(slow as Promise<any>, 60, 'slow-call')).rejects.toThrow(/slow-call exceeded/);
  });

  it('uses sane, finite ceilings for generation and benchmark calls', () => {
    expect(AI_TIMEOUT_MS).toBeGreaterThan(60_000);
    expect(MODEL_TEST_TIMEOUT_MS).toBeGreaterThan(60_000);
    expect(MODEL_TEST_TIMEOUT_MS).toBeLessThanOrEqual(AI_TIMEOUT_MS);
  });
});

describe('P2 /api/test/* endpoint hardening', () => {
  it('rejects a non-allowlisted model with 400 and the list of allowed models', async () => {
    const res = await handleModelTest(
      new Request('https://brainhalf.com/api/test/simple?model=@cf/totally/fake-model'),
      { AI: { run: async () => '' } },
      'simple'
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/not in the model allowlist/);
    expect(body.allowedModels).toEqual(expect.arrayContaining(FRONTEND_CATALOG));
  });

  it('returns 400 with usage guidance when no model is given', async () => {
    const res = await handleModelTest(
      new Request('https://brainhalf.com/api/test/simple'),
      { AI: { run: async () => '' } },
      'simple'
    );
    expect(res.status).toBe(400);
    expect((await res.json()).usage).toMatch(/\/api\/test\/simple/);
  });

  it('reports a model-side failure with 502, not a masked 200', async () => {
    // A binding that yields no content stands in for a failed/empty model run.
    const res = await handleModelTest(
      new Request('https://brainhalf.com/api/test/simple?model=@cf/openai/gpt-oss-20b'),
      { AI: { run: async () => '' } },
      'simple'
    );
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBeTruthy();
  });

  it('answers a preflight without ever reflecting a wildcard origin', async () => {
    const res = await handleModelTest(
      new Request('https://brainhalf.com/api/test/simple', { method: 'OPTIONS', headers: { origin: 'https://evil.example' } }),
      { AI: { run: async () => '' } },
      'simple'
    );
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://brainhalf.com');
    expect(res.headers.get('Vary')).toBe('Origin');
  });

  it('reflects an allowlisted origin on a preflight', async () => {
    const res = await handleModelTest(
      new Request('https://brainhalf.com/api/test/simple', { method: 'OPTIONS', headers: { origin: 'http://localhost:5173' } }),
      { AI: { run: async () => '' } },
      'simple'
    );
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
  });
});
