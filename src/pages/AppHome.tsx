import { useState, useCallback, useEffect, useMemo } from "react";
import { useLocation } from "wouter";
import { formatDistanceToNow } from "date-fns";
import {
  Plus, Loader2, Trash2, Download,
  CheckSquare, Square, X, ArrowRight,
  FileCheck2, FileText, BarChart3, CheckCircle2, Activity, AlertTriangle,
  Search, MoreHorizontal
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { PRESETS } from "@/components/UploadModal";
import { useAuth } from "@/context/AuthContext";
import {
  useListBatches,
  getBatch,
  deleteBatch,
  getListBatchesQueryKey,
  isBatchStalled,
  storageUrl,
  type BatchSummary,
} from "@/lib/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { usePageTitle } from "@/lib/use-page-title";
import { humanizeFieldLabel } from "@/lib/humanize-field";
import { sanitizeForExport } from "@/lib/utils";
import { recordsToCsv, recordsToXlsx, downloadBlob } from "@/lib/xlsx-writer";
import { EmptyState, ErrorState, ListSkeleton, PageHeader, StatCard, greeting } from "@/components/app";
import { StatusBadge } from "@/components/StatusBadge";
import { errorMessage } from "@/lib/humanize-error";

/* ── Helpers ─────────────────────────────────────────────── */

const tOf = (v?: string) => (v ? new Date(v).getTime() || 0 : 0);

function timeAgo(ts?: string) {
  if (!ts) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ""; // FIX: bad dates no longer crash the row
  return formatDistanceToNow(d, { addSuffix: true });
}

type BusyAction = "csv" | "excel" | "delete" | null;

/* ── Page ────────────────────────────────────────────────── */
export default function AppHome() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  usePageTitle("Dashboard · BrainHalf", { noindex: true });
  const queryClient = useQueryClient();
  const { user } = useAuth();

  // Poll while anything is queued or processing, so the list actually moves
  // without the user reloading; idle lists cost nothing.
  const { data: batches, isLoading, error } = useListBatches({
    query: {
      // Poll only while something is actually moving. A batch whose tab went away
      // stays 'processing' for good, so counting it as in-flight meant polling the
      // dashboard every four seconds forever. Open the batch to resume it.
      refetchInterval: (query) =>
        query.state.data?.some(
          (b) =>
            (b.status === "processing" || b.status === "queued") && !isBatchStalled(b),
        )
          ? 4000
          : false,
    },
  });

  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  // FIX: per-action busy state — one shared flag spun all three buttons at once
  const [busyAction, setBusyAction] = useState<BusyAction>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterEngine, setFilterEngine] = useState("all");
  const [sortOrder, setSortOrder] = useState<"newest" | "oldest">("newest");
  // FIX: permanent delete now goes through a confirmation dialog
  const [pendingDelete, setPendingDelete] = useState<{ ids: number[]; label: string } | null>(null);

  // FIX: prune ids that no longer exist instead of keeping zombie selections
  useEffect(() => {
    if (!batches) return;
    const alive = new Set(batches.map((b: BatchSummary) => b.id));
    setSelectedIds((prev) => {
      const next = new Set([...prev].filter((id) => alive.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [batches]);

  const filteredBatches = useMemo(() => {
    if (!batches) return [];
    let r = [...batches];
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      r = r.filter((b: BatchSummary) =>
        b.id.toString().includes(q) ||
        (b.firstDocumentContentType && b.firstDocumentContentType.toLowerCase().includes(q))
      );
    }
    if (filterStatus !== "all") r = r.filter((b: BatchSummary) => b.status === filterStatus);
    if (filterEngine !== "all") r = r.filter((b: BatchSummary) => b.engineType === filterEngine);
    r.sort((a: BatchSummary, b: BatchSummary) =>
      sortOrder === "newest" ? tOf(b.createdAt) - tOf(a.createdAt) : tOf(a.createdAt) - tOf(b.createdAt)
    );
    return r;
  }, [batches, searchQuery, filterStatus, filterEngine, sortOrder]);

  const allSelected = filteredBatches.length > 0 && filteredBatches.every((b: BatchSummary) => selectedIds.has(b.id));
  const isSelecting = selectedIds.size > 0;
  const engineLabels = useMemo(() => new Map(PRESETS.map((p) => [p.id, p.label])), []);

  const stats = useMemo(() => {
    if (!batches?.length) return null;
    const docs = batches.reduce((n: number, b: BatchSummary) => n + (b.totalDocuments ?? 0), 0);
    const done = batches.filter((b: BatchSummary) => b.status === "completed").length;
    const running = batches.filter((b: BatchSummary) => ["processing", "queued"].includes(b.status)).length;
    const failed = batches.filter((b: BatchSummary) => b.status === "failed").length;
    return { total: batches.length, docs, done, running, failed };
  }, [batches]);

  const toggleSelect = useCallback((id: number) => {
    setSelectedIds(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }, []);

  const handleSelectAll = () => {
    if (!filteredBatches.length) return;
    setSelectedIds(allSelected ? new Set() : new Set(filteredBatches.map((b: BatchSummary) => b.id)));
  };

  // FIX: "Clear" used to leave the search text behind, so it looked broken
  const clearFilters = () => {
    setFilterStatus("all");
    setFilterEngine("all");
    setSearchQuery("");
  };

  const performDelete = async () => {
    const ids = pendingDelete?.ids ?? [];
    if (!ids.length) return;
    setBusyAction("delete");
    try {
      for (let i = 0; i < ids.length; i += 3) {
        await Promise.all(ids.slice(i, i + 3).map((id) => deleteBatch(id)));
      }
      await queryClient.invalidateQueries({ queryKey: getListBatchesQueryKey() });
      setSelectedIds(prev => {
        const n = new Set(prev);
        ids.forEach((id) => n.delete(id));
        return n;
      });
      toast({
        title: `${ids.length} batch${ids.length > 1 ? "es" : ""} deleted`,
        description: "Gone for good — extraction results went with them.",
      });
    } catch (e) {
      toast({ title: "Delete failed", description: errorMessage(e), variant: "destructive" });
    } finally {
      setBusyAction(null);
      setPendingDelete(null);
    }
  };

  const fetchSelected = async (ids: number[]) => {
    const byId = new Map<number, { columns: string[]; rows: Record<string, unknown>[] }>();
    for (let i = 0; i < ids.length; i += 3) {
      const chunk = ids.slice(i, i + 3);
      const res = await Promise.all(chunk.map((id) => getBatch(id)));
      // FIX: results aligned to ids via a map — chunk-index math was fragile
      chunk.forEach((id, j) => byId.set(id, res[j]));
    }
    return ids.map((id) => ({
      id,
      columns: byId.get(id)?.columns ?? [],
      rows: byId.get(id)?.rows ?? [],
    }));
  };

  const buildExport = (list: Array<{ id: number; columns: string[]; rows: Record<string, unknown>[] }>) => {
    const rawCols = new Set<string>();
    list.forEach(({ columns }) => columns.forEach(c => rawCols.add(c)));
    const allCols = [...rawCols];

    const humanizedMap = new Map<string, string>();
    const seenLabels = new Set<string>();

    allCols.forEach(c => {
      let label = humanizeFieldLabel(c);
      let suffix = 1;
      while (seenLabels.has(label)) {
        label = `${humanizeFieldLabel(c)} ${++suffix}`;
      }
      seenLabels.add(label);
      humanizedMap.set(c, label);
    });

    return list.flatMap(({ id, rows }) =>
      rows.map(row => {
        // The filename is user-controlled. Unsanitized it reaches Excel as a live
        // formula -- see sanitizeForExport in src/lib/utils.ts.
        const rowRecord = row as Record<string, unknown>;
        const r: Record<string, string> = {
          Batch: String(id),
          Filename: sanitizeForExport(String(rowRecord.filename ?? "")),
          Status: sanitizeForExport(String(rowRecord.status ?? "")),
        };
        allCols.forEach(c => {
          r[humanizedMap.get(c)!] = sanitizeForExport(String(rowRecord[c] ?? ""));
        });
        return r;
      })
    );
  };

  const doExport = async (kind: "csv" | "excel", overrideIds?: Set<number>) => {
    const targetIds = overrideIds || selectedIds;
    const ids = [...targetIds];
    if (!ids.length || busyAction) return;
    setBusyAction(kind);
    try {
      const list = await fetchSelected(ids);
      const data = buildExport(list);
      const label = ids.length === 1 ? `batch_${ids[0]}` : `batches_export`;
      if (kind === "csv") {
        downloadBlob(new Blob([recordsToCsv(data)], { type: "text/csv;charset=utf-8;" }), `${label}.csv`);
        toast({ title: "CSV exported" });
      } else {
        downloadBlob(recordsToXlsx(data, "Extracted Data"), `${label}.xlsx`);
        toast({ title: "Excel exported" });
      }
    } catch (e) {
      toast({ title: "Export failed", description: errorMessage(e), variant: "destructive" });
    } finally {
      setBusyAction(null);
    }
  };

  const exportCSV = (overrideIds?: Set<number>) => doExport("csv", overrideIds);
  const exportExcel = (overrideIds?: Set<number>) => doExport("excel", overrideIds);

  const handleBulkDelete = () => {
    if (!selectedIds.size || busyAction) return;
    const n = selectedIds.size;
    setPendingDelete({ ids: [...selectedIds], label: `${n} batch${n > 1 ? "es" : ""}` });
  };

  const firstName = user?.name?.split(" ")[0] ?? "";

  return (
    <div className={`flex flex-col gap-6 ${isSelecting ? "pb-24" : ""}`}>

      {/* ── Header ─────────────────────────────────────────── */}
      <PageHeader
        eyebrow={
          <>
            <FileCheck2 className="h-3.5 w-3.5 text-primary" />
            <span className="text-primary">
              {greeting()}{firstName ? `, ${firstName}` : ""}
            </span>
          </>
        }
        title="Your batches"
        /* "4 runs · 4 docs" sat directly above a "Total Batches 4" card and a
           "Documents 4" card. The stat row owns the totals; this line is for the
           part of the picture the row cannot show — whether anything needs
           attention right now. */
        description={
          stats && (stats.running > 0 || stats.failed > 0) ? (
            <>
              {stats.running > 0 && (
                <span className="text-warning">
                  {stats.running} still running
                </span>
              )}
              {stats.running > 0 && stats.failed > 0 && " · "}
              {stats.failed > 0 && (
                <span className="text-destructive">
                  {stats.failed} failed
                </span>
              )}
            </>
          ) : undefined
        }
        actions={
          <Button onClick={() => setLocation("/app/upload")} className="rounded-lg px-4 font-semibold shadow-sm">
            <Plus className="h-4 w-4" />New Batch
          </Button>
        }
      />

      {/* ── Stats ──────────────────────────────────────────── */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <div className="col-span-1">
            <StatCard label="Total Batches" value={stats.total} icon={FileText} tone="primary" />
          </div>
          <div className="col-span-1">
            <StatCard label="Documents" value={stats.docs} icon={BarChart3} tone="primary" />
          </div>
          <div className="col-span-1">
            <StatCard label="Completed" value={stats.done} icon={CheckCircle2} tone={stats.done > 0 ? "success" : "muted"} />
          </div>
          <div className="col-span-1">
            <StatCard
              label="In Flight"
              value={stats.running}
              icon={Activity}
              tone={stats.running > 0 ? "primary" : "muted"}
            />
          </div>
          <div className="col-span-1">
            <StatCard
              label="Failed"
              value={stats.failed}
              icon={AlertTriangle}
              tone={stats.failed > 0 ? "destructive" : "muted"}
            />
          </div>
        </div>
      )}

      {/* ── Toolbar ────────────────────────────────────────── */}
      {batches && batches.length > 0 && (
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
            <div className="relative w-full sm:w-56 shrink-0">
              <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search batches..."
                // A placeholder is not an accessible name: it is not reliably
                // announced, and it is gone the moment the field has a value.
                aria-label="Search batches by id, filename or status"
                className="h-8 pl-8 text-label rounded-lg bg-card border-border/60 focus-visible:ring-1"
              />
            </div>

            <button
              onClick={handleSelectAll}
              className="flex h-8 items-center gap-1.5 rounded-lg border border-border/60 bg-card px-3 text-label font-medium text-muted-foreground hover:text-foreground hover:border-border transition-colors shrink-0"
            >
              {allSelected ? <CheckSquare className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
              {allSelected ? "Deselect all" : "Select all"}
            </button>

            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="h-8 w-[130px] border-border/60 text-label rounded-lg bg-card">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="queued">Queued</SelectItem>
                <SelectItem value="processing">Processing</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="partial">Partial</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
              </SelectContent>
            </Select>

            <Select value={filterEngine} onValueChange={setFilterEngine}>
              <SelectTrigger className="h-8 w-[130px] border-border/60 text-label rounded-lg bg-card">
                <SelectValue placeholder="Engine" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All engines</SelectItem>
                {PRESETS.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {(filterStatus !== "all" || filterEngine !== "all" || searchQuery !== "") && (
              <button
                onClick={clearFilters}
                className="flex h-8 items-center gap-1 rounded-lg border border-border/60 px-2.5 text-label text-muted-foreground hover:text-foreground transition-colors bg-card shrink-0"
              >
                <X className="h-3 w-3" /> Clear
              </button>
            )}
          </div>

          <Select value={sortOrder} onValueChange={(v: "newest" | "oldest") => setSortOrder(v)}>
            <SelectTrigger className="h-8 w-[120px] border-border/60 bg-card text-label rounded-lg">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="newest">Newest first</SelectItem>
              <SelectItem value="oldest">Oldest first</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {/* ── List ───────────────────────────────────────────── */}
      {isLoading ? (
        <ListSkeleton />
      ) : error ? (
        <ErrorState
          title="Could not load your batches"
          body="Nothing was lost — try again in a moment."
          onRetry={() => queryClient.refetchQueries({ queryKey: getListBatchesQueryKey() })}
        />
      ) : !batches?.length ? (
        <EmptyState
          icon={FileText}
          title="No batches yet"
          body="Upload invoices, receipts, or any document and BrainHalf will extract the data for you."
          action={
            <Button onClick={() => setLocation("/app/upload")}>
              <Plus className="h-4 w-4" />
              Start extraction
            </Button>
          }
        />
      ) : filteredBatches.length === 0 ? (
        <EmptyState
          inset
          icon={Search}
          title="No batches match these filters"
          body="Widen the search, or clear the filters to see everything again."
          action={
            <Button variant="outline" onClick={clearFilters}>
              Clear filters
            </Button>
          }
        />
      ) : (
        <div className="rounded-xl border border-border/60 bg-card overflow-hidden shadow-sm">
          <div className="divide-y divide-border/50">
            {filteredBatches.map((batch: BatchSummary) => {
              const isSelected = selectedIds.has(batch.id);
              const progress = batch.totalDocuments > 0 ? (batch.completedDocuments / batch.totalDocuments) * 100 : 0;
              const isImage = batch.firstDocumentContentType?.startsWith("image/");
              const engineLabel = engineLabels.get(batch.engineType ?? "") ?? batch.engineType ?? "—";

              return (
                <div
                  key={batch.id}
                  className={`group flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors duration-100
                    ${isSelected ? "bg-primary/5 dark:bg-primary/10" : "hover:bg-muted/40"}
                  `}
                  onClick={(e) => {
                    const t = e.target as HTMLElement;
                    if (t.tagName === "INPUT" || t.closest("button")) return;
                    // FIX: while selecting, row clicks toggle selection
                    // instead of throwing the selection away to navigate
                    if (isSelecting) {
                      toggleSelect(batch.id);
                      return;
                    }
                    setLocation(`/app/batches/${batch.id}`);
                  }}
                >
                  {/* Checkbox */}
                  <input
                    type="checkbox"
                    aria-label={`Select batch #${batch.id}`}
                    className="h-3.5 w-3.5 rounded border-border/60 shrink-0 cursor-pointer accent-primary"
                    checked={isSelected}
                    onChange={() => toggleSelect(batch.id)}
                    onClick={(e) => e.stopPropagation()}
                  />

                  {/* Thumbnail */}
                  <div className="relative h-10 w-10 shrink-0 rounded-lg bg-muted border border-border/50 overflow-hidden flex items-center justify-center group-hover:border-border transition-colors">
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-muted z-0">
                      <FileText className="h-4 w-4 text-muted-foreground/60 mb-0.5" />
                      <span className="text-micro font-semibold uppercase text-muted-foreground">
                        {batch.firstDocumentContentType?.split("/").pop()?.slice(0, 4) ?? "DOC"}
                      </span>
                    </div>
                    {batch.firstDocumentObjectPath && isImage ? (
                      <img
                        src={storageUrl(batch.firstDocumentObjectPath)}
                        className="absolute inset-0 h-full w-full object-cover z-10"
                        alt=""
                        loading="lazy"
                        onError={(e) => { e.currentTarget.style.display = "none"; }}
                      />
                    ) : null}
                  </div>

                  {/* Info */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-body-sm font-data font-semibold text-foreground">Batch #{batch.id}</span>
                      <span className="rounded-md border border-border/50 bg-muted px-1.5 py-px text-micro font-medium text-muted-foreground">
                        {engineLabel}
                      </span>
                      <StatusBadge status={batch.status} />
                    </div>
                    <p className="text-label text-muted-foreground mt-0.5">
                      {timeAgo(batch.createdAt) || "just now"}
                    </p>
                  </div>

                  {/* The bar appears only while there is progress left to
                      make. Every finished batch used to carry a full green track
                      under the word "Progress" — four identical 100% bars down
                      the list, saying nothing that the "Done" badge had not. */}
                  <div className="hidden w-28 shrink-0 flex-col gap-1.5 sm:flex">
                    <span
                      className={`text-right font-sans tabular-nums text-body-sm font-semibold ${
                        batch.status === "failed"
                          ? "text-destructive"
                          : progress === 100
                            ? "text-muted-foreground"
                            : "text-foreground"
                      }`}
                    >
                      {batch.completedDocuments}/{batch.totalDocuments} docs
                    </span>
                    {progress < 100 && (
                      <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${
                            batch.status === "failed" ? "bg-destructive/70" : "bg-primary"
                          }`}
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="shrink-0 flex items-center gap-0.5">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          aria-label={`Actions for batch #${batch.id}`}
                          /* focus:outline-none with nothing in its place: this
                             row-actions trigger was reachable by keyboard and
                             showed no focus state at all. */
                          className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground/40 transition-all hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-40 rounded-xl" onClick={(e) => e.stopPropagation()}>
                        <DropdownMenuItem onClick={() => exportCSV(new Set([batch.id]))}>
                          <Download className="mr-2 h-4 w-4 text-muted-foreground" />
                          Export CSV
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => exportExcel(new Set([batch.id]))}>
                          <Download className="mr-2 h-4 w-4 text-muted-foreground" />
                          Export Excel
                        </DropdownMenuItem>
                        {/* FIX: routes through confirm dialog — was delete on first click */}
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive focus:bg-destructive/10"
                          onClick={() => setPendingDelete({ ids: [batch.id], label: `Batch #${batch.id}` })}
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          Delete Batch
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <div
                      aria-hidden
                      className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground/40 transition-colors group-hover:text-muted-foreground"
                    >
                      <ArrowRight className="h-3.5 w-3.5" />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Bulk action floating bar ────────────────────────── */}
      {isSelecting && (
        <div className="fixed inset-x-4 bottom-4 z-50 mx-auto flex w-fit max-w-[calc(100vw-2rem)] flex-wrap items-center justify-center gap-2 rounded-xl border border-border bg-card/95 px-3.5 py-2 shadow-lg backdrop-blur-md sm:bottom-5">
          <span className="pr-1 text-label font-semibold text-foreground">{selectedIds.size} selected</span>
          <div className="hidden h-3.5 w-px bg-border/60 sm:block" />
          <Button
            onClick={() => exportCSV()}
            disabled={!!busyAction}
            variant="secondary"
            size="sm"
            className="h-7 gap-1 rounded-lg px-2.5 [&_svg]:size-3"
          >
            {busyAction === "csv" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />} CSV
          </Button>
          <Button
            onClick={() => exportExcel()}
            disabled={!!busyAction}
            variant="secondary"
            size="sm"
            className="h-7 gap-1 rounded-lg px-2.5 [&_svg]:size-3"
          >
            {busyAction === "excel" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />} Excel
          </Button>
          <div className="hidden h-3.5 w-px bg-border/60 sm:block" />
          <Button
            onClick={handleBulkDelete}
            disabled={!!busyAction}
            variant="outline"
            size="sm"
            className="h-7 gap-1 rounded-lg border-destructive/30 bg-destructive/10 px-2.5 text-destructive [&_svg]:size-3"
          >
            {busyAction === "delete" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />} Delete
          </Button>
          <div className="hidden h-3.5 w-px bg-border/60 sm:block" />
          <button
            onClick={() => setSelectedIds(new Set())}
            aria-label="Clear selection"
            className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* ── Delete confirmation (single + bulk share this) ──── */}
      <AlertDialog open={!!pendingDelete} onOpenChange={(open) => { if (!open) setPendingDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {pendingDelete?.label}?</AlertDialogTitle>
            <AlertDialogDescription>
              The batch and everything extracted from it will be permanently deleted. No undo, no recovery.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90 focus-visible:ring-destructive"
              onClick={(e) => {
                e.preventDefault(); // keep dialog open while deleting
                performDelete();
              }}
            >
              {busyAction === "delete" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Trash2 className="mr-1.5 h-4 w-4" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
