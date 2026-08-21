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
 * Puts a document back in the queue and clears its previous outcome. The client
 * then re-runs extraction for it and posts to .../result.
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
              overall_confidence = NULL, completed_at = NULL
        WHERE id = ?`,
    ).bind(documentId),
    env.DB.prepare(`DELETE FROM document_fields WHERE document_id = ?`).bind(
      documentId,
    ),
  ]);

  await refreshBatchStatus(env, batchId);

  return json(
    { ok: true, objectPath: owned.object_path ?? null },
    200,
    authHeaders(auth),
  );
};
