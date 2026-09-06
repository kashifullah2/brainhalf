import {
  DEFAULT_OPENAI_BASE_URL,
  DEFAULT_OPENAI_MODEL,
  DEFAULT_OPENAI_FALLBACK_MODEL,
  DEFAULT_HUNYUAN_BASE_URL,
  DEFAULT_HUNYUAN_MODEL,
  HUNYUAN_USER_AGENT,
  buildModelParams,
  capabilitiesFor,
  retryWithoutRejectedParam,
  usedTokens,
} from './openai-params';
import {
  AwsCallError,
  TEXTRACT_MAX_BYTES,
  callBedrock,
  callTextract,
  isRetryableAwsError,
  resolveAwsConfig,
  type AwsOcrConfig,
  type TextractOperation,
  type TextractResponse,
} from './aws-ocr';
import { parseTextractResponse } from './textract-parse';

export type Tier = 'default' | 'escalation';

export interface OcrProviderEnv {
  HUNYUAN_API_KEY?: string;
  HUNYUAN_BASE_URL?: string;
  HUNYUAN_MODEL?: string;
  OPENAI_API_KEY?: string;
  OCR_API_KEY?: string;
  OPENAI_BASE_URL?: string;
  OPENAI_MODEL?: string;
  AWS_ACCESS_KEY_ID?: string;
  AWS_SECRET_ACCESS_KEY?: string;
  AWS_SESSION_TOKEN?: string;
  AWS_REGION?: string;
  AWS_BEDROCK_MODEL?: string;
  DEFAULT_TIER_PROVIDER?: 'hunyuan' | 'bedrock' | 'openai';
  HIGH_ACCURACY_PROVIDER?: 'bedrock' | 'openai';
}

export interface OcrRequestPayload {
  messages: Array<{ role: string; content: unknown[] }>;
  jsonObject: boolean;
  /**
   * The extraction preset. Textract has one operation per document class and no
   * way to be told what to look for, so it needs this to choose between
   * AnalyzeExpense, AnalyzeDocument and DetectDocumentText. The chat providers
   * ignore it -- the mode is already baked into `messages`.
   */
  mode?: string;
}

export type OcrProviderResult =
  | {
      type: 'success';
      data: unknown;
      providerName: string;
      model: string;
      tokensUsed: number | null;
      isTruncated: boolean;
    }
  | {
      type: 'retryable-error';
      status: number | null;
      message: string;
      providerName: string;
      detail: string;
    }
  | {
      type: 'permanent-error';
      status: number | null;
      message: string;
      providerName: string;
      detail: string;
      payloadTooLarge: boolean;
    }
  | {
      type: 'config-error';
      message: string;
    };

const UPSTREAM_TIMEOUT_MS = 60_000;
const MAX_COMPLETION_TOKENS = 8192;
const UPSTREAM_TEMPERATURE = 0;
const UPSTREAM_SEED = 42;

export interface ResolvedProvider {
  name: string;
  baseUrl: string;
  key: string;
  model: string;
  extraHeaders: Record<string, string>;
  buildBody: (input: OcrRequestPayload) => Record<string, unknown>;
  retryOnReject: boolean;
}

