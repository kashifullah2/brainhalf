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
import {
  MAX_FIELDS,
  sanitizeFields,
  computeOverallConfidence,
  buildDocumentResultStatements
} from '../../../../../../server/document-results';



interface Body {
  ocrText?: unknown;
  overallConfidence?: unknown;
  fields?: unknown;
}



/**
 * Records a successful extraction. The client runs OCR through /api/ocr and
 * reports the outcome here, one document at a time, so progress is durable and
 * a mid-batch failure loses only the document that failed.
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

  // A cancelled document is finished, by the owner's own instruction. Writing a
  // result here would move it back to 'completed' and re-arm the batch, so the
  // extraction is discarded instead. `cancelled: true` tells the client's upload
  // loop to stop rather than keep spending upstream calls on the rest of a batch
  // the user has stopped.
  if (owned.status === 'cancelled') {
    return json({ ok: true, cancelled: true, fieldCount: 0 }, 200, authHeaders(auth));
  }

  const body = await readJson<Body>(request);
  if (!body) return fail('Request body must be valid JSON.', 400);

  const ocrText = typeof body.ocrText === 'string' ? body.ocrText : null;

  const rawFields = Array.isArray(body.fields) ? body.fields : [];
  if (rawFields.length > MAX_FIELDS) {
    return fail(`A document can hold at most ${MAX_FIELDS} fields.`, 400);
  }

  const fields = sanitizeFields(rawFields);
  const overallConfidence = computeOverallConfidence(body.overallConfidence, fields);
  const statements = buildDocumentResultStatements(env.DB, documentId, auth.user.id, ocrText, overallConfidence, fields);

  let applied: number;
  try {
    const results = await env.DB.batch(statements);
    // The first statement is the guarded UPDATE. Zero rows means the document was
    // cancelled after the check above, in which case the fields that were just
    // inserted belong to nothing and would otherwise show up in the review queue.
    applied = results[0]?.meta.changes ?? 0;
  } catch (error) {
    console.error('[api/documents/result] write failed:', error);
    return fail('Could not save the extraction result.', 500);
  }

  if (applied === 0) {
    await env.DB.prepare(`DELETE FROM document_fields WHERE document_id = ?`)
      .bind(documentId)
      .run();
    await refreshBatchStatus(env, batchId);
    return json({ ok: true, cancelled: true, fieldCount: 0 }, 200, authHeaders(auth));
  }

  await refreshBatchStatus(env, batchId);

  return json({ ok: true, fieldCount: fields.length }, 200, authHeaders(auth));
};
