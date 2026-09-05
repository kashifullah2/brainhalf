import { describe, it, expect } from 'vitest';
import { resolveProviderChain, resolveDefaultProvider, resolvePlatformProviderOptions } from './ai-providers';
import type { Env } from '../env';

function mockEnv(overrides: Partial<Env>): Env {
  return {
    DB: {} as D1Database,
    KV: {} as KVNamespace,
    ASSETS_BUCKET: {} as R2Bucket,
    BETTER_AUTH_SECRET: 'test',
    ...overrides,
  } as Env;
}

describe('resolveProviderChain', () => {
  it('defaults to Cerebras then FreeModel when both keys are set', () => {
    const env = mockEnv({
      CEREBRAS_API_KEY: 'csk-test',
      FREEMODEL_API_KEY: 'fe-test',
    });
    expect(resolveProviderChain(env)).toEqual(['Cerebras', 'FreeModel']);
    expect(resolveDefaultProvider(env)).toBe('Cerebras');
  });

  it('includes every provider that has an env key', () => {
    const env = mockEnv({
      CEREBRAS_API_KEY: 'csk-test',
      CLOUDFLARE_AI_API_TOKEN: 'cf-token',
      CLOUDFLARE_AI_BASE_URL: 'https://api.cloudflare.com/client/v4/accounts/acc123/ai/v1',
      GROQ_API_KEY: 'gsk-test',
      GOOGLE_API_KEY: 'goog-test',
      FREEMODEL_API_KEY: 'fe-test',
      DEFAULT_AI_PROVIDER: 'Cerebras',
      DEFAULT_AI_PROVIDER_FALLBACK: 'Cloudflare,Groq,Gemini,FreeModel',
    });
    expect(resolveProviderChain(env)).toEqual([
      'Cerebras',
      'Cloudflare',
      'Groq',
      'Gemini',
      'FreeModel',
    ]);
  });

  it('respects DEFAULT_AI_PROVIDER and DEFAULT_AI_PROVIDER_FALLBACK order', () => {
    const env = mockEnv({
      CEREBRAS_API_KEY: 'csk-test',
      FREEMODEL_API_KEY: 'fe-test',
      DEFAULT_AI_PROVIDER: 'FreeModel',
      DEFAULT_AI_PROVIDER_FALLBACK: 'Cerebras',
    });
    expect(resolveProviderChain(env)).toEqual(['FreeModel', 'Cerebras']);
  });

  it('migrates stale gpt-5.5 FreeModel model to claude-sonnet-4-6', () => {
    const env = mockEnv({ FREEMODEL_DEFAULT_MODEL: 'gpt-5.5' });
    expect(resolvePlatformProviderOptions(env, 'FreeModel', null).model).toBe('claude-sonnet-4-6');
  });

  it('requires both Cloudflare token and base URL', () => {
    const envOnlyToken = mockEnv({
      CLOUDFLARE_AI_API_TOKEN: 'cf-token',
      DEFAULT_AI_PROVIDER: 'Cloudflare',
    });
    expect(resolveProviderChain(envOnlyToken)).toEqual(['Cerebras']);

    const envComplete = mockEnv({
      CLOUDFLARE_AI_API_TOKEN: 'cf-token',
      CLOUDFLARE_AI_BASE_URL: 'https://api.cloudflare.com/client/v4/accounts/acc123/ai/v1',
      DEFAULT_AI_PROVIDER: 'Cloudflare',
    });
    expect(resolveProviderChain(envComplete)).toEqual(['Cloudflare']);
  });
});
