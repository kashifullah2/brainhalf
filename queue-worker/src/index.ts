// ---------------------------------------------------------------------------
// Background OCR consumer.
//
// Reads one message per document from the brainhalf-ocr-queue, extracts it and
// writes the result. This is what makes "upload, close the tab, come back later"
// true: without a consumer bound, functions/api/batches/index.ts reports
// `asyncProcessing: false` and the browser drives extraction instead.
//
// Everything about parsing and scoring is imported from server/, not
// reimplemented. The previous version carried its own copy of the parse-and-
// persist pipeline and the copies had drifted in ways that changed stored data:
//
//   * it set no per-field confidence at all, so sanitizeFields() defaulted every
//     field to 0 and every queue-processed document arrived in the review queue
//     flagged, however clean the extraction was;
//   * it had no `fulltext` branch, so a plain-text transcription was stored as
//     one unnamed field rather than the Image Description / Full Text
//     Transcription pair the browser path produces;
//   * it never looked at the provider's own certainty signal.
//
// See server/extraction-to-fields.ts.
// ---------------------------------------------------------------------------

import { executeOcrRequest } from '../../server/ocr-provider';
import { extractModelConfidence } from '../../server/confidence';
import { parseExtraction } from '../../server/extraction-to-fields';
import {
  sanitizeFields,
  computeOverallConfidence,
  buildDocumentResultStatements,
} from '../../server/document-results';
import { buildUpstreamRequest, isOcrMode, OCR_DOCUMENT_TYPES, type OcrMode } from '../../server/ocr-prompts';
import { refreshBatchStatus } from '../../server/batches';
import { MAX_ATTEMPTS, STUCK_AFTER_MINUTES } from '../../server/stuck-documents';
import { DEFAULT_CONFIDENCE_THRESHOLD } from '../../server/threshold';
import type { AppEnv } from '../../server/http';
import type { OcrProviderResult } from '../../server/ocr-provider';
import type { ParsedExtraction } from '../../server/extraction-to-fields';

/**
 * The bindings and secrets the consumer needs. Shaped as AppEnv so the shared
 * server/ modules can be called with it directly rather than through an `as any`
 * cast, which is what previously hid the fact that the worker had no AWS
 * variables declared at all while server/ocr-provider.ts read five of them.
 */
export interface Env extends AppEnv {
  DB: D1Database;
  DOCUMENTS: R2Bucket;
}

export interface OcrQueueMessage {
  batchId: number;
  documentId: number;
  userId: string;
}

/** Chunk for base64 encoding. Small enough that the spread never overflows. */
const BASE64_CHUNK = 8192;

const ALLOWED_CONTENT_TYPES: ReadonlySet<string> = new Set(OCR_DOCUMENT_TYPES);

/**
 * Marks a fault as worth redelivering. Thrown for upstream 5xx/429/timeouts;
 * anything else fails the document permanently so the batch reaches a terminal
 * state instead of cycling.
 */
class TransientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransientError';
  }
}

interface DocumentRow {
  id: number;
  object_path: string | null;
  content_type: string;
  filename: string;
  status: string;
  attempts: number;
  engine_type: string;
  prompt: string | null;
  /** NULL when the owner never changed it; DEFAULT_CONFIDENCE_THRESHOLD then. */
  confidence_threshold: number | null;
}

export default {
  async queue(batch: MessageBatch<OcrQueueMessage>, env: Env): Promise<void> {
    // Sequential on purpose. Each document holds its whole file in memory as
    // bytes and again as base64, and the isolate has 128 MB -- ten 14 MB PDFs in
    // parallel would not fit. Throughput comes from queue concurrency (multiple
    // consumer invocations), which Cloudflare scales on its own.
    for (const message of batch.messages) {
      try {
        await processDocument(message.body, env);
        message.ack();
      } catch (error) {
        const transient = error instanceof TransientError;
        console.error(
          `[processor] document ${message.body.documentId} ${transient ? 'failed transiently' : 'failed'}:`,
          error,
        );
        if (transient) {
          message.retry();
        } else {
          // The row is already marked 'failed' with a reason. Redelivering would
          // repeat the same failure and cost another upstream call.
          message.ack();
        }
      }
    }
  },
};

