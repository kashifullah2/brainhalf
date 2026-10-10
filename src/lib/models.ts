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

export type ModelProvider = 'cloudflare' | 'anthropic' | 'aws' | 'atria' | 'custom';

export interface AllowedModel {
  /** Client-visible model name, matched exactly (case-sensitive). */
  name: string;
  provider: ModelProvider;
  /** Concrete provider id handed to the SDK or the env.AI binding. */
  id: string;
  /** Server-side ceiling on output tokens for this model. */
  maxTokens: number;
  /**
   * False for rows that exist so `resolveModel` can accept a legitimate
   * request, but that the model picker must not offer: the image-synthesis
   * model, and aliases that would otherwise show the same model twice.
   *
   * The picker in ChatPanel.tsx builds its list from CLIENT_SELECTABLE_MODELS,
   * so this flag — not a second copy of the catalog — is what the UI shows.
   */
  clientSelectable?: boolean;
  /** When true, the model supports reasoning/thinking via chat_template_kwargs.enable_thinking. */
  supportsThinking?: boolean;
  /** When true, the provider caches the system-prompt prefix across calls (Anthropic cacheControl / Bedrock cachePoint). */
  supportsPromptCaching?: boolean;
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
export const DEFAULT_MODEL_ID = '@cf/deepseek-ai/deepseek-v4-pro-0813';

// Sonnet 4.6 and Kimi K3 both support 64k output tokens. The old 8,192 cap
// truncated every multi-file app mid-file, driving the truncation-retry loop
// and the bracket-guessing repair path.
const BEDROCK_DEFAULT_MAX = 64000;
const ATRIA_DEFAULT_MAX = 65536;
const CF_DEFAULT_MAX = 65536;

const CF_MODELS: AllowedModel[] = [
  { name: DEFAULT_MODEL_ID, provider: 'cloudflare', id: DEFAULT_MODEL_ID, maxTokens: CF_DEFAULT_MAX, supportsThinking: true },
  { name: '@cf/deepseek-ai/deepseek-v4-flash-0731', provider: 'cloudflare', id: '@cf/deepseek-ai/deepseek-v4-flash-0731', maxTokens: CF_DEFAULT_MAX, supportsThinking: true },
  { name: '@cf/openai/gpt-oss-120b', provider: 'cloudflare', id: '@cf/openai/gpt-oss-120b', maxTokens: CF_DEFAULT_MAX },
  { name: '@cf/moonshotai/kimi-k2.7-code', provider: 'cloudflare', id: '@cf/moonshotai/kimi-k2.7-code', maxTokens: CF_DEFAULT_MAX },
  { name: '@cf/qwen/qwen3.8-27b', provider: 'cloudflare', id: '@cf/qwen/qwen3.8-27b', maxTokens: 32768 },
  { name: '@cf/meta/llama-4-scout-17b-16e-instruct', provider: 'cloudflare', id: '@cf/meta/llama-4-scout-17b-16e-instruct', maxTokens: CF_DEFAULT_MAX },
  // Disabled: returns empty response on CF Workers AI; re-enable when model becomes available.
  { name: '@cf/meta/llama-4-maverick-17b-128e-instruct', provider: 'cloudflare', id: '@cf/meta/llama-4-maverick-17b-128e-instruct', maxTokens: CF_DEFAULT_MAX, clientSelectable: false },
  // Disabled: returns empty response on CF Workers AI; re-enable when model becomes available.
  { name: '@cf/google/gemma-3-27b-it', provider: 'cloudflare', id: '@cf/google/gemma-3-27b-it', maxTokens: 32768, clientSelectable: false },
  { name: '@cf/mistralai/mistral-small-3.1-24b-instruct', provider: 'cloudflare', id: '@cf/mistralai/mistral-small-3.1-24b-instruct', maxTokens: 32768 },
  { name: '@cf/qwen/qwen2.5-coder-32b-instruct', provider: 'cloudflare', id: '@cf/qwen/qwen2.5-coder-32b-instruct', maxTokens: 32768 },
  { name: '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b', provider: 'cloudflare', id: '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b', maxTokens: CF_DEFAULT_MAX },
  // Disabled: times out on all generation levels; removed from picker until stable.
  { name: '@cf/zai-org/glm-5.3-flash', provider: 'cloudflare', id: '@cf/zai-org/glm-5.3-flash', maxTokens: 8192, clientSelectable: false, supportsThinking: true },
];

const ANTHROPIC_MODELS: AllowedModel[] = [
  { name: 'claude-sonnet-6', provider: 'anthropic', id: 'claude-sonnet-4-6', maxTokens: BEDROCK_DEFAULT_MAX, clientSelectable: false, supportsPromptCaching: true },
  { name: 'claude-opus-6', provider: 'anthropic', id: 'claude-opus-4-6', maxTokens: BEDROCK_DEFAULT_MAX, clientSelectable: false, supportsPromptCaching: true },
];

const BEDROCK_MODELS: AllowedModel[] = [
  { name: 'claude-sonnet-6', provider: 'aws', id: 'us.anthropic.claude-sonnet-4-6', maxTokens: BEDROCK_DEFAULT_MAX, supportsPromptCaching: true },
  { name: 'claude-opus-6', provider: 'aws', id: 'us.anthropic.claude-opus-4-6', maxTokens: BEDROCK_DEFAULT_MAX, supportsPromptCaching: true },
  { name: 'kimi-k3', provider: 'aws', id: 'us.moonshotai.kimi-k3', maxTokens: BEDROCK_DEFAULT_MAX, supportsPromptCaching: true },
  { name: 'minimax-m2.5', provider: 'aws', id: 'minimax.minimax-m2.5', maxTokens: BEDROCK_DEFAULT_MAX, supportsPromptCaching: true },
];

const ATRIA_MODELS: AllowedModel[] = [
  { name: 'Atria-Dawn-Preview', provider: 'atria', id: 'Atria-Dawn-Preview', maxTokens: ATRIA_DEFAULT_MAX },
];

export const MODEL_ALLOWLIST: readonly AllowedModel[] = [
  ...CF_MODELS,
  ...BEDROCK_MODELS,
  ...ANTHROPIC_MODELS,
  ...ATRIA_MODELS,
];

/**
 * The subset the model picker may show. Anything a client can select must also
 * be resolvable server-side, so this is derived from the allowlist rather than
 * maintained beside it — a model added here without an allowlist entry would be
 * a button that always errors, and one removed from the allowlist would be a
 * button that silently vanishes.
 */
export const CLIENT_SELECTABLE_MODELS: readonly AllowedModel[] = MODEL_ALLOWLIST.filter(
  (m) => m.clientSelectable !== false
);

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
    return MODEL_ALLOWLIST.find((m) => m.name === name && m.provider === want) ?? null;
  }
  return MODEL_ALLOWLIST.find((m) => m.name === name) ?? null;
}