export function resolveProvider(env: OcrProviderEnv, tier: Tier): ResolvedProvider | OcrProviderResult {
  if (tier === 'escalation') {
    const key = env.OPENAI_API_KEY || env.OCR_API_KEY;
    if (!key) {
      return { type: 'config-error', message: 'OCR escalation is not configured on this deployment.' };
    }
    const model = env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL;
    if (!capabilitiesFor(model).vision) {
      return { type: 'config-error', message: 'OCR is not configured correctly on this deployment.' };
    }
    return {
      name: 'openai',
      baseUrl: (env.OPENAI_BASE_URL || DEFAULT_OPENAI_BASE_URL).replace(/\/$/, ""),
      key,
      model,
      extraHeaders: {},
      buildBody: (input) => ({
        model,
        messages: input.messages,
        ...buildModelParams(model, {
          temperature: UPSTREAM_TEMPERATURE,
          seed: UPSTREAM_SEED,
          logprobs: true,
          jsonObject: input.jsonObject,
          maxCompletionTokens: MAX_COMPLETION_TOKENS,
        }),
      }),
      retryOnReject: true,
    };
  }

  const hunyuanKey = env.HUNYUAN_API_KEY;
  if (hunyuanKey) {
    const hunyuanModel = env.HUNYUAN_MODEL || DEFAULT_HUNYUAN_MODEL;
    return {
      name: 'hunyuan',
      baseUrl: (env.HUNYUAN_BASE_URL || DEFAULT_HUNYUAN_BASE_URL).replace(/\/$/, ""),
      key: hunyuanKey,
      model: hunyuanModel,
      extraHeaders: { "User-Agent": HUNYUAN_USER_AGENT },
      buildBody: (input) => ({
        model: hunyuanModel,
        messages: input.messages,
        temperature: UPSTREAM_TEMPERATURE,
        seed: UPSTREAM_SEED,
      }),
      retryOnReject: false,
    };
  }

  const fallbackKey = env.OPENAI_API_KEY || env.OCR_API_KEY;
  if (fallbackKey) {
    const fallbackModel = DEFAULT_OPENAI_FALLBACK_MODEL;
    if (!capabilitiesFor(fallbackModel).vision) {
      return { type: 'config-error', message: 'OCR is not configured correctly on this deployment.' };
    }
    return {
      name: 'openai',
      baseUrl: (env.OPENAI_BASE_URL || DEFAULT_OPENAI_BASE_URL).replace(/\/$/, ""),
      key: fallbackKey,
      model: fallbackModel,
      extraHeaders: {},
      buildBody: (input) => ({
        model: fallbackModel,
        messages: input.messages,
        ...buildModelParams(fallbackModel, {
          temperature: UPSTREAM_TEMPERATURE,
          seed: UPSTREAM_SEED,
          logprobs: true,
          jsonObject: input.jsonObject,
          maxCompletionTokens: MAX_COMPLETION_TOKENS,
        }),
      }),
      retryOnReject: true,
    };
  }

  return { type: 'config-error', message: 'OCR is not configured on this deployment.' };
}

// ---------------------------------------------------------------------------
// AWS branch
// ---------------------------------------------------------------------------

export interface DocumentPart {
  /** The instructions server/ocr-prompts.ts built for this mode. */
  prompt: string;
  contentType: string;
  /** The payload of the data URL, with whitespace removed. */
  base64: string;
  byteLength: number;
}

/**
 * Pulls the prompt and the document back out of the OpenAI-shaped message array.
 *
 * The Bedrock adapter this replaces read only the document and substituted a
 * hardcoded sentence for the prompt, so every mode -- invoice, table, handwriting,
 * a user's own saved template -- was sent the same generic instruction and
 * answered in a shape the parser did not expect.
 */
/**
 * The three content parts server/ocr-prompts.ts emits. A union rather than
 * `Record<string, any>`, so adding a fourth part there is a compile error here
 * instead of a value this loop silently ignores.
 */
type MessagePart =
  | { type: 'text'; text?: unknown }
  | { type: 'image_url'; image_url?: { url?: unknown } }
  | { type: 'file'; file?: { file_data?: unknown } }
  | { type?: string };

export function readDocumentPart(payload: OcrRequestPayload): DocumentPart | null {
  const message = payload.messages[0];
  if (!message || !Array.isArray(message.content)) return null;

  let prompt = '';
  let dataUrl = '';

  for (const part of message.content as MessagePart[]) {
    if (!part || typeof part !== 'object') continue;
    if (part.type === 'text' && 'text' in part && typeof part.text === 'string') {
      prompt = part.text;
    } else if (
      part.type === 'image_url' &&
      'image_url' in part &&
      typeof part.image_url?.url === 'string'
    ) {
      dataUrl = part.image_url.url;
    } else if (
      part.type === 'file' &&
      'file' in part &&
      typeof part.file?.file_data === 'string'
    ) {
      dataUrl = part.file.file_data;
    }
  }

  if (!dataUrl) return null;

  const match = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl);
  if (!match) return null;
  const [, contentType, base64] = match;
  const cleaned = base64.replace(/\s/g, '');
  if (!cleaned) return null;

  return {
    prompt,
    contentType,
    base64: cleaned,
    // Every 4 base64 characters carry 3 bytes; padding shortens the last group.
    byteLength: Math.floor((cleaned.length * 3) / 4),
  };
}

/** Which Textract operation suits this mode. */
function textractOperationFor(mode: string | undefined): TextractOperation {
  if (mode === 'invoice' || mode === 'receipt') return 'AnalyzeExpense';
  if (mode === 'fulltext' || mode === 'handwriting' || mode === 'multilingual') {
    // These modes want the page transcribed, and DetectDocumentText is both the
    // cheapest operation and the only one that returns nothing but text.
    return 'DetectDocumentText';
  }
  return 'AnalyzeDocument';
}

/**
 * Shapes a provider reply the way the rest of the pipeline expects: an
 * OpenAI-style `choices[0].message.content` string. `choices[0].confidence` is
 * the provider's own certainty, which is what
 * src/lib/confidence-scorer.ts:extractModelConfidence() reads when there are no
 * logprobs -- so a real measurement reaches the score instead of a placeholder.
 */
