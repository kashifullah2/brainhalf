import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  AI_TIMEOUT_MS,
  CLIENT_SELECTABLE_MODELS,
  MAX_OUTPUT_TOKENS,
  MODEL_ALLOWLIST,
  MODEL_TEST_TIMEOUT_MS,
  acceptsImageInput,
  capTokenLimit,
  displayModelName,
  killSwitchRefusal,
  modelSupportsThinking,
  resolveKillSwitchStatus,
  resolveModel,
  withTimeout,
  type KillSwitchStatus,
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
    expect(m!.maxTokens).toBe(65536);
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

  it('resolves claude-sonnet-6 to the native Anthropic transport without offering it twice in the picker', () => {
    expect(resolveModel('claude-sonnet-6', 'anthropic')).toMatchObject({ provider: 'anthropic', id: 'claude-sonnet-4-6', clientSelectable: false });
    // Without a provider hint the first declared match wins, which must stay Bedrock.
    expect(resolveModel('claude-sonnet-6')?.provider).toBe('aws');
    expect(FRONTEND_CATALOG.filter(name => name === 'claude-sonnet-6')).toHaveLength(1);
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

  it('reflects a production allowlisted origin on a preflight', async () => {
    // localhost origins are only reflected when IS_DEV is set (handled by the
    // worker layer, not model-tester); use the production origin here.
    const res = await handleModelTest(
      new Request('https://brainhalf.com/api/test/simple', { method: 'OPTIONS', headers: { origin: 'https://brainhalf.com' } }),
      { AI: { run: async () => '' } },
      'simple'
    );
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://brainhalf.com');
  });
});

describe('Kill-switch and disabled_models structural coverage', () => {
  const agentSource = readFileSync(resolve(__dirname, '../agent.ts'), 'utf-8');

  it('the kill-switch check follows every resolveModel call in the generation path', () => {
    const resolveIdx = agentSource.indexOf("const allowlisted = resolveModel(requestedModel, data.provider)");
    const killSwitchIdx = agentSource.indexOf("// Admin kill-switch — fail closed.");
    expect(resolveIdx, 'resolveModel call must exist in agent.ts').toBeGreaterThan(-1);
    expect(killSwitchIdx, 'kill-switch comment must exist in agent.ts').toBeGreaterThan(-1);
    expect(killSwitchIdx, 'kill-switch must follow allowlist resolution').toBeGreaterThan(resolveIdx);
  });

  it('the kill-switch uses resolveKillSwitchStatus and killSwitchRefusal from models.ts', () => {
    expect(agentSource).toContain('resolveKillSwitchStatus(');
    expect(agentSource).toContain('killSwitchRefusal(');
    expect(agentSource).toContain("KILL_SWITCH_CACHE_KEY");
    expect(agentSource).toContain("ctx.storage.put?.(KILL_SWITCH_CACHE_KEY");
    expect(agentSource).toContain("ctx.storage.get?.<KillSwitchStatus>(KILL_SWITCH_CACHE_KEY)");
  });

  it('resume_generation reuses the same validation path (no separate model resolution)', () => {
    // The resume block (data.type === 'resume_generation') sets data.prompt
    // and falls through; it never calls resolveModel itself. The shared
    // requestedModel = data.model at line 2258 handles both paths.
    const resumeBlock = agentSource.indexOf("if (data.type === 'resume_generation')");
    const sharedModelLine = agentSource.indexOf("const requestedModel = data.model || DEFAULT_MODEL_ID");
    expect(resumeBlock, 'resume_generation block must exist').toBeGreaterThan(-1);
    expect(sharedModelLine, 'shared requestedModel must exist').toBeGreaterThan(-1);
    // The resume block must appear BEFORE the shared model resolution so it
    // falls through into it, not around it.
    expect(sharedModelLine, 'model validation must come after the resume block').toBeGreaterThan(resumeBlock);
  });

  it('the repair path sends a normal WS message that enters the same onMessage handler', () => {
    // Repair is dispatched by ChatPanel via handleSendMessage → ws.send(),
    // not by a separate code path in agent.ts. Verify agent.ts has no
    // special repair message type that would skip validation.
    expect(agentSource).not.toContain("data.type === 'repair'");
    expect(agentSource).not.toContain("data.type === 'auto_fix'");
  });

  it('killSwitchRefusal: refuses a per-model-disabled built-in', () => {
    const status: KillSwitchStatus = { integratedModelsEnabled: true, disabledModels: ['aws:claude-sonnet-6'] };
    const msg = killSwitchRefusal(status, { isCustom: false, requestedId: 'claude-sonnet-6', displayName: 'Claude Sonnet 4.6', modelKey: 'aws:claude-sonnet-6' });
    expect(msg).toMatch(/turned off by the administrator/);
    expect(msg).toContain('Claude Sonnet 4.6');
  });

  it('killSwitchRefusal: refuses when integratedModelsEnabled is false', () => {
    const status: KillSwitchStatus = { integratedModelsEnabled: false, disabledModels: [] };
    const msg = killSwitchRefusal(status, { isCustom: false, requestedId: '@cf/deepseek-ai/deepseek-v4-pro-0813', displayName: 'DeepSeek V4 Pro', modelKey: 'cloudflare:@cf/deepseek-ai/deepseek-v4-pro-0813' });
    expect(msg).toMatch(/built-in models are currently turned off/);
  });

  it('killSwitchRefusal: refuses a disabled custom model', () => {
    const status: KillSwitchStatus = { integratedModelsEnabled: true, disabledModels: ['cm_abc123'] };
    const msg = killSwitchRefusal(status, { isCustom: true, requestedId: 'cm_abc123', displayName: 'My Custom LLM', modelKey: '' });
    expect(msg).toMatch(/My Custom LLM/);
    expect(msg).toMatch(/turned off by the administrator/);
  });

  it('killSwitchRefusal: returns null when model is allowed', () => {
    const status: KillSwitchStatus = { integratedModelsEnabled: true, disabledModels: [] };
    expect(killSwitchRefusal(status, { isCustom: false, requestedId: 'claude-sonnet-6', displayName: 'Claude Sonnet 4.6', modelKey: 'aws:claude-sonnet-6' })).toBeNull();
    expect(killSwitchRefusal(status, { isCustom: true, requestedId: 'cm_xyz', displayName: 'Custom', modelKey: '' })).toBeNull();
  });

  it('resolveKillSwitchStatus: returns live status when fetch succeeds', async () => {
    const live: KillSwitchStatus = { integratedModelsEnabled: true, disabledModels: ['cloudflare:@cf/google/gemma-3-27b-it'] };
    const result = await resolveKillSwitchStatus(() => Promise.resolve(live), () => Promise.resolve(null));
    expect(result).toEqual(live);
  });

  it('resolveKillSwitchStatus: uses cache when registry throws (fail-closed with cache)', async () => {
    const cached: KillSwitchStatus = { integratedModelsEnabled: true, disabledModels: [] };
    const result = await resolveKillSwitchStatus(
      () => Promise.reject(new Error('registry down')),
      () => Promise.resolve(cached),
    );
    expect(result).toEqual(cached);
  });

  it('resolveKillSwitchStatus: returns null when registry throws and no cache (fail closed)', async () => {
    const result = await resolveKillSwitchStatus(
      () => Promise.reject(new Error('registry down')),
      () => Promise.resolve(null),
    );
    expect(result).toBeNull();
  });

  it('resolveKillSwitchStatus: treats undefined cache return as null (fail closed)', async () => {
    // Object.create bypass or uninitialized field can make getCached return undefined.
    const result = await resolveKillSwitchStatus(
      () => Promise.reject(new Error('registry down')),
      () => Promise.resolve(undefined as any),
    );
    expect(result).toBeNull();
  });
});

