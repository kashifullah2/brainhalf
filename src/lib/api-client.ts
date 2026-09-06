// ---------------------------------------------------------------------------
// API client.
//
// Every call goes to our own backend. There is no offline fallback and no mock
// data: the previous version answered any 404/500/network error with invented
// invoice values ("Sample Supplier LLC", "$450.00") at 0.97 confidence, which a
// user could not distinguish from a real extraction. Failures now surface as
// failures.
// ---------------------------------------------------------------------------

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import type { UseQueryOptions } from "@tanstack/react-query";

import { apiUrl } from "./api-paths";
import { errorMessage } from "./humanize-error";
import { extractDocument, type ExtractionResult } from "./ocr-client";
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
  /** Last change to the batch. See isBatchStalled. */
  updatedAt: string;
  totalDocuments: number;
  completedDocuments: number;
  failedDocuments: number;
  engineType?: string;
  prompt?: string;
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

/**
 * The transport door for every client call to our own API.
 *
 * Exported because it was not, and so each caller reimplemented the parts it
 * remembered. `fetch` rejects with a TypeError when the request never reached
 * the server — offline, DNS, a dropped connection, the dev server no longer
 * listening — and a caller that does not catch that shows the user the
 * browser's own "Failed to fetch". That is exactly how the sign-out button came
 * to report `Could not sign out — Failed to fetch`.
 *
 * Returns the raw Response: status handling belongs to the caller, which is the
 * only one that knows what a 404 or a 401 means for it.
 */
export async function apiRequest(path: string, init?: RequestInit): Promise<Response> {
  try {
    const response = await fetch(apiUrl(path), {
      ...init,
      // Send and accept the session cookie.
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        ...((init?.headers as Record<string, string>) ?? {}),
      },
    });

    if (response.status === 401 && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("auth:unauthorized"));
    }

    return response;
  } catch {
    // A genuine network failure. Report it instead of pretending to have data.
    throw new ApiError(
      "Could not reach the server. Check your connection and try again.",
      0,
    );
  }
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await apiRequest(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...((init?.headers as Record<string, string>) ?? {}),
    },
  });

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

/**
 * Extra React Query options a caller may pass — `refetchInterval`, `enabled`,
 * `select`. `queryKey` and `queryFn` are owned by the hook, so overriding them
 * would silently detach a component from the cache entry everything else
 * invalidates.
 *
 * This was `Record<string, unknown>`, which accepts anything and infers
 * nothing: every one of the four call sites had to be written `as any`, and a
 * mistyped `refetchInterval` callback would have compiled.
 */
type QueryOverrides<TData> = Omit<
  UseQueryOptions<TData, Error, TData>,
  "queryKey" | "queryFn"
>;

export function useListBatches(options?: { query?: QueryOverrides<BatchSummary[]> }) {
  const queryOpts = options?.query ?? {};
  return useQuery<BatchSummary[]>({
    queryKey: getListBatchesQueryKey(),
    queryFn: () => apiFetch<BatchSummary[]>("/batches"),
    ...queryOpts,
  });
}

export function useGetBatch(batchId: number, options?: { query?: QueryOverrides<BatchDetail> }) {
  const queryOpts = options?.query ?? {};
  return useQuery<BatchDetail>({
    queryKey: getGetBatchQueryKey(batchId),
    queryFn: () => apiFetch<BatchDetail>(`/batches/${batchId}`),
    enabled: !!batchId,
    ...queryOpts,
  });
}

