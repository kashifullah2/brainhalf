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

  try {
    await env.DB.batch(statements);
  } catch (error) {
    console.error('[api/documents/result] write failed:', error);
    return fail('Could not save the extraction result.', 500);
  }

  await refreshBatchStatus(env, batchId);

  return json({ ok: true, fieldCount: fields.length }, 200, authHeaders(auth));
};
