// ---------------------------------------------------------------------------
// API client.
//
// Every call goes to our own backend. There is no offline fallback and no mock
// data: the previous version answered any 404/500/network error with invented
// invoice values ("Sample Supplier LLC", "$450.00") at 0.97 confidence, which a
// user could not distinguish from a real extraction. Failures now surface as
// failures.
// ---------------------------------------------------------------------------

import { useQuery, useMutation } from "@tanstack/react-query";

import { apiUrl } from "./api-paths";
import {
  processWithHunyuanOCR,
  parseOCRResult,
  type HunyuanOCRResponse,
} from "./ocr-client";
import { analyzeImageQuality } from "./confidence-scorer";
import { calculateDocumentOverallConfidence } from "./confidence-scorer";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExtractedField {
  normalizedField: string;
  originalLabel: string;
  value: string;
  editedValue: string | null;
  confidence: number;
  reviewStatus?: string | null;
  boundingBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface Document {
  id: number;
  filename: string;
  objectPath: string;
  contentType: string;
  status: string;
  error?: string;
  ocrText?: string;
  extractedFields?: ExtractedField[];
  overallConfidence?: number;
  isDuplicate?: boolean;
}

export interface BatchSummary {
  id: number;
  status: string;
  createdAt: string;
  totalDocuments: number;
  completedDocuments: number;
  failedDocuments: number;
  engineType?: string;
  firstDocumentContentType?: string;
  firstDocumentObjectPath?: string;
}

export interface BatchDetail extends BatchSummary {
  columns: string[];
  rows: Record<string, unknown>[];
  documents: Document[];
}

/** Describes one document as the upload step hands it over. */
export interface PreparedDocument {
  filename: string;
  objectPath: string;
  contentType: string;
  sizeBytes?: number;
  contentHash?: string;
  rawFile?: File;
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(apiUrl(path), {
      ...init,
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...((init?.headers as Record<string, string>) ?? {}),
      },
    });
  } catch {
    // A genuine network failure. Report it instead of pretending to have data.
    throw new ApiError(
      "Could not reach the server. Check your connection and try again.",
      0,
    );
  }

  const raw = await response.text();
  let parsed: unknown = null;
  if (raw) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      if (raw.trimStart().startsWith("<")) {
        throw new ApiError(
          "The API is not running. Start the app with `pnpm dev:api` so the " +
            "Pages Functions and database are available.",
          response.status,
        );
      }
      throw new ApiError("The server returned an unreadable response.", response.status);
    }
  }

  if (!response.ok) {
    const message = (parsed as { error?: string } | null)?.error;
    if (response.status === 401) {
      throw new ApiError(
        message || "Your session has expired. Sign in again.",
        401,
      );
    }
    throw new ApiError(message || `Request failed (${response.status}).`, response.status);
  }

  return parsed as T;
}

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export function getListBatchesQueryKey() {
  return ["batches"] as const;
}

export function getGetBatchQueryKey(batchId: number) {
  return ["batches", batchId] as const;
}

export function getGetDocumentQueryKey(batchId: number, documentId: number) {
  return ["batches", batchId, "documents", documentId] as const;
}

// ---------------------------------------------------------------------------
// Read hooks
// ---------------------------------------------------------------------------

export function useListBatches() {
  return useQuery<BatchSummary[]>({
    queryKey: getListBatchesQueryKey(),
    queryFn: () => apiFetch<BatchSummary[]>("/batches"),
  });
}

export function useGetBatch(batchId: number, options?: { query?: Record<string, unknown> }) {
  const queryOpts = options?.query ?? {};
  return useQuery<BatchDetail>({
    queryKey: getGetBatchQueryKey(batchId),
    queryFn: () => apiFetch<BatchDetail>(`/batches/${batchId}`),
    enabled: !!batchId,
    ...queryOpts,
  });
}

/** Plain fetch (non-hook) for bulk operations such as multi-batch export. */
export async function getBatch(batchId: number): Promise<BatchDetail> {
  return apiFetch<BatchDetail>(`/batches/${batchId}`);
}

/**
 * One document, including its `ocrText`.
 *
 * The batch payload leaves `ocrText` out on purpose — it is the largest column in
 * the table and a full batch would ship megabytes of raw text that the batch view
 * never renders. Read it here, for the one document being displayed.
 */
export function useGetDocument(
  batchId: number,
  documentId: number,
  options?: { query?: Record<string, unknown> },
) {
  const queryOpts = options?.query ?? {};
  return useQuery<Document>({
    queryKey: getGetDocumentQueryKey(batchId, documentId),
    queryFn: () =>
      apiFetch<Document>(`/batches/${batchId}/documents/${documentId}`),
    enabled: !!batchId && !!documentId,
    ...queryOpts,
  });
}