export function useGetBatchSummary(batchId: number, options?: { query?: QueryOverrides<BatchSummary> }) {
  const queryOpts = options?.query ?? {};
  return useQuery<BatchSummary>({
    queryKey: ['batch', batchId, 'summary'],
    queryFn: () => apiFetch<BatchSummary>(`/batches/${batchId}`),
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
  options?: { query?: QueryOverrides<Document> },
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

export interface CancelBatchOutcome {
  /** How many documents this call moved to 'cancelled'. */
  cancelled: number;
  /** The batch's status afterwards. */
  status: string;
}

/**
 * Stops the unfinished documents in a batch and keeps the finished ones.
 *
 * The distinction from deleteBatch matters and is worth stating at the call site:
 * this preserves every document that already extracted, and a cancelled document
 * can be retried individually. Deleting throws the whole batch away, files and all.
 *
 * Idempotent — cancelling a batch that has already finished reports
 * `cancelled: 0` and is not an error.
 */
export async function cancelBatch(batchId: number): Promise<CancelBatchOutcome> {
  return apiFetch<CancelBatchOutcome>(`/batches/${batchId}/cancel`, {
    method: "POST",
  });
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
  status: "processing" | "completed" | "failed" | "queued";
  error?: string;
}

interface CreatedBatch {
  id: number;
  documents: Array<{ id: number; filename: string; position: number }>;
  asyncProcessing?: boolean;
}

export interface CreateBatchInput {
  documents: PreparedDocument[];
  mode: string;
  forceReprocess?: boolean;
  customPrompt?: string;
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
 * A failed escalation is not a failed document: the default-tier reading stands.
 * The premium quota may simply be exhausted (RULES.ocrEscalation caps it per
 * day), and throwing here would discard a usable result over a quota notice.
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
): Promise<{ result: ExtractionResult; overallConfidence: number; escalated: boolean }> {
  const result = await extractDocument(
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

  // Nothing worth re-reading when there are no fields to score, or the score
  // already clears the account's bar.
  if (!result.fields.length || overallConfidence >= threshold) {
    return { result, overallConfidence, escalated: false };
  }

  try {
    const retry = await extractDocument(
      file,
      mode,
      forceReprocess,
      customPrompt,
      "escalation",
    );
    if (retry.fields.length) {
      const retryConfidence = calculateDocumentOverallConfidence(
        retry.fields,
        retry.rawText,
      );
      if (retryConfidence > overallConfidence) {
        return { result: retry, overallConfidence: retryConfidence, escalated: true };
      }
    }
  } catch (error) {
    console.warn("[api-client] escalation re-read failed; keeping default-tier result:", error);
  }

  return { result, overallConfidence, escalated: false };
}

/**
 * Extracts each document in turn and records the outcome, one document at a time.
 *
 * Shared by createBatch and appendBatch. The two carried byte-identical copies of
 * this loop that differed only in which `mode` and `prompt` they passed and in the
 * wording of one error message — so the cancellation check below would have had to
 * be added twice, and the next change to either copy is how they drift.
 *
 * Progress is durable because each result is posted as it lands: closing the tab
 * mid-run leaves a batch that accurately reports which documents finished, and a
 * failure on document 7 no longer discards documents 1 to 6.
 */
async function runExtractionLoop(
  batchId: number,
  serverDocuments: Array<{ id: number; filename: string }>,
  localDocuments: Array<{ rawFile?: File }>,
  options: {
    mode: string;
    customPrompt: string | undefined;
    forceReprocess: boolean;
    confidenceThreshold: number;
  },
  onProgress?: (progress: CreateBatchProgress) => void,
): Promise<{ failedCount: number; cancelled: boolean }> {
  const total = serverDocuments.length;
  let failedCount = 0;

  for (let index = 0; index < serverDocuments.length; index++) {
    const serverDoc = serverDocuments[index];
    const local = localDocuments[index];

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
      const message = "The original file was not available in this browser session.";
      const outcome = await reportFailure(batchId, serverDoc.id, message);
      if (outcome.cancelled) return { failedCount, cancelled: true };
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
        options.mode,
        options.forceReprocess,
        options.customPrompt,
        options.confidenceThreshold,
      );

      const saved = await apiFetch<{ ok: true; cancelled?: boolean }>(
        `/batches/${batchId}/documents/${serverDoc.id}/result`,
        {
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
        },
      );

      // The owner stopped the batch while this document was being read. Every
      // remaining document would cost another upstream call for a result the
      // server is now going to discard, so the run ends here.
      if (saved.cancelled) {
        onProgress?.({
          current: index + 1,
          total,
          filename: serverDoc.filename,
          status: "completed",
        });
        return { failedCount, cancelled: true };
      }

      onProgress?.({
        current: index + 1,
        total,
        filename: serverDoc.filename,
        status: "completed",
      });
    } catch (error) {
      failedCount += 1;
      const message =
        errorMessage(error, "Extraction failed.");
      const outcome = await reportFailure(batchId, serverDoc.id, message);
      if (outcome.cancelled) return { failedCount, cancelled: true };
      onProgress?.({
        current: index + 1,
        total,
        filename: serverDoc.filename,
        status: "failed",
        error: message,
      });
    }
  }

  return { failedCount, cancelled: false };
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
      // Persisted on the batch so a later "Add files" re-reads the SAME
      // instructions. This was omitted, so `batches.prompt` -- the whole point of
      // migration 0005 -- was always NULL, and appending to a custom / VQA /
      // template batch silently fell through to the generic fallback prompt in
      // getPromptForMode(). Two extraction schemas in one batch, no warning.
      customPrompt: input.customPrompt,
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

  if (created.asyncProcessing) {
    onProgress?.({
      current: total,
      total,
      filename: "Queued for background extraction...",
      status: "queued",
    });
    return { id: created.id, failedCount: 0 };
  }

  // Fetched once for the batch, not per document: it is an account-level setting
  // that cannot change mid-run, so a request per page would be a round trip for
  // a value that never varies.
  const confidenceThreshold = await resolveConfidenceThreshold();

  const { failedCount } = await runExtractionLoop(
    created.id,
    created.documents,
    input.documents,
    {
      mode: input.mode,
      customPrompt: input.customPrompt,
      forceReprocess: input.forceReprocess ?? false,
      confidenceThreshold,
    },
    onProgress,
  );

  return { id: created.id, failedCount };
}

/**
 * Recording a failure must never itself break the run, so a transport error here
 * is logged and swallowed.
 *
 * Returns whether the server reported the document as already cancelled, which is
 * the signal runExtractionLoop uses to stop early.
 */
async function reportFailure(
  batchId: number,
  documentId: number,
  message: string,
): Promise<{ cancelled: boolean }> {
  try {
    const outcome = await apiFetch<{ ok: true; cancelled?: boolean }>(
      `/batches/${batchId}/documents/${documentId}/failure`,
      { method: "POST", body: JSON.stringify({ error: message }) },
    );
    return { cancelled: outcome.cancelled === true };
  } catch (error) {
    console.error("Could not record the document failure:", error);
    return { cancelled: false };
  }
}

/**
 * Extraction writes rows into two places the UI reads separately: the batch
 * list, and the review queue that collects every field that came back under the
 * account's confidence threshold. Neither mutation invalidated anything, so
 * finishing a batch left the sidebar's "Review Queue" badge showing the count
 * from before the upload — a badge reading 2 next to a page listing 3 documents
 * awaiting review, until the 60s stale window lapsed AND something else
 * happened to trigger a refetch.
 */
function invalidateAfterExtraction(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: getListBatchesQueryKey() });
  void queryClient.invalidateQueries({ queryKey: ["review-queue"] });
}

