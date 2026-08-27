// ---------------------------------------------------------------------------
// Per-model parameter selection for the OpenAI Chat Completions API.
//
// Why this exists: the OCR proxy sends one fixed body shape, but OpenAI's
// models do not accept one fixed set of parameters. The reasoning families
// (o1, o3, o4-mini, and the reasoning-first GPT-5 tiers) reject parameters the
// 4o family accepts outright with HTTP 400, so a single hardcoded body either
// works everywhere or nowhere depending on which model is configured.
//
// Two layers, deliberately:
//
//   1. CAPABILITIES below is a best-effort static table. It is the fast path.
//   2. `retryWithoutRejectedParam` is the safety net. OpenAI names the offending
//      field in `error.param`, so when the table is wrong we strip that one
//      field and retry once instead of failing the extraction.
//
// Layer 2 is not belt-and-braces. Model families ship faster than this table
// can be maintained, and a stale row here would otherwise mean every OCR
// request 400s until someone edits this file. With the retry, a wrong row
// costs one extra round trip and self-heals.
// ---------------------------------------------------------------------------

/**
 * Default OpenAI model names, shared by the production proxy
 * (functions/api/ocr.ts) and the dev proxy (vite.config.ts). Both import from
 * here so the two cannot drift — the same reason buildModelParams is shared.
 *
 * The escalation tier runs only on below-threshold pages, so it can afford the
 * flagship model; the no-Hunyuan fallback serves every page and stays on mini.
 */
export const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';
export const DEFAULT_OPENAI_MODEL = 'gpt-5.4';
export const DEFAULT_OPENAI_FALLBACK_MODEL = 'gpt-5.4-mini';

/** Parameters the caller would *like* to send, before capability filtering. */
export interface DesiredParams {
  temperature?: number;
  seed?: number;
  /** Ask for token logprobs, which is what makes confidence scoring real. */
  logprobs?: boolean;
  /** Constrain the response to a single JSON object. */
  jsonObject?: boolean;
  /** Upper bound on billed output tokens. */
  maxCompletionTokens?: number;
}

export interface ModelCapabilities {
  /** Accepts an explicit `temperature`. Reasoning models allow only the default. */
  temperature: boolean;
  /** Accepts `seed` for best-effort determinism. */
  seed: boolean;
  /** Can return per-token logprobs. Required for real confidence scores. */
  logprobs: boolean;
  /** Accepts `response_format: { type: "json_object" }`. */
  jsonObject: boolean;
  /** Accepts image content parts. A model without this cannot do OCR at all. */
  vision: boolean;
}

const CHAT_MODEL: ModelCapabilities = {
  temperature: true,
  seed: true,
  logprobs: true,
  jsonObject: true,
  vision: true,
};

/**
 * Reasoning models: `temperature`, `seed` and `logprobs` are all rejected, and
 * hidden reasoning tokens are billed against the same daily quota. Not a good
 * fit for OCR, but the shape has to be handled in case one is configured.
 */
const REASONING_MODEL: ModelCapabilities = {
  temperature: false,
  seed: false,
  logprobs: false,
  jsonObject: true,
  vision: true,
};

/** o3-mini has no vision at all, so it can never serve an OCR request. */
const REASONING_MODEL_NO_VISION: ModelCapabilities = {
  ...REASONING_MODEL,
  vision: false,
};

/**
 * Exact-match overrides, checked before the prefix rules below.
 *
 * Anything not listed falls through to `capabilitiesFor`'s pattern matching,
 * which treats unknown models as full chat models — the permissive default,
 * because the retry path above can recover from an over-estimate but nothing
 * can recover from silently dropping `logprobs` on a model that supported it.
 */
const CAPABILITIES: Record<string, ModelCapabilities> = {
  'o3-mini': REASONING_MODEL_NO_VISION,
};

/**
 * True for OpenAI's reasoning families: the bare o-series (`o1`, `o3-mini`,
 * `o4-mini`) and any GPT-5 tier explicitly marked as a reasoning variant.
 *
 * The leading-`o` test is anchored and requires a digit, so `omni-...` or a
 * hypothetical `openai-...` model name is not misread as a reasoning model.
 */
function isReasoningModel(model: string): boolean {
  return /^o\d/.test(model);
}

