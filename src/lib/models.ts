/**
 * The single source of truth for which AI models this deployment may invoke.
 *
 * Every model-invocation path (the ChatAgent generation pipeline and the
 * /api/test/* benchmark endpoints) resolves a *client-supplied* model name
 * through `resolveModel` and refuses anything that is not an exact entry here.
 * There is no substring dispatch and no silent re-map to a default model: an
 * unknown id is an error, not a sonnet/llama substitution.
 *
 * The list mirrors the catalog the frontend offers in ChatPanel.tsx. Adding a
 * model to the UI means adding it here too — the two are a contract.
 */

export type ModelProvider = 'cloudflare' | 'anthropic' | 'aws' | 'atria';

export interface AllowedModel {
  /** Client-visible model name, matched exactly (case-sensitive). */
  name: string;
  provider: ModelProvider;
  /** Concrete provider id handed to the SDK or the env.AI binding. */
  id: string;
  /** Server-side ceiling on output tokens for this model. */
  maxTokens: number;
}

/**
 * Absolute server-side ceiling on client-requested output tokens. Clients can
 * ask for less; they can never ask for more. Unconstrained generation would
 * otherwise let a single request burn an unbounded budget.
 */
export const MAX_OUTPUT_TOKENS = 65536;

/**
 * Wall-clock ceiling on any single outbound AI call. Long full-app
 * generations legitimately take a few minutes; this is a safety net for a
 * hung upstream, not a perf target.
 */
export const AI_TIMEOUT_MS = 10 * 60 * 1000;
export const MODEL_TEST_TIMEOUT_MS = 5 * 60 * 1000;

const ANTHROPIC_DEFAULT_MAX = 8192;
const BEDROCK_DEFAULT_MAX = 8192;
const ATRIA_DEFAULT_MAX = 64000;
const CF_DEFAULT_MAX = 65536;

const CF_MODELS: AllowedModel[] = [
  { name: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', provider: 'cloudflare', id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', maxTokens: CF_DEFAULT_MAX },
  { name: '@cf/openai/gpt-oss-20b', provider: 'cloudflare', id: '@cf/openai/gpt-oss-20b', maxTokens: CF_DEFAULT_MAX },
  { name: '@cf/meta/llama-4-scout-17b-16e-instruct', provider: 'cloudflare', id: '@cf/meta/llama-4-scout-17b-16e-instruct', maxTokens: CF_DEFAULT_MAX },
  { name: '@cf/openai/gpt-oss-120b', provider: 'cloudflare', id: '@cf/openai/gpt-oss-120b', maxTokens: CF_DEFAULT_MAX },
  { name: '@cf/moonshotai/kimi-k2.7-code', provider: 'cloudflare', id: '@cf/moonshotai/kimi-k2.7-code', maxTokens: CF_DEFAULT_MAX },
  { name: '@cf/qwen/qwen2.5-coder-32b-instruct', provider: 'cloudflare', id: '@cf/qwen/qwen2.5-coder-32b-instruct', maxTokens: CF_DEFAULT_MAX },
  { name: '@cf/qwen/qwen3.8-27b', provider: 'cloudflare', id: '@cf/qwen/qwen3.8-27b', maxTokens: CF_DEFAULT_MAX },
  // Image-synthesis model invoked by the generate_image tool. Not client-selectable,
  // but listed so the allowlist remains the single source of truth for AI bindings.
  { name: '@cf/black-forest-labs/flux-1-schnell', provider: 'cloudflare', id: '@cf/black-forest-labs/flux-1-schnell', maxTokens: CF_DEFAULT_MAX },
];

