// ---------------------------------------------------------------------------
// Batch read model.
//
// Assembles the exact shapes src/lib/api-client.ts expects, so the client's
// types did not have to change when storage moved from IndexedDB to D1.
// ---------------------------------------------------------------------------

import type { AppEnv } from './http';

/**
 * Guards against a single request creating an unbounded amount of work. Enforced
 * on batch creation AND on append -- append used to have no cap at all, so the
 * limit could be sidestepped by creating a one-document batch and appending
 * thousands.
 */
export const MAX_DOCUMENTS_PER_BATCH = 100;

/**
 * The dashboard list renders every batch it is given, so the query must not
 * grow without bound. 500 recent batches is far past anything the UI can usefully
 * show; older ones remain reachable via their direct URL.
 */
export const MAX_LISTED_BATCHES = 500;


export interface FieldDto {
  normalizedField: string;
  originalLabel: string;
  value: string;
  editedValue: string | null;
  confidence: number;
  reviewStatus?: string | null;
}

export interface DocumentDto {
  id: number;
  filename: string;
  objectPath: string;
  contentType: string;
  status: string;
  error?: string;
  ocrText?: string;
  extractedFields?: FieldDto[];
  overallConfidence?: number;
  isDuplicate?: boolean;
}

export interface BatchSummaryDto {
  id: number;
  status: string;
  createdAt: string;
  /**
   * Last time anything about this batch changed, which is what lets a client tell
   * a batch that is still being worked on from one that was abandoned.
   *
   * Extraction runs in a background queue worker. This timestamp allows clients
   * to determine when a batch is genuinely stalled (e.g., due to a worker failure)
   * rather than actively processing, so they can stop polling.
   */
  updatedAt: string;
  totalDocuments: number;
  completedDocuments: number;
  failedDocuments: number;
  engineType?: string;
  prompt?: string;
  firstDocumentContentType?: string;
  firstDocumentObjectPath?: string;
}

export interface BatchDetailDto extends BatchSummaryDto {
  columns: string[];
  rows: Record<string, unknown>[];
  documents: DocumentDto[];
}

interface BatchRow {
  id: number;
  status: string;
  engine_type: string;
  prompt: string | null;
  created_at: string;
  updated_at: string;
  total_documents: number;
  completed_documents: number;
  failed_documents: number;
  first_content_type: string | null;
  first_object_path: string | null;
  /** Selected only to make SQLite's bare-column rule pin the two fields above. */
  first_position: number | null;
}

interface DocumentRow {
  id: number;
  filename: string;
  object_path: string | null;
  content_type: string;
  status: string;
  error: string | null;
  overall_confidence: number | null;
  is_duplicate: number;
}

/** The batch listing omits `ocr_text`; the single-document read includes it. */
interface DocumentDetailRow extends DocumentRow {
  ocr_text: string | null;
}

interface FieldRow {
  document_id: number;
  normalized_field: string;
  original_label: string;
  value: string;
  edited_value: string | null;
  confidence: number;
  review_status: string | null;
}

/** SQLite stores our timestamps as 'YYYY-MM-DD HH:MM:SS' in UTC. */
export function toIso(sqliteTimestamp: string): string {
  return `${sqliteTimestamp.replace(' ', 'T')}Z`;
}

/**
 * Counts are computed in SQL rather than by loading documents, so the batch list
 * stays a single query no matter how many documents each batch holds.
 *
 * This was five correlated subqueries per batch row — 2,500 subquery executions
 * at the 500-batch listing cap. One LEFT JOIN and a GROUP BY does the same work
 * in a single pass over idx_documents_batch.
 *
 * `first_content_type` / `first_object_path` rely on a documented SQLite
 * behaviour: when a grouped query contains exactly one min() or max() aggregate,
 * every bare column in the SELECT is taken from the row that produced it. So
 * MIN(d.position) is what pins those two to the batch's first document. D1 is
 * SQLite, so this is a guarantee rather than an accident — but it is the reason
 * MIN(d.position) is selected even though nothing reads it.
 *
 * Callers must insert their WHERE clause between SUMMARY_SELECT and
 * SUMMARY_GROUP.
 */
