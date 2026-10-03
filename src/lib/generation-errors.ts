// Classification of model-provider failures during generation.
//
// Two goals:
// 1. Retry the failures that are almost always transient (rate limits,
//    overload, dropped connections, provider timeouts) instead of failing the
//    whole generation on a one-second CDN/gateway blip.
// 2. Replace raw provider error text (which leaks internals and confuses
//    non-technical users) with a short explanation and a clear next step.

export type GenerationErrorCategory =
  | 'rate_limited'
  | 'overloaded'
  | 'network'
  | 'timeout'
  | 'context_length'
  | 'auth'
  | 'unknown';

export interface GenerationErrorInfo {
  category: GenerationErrorCategory;
  /** True when a fresh attempt against the same model has a real chance of succeeding. */
  retryable: boolean;
  /** Short user-facing explanation (no provider internals). */
  userMessage: string;
}

const STATUS_PATTERNS: Array<[RegExp, GenerationErrorCategory]> = [
  [/(?:^|\s|\()429(?:\s|$|\))/, 'rate_limited'],
  [/(?:^|\s|\()(?:502|503|529)(?:\s|$|\))/, 'overloaded'],
  [/(?:^|\s|\()401(?:\s|$|\))/, 'auth'],
  [/(?:^|\s|\()403(?:\s|$|\))/, 'auth'],
];

export function classifyGenerationError(error: unknown): GenerationErrorInfo {
  const message = (error instanceof Error ? error.message : String(error ?? '')).trim();
  const text = message.toLowerCase();
  const status =
    typeof (error as { status?: unknown })?.status === 'number' ? (error as { status: number }).status
      : typeof (error as { statusCode?: unknown })?.statusCode === 'number' ? (error as { statusCode: number }).statusCode
        : undefined;

  if (status === 429 || /rate.?limit|too many requests|quota exceeded|throttl|too much traffic/.test(text)) {
    return { category: 'rate_limited', retryable: true, userMessage: 'The AI model is receiving too much traffic right now.' };
  }
  if ((status !== undefined && [502, 503, 529].includes(status)) || /overload|capacity|service unavailable|temporarily unavailable|upstream error|bad gateway/.test(text)) {
    return { category: 'overloaded', retryable: true, userMessage: 'The AI model provider is temporarily overloaded.' };
  }
  if (/fetch failed|econnreset|econnrefused|etimedout|eai_again|socket hang up|network error|connection (?:reset|refused|closed|error)|broken pipe/.test(text)) {
    return { category: 'network', retryable: true, userMessage: 'The connection to the AI model provider dropped.' };
  }
  if (/timed? out|deadline exceeded|timeout|took too long/.test(text)) {
    return { category: 'timeout', retryable: true, userMessage: 'The AI model took too long to respond.' };
  }
  if (/context length|context window|maximum context|prompt is too long|too many tokens|reduce the length/.test(text)) {
    return { category: 'context_length', retryable: false, userMessage: 'This conversation is too long for the selected model. Start a new chat, or switch to a model with a larger context window.' };
  }
  if (status === 401 || status === 403 || /unauthorized|invalid api key|authentication failed|permission denied|access denied|invalid x-api-key/.test(text)) {
    return { category: 'auth', retryable: false, userMessage: 'The AI model provider rejected the request credentials. Please contact support.' };
  }
  // Workers AI surfaces platform faults as numeric codes with no HTTP status
  // ("AiError: 3046", "8005: Internal server error"). 3xxx codes are upstream
  // timeouts/capacity faults and 8xxx are internal provider errors — both
  // transient, and the raw code must never reach the user. These checks sit
  // after context-length and auth so a 4-digit token count or credential
  // message is never swallowed by them.
  if (/\b8\d{3}\b/.test(text) || /\binternal (server )?error\b/.test(text)) {
    return { category: 'overloaded', retryable: true, userMessage: 'The AI model provider hit an internal error.' };
  }
  if (/\b3\d{3}\b/.test(text)) {
    return { category: 'timeout', retryable: true, userMessage: 'The AI model took too long to respond.' };
  }
  for (const [pattern, category] of STATUS_PATTERNS) {
    if (!pattern.test(text)) continue;
    if (category === 'rate_limited') return { category, retryable: true, userMessage: 'The AI model is receiving too much traffic right now.' };
    if (category === 'overloaded') return { category, retryable: true, userMessage: 'The AI model provider is temporarily overloaded.' };
    return { category, retryable: false, userMessage: 'The AI model provider rejected the request credentials. Please contact support.' };
  }
  return { category: 'unknown', retryable: false, userMessage: message || 'Generation failed unexpectedly.' };
}

/** Code sent to the client so it can render category-specific guidance. */
export function generationErrorCode(info: GenerationErrorInfo): string | undefined {
  switch (info.category) {
    case 'rate_limited':
    case 'overloaded':
    case 'network':
    case 'timeout':
      return 'provider_busy';
    case 'context_length':
      return 'context_length';
    case 'auth':
      return 'provider_auth';
    default:
      return undefined;
  }
}

export class GenerationUserError extends Error {
  readonly category: GenerationErrorCategory;
  readonly code?: string;
  // Declared manually because tsconfig targets ES2020, where Error has no
  // `cause` member in its type definition.
  readonly cause?: unknown;

  constructor(info: GenerationErrorInfo, cause?: unknown) {
    super(info.userMessage);
    this.name = 'GenerationUserError';
    this.category = info.category;
    this.code = generationErrorCode(info);
    if (cause !== undefined) this.cause = cause;
  }
}

/**
 * Message text for an unknown thrown value. Catch bindings are `unknown` under
 * strict mode; providers occasionally throw plain objects or strings, so this
 * never assumes an Error instance.
 */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message || String(error);
  return String(error ?? '');
}