export function useCreateBatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      data,
      onProgress,
    }: {
      data: CreateBatchInput;
      onProgress?: (progress: CreateBatchProgress) => void;
    }) => createBatch(data, onProgress),
    onSuccess: () => invalidateAfterExtraction(queryClient),
  });
}

/**
 * Cancels a batch and refreshes everything the change is visible in.
 *
 * The batch's own detail query is invalidated as well as the list: the page the
 * user is looking at is the one that must stop showing "Processing" immediately,
 * and it polls the cheap summary endpoint rather than the detail, so without this
 * the table would keep its stale per-document statuses.
 */
export function useCancelBatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (batchId: number) => cancelBatch(batchId),
    onSuccess: (_outcome, batchId) => {
      invalidateAfterExtraction(queryClient);
      void queryClient.invalidateQueries({ queryKey: getGetBatchQueryKey(batchId) });
      void queryClient.invalidateQueries({ queryKey: ["batch", batchId, "summary"] });
    },
  });
}

export interface AppendBatchInput {
  batchId: number;
  documents: PreparedDocument[];
  forceReprocess?: boolean;
  customPrompt?: string;
}

interface AppendedBatch {
  id: number;
  mode: string;
  /**
   * The prompt stored on the batch. Server-authoritative on purpose: the caller
   * may pass a `customPrompt`, but the batch's own instructions are what its
   * existing documents were read with, and appending must not diverge from them.
   */
  prompt?: string;
  documents: Array<{ id: number; filename: string; position: number }>;
  asyncProcessing?: boolean;
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

