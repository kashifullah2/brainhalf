import { useState, useRef, useEffect, useMemo } from "react";
import { useRoute, Link } from "wouter";
import { formatDistanceToNow } from "date-fns";
import {
  isBatchStalled,
  useGetBatch,
  getGetBatchQueryKey,
  useUpdateDocumentField,
  useRetryDocument,
  deleteDocument,
  useAppendBatch,
  storageUrl,
  ApiError,
  type CreateBatchProgress,
  type Document,
  type ExtractedField,
  type PreparedDocument,
} from "@/lib/api-client";
import { useConfidenceThreshold } from "@/hooks/use-confidence-threshold";
import { ConfidenceBadge } from "@/components/ConfidenceIndicator";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AutoResizingTextarea } from "@/components/ui/auto-resizing-textarea";
import { ArrowRight, Search, Loader2, Download, Copy, FileText,
  ChevronDown, ChevronLeft, ChevronRight, Pencil, AlertTriangle, Trash2, X, Info,
  RotateCcw
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuGroup,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { DocumentSidePanel } from "@/components/DocumentSidePanel";
import { BackLink, EmptyState, ErrorState, ListSkeleton, PageHeader } from "@/components/app";
import { StatusBadge } from "@/components/StatusBadge";
import { UploadFlow } from "@/components/UploadModal";
import { useToast } from "@/hooks/use-toast";
import { humanizeFieldLabel } from "@/lib/humanizeField";
import { humanizeExtractionError } from "@/lib/humanize-error";
import { usePageTitle } from "@/lib/use-page-title";
import { recordsToCsv, recordsToXlsx, downloadBlob } from "@/lib/xlsx-writer";
import { sanitizeForExport } from "@/lib/utils";

/**
 * The duplicate flag, with the explanation attached.
 *
 * The label used to be the bare word "Duplicate" in amber under the filename:
 * it named a state without saying what was compared, whether the document had
 * been skipped, or what the reader was meant to do about it. Nothing is blocked
 * by it — the file is read and exported like any other — so the wording says
 * that outright, matching what the document detail page already said.
 *
 * stopPropagation because the surrounding row opens the document on click.
 */
function DuplicateFlag() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          onClick={(event) => event.stopPropagation()}
          className="inline-flex cursor-help items-center gap-1 rounded-md px-1.5 py-0.5 text-caption font-semibold bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30 transition-colors hover:bg-amber-500/25 focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Info className="h-3 w-3 shrink-0" aria-hidden="true" />
          Duplicate
        </span>
      </TooltipTrigger>
      <TooltipContent side="right" className="max-w-64">
        <p className="font-semibold">You have uploaded this file before</p>
        <p className="mt-1 text-muted-foreground">
          It is byte-for-byte identical to another document in your account. It
          was still read and is still exported — this is a heads-up, not a
          blocker.
        </p>
      </TooltipContent>
    </Tooltip>
  );
}