export async function deleteBatch(batchId: number): Promise<void> {
  await apiFetch<void>(`/batches/${batchId}`, { method: "DELETE" });
}

/**
 * Approves every still-unreviewed flagged field on a batch, or on one document
 * within it. Returns how many fields were approved.
 *
 * One request. The review pages used to PATCH each field individually, so
 * approving a document meant a dozen round trips and a partial result if any of
 * them failed.
 */
export async function approveFlaggedFields(
  batchId: number,
  documentId?: number,
): Promise<number> {
  const result = await apiFetch<{ approved: number }>(
    `/batches/${batchId}/review`,
    {
      method: "POST",
      body: JSON.stringify(documentId === undefined ? {} : { documentId }),
    },
  );
  return result.approved;
}

// ---------------------------------------------------------------------------
// Batch creation
// ---------------------------------------------------------------------------

export interface CreateBatchProgress {
  /** 1-based index of the document currently being processed. */
  current: number;
  total: number;
  filename: string;
  status: "processing" | "completed" | "failed";
  error?: string;
}

interface CreatedBatch {
  id: number;
  documents: Array<{ id: number; filename: string; position: number }>;
}

export interface CreateBatchInput {
  documents: PreparedDocument[];
  mode: string;
  forceReprocess?: boolean;
  customPrompt?: string;
  engine?: "auto" | "hunyuan" | "textract";
}

/** Mirrors the fallback in src/pages/BatchDetails.tsx. */
const FALLBACK_CONFIDENCE_THRESHOLD = 0.8;

/**
 * The account's confidence threshold, below which a document is flagged for
 * review.
 *
 * Escalation reuses this exact value rather than introducing a second knob, so
 * the documents that earn a second, more expensive reading are precisely the
 * ones that would otherwise land in the review queue. A separate threshold would
 * let the two disagree — escalating documents nobody reviews, or reviewing
 * documents nobody escalated.
 */
async function resolveConfidenceThreshold(): Promise<number> {
  try {
    const settings = await getSettings();
    const threshold = settings?.confidenceThreshold;
    if (typeof threshold === "number" && threshold > 0 && threshold <= 1) {
      return threshold;
    }
  } catch (error) {
    // Not fatal. Falling back keeps extraction working when /settings is
    // unavailable, rather than failing an entire batch over a preference.
    console.warn(
      "[api-client] could not read the confidence threshold; using the default:",
      error,
    );
  }
  return FALLBACK_CONFIDENCE_THRESHOLD;
}

/**
 * Extracts one document with the cheap model tier, then re-reads it with the
 * premium tier only if the first result fell below `threshold`.
 *
 * Why mini-first: the premium daily quota is roughly a tenth of the cheap one —
 * about 125 pages against about 1,200 — so running every page through the
 * premium model would cap the platform at ~125 pages/day and let one large batch
 * exhaust the account. Escalating only below-threshold documents spends the
 * small quota where it can actually change an outcome.
 *
 * Shared by createBatch and appendBatch deliberately. The two loops were
 * byte-identical copies, and a change applied to one and not the other is how
 * they would silently diverge.
 */
async function extractWithEscalation(
  file: File,
  mode: string,
  forceReprocess: boolean,
  customPrompt: string | undefined,
  threshold: number,
  engine: "auto" | "hunyuan" | "textract" = "auto",
): Promise<{ result: HunyuanOCRResponse; overallConfidence: number }> {

  if (engine === "textract") {
    // For now, call processWithHunyuanOCR with "textract" tier, which will be handled in ocr-client.ts
    const result = await processWithHunyuanOCR(
      file,
      mode,
      forceReprocess,
      customPrompt,
      "textract" as any,
    );
    const overallConfidence = calculateDocumentOverallConfidence(
      result.fields,
      result.rawText,
    );
    return { result, overallConfidence };
  }


  const result = await processWithHunyuanOCR(
    file,
    mode,
    forceReprocess,
    customPrompt,
    "default",
  );
  const overallConfidence = calculateDocumentOverallConfidence(
    result.fields,
    result.rawText,
  );

  if (overallConfidence >= threshold || engine === "hunyuan") {
    return { result, overallConfidence };
  }

  // At most one escalation per document. Retrying further would spend the
  // premium quota on pages that are genuinely illegible rather than merely hard.
  try {
    const escalated = await processWithHunyuanOCR(
      file,
      mode,
      forceReprocess,
      customPrompt,
      "escalation",
    );
    const escalatedConfidence = calculateDocumentOverallConfidence(
      escalated.fields,
      escalated.rawText,
    );

    // Keep whichever read the document better. The premium model is usually the
    // stronger reader but not reliably so on any given page, and discarding a
    // better result because it came from the cheaper model would be perverse.
    if (escalatedConfidence > overallConfidence) {
      console.log(
        `[api-client] escalated ${file.name}: ${overallConfidence.toFixed(2)} -> ${escalatedConfidence.toFixed(2)}`,
      );
      return { result: escalated, overallConfidence: escalatedConfidence };
    }
  } catch (error) {
    // A failed escalation must never fail the document. The cheap-tier result is
    // real and usable — it simply goes to the review queue, which is where a
    // below-threshold document belongs regardless. Hitting the daily escalation
    // cap (RULES.ocrEscalation) arrives here as a 429 and is expected, not a bug.
    console.warn(
      `[api-client] escalation failed for ${file.name}; keeping the standard-tier result:`,
      error,
    );
  }

  return { result, overallConfidence };
}

