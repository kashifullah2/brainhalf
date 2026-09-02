import { json, type AppEnv } from '../../server/http';
import { authHeaders, requireSession } from '../../server/guard';

import { DEFAULT_CONFIDENCE_THRESHOLD } from '../../server/threshold';

/**
 * How many documents one page may hold.
 *
 * The previous version had no limit at all: it joined every flagged field of
 * every batch the user had ever uploaded, grouped the whole thing in Worker
 * memory, and serialised it into one response. That is fine with three test
 * batches and falls over on a real account.
 */
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

interface Row {
  batch_id: number;
  document_id: number;
  filename: string;
  object_path: string | null;
  content_type: string;
  status: string;
  overall_confidence: number | null;
  normalized_field: string;
  original_label: string;
  value: string;
  edited_value: string | null;
  confidence: number;
  review_status: string | null;
}

interface QueueItem {
  batchId: number;
  document: {
    id: number;
    filename: string;
    objectPath: string;
    contentType: string;
    status: string;
    overallConfidence?: number;
  };
  flaggedFields: Array<{
    normalizedField: string;
    originalLabel: string;
    value: string;
    editedValue: string | null;
    confidence: number;
    reviewStatus: string | null;
  }>;
  totalFlaggedCount: number;
  reviewedCount: number;
}

/**
 * Answers just "how many documents are waiting?", in one query.
 *
 * The sidebar badge needed this number and there was no way to ask for it, so
 * AppLayout called the full queue reader instead -- which pages this endpoint 100
 * documents at a time, up to fifty sequential requests, each one joining
 * document_fields and grouping the result in Worker memory, to render a single
 * integer on every /app route.
 *
 * The predicate has to stay identical to isAwaitingReview() in
 * src/lib/review-queue-store.ts: a document is waiting while it still holds a
 * below-threshold field that nobody has ruled on. A badge that counts differently
 * from the page it links to is the bug this replaces, not a new one.
 *
 * No join: document_fields.user_id is denormalised and the rows cascade with their
 * document, so there is no orphan to filter out. idx_fields_review covers
 * (user_id, confidence, review_status) exactly.
 */
interface QueueTotals {
  /** Documents still holding at least one unreviewed flagged field. */
  awaiting: number;
  /** Documents with any flagged field, reviewed or not. */
  flaggedDocuments: number;
  /** Individual flagged fields. */
  flaggedFields: number;
  /** Flagged fields nobody has ruled on yet. */
  pendingFields: number;
}

async function queueTotals(
  env: AppEnv,
  userId: string,
  threshold: number,
): Promise<QueueTotals> {
  // One pass over idx_fields_review. Every number the queue page displays comes
  // from here, so the page's own list can be paged without the totals becoming
  // page-local -- a stat card reading "3 awaiting review" over a list of 50 would
  // be worse than no card at all.
  const row = await env.DB.prepare(
    `SELECT COUNT(*)                          AS flagged_fields,
            COALESCE(SUM(review_status IS NULL), 0) AS pending_fields,
            COUNT(DISTINCT document_id)       AS flagged_documents,
            COUNT(DISTINCT CASE WHEN review_status IS NULL THEN document_id END)
                                              AS awaiting_documents
       FROM document_fields
      WHERE user_id = ?
        AND confidence < ?`,
  )
    .bind(userId, threshold)
    .first<{
      flagged_fields: number;
      pending_fields: number;
      flagged_documents: number;
      awaiting_documents: number;
    }>();

  return {
    awaiting: row?.awaiting_documents ?? 0,
    flaggedDocuments: row?.flagged_documents ?? 0,
    flaggedFields: row?.flagged_fields ?? 0,
    pendingFields: row?.pending_fields ?? 0,
  };
}