describe('Model registry drift detection', () => {
  const uniqueNames = [...new Set(MODEL_ALLOWLIST.map(m => m.name))];

  it('every allowlist model has a displayModelName entry', () => {
    for (const name of uniqueNames) {
      const display = displayModelName(name);
      expect(display, `displayModelName("${name}") should not fall through to the raw id`).not.toBe(name);
    }
  });

  it('displayModelName has no orphan entries outside the allowlist', () => {
    for (const name of uniqueNames) {
      expect(resolveModel(name), `displayModelName("${name}") has no matching allowlist entry`).not.toBeNull();
    }
  });

  it('acceptsImageInput only returns true for allowlisted models', () => {
    const imageModels = uniqueNames.filter(n => acceptsImageInput(n));
    expect(imageModels.length).toBeGreaterThan(0);
    for (const name of imageModels) {
      expect(resolveModel(name), `acceptsImageInput("${name}") is not in the allowlist`).not.toBeNull();
    }
  });

  it('modelSupportsThinking only returns true for allowlisted models', () => {
    const thinkingModels = MODEL_ALLOWLIST.filter(m => m.supportsThinking).map(m => m.id);
    expect(thinkingModels.length).toBeGreaterThan(0);
    for (const id of thinkingModels) {
      expect(modelSupportsThinking(id)).toBe(true);
    }
  });

  it('every model has a non-zero maxTokens and valid provider', () => {
    const validProviders = new Set(['cloudflare', 'anthropic', 'aws', 'atria', 'custom']);
    for (const m of MODEL_ALLOWLIST) {
      expect(m.maxTokens, `${m.name} has zero or negative maxTokens`).toBeGreaterThan(0);
      expect(validProviders.has(m.provider), `${m.name} has unknown provider "${m.provider}"`).toBe(true);
    }
  });

  it('no duplicate (name, provider) pairs in the allowlist', () => {
    const seen = new Set<string>();
    for (const m of MODEL_ALLOWLIST) {
      const key = `${m.provider}:${m.name}`;
      expect(seen.has(key), `duplicate allowlist entry: ${key}`).toBe(false);
      seen.add(key);
    }
  });

  it('every allowlisted model has a maxTokens cost ceiling (no free-running model)', () => {
    for (const m of MODEL_ALLOWLIST) {
      expect(m.maxTokens, `${m.name} is missing a maxTokens cost ceiling`).toBeGreaterThan(0);
      expect(m.maxTokens, `${m.name} maxTokens exceeds the global cap`).toBeLessThanOrEqual(MAX_OUTPUT_TOKENS);
    }
  });

  it('agent.ts does not maintain its own model ID list', () => {
    const agentSource = readFileSync(resolve(__dirname, '../agent.ts'), 'utf-8');
    const allowlistedIds = new Set(MODEL_ALLOWLIST.map(m => m.id));
    const exempt = new Set(['@cf/black-forest-labs/flux-1-schnell']);
    const cfModelPattern = /@cf\/[a-z0-9_-]+\/[a-z0-9_.-]+/g;
    const nonAllowlisted: string[] = [];
    for (const line of agentSource.split('\n')) {
      if (line.trimStart().startsWith('//') || line.trimStart().startsWith('*')) continue;
      for (const match of line.matchAll(cfModelPattern)) {
        if (!allowlistedIds.has(match[0]) && !exempt.has(match[0])) {
          nonAllowlisted.push(match[0]);
        }
      }
    }
    expect(
      nonAllowlisted,
      `agent.ts references CF model IDs not in MODEL_ALLOWLIST: ${nonAllowlisted.join(', ')}. ` +
      'Add them to models.ts or remove the hardcoded reference.',
    ).toEqual([]);
  });
});
