import { createAnthropic } from '@ai-sdk/anthropic';
import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';
import { atriaConfiguration, bedrockBearer, credential } from './runtime-config';
import { resolveModel, type AllowedModel } from './models';

/**
 * The ai-sdk `LanguageModel` union also covers string model ids resolved through
 * the global provider registry; the factories below always return a configured
 * model object, so the string member is excluded. (meteredModel needs an object
 * it can wrap with per-call accounting.)
 */
export type ProviderLanguageModel = Exclude<LanguageModel, string>;

/**
 * Single home for provider credential handling. Generation (`agent.ts`) and the
 * model tester (`model-tester.ts`) both build provider clients from this module
 * so a provider change is one edit, not four.
 */

export interface ProviderCredentials {
  anthropicApiKey?: string;
  bedrockApiKey?: string;
  awsKey?: string;
  awsSecret?: string;
  awsRegion: string;
}

export function providerCredentials(env: Record<string, unknown>): ProviderCredentials {
  return {
    anthropicApiKey: credential(env, 'ANTHROPIC_API_KEY'),
    bedrockApiKey: bedrockBearer(env),
    awsKey: credential(env, 'AWS_ACCESS_KEY_ID'),
    awsSecret: credential(env, 'AWS_SECRET_ACCESS_KEY'),
    awsRegion: (typeof env.AWS_REGION === 'string' && env.AWS_REGION) || 'us-east-1',
  };
}

export function hasBedrockCredentials(creds: ProviderCredentials): boolean {
  return Boolean(creds.bedrockApiKey || (creds.awsKey && creds.awsSecret));
}

/**
 * Anthropic-family models may be served by the native API or by Bedrock. Both ids
 * are allowlist entries for the same client-visible name, so picking the
 * credentialed transport is not a model substitution.
 */
export function selectModelTransport(model: AllowedModel, creds: ProviderCredentials): AllowedModel {
  if (model.provider === 'anthropic' && !creds.anthropicApiKey) {
    return resolveModel(model.name, 'aws') || model;
  }
  if (model.provider === 'aws' && !hasBedrockCredentials(creds)) {
    return resolveModel(model.name, 'anthropic') || model;
  }
  return model;
}

/** Bedrock inference-profile aliases tried in order when a region-prefixed id is unavailable. */
export const BEDROCK_ALIASES: Record<string, string[]> = {
  'us.moonshotai.kimi-k3': ['us.moonshotai.kimi-k3', 'global.moonshotai.kimi-k3', 'moonshotai.kimi-k3'],
  'moonshotai.kimi-k3': ['us.moonshotai.kimi-k3', 'global.moonshotai.kimi-k3', 'moonshotai.kimi-k3'],
  'global.moonshotai.kimi-k3': ['global.moonshotai.kimi-k3', 'us.moonshotai.kimi-k3', 'moonshotai.kimi-k3'],
  'us.anthropic.claude-sonnet-4-6': ['us.anthropic.claude-sonnet-4-6', 'global.anthropic.claude-sonnet-4-6', 'anthropic.claude-sonnet-4-6', 'us.anthropic.claude-sonnet-4-6-v1:0'],
  'us.anthropic.claude-opus-4-6': ['us.anthropic.claude-opus-4-6', 'global.anthropic.claude-opus-4-6', 'anthropic.claude-opus-4-6', 'us.anthropic.claude-opus-4-6-v1:0'],
  'minimax.minimax-m2.5': ['minimax.minimax-m2.5', 'us.minimax.minimax-m2.5'],
};

export function createBedrockClient(creds: ProviderCredentials) {
  return createAmazonBedrock({
    region: creds.awsRegion,
    apiKey: creds.bedrockApiKey,
    accessKeyId: creds.awsKey,
    secretAccessKey: creds.awsSecret,
  });
}

/**
 * Build the ai-sdk language model for a non-Cloudflare allowlist entry.
 * Throws a provider-specific error when the credential is missing — callers
 * decide how to report it; no cross-provider fallback happens here.
 */
export function providerModel(model: AllowedModel, env: Record<string, unknown>, creds: ProviderCredentials): { aiModel: ProviderLanguageModel; maxTokens: number } {
  if (model.provider === 'anthropic') {
    if (!creds.anthropicApiKey) throw new Error('Anthropic credentials are not configured');
    return { aiModel: createAnthropic({ apiKey: creds.anthropicApiKey })(model.id), maxTokens: model.maxTokens };
  }
  if (model.provider === 'aws') {
    if (!hasBedrockCredentials(creds)) throw new Error('AWS Bedrock credentials are not configured');
    return { aiModel: createBedrockClient(creds)(model.id), maxTokens: model.maxTokens };
  }
  if (model.provider === 'atria') {
    const { apiKey, baseURL } = atriaConfiguration(env);
    if (!apiKey) throw new Error('Atria credentials are not configured');
    // Atria Dawn Preview defaults to extended thinking mode, burning ~93% of the
    // token budget on hidden reasoning (479/512 tokens = thinking at 26s vs 9s).
    // Disable it via a fetch interceptor since there's no first-class SDK setting.
    const atriaFetch: typeof fetch = async (url, init) => {
      if (init?.body && typeof init.body === 'string') {
        try {
          const body = JSON.parse(init.body);
          body.thinking = { type: 'disabled' };
          return fetch(url as string, { ...init, body: JSON.stringify(body) });
        } catch {
          // fall through to unmodified request if body parse fails
        }
      }
      return fetch(url as string, init as RequestInit);
    };
    const atria = createOpenAI({ name: 'atria', apiKey, baseURL, compatibility: 'compatible', fetch: atriaFetch } as any);
    return { aiModel: atria.chat(model.id), maxTokens: model.maxTokens };
  }
  throw new Error(`Provider "${model.provider}" is not handled by providerModel.`);
}
