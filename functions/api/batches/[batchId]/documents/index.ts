import { fail, json, readJson, type AppEnv } from '../../../../../server/http';
import { authHeaders, intParam, requireSession } from '../../../../../server/guard';
import {
  MAX_DOCUMENTS_PER_BATCH,
  getBatchCapacity,
  insertDocuments,
  normalizeIncomingDocuments,
  refreshBatchStatus,
  type IncomingDocumentInput,
} from '../../../../../server/batches';

interface AppendBody {
  documents?: unknown;
}

/**
 * Appends documents to an existing batch.
 *
 * Shares normalisation and insertion with POST /api/batches via
 * server/batches.ts. Previously this file carried its own copy, and the copies
 * had drifted: this one enforced no document cap at all, so the 100-document
 * limit could be sidestepped by creating a one-document batch and appending to it
 * without bound.
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

  // Ownership first: 404 for both "missing" and "someone else's", so the response
  // cannot be used to probe which batch ids exist.
  const batch = await env.DB.prepare(
    `SELECT id, status, engine_type FROM batches WHERE id = ? AND user_id = ?`,
  )
    .bind(batchId, auth.user.id)
    .first<{ id: number; status: string; engine_type: string }>();

  if (!batch) return fail('Batch not found.', 404);

  const body = await readJson<AppendBody>(request);
  if (!body) return fail('Request body must be valid JSON.', 400);

  if (!Array.isArray(body.documents) || body.documents.length === 0) {
    return fail('A batch needs at least one document.', 400);
  }

  const incoming = normalizeIncomingDocuments(
    body.documents as IncomingDocumentInput[],
  );

  // Count and next free position in one query.
  const { count, nextPosition } = await getBatchCapacity(env, batchId);

  // The cap applies to the resulting total, not just to this request.
  if (count + incoming.length > MAX_DOCUMENTS_PER_BATCH) {
    return fail(
      `A batch can hold at most ${MAX_DOCUMENTS_PER_BATCH} documents, and this ` +
        `one already has ${count}.`,
      400,
    );
  }

  const created = await insertDocuments(
    env,
    auth.user.id,
    batchId,
    incoming,
    nextPosition,
  );

  // Recompute from the documents instead of guessing which prior statuses need
  // bumping. The hand-rolled version only handled 'completed' and 'failed', so a
  // 'partial' batch stayed 'partial' after an append and the UI never started
  // polling the newly queued rows.
  await refreshBatchStatus(env, batchId);

  return json(
    { id: batchId, mode: batch.engine_type, documents: created },
    201,
    authHeaders(auth),
  );
};