const SUMMARY_SELECT = `
  SELECT b.id                AS id,
         b.status            AS status,
         b.engine_type       AS engine_type,
         b.prompt            AS prompt,
         b.created_at        AS created_at,
         b.updated_at        AS updated_at,
         COUNT(d.id)                                  AS total_documents,
         COALESCE(SUM(d.status = 'completed'), 0)      AS completed_documents,
         COALESCE(SUM(d.status = 'failed'), 0)         AS failed_documents,
         MIN(d.position)                               AS first_position,
         d.content_type                                AS first_content_type,
         d.object_path                                 AS first_object_path
    FROM batches b
    LEFT JOIN documents d ON d.batch_id = b.id`;

const SUMMARY_GROUP = ` GROUP BY b.id`;

function toSummary(row: BatchRow): BatchSummaryDto {
  return {
    id: row.id,
    status: row.status,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    totalDocuments: row.total_documents,
    completedDocuments: row.completed_documents,
    failedDocuments: row.failed_documents,
    engineType: row.engine_type,
    prompt: row.prompt ?? undefined,
    firstDocumentContentType: row.first_content_type ?? undefined,
    firstDocumentObjectPath: row.first_object_path ?? undefined,
  };
}

export async function listBatches(
  env: AppEnv,
  userId: string,
  limit = MAX_LISTED_BATCHES,
  offset = 0,
): Promise<BatchSummaryDto[]> {
  const { results } = await env.DB.prepare(
    `${SUMMARY_SELECT} WHERE b.user_id = ?${SUMMARY_GROUP}
      ORDER BY b.created_at DESC, b.id DESC LIMIT ? OFFSET ?`,
  )
    .bind(userId, limit, offset)
    .all<BatchRow>();

  return (results ?? []).map(toSummary);
}

export async function getBatchSummary(
  env: AppEnv,
  userId: string,
  batchId: number,
): Promise<BatchSummaryDto | null> {
  const row = await env.DB.prepare(
    `${SUMMARY_SELECT} WHERE b.id = ? AND b.user_id = ?${SUMMARY_GROUP}`,
  )
    .bind(batchId, userId)
    .first<BatchRow>();
  return row ? toSummary(row) : null;
}

/**
 * Returns the full batch, or null when it does not exist OR belongs to someone
 * else. Those two cases are deliberately indistinguishable to the caller.
 */