/** Reads a non-negative integer query parameter, or null when absent/invalid. */
function intQuery(url: URL, name: string): number | null {
  const raw = url.searchParams.get(name);
  if (raw === null || raw.trim() === '') return null;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

/**
 * Documents holding at least one field below the user's confidence threshold.
 *
 * The filtering happens in SQL against the real database. The previous version
 * read every batch out of IndexedDB and filtered in JavaScript, which also meant
 * the queue would silently empty the moment a backend existed.
 *
 * Paged, and filterable by `batchId` or `documentId`, so the callers that want
 * one document (the review detail page) or one batch ("approve this batch") do
 * not have to pull the whole queue down to find it.
 */
export const onRequestGet: PagesFunction<AppEnv> = async ({ request, env }) => {
  const auth = await requireSession(request, env);
  if (auth instanceof Response) return auth;

  const url = new URL(request.url);
  const limit = Math.min(intQuery(url, 'limit') || DEFAULT_LIMIT, MAX_LIMIT);
  const offset = intQuery(url, 'offset') ?? 0;
  const batchFilter = intQuery(url, 'batchId');
  const documentFilter = intQuery(url, 'documentId');
  const countOnly = url.searchParams.get('countOnly') === '1';

  const settings = await env.DB.prepare(
    `SELECT confidence_threshold FROM user_settings WHERE user_id = ?`,
  )
    .bind(auth.user.id)
    .first<{ confidence_threshold: number }>();

  const threshold = settings?.confidence_threshold ?? DEFAULT_CONFIDENCE_THRESHOLD;

  // Short-circuit before any paging work. A query parameter rather than a separate
  // route because `review-queue.ts` is a leaf file: adding /api/review-queue/count
  // would mean turning it into a directory, and the two would then disagree about
  // which one owns /api/review-queue.
  if (countOnly) {
    return json(
      { threshold, ...(await queueTotals(env, auth.user.id, threshold)) },
      200,
      authHeaders(auth),
    );
  }

  const verifiedOnly = url.searchParams.get('verified') === '1';

  // Page over documents first. Paging the flat join instead would cut a document's
  // fields in half at the page boundary.
  const pageFilters: string[] = [];
  const pageBinds: unknown[] = [auth.user.id];

  let statusClause: string;
  if (verifiedOnly) {
    statusClause = `
        AND EXISTS (
              SELECT 1 FROM document_fields f
               WHERE f.document_id = d.id AND f.user_id = ? AND f.confidence < ?
            )
        AND NOT EXISTS (
              SELECT 1 FROM document_fields f
               WHERE f.document_id = d.id AND f.user_id = ? AND f.confidence < ?
                 AND f.review_status IS NULL
            )`;
    pageBinds.push(auth.user.id, threshold, auth.user.id, threshold);
  } else {
    statusClause = `
        AND EXISTS (
              SELECT 1 FROM document_fields f
               WHERE f.document_id = d.id AND f.user_id = ? AND f.confidence < ?
                 AND f.review_status IS NULL
            )`;
    pageBinds.push(auth.user.id, threshold);
  }

  if (batchFilter !== null) {
    pageFilters.push('AND d.batch_id = ?');
    pageBinds.push(batchFilter);
  }
  if (documentFilter !== null) {
    pageFilters.push('AND d.id = ?');
    pageBinds.push(documentFilter);
  }

  // One extra row tells us whether another page exists, without a COUNT(*).
  const { results: pageRows } = await env.DB.prepare(
    `SELECT d.id AS document_id
       FROM documents d
      WHERE d.user_id = ?
        ${statusClause}
        ${pageFilters.join('\n        ')}
      ORDER BY d.batch_id DESC, d.id
      LIMIT ? OFFSET ?`,
  )
    .bind(...pageBinds, limit + 1, offset)
    .all<{ document_id: number }>();

  const pageIds = (pageRows ?? []).map((row) => row.document_id);
  const hasMore = pageIds.length > limit;
  const documentIds = hasMore ? pageIds.slice(0, limit) : pageIds;

  if (documentIds.length === 0) {
    return json(
      { threshold, items: [], page: { limit, offset, hasMore: false } },
      200,
      authHeaders(auth),
    );
  }

  const placeholders = documentIds.map(() => '?').join(', ');
  const { results } = await env.DB.prepare(
    `SELECT d.batch_id          AS batch_id,
            d.id                AS document_id,
            d.filename          AS filename,
            d.object_path       AS object_path,
            d.content_type      AS content_type,
            d.status            AS status,
            d.overall_confidence AS overall_confidence,
            f.normalized_field  AS normalized_field,
            f.original_label    AS original_label,
            f.value             AS value,
            f.edited_value      AS edited_value,
            f.confidence        AS confidence,
            f.review_status     AS review_status
       FROM document_fields f
       JOIN documents d ON d.id = f.document_id
      WHERE f.user_id = ? AND f.confidence < ?
        AND f.document_id IN (${placeholders})
      ORDER BY d.batch_id DESC, d.id, f.position, f.id`,
  )
    .bind(auth.user.id, threshold, ...documentIds)
    .all<Row>();

  // Group the flat join back into one entry per document.
  const byDocument = new Map<number, QueueItem>();

  for (const row of results ?? []) {
    let entry = byDocument.get(row.document_id);
    if (!entry) {
      entry = {
        batchId: row.batch_id,
        document: {
          id: row.document_id,
          filename: row.filename,
          objectPath: row.object_path ?? '',
          contentType: row.content_type,
          status: row.status,
          overallConfidence: row.overall_confidence ?? undefined,
        },
        flaggedFields: [],
        totalFlaggedCount: 0,
        reviewedCount: 0,
      };
      byDocument.set(row.document_id, entry);
    }

    entry.flaggedFields.push({
      normalizedField: row.normalized_field,
      originalLabel: row.original_label,
      value: row.value,
      editedValue: row.edited_value,
      confidence: row.confidence,
      reviewStatus: row.review_status,
    });
    entry.totalFlaggedCount += 1;
    if (row.review_status) entry.reviewedCount += 1;
  }

  // Emit in the page's order rather than the map's, so the order is the one the
  // paging query decided and stays stable across pages.
  const items = documentIds
    .map((id) => byDocument.get(id))
    .filter((item): item is QueueItem => item !== undefined);

  return json(
    { threshold, items, page: { limit, offset, hasMore } },
    200,
    authHeaders(auth),
  );
};
