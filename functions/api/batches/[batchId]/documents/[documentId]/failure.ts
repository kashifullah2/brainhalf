import { fail, json, readJson, type AppEnv } from '../../../../../../server/http';
import {
  authHeaders,
  intParam,
  requireSession,
} from '../../../../../../server/guard';
import {
  findOwnedDocument,
  refreshBatchStatus,
} from '../../../../../../server/batches';

interface Body {
  error?: unknown;
}

/**
 * Records that extraction failed for one document. The batch stays usable and
 * the document can be retried individually — previously a single failure threw
 * out of the client loop and the whole batch was lost.
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

  const body = await readJson<Body>(request);
  const message =
    typeof body?.error === 'string' && body.error.trim()
      ? body.error.trim().slice(0, 1000)
      : 'Extraction failed.';

  await env.DB.prepare(
    `UPDATE documents SET status = 'failed', error = ? WHERE id = ?`,
  )
    .bind(message, documentId)
    .run();

  await refreshBatchStatus(env, batchId);

  return json({ ok: true }, 200, authHeaders(auth));
};