export async function getBatchDetail(
  env: AppEnv,
  userId: string,
  batchId: number,
): Promise<BatchDetailDto | null> {
  const batch = await env.DB.prepare(
    `${SUMMARY_SELECT} WHERE b.id = ? AND b.user_id = ?${SUMMARY_GROUP}`,
  )
    .bind(batchId, userId)
    .first<BatchRow>();

  if (!batch) return null;

  const [documentsResult, fieldsResult] = await env.DB.batch<DocumentRow | FieldRow>([
    env.DB.prepare(
      // ocr_text is deliberately absent. It is by far the largest column in the
      // table, and a full batch would ship megabytes of raw text that no part of
      // the batch view renders. DocumentDetails reads it per document instead.
      `SELECT id, filename, object_path, content_type, status, error,
              overall_confidence, is_duplicate
         FROM documents WHERE batch_id = ? ORDER BY position, id`,
    ).bind(batchId),
    env.DB.prepare(
      `SELECT f.document_id, f.normalized_field, f.original_label, f.value,
              f.edited_value, f.confidence, f.review_status
         FROM document_fields f
         JOIN documents d ON d.id = f.document_id
        WHERE d.batch_id = ?
        ORDER BY f.document_id, f.position, f.id`,
    ).bind(batchId),
  ]);

  const documentRows = (documentsResult.results ?? []) as DocumentRow[];
  const fieldRows = (fieldsResult.results ?? []) as FieldRow[];

  const fieldsByDocument = new Map<number, FieldRow[]>();
  for (const field of fieldRows) {
    const bucket = fieldsByDocument.get(field.document_id);
    if (bucket) bucket.push(field);
    else fieldsByDocument.set(field.document_id, [field]);
  }

  // Column order follows first appearance across documents, which keeps the
  // comparison table stable as new documents are added.
  const columns: string[] = [];
  const seenColumns = new Set<string>();

  const documents: DocumentDto[] = [];
  const rows: Record<string, unknown>[] = [];

  for (const row of documentRows) {
    const fields = (fieldsByDocument.get(row.id) ?? []).map<FieldDto>((f) => ({
      normalizedField: f.normalized_field,
      originalLabel: f.original_label,
      value: f.value,
      editedValue: f.edited_value,
      confidence: f.confidence,
      reviewStatus: f.review_status,
    }));

    documents.push({
      id: row.id,
      filename: row.filename,
      objectPath: row.object_path ?? '',
      contentType: row.content_type,
      status: row.status,
      error: row.error ?? undefined,
      extractedFields: fields,
      overallConfidence: row.overall_confidence ?? undefined,
      isDuplicate: row.is_duplicate === 1,
    });

    const projected: Record<string, unknown> = {
      documentId: row.id,
      filename: row.filename,
      status: row.status,
    };
    for (const field of fields) {
      if (!seenColumns.has(field.normalizedField)) {
        seenColumns.add(field.normalizedField);
        columns.push(field.normalizedField);
      }
      // An edited value wins over the extracted one everywhere it is displayed
      // or exported. Rejected fields are explicitly blanked.
      projected[field.normalizedField] = field.reviewStatus === 'rejected' ? '' : (field.editedValue ?? field.value);
    }
    rows.push(projected);
  }

  return { ...toSummary(batch), columns, rows, documents };
}

/**
 * Recomputes a batch's status from its documents. Called after every document
 * transition so the aggregate can never drift from reality.
 */
export async function refreshBatchStatus(
  env: AppEnv,
  batchId: number,
): Promise<void> {
  await env.DB.prepare(
    `UPDATE batches
        SET status = (
              SELECT CASE
                WHEN COUNT(*) = 0 THEN 'queued'
                WHEN SUM(status = 'failed') = COUNT(*) THEN 'failed'
                WHEN SUM(status IN ('queued', 'processing')) > 0 THEN 'processing'
                WHEN SUM(status = 'failed') > 0 THEN 'partial'
                ELSE 'completed'
              END
                FROM documents WHERE batch_id = ?
            ),
            updated_at = datetime('now')
      WHERE id = ?`,
  )
    .bind(batchId, batchId)
    .run();
}

/** Confirms the document belongs to the caller before any mutation. */
export async function findOwnedDocument(
  env: AppEnv,
  userId: string,
  batchId: number,
  documentId: number,
): Promise<{ id: number; batch_id: number; object_path: string | null } | null> {
  return env.DB.prepare(
    `SELECT d.id, d.batch_id, d.object_path
       FROM documents d
       JOIN batches b ON b.id = d.batch_id
      WHERE d.id = ? AND d.batch_id = ? AND b.user_id = ?`,
  )
    .bind(documentId, batchId, userId)
    .first<{ id: number; batch_id: number; object_path: string | null }>();
}

/**
 * One document, with its OCR text and its fields.
 *
 * This is the read that fills in the `ocrText` that `getBatchDetail` leaves out,
 * for the single document the user is actually looking at.
 */
