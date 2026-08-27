import { fail, json, readJson, type AppEnv } from '../../../server/http';
import { authHeaders, requireSession } from '../../../server/guard';
import {
  MAX_DOCUMENTS_PER_BATCH,
  insertDocuments,
  listBatches,
  normalizeIncomingDocuments,
  type IncomingDocumentInput,
} from '../../../server/batches';

const VALID_MODES = new Set([
  'invoice',
  'receipt',
  'fulltext',
  'keyvalue',
  'table',
  'handwriting',
  'multilingual',
  'custom',
  'vqa',
]);

interface CreateBody {
  mode?: unknown;
  customPrompt?: unknown;
  documents?: unknown;
}

export const onRequestGet: PagesFunction<AppEnv> = async ({ request, env }) => {
  const auth = await requireSession(request, env);
  if (auth instanceof Response) return auth;

  const batches = await listBatches(env, auth.user.id);
  return json(batches, 200, authHeaders(auth));
};

/**
 * Creates a batch with its documents in the 'queued' state. Extraction results
 * are posted per document afterwards, so a failure on document 7 no longer
 * discards documents 1-6 (which is what the old client-side loop did).
 *
 * Normalisation and insertion live in server/batches.ts, shared with the append
 * endpoint, so the two cannot drift apart again.
 */
export const onRequestPost: PagesFunction<AppEnv> = async ({ request, env }) => {
  const auth = await requireSession(request, env);
  if (auth instanceof Response) return auth;

  const body = await readJson<CreateBody>(request);
  if (!body) return fail('Request body must be valid JSON.', 400);

  const rawMode = typeof body.mode === 'string' ? body.mode.trim().slice(0, 32) : '';
  const mode = rawMode || 'invoice';
  if (!VALID_MODES.has(mode)) {
    return fail(`Unknown extraction mode: ${mode}.`, 400);
  }
  
  const customPrompt = typeof body.customPrompt === 'string' && body.customPrompt.trim().length > 0
    ? body.customPrompt.trim()
    : null;

  if (!Array.isArray(body.documents) || body.documents.length === 0) {
    return fail('A batch needs at least one document.', 400);
  }
  if (body.documents.length > MAX_DOCUMENTS_PER_BATCH) {
    return fail(
      `A batch can hold at most ${MAX_DOCUMENTS_PER_BATCH} documents.`,
      400,
    );
  }

  const incoming = normalizeIncomingDocuments(
    body.documents as IncomingDocumentInput[],
  );

  const batchInsert = await env.DB.prepare(
    `INSERT INTO batches (user_id, status, engine_type, prompt) VALUES (?, 'queued', ?, ?)`,
  )
    .bind(auth.user.id, mode, customPrompt)
    .run();

  const batchId = Number(batchInsert.meta.last_row_id);
  if (!Number.isInteger(batchId) || batchId <= 0) {
    console.error('[api/batches] could not determine new batch id');
    return fail('Could not create the batch.', 500);
  }

  const created = await insertDocuments(env, auth.user.id, batchId, incoming, 0);

  return json({ id: batchId, documents: created }, 201, authHeaders(auth));
};
