import { buildModelParams, capabilitiesFor, retryWithoutRejectedParam, usedTokens } from '../../server/openai-params';
import { buildUpstreamRequest, isOcrMode, type OcrMode } from '../../server/ocr-prompts';
import { refreshBatchStatus } from '../../server/batches';

export interface Env {
  DB: D1Database;
  DOCUMENTS: R2Bucket;
  HUNYUAN_API_KEY?: string;
  HUNYUAN_BASE_URL?: string;
  HUNYUAN_MODEL?: string;
  OPENAI_API_KEY?: string;
  OCR_API_KEY?: string;
  OPENAI_BASE_URL?: string;
  OPENAI_MODEL?: string;
}

export interface OcrQueueMessage {
  batchId: number;
  documentId: number;
  userId: string;
}

const UPSTREAM_TIMEOUT_MS = 60_000;
const MAX_COMPLETION_TOKENS = 8192;
const UPSTREAM_TEMPERATURE = 0;
const UPSTREAM_SEED = 42;

export default {
  async queue(batch: MessageBatch<OcrQueueMessage>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      try {
        await processDocument(message.body, env);
        message.ack();
      } catch (err) {
        console.error(`[processor] Error processing document ${message.body.documentId}:`, err);
        // We do not ack() so it retries, unless we explicitly caught a non-recoverable error.
        // For simplicity, let's mark it as failed in DB and ack it if it's a permanent error.
        message.retry();
      }
    }
  },
};

async function processDocument(msg: OcrQueueMessage, env: Env) {
  const { batchId, documentId, userId } = msg;

  // 1. Fetch document and batch
  const docRow = await env.DB.prepare(
    `SELECT d.id, d.object_path, d.content_type, d.filename, d.status, b.engine_type, b.prompt
     FROM documents d
     JOIN batches b ON b.id = d.batch_id
     WHERE d.id = ? AND d.batch_id = ? AND b.user_id = ?`
  ).bind(documentId, batchId, userId).first<any>();

  if (!docRow) {
    console.warn(`[processor] Document ${documentId} not found or unauthorized.`);
    return;
  }

  // If already processing or completed, skip. (Could be a redelivered message)
  if (docRow.status === 'completed' || docRow.status === 'failed') {
    return;
  }

  // Mark as processing
  await env.DB.prepare(`UPDATE documents SET status = 'processing' WHERE id = ?`)
    .bind(documentId).run();
  await refreshBatchStatus(env, batchId);

  try {
    // 2. Fetch object from R2
    if (!docRow.object_path) throw new Error("Document has no object path");
    const object = await env.DOCUMENTS.get(docRow.object_path);
    if (!object) throw new Error("Object not found in storage");

    const buffer = await object.arrayBuffer();
    // Convert to base64
    const base64 = btoa(
      new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
    );
    const dataUrl = `data:${docRow.content_type};base64,${base64}`;

    // 3. Prepare upstream request
    const mode = isOcrMode(docRow.engine_type) ? (docRow.engine_type as OcrMode) : 'invoice';
    const upstream = buildUpstreamRequest(mode, docRow.prompt, {
      contentType: docRow.content_type,
      dataUrl,
      filename: docRow.filename,
    });

    // Determine provider
    const provider = resolveProvider(env);
    if (!provider) {
      throw new Error("No OCR provider configured in queue worker");
    }

    let upstreamBody: any = provider.buildBody(upstream);
    let attemptsRemaining = provider.retryOnReject ? 2 : 1;
    let data: any = null;

    while (attemptsRemaining > 0) {
      attemptsRemaining -= 1;
      
      const reqHeaders = new Headers();
      reqHeaders.set("Content-Type", "application/json");
      reqHeaders.set("Authorization", `Bearer ${provider.key}`);
      reqHeaders.set("Accept", "application/json");
      if (provider.extraHeaders) {
        for (const [k, v] of Object.entries(provider.extraHeaders)) {
          reqHeaders.set(k, v);
        }
      }

      const res = await fetch(`${provider.baseUrl}/chat/completions`, {
        method: "POST",
        headers: reqHeaders,
        body: JSON.stringify(upstreamBody),
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });

      if (res.ok) {
        data = await res.json();
        break;
      }

      const detailText = await res.text().catch(() => "");
      if (provider.retryOnReject && res.status === 400 && attemptsRemaining > 0) {
        try {
          const parsed = JSON.parse(detailText);
          const retry = retryWithoutRejectedParam(upstreamBody, parsed);
          if (retry) {
            upstreamBody = retry.body;
            continue;
          }
        } catch {}
      }
      throw new Error(`Upstream error ${res.status}: ${detailText}`);
    }

    if (!data) throw new Error("No data returned from provider");

    // 4. Save results to DB
    const content = data.choices?.[0]?.message?.content || "";
    let extracted = [];
    try {
      extracted = JSON.parse(content);
    } catch {
      // Not JSON, just fulltext maybe
    }

    // Insert fields
    if (Array.isArray(extracted) && extracted.length > 0) {
      const stmts = extracted.map((field: any, index: number) => {
        return env.DB.prepare(
          `INSERT INTO document_fields (document_id, position, normalized_field, original_label, value, confidence)
           VALUES (?, ?, ?, ?, ?, ?)`
        ).bind(
          documentId,
          index,
          field.normalizedField || field.label || `field_${index}`,
          field.label || field.normalizedField || `field_${index}`,
          typeof field.value === 'string' ? field.value : JSON.stringify(field.value),
          field.confidence ?? 1.0
        );
      });
      await env.DB.batch(stmts);
    }

    // Update document status
    await env.DB.prepare(
      `UPDATE documents SET status = 'completed', ocr_text = ?, error = NULL WHERE id = ?`
    ).bind(content, documentId).run();

  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    await env.DB.prepare(
      `UPDATE documents SET status = 'failed', error = ? WHERE id = ?`
    ).bind(errorMsg.slice(0, 500), documentId).run();
  } finally {
    // Refresh batch status
    await refreshBatchStatus(env, batchId);
  }
}

function resolveProvider(env: Env) {
  // Same logic as api/ocr.ts
  const hunyuanKey = env.HUNYUAN_API_KEY;
  if (hunyuanKey) {
    const hunyuanModel = env.HUNYUAN_MODEL || "hunyuan-ocr";
    return {
      name: 'hunyuan',
      baseUrl: (env.HUNYUAN_BASE_URL || "https://api.futureppo.top/v1").replace(/\/$/, ""),
      key: hunyuanKey,
      model: hunyuanModel,
      extraHeaders: { "User-Agent": "BrainHalf-OCR-Backend/1.0" },
      buildBody: (input: any) => ({
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
    const fallbackModel = env.OPENAI_MODEL || "gpt-5.4-mini";
    return {
      name: 'openai',
      baseUrl: (env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, ""),
      key: fallbackKey,
      model: fallbackModel,
      extraHeaders: {},
      buildBody: (input: any) => ({
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

  return null;
}
