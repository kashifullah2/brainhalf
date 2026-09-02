import { fail, json, readJson, type AppEnv } from '../../../../server/http';
import { authHeaders, intParam, requireSession } from '../../../../server/guard';

import { DEFAULT_CONFIDENCE_THRESHOLD } from '../../../../server/threshold';

interface Body {
  documentId?: unknown;
}

/**
 * Approves every still-unreviewed flagged field on a batch, or on one document
 * within it.
 *
 * Replaces a client-side fan-out: the review page used to PATCH each flagged
 * field individually, so approving one document was one HTTP request and one D1
 * write per field, and approving a batch multiplied that by the document count.
 * Any failure part-way through left the review half-applied. This is one
 * statement.
 */
export const onRequestPost: PagesFunction<AppEnv> = async ({
  request,
  env,
  params,
}) => {
  const auth = await requireSession(request, env);
  if (auth instanceof Response) return auth;

  const batchId = intParam(params.batchId);
  if (batchId === null) return fail('Invalid batch id.', 400);

  const body = (await readJson<Body>(request)) ?? {};

  let documentId: number | null = null;
  if (body.documentId !== undefined && body.documentId !== null) {
    const parsed = Number(body.documentId);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      return fail('Invalid document id.', 400);
    }
    documentId = parsed;
  }

  // 404 for both "missing" and "someone else's", so the response cannot be used
  // to probe which batch ids exist.
  const batch = await env.DB.prepare(
    `SELECT id FROM batches WHERE id = ? AND user_id = ?`,
  )
    .bind(batchId, auth.user.id)
    .first<{ id: number }>();

  if (!batch) return fail('Batch not found.', 404);

  const settings = await env.DB.prepare(
    `SELECT confidence_threshold FROM user_settings WHERE user_id = ?`,
  )
    .bind(auth.user.id)
    .first<{ confidence_threshold: number }>();

  const threshold = settings?.confidence_threshold ?? DEFAULT_CONFIDENCE_THRESHOLD;

  // Only the flagged fields, and only the ones nobody has ruled on yet: a field
  // already marked 'corrected' or 'rejected' must not be overwritten by a bulk
  // approve.
  const scope = documentId === null ? '' : 'AND id = ?';
  const binds: unknown[] = [auth.user.id, threshold, batchId];
  if (documentId !== null) binds.push(documentId);

  const result = await env.DB.prepare(
    `UPDATE document_fields
        SET review_status = 'approved', reviewed_at = datetime('now')
      WHERE user_id = ?
        AND review_status IS NULL
        AND confidence < ?
        AND document_id IN (
              SELECT id FROM documents WHERE batch_id = ? ${scope}
            )`,
  )
    .bind(...binds)
    .run();

  return json(
    { approved: result.meta.changes ?? 0 },
    200,
    authHeaders(auth),
  );
};