async function processDocument(msg: OcrQueueMessage, env: Env): Promise<void> {
  const { batchId, documentId, userId } = msg;

  // The join is the ownership check: a message naming someone else's document
  // resolves to nothing.
  const row = await env.DB.prepare(
    `SELECT d.id, d.object_path, d.content_type, d.filename, d.status, d.attempts,
            b.engine_type, b.prompt, s.confidence_threshold
       FROM documents d
       JOIN batches b ON b.id = d.batch_id
       LEFT JOIN user_settings s ON s.user_id = b.user_id
      WHERE d.id = ? AND d.batch_id = ? AND b.user_id = ?`,
  )
    .bind(documentId, batchId, userId)
    .first<DocumentRow>();

  if (!row) {
    console.warn(`[processor] document ${documentId} not found for user ${userId}; dropping message`);
    return;
  }

  if (row.status === 'completed' || row.status === 'failed' || row.status === 'cancelled') {
    // Terminal. A redelivery here is a duplicate, not work to redo -- and for
    // 'cancelled' it is a message that was already in the queue when the owner
    // stopped the batch. Returning normally ack()s it, which is what un-queues it:
    // there is no API to withdraw a message, so the consumer discarding it is how
    // a cancel actually takes effect for work already in flight.
    return;
  }

  if (row.attempts >= MAX_ATTEMPTS) {
    await failDocument(env, batchId, documentId, `Extraction did not finish after ${MAX_ATTEMPTS} attempts.`);
    return;
  }

  // Claim the document. The WHERE clause is the lock: two consumers racing the
  // same message cannot both get changes = 1.
  //
  // A row already 'processing' is claimable once it is older than the stuck
  // threshold. That case is exactly a consumer that died mid-document, and the
  // previous guard returned early on it and then ack()ed -- so the retry threw
  // the work away and the document stayed 'processing' for ever.
  const claim = await env.DB.prepare(
    `UPDATE documents
        SET status = 'processing',
            started_at = datetime('now'),
            attempts = attempts + 1,
            error = NULL
      WHERE id = ?
        AND (status = 'queued'
             OR (status = 'processing'
                 AND (started_at IS NULL OR started_at < datetime('now', ?))))`,
  )
    .bind(documentId, `-${STUCK_AFTER_MINUTES} minutes`)
    .run();

  if ((claim.meta.changes ?? 0) === 0) {
    // Another invocation holds it and has not been running long enough to be
    // considered stuck.
    return;
  }

  await refreshBatchStatus(env, batchId);

  try {
    if (!row.object_path) {
      throw new Error('The uploaded file is missing from this document.');
    }
    if (!ALLOWED_CONTENT_TYPES.has(row.content_type)) {
      throw new Error(`Unsupported file type (${row.content_type}).`);
    }

    const object = await env.DOCUMENTS.get(row.object_path);
    if (!object) {
      throw new Error('The uploaded file is no longer in storage.');
    }

    const dataUrl = `data:${row.content_type};base64,${toBase64(await object.arrayBuffer())}`;

    const mode = isOcrMode(row.engine_type) ? row.engine_type : 'invoice';
    const upstream = buildUpstreamRequest(mode, row.prompt ?? undefined, {
      contentType: row.content_type,
      dataUrl,
      filename: row.filename,
    });

    const threshold = row.confidence_threshold ?? DEFAULT_CONFIDENCE_THRESHOLD;

    const first = parseOrThrow(
      await executeOcrRequest(env, 'default', {
        messages: upstream.messages,
        jsonObject: upstream.jsonObject,
        mode,
      }),
      mode,
    );

    // Escalation, matching extractWithEscalation() in src/lib/api-client.ts.
    // Without it a queue deployment never re-read a low-confidence page, so the
    // premium tier the product advertises simply did not run for anyone who had
    // the worker enabled -- the same document got a second reading in the browser
    // path and only one in the background path.
    let best = first;
    if (best.fields.length > 0 && documentConfidence(best) < threshold) {
      try {
        const retry = parseOrThrow(
          await executeOcrRequest(env, 'escalation', {
            messages: upstream.messages,
            jsonObject: upstream.jsonObject,
            mode,
          }),
          mode,
        );
        if (retry.fields.length > 0 && documentConfidence(retry) > documentConfidence(best)) {
          best = retry;
        }
      } catch (error) {
        // A failed escalation is not a failed document: the default-tier reading
        // stands. The premium daily quota may simply be spent.
        console.warn(`[processor] escalation re-read failed for document ${documentId}:`, error);
      }
    }

    const parsed = best;
    const content = parsed.rawText;
    const fields = sanitizeFields(parsed.fields);
    const overallConfidence = computeOverallConfidence(undefined, fields);

    await env.DB.batch(
      buildDocumentResultStatements(
        env.DB,
        documentId,
        userId,
        content,
        overallConfidence,
        fields,
      ),
    );
  } catch (error) {
    if (error instanceof TransientError) {
      // Back to 'queued' so the redelivery can claim it, and so the batch reads
      // as still working rather than stalled.
      await env.DB.prepare(
        `UPDATE documents SET status = 'queued', started_at = NULL, error = ? WHERE id = ?`,
      )
        .bind(error.message.slice(0, 500), documentId)
        .run();
      await refreshBatchStatus(env, batchId);
      throw error;
    }

    const message = error instanceof Error ? error.message : String(error);
    await failDocument(env, batchId, documentId, message);
    // Swallowed deliberately: the caller ack()s a permanent failure, and the row
    // already carries the reason the user will see.
    return;
  }

  await refreshBatchStatus(env, batchId);
}