  if (created.asyncProcessing) {
    onProgress?.({
      current: total,
      total,
      filename: "Queued for background extraction...",
      status: "queued",
    });
    return { id: created.id, failedCount: 0 };
  }

  // The batch's stored instructions win over anything the caller passed, so
  // appended documents are read exactly like the ones already in the batch.
  const effectivePrompt = created.prompt ?? input.customPrompt;

  // Fetched once for the batch, not per document: it is an account-level setting
  // that cannot change mid-run, so a request per page would be a round trip for
  // a value that never varies.
  const confidenceThreshold = await resolveConfidenceThreshold();

  const { failedCount } = await runExtractionLoop(
    created.id,
    created.documents,
    input.documents,
    {
      mode: created.mode,
      customPrompt: effectivePrompt,
      forceReprocess: input.forceReprocess ?? false,
      confidenceThreshold,
    },
    onProgress,
  );

  return { id: created.id, failedCount };
}

export function useAppendBatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      data,
      onProgress,
    }: {
      data: AppendBatchInput;
      onProgress?: (progress: CreateBatchProgress) => void;
    }) => appendBatch(data, onProgress),
    onSuccess: (_result, variables) => {
      invalidateAfterExtraction(queryClient);
      void queryClient.invalidateQueries({
        queryKey: getGetBatchQueryKey(variables.data.batchId),
      });
    },
  });
}

// ---------------------------------------------------------------------------
// Document mutations
// ---------------------------------------------------------------------------

/**
 * Re-downloads a document's original bytes from our storage endpoint.
 *
 * This is what makes re-extraction possible at all after a page reload. The
 * upload flow keeps the browser's `File` in memory and hands it to
 * `createBatch`, so once the tab is gone so is the only copy the client had --
 * which is why a failed document used to be permanently failed. R2 still holds
 * the bytes and /api/storage serves them to their owner, so the client can get
 * them back and run extraction again.
 */
async function fetchOriginalFile(
  objectPath: string,
  filename: string,
  contentType: string,
): Promise<File> {
  const response = await fetch(storageUrl(objectPath), {
    credentials: "same-origin",
  }).catch(() => {
    throw new ApiError(
      "Could not reach the server to fetch the original file.",
      0,
    );
  });

  if (!response.ok) {
    throw new ApiError(
      response.status === 404
        ? "The original file is no longer in storage, so it cannot be read again."
        : `Could not fetch the original file (${response.status}).`,
      response.status,
    );
  }

  const blob = await response.blob();
  // R2 records the type it was stored with; fall back to the database's copy.
  const type = blob.type || contentType || "application/octet-stream";
  return new File([blob], filename, { type });
}

export interface RetryDocumentInput {
  batchId: number;
  documentId: number;
  filename: string;
  contentType: string;
  /** Extraction preset the batch was created with. */
  mode: string;
  /** The batch's stored custom instructions, when it has any. */
  customPrompt?: string;
}