function chatShapedReply(
  content: string,
  confidence: number | null,
  tokensUsed: number,
): unknown {
  return {
    choices: [
      {
        message: { content },
        finish_reason: 'stop',
        ...(confidence === null ? {} : { confidence }),
      },
    ],
    usage: { total_tokens: tokensUsed },
  };
}

/** Anthropic and Amazon Nova take different request bodies on Bedrock. */
function bedrockBody(modelId: string, part: DocumentPart): Record<string, unknown> {
  const isAnthropic = modelId.startsWith('anthropic.') || modelId.includes('.anthropic.');

  if (isAnthropic) {
    const source =
      part.contentType === 'application/pdf'
        ? {
            type: 'document' as const,
            source: { type: 'base64', media_type: 'application/pdf', data: part.base64 },
          }
        : {
            type: 'image' as const,
            source: { type: 'base64', media_type: part.contentType, data: part.base64 },
          };
    return {
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: MAX_COMPLETION_TOKENS,
      temperature: UPSTREAM_TEMPERATURE,
      messages: [{ role: 'user', content: [source, { type: 'text', text: part.prompt }] }],
    };
  }

  return {
    // Nova's Converse-style body. Its `format` is a bare extension, not a MIME type.
    messages: [
      {
        role: 'user',
        content: [
          {
            image: {
              format: part.contentType.replace('image/', '').replace('jpg', 'jpeg'),
              source: { bytes: part.base64 },
            },
          },
          { text: part.prompt },
        ],
      },
    ],
    inferenceConfig: { maxTokens: MAX_COMPLETION_TOKENS, temperature: UPSTREAM_TEMPERATURE },
  };
}

/** The two reply shapes Bedrock returns, depending on the model family. */
interface BedrockReply {
  /** Anthropic models. */
  content?: Array<{ text?: unknown }>;
  /** Amazon Nova and the other Converse-shaped models. */
  output?: { message?: { content?: Array<{ text?: unknown }> } };
  usage?: { output_tokens?: unknown; outputTokens?: unknown };
}

function bedrockContent(modelId: string, response: unknown): { text: string; tokens: number } {
  const body = response as BedrockReply | null | undefined;
  const isAnthropic = modelId.startsWith('anthropic.') || modelId.includes('.anthropic.');
  const text = isAnthropic
    ? body?.content?.[0]?.text
    : body?.output?.message?.content?.[0]?.text;
  const tokens = body?.usage?.output_tokens ?? body?.usage?.outputTokens ?? 0;
  return { text: typeof text === 'string' ? text : '', tokens: Number(tokens) || 0 };
}

export async function runBedrock(
  config: AwsOcrConfig,
  modelId: string,
  part: DocumentPart,
): Promise<OcrProviderResult> {
  try {
    const response = await callBedrock(config, modelId, bedrockBody(modelId, part));
    const { text, tokens } = bedrockContent(modelId, response);
    if (!text) {
      return {
        type: 'retryable-error',
        status: null,
        message: 'The extraction service returned an empty reply.',
        providerName: 'aws-bedrock',
        detail: 'Bedrock returned no text content',
      };
    }
    return {
      type: 'success',
      // Bedrock reports no per-token certainty, so the model dimension stays
      // unmeasured and the score is built from pattern and quality instead.
      data: chatShapedReply(text, null, tokens),
      providerName: 'aws-bedrock',
      model: modelId,
      tokensUsed: tokens,
      isTruncated: false,
    };
  } catch (error) {
    return awsFailure(error, 'aws-bedrock');
  }
}