/**
 * Clamps a client-supplied output-token limit to the server ceiling and to the
 * model's own ceiling. Returns the effective limit, always finite and positive.
 */
export function capTokenLimit(requested: number | undefined | null, model: AllowedModel): number {
  const ceiling = Math.min(model.maxTokens, MAX_OUTPUT_TOKENS);
  if (requested === Infinity) {
    return ceiling;
  }
  if (typeof requested !== 'number' || Number.isNaN(requested) || requested <= 0) {
    return ceiling;
  }
  return Math.max(1, Math.floor(Math.min(requested, ceiling)));
}

export async function withAbortSignal<T>(promise: PromiseLike<T>, signal: AbortSignal): Promise<T> {
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(signal.reason ?? new DOMException('Generation stopped', 'AbortError'));
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([promise, aborted]);
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort);
  }
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

/** Models that support reasoning/thinking via chat_template_kwargs.enable_thinking. */
export function modelSupportsThinking(model: string): boolean {
  return MODEL_ALLOWLIST.some(m => m.id === model && m.supportsThinking === true);
}

/** Models that use provider-level prompt caching (Anthropic cacheControl / Bedrock cachePoint). */
export function modelSupportsPromptCaching(model: string): boolean {
  return MODEL_ALLOWLIST.some(m => (m.id === model || m.name === model) && m.supportsPromptCaching === true);
}

