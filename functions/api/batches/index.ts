import { fail, json, readJson, type AppEnv } from '../../../server/http';
import { authHeaders, requireSession } from '../../../server/guard';
import {
  MAX_DOCUMENTS_PER_BATCH,
  MAX_LISTED_BATCHES,
  insertDocuments,
  invalidObjectPath,
  listBatches,
  normalizeIncomingDocuments,
  type IncomingDocumentInput,
} from '../../../server/batches';

/** Matches MAX_PROMPT_LENGTH in functions/api/templates, so the two agree. */
const MAX_CUSTOM_PROMPT_LENGTH = 4000;

import { isOcrMode } from '../../../server/ocr-prompts';

interface CreateBody {
  mode?: unknown;
  customPrompt?: unknown;
  documents?: unknown;
}

function intQuery(url: URL, name: string): number | null {
  const raw = url.searchParams.get(name);
  if (raw === null || raw.trim() === '') return null;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

export const onRequestGet: PagesFunction<AppEnv> = async ({ request, env }) => {
  const auth = await requireSession(request, env);
  if (auth instanceof Response) return auth;

  const url = new URL(request.url);
  const limit = Math.min(
    intQuery(url, 'limit') ?? MAX_LISTED_BATCHES,
    MAX_LISTED_BATCHES,
  );
  const offset = intQuery(url, 'offset') ?? 0;

  const batches = await listBatches(env, auth.user.id, limit, offset);
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
  if (!isOcrMode(mode)) {
    return fail(`Unknown extraction mode: ${mode}.`, 400);
  }
  
  // Bounded like every other string this endpoint stores. Without a cap a single
  // request could put an unbounded blob in the row, and it is re-sent to the model
  // on every document in the batch.
  const customPrompt =
    typeof body.customPrompt === 'string' && body.customPrompt.trim().length > 0
      ? body.customPrompt.trim().slice(0, MAX_CUSTOM_PROMPT_LENGTH)
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

  // Every stored key must sit under this user's own prefix. See invalidObjectPath.
  const foreignPath = invalidObjectPath(incoming, auth.user.id);
  if (foreignPath) {
    console.error(
      `[api/batches] rejected a document claiming an object path outside its owner's prefix (user=${auth.user.id})`,
    );
    return fail('One of those documents references a file that is not yours.', 400);
  }

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

  let asyncProcessing = false;
  if (env.OCR_QUEUE) {
    try {
      const messages = created.map(doc => ({
        body: {
          batchId,
          documentId: doc.id,
          userId: auth.user.id,
        }
      }));
      // SendBatch allows up to 100 messages at a time
      for (let i = 0; i < messages.length; i += 100) {
        await env.OCR_QUEUE.sendBatch(messages.slice(i, i + 100));
      }
      asyncProcessing = true;
    } catch (err) {
      console.error("[api/batches] Error sending to OCR_QUEUE:", err);
    }
  }

  return json({ id: batchId, documents: created, asyncProcessing }, 201, authHeaders(auth));
};
