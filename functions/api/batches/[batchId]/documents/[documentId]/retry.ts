import { fail, json, type AppEnv } from '../../../../../../server/http';
import {
  authHeaders,
  intParam,
  requireSession,
} from '../../../../../../server/guard';
import {
  findOwnedDocument,
  refreshBatchStatus,
} from '../../../../../../server/batches';

/**
 * Puts a document back in the queue and clears its previous outcome.
 *
 * When a queue consumer is bound, the message is re-sent here -- previously this
 * only reset the row to 'queued' and returned, so on a deployment with the queue
 * enabled a retry moved the document into a state nothing would ever pick up, and
 * it sat there while the batch reported itself as still processing. Without the
 * binding the client re-runs extraction itself and posts to .../result.
 *
 * `attempts` is reset because this is a human asking again, not the automatic
 * recovery in server/stuck-documents.ts working through its budget.
 */
export const onRequestPost: PagesFunction<AppEnv> = async ({
  request,
  env,
  params,
}) => {
  const auth = await requireSession(request, env);
  if (auth instanceof Response) return auth;

  const batchId = intParam(params.batchId);
  const documentId = intParam(params.documentId);
  if (batchId === null || documentId === null) {
    return fail('Invalid batch or document id.', 400);
  }

  const owned = await findOwnedDocument(env, auth.user.id, batchId, documentId);
  if (!owned) return fail('Document not found.', 404);

  await env.DB.batch([
    env.DB.prepare(
      `UPDATE documents
          SET status = 'queued', error = NULL, ocr_text = NULL,
              overall_confidence = NULL, completed_at = NULL,
              started_at = NULL, attempts = 0
        WHERE id = ?`,
    ).bind(documentId),
    env.DB.prepare(`DELETE FROM document_fields WHERE document_id = ?`).bind(
      documentId,
    ),
  ]);

  await refreshBatchStatus(env, batchId);

  let asyncProcessing = false;
  if (env.OCR_QUEUE) {
    try {
      await env.OCR_QUEUE.send({ batchId, documentId, userId: auth.user.id });
      asyncProcessing = true;
    } catch (error) {
      // The row is queued either way. Reporting asyncProcessing: false tells the
      // client to run the extraction itself rather than wait for a worker that
      // was never told about it.
      console.error('[api/documents/retry] could not enqueue the document:', error);
    }
  }

  return json(
    { ok: true, objectPath: owned.object_path ?? null, asyncProcessing },
    200,
    authHeaders(auth),
  );
};
