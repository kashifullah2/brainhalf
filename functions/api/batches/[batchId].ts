import { fail, json, type AppEnv } from '../../../server/http';
import { authHeaders, intParam, requireSession } from '../../../server/guard';
import { getBatchDetail } from '../../../server/batches';

export const onRequestGet: PagesFunction<AppEnv> = async ({
  request,
  env,
  params,
}) => {
  const auth = await requireSession(request, env);
  if (auth instanceof Response) return auth;

  const batchId = intParam(params.batchId);
  if (batchId === null) return fail('Invalid batch id.', 400);

  const batch = await getBatchDetail(env, auth.user.id, batchId);
  // 404 for both "missing" and "someone else's", so the response cannot be used
  // to probe which batch ids exist.
  if (!batch) return fail('Batch not found.', 404);

  return json(batch, 200, authHeaders(auth));
};

export const onRequestDelete: PagesFunction<AppEnv> = async ({
  request,
  env,
  params,
}) => {
  const auth = await requireSession(request, env);
  if (auth instanceof Response) return auth;

  const batchId = intParam(params.batchId);
  if (batchId === null) return fail('Invalid batch id.', 400);

  // Collect the R2 keys before the rows disappear, otherwise the objects are
  // orphaned in the bucket and billed forever.
  const { results } = await env.DB.prepare(
    `SELECT d.object_path AS object_path
       FROM documents d
       JOIN batches b ON b.id = d.batch_id
      WHERE d.batch_id = ? AND b.user_id = ? AND d.object_path IS NOT NULL`,
  )
    .bind(batchId, auth.user.id)
    .all<{ object_path: string }>();

  const deletion = await env.DB.prepare(
    `DELETE FROM batches WHERE id = ? AND user_id = ?`,
  )
    .bind(batchId, auth.user.id)
    .run();

  if (deletion.meta.changes === 0) {
    return fail('Batch not found.', 404);
  }

  // documents and document_fields go with it via ON DELETE CASCADE.
  const keys = (results ?? []).map((row) => row.object_path);
  if (keys.length > 0) {
    try {
      await env.DOCUMENTS.delete(keys);
    } catch (error) {
      // The database is already consistent; a failed object cleanup is a
      // storage-cost problem, not a correctness one.
      console.error('[api/batches] R2 cleanup failed:', error);
    }
  }

  return json({ ok: true }, 200, authHeaders(auth));
};
