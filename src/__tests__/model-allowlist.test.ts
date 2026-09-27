import { describe, it, expect } from 'vitest';
import {
  AI_TIMEOUT_MS,
  CLIENT_SELECTABLE_MODELS,
  MAX_OUTPUT_TOKENS,
  MODEL_ALLOWLIST,
  MODEL_TEST_TIMEOUT_MS,
  capTokenLimit,
  resolveModel,
  withTimeout,
} from '../lib/models';
import { handleModelTest } from '../lib/model-tester';

/**
 * The catalog the frontend offers in ChatPanel.tsx. It is derived from
 * CLIENT_SELECTABLE_MODELS, so this test is a contract on the one list rather
 * than a second copy that can drift out of sync with it.
 */
const FRONTEND_CATALOG = CLIENT_SELECTABLE_MODELS.map((m) => m.name);

describe('P2 Model allowlist — exact match, no substring dispatch', () => {
  it('rejects a model whose provider differs from the requested provider', () => {
    expect(resolveModel('claude-sonnet-6', 'cloudflare')).toBeNull();
    expect(resolveModel('@cf/qwen/qwen3.8-27b', 'aws')).toBeNull();
  });
  it('covers every model the frontend catalog offers', () => {
    for (const id of FRONTEND_CATALOG) {
      expect(resolveModel(id), `frontend model ${id} must be allowlisted`).not.toBeNull();
    }
  });

  it('resolves a cloudflare model to its binding id and ceiling', () => {
    const m = resolveModel('@cf/openai/gpt-oss-120b', 'cloudflare');
    expect(m).not.toBeNull();
    expect(m!.provider).toBe('cloudflare');
    expect(m!.id).toBe('@cf/openai/gpt-oss-120b');
    expect(m!.maxTokens).toBeGreaterThan(0);
  });

  it('resolves an atria model to its id and ceiling', () => {
    const m = resolveModel('Atria-Dawn-Preview', 'atria');
    expect(m).not.toBeNull();
    expect(m!.provider).toBe('atria');
    expect(m!.id).toBe('Atria-Dawn-Preview');
    expect(m!.maxTokens).toBe(64000);
  });

  it('resolves GLM 5.3 Flash server-side but does not offer it in the picker', () => {
    const id = '@cf/zai-org/glm-5.3-flash';
    // Disabled in picker (times out on all generation levels) but still resolvable
    // so saved sessions that previously used it do not get a hard error.
    expect(FRONTEND_CATALOG).not.toContain(id);
    expect(resolveModel(id, 'cloudflare')).toMatchObject({ id, provider: 'cloudflare', maxTokens: 8192, clientSelectable: false });
    expect(resolveModel(id, 'aws')).toBeNull();
    expect(resolveModel('@cf/zai-org/glm-5.3')).toBeNull();
  });

  it('resolves claude-sonnet-6 to the configured AWS Bedrock model', () => {
    expect(resolveModel('claude-sonnet-6', 'aws')?.id).toBe('us.anthropic.claude-sonnet-4-6');
    expect(resolveModel('claude-sonnet-6')).not.toBeNull();
  });

  it('rejects unknown, prefix-extended and suffix-extended ids', () => {
    expect(resolveModel('@cf/openai/gpt-oss-120b.evil.example')).toBeNull();
    expect(resolveModel('evil.example/@cf/openai/gpt-oss-120b')).toBeNull();
    expect(resolveModel('@cf/anything-not-listed')).toBeNull();
    expect(resolveModel('claude-sonnet-6-evil')).toBeNull();
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

  it('offers only ids the server will resolve', () => {
    // The picker derives from the allowlist, so a selectable entry that does not
    // resolve would be a button that always errors.
    for (const m of CLIENT_SELECTABLE_MODELS) {
      expect(resolveModel(m.name, m.provider), `${m.provider}/${m.name} must resolve`).not.toBeNull();
    }
  });

  it('offers Cloudflare DeepSeek V4 Pro and rejects the removed Dahl MiniMax model', () => {
    const offered = new Set(FRONTEND_CATALOG);
    expect(offered.has('claude-sonnet-4.6')).toBe(false);
    expect(offered.has('@cf/deepseek-ai/deepseek-v4-pro-0813')).toBe(true);
    expect(resolveModel('@cf/deepseek-ai/deepseek-v4-pro-0813', 'cloudflare')?.id).toBe('@cf/deepseek-ai/deepseek-v4-pro-0813');
    expect(offered.has('MiniMaxAI/MiniMax-M2.7')).toBe(false);
    expect(resolveModel('MiniMaxAI/MiniMax-M2.7')).toBeNull();
  });

  it('resolves kimi-k3 to the official AWS Bedrock cross-region model ID', () => {
    const m = resolveModel('kimi-k3', 'aws');
    expect(m).not.toBeNull();
    expect(m?.id).toBe('us.moonshotai.kimi-k3');
    expect(m?.provider).toBe('aws');
  });
});

describe('P2 Token limits — server-side cap', () => {
  it('returns whole positive token budgets and caps defaults at the global ceiling', () => {
    const model = resolveModel('claude-sonnet-6', 'aws')!;
    expect(capTokenLimit(42.9, model)).toBe(42);
    expect(capTokenLimit(0.1, model)).toBe(1);
    expect(capTokenLimit(undefined, { ...model, maxTokens: MAX_OUTPUT_TOKENS * 2 })).toBe(MAX_OUTPUT_TOKENS);
  });
  it('clamps an oversized client request to the server ceiling', () => {
    const m = resolveModel('@cf/openai/gpt-oss-120b', 'cloudflare')!;
    expect(capTokenLimit(1_000_000, m)).toBe(MAX_OUTPUT_TOKENS);
    expect(capTokenLimit(Infinity, m)).toBe(MAX_OUTPUT_TOKENS);
  });

  it('honours a smaller client request and never the model ceiling', () => {
    const m = resolveModel('@cf/openai/gpt-oss-120b', 'cloudflare')!;
    expect(capTokenLimit(512, m)).toBe(512);
  });

  it('falls back to the model ceiling when the client sends nothing usable', () => {
    const m = resolveModel('claude-sonnet-6', 'aws')!;
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
      new Request('https://brainhalf.com/api/test/simple?model=@cf/openai/gpt-oss-120b'),
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