/**
 * Creates the batch server-side first, then extracts one document at a time and
 * reports each outcome. Two consequences worth stating:
 *
 *  - a failure on document 7 no longer discards documents 1-6; each result is
 *    persisted as it lands, and the failed one can be retried on its own.
 *  - progress is durable, so closing the tab mid-run leaves a batch that
 *    accurately reports which documents finished.
 */
export async function createBatch(
  input: CreateBatchInput,
  onProgress?: (progress: CreateBatchProgress) => void,
): Promise<{ id: number; failedCount: number }> {
  const created = await apiFetch<CreatedBatch>("/batches", {
    method: "POST",
    body: JSON.stringify({
      mode: input.mode,
      documents: input.documents.map((doc) => ({
        filename: doc.filename,
        objectPath: doc.objectPath,
        contentType: doc.contentType,
        sizeBytes: doc.sizeBytes,
        contentHash: doc.contentHash,
      })),
    }),
  });

  const total = created.documents.length;
  let failedCount = 0;

  // Fetched once for the batch, not per document: it is an account-level setting
  // that cannot change mid-run, so a request per page would be a round trip for
  // a value that never varies.
  const confidenceThreshold = await resolveConfidenceThreshold();

  for (let index = 0; index < created.documents.length; index++) {
    const serverDoc = created.documents[index];
    const local = input.documents[index];

    onProgress?.({
      current: index + 1,
      total,
      filename: serverDoc.filename,
      status: "processing",
    });

    // Without the original bytes there is nothing to extract. Record it as a
    // failure on that document rather than aborting the batch.
    if (!local?.rawFile) {
      failedCount += 1;
      await reportFailure(
        created.id,
        serverDoc.id,
        "The original file was not available in this browser session.",
      );
      onProgress?.({
        current: index + 1,
        total,
        filename: serverDoc.filename,
        status: "failed",
        error: "Original file unavailable.",
      });
      continue;
    }

    try {
      const { result, overallConfidence } = await extractWithEscalation(
        local.rawFile,
        input.mode,
        input.forceReprocess ?? false,
        input.customPrompt,
        confidenceThreshold,
        input.engine,
      );

      await apiFetch(`/batches/${created.id}/documents/${serverDoc.id}/result`, {
        method: "POST",
        body: JSON.stringify({
          ocrText: result.rawText,
          overallConfidence,
          fields: result.fields.map((field) => ({
            normalizedField: field.normalizedField,
            originalLabel: field.originalLabel,
            value: field.value,
            confidence: field.confidence,
          })),
        }),
      });

      onProgress?.({
        current: index + 1,
        total,
        filename: serverDoc.filename,
        status: "completed",
      });
    } catch (error) {
      failedCount += 1;
      const message =
        error instanceof Error ? error.message : "Extraction failed.";
      await reportFailure(created.id, serverDoc.id, message);
      onProgress?.({
        current: index + 1,
        total,
        filename: serverDoc.filename,
        status: "failed",
        error: message,
      });
    }
  }

  return { id: created.id, failedCount };
}

/** Recording a failure must never itself break the run. */
async function reportFailure(
  batchId: number,
  documentId: number,
  message: string,
): Promise<void> {
  try {
    await apiFetch(`/batches/${batchId}/documents/${documentId}/failure`, {
      method: "POST",
      body: JSON.stringify({ error: message }),
    });
  } catch (error) {
    console.error("Could not record the document failure:", error);
  }
}

export function useCreateBatch() {
  return useMutation({
    mutationFn: ({
      data,
      onProgress,
    }: {
      data: CreateBatchInput;
      onProgress?: (progress: CreateBatchProgress) => void;
    }) => createBatch(data, onProgress),
  });
}

export interface AppendBatchInput {
  batchId: number;
  documents: PreparedDocument[];
  forceReprocess?: boolean;
  customPrompt?: string;
  engine?: "auto" | "hunyuan" | "textract";
}

interface AppendedBatch {
  id: number;
  mode: string;
  documents: Array<{ id: number; filename: string; position: number }>;
}

