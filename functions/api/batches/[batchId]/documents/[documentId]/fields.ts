import { fail, json, readJson, type AppEnv } from '../../../../../../server/http';
import {
  authHeaders,
  intParam,
  requireSession,
} from '../../../../../../server/guard';
import { findOwnedDocument } from '../../../../../../server/batches';

interface Body {
  normalizedField?: unknown;
  editedValue?: unknown;
  /** Optional review outcome: approved | corrected | rejected. */
  reviewStatus?: unknown;
}

const VALID_REVIEW_STATUSES = new Set(['approved', 'corrected', 'rejected']);
const MAX_VALUE_CHARS = 8_000;

/**
 * Edits one extracted field. The original `value` is never overwritten — the
 * human correction lands in `edited_value`, so the model's output stays
 * auditable and a correction can be undone by sending null.
 */
export const onRequestPatch: PagesFunction<AppEnv> = async ({
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

  const fieldName =
    typeof body.normalizedField === 'string' ? body.normalizedField.trim() : '';
  if (!fieldName) return fail('normalizedField is required.', 400);

  // null clears the correction and restores the extracted value.
  const editedValue =
    body.editedValue === null
      ? null
      : typeof body.editedValue === 'string'
        ? body.editedValue.slice(0, MAX_VALUE_CHARS)
        : undefined;

  if (editedValue === undefined && body.reviewStatus === undefined) {
    return fail('Nothing to update.', 400);
  }

  let reviewStatus: string | null | undefined;
  if (body.reviewStatus !== undefined) {
    if (body.reviewStatus === null) {
      reviewStatus = null;
    } else if (
      typeof body.reviewStatus === 'string' &&
      VALID_REVIEW_STATUSES.has(body.reviewStatus)
    ) {
      reviewStatus = body.reviewStatus;
    } else {
      return fail('Invalid review status.', 400);
    }
  }

  const assignments: string[] = [];
  const bindings: unknown[] = [];

  if (editedValue !== undefined) {
    assignments.push('edited_value = ?');
    bindings.push(editedValue);
  }
  if (reviewStatus !== undefined) {
    assignments.push('review_status = ?', "reviewed_at = datetime('now')");
    bindings.push(reviewStatus);
  }

  const result = await env.DB.prepare(
    `UPDATE document_fields SET ${assignments.join(', ')}
      WHERE document_id = ? AND normalized_field = ?`,
  )
    .bind(...bindings, documentId, fieldName)
    .run();

  if (result.meta.changes === 0) {
    return fail('Field not found on this document.', 404);
  }

  return json({ ok: true }, 200, authHeaders(auth));
};