async function failDocument(
  env: Env,
  batchId: number,
  documentId: number,
  message: string,
): Promise<void> {
  await env.DB.prepare(`UPDATE documents SET status = 'failed', error = ? WHERE id = ?`)
    .bind(message.slice(0, 500), documentId)
    .run();
  await refreshBatchStatus(env, batchId);
}

/**
 * Turns a provider result into fields, or throws the right kind of error.
 *
 * The same two inputs the browser path uses, so the same document scores the same
 * however it was processed. There is no image-quality measurement here: that needs
 * a canvas, and calculateFieldConfidence() drops the dimension rather than
 * substituting a number for one that was never taken.
 */
function parseOrThrow(result: OcrProviderResult, mode: OcrMode): ParsedExtraction {
  if (result.type === 'retryable-error') {
    throw new TransientError(`${result.message} (${result.detail.slice(0, 200)})`);
  }
  if (result.type === 'config-error') {
    // Not this document's fault, and redelivering will not fix it -- but a
    // deployment change will, so retry rather than fail the document for good.
    throw new TransientError(result.message);
  }
  if (result.type === 'permanent-error') {
    throw new Error(`${result.message} (${result.detail.slice(0, 200)})`);
  }

  const data = result.data as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content ?? '';
  return parseExtraction(content, mode, extractModelConfidence(result.data));
}

/** Mean field confidence, which is what the review threshold is compared against. */
function documentConfidence(parsed: ParsedExtraction): number {
  if (parsed.fields.length === 0) return 0;
  return (
    parsed.fields.reduce((sum, field) => sum + field.confidence, 0) / parsed.fields.length
  );
}

/**
 * Chunked base64. The naive version was `binary += String.fromCharCode(byte)`
 * per byte, which is quadratic on a multi-megabyte file and was enough to blow
 * the worker's CPU budget on a normal PDF.
 */
function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += BASE64_CHUNK) {
    parts.push(String.fromCharCode(...bytes.subarray(i, i + BASE64_CHUNK)));
  }
  return btoa(parts.join(''));
}