/**
 * Runs one document through extraction again, end to end.
 *
 * There was no way to do this. The endpoint existed, a `useRetryDocument` hook
 * existed, and nothing in the UI imported it -- so every transient provider
 * failure was permanent and the only recourse was to delete the document and
 * upload it again.
 *
 * `forceReprocess` is true unconditionally: the point of a retry is to not be
 * handed the cached result that failed, and the cache is keyed on the bytes,
 * which have not changed.
 *
 * A failure here is reported to .../failure rather than left alone. Otherwise a
 * retry that fails leaves the document at 'queued', and a queued document with
 * nothing running holds its whole batch at 'processing' forever.
 *
 * On a deployment with a queue consumer the endpoint re-sends the message itself
 * and answers `asyncProcessing: true`; this returns immediately in that case
 * rather than extracting the same document a second time in the browser.
 */
export async function retryDocument(input: RetryDocumentInput): Promise<void> {
  const { batchId, documentId } = input;

  const reset = await apiFetch<{
    ok: true;
    objectPath: string | null;
    asyncProcessing?: boolean;
  }>(`/batches/${batchId}/documents/${documentId}/retry`, { method: "POST" });

  // The queue consumer took it. Running the extraction here as well would spend a
  // second upstream call on the same document and race the worker's write.
  if (reset.asyncProcessing) return;

  if (!reset.objectPath) {
    const message =
      "This document has no stored file, so it cannot be read again. Upload it once more.";
    await reportFailure(batchId, documentId, message);
    throw new ApiError(message, 409);
  }

  try {
    const file = await fetchOriginalFile(
      reset.objectPath,
      input.filename,
      input.contentType,
    );

    const threshold = await resolveConfidenceThreshold();
    const { result, overallConfidence } = await extractWithEscalation(
      file,
      input.mode,
      true,
      input.customPrompt,
      threshold,
    );

    await apiFetch(`/batches/${batchId}/documents/${documentId}/result`, {
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
  } catch (error) {
    const message =
      errorMessage(error, "Extraction failed.");
    await reportFailure(batchId, documentId, message);
    throw error;
  }
}

export function useRetryDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: RetryDocumentInput) => retryDocument(input),
    // Both outcomes change what the batch view and the review queue should show,
    // so refresh on either. onSettled rather than onSuccess: a retry that ends in
    // a recorded failure has still changed the document's status and its error.
    onSettled: (_data, _error, variables) => {
      invalidateAfterExtraction(queryClient);
      void queryClient.invalidateQueries({
        queryKey: getGetBatchQueryKey(variables.batchId),
      });
      void queryClient.invalidateQueries({
        queryKey: getGetDocumentQueryKey(variables.batchId, variables.documentId),
      });
    },
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

// Re-exported so callers keep importing batch helpers from one place. The
// implementation lives in ./batch-status, which has no dependencies.
export {
  BATCH_STALL_AFTER_MS,
  isBatchInFlight,
  isBatchStalled,
} from "./batch-status";

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

// ---------------------------------------------------------------------------
// Account data
//
// A right of access and a right to erasure, neither of which existed. Settings
// promised retention control and offered none.
// ---------------------------------------------------------------------------

/**
 * Downloads everything the account holds as a JSON file.
 *
 * Streamed to a blob rather than parsed: this is the user's own archive, and there
 * is nothing to be gained from walking it through the JS heap first.
 */
export async function downloadAccountExport(): Promise<void> {
  const response = await apiRequest("/account/export");
  if (!response.ok) {
    let message = `Could not build the export (${response.status}).`;
    try {
      const parsed = (await response.json()) as { error?: string };
      if (parsed.error) message = parsed.error;
    } catch {
      // Keep the status-based message.
    }
    throw new ApiError(message, response.status);
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `brainhalf-export-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

export interface AccountDeletionProgress {
  complete: boolean;
  objectsDeleted: number;
}

/**
 * Erases the account.
 *
 * The endpoint deletes stored files in bounded batches and answers
 * `complete: false` while any remain -- it will not remove the account row until
 * the bytes are gone, because those rows are the only record of the object keys.
 * So this calls until it is told the work is finished, reporting progress as it
 * goes, rather than leaving a half-erased account behind.
 */
export async function deleteAccount(
  confirmEmail: string,
  onProgress?: (progress: AccountDeletionProgress) => void,
): Promise<number> {
  /** Bounded so a server that never reports completion cannot spin forever. */
  const MAX_ROUNDS = 20;
  let objectsDeleted = 0;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const result = await apiFetch<AccountDeletionProgress>("/account", {
      method: "DELETE",
      body: JSON.stringify({ confirmEmail }),
    });

    objectsDeleted += result.objectsDeleted ?? 0;
    onProgress?.({ complete: result.complete, objectsDeleted });

    if (result.complete) return objectsDeleted;
  }

  throw new ApiError(
    "Deletion is taking longer than expected. Some data may remain — contact support.",
    500,
  );
}

// ---------------------------------------------------------------------------
// Extraction Templates
// ---------------------------------------------------------------------------

export interface ExtractionTemplate {
  id: number;
  name: string;
  baseMode: string;
  prompt: string | null;
  description: string | null;
  expectedFields: string[];
  useCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTemplateInput {
  name: string;
  baseMode: string;
  prompt?: string;
  description?: string;
  expectedFields?: string[];
}

export type UpdateTemplateInput = Partial<CreateTemplateInput>;

export function getTemplatesQueryKey() {
  return ["templates"] as const;
}

export function useListTemplates() {
  return useQuery<ExtractionTemplate[]>({
    queryKey: getTemplatesQueryKey(),
    queryFn: () => apiFetch<ExtractionTemplate[]>("/templates"),
  });
}

export async function createTemplate(
  input: CreateTemplateInput,
): Promise<ExtractionTemplate> {
  return apiFetch<ExtractionTemplate>("/templates", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateTemplate(
  id: number,
  input: UpdateTemplateInput,
): Promise<ExtractionTemplate> {
  return apiFetch<ExtractionTemplate>(`/templates/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function deleteTemplate(id: number): Promise<void> {
  await apiFetch<{ deleted: boolean }>(`/templates/${id}`, {
    method: "DELETE",
  });
}

/** Bumps the use_count so "most used" sorting works. Fire-and-forget. */
export function trackTemplateUsage(id: number): void {
  apiFetch(`/templates/${id}`, { method: "POST" }).catch(() => {
    // Best-effort; do not interrupt the upload flow.
  });
}

// ---------------------------------------------------------------------------
// Admin metrics
//
// Counted in the database by functions/api/admin/metrics.ts. The admin console
// used to render constants written into the component — 1,428 documents, "99.2%"
// accuracy, a four-row activity feed of document ids that never existed — so it
// reported a healthy platform whatever the platform was doing.
//
// The endpoint answers 404 to a non-admin, which is what the page renders as
// "not available for this account" rather than a scarier error.
// ---------------------------------------------------------------------------

export interface AdminMetrics {
  counts: {
    users: number;
    batches: number;
    documents: number;
    queued: number;
    processing: number;
    completed: number;
    failed: number;
    completedLastDay: number;
    /** Documents that have been 'processing' past the recovery threshold. */
    stuck: number;
  };
  quality: {
    /** Null until at least one document has been scored. */
    meanConfidence: number | null;
    belowThreshold: number;
    threshold: number;
    /** Null until at least one document has finished. */
    successRate: number | null;
  };
  providers: {
    defaultTier: string | null;
    escalationTier: string | null;
    awsConfigured: boolean;
    awsRegion: string | null;
    bedrockModel: string | null;
    googleSignIn: boolean;
    transactionalEmail: boolean;
  };
  bindings: {
    database: boolean;
    storage: boolean;
    /** False means extraction runs in the browser rather than in the worker. */
    queue: boolean;
  };
  generatedAt: string;
}

export function getAdminMetricsQueryKey() {
  return ["admin", "metrics"] as const;
}

export function useAdminMetrics(options?: { query?: QueryOverrides<AdminMetrics> }) {
  const queryOpts = options?.query ?? {};
  return useQuery<AdminMetrics>({
    queryKey: getAdminMetricsQueryKey(),
    queryFn: () => apiFetch<AdminMetrics>("/admin/metrics"),
    ...queryOpts,
  });
}