export async function appendBatch(
  input: AppendBatchInput,
  onProgress?: (progress: CreateBatchProgress) => void,
): Promise<{ id: number; failedCount: number }> {
  const created = await apiFetch<AppendedBatch>(`/batches/${input.batchId}/documents`, {
    method: "POST",
    body: JSON.stringify({
      documents: input.documents.map((doc) => ({
        filename: doc.filename,
        objectPath: doc.objectPath,
        contentType: doc.contentType,
        sizeBytes: doc.sizeBytes,
        contentHash: doc.contentHash,
      })),
    }),
  });

  const total = created.documents.length;
  let failedCount = 0;

  // Fetched once for the batch, not per document: it is an account-level setting
  // that cannot change mid-run, so a request per page would be a round trip for
  // a value that never varies.
  const confidenceThreshold = await resolveConfidenceThreshold();

  for (let index = 0; index < created.documents.length; index++) {
    const serverDoc = created.documents[index];
    const local = input.documents[index];

    onProgress?.({
      current: index + 1,
      total,
      filename: serverDoc.filename,
      status: "processing",
    });

    if (!local?.rawFile) {
      failedCount += 1;
      await reportFailure(created.id, serverDoc.id, "The original file was not available.");
      onProgress?.({
        current: index + 1,
        total,
        filename: serverDoc.filename,
        status: "failed",
        error: "Original file unavailable.",
      });
      continue;
    }

    try {
      const { result, overallConfidence } = await extractWithEscalation(
        local.rawFile,
        created.mode,
        input.forceReprocess ?? false,
        input.customPrompt,
        confidenceThreshold,
        input.engine,
      );

      await apiFetch(`/batches/${created.id}/documents/${serverDoc.id}/result`, {
        method: "POST",
        body: JSON.stringify({
          ocrText: result.rawText,
          overallConfidence,
          fields: result.fields.map((field) => ({
            normalizedField: field.normalizedField,
            originalLabel: field.originalLabel,
            value: field.value,
            confidence: field.confidence,
          })),
        }),
      });

      onProgress?.({
        current: index + 1,
        total,
        filename: serverDoc.filename,
        status: "completed",
      });
    } catch (error) {
      failedCount += 1;
      const message = error instanceof Error ? error.message : "Extraction failed.";
      await reportFailure(created.id, serverDoc.id, message);
      onProgress?.({
        current: index + 1,
        total,
        filename: serverDoc.filename,
        status: "failed",
        error: message,
      });
    }
  }

  return { id: created.id, failedCount };
}

export function useAppendBatch() {
  return useMutation({
    mutationFn: ({
      data,
      onProgress,
    }: {
      data: AppendBatchInput;
      onProgress?: (progress: CreateBatchProgress) => void;
    }) => appendBatch(data, onProgress),
  });
}

// ---------------------------------------------------------------------------
// Document mutations
// ---------------------------------------------------------------------------

export function useRetryDocument() {
  return useMutation({
    mutationFn: ({ batchId, documentId }: { batchId: number; documentId: number }) =>
      apiFetch<{ ok: true; objectPath: string | null }>(
        `/batches/${batchId}/documents/${documentId}/retry`,
        { method: "POST" },
      ),
  });
}

export function useUpdateDocumentField() {
  return useMutation({
    mutationFn: ({
      batchId,
      documentId,
      data,
    }: {
      batchId: number;
      documentId: number;
      data: {
        normalizedField: string;
        editedValue?: string | null;
        reviewStatus?: "approved" | "corrected" | "rejected" | null;
      };
    }) =>
      apiFetch<void>(`/batches/${batchId}/documents/${documentId}/fields`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
  });
}

/** Non-hook variant, used by the review queue. */
export async function updateDocumentField(
  batchId: number,
  documentId: number,
  data: {
    normalizedField: string;
    editedValue?: string | null;
    reviewStatus?: "approved" | "corrected" | "rejected" | null;
  },
): Promise<void> {
  await apiFetch<void>(`/batches/${batchId}/documents/${documentId}/fields`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

/** Removes one document (and its stored file) from a batch. */
export async function deleteDocument(
  batchId: number,
  documentId: number,
): Promise<void> {
  await apiFetch<void>(`/batches/${batchId}/documents/${documentId}`, {
    method: "DELETE",
  });
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

/** URL for fetching a stored document back (thumbnails, viewer). */
export function storageUrl(objectPath: string): string {
  const key = objectPath.startsWith("/") ? objectPath.slice(1) : objectPath;
  return apiUrl(`/storage/${key}`);
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export async function getSettings(): Promise<{ confidenceThreshold: number }> {
  return apiFetch<{ confidenceThreshold: number }>("/settings");
}

export async function updateSettings(confidenceThreshold: number): Promise<void> {
  await apiFetch("/settings", {
    method: "PATCH",
    body: JSON.stringify({ confidenceThreshold }),
  });
}