export async function getDocumentDetail(
  env: AppEnv,
  userId: string,
  batchId: number,
  documentId: number,
): Promise<DocumentDto | null> {
  const [documentResult, fieldsResult] = await env.DB.batch<
    DocumentDetailRow | FieldRow
  >([
    env.DB.prepare(
      `SELECT d.id, d.filename, d.object_path, d.content_type, d.status, d.error,
              d.ocr_text, d.overall_confidence, d.is_duplicate
         FROM documents d
         JOIN batches b ON b.id = d.batch_id
        WHERE d.id = ? AND d.batch_id = ? AND b.user_id = ?`,
    ).bind(documentId, batchId, userId),
    env.DB.prepare(
      `SELECT document_id, normalized_field, original_label, value, edited_value,
              confidence, review_status
         FROM document_fields WHERE document_id = ? ORDER BY position, id`,
    ).bind(documentId),
  ]);

  // Ownership is decided by the first query's WHERE clause. The second runs
  // either way -- D1 batches are sent together -- but its rows are only ever
  // returned to a caller that owns the document.
  const row = (documentResult.results ?? [])[0] as DocumentDetailRow | undefined;
  if (!row) return null;

  const fields = ((fieldsResult.results ?? []) as FieldRow[]).map<FieldDto>((f) => ({
    normalizedField: f.normalized_field,
    originalLabel: f.original_label,
    value: f.value,
    editedValue: f.edited_value,
    confidence: f.confidence,
    reviewStatus: f.review_status,
  }));

  return {
    id: row.id,
    filename: row.filename,
    objectPath: row.object_path ?? '',
    contentType: row.content_type,
    status: row.status,
    error: row.error ?? undefined,
    ocrText: row.ocr_text ?? undefined,
    extractedFields: fields,
    overallConfidence: row.overall_confidence ?? undefined,
    isDuplicate: row.is_duplicate === 1,
  };
}

// ---------------------------------------------------------------------------
// Document intake
//
// Shared by POST /api/batches and POST /api/batches/:id/documents. Both used to
// carry their own copy of this logic, and the copies had already drifted -- only
// one of them enforced the document cap.
// ---------------------------------------------------------------------------

export interface IncomingDocumentInput {
  filename?: unknown;
  contentType?: unknown;
  objectPath?: unknown;
  sizeBytes?: unknown;
  contentHash?: unknown;
}

export interface NormalizedDocument {
  filename: string;
  contentType: string;
  objectPath: string | null;
  sizeBytes: number | null;
  contentHash: string | null;
}

export interface CreatedDocument {
  id: number;
  filename: string;
  position: number;
}

