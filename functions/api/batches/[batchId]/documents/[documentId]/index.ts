import { fail, json, type AppEnv } from '../../../../../../server/http';
import {
  authHeaders,
  intParam,
  requireSession,
} from '../../../../../../server/guard';
import {
  findOwnedDocument,
  getDocumentDetail,
  refreshBatchStatus,
} from '../../../../../../server/batches';

/**
 * One document, including its OCR text.
 *
 * GET /api/batches/:batchId returns every document but omits `ocrText`, because
 * shipping the raw text of a whole batch is megabytes the batch view never uses.
 * The document view asks for the one it is showing.
 */
export const onRequestGet: PagesFunction<AppEnv> = async ({
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

  const document = await getDocumentDetail(env, auth.user.id, batchId, documentId);
  if (!document) return fail('Document not found.', 404);

  return json(document, 200, authHeaders(auth));
};

/**
 * Removes one document from a batch, along with its extracted fields and its
 * stored source file.
 *
 * The UI had a "Delete" button for selected rows that only raised a toast
 * reading "Deleted selected rows" and cleared the selection — nothing was ever
 * removed, and the rows reappeared on refresh.
 */
export const onRequestDelete: PagesFunction<AppEnv> = async ({
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

  // document_fields go with it via ON DELETE CASCADE.
  await env.DB.prepare(`DELETE FROM documents WHERE id = ?`).bind(documentId).run();

  if (owned.object_path) {
    try {
      await env.DOCUMENTS.delete(owned.object_path);
    } catch (error) {
      // The row is already gone; a failed object cleanup is a storage-cost
      // problem, not a correctness one.
      console.error('[api/documents] R2 cleanup failed:', error);
    }
  }

  await refreshBatchStatus(env, batchId);

  return json({ ok: true }, 200, authHeaders(auth));
};