export default function BatchDetails() {
  const [, params] = useRoute("/app/batches/:batchId");
  const batchId = params?.batchId ? parseInt(params.batchId, 10) : 0;

  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [sidePanelDocId, setSidePanelDocId] = useState<number | null>(null);
  // FIX: per-action busy state — the old single flag showed the delete
  // spinner on the Export button and vice versa
  const [busyAction, setBusyAction] = useState<"export" | "delete" | null>(null);

  const { data: batch, isLoading, error, refetch } = useGetBatch(batchId, {
    query: {
      enabled: !!batchId,
      refetchInterval: (query) => {
        const data = query.state.data;
        if (!data) return false;
        if (data.status !== "processing" && data.status !== "queued") return false;
        // A batch whose tab went away will never move again on its own. Polling it
        // every three seconds forever is a request loop against a row that is not
        // going to change; the banner below offers to resume it instead.
        return isBatchStalled(data) ? false : 3000;
      },
    },
  });

  const updateField = useUpdateDocumentField();
  const appendBatch = useAppendBatch();
  const [isUploadOpen, setIsUploadOpen] = useState(false);

  const [editingCell, setEditingCell] = useState<{ docId: number; field: string } | null>(null);
  const [editValue, setEditValue] = useState("");
  const editInputRef = useRef<HTMLTextAreaElement>(null);
  const [page, setPage] = useState(0);
  usePageTitle(batch ? `Batch #${batch.id} · BrainHalf` : "Batch · BrainHalf", { noindex: true });
  const threshold = useConfidenceThreshold();

  // FIX: wouter reuses this component when the URL moves between batches —
  // search/selection/page/panel/editing used to leak from the previous batch
  useEffect(() => {
    setSearchTerm("");
    setSelectedRows(new Set());
    setSidePanelDocId(null);
    setEditingCell(null);
    setEditValue("");
    setPage(0);
  }, [batchId]);

  useEffect(() => {
    if (editingCell && editInputRef.current) {
      editInputRef.current.focus();
    }
  }, [editingCell]);

  const handleSaveEdit = async () => {
    if (!editingCell) return;
    const { docId, field } = editingCell;
    const doc = batch?.documents?.find((d: Document) => d.id === docId);
    const extractedField = doc?.extractedFields?.find((f: ExtractedField) => f.normalizedField === field);

    if (extractedField && (extractedField.editedValue === editValue || (!extractedField.editedValue && extractedField.value === editValue))) {
      setEditingCell(null);
      return;
    }

    try {
      await updateField.mutateAsync({
        batchId,
        documentId: docId,
        data: { normalizedField: field, editedValue: editValue || null }
      });
      await queryClient.invalidateQueries({ queryKey: getGetBatchQueryKey(batchId) });
      toast({ title: "Saved", description: "Your correction is in." });
    } catch (e) {
      toast({ title: "Update failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setEditingCell(null);
    }
  };

  const filteredRows = useMemo(() => {
    if (!batch?.rows) return [];
    if (!searchTerm) return batch.rows;
    const lower = searchTerm.toLowerCase();
    const cols = batch.columns || [];
    return batch.rows.filter((row: Record<string, unknown>) => {
      // FIX: NaN documentIds (broken rows) crashed selection & panel opening
      if (row.documentId == null || !Number.isFinite(Number(row.documentId))) return false;
      if (String(row.filename || "").toLowerCase().includes(lower)) return true;
      return cols.some((col: string) => {
        const val = row[col];
        return val && String(val).toLowerCase().includes(lower);
      });
    });
  }, [batch, searchTerm]);

  const PAGE_SIZE = 50;
  // The render loop did `docs.find(...)` per row and `extractedFields.find(...)`
  // per cell — O(rows x docs) and O(cells x fields) on every keystroke in the
  // search box. Indexed once per batch instead.
  const docsById = useMemo(() => {
    const map = new Map<number, any>();
    for (const d of batch?.documents ?? []) map.set(d.id, d);
    return map;
  }, [batch?.documents]);

  const fieldsByDoc = useMemo(() => {
    const map = new Map<number, Map<string, any>>();
    for (const d of batch?.documents ?? []) {
      const byName = new Map<string, any>();
      for (const f of d.extractedFields ?? []) byName.set(f.normalizedField, f);
      map.set(d.id, byName);
    }
    return map;
  }, [batch?.documents]);

  const pageCount = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const pagedRows = useMemo(
    () => filteredRows.slice(currentPage * PAGE_SIZE, currentPage * PAGE_SIZE + PAGE_SIZE),
    [filteredRows, currentPage],
  );

  useEffect(() => { setPage(0); }, [searchTerm]);

  // FIX: OCR values contain newlines — they silently broke TSV copies and
  // markdown table rows (one cell became five)
  const oneLine = (v: unknown) => String(v ?? "").replace(/\s*[\r\n]+\s*/g, " ");
  const cell = (v: unknown) => sanitizeForExport(oneLine(v));

  const buildExportData = (onlySelected = false) => {
    if (!batch) return [];
    const cols = batch.columns || [];
    const rowsToExport = onlySelected
      ? filteredRows.filter((r: Record<string, unknown>) => selectedRows.has(Number(r.documentId)))
      : filteredRows;

    return rowsToExport.map((row: Record<string, unknown>) => {
      const rowData: Record<string, string> = {
        Filename: cell(row.filename),
        Status: cell(row.status),
      };
      for (const col of cols) {
        rowData[humanizeFieldLabel(col)] = cell(row[col]);
      }
      return rowData;
    });
  };

  // FIX: empty view used to export a header-only file with no feedback
  const ensureRows = () => {
    if (filteredRows.length) return true;
    toast({ title: "Nothing to export", description: "This view has no rows." });
    return false;
  };

  const toggleSelectAll = () => {
    if (selectedRows.size === filteredRows.length) {
      setSelectedRows(new Set());
    } else {
      setSelectedRows(new Set(filteredRows.map((row: Record<string, unknown>) => Number(row.documentId))));
    }
  };

  const toggleRowSelect = (docId: number) => {
    const next = new Set(selectedRows);
    if (next.has(docId)) next.delete(docId);
    else next.add(docId);
    setSelectedRows(next);
  };

  const handleBulkExport = () => {
    if (!batch || selectedRows.size === 0 || busyAction) return;
    setBusyAction("export");
    try {
      downloadBlob(
        new Blob([recordsToCsv(buildExportData(true))], { type: "text/csv;charset=utf-8;" }),
        `batch_${batch.id}_selected_export.csv`,
      );
      toast({ title: "Exported selected rows" });
    } catch (e) {
      toast({ title: "Export failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setBusyAction(null);
    }
  };

  /**
   * Pending confirmation for the bulk delete.
   *
   * This action removed database rows AND the stored source files in R2, with no
   * confirmation of any kind -- one click on a floating bar, irreversible. The
   * dashboard already gated batch deletion behind exactly this dialog, so the
   * safer pattern existed in the codebase and had simply not been applied to the
   * finer-grained, more easily mis-clicked version of it.
   */
  const [pendingDelete, setPendingDelete] = useState<number[] | null>(null);

  const handleBulkDelete = async () => {
    const ids = pendingDelete ?? [];
    if (ids.length === 0 || busyAction) return;
    setBusyAction("delete");
    try {
      // FIX: chunks of 3 in parallel — was strictly sequential, slow on big selections
      for (let i = 0; i < ids.length; i += 3) {
        await Promise.all(ids.slice(i, i + 3).map((documentId) => deleteDocument(batchId, documentId)));
      }
      await queryClient.invalidateQueries({ queryKey: getGetBatchQueryKey(batchId) });
      setSelectedRows(new Set());
      toast({ title: `${ids.length} document${ids.length === 1 ? "" : "s"} deleted` });
    } catch (e) {
      toast({ title: "Delete failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setBusyAction(null);
      setPendingDelete(null);
    }
  };

  const handleExportCSV = () => {
    if (!batch || !ensureRows()) return;
    downloadBlob(
      new Blob([recordsToCsv(buildExportData())], { type: "text/csv;charset=utf-8;" }),
      `batch_${batch.id}_export.csv`,
    );
    toast({ title: "CSV exported" });
  };

  const handleExportExcel = () => {
    if (!batch || !ensureRows()) return;
    downloadBlob(recordsToXlsx(buildExportData(), "Batch Data"), `batch_${batch.id}_export.xlsx`);
    toast({ title: "Excel exported" });
  };

  const handleExportJSON = () => {
    if (!batch || !ensureRows()) return;
    const cols = batch.columns || [];
    const payload = filteredRows.map((row: Record<string, unknown>) => {
      const record: Record<string, unknown> = { filename: row.filename, status: row.status };
      // FIX: null, not "—" — em-dashes pollute machine-readable output
      for (const col of cols) record[col] = row[col] ?? null;
      return record;
    });
    downloadBlob(
      new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }),
      `batch_${batch.id}_export.json`,
    );
    toast({ title: "JSON exported" });
  };

  const handleCopyClipboard = async () => {
    if (!batch || !ensureRows()) return;
    const cols = batch.columns || [];
    const headers = ["Filename", "Status", ...cols.map(humanizeFieldLabel)];
    const tsvRows = filteredRows.map((row: Record<string, unknown>) =>
      [cell(row.filename), cell(row.status), ...cols.map((col: string) => cell(row[col]))].join("\t")
    );
    const content = [headers.join("\t"), ...tsvRows].join("\n");
    try {
      // FIX: was fire-and-forget — the "Copied" toast fired even when the
      // clipboard write threw
      await navigator.clipboard.writeText(content);
      toast({ title: "Copied to clipboard" });
    } catch {
      toast({ title: "Copy failed", description: "Your browser blocked clipboard access.", variant: "destructive" });
    }
  };

  const handleExportMarkdown = () => {
    if (!batch || !ensureRows()) return;
    const cols = batch.columns || [];
    const headers = ["Filename", "Status", ...cols.map(humanizeFieldLabel)];
    let md = `| ${headers.join(" | ")} |\n| ${headers.map(() => "---").join(" | ")} |\n`;
    filteredRows.forEach((row: Record<string, unknown>) => {
      const rowData = [
        cell(row.filename),
        cell(row.status),
        ...cols.map((col: string) => cell(row[col]).replace(/\|/g, "\\|"))
      ];
      md += `| ${rowData.join(" | ")} |\n`;
    });
    downloadBlob(new Blob([md], { type: "text/markdown;charset=utf-8;" }), `batch_${batch.id}_export.md`);
    toast({ title: "Markdown exported" });
  };

  const handleAppendBatchWrapper = async (
    data: { documents: PreparedDocument[]; mode: string; forceReprocess?: boolean; customPrompt?: string; },
    onProgress?: (progress: CreateBatchProgress) => void,
  ) => {
    if (!batch) throw new Error("The batch is still loading.");
    return appendBatch.mutateAsync({
      data: {
        batchId: batch.id,
        documents: data.documents,
        forceReprocess: data.forceReprocess,
        customPrompt: data.customPrompt,
      },
      onProgress,
    });
  };

  const handleBatchAppended = () => {
    setIsUploadOpen(false);
    queryClient.invalidateQueries({ queryKey: getGetBatchQueryKey(batchId) });
    toast({ title: `Added to Batch #${batch?.id ?? ""}`.trim() });
  };

  // ── Retry ────────────────────────────────────────────────────────────
  // There was no retry anywhere in the product. The endpoint and the hook both
  // existed; nothing imported them. A document that failed once was failed for
  // good, and the only way forward was to delete it and upload it again.
  const retry = useRetryDocument();
  const [retryingIds, setRetryingIds] = useState<Set<number>>(new Set());
  const [isRetryingAll, setIsRetryingAll] = useState(false);

  const runRetry = async (docId: number): Promise<boolean> => {
    const doc = docsById.get(docId);
    if (!doc || !batch) return false;
    setRetryingIds((prev) => new Set(prev).add(docId));
    try {
      await retry.mutateAsync({
        batchId,
        documentId: docId,
        filename: doc.filename,
        contentType: doc.contentType,
        mode: batch.engineType || "invoice",
        customPrompt: batch.prompt,
      });
      return true;
    } catch {
      return false;
    } finally {
      setRetryingIds((prev) => {
        const next = new Set(prev);
        next.delete(docId);
        return next;
      });
    }
  };

  /**
   * Picks up a batch whose extraction was interrupted.
   *
   * Runs the same path as a retry, which works because the bytes come back out of
   * storage rather than from the browser's memory -- so a batch abandoned days ago
   * in a tab that no longer exists can still be finished.
   */
  const handleResumeBatch = async (ids: number[]) => {
    if (!ids.length || isRetryingAll) return;
    setIsRetryingAll(true);
    let done = 0;
    try {
      for (const id of ids) {
        if (await runRetry(id)) done += 1;
      }
      toast({
        title: `${done} of ${ids.length} finished`,
        description:
          done === ids.length
            ? "The batch is complete."
            : "The ones that failed have an error message on the row.",
        variant: done === 0 ? ("destructive" as const) : undefined,
      });
    } finally {
      setIsRetryingAll(false);
    }
  };

  const handleRetryDocument = async (docId: number) => {
    const ok = await runRetry(docId);
    toast(
      ok
        ? { title: "Read again", description: "Extraction finished for that document." }
        : {
            title: "Retry failed",
            description: "The document could not be read. Its error message is updated.",
            variant: "destructive" as const,
          },
    );
  };

  // Sequential on purpose: each retry is a full model call, and firing a whole
  // batch of them at once is the fastest way to hit the account's OCR rate limit
  // and turn recoverable failures into a wall of 429s.
  const handleRetryAllFailed = async (ids: number[]) => {
    if (!ids.length || isRetryingAll) return;
    setIsRetryingAll(true);
    let recovered = 0;
    try {
      for (const id of ids) {
        if (await runRetry(id)) recovered += 1;
      }
      toast({
        title: `${recovered} of ${ids.length} recovered`,
        description:
          recovered === ids.length
            ? "Every failed document was read successfully."
            : "The ones that failed again have an updated error message.",
        variant: recovered === 0 ? ("destructive" as const) : undefined,
      });
    } finally {
      setIsRetryingAll(false);
    }
  };

  if (isLoading) return <ListSkeleton rows={6} />;

  // Distinct from `!batch` below: a request that failed is not the same thing as
  // a batch that is gone, and "Batch not found" sent people looking for a
  // deletion that never happened.
  if (error) {
    const isUnauthorized = error instanceof ApiError && error.status === 401;
    return (
      <ErrorState
        title={isUnauthorized ? "Session expired" : "Could not load this batch"}
        body={
          isUnauthorized
            ? "Your session has expired. Please sign in again to view this batch."
            : "The batch and its extracted data are untouched. Try again in a moment."
        }
        onRetry={
          isUnauthorized
            ? () => { window.location.href = "/sign-in"; }
            : () => void refetch()
        }
      />
    );
  }

  if (!batch) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title="Batch not found"
        body="It may have been deleted, or the link points somewhere that doesn't exist."
        action={
          <Button asChild>
            <Link href="/app">Return to dashboard</Link>
          </Button>
        }
      />
    );
  }

  const getCellDisplay = (row: Record<string, unknown>, col: string) => {
    const val = row[col];
    if (val === undefined || val === null) return "—";
    return String(val);
  };

  const cols = batch.columns || [];
  const docs = batch.documents || [];

  return (
    <div className="flex flex-col gap-6">
      {/* ── Header ─────────────────────────────────────────── */}
      <PageHeader
        className="mb-0"
        size="detail"
        back={<BackLink href="/app" label="Back to dashboard" />}
        title={<>Batch #{batch.id}</>}
        titleAdornment={<StatusBadge status={batch.status} />}
        description={
          <>
            {batch.totalDocuments} file{batch.totalDocuments !== 1 ? "s" : ""} · {batch.status === "completed" ? "completed" : "started"} {formatDistanceToNow(new Date(batch.createdAt), { addSuffix: true })}
          </>
        }
        actions={<>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="rounded-lg h-9 px-3.5 text-body-sm font-semibold border-border/60">
                <Download className="mr-1.5 h-3.5 w-3.5" /> Export <ChevronDown className="ml-1 h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" sideOffset={4} className="min-w-48 rounded-lg">
              <DropdownMenuGroup>
                <DropdownMenuLabel className="text-label font-semibold text-muted-foreground pt-1.5 pb-1">File formats</DropdownMenuLabel>
                <DropdownMenuItem onClick={handleExportCSV} className="rounded-md text-body-sm cursor-pointer"><FileText className="mr-2 h-3.5 w-3.5 text-muted-foreground" /> Export CSV</DropdownMenuItem>
                <DropdownMenuItem onClick={handleExportExcel} className="rounded-md text-body-sm cursor-pointer"><FileText className="mr-2 h-3.5 w-3.5 text-muted-foreground" /> Export Excel</DropdownMenuItem>
                <DropdownMenuItem onClick={handleExportJSON} className="rounded-md text-body-sm cursor-pointer"><FileText className="mr-2 h-3.5 w-3.5 text-muted-foreground" /> Export JSON</DropdownMenuItem>
                <DropdownMenuItem onClick={handleExportMarkdown} className="rounded-md text-body-sm cursor-pointer"><FileText className="mr-2 h-3.5 w-3.5 text-muted-foreground" /> Export Markdown</DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel className="text-label font-semibold text-muted-foreground pt-1.5 pb-1">Clipboard</DropdownMenuLabel>
                <DropdownMenuItem onClick={handleCopyClipboard} className="rounded-md text-body-sm cursor-pointer"><Copy className="mr-2 h-3.5 w-3.5 text-muted-foreground" /> Copy as TSV</DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          <Dialog open={isUploadOpen} onOpenChange={setIsUploadOpen}>
            <DialogTrigger asChild>
              <Button className="rounded-lg h-9 px-4 text-body-sm font-semibold shadow-sm">
                <FileText className="mr-1.5 h-3.5 w-3.5" /> Add files
              </Button>
            </DialogTrigger>
            <DialogContent className="gap-0 overflow-hidden rounded-xl border border-border bg-card p-0 shadow-xl sm:max-w-xl">
              <DialogHeader className="space-y-1 border-b border-border/60 bg-muted/20 p-5">
                <DialogTitle className="text-body-lg font-semibold">Add to Batch #{batch.id}</DialogTitle>
                <DialogDescription className="text-body-sm">
                  New files are read with this batch's {batch.engineType || "invoice"} settings.
                </DialogDescription>
              </DialogHeader>
              <div className="bg-background p-5">
                <UploadFlow
                  mode={batch.engineType || "invoice"}
                  customPrompt={batch.prompt}
                  onBatchCreated={handleBatchAppended}
                  createBatchFn={handleAppendBatchWrapper}
                />
              </div>
            </DialogContent>
          </Dialog>
        </>}
      />

      {/* Interrupted-batch banner.
          Extraction runs in the tab that started it, so a closed or reloaded tab
          leaves documents at 'queued' and the batch at 'processing' with nothing
          to move them. That state was invisible and permanent: the page simply
          polled forever. */}
      {isBatchStalled(batch) && (() => {
        const unfinished = docs.filter(
          (d: Document) => d.status === "queued" || d.status === "processing",
        );
        if (!unfinished.length) return null;
        return (
          <div className="flex flex-wrap items-start gap-3 rounded-xl border border-warning/40 bg-warning/5 p-4">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-warning/10 text-warning">
              <AlertTriangle className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1 space-y-0.5 mt-0.5">
              <p className="text-body-sm font-semibold text-foreground">
                Extraction stopped part-way through
              </p>
              <p className="text-body-sm text-muted-foreground">
                {unfinished.length} document{unfinished.length === 1 ? "" : "s"} never
                finished — this happens when the tab is closed mid-batch. Nothing is
                lost: the files are stored, and resuming reads them again from here.
              </p>
            </div>
            <Button
              size="sm"
              onClick={() => handleResumeBatch(unfinished.map((d: Document) => Number(d.id)))}
              disabled={isRetryingAll || !!busyAction}
              className="mt-0.5 h-8 shrink-0 gap-1.5 rounded-lg px-3 text-label font-semibold"
            >
              {isRetryingAll ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RotateCcw className="h-3.5 w-3.5" />
              )}
              {isRetryingAll ? "Working…" : "Resume extraction"}
            </Button>
          </div>
        );
      })()}

      {/* Failed-documents banner.
          This only appeared when EVERY document in the batch had failed, so the
          common case -- three bad scans out of forty -- had no banner and no
          route to a retry at all. It now surfaces any failure and offers the
          recovery action next to it. */}
      {(() => {
        const failed = docs.filter((d: Document) => d.status === "failed");
        if (!failed.length) return null;
        const allFailed = failed.length === docs.length;
        const human = humanizeExtractionError(failed[0]?.error);
        const failedIds = failed.map((d: Document) => Number(d.id));
        return (
          <div className="flex flex-wrap items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4" title={failed[0]?.error ?? undefined}>
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
              <AlertTriangle className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1 space-y-0.5 mt-0.5">
              <p className="text-body-sm font-semibold text-foreground">
                {allFailed
                  ? human.title
                  : `${failed.length} of ${docs.length} document${docs.length === 1 ? "" : "s"} could not be read`}
              </p>
              <p className="text-body-sm text-muted-foreground">
                {allFailed
                  ? human.body
                  : "The rest of the batch is unaffected. Retrying reads the stored originals again."}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleRetryAllFailed(failedIds)}
              disabled={isRetryingAll || !!busyAction}
              className="mt-0.5 h-8 shrink-0 gap-1.5 rounded-lg border-destructive/40 bg-card px-3 text-label font-semibold text-foreground"
            >
              {isRetryingAll ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RotateCcw className="h-3.5 w-3.5" />
              )}
              {isRetryingAll
                ? "Reading again…"
                : `Retry ${failed.length === 1 ? "this document" : `all ${failed.length}`}`}
            </Button>
          </div>
        );
      })()}

      {/* ── Table ───────────────────────────────────────────── */}
      <div className="flex flex-col xl:flex-row gap-6 items-start">
        <div className="bg-card border border-border/60 rounded-xl shadow-sm flex flex-col flex-1 min-w-0 w-full overflow-hidden">

          {/* Toolbar */}
          <div className="p-3 border-b border-border/60 flex flex-col sm:flex-row gap-3 justify-between items-center bg-muted/20">
            {batch.totalDocuments > 1 ? (
              <div className="relative w-full sm:w-80">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search..."
                  className="pl-9 h-9 rounded-lg bg-background border-border/60 text-body-sm"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
            ) : <div />}
            {/* FIX: the audit called out "double-click to edit" as
                undiscoverable — say it where people can see it */}
            <span className="hidden md:flex items-center gap-1.5 text-label text-muted-foreground shrink-0">
              <Pencil className="h-3 w-3" /> Double-click a value to edit · click a row to review
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse table-fixed min-w-[720px]">
              <colgroup>
                <col style={{ width: "48px" }} />
                <col style={{ width: "260px" }} />
                {/* Wide enough for the badge plus the retry control a failed row
                    carries; at 120px they collided. */}
                <col style={{ width: "176px" }} />
                {cols.map((col) => <col key={col} style={{ width: "200px" }} />)}
                <col style={{ width: "40px" }} />
              </colgroup>
              {/* A batch with many extracted fields scrolls sideways, and the
                  Document column used to scroll away with it — leaving rows of
                  values with no way to tell which file they came from. The first
                  two columns are pinned; opaque backgrounds (not the /80 tint)
                  because scrolling cells pass underneath them. */}
              <thead className="sticky top-0 z-20 border-b border-border/60 bg-muted shadow-sm">
                <tr>
                  <th className="sticky left-0 z-10 whitespace-nowrap bg-muted px-4 py-3">
                    <input
                      type="checkbox"
                      aria-label="Select all rows"
                      className="rounded border-border/60 text-primary h-3.5 w-3.5 cursor-pointer accent-primary"
                      checked={filteredRows.length > 0 && selectedRows.size === filteredRows.length}
                      onChange={toggleSelectAll}
                    />
                  </th>
                  <th className="sticky left-12 z-10 whitespace-nowrap border-r border-border/60 bg-muted px-4 py-3 text-label font-semibold text-muted-foreground">Document</th>
                  <th className="px-4 py-3 whitespace-nowrap text-label font-semibold text-muted-foreground">Status</th>
                  {cols.map((col) => (
                    <th key={col} className="px-4 py-3 whitespace-nowrap overflow-hidden text-ellipsis text-label font-semibold text-muted-foreground" title={humanizeFieldLabel(col)}>
                      {humanizeFieldLabel(col)}
                    </th>
                  ))}
                  <th className="px-2 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50 text-body-sm">
                {filteredRows.length === 0 ? (
                  <tr>
                    {/* FIX: was cols.length + 3 — the table has 3 fixed + N data
                        + 1 arrow columns = N + 4. The empty cell didn't span it. */}
                    <td colSpan={cols.length + 4} className="px-4 py-20 text-center">
                      <p className="font-semibold text-foreground">Nothing found</p>
                      <p className="text-muted-foreground mt-1 text-body-sm">No documents match your search.</p>
                    </td>
                  </tr>
                ) : (
                  pagedRows.map((row: Record<string, unknown>) => {
                    const docId = Number(row.documentId);
                    const isFailed = row.status === "failed";
                    const docInfo = docsById.get(docId);
                    const isDuplicate = Boolean(docInfo?.isDuplicate);
                    const isSelected = selectedRows.has(docId);
                    // The pinned columns cannot use the row's translucent tint —
                    // scrolling cells would show through them. An inset shadow
                    // over bg-card produces the same colour, opaquely.
                    const stickyTint = isSelected
                      ? "shadow-[inset_0_0_0_9999px_color-mix(in_oklab,var(--primary)_5%,transparent)]"
                      : "group-hover:shadow-[inset_0_0_0_9999px_color-mix(in_oklab,var(--muted-foreground)_8%,transparent)]";

                    return (
                      <tr
                        key={docId}
                        /* Selection is the only state that repaints a row.
                           "Duplicate" used to wash the entire row in
                           `bg-warning/5`, which on the dark theme read as a
                           whole-row error for what is a neutral fact — this file
                           has been seen before, its data is fine, and the inline
                           badge under the filename already says so. */
                        className={`group cursor-pointer transition-colors
                          ${isSelected
                            ? "bg-primary/5 hover:bg-primary/10"
                            : "bg-card hover:bg-muted/50"}`}
                        onClick={(e) => {
                          const t = e.target as HTMLElement;
                          if (t.tagName === "INPUT" || t.tagName === "BUTTON" || t.closest("button")) return;
                          // FIX: selection-aware row click — clicking rows while
                          // selecting shouldn't fling the panel open
                          if (selectedRows.size > 0) { toggleRowSelect(docId); return; }
                          setSidePanelDocId(docId);
                        }}
                      >
                        <td className={`sticky left-0 z-10 bg-card px-4 py-3 ${stickyTint}`}>
                          <input
                            type="checkbox"
                            aria-label={`Select document ${row.filename ?? docId}`}
                            className="rounded border-border/60 text-primary h-3.5 w-3.5 cursor-pointer accent-primary"
                            checked={isSelected}
                            onChange={() => toggleRowSelect(docId)}
                            onClick={(e) => e.stopPropagation()}
                          />
                        </td>
                        <td className={`sticky left-12 z-10 min-w-0 border-r border-border/60 bg-card px-4 py-3 ${stickyTint}`}>
                          <div className="flex items-center gap-2.5">
                            {docInfo?.objectPath && docInfo?.contentType?.startsWith("image/") ? (
                              <img
                                src={storageUrl(docInfo.objectPath)}
                                className="h-8 w-8 shrink-0 rounded-md border border-border/50 bg-muted object-cover"
                                width={32}
                                height={32}
                                loading="lazy"
                                decoding="async"
                                alt=""
                              />
                            ) : (
                              <div className="flex h-8 w-8 items-center justify-center rounded-md border border-border/50 bg-muted shrink-0">
                                <FileText className={`h-3.5 w-3.5 ${isDuplicate ? "text-warning" : "text-muted-foreground"}`} />
                              </div>
                            )}
                            <div className="min-w-0">
                              <p className="truncate font-medium text-foreground group-hover:text-primary transition-colors" title={String(row.filename)}>{String(row.filename)}</p>
                              {isDuplicate && <DuplicateFlag />}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <StatusBadge status={String(row.status)} title={isFailed ? docInfo?.error : undefined} />
                            {isFailed && (
                              <Button
                                variant="ghost"
                                size="sm"
                                aria-label={`Retry extraction for ${row.filename ?? docId}`}
                                title="Read this document again"
                                disabled={retryingIds.has(docId) || isRetryingAll}
                                onClick={(e) => {
                                  // The row's own onClick opens the side panel.
                                  e.stopPropagation();
                                  void handleRetryDocument(docId);
                                }}
                                className="h-6 gap-1 rounded-md px-1.5 text-caption font-semibold text-muted-foreground hover:text-foreground [&_svg]:size-3"
                              >
                                {retryingIds.has(docId) ? (
                                  <Loader2 className="animate-spin" />
                                ) : (
                                  <RotateCcw />
                                )}
                                Retry
                              </Button>
                            )}
                          </div>
                        </td>
                        {cols.map((col) => {
                          const isEditing = editingCell?.docId === docId && editingCell?.field === col;
                          const extractedField = fieldsByDoc.get(docId)?.get(col);
                          const corrected = !!(extractedField && extractedField.editedValue !== null);
                          const confidence = extractedField?.confidence;
                          const val = getCellDisplay(row, col);

                          if (isFailed) return <td key={col} className="px-4 py-3 text-muted-foreground/40">—</td>;

                          // FIX: fixed-width popovers anchored left got clipped by
                          // the overflow container on the right-most columns
                          const anchorRight = cols.indexOf(col) >= cols.length - 2;

                          return (
                            <td
                              key={col}
                              className="px-4 py-2.5 relative"
                              onDoubleClick={(e) => {
                                e.stopPropagation();
                                setEditingCell({ docId, field: col });
                                setEditValue(val === "—" ? "" : val);
                              }}
                            >
                              {isEditing ? (
                                <div className={`absolute top-0 z-30 w-[min(300px,80vw)] p-1.5 bg-card rounded-lg shadow-xl border border-primary ${anchorRight ? "right-0" : "left-0"}`}>
                                  <AutoResizingTextarea
                                    ref={editInputRef}
                                    value={editValue}
                                    onChange={(e) => setEditValue(e.target.value)}
                                    onBlur={handleSaveEdit}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSaveEdit(); }
                                      if (e.key === "Escape") setEditingCell(null);
                                    }}
                                    minRows={1} maxRows={8}
                                    className="text-body-sm h-auto p-2"
                                    onClick={(e) => e.stopPropagation()}
                                  />
                                </div>
                              ) : (
                                <div className="flex flex-col min-w-0 group/cell">
                                  <div className="flex items-start justify-between gap-1">
                                    <span className={`line-clamp-2 whitespace-pre-wrap break-words leading-relaxed text-label ${corrected ? "text-foreground font-semibold" : "text-foreground"}`} title={val}>
                                      {val}
                                    </span>
                                    <div className="opacity-0 group-hover/cell:opacity-100 transition-opacity" title="Double-click to edit">
                                      <Pencil className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" />
                                    </div>
                                  </div>
                                  {corrected ? (
                                    <span className="text-micro font-semibold text-success mt-1 flex items-center gap-1"><Pencil className="h-2.5 w-2.5" /> Edited</span>
                                  ) : (
                                    val !== "—" && confidence !== undefined && confidence < threshold && (
                                      <div className="mt-1 flex items-center">
                                        <ConfidenceBadge value={confidence} threshold={threshold} />
                                      </div>
                                    )
                                  )}
                                </div>
                              )}
                            </td>
                          );
                        })}
                        <td className="px-2 py-3 text-right">
                          <div className="flex justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                            <div className="flex h-6 w-6 items-center justify-center rounded bg-muted/60 text-muted-foreground">
                              <ArrowRight className="h-3 w-3" />
                            </div>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          <div className="p-3 border-t border-border/60 bg-muted/20 text-label flex items-center justify-between gap-4">
            <span className="text-muted-foreground">{filteredRows.length} row{filteredRows.length === 1 ? "" : "s"}</span>
            {pageCount > 1 && (
              /* These two were 11px text (`text-caption`) with no icon, which
                 undercut the 12px `size="sm"` already gives them, and a disabled
                 "Prev" on page one all but vanished against the footer's muted
                 fill. Chevrons, the standard label step, and an announced page
                 position. */
              <nav className="flex items-center gap-2" aria-label="Table pages">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1 rounded-lg px-2.5"
                  onClick={() => setPage(p => Math.max(0, p - 1))}
                  disabled={currentPage === 0}
                  aria-label="Previous page"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                  Prev
                </Button>
                <span className="font-data text-label font-medium text-muted-foreground" aria-live="polite">
                  Page {currentPage + 1} of {pageCount}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1 rounded-lg px-2.5"
                  onClick={() => setPage(p => Math.min(pageCount - 1, p + 1))}
                  disabled={currentPage >= pageCount - 1}
                  aria-label="Next page"
                >
                  Next
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </nav>
            )}
          </div>
        </div>
      </div>

      {/* ── Document side panel (overlay — doesn't squeeze the table) ── */}
      {sidePanelDocId && (
        <>
          <div className="fixed inset-0 z-40 bg-background/80 backdrop-blur-sm animate-in fade-in duration-200" onClick={() => setSidePanelDocId(null)} />
          {/* The drawer owns the edge: border-l and no radius. The panel
              inside used to draw its own `border rounded-xl`, so a rounded card
              sat inside a square sheet — two borders down the left side and two
              rounded corners cut off against the viewport edge. */}
          <div className="fixed inset-y-0 right-0 z-50 w-full border-l border-border bg-card shadow-2xl animate-in slide-in-from-right duration-300 sm:w-[600px] xl:w-[760px]">
            <DocumentSidePanel doc={sidePanelDocId === null ? null : docsById.get(sidePanelDocId)} onClose={() => setSidePanelDocId(null)} />
          </div>
        </>
      )}

      {/* ── Bulk action floating bar ────────────────────────── */}
      {selectedRows.size > 0 && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 rounded-xl border border-border/70 bg-card/95 px-3.5 py-2 shadow-xl backdrop-blur-md animate-in slide-in-from-bottom-5">
          <span className="text-label font-semibold text-foreground pr-1">{selectedRows.size} selected</span>
          <div className="h-3.5 w-px bg-border/60" />
          <Button
            onClick={handleBulkExport}
            disabled={!!busyAction}
            variant="secondary"
            size="sm"
            className="h-7 gap-1 rounded-lg px-2.5 [&_svg]:size-3"
          >
            {/* FIX: spinners now match the button actually working */}
            {busyAction === "export" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />} Export CSV
          </Button>
          <div className="h-3.5 w-px bg-border/60" />
          <Button
            onClick={() => setPendingDelete([...selectedRows])}
            disabled={!!busyAction}
            variant="outline"
            size="sm"
            className="h-7 gap-1 rounded-lg border-destructive/30 bg-destructive/10 px-2.5 text-destructive [&_svg]:size-3"
          >
            {busyAction === "delete" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />} Delete
          </Button>
          <div className="h-3.5 w-px bg-border/60" />
          <button
            onClick={() => setSelectedRows(new Set())}
            aria-label="Clear selection"
            className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* ── Delete confirmation ─────────────────────────────── */}
      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open && busyAction !== "delete") setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {pendingDelete?.length ?? 0} document
              {(pendingDelete?.length ?? 0) === 1 ? "" : "s"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This removes the extracted fields and the stored source files as
              well. It is immediate and cannot be undone — the rest of the batch
              is untouched.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busyAction === "delete"}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                // Keep the dialog mounted while the deletes run, so the button can
                // show progress instead of the bar flashing back with a spinner.
                event.preventDefault();
                void handleBulkDelete();
              }}
              disabled={busyAction === "delete"}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {busyAction === "delete" ? (
                <>
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Deleting…
                </>
              ) : (
                "Delete permanently"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
