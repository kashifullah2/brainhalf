import { json, fail, readJson, type AppEnv } from '../../../server/http';
import { authHeaders } from '../../../server/guard';
import { requireAdmin } from '../../../server/admin';
import { buildUpstreamRequest } from '../../../server/ocr-prompts';
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

// Minimal 1x1 valid PNG data URL for fast diagnostics
const SAMPLE_PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

export const onRequestPost: PagesFunction<AppEnv> = async ({ request, env }) => {
  const auth = await requireAdmin(request, env);
  if (auth instanceof Response) return auth;

  const body = await readJson<{
    tier?: Tier;
    provider?: 'hunyuan' | 'bedrock' | 'textract' | 'openai';
    model?: string;
    customPrompt?: string;
  }>(request);

  const mergedEnv = await getMergedOcrEnv(env);
  const mode = 'receipt';
  const upstream = buildUpstreamRequest(mode, body?.customPrompt, {
    contentType: 'image/png',
    dataUrl: SAMPLE_PNG_DATA_URL,
    filename: 'diagnostic-test.png',
  });

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
      return json(
        {
          success: res.type === 'success',
          provider: 'aws-textract',
          model: res.type === 'success' ? res.model : 'textract',
          latencyMs,
          tokensUsed: res.type === 'success' ? res.tokensUsed : 0,
          preview:
            res.type === 'success' ? JSON.stringify(res.data, null, 2).slice(0, 500) : null,
          error:
            res.type !== 'success'
              ? (res as { message?: string; detail?: string }).message ||
                (res as { message?: string; detail?: string }).detail
              : null,
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
      return json(
        {
          success: res.type === 'success',
          provider: 'aws-bedrock',
          model: modelId,
          latencyMs,
          tokensUsed: res.type === 'success' ? res.tokensUsed : 0,
          preview:
            res.type === 'success' ? JSON.stringify(res.data, null, 2).slice(0, 500) : null,
          error:
            res.type !== 'success'
              ? (res as { message?: string; detail?: string }).message ||
                (res as { message?: string; detail?: string }).detail
              : null,
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
      return json(
        {
          success: res.type === 'success',
          provider: 'hunyuan',
          model: res.type === 'success' ? res.model : body?.model || 'hunyuan-ocr',
          latencyMs,
          tokensUsed: res.type === 'success' ? res.tokensUsed : 0,
          preview:
            res.type === 'success' ? JSON.stringify(res.data, null, 2).slice(0, 500) : null,
          error:
            res.type !== 'success'
              ? (res as { message?: string; detail?: string }).message ||
                (res as { message?: string; detail?: string }).detail
              : null,
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
      return json(
        {
          success: res.type === 'success',
          provider: 'openai',
          model: res.type === 'success' ? res.model : body?.model || 'gpt-4o-mini',
          latencyMs,
          tokensUsed: res.type === 'success' ? res.tokensUsed : 0,
          preview:
            res.type === 'success' ? JSON.stringify(res.data, null, 2).slice(0, 500) : null,
          error:
            res.type !== 'success'
              ? (res as { message?: string; detail?: string }).message ||
                (res as { message?: string; detail?: string }).detail
              : null,
        },
        200,
        authHeaders(auth),
      );
    }

    // Default: Run active configured tier
    const tier: Tier = body?.tier === 'escalation' ? 'escalation' : 'default';
    const res = await executeOcrRequest(mergedEnv, tier, payload);
    const latencyMs = Math.round(performance.now() - startTime);

    return json(
      {
        success: res.type === 'success',
        provider:
          res.type === 'success'
            ? res.providerName
            : (res as { providerName?: string }).providerName || 'unknown',
        model: res.type === 'success' ? res.model : 'unknown',
        tier,
        latencyMs,
        tokensUsed: res.type === 'success' ? res.tokensUsed : 0,
        preview:
          res.type === 'success' ? JSON.stringify(res.data, null, 2).slice(0, 500) : null,
        error:
          res.type !== 'success'
            ? (res as { message?: string; detail?: string }).message ||
              (res as { message?: string; detail?: string }).detail
            : null,
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
