// ---------------------------------------------------------------------------
// Account-level data operations: export everything, and delete everything.
//
// Neither existed. Settings had a "Data & Privacy" tab whose heading promised
// "Control how long we retain your processed documents" and which offered no
// control at all -- and the product ships a privacy policy. Under GDPR a user has
// a right of access (Article 15, hence the export) and a right to erasure
// (Article 17, hence the delete), and neither was reachable from anywhere in the
// application.
// ---------------------------------------------------------------------------

import type { AppEnv } from './http';
import { toIso } from './batches';

/**
 * Rows per table in an export. Generous, but the whole thing is assembled in
 * Worker memory and serialised into one response, so it cannot be unbounded.
 * `truncated` in the payload says plainly when a cap was reached, rather than
 * quietly handing someone an incomplete copy of their own data.
 */
const EXPORT_LIMIT = 5_000;

/** R2 accepts up to 1000 keys per delete call. */
const R2_DELETE_CHUNK = 1_000;

/**
 * Objects removed per delete request. A Worker has a CPU budget, and an account at
 * the 500-batch / 100-document ceiling holds up to 50,000 objects. Past this the
 * request reports `complete: false` and the caller asks again -- the user row is
 * deliberately left in place until the bytes are gone, because that row is the
 * only thing that can still find them.
 */
const MAX_OBJECTS_PER_DELETE = 10_000;

export interface ExportedAccount {
  exportedAt: string;
  user: Record<string, unknown>;
  settings: Record<string, unknown> | null;
  templates: Record<string, unknown>[];
  batches: Record<string, unknown>[];
  /** True when any list hit EXPORT_LIMIT. */
  truncated: boolean;
}

/**
 * Everything we hold about one account, as JSON.
 *
 * Five queries rather than a query per batch: the fields are fetched flat and
 * grouped here, so the cost does not scale with the number of batches.
 */
export async function exportUserData(
  env: AppEnv,
  userId: string,
): Promise<ExportedAccount> {
  const [userRes, settingsRes, templatesRes, batchesRes, documentsRes, fieldsRes] =
    await env.DB.batch<Record<string, unknown>>([
      env.DB.prepare(
        `SELECT id, email, first_name, last_name, picture_url, email_verified,
                created_at, updated_at, last_login_at
           FROM users WHERE id = ?`,
      ).bind(userId),
      env.DB.prepare(
        `SELECT confidence_threshold, updated_at FROM user_settings WHERE user_id = ?`,
      ).bind(userId),
      env.DB.prepare(
        `SELECT id, name, base_mode, prompt, description, expected_fields, use_count,
                created_at, updated_at
           FROM extraction_templates WHERE user_id = ? ORDER BY id LIMIT ?`,
      ).bind(userId, EXPORT_LIMIT),
      env.DB.prepare(
        `SELECT id, status, engine_type, prompt, created_at, updated_at
           FROM batches WHERE user_id = ? ORDER BY id LIMIT ?`,
      ).bind(userId, EXPORT_LIMIT),
      env.DB.prepare(
        `SELECT id, batch_id, position, filename, content_type, object_path,
                size_bytes, content_hash, status, error, ocr_text,
                overall_confidence, is_duplicate, created_at, completed_at
           FROM documents WHERE user_id = ? ORDER BY batch_id, position LIMIT ?`,
      ).bind(userId, EXPORT_LIMIT),
      env.DB.prepare(
        `SELECT document_id, position, normalized_field, original_label, value,
                edited_value, confidence, review_status, reviewed_at
           FROM document_fields WHERE user_id = ? ORDER BY document_id, position LIMIT ?`,
      ).bind(userId, EXPORT_LIMIT),
    ]);

  const templates = templatesRes.results ?? [];
  const batches = batchesRes.results ?? [];
  const documents = documentsRes.results ?? [];
  const fields = fieldsRes.results ?? [];

  const fieldsByDocument = new Map<unknown, Record<string, unknown>[]>();
  for (const field of fields) {
    const bucket = fieldsByDocument.get(field.document_id);
    if (bucket) bucket.push(field);
    else fieldsByDocument.set(field.document_id, [field]);
  }

  const documentsByBatch = new Map<unknown, Record<string, unknown>[]>();
  for (const document of documents) {
    const withFields = {
      ...document,
      fields: fieldsByDocument.get(document.id) ?? [],
    };
    const bucket = documentsByBatch.get(document.batch_id);
    if (bucket) bucket.push(withFields);
    else documentsByBatch.set(document.batch_id, [withFields]);
  }

  return {
    exportedAt: new Date().toISOString(),
    user: (userRes.results ?? [])[0] ?? { id: userId },
    settings: (settingsRes.results ?? [])[0] ?? null,
    templates,
    batches: batches.map((batch) => ({
      ...batch,
      createdAtIso:
        typeof batch.created_at === 'string' ? toIso(batch.created_at) : null,
      documents: documentsByBatch.get(batch.id) ?? [],
    })),
    truncated:
      templates.length >= EXPORT_LIMIT ||
      batches.length >= EXPORT_LIMIT ||
      documents.length >= EXPORT_LIMIT ||
      fields.length >= EXPORT_LIMIT,
  };
}

