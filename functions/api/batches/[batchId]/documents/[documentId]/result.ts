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

interface IncomingField {
  normalizedField?: unknown;
  originalLabel?: unknown;
  value?: unknown;
  confidence?: unknown;
}

interface Body {
  ocrText?: unknown;
  overallConfidence?: unknown;
  fields?: unknown;
}

/** A single document cannot be allowed to blow up the row count. */
const MAX_FIELDS = 300;
const MAX_VALUE_CHARS = 8_000;
const MAX_OCR_TEXT_CHARS = 200_000;

function clampConfidence(value: unknown): number {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  return Math.min(1, Math.max(0, numeric));
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

  const ocrText =
    typeof body.ocrText === 'string'
      ? body.ocrText.slice(0, MAX_OCR_TEXT_CHARS)
      : null;

  const rawFields = Array.isArray(body.fields) ? body.fields : [];
  if (rawFields.length > MAX_FIELDS) {
    return fail(`A document can hold at most ${MAX_FIELDS} fields.`, 400);
  }

  // Deduplicate by field name: document_fields has a UNIQUE(document_id,
  // normalized_field) constraint, and a model can repeat a key.
  const seen = new Set<string>();
  const fields: Array<{
    normalizedField: string;
    originalLabel: string;
    value: string;
    confidence: number;
  }> = [];

  for (const raw of rawFields as IncomingField[]) {
    const name =
      typeof raw.normalizedField === 'string' ? raw.normalizedField.trim() : '';
    if (!name || seen.has(name)) continue;
    seen.add(name);
    fields.push({
      normalizedField: name.slice(0, 200),
      originalLabel:
        typeof raw.originalLabel === 'string'
          ? raw.originalLabel.trim().slice(0, 200)
          : name.slice(0, 200),
      value:
        typeof raw.value === 'string'
          ? raw.value.slice(0, MAX_VALUE_CHARS)
          : String(raw.value ?? '').slice(0, MAX_VALUE_CHARS),
      confidence: clampConfidence(raw.confidence),
    });
  }

  const overallConfidence =
    body.overallConfidence === undefined
      ? fields.length > 0
        ? fields.reduce((sum, f) => sum + f.confidence, 0) / fields.length
        : null
      : clampConfidence(body.overallConfidence);

  const statements = [
    env.DB.prepare(
      `UPDATE documents
          SET status = 'completed', error = NULL, ocr_text = ?,
              overall_confidence = ?, completed_at = datetime('now')
        WHERE id = ?`,
    ).bind(ocrText, overallConfidence, documentId),
    // Re-running extraction replaces the previous fields rather than appending.
    env.DB.prepare(`DELETE FROM document_fields WHERE document_id = ?`).bind(
      documentId,
    ),
    ...fields.map((field, index) =>
      env.DB.prepare(
        `INSERT INTO document_fields
           (document_id, user_id, position, normalized_field, original_label,
            value, confidence)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        documentId,
        auth.user.id,
        index,
        field.normalizedField,
        field.originalLabel,
        field.value,
        field.confidence,
      ),
    ),
  ];

  try {
    await env.DB.batch(statements);
  } catch (error) {
    console.error('[api/documents/result] write failed:', error);
    return fail('Could not save the extraction result.', 500);
  }

  await refreshBatchStatus(env, batchId);

  return json({ ok: true, fieldCount: fields.length }, 200, authHeaders(auth));
};