export async function runTextract(
  config: AwsOcrConfig,
  part: DocumentPart,
  mode: string | undefined,
): Promise<OcrProviderResult> {
  if (part.byteLength > TEXTRACT_MAX_BYTES) {
    return {
      type: 'permanent-error',
      status: 413,
      message: 'This document is too large to extract.',
      providerName: 'aws-textract',
      detail: `Textract accepts at most ${TEXTRACT_MAX_BYTES} bytes inline; got ${part.byteLength}`,
      payloadTooLarge: true,
    };
  }

  const operation = textractOperationFor(mode);

  let response: TextractResponse;
  try {
    response = await callTextract(config, operation, part.base64);
  } catch (error) {
    // AnalyzeExpense refuses anything that is not an invoice or receipt, and
    // AnalyzeDocument refuses some scans FORMS cannot be found in. Both are worth
    // one retry with the operation that has no such preconditions.
    if (operation !== 'DetectDocumentText' && error instanceof AwsCallError && !isRetryableAwsError(error)) {
      console.warn(
        `[ocr-provider] Textract.${operation} refused the document (${error.awsErrorType ?? error.status}); retrying with DetectDocumentText`,
      );
      try {
        response = await callTextract(config, 'DetectDocumentText', part.base64);
      } catch (fallbackError) {
        return awsFailure(fallbackError, 'aws-textract');
      }
    } else {
      return awsFailure(error, 'aws-textract');
    }
  }

  const extraction = parseTextractResponse(response);
  if (extraction.fields.length === 0 && !extraction.rawText) {
    return {
      type: 'retryable-error',
      status: null,
      message: 'Nothing readable was found in this document.',
      providerName: 'aws-textract',
      detail: 'Textract returned neither fields nor lines',
    };
  }

  // A mode that wants the page transcribed gets the text; a mode that wants
  // labelled values gets a flat JSON object, which is the shape every parser in
  // this project already understands. `_overall_confidence` is Textract's own
  // measurement -- the adapter this replaces hardcoded 0.99 here.
  const wantsText = operation === 'DetectDocumentText' || extraction.fields.length === 0;
  const content = wantsText
    ? extraction.rawText
    : JSON.stringify(
        {
          ...Object.fromEntries(extraction.fields.map((f) => [f.label, f.value])),
          ...(extraction.confidence === null
            ? {}
            : { _overall_confidence: Number(extraction.confidence.toFixed(4)) }),
        },
        null,
        2,
      );

  return {
    type: 'success',
    data: chatShapedReply(content, extraction.confidence, 0),
    providerName: 'aws-textract',
    model: `textract:${operation}`,
    // Textract bills per page, not per token. Reporting 0 is accurate here.
    tokensUsed: 0,
    isTruncated: false,
  };
}

function awsFailure(error: unknown, providerName: string): OcrProviderResult {
  const detail = error instanceof Error ? error.message : String(error);
  const status = error instanceof AwsCallError ? error.status : null;

  if (isRetryableAwsError(error)) {
    return {
      type: 'retryable-error',
      status,
      message: 'The extraction service could not read this document. Try again in a moment.',
      providerName,
      detail,
    };
  }

  return {
    type: 'permanent-error',
    status,
    message: 'The extraction service refused the request.',
    providerName,
    detail,
    payloadTooLarge:
      status === 413 ||
      (error instanceof AwsCallError && error.awsErrorType === 'DocumentTooLargeException'),
  };
}

export async function callChatProvider(
  provider: ResolvedProvider,
  payload: OcrRequestPayload,
): Promise<OcrProviderResult> {
  let upstreamBody = provider.buildBody(payload);
  let attemptsRemaining = provider.retryOnReject ? 2 : 1;

  while (attemptsRemaining > 0) {
    attemptsRemaining -= 1;

    try {
      const res = await fetch(`${provider.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${provider.key}`,
          Accept: "application/json",
          ...provider.extraHeaders,
        },
        body: JSON.stringify(upstreamBody),
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });

      if (res.ok) {
        let data: unknown;
        try {
          data = await res.json();
        } catch (error) {
          return {
            type: 'retryable-error',
            status: res.status,
            message: 'The OCR service returned an unreadable response.',
            providerName: provider.name,
            detail: String(error),
          };
        }

        const tokens = usedTokens(data);
        const choices = (data as { choices?: Array<{ finish_reason?: unknown }> } | null)
          ?.choices;
        const isTruncated = choices?.[0]?.finish_reason === 'length';

        return {
          type: 'success',
          data,
          providerName: provider.name,
          model: provider.model,
          tokensUsed: tokens,
          isTruncated,
        };
      }

      const detailText = await res.text().catch(() => "");
      
      if (provider.retryOnReject && res.status === 400 && attemptsRemaining > 0) {
        let parsed: unknown = null;
        try { parsed = JSON.parse(detailText); } catch {}
        const retry = retryWithoutRejectedParam(upstreamBody, parsed);
        if (retry) {
          upstreamBody = retry.body;
          continue;
        }
      }

      if (res.status === 413) {
        return {
          type: 'permanent-error',
          status: 413,
          message: 'This document is too large to extract.',
          providerName: provider.name,
          detail: detailText,
          payloadTooLarge: true,
        };
      }

      const retryableStatuses = [408, 429, 500, 502, 503, 504];
      const isRetryable = retryableStatuses.includes(res.status);

      if (isRetryable) {
        return {
          type: 'retryable-error',
          status: res.status,
          message: 'The extraction service could not read this document. Try again in a moment.',
          providerName: provider.name,
          detail: detailText,
        };
      } else {
        return {
          type: 'permanent-error',
          status: res.status,
          message: 'The extraction service refused the request.',
          providerName: provider.name,
          detail: detailText,
          payloadTooLarge: false,
        };
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const isTimeout = error instanceof DOMException && error.name === 'TimeoutError';
      const isNetwork = reason.toLowerCase().includes('fetch') || reason.toLowerCase().includes('network');
      
      if (isTimeout || isNetwork) {
        return {
          type: 'retryable-error',
          status: null,
          message: 'Could not reach the extraction service. Try again in a moment.',
          providerName: provider.name,
          detail: reason,
        };
      }

      return {
        type: 'permanent-error',
        status: null,
        message: 'A fatal error occurred calling the extraction service.',
        providerName: provider.name,
        detail: reason,
        payloadTooLarge: false,
      };
    }
  }

  return {
    type: 'permanent-error',
    status: null,
    message: 'Could not reach the OCR service.',
    providerName: provider.name,
    detail: 'Exhausted upstream attempts',
    payloadTooLarge: false,
  };
}

