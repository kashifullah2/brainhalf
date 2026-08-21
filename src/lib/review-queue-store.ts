// ---------------------------------------------------------------------------
// Review queue.
//
// Backed by the server: the threshold lives on the account (so it is the same on
// every device) and the flagged-field filtering happens in SQL. The previous
// version read every batch out of IndexedDB and filtered in JavaScript, which
// also meant the queue would have silently emptied the moment a real backend
// existed.
//
// The exported surface is unchanged so the pages that use it did not need to be
// rewritten.
// ---------------------------------------------------------------------------

import {
  approveFlaggedFields,
  getSettings,
  updateSettings,
  updateDocumentField,
  type Document,
  type ExtractedField,
} from "./api-client";
import { apiUrl } from "./api-paths";

export interface FieldResolution {
  documentId: number;
  fieldName: string;
  originalValue: string;
  resolvedValue: string;
  status: "approved" | "corrected" | "rejected";
  timestamp: string;
}

export interface FlaggedDocument {
  batchId: number;
  document: Document;
  flaggedFields: ExtractedField[];
  totalFlaggedCount: number;
  reviewedCount: number;
}

interface QueuePage {
  limit: number;
  offset: number;
  hasMore: boolean;
}

interface ReviewQueueResponse {
  threshold: number;
  items: FlaggedDocument[];
  page?: QueuePage;
}

interface QueueQuery {
  limit?: number;
  offset?: number;
  batchId?: number;
  documentId?: number;
}

/** Documents per request. The endpoint caps this at 200. */
const PAGE_SIZE = 100;

/**
 * Safety stop for the paging loop. 5,000 flagged documents is already far past
 * the point where the page should be paging in the UI rather than pulling the
 * whole queue, so hitting this is a signal, not a normal outcome.
 */
const MAX_PAGES = 50;

async function fetchQueue(query: QueueQuery = {}): Promise<ReviewQueueResponse> {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) search.set(key, String(value));
  }
  const qs = search.toString();

  const response = await fetch(apiUrl(`/review-queue${qs ? `?${qs}` : ""}`), {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    let message = `Could not load the review queue (${response.status}).`;
    try {
      const parsed = (await response.json()) as { error?: string };
      if (parsed.error) message = parsed.error;
    } catch {
      // Keep the status-based message.
    }
    throw new Error(message);
  }

  return (await response.json()) as ReviewQueueResponse;
}

export async function getConfidenceThreshold(): Promise<number> {
  const settings = await getSettings();
  return settings.confidenceThreshold;
}

export async function setConfidenceThreshold(threshold: number): Promise<void> {
  await updateSettings(threshold);
}

/**
 * The whole queue, gathered a page at a time.
 *
 * The endpoint is paged now, so this walks it rather than asking for everything
 * in one response. Callers that only need one document or one batch should use
 * `getFlaggedDocument` or pass a filter instead of calling this.
 */
export async function getReviewQueueItems(): Promise<FlaggedDocument[]> {
  const items: FlaggedDocument[] = [];

  for (let page = 0; page < MAX_PAGES; page++) {
    const queue = await fetchQueue({
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    });
    items.push(...queue.items);

    if (!queue.page?.hasMore) return items;
  }

  console.warn(
    `[review-queue] stopped after ${MAX_PAGES} pages; the queue holds more than ` +
      `${MAX_PAGES * PAGE_SIZE} documents and is being truncated.`,
  );
  return items;
}

/** One flagged document, without pulling the rest of the queue down to find it. */
export async function getFlaggedDocument(
  documentId: number,
): Promise<FlaggedDocument | null> {
  const queue = await fetchQueue({ documentId, limit: 1 });
  return queue.items[0] ?? null;
}

/**
 * Review outcomes are stored on the field row itself, so this derives the map
 * the detail page expects from the queue rather than keeping a parallel store
 * that could disagree with it.
 *
 * Pass `documentId` when only one document's outcomes are needed — the detail page
 * used to pull the entire queue to build a map it then read one document out of.
 */
export async function getFieldResolutions(
  documentId?: number,
): Promise<Record<string, FieldResolution>> {
  const items =
    documentId === undefined
      ? await getReviewQueueItems()
      : (await fetchQueue({ documentId, limit: 1 })).items;

  const resolutions: Record<string, FieldResolution> = {};

  for (const item of items) {
    for (const field of item.flaggedFields) {
      if (!field.reviewStatus) continue;
      resolutions[`${item.document.id}_${field.normalizedField}`] = {
        documentId: item.document.id,
        fieldName: field.normalizedField,
        originalValue: field.value,
        resolvedValue: field.editedValue ?? field.value,
        status: field.reviewStatus as FieldResolution["status"],
        timestamp: new Date().toISOString(),
      };
    }
  }

  return resolutions;
}

/**
 * Records a review decision. `batchId` is optional only for backwards
 * compatibility with the previous signature; when omitted it is looked up from
 * the queue, which costs an extra request.
 */
export async function saveFieldResolution(
  documentId: number,
  fieldName: string,
  originalValue: string,
  resolvedValue: string,
  status: "approved" | "corrected" | "rejected",
  batchId?: number,
): Promise<void> {
  let resolvedBatchId = batchId;

  if (resolvedBatchId === undefined) {
    // Filtered to the one document, rather than fetching the whole queue.
    const queue = await fetchQueue({ documentId, limit: 1 });
    resolvedBatchId = queue.items[0]?.batchId;
  }

  if (resolvedBatchId === undefined) {
    throw new Error("Could not determine which batch this document belongs to.");
  }

  await updateDocumentField(resolvedBatchId, documentId, {
    normalizedField: fieldName,
    // "approved" keeps the extracted value, so only send an edit when the value
    // actually changed.
    editedValue:
      resolvedValue !== originalValue ? resolvedValue : undefined,
    reviewStatus: status,
  });
}

/**
 * Approves every still-unreviewed flagged field on ONE document.
 *
 * One request. This used to fetch the whole queue, find the document in it, and
 * then PATCH each field in sequence — so it was one round trip per field, and a
 * failure part-way through left the document half-reviewed.
 */
export async function markDocumentReviewed(
  batchId: number,
  documentId: number,
): Promise<void> {
  await approveFlaggedFields(batchId, documentId);
}

/** Approves every flagged field across one batch, in one request. */
export async function markBatchReviewed(batchId: number): Promise<void> {
  await approveFlaggedFields(batchId);
}
