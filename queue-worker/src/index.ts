import { executeOcrRequest } from '../../server/ocr-provider';
import { extractJsonBlock, flattenExtraction, takeMetaConfidence } from '../../server/extraction-parse';
import { sanitizeFields, computeOverallConfidence, buildDocumentResultStatements } from '../../server/document-results';
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
  if (docRow.status === 'completed' || docRow.status === 'failed' || docRow.status === 'processing') {
    return;
  }

  // Mark as processing atomically
  const updateResult = await env.DB.prepare(
    `UPDATE documents SET status = 'processing' WHERE id = ? AND status = 'queued'`
  ).bind(documentId).run();

  if (updateResult.meta.changes === 0) {
    console.warn(`[processor] Document ${documentId} is no longer queued. Skipping.`);
    return;
  }

  await refreshBatchStatus(env, batchId);

  try {
    // 2. Fetch object from R2
    if (!docRow.object_path) throw new Error("Document has no object path");
    const object = await env.DOCUMENTS.get(docRow.object_path);
    if (!object) throw new Error("Object not found in storage");

    const buffer = await object.arrayBuffer();
    // Convert to base64
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    const base64 = btoa(binary);
    const dataUrl = `data:${docRow.content_type};base64,${base64}`;

    // 3. Prepare upstream request
    const mode = isOcrMode(docRow.engine_type) ? (docRow.engine_type as OcrMode) : 'invoice';
    const upstream = buildUpstreamRequest(mode, docRow.prompt, {
      contentType: docRow.content_type,
      dataUrl,
      filename: docRow.filename,
    });

    const result = await executeOcrRequest(env as any, 'default', {
      messages: upstream.messages,
      jsonObject: upstream.jsonObject
    });

    let data: any = null;
    if (result.type === 'success') {
      data = result.data;
    } else if (result.type === 'retryable-error') {
      throw new Error(`Transient error: ${result.message} - ${result.detail}`);
    } else {
      const detail = result.type === 'permanent-error' ? result.detail : '';
      throw new Error(`${result.message} - ${detail}`);
    }

    // 4. Save results to DB
    const content = data.choices?.[0]?.message?.content || "";
    let extractedFields: Array<{normalizedField: string; originalLabel: string; value: string; confidence?: number}> = [];

    let jsonStr = extractJsonBlock(content);
    let globalConfidence: number | null = null;

    try {
      const parsed = JSON.parse(jsonStr.trim());
      if (Array.isArray(parsed)) {
        parsed.forEach((row, rowIndex) => {
          for (const [key, val] of flattenExtraction(row, `Row ${rowIndex + 1}`)) {
            extractedFields.push({
              normalizedField: key,
              originalLabel: key,
              value: val
            });
          }
        });
      } else if (typeof parsed === 'object' && parsed !== null) {
        const record = parsed as Record<string, unknown>;
        const meta = takeMetaConfidence(record);
        if (meta !== undefined) globalConfidence = meta;

        for (const [key, val] of flattenExtraction(record)) {
          extractedFields.push({
            normalizedField: key,
            originalLabel: key,
            value: val
          });
        }
      }
    } catch {
      // Not JSON or failed to parse, use full text
      extractedFields.push({
        normalizedField: "Full Text Transcription",
        originalLabel: "Transcription",
        value: content.trim()
      });
    }

    const safeFields = sanitizeFields(extractedFields);
    const overallConfidence = computeOverallConfidence(globalConfidence, safeFields);
    const stmts = buildDocumentResultStatements(env.DB, documentId, userId, content, overallConfidence, safeFields);

    if (stmts.length > 0) {
      await env.DB.batch(stmts);
    }

  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const isTransient = errorMsg.startsWith('Transient error:');

    const newStatus = isTransient ? 'queued' : 'failed';
    
    await env.DB.prepare(
      `UPDATE documents SET status = ?, error = ? WHERE id = ?`
    ).bind(newStatus, errorMsg.slice(0, 500), documentId).run();

    if (isTransient) {
      throw err;
    }
  } finally {
    // Refresh batch status
    await refreshBatchStatus(env, batchId);
  }
}