/**
 * Capabilities for a model name, falling back to the permissive chat profile.
 *
 * The GPT-5 tiers postdate this table's authorship and are treated as chat
 * models. If that turns out to be wrong for a given tier, the first request
 * 400s, `retryWithoutRejectedParam` strips the offending field, and the second
 * request succeeds — so a wrong guess degrades rather than breaks.
 */
export function capabilitiesFor(model: string): ModelCapabilities {
  const normalized = model.trim().toLowerCase();
  const exact = CAPABILITIES[normalized];
  if (exact) return exact;
  if (isReasoningModel(normalized)) return REASONING_MODEL;
  return CHAT_MODEL;
}

/**
 * Builds the parameter object to merge into a Chat Completions body, dropping
 * every field the model cannot accept.
 *
 * `max_tokens` is deliberately never emitted: it is deprecated in favour of
 * `max_completion_tokens`, and the reasoning families reject it outright.
 */
export function buildModelParams(
  model: string,
  desired: DesiredParams,
): Record<string, unknown> {
  const caps = capabilitiesFor(model);
  const params: Record<string, unknown> = {};

  if (caps.temperature && typeof desired.temperature === 'number') {
    params.temperature = desired.temperature;
  }
  if (caps.seed && typeof desired.seed === 'number') {
    params.seed = desired.seed;
  }
  if (caps.logprobs && desired.logprobs) {
    params.logprobs = true;
  }
  if (caps.jsonObject && desired.jsonObject) {
    params.response_format = { type: 'json_object' };
  }
  if (typeof desired.maxCompletionTokens === 'number') {
    params.max_completion_tokens = desired.maxCompletionTokens;
  }

  return params;
}

/**
 * Fields this module is willing to strip and retry without.
 *
 * Restricted on purpose. `messages` or `model` being rejected is a real bug in
 * the caller, and retrying without them would turn a loud failure into a
 * confusing one — so only the optional tuning parameters are eligible.
 */
const RETRYABLE_PARAMS = new Set([
  'temperature',
  'seed',
  'logprobs',
  'top_logprobs',
  'response_format',
  'max_completion_tokens',
  'max_tokens',
]);

/**
 * Given an OpenAI 400 error body, returns a copy of `body` with the rejected
 * parameter removed, or null when the error is not a recoverable parameter
 * complaint.
 *
 * OpenAI reports these as:
 *   { error: { message, code: "unsupported_parameter", param: "temperature" } }
 *
 * `code` varies — `unsupported_parameter` when the field is not accepted at all,
 * `unsupported_value` when only the default is allowed (a model that permits
 * `temperature` but only at 1). Both are fixed by dropping the field, so this
 * keys off `param` and falls back to scanning the message for models that
 * report the field name in prose without populating `param`.
 */
export function retryWithoutRejectedParam(
  body: Record<string, unknown>,
  errorBody: unknown,
): { body: Record<string, unknown>; removed: string } | null {
  const err = (errorBody as { error?: { param?: unknown; message?: unknown } } | null)?.error;
  if (!err) return null;

  let param = typeof err.param === 'string' ? err.param : '';

  // Some responses describe the field in the message but leave `param` null.
  // Only the fields already declared retryable are matched, so this cannot be
  // tricked into stripping `messages` by an error string that mentions it.
  if (!RETRYABLE_PARAMS.has(param)) {
    const message = typeof err.message === 'string' ? err.message : '';
    param = '';
    for (const candidate of RETRYABLE_PARAMS) {
      if (message.includes(`'${candidate}'`) || message.includes(`"${candidate}"`)) {
        param = candidate;
        break;
      }
    }
  }

  if (!param || !RETRYABLE_PARAMS.has(param)) return null;
  // Nothing to retry if the field was not in the body to begin with; retrying
  // an identical request would just 400 again.
  if (!(param in body)) return null;

  const next = { ...body };
  delete next[param];
  return { body: next, removed: param };
}

/**
 * Total tokens billed for a response, for quota accounting. Returns null rather
 * than 0 when absent, so "the provider did not tell us" stays distinguishable
 * from "this request was free".
 */
export function usedTokens(responseBody: unknown): number | null {
  const usage = (responseBody as { usage?: { total_tokens?: unknown } } | null)?.usage;
  const total = usage?.total_tokens;
  return typeof total === 'number' && Number.isFinite(total) ? total : null;
}
