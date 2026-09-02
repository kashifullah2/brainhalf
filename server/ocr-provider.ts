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

export type Tier = 'default' | 'escalation';

export interface OcrProviderEnv {
  HUNYUAN_API_KEY?: string;
  HUNYUAN_BASE_URL?: string;
  HUNYUAN_MODEL?: string;
  OPENAI_API_KEY?: string;
  OCR_API_KEY?: string;
  OPENAI_BASE_URL?: string;
  OPENAI_MODEL?: string;
}

export interface OcrRequestPayload {
  messages: Array<{ role: string; content: unknown[] }>;
  jsonObject: boolean;
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

interface ResolvedProvider {
  name: string;
  baseUrl: string;
  key: string;
  model: string;
  extraHeaders: Record<string, string>;
  buildBody: (input: OcrRequestPayload) => Record<string, unknown>;
  retryOnReject: boolean;
}

function resolveProvider(env: OcrProviderEnv, tier: Tier): ResolvedProvider | OcrProviderResult {
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

export async function executeOcrRequest(
  env: OcrProviderEnv,
  tier: Tier,
  payload: OcrRequestPayload
): Promise<OcrProviderResult> {
  const provider = resolveProvider(env, tier);
  if ('type' in provider) {
    return provider; // Config error
  }

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
            detail: String(error)
          };
        }

        const tokens = usedTokens(data);
        const choices = (data as any)?.choices;
        const isTruncated = choices?.[0]?.finish_reason === 'length';

        return {
          type: 'success',
          data,
          providerName: provider.name,
          model: provider.model,
          tokensUsed: tokens,
          isTruncated
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
          payloadTooLarge: true
        };
      }

      // Determine if error is retryable based on our H-1 logic
      const retryableStatuses = [408, 429, 500, 502, 503, 504];
      const isRetryable = retryableStatuses.includes(res.status);

      if (isRetryable) {
        return {
          type: 'retryable-error',
          status: res.status,
          message: 'The extraction service could not read this document. Try again in a moment.',
          providerName: provider.name,
          detail: detailText
        };
      } else {
        return {
          type: 'permanent-error',
          status: res.status,
          message: 'The extraction service refused the request.',
          providerName: provider.name,
          detail: detailText,
          payloadTooLarge: false
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
          detail: reason
        };
      }

      return {
        type: 'permanent-error',
        status: null,
        message: 'A fatal error occurred calling the extraction service.',
        providerName: provider.name,
        detail: reason,
        payloadTooLarge: false
      };
    }
  }

  return {
    type: 'permanent-error',
    status: null,
    message: 'Could not reach the OCR service.',
    providerName: provider.name,
    detail: 'Exhausted upstream attempts',
    payloadTooLarge: false
  };
}
