import { json, fail, readJson, type AppEnv } from '../../../server/http';
import { authHeaders } from '../../../server/guard';
import { requireAdmin } from '../../../server/admin';
import { buildUpstreamRequest, isOcrMode, type OcrMode } from '../../../server/ocr-prompts';
import {
  executeOcrRequest,
  runBedrock,
  runTextract,
  readDocumentPart,
  resolveProvider,
  callChatProvider,
  type Tier,
} from '../../../server/ocr-provider';
import { resolveAwsConfig } from '../../../server/aws-ocr';
import { getMergedOcrEnv } from '../../../server/system-settings';
import { parseExtraction } from '../../../server/extraction-to-fields';

// Synthetic 320x120 valid document image for test extractions
const SAMPLE_PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAUAAAAB4CAAAAACmpXQCAAABMUlEQVR4nO3YsRGDMBQFQUqg/2ZNQOpAzDGSMbsVSBf9eduHZFv9gKcTMBIwEjASMBIwEjASMBIwEjASMBIwEjD6GnAP5n9hLQEjASMBIwEjASMBIwEjh3QkYCRgJGAkYCRgJGAkYCRgJGAkYCRgdPuY8LbRQcBIwEjASMBIwEjASMDIIR0JGAkYCRgJGAkYCRgJGAkYCRgJGAkYLRsTRs1Pco2AkYCRgJGAkYCRgJGAkUM6EjASMBIwEjASMBIwEjASMBIwEjASMPr5MWHU/HQnASMBIwEjASMBIwEjASOHdCRgJGAkYCRgJGAkYCRgJGAkYCRgJGD0N2PCKAEjASMBIwEjASMBIwGjKQEZJ2AkYCRgJGAkYCRgJGAkYCRgJGAkYCRgJGAkYCRgJGAkYHQA7NAFcNggZZMAAAAASUVORK5CYII=';

function formatSuccess(
  res: { data: unknown; providerName: string; model: string; tokensUsed: number | null },
  mode: OcrMode,
  latencyMs: number,
  tier?: Tier,
) {
  let fields: Array<{ label: string; value: string; confidence: number }> = [];
  let rawContent: string | null = null;

  try {
    const choices = (res.data as { choices?: Array<{ message?: { content?: unknown } }> })
      ?.choices;
    if (choices?.[0]?.message?.content) {
      rawContent = String(choices[0].message.content);
    } else if (typeof res.data === 'string') {
      rawContent = res.data;
    } else {
      rawContent = JSON.stringify(res.data, null, 2);
    }
  } catch {
    rawContent = String(res.data);
  }

  if (rawContent) {
    try {
      const parsed = parseExtraction(rawContent, mode);
      fields = parsed.fields.map((f) => ({
        label: f.originalLabel,
        value: f.value,
        confidence: f.confidence,
      }));
    } catch {
      // If parsing fields throws, raw reply still displays
    }
  }

  return {
    success: true,
    provider: res.providerName,
    model: res.model,
    tier,
    latencyMs,
    tokensUsed: res.tokensUsed ?? 0,
    fields,
    preview: rawContent ? rawContent.slice(0, 1500) : null,
    error: null,
  };
}