function cleanString(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

/**
 * Returns the first object path that does not belong to this user, or null.
 *
 * `objectPath` arrives from the client, and nothing checked it. Reads were still
 * safe -- functions/api/storage/[[path]].ts requires the key to sit under the
 * caller's own `${userId}/` prefix, so claiming someone else's key gets a 404 --
 * but "the read path happens to reject it" is not the same as "the row cannot be
 * written". A caller could point their own document rows at another account's
 * objects, or at nonsense, and the database would hold it: thumbnails and viewers
 * would 404 for reasons nothing explains, and a batch delete would then try to
 * remove R2 keys the user does not own.
 *
 * The prefix is the ownership boundary, so it is asserted where the row is
 * created, not only where it is read.
 */
export function invalidObjectPath(
  documents: readonly NormalizedDocument[],
  userId: string,
): string | null {
  const prefix = `${userId}/`;
  for (const doc of documents) {
    if (doc.objectPath === null) continue;
    if (!doc.objectPath.startsWith(prefix) || doc.objectPath.includes('..')) {
      return doc.objectPath;
    }
  }
  return null;
}

export function normalizeIncomingDocuments(
  raw: readonly IncomingDocumentInput[],
): NormalizedDocument[] {
  return raw.map((doc, index) => ({
    filename: cleanString(doc.filename, 255) || `document-${index + 1}`,
    contentType: cleanString(doc.contentType, 128) || 'application/octet-stream',
    objectPath: cleanString(doc.objectPath, 512) || null,
    sizeBytes:
      typeof doc.sizeBytes === 'number' && Number.isFinite(doc.sizeBytes)
        ? Math.max(0, Math.round(doc.sizeBytes))
        : null,
    contentHash: cleanString(doc.contentHash, 64) || null,
  }));
}

/**
 * Inserts documents at `startPosition`, flagging (never blocking) duplicates.
 *
 * Two round trips total -- one lookup for every hash at once, then one batched
 * write -- rather than the two awaited queries per document this replaces. At the
 * 100-document cap that is 2 round trips instead of 200.
 */
export async function insertDocuments(
  env: AppEnv,
  userId: string,
  batchId: number,
  documents: readonly NormalizedDocument[],
  startPosition: number,
): Promise<CreatedDocument[]> {
  if (documents.length === 0) return [];

  // Which of these hashes has this user already stored? One query, not one per
  // document. Scoped to the user: a hash collision across accounts is not this
  // user's duplicate and must not be visible to them.
  const hashes = [
    ...new Set(
      documents
        .map((doc) => doc.contentHash)
        .filter((hash): hash is string => hash !== null),
    ),
  ];

  const knownHashes = new Set<string>();
  if (hashes.length > 0) {
    const placeholders = hashes.map(() => '?').join(', ');
    const { results } = await env.DB.prepare(
      `SELECT DISTINCT content_hash FROM documents
        WHERE user_id = ? AND content_hash IN (${placeholders})`,
    )
      .bind(userId, ...hashes)
      .all<{ content_hash: string }>();
    for (const row of results ?? []) knownHashes.add(row.content_hash);
  }

  // A file repeated within this same request is also a duplicate. The per-document
  // loop got this for free because each insert was visible to the next lookup;
  // batching the inserts means tracking it explicitly.
  const seenInThisRequest = new Set<string>();

  const statements = documents.map((doc, index) => {
    let isDuplicate = 0;
    if (doc.contentHash) {
      if (knownHashes.has(doc.contentHash) || seenInThisRequest.has(doc.contentHash)) {
        isDuplicate = 1;
      }
      seenInThisRequest.add(doc.contentHash);
    }

    return env.DB.prepare(
      `INSERT INTO documents
         (batch_id, user_id, position, filename, content_type, object_path,
          size_bytes, content_hash, status, is_duplicate)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?)`,
    ).bind(
      batchId,
      userId,
      startPosition + index,
      doc.filename,
      doc.contentType,
      doc.objectPath,
      doc.sizeBytes,
      doc.contentHash,
      isDuplicate,
    );
  });

  const results = await env.DB.batch(statements);

  // These keys now have a document pointing at them, so they are no longer
  // pending. Leaving the rows behind would be harmless -- the sweep also checks
  // `documents` -- but the table would grow without bound.
  const claimed = documents
    .map((doc) => doc.objectPath)
    .filter((path): path is string => path !== null);

  if (claimed.length > 0) {
    try {
      const placeholders = claimed.map(() => '?').join(', ');
      await env.DB.prepare(
        `DELETE FROM pending_uploads WHERE user_id = ? AND object_path IN (${placeholders})`,
      )
        .bind(userId, ...claimed)
        .run();
    } catch (error) {
      // Bookkeeping only. The documents are inserted and the sweep's NOT EXISTS
      // check against `documents` already protects the objects themselves.
      console.error('[batches] could not clear pending upload rows:', error);
    }
  }

  return documents.map((doc, index) => ({
    id: Number(results[index]?.meta.last_row_id),
    filename: doc.filename,
    position: startPosition + index,
  }));
}

/**
 * Current document count and the next free position, in one query. Callers need
 * both to enforce the cap and to append without colliding on `position`.
 */
export async function getBatchCapacity(
  env: AppEnv,
  batchId: number,
): Promise<{ count: number; nextPosition: number }> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS count, COALESCE(MAX(position), -1) AS max_position
       FROM documents WHERE batch_id = ?`,
  )
    .bind(batchId)
    .first<{ count: number; max_position: number }>();

  return {
    count: row?.count ?? 0,
    nextPosition: (row?.max_position ?? -1) + 1,
  };
}