export interface DeletionOutcome {
  /** False when objects remain and the caller should ask again. */
  complete: boolean;
  objectsDeleted: number;
}

/**
 * Erases an account: its stored files first, then the row every other table
 * cascades from.
 *
 * The order is the important part. The `documents` rows are the only place the R2
 * keys are recorded, and they cascade away with the user -- so deleting the user
 * first would strip the ability to find the objects at all, leaving every file the
 * account ever uploaded in the bucket, unreferenced and unbilled to anyone's
 * attention. The row is removed only once the bytes are gone.
 */
export async function deleteAccount(
  env: AppEnv,
  userId: string,
): Promise<DeletionOutcome> {
  const { results } = await env.DB.prepare(
    `SELECT object_path FROM documents
      WHERE user_id = ? AND object_path IS NOT NULL
      LIMIT ?`,
  )
    .bind(userId, MAX_OBJECTS_PER_DELETE + 1)
    .all<{ object_path: string }>();

  const paths = (results ?? []).map((row) => row.object_path).filter(Boolean);
  const more = paths.length > MAX_OBJECTS_PER_DELETE;
  const batchToDelete = more ? paths.slice(0, MAX_OBJECTS_PER_DELETE) : paths;

  let objectsDeleted = 0;
  for (let i = 0; i < batchToDelete.length; i += R2_DELETE_CHUNK) {
    const chunk = batchToDelete.slice(i, i + R2_DELETE_CHUNK);
    await env.DOCUMENTS.delete(chunk);
    objectsDeleted += chunk.length;
  }

  if (more) {
    // Clear the rows we have dealt with so the next call makes progress, and leave
    // the account itself alone until there is nothing left in the bucket.
    const placeholders = batchToDelete.map(() => '?').join(', ');
    await env.DB.prepare(
      `UPDATE documents SET object_path = NULL
        WHERE user_id = ? AND object_path IN (${placeholders})`,
    )
      .bind(userId, ...batchToDelete)
      .run();
    return { complete: false, objectsDeleted };
  }

  // Anything uploaded but never attached to a document.
  try {
    const pending = await env.DB.prepare(
      `SELECT object_path FROM pending_uploads WHERE user_id = ? LIMIT ?`,
    )
      .bind(userId, R2_DELETE_CHUNK)
      .all<{ object_path: string }>();
    const pendingPaths = (pending.results ?? []).map((row) => row.object_path);
    if (pendingPaths.length > 0) {
      await env.DOCUMENTS.delete(pendingPaths);
      objectsDeleted += pendingPaths.length;
    }
  } catch (error) {
    // Not a reason to refuse the erasure. The sweep collects these anyway, and the
    // rows cascade with the user below.
    console.error('[account] could not clear pending uploads:', error);
  }

  // users is the root: sessions, reset tokens, batches, documents,
  // document_fields, user_settings, extraction_templates and pending_uploads all
  // declare ON DELETE CASCADE against it.
  await env.DB.prepare(`DELETE FROM users WHERE id = ?`).bind(userId).run();

  return { complete: true, objectsDeleted };
}
