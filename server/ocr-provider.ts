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
  TextractClient, 
  DetectDocumentTextCommand,
  AnalyzeDocumentCommand,
  AnalyzeExpenseCommand 
} from "@aws-sdk/client-textract";
import {
  BedrockRuntimeClient,
  InvokeModelCommand
} from "@aws-sdk/client-bedrock-runtime";

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
  AWS_REGION?: string;
  AWS_BEDROCK_MODEL?: string;
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
  const awsKey = env.AWS_ACCESS_KEY_ID;
  const awsSecret = env.AWS_SECRET_ACCESS_KEY;
  const awsRegion = env.AWS_REGION || "us-east-1";

  if (awsKey && awsSecret) {
    // 1. AWS Bedrock Runtime AI Vision (Claude 3.5 Sonnet / Amazon Nova / Haiku)
    if (env.AWS_BEDROCK_MODEL || tier === 'escalation') {
      const bedrockModel = env.AWS_BEDROCK_MODEL || "anthropic.claude-3-5-sonnet-20241022-v2:0";
      console.log(`[ocr-provider] Using AWS Bedrock Model (${bedrockModel})...`);
      
      const bedrockClient = new BedrockRuntimeClient({
        region: awsRegion,
        credentials: {
          accessKeyId: awsKey,
          secretAccessKey: awsSecret,
        }
      });

      let base64Data = "";
      const msg = payload.messages[0];
      if (msg && Array.isArray(msg.content)) {
        const imgObj = msg.content.find((c: any) => c.type === 'image_url') as any;
        if (imgObj) base64Data = imgObj.image_url?.url || "";
        const fileObj = msg.content.find((c: any) => c.type === 'file') as any;
        if (fileObj) base64Data = fileObj.file?.file_data || "";
      }

      if (base64Data) {
        try {
          const base64Content = base64Data.split(",")[1]?.replace(/\s/g, "") || base64Data;
          const mimeType = base64Data.split(";")[0]?.split(":")[1] || "image/jpeg";
          
          let bodyPayload: any;
          if (bedrockModel.startsWith("anthropic.")) {
            bodyPayload = {
              anthropic_version: "bedrock-2023-05-31",
              max_tokens: 2048,
              messages: [
                {
                  role: "user",
                  content: [
                    {
                      type: "image",
                      source: {
                        type: "base64",
                        media_type: mimeType,
                        data: base64Content
                      }
                    },
                    {
                      type: "text",
                      text: "Extract all text, key fields, and tables from this document. Return ONLY valid, parseable JSON."
                    }
                  ]
                }
              ]
            };
          } else {
            bodyPayload = {
              messages: [
                {
                  role: "user",
                  content: [
                    {
                      image: {
                        format: mimeType.replace("image/", ""),
                        source: { bytes: base64Content }
                      }
                    },
                    { text: "Extract all text, key fields, and structured data from this image as JSON." }
                  ]
                }
              ]
            };
          }

          const command = new InvokeModelCommand({
            modelId: bedrockModel,
            contentType: "application/json",
            accept: "application/json",
            body: JSON.stringify(bodyPayload)
          });

          const res = await bedrockClient.send(command);
          const jsonString = new TextDecoder().decode(res.body);
          const parsedRes = JSON.parse(jsonString);

          let outputContent = "";
          if (bedrockModel.startsWith("anthropic.")) {
            outputContent = parsedRes.content?.[0]?.text || "";
          } else {
            outputContent = parsedRes.output?.message?.content?.[0]?.text || "";
          }

          if (outputContent) {
            const mockData = {
              choices: [{
                message: { content: outputContent },
                finish_reason: "stop"
              }],
              usage: { total_tokens: parsedRes.usage?.output_tokens || 0 }
            };

            return {
              type: 'success',
              data: mockData,
              providerName: 'aws-bedrock',
              model: bedrockModel,
              tokensUsed: parsedRes.usage?.output_tokens || 0,
              isTruncated: false
            };
          }
        } catch (err: any) {
          console.warn("[ocr-provider] Bedrock failed, falling back to AWS Textract:", err.message);
        }
      }
    }

    // 2. AWS Textract Native (Forms, Expenses, Tables, Text)
    console.log("[ocr-provider] Using AWS Textract backend...");
    const client = new TextractClient({
      region: awsRegion,
      credentials: {
        accessKeyId: awsKey,
        secretAccessKey: awsSecret,
      }
    });

    let base64Data = "";
    const msg = payload.messages[0];
    if (msg && Array.isArray(msg.content)) {
      const imgObj = msg.content.find((c: any) => c.type === 'image_url') as any;
      if (imgObj) base64Data = imgObj.image_url?.url || "";
      const fileObj = msg.content.find((c: any) => c.type === 'file') as any;
      if (fileObj) base64Data = fileObj.file?.file_data || "";
    }

    if (base64Data) {
      try {
        const base64Content = base64Data.split(",")[1]?.replace(/\s/g, "") || base64Data;
        const binaryString = atob(base64Content);
        const len = binaryString.length;
        const imageBytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
          imageBytes[i] = binaryString.charCodeAt(i);
        }

        let response: any = null;
        try {
          const expenseCommand = new AnalyzeExpenseCommand({
            Document: { Bytes: imageBytes }
          });
          response = await client.send(expenseCommand);
        } catch {}

        if (!response || !response.ExpenseDocuments?.length) {
          try {
            const analyzeCommand = new AnalyzeDocumentCommand({
              Document: { Bytes: imageBytes },
              FeatureTypes: ["FORMS", "TABLES"]
            });
            response = await client.send(analyzeCommand);
          } catch {
            const textCommand = new DetectDocumentTextCommand({
              Document: { Bytes: imageBytes }
            });
            response = await client.send(textCommand);
          }
        }

        const jsonResult: Record<string, any> = {
          _overall_confidence: 0.99
        };
        let rawTextLines: string[] = [];

        if (response.ExpenseDocuments && response.ExpenseDocuments.length > 0) {
          for (const expDoc of response.ExpenseDocuments) {
            if (expDoc.SummaryFields) {
              for (const f of expDoc.SummaryFields) {
                const k = f.Type?.Text || f.LabelDetection?.Text || "Field";
                const v = f.ValueDetection?.Text || "";
                if (k && v) jsonResult[k] = v;
              }
            }
          }
        }

        if (response.Blocks) {
          const blockMap = new Map<string, any>();
          const keyBlocks: any[] = [];
          for (const b of response.Blocks) {
            blockMap.set(b.Id, b);
            if (b.BlockType === "LINE" && b.Text) rawTextLines.push(b.Text);
            else if (b.BlockType === "KEY_VALUE_SET" && b.EntityTypes?.includes("KEY")) keyBlocks.push(b);
          }

          const getText = (resBlock: any) => {
            let t = "";
            if (resBlock?.Relationships) {
              for (const rel of resBlock.Relationships) {
                if (rel.Type === "CHILD") {
                  for (const childId of rel.Ids) {
                    const w = blockMap.get(childId);
                    if (w?.BlockType === "WORD") t += w.Text + " ";
                  }
                }
              }
            }
            return t.trim();
          };

          const getValueBlock = (kB: any) => {
            if (kB.Relationships) {
              for (const rel of kB.Relationships) {
                if (rel.Type === "VALUE") {
                  for (const valId of rel.Ids) return blockMap.get(valId);
                }
              }
            }
            return null;
          };

          for (const kB of keyBlocks) {
            const k = getText(kB);
            const vB = getValueBlock(kB);
            const v = vB ? getText(vB) : "";
            if (k && v) jsonResult[k] = v;
          }
        }

        const outputContent = Object.keys(jsonResult).length > 1
          ? JSON.stringify(jsonResult, null, 2)
          : rawTextLines.join("\n");

        // Return mock response for downstream consumption
        const mockData = {
          choices: [{
            message: { content: outputContent },
            finish_reason: "stop"
          }],
          usage: { total_tokens: 0 }
        };

        return {
          type: 'success',
          data: mockData,
          providerName: 'aws-textract',
          model: 'textract',
          tokensUsed: 0,
          isTruncated: false
        };
      } catch (err: any) {
        return {
          type: 'permanent-error',
          status: err.$metadata?.httpStatusCode || 500,
          message: 'Textract refused the request.',
          providerName: 'aws-textract',
          detail: err.message,
          payloadTooLarge: err.name === 'ValidationException'
        };
      }
    }
  }

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