export const onRequestPost: PagesFunction<AppEnv> = async ({ request, env }) => {
  const auth = await requireAdmin(request, env);
  if (auth instanceof Response) return auth;

  const body = await readJson<{
    tier?: Tier;
    provider?: 'hunyuan' | 'bedrock' | 'textract' | 'openai';
    model?: string;
    customPrompt?: string;
    mode?: string;
    document?: {
      contentType: string;
      dataUrl: string;
      filename: string;
    };
  }>(request);

  const mergedEnv = await getMergedOcrEnv(env);
  const mode: OcrMode = body?.mode && isOcrMode(body.mode) ? body.mode : 'receipt';
  const doc =
    body?.document?.dataUrl && body.document.contentType
      ? body.document
      : {
          contentType: 'image/png',
          dataUrl: SAMPLE_PNG_DATA_URL,
          filename: 'diagnostic-test.png',
        };

  const upstream = buildUpstreamRequest(mode, body?.customPrompt, doc);

  const payload = {
    messages: upstream.messages,
    jsonObject: upstream.jsonObject,
    mode,
  };

  const startTime = performance.now();

  try {
    if (body?.provider === 'textract') {
      const awsConfig = resolveAwsConfig(mergedEnv);
      if (!awsConfig) {
        return json(
          {
            success: false,
            provider: 'aws-textract',
            model: 'textract',
            latencyMs: Math.round(performance.now() - startTime),
            error: 'AWS credentials are not configured on this deployment.',
          },
          200,
          authHeaders(auth),
        );
      }
      const part = readDocumentPart(payload);
      if (!part) {
        return fail('Failed to prepare document for Textract.', 400);
      }
      const res = await runTextract(awsConfig, part, mode);
      const latencyMs = Math.round(performance.now() - startTime);
      if (res.type === 'success') {
        return json(formatSuccess(res, mode, latencyMs), 200, authHeaders(auth));
      }
      return json(
        {
          success: false,
          provider: 'aws-textract',
          model: 'textract',
          latencyMs,
          error:
            (res as { message?: string; detail?: string }).message ||
            (res as { message?: string; detail?: string }).detail ||
            'Textract extraction failed.',
        },
        200,
        authHeaders(auth),
      );
    }

    if (body?.provider === 'bedrock') {
      const awsConfig = resolveAwsConfig(mergedEnv);
      const modelId =
        body?.model || mergedEnv.AWS_BEDROCK_MODEL || 'amazon.nova-lite-v1:0';
      if (!awsConfig) {
        return json(
          {
            success: false,
            provider: 'aws-bedrock',
            model: modelId,
            latencyMs: Math.round(performance.now() - startTime),
            error: 'AWS credentials are not configured on this deployment.',
          },
          200,
          authHeaders(auth),
        );
      }
      const part = readDocumentPart(payload);
      if (!part) {
        return fail('Failed to prepare document for Bedrock.', 400);
      }
      const res = await runBedrock(awsConfig, modelId, part);
      const latencyMs = Math.round(performance.now() - startTime);
      if (res.type === 'success') {
        return json(formatSuccess(res, mode, latencyMs), 200, authHeaders(auth));
      }
      return json(
        {
          success: false,
          provider: 'aws-bedrock',
          model: modelId,
          latencyMs,
          error:
            (res as { message?: string; detail?: string }).message ||
            (res as { message?: string; detail?: string }).detail ||
            'Bedrock extraction failed.',
        },
        200,
        authHeaders(auth),
      );
    }

    if (body?.provider === 'hunyuan') {
      const hunyuanEnv = {
        ...mergedEnv,
        HUNYUAN_MODEL: body?.model || mergedEnv.HUNYUAN_MODEL,
      };
      const provider = resolveProvider(hunyuanEnv, 'default');
      if ('type' in provider) {
        return json(
          {
            success: false,
            provider: 'hunyuan',
            model: body?.model || 'hunyuan-ocr',
            latencyMs: Math.round(performance.now() - startTime),
            error: 'message' in provider ? provider.message : 'Hunyuan is not configured.',
          },
          200,
          authHeaders(auth),
        );
      }
      const res = await callChatProvider(provider, payload);
      const latencyMs = Math.round(performance.now() - startTime);
      if (res.type === 'success') {
        return json(formatSuccess(res, mode, latencyMs), 200, authHeaders(auth));
      }
      return json(
        {
          success: false,
          provider: 'hunyuan',
          model: body?.model || 'hunyuan-ocr',
          latencyMs,
          error:
            (res as { message?: string; detail?: string }).message ||
            (res as { message?: string; detail?: string }).detail ||
            'Hunyuan extraction failed.',
        },
        200,
        authHeaders(auth),
      );
    }

    if (body?.provider === 'openai') {
      const openaiEnv = {
        ...mergedEnv,
        OPENAI_MODEL: body?.model || mergedEnv.OPENAI_MODEL,
      };
      const provider = resolveProvider(openaiEnv, 'escalation');
      if ('type' in provider) {
        return json(
          {
            success: false,
            provider: 'openai',
            model: body?.model || 'gpt-4o-mini',
            latencyMs: Math.round(performance.now() - startTime),
            error: 'message' in provider ? provider.message : 'OpenAI is not configured.',
          },
          200,
          authHeaders(auth),
        );
      }
      const res = await callChatProvider(provider, payload);
      const latencyMs = Math.round(performance.now() - startTime);
      if (res.type === 'success') {
        return json(formatSuccess(res, mode, latencyMs), 200, authHeaders(auth));
      }
      return json(
        {
          success: false,
          provider: 'openai',
          model: body?.model || 'gpt-4o-mini',
          latencyMs,
          error:
            (res as { message?: string; detail?: string }).message ||
            (res as { message?: string; detail?: string }).detail ||
            'OpenAI extraction failed.',
        },
        200,
        authHeaders(auth),
      );
    }

    // Default: Run active configured tier
    const tier: Tier = body?.tier === 'escalation' ? 'escalation' : 'default';
    const res = await executeOcrRequest(mergedEnv, tier, payload);
    const latencyMs = Math.round(performance.now() - startTime);

    if (res.type === 'success') {
      return json(formatSuccess(res, mode, latencyMs, tier), 200, authHeaders(auth));
    }

    return json(
      {
        success: false,
        provider: (res as { providerName?: string }).providerName || 'unknown',
        model: 'unknown',
        tier,
        latencyMs,
        error:
          (res as { message?: string; detail?: string }).message ||
          (res as { message?: string; detail?: string }).detail ||
          'Extraction failed.',
      },
      200,
      authHeaders(auth),
    );
  } catch (error) {
    const latencyMs = Math.round(performance.now() - startTime);
    return json(
      {
        success: false,
        provider: body?.provider || 'error',
        model: body?.model || 'error',
        latencyMs,
        error: error instanceof Error ? error.message : String(error),
      },
      200,
      authHeaders(auth),
    );
  }
};