export async function executeOcrRequest(
  env: OcrProviderEnv,
  tier: Tier,
  payload: OcrRequestPayload,
): Promise<OcrProviderResult> {
  const awsConfig = resolveAwsConfig(env);
  const part = awsConfig ? readDocumentPart(payload) : null;
  const bedrockModel = env.AWS_BEDROCK_MODEL?.trim();

  // 1. Escalation Tier (High-Accuracy)
  if (tier === 'escalation') {
    const preferred = env.HIGH_ACCURACY_PROVIDER;
    if (preferred === 'openai') {
      const openaiProvider = resolveProvider(env, 'escalation');
      if (!('type' in openaiProvider)) {
        const res = await callChatProvider(openaiProvider, payload);
        if (res.type === 'success') return res;
      }
      if (awsConfig && part && bedrockModel) {
        return runBedrock(awsConfig, bedrockModel, part);
      }
      const errProvider = resolveProvider(env, 'escalation');
      if ('type' in errProvider) return errProvider;
      return callChatProvider(errProvider, payload);
    }

    // Default or preferred is Bedrock if configured
    if (awsConfig && part && bedrockModel) {
      const result = await runBedrock(awsConfig, bedrockModel, part);
      if (result.type === 'success') return result;
      // If Bedrock failed, try OpenAI if configured before giving up
      const openaiProvider = resolveProvider(env, 'escalation');
      if (!('type' in openaiProvider)) {
        console.warn(`[ocr-provider] Bedrock failed; falling back to OpenAI escalation`);
        return callChatProvider(openaiProvider, payload);
      }
      return result;
    }

    // Bedrock not configured, try OpenAI
    const openaiProvider = resolveProvider(env, 'escalation');
    if (!('type' in openaiProvider)) {
      return callChatProvider(openaiProvider, payload);
    }

    return { type: 'config-error', message: 'OCR escalation is not configured on this deployment.' };
  }

  // 2. Default Tier
  const defaultPref = env.DEFAULT_TIER_PROVIDER;
  if (defaultPref === 'bedrock' && awsConfig && part && bedrockModel) {
    const res = await runBedrock(awsConfig, bedrockModel, part);
    if (res.type === 'success') return res;
  } else if (defaultPref === 'openai') {
    const openaiProvider = resolveProvider(env, 'escalation');
    if (!('type' in openaiProvider)) {
      const res = await callChatProvider(openaiProvider, payload);
      if (res.type === 'success') return res;
    }
  }

  // Default Hunyuan tier
  if (env.HUNYUAN_API_KEY) {
    const hunyuanProvider = resolveProvider(env, 'default');
    if (!('type' in hunyuanProvider)) {
      const res = await callChatProvider(hunyuanProvider, payload);
      if (res.type === 'success') return res;
      console.warn(`[ocr-provider] Hunyuan default tier failed (${res.type}); attempting fallback`);
    }
  }

  // Fallbacks for default tier if Hunyuan wasn't configured or failed:
  if (awsConfig && part) {
    if (bedrockModel) {
      const result = await runBedrock(awsConfig, bedrockModel, part);
      if (result.type === 'success') return result;
    }
    const textractRes = await runTextract(awsConfig, part, payload.mode);
    if (textractRes.type === 'success') return textractRes;
    if (textractRes.type === 'permanent-error' && textractRes.payloadTooLarge) return textractRes;
  }

  const fallbackProvider = resolveProvider(env, 'default');
  if (!('type' in fallbackProvider)) {
    return callChatProvider(fallbackProvider, payload);
  }

  return { type: 'config-error', message: 'OCR is not configured on this deployment.' };
}