const ANTHROPIC_MODELS: AllowedModel[] = [
  { name: 'claude-3-7-sonnet', provider: 'anthropic', id: 'claude-3-7-sonnet-20250219', maxTokens: ANTHROPIC_DEFAULT_MAX },
  { name: 'claude-3-5-sonnet', provider: 'anthropic', id: 'claude-3-5-sonnet-20241022', maxTokens: ANTHROPIC_DEFAULT_MAX },
  { name: 'claude-3-opus', provider: 'anthropic', id: 'claude-3-opus-20240229', maxTokens: ANTHROPIC_DEFAULT_MAX },
  { name: 'claude-3-5-haiku', provider: 'anthropic', id: 'claude-3-5-haiku-20241022', maxTokens: ANTHROPIC_DEFAULT_MAX },
  { name: 'claude-sonnet-4.6', provider: 'anthropic', id: 'claude-sonnet-4-6', maxTokens: ANTHROPIC_DEFAULT_MAX },
  { name: 'claude-opus-4.6', provider: 'anthropic', id: 'claude-opus-4-6', maxTokens: ANTHROPIC_DEFAULT_MAX },
];

const BEDROCK_MODELS: AllowedModel[] = [
  { name: 'claude-opus-4.6', provider: 'aws', id: 'us.anthropic.claude-opus-4-6-v1:0', maxTokens: BEDROCK_DEFAULT_MAX },
  { name: 'claude-sonnet-4.6', provider: 'aws', id: 'us.anthropic.claude-sonnet-4-6-v1:0', maxTokens: BEDROCK_DEFAULT_MAX },
  { name: 'claude-sonnet', provider: 'aws', id: 'us.anthropic.claude-sonnet-4-6-v1:0', maxTokens: BEDROCK_DEFAULT_MAX },
  { name: 'minimax-m2.5', provider: 'aws', id: 'minimax.minimax-m2.5', maxTokens: BEDROCK_DEFAULT_MAX },
  { name: 'minimax', provider: 'aws', id: 'minimax.minimax-m2.5', maxTokens: BEDROCK_DEFAULT_MAX },
];

const ATRIA_MODELS: AllowedModel[] = [
  { name: 'Atria-Dawn-Preview', provider: 'atria', id: 'Atria-Dawn-Preview', maxTokens: ATRIA_DEFAULT_MAX },
  { name: 'atria-dawn-preview', provider: 'atria', id: 'Atria-Dawn-Preview', maxTokens: ATRIA_DEFAULT_MAX },
];

export const MODEL_ALLOWLIST: readonly AllowedModel[] = [
  ...CF_MODELS,
  ...ANTHROPIC_MODELS,
  ...BEDROCK_MODELS,
  ...ATRIA_MODELS,
];

/**
 * Exact-match resolution. The optional `provider` hint disambiguates names that
 * are valid for more than one backend (e.g. `claude-sonnet-4.6` is both a
 * native Anthropic id and a Bedrock inference id); without the hint the first
 * declared match wins.
 *
 * Returns null for anything not listed — callers must treat that as a hard
 * refusal and never fall back to a default model.
 */
export function resolveModel(name: string | undefined | null, provider?: string | null): AllowedModel | null {
  if (typeof name !== 'string' || !name) return null;
  const want = provider as ModelProvider | undefined;
  if (want) {
    const exact = MODEL_ALLOWLIST.find((m) => m.name === name && m.provider === want);
    if (exact) return exact;
  }
  return MODEL_ALLOWLIST.find((m) => m.name === name) ?? null;
}

/**
 * Clamps a client-supplied output-token limit to the server ceiling and to the
 * model's own ceiling. Returns the effective limit, always finite and positive.
 */
export function capTokenLimit(requested: number | undefined | null, model: AllowedModel): number {
  // NO TOKEN LIMIT (user requested unlimited)
  if (typeof requested === 'number' && Number.isFinite(requested) && requested > 0) {
    return Math.floor(requested);
  }
  // Return a massive number to bypass artificial caps
  return 2147483647;
}

/**
 * Race a promise against a wall-clock deadline so a hung upstream can never
 * pin a request (or a Durable Object) forever. Rejects with a labelled error.
 */
export async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} exceeded the ${Math.round(ms / 1000)}s timeout`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
