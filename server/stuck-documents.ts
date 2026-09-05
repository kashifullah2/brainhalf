// ---------------------------------------------------------------------------
// Stuck-document detection and recovery.
//
// The document lifecycle is queued -> processing -> completed | failed, and until
// now it had no way out of 'processing'. Three things put a row there and left it:
//
//   * the queue consumer was evicted, restarted or timed out mid-document. The
//     redelivered message hit the guard at the top of processDocument(), which
//     returns early when the status is already 'processing', and then ack()ed --
//     so the retry actively discarded the work.
//   * the browser driving the synchronous path was closed between starting
//     extraction and posting the result.
//   * a queue send failed after the rows were inserted, so nothing ever picked
//     them up.
//
// refreshBatchStatus() reads 'processing' as "still working", so the batch never
// reached a terminal state and the UI polled it for ever.
//
// This sweep is deliberately shaped like the two already in this codebase
// (server/rate-limit.ts, server/storage-sweep.ts): probabilistic, bounded by
// LIMIT, never allowed to fail the request that triggered it. A Pages project has
// no scheduled handler to hang a cron off -- wrangler.toml here declares
// `pages_build_output_dir`, so `[triggers]` is not available.
// ---------------------------------------------------------------------------

import { refreshBatchStatus } from './batches';
import type { AppEnv } from './http';

/**
 * How long a document may sit in 'processing' before it is considered stuck.
 *
 * Comfortably above the worst case for one document: the upstream timeout in
 * server/ocr-provider.ts is 60s, and a queue message may be retried a few times
 * with backoff before the consumer gives up.
 */
export const STUCK_AFTER_MINUTES = 15;

/**
 * How many times a document may be handed back to the queue before it is failed
 * for good. Without a cap a document that reliably kills the consumer would be
 * requeued for ever, and each cycle costs an upstream call.
 */
export const MAX_ATTEMPTS = 3;

/** Roughly one call in every SWEEP_EVERY also runs the recovery. */
const SWEEP_EVERY = 25;
/** Rows touched per sweep. Bounds what any single request pays for. */
const SWEEP_BATCH = 50;

export interface StuckDocument {
  id: number;
  batch_id: number;
  user_id: string;
  attempts: number;
}

/**
 * Documents that have been 'processing' for longer than the threshold.
 *
 * `started_at IS NULL` is included: rows written before migration 0008 have no
 * start time, and a document that is 'processing' with no record of when it began
 * is by definition not being tracked by anything.
 */
export async function findStuckDocuments(
  env: Pick<AppEnv, 'DB'>,
  limit = SWEEP_BATCH,
): Promise<StuckDocument[]> {
  const { results } = await env.DB.prepare(
    `SELECT id, batch_id, user_id, attempts
       FROM documents
      WHERE status = 'processing'
        AND (started_at IS NULL OR started_at < datetime('now', ?))
      ORDER BY started_at
      LIMIT ?`,
  )
    .bind(`-${STUCK_AFTER_MINUTES} minutes`, limit)
    .all<StuckDocument>();

  return results ?? [];
}

export interface RecoveryOutcome {
  requeued: number;
  failed: number;
}

/**
 * Returns each stuck document to the queue, or fails it once it has used up its
 * attempts. Batches are refreshed afterwards so a batch whose last document just
 * became terminal stops reporting itself as 'processing'.
 */
export async function recoverStuckDocuments(
  env: AppEnv,
  limit = SWEEP_BATCH,
): Promise<RecoveryOutcome> {
  const stuck = await findStuckDocuments(env, limit);
  if (stuck.length === 0) return { requeued: 0, failed: 0 };

  const retryable = stuck.filter((doc) => doc.attempts < MAX_ATTEMPTS);
  const exhausted = stuck.filter((doc) => doc.attempts >= MAX_ATTEMPTS);

  const statements = [];
  if (retryable.length > 0) {
    statements.push(
      env.DB.prepare(
        `UPDATE documents
            SET status = 'queued', started_at = NULL,
                error = 'Extraction was interrupted and has been queued again.'
          WHERE id IN (${retryable.map(() => '?').join(', ')})`,
      ).bind(...retryable.map((doc) => doc.id)),
    );
  }
  if (exhausted.length > 0) {
    statements.push(
      env.DB.prepare(
        `UPDATE documents
            SET status = 'failed',
                error = 'Extraction did not finish after ${MAX_ATTEMPTS} attempts.'
          WHERE id IN (${exhausted.map(() => '?').join(', ')})`,
      ).bind(...exhausted.map((doc) => doc.id)),
    );
  }

  await env.DB.batch(statements);

  // Re-send only what was requeued, and only when there is a consumer. Without a
  // queue binding the synchronous client path owns extraction, and the reset to
  // 'queued' is enough for the batch page to offer a retry.
  if (env.OCR_QUEUE && retryable.length > 0) {
    const messages = retryable.map((doc) => ({
      body: { batchId: doc.batch_id, documentId: doc.id, userId: doc.user_id },
    }));
    for (let i = 0; i < messages.length; i += 100) {
      await env.OCR_QUEUE.sendBatch(messages.slice(i, i + 100));
    }
  }

  // One recompute per affected batch, through the same helper every document
  // transition uses, so the aggregate cannot drift from its documents.
  const batchIds = [...new Set(stuck.map((doc) => doc.batch_id))];
  for (const batchId of batchIds) {
    await refreshBatchStatus(env, batchId);
  }

  return { requeued: retryable.length, failed: exhausted.length };
}

/** The opportunistic entry point. Never throws. */
export async function maybeRecoverStuckDocuments(env: AppEnv): Promise<void> {
  if (!env.DB) return;
  if (Math.floor(Math.random() * SWEEP_EVERY) !== 0) return;

  try {
    const outcome = await recoverStuckDocuments(env);
    if (outcome.requeued > 0 || outcome.failed > 0) {
      console.warn(
        `[stuck-documents] recovered ${outcome.requeued} interrupted document(s), failed ${outcome.failed} past the attempt limit`,
      );
    }
  } catch (error) {
    // A failed sweep must not fail the request it was hung off.
    console.error('[stuck-documents] recovery failed:', error);
  }
}