const MODEL_DISPLAY_NAMES: Record<string, string> = {
  [DEFAULT_MODEL_ID]: 'DeepSeek V4 Pro',
  '@cf/deepseek-ai/deepseek-v4-flash-0731': 'DeepSeek V4 Flash',
  '@cf/openai/gpt-oss-120b': 'GPT-OSS 120B',
  '@cf/moonshotai/kimi-k2.7-code': 'Kimi K2.7 Code',
  '@cf/qwen/qwen3.8-27b': 'Qwen 3.8 27B',
  '@cf/meta/llama-4-scout-17b-16e-instruct': 'Llama 4 Scout',
  '@cf/meta/llama-4-maverick-17b-128e-instruct': 'Llama 4 Maverick',
  '@cf/google/gemma-3-27b-it': 'Gemma 3 27B',
  '@cf/mistralai/mistral-small-3.1-24b-instruct': 'Mistral Small 3.1',
  '@cf/qwen/qwen2.5-coder-32b-instruct': 'Qwen 2.5 Coder 32B',
  '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b': 'DeepSeek R1 32B',
  '@cf/zai-org/glm-5.3-flash': 'GLM 5.3 Flash',
  'claude-sonnet-6': 'Claude Sonnet 4.6',
  'claude-opus-6': 'Claude Opus 4.6',
  'kimi-k3': 'Kimi K3 v1',
  'minimax-m2.5': 'MiniMax M2.5',
  'Atria-Dawn-Preview': 'Atria Dawn Preview',
};

export function displayModelName(modelId: string): string {
  return MODEL_DISPLAY_NAMES[modelId] || modelId;
}

export type KillSwitchStatus = { integratedModelsEnabled: boolean; disabledModels: string[] };

/**
 * Pure decision: given a known status snapshot, returns the admin-refusal
 * message if the requested model is currently disabled, or null if allowed.
 * Extracted so agent.ts and tests can share the logic without mocking the DO.
 */
export function killSwitchRefusal(
  status: KillSwitchStatus,
  opts: { isCustom: boolean; requestedId: string; displayName: string; modelKey: string },
): string | null {
  if (opts.isCustom) {
    if (status.disabledModels.includes(opts.requestedId)) {
      return `Model "${opts.displayName}" is currently turned off by the administrator.`;
    }
  } else {
    if (!status.integratedModelsEnabled) {
      return 'The built-in models are currently turned off by the administrator.';
    }
    if (status.disabledModels.includes(opts.modelKey)) {
      return `Model "${opts.displayName}" is currently turned off by the administrator.`;
    }
  }
  return null;
}

/**
 * Fetches the live model-status snapshot; falls back to `getCached` when the
 * live fetch throws or returns null. Returns null when both fail — callers
 * MUST treat null as "fail closed: refuse the request."
 */
export async function resolveKillSwitchStatus(
  fetchLive: () => Promise<KillSwitchStatus | null>,
  getCached: () => Promise<KillSwitchStatus | null>,
): Promise<KillSwitchStatus | null> {
  const live = await fetchLive().catch(() => null);
  if (live != null) return live;
  const cached = await getCached().catch(() => null);
  return cached ?? null;
}

/** Models whose image inputs are verified against their provider interface. */
export function acceptsImageInput(model: string): boolean {
  return [
    '@cf/moonshotai/kimi-k2.7-code',
    '@cf/meta/llama-4-scout-17b-16e-instruct',
    '@cf/meta/llama-4-maverick-17b-128e-instruct',
    '@cf/google/gemma-3-27b-it',
    'claude-sonnet-6',
    'claude-opus-6',
  ].includes(model);
}
