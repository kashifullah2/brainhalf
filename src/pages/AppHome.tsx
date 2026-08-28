import { useState, useCallback, useMemo } from "react";
import { useLocation, Link } from "wouter";
import { formatDistanceToNow } from "date-fns";
import {
  Plus, FileType2, Loader2, ArrowUpRight, Trash2, Download,
  CheckSquare, Square, X, SlidersHorizontal, ArrowRight,
  Sparkles, FileText, BarChart3, CheckCircle2, Activity
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PRESETS } from "@/components/UploadModal";
import { useAuth } from "@/context/AuthContext";
import { useListBatches, getBatch, deleteBatch, getListBatchesQueryKey, storageUrl } from "@/lib/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { usePageTitle } from "@/lib/use-page-title";
import { sanitizeForExport } from "@/lib/utils";
import { recordsToCsv, recordsToXlsx, downloadBlob } from "@/lib/xlsx-writer";
import { greeting, StatCard } from "@/components/app";

/* ── Helpers ─────────────────────────────────────────────── */
function StatusChip({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string; dot: string }> = {
    completed: { label: "Done",       cls: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800/50", dot: "bg-emerald-500" },
    processing: { label: "Running",   cls: "bg-amber-50  text-amber-700  border-amber-200  dark:bg-amber-950/40  dark:text-amber-400  dark:border-amber-800/50",  dot: "bg-amber-500 animate-pulse"  },
    queued:     { label: "Queued",    cls: "bg-amber-50  text-amber-700  border-amber-200  dark:bg-amber-950/40  dark:text-amber-400  dark:border-amber-800/50",  dot: "bg-amber-400 animate-pulse"  },
    failed:     { label: "Failed",    cls: "bg-red-50    text-red-700    border-red-200    dark:bg-red-950/40    dark:text-red-400    dark:border-red-800/50",    dot: "bg-red-500"   },
    partial:    { label: "Partial",   cls: "bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/40 dark:text-orange-400 dark:border-orange-800/50", dot: "bg-orange-500" },
  };
  const s = map[status] ?? { label: status, cls: "bg-muted text-muted-foreground border-border/60", dot: "bg-muted-foreground" };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${s.cls}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}



function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 px-4 py-3 animate-pulse">
      <div className="h-4 w-4 rounded bg-muted shrink-0" />
      <div className="h-10 w-10 rounded-lg bg-muted shrink-0" />
      <div className="flex-1 space-y-2">
        <div className="h-3 w-28 rounded-full bg-muted" />
        <div className="h-2.5 w-40 rounded-full bg-muted" />
      </div>
      <div className="hidden sm:block h-1.5 w-28 rounded-full bg-muted" />
    </div>
  );
}

/* ── Page ────────────────────────────────────────────────── */
export default function AppHome() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  usePageTitle("Dashboard · BrainHalf", { noindex: true });
  const queryClient = useQueryClient();
  const { data: batches, isLoading, error } = useListBatches();
  const { user } = useAuth();

  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [isBusy, setIsBusy] = useState(false);
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterEngine, setFilterEngine] = useState("all");
  const [sortOrder, setSortOrder] = useState<"newest" | "oldest">("newest");
  const [showFilters, setShowFilters] = useState(false);

  const filteredBatches = useMemo(() => {
    if (!batches) return [];
    let r = [...batches];
    if (filterStatus !== "all") r = r.filter((b) => b.status === filterStatus);
    if (filterEngine !== "all") r = r.filter((b) => b.engineType === filterEngine);
    r.sort((a, b) => sortOrder === "newest"
      ? new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      : new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
    return r;
  }, [batches, filterStatus, filterEngine, sortOrder]);

  const allSelected = filteredBatches.length > 0 && selectedIds.size === filteredBatches.length;
  const isSelecting = selectedIds.size > 0;
  const engineLabels = useMemo(() => new Map(PRESETS.map((p) => [p.id, p.label])), []);

  const stats = useMemo(() => {
    if (!batches?.length) return null;
    const docs = batches.reduce((n: number, b: any) => n + (b.totalDocuments ?? 0), 0);
    const done = batches.filter((b: any) => b.status === "completed").length;
    const running = batches.filter((b: any) => ["processing","queued"].includes(b.status)).length;
    const failed = batches.filter((b: any) => b.status === "failed").length;
    return { total: batches.length, docs, done, running, failed };
  }, [batches]);

  const toggleSelect = useCallback((id: number, e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }, []);

  const handleSelectAll = () => {
    if (!filteredBatches) return;
    setSelectedIds(selectedIds.size === filteredBatches.length ? new Set() : new Set(filteredBatches.map((b: any) => b.id)));
  };

  const handleBulkDelete = async () => {
    if (!selectedIds.size) return;
    setIsBusy(true);
    const ids = [...selectedIds];
    try {
      for (let i = 0; i < ids.length; i += 3) {
        await Promise.all(ids.slice(i, i + 3).map(deleteBatch));
      }
      await queryClient.invalidateQueries({ queryKey: getListBatchesQueryKey() });
      setSelectedIds(new Set());
      toast({ title: `${ids.length} batch${ids.length > 1 ? "es" : ""} deleted` });
    } catch (e: any) { toast({ title: "Delete failed", description: e.message, variant: "destructive" }); }
    finally { setIsBusy(false); }
  };

  const fetchSelected = async () => {
    const ids = [...selectedIds];
    const results: any[] = [];
    for (let i = 0; i < ids.length; i += 3) {
      results.push(...await Promise.all(ids.slice(i, i + 3).map(getBatch)));
    }
    return results.map((b, i) => ({ id: ids[i], columns: b.columns, rows: b.rows }));
  };

  const buildExport = (list: Array<{ id: number; columns: string[]; rows: any[] }>) => {
    const cols = new Set<string>();
    list.forEach(({ columns }) => columns.forEach(c => cols.add(c)));
    const allCols = [...cols];
    return list.flatMap(({ id, rows }) =>
      rows.map(row => {
        const r: Record<string, string> = { Batch: String(id), Filename: String(row.filename ?? ""), Status: String(row.status ?? "") };
        allCols.forEach(c => r[c.replace(/_/g, " ")] = sanitizeForExport(String(row[c] ?? "")));
        return r;
      })
    );
  };

  const exportCSV = async () => {
    if (!selectedIds.size) return; setIsBusy(true);
    try {
      const list = await fetchSelected();
      const data = buildExport(list);
      const label = selectedIds.size === 1 ? `batch_${[...selectedIds][0]}` : `batches_export`;
      downloadBlob(new Blob([recordsToCsv(data)], { type: "text/csv;charset=utf-8;" }), `${label}.csv`);
      toast({ title: "CSV exported" });
    } catch (e: any) { toast({ title: "Export failed", description: e.message, variant: "destructive" }); }
    finally { setIsBusy(false); }
  };

  const exportExcel = async () => {
    if (!selectedIds.size) return; setIsBusy(true);
    try {
      const list = await fetchSelected();
      const data = buildExport(list);
      const label = selectedIds.size === 1 ? `batch_${[...selectedIds][0]}` : `batches_export`;
      downloadBlob(recordsToXlsx(data, "Extracted Data"), `${label}.xlsx`);
      toast({ title: "Excel exported" });
    } catch (e: any) { toast({ title: "Export failed", description: e.message, variant: "destructive" }); }
    finally { setIsBusy(false); }
  };

  const firstName = user?.name?.split(" ")[0] ?? "";

  return (
    <div className={`flex flex-col gap-6 ${isSelecting ? "pb-24" : ""}`}>

      {/* ── Header ─────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-1.5 mb-1.5">
            <Sparkles className="h-3 w-3 text-primary" />
            <span className="text-[11px] font-semibold uppercase tracking-widest text-primary">
              {greeting()}{firstName ? `, ${firstName}` : ""}
            </span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Your batches</h1>
          {stats && (
            <p className="mt-1 text-[13px] text-muted-foreground">
              {stats.total} run{stats.total !== 1 ? "s" : ""} · {stats.docs} doc{stats.docs !== 1 ? "s" : ""}
              {stats.running > 0 && <span className="text-amber-600 dark:text-amber-400"> · {stats.running} running</span>}
              {stats.failed > 0 && <span className="text-red-500"> · {stats.failed} failed</span>}
            </p>
          )}
        </div>
        <Button
          onClick={() => setLocation("/app/upload")}
          className="h-9 shrink-0 rounded-lg px-4 text-[13px] font-semibold shadow-sm hover:shadow-md hover:-translate-y-px transition-all"
        >
          <Plus className="mr-1.5 h-3.5 w-3.5" />New Batch
        </Button>
      </div>

      {/* ── Stats ──────────────────────────────────────────── */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="Total Batches" value={stats.total} icon={FileText} tone="muted" />
          <StatCard label="Documents" value={stats.docs} icon={BarChart3} tone="muted" />
          <StatCard label="Completed" value={stats.done} icon={CheckCircle2} tone="success" />
          <StatCard label={stats.running > 0 ? "In Flight" : "Failed"} value={stats.running > 0 ? stats.running : stats.failed} icon={Activity} tone={stats.running > 0 ? "primary" : stats.failed > 0 ? "warning" : "muted"} />
        </div>
      )}

      {/* ── Toolbar ────────────────────────────────────────── */}
      {batches && batches.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleSelectAll}
            className="flex h-8 items-center gap-1.5 rounded-lg border border-border/60 bg-card px-3 text-[12px] font-medium text-muted-foreground hover:text-foreground hover:border-border transition-colors"
          >
            {allSelected ? <CheckSquare className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
            {allSelected ? "Deselect all" : "Select all"}
          </button>

          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`flex h-8 items-center gap-1.5 rounded-lg border px-3 text-[12px] font-medium transition-colors ${showFilters ? "border-primary/40 bg-primary/5 text-primary" : "border-border/60 bg-card text-muted-foreground hover:text-foreground hover:border-border"}`}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Filters
            {(filterStatus !== "all" || filterEngine !== "all") && (
              <span className="ml-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[9px] font-bold text-white">
                {(filterStatus !== "all" ? 1 : 0) + (filterEngine !== "all" ? 1 : 0)}
              </span>
            )}
          </button>

          <div className="ml-auto flex items-center gap-2">
            <Select value={sortOrder} onValueChange={(v: "newest" | "oldest") => setSortOrder(v)}>
              <SelectTrigger className="h-8 w-[120px] border-border/60 bg-card text-[12px] rounded-lg">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="newest">Newest first</SelectItem>
                <SelectItem value="oldest">Oldest first</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Expanded filters */}
          {showFilters && (
            <div className="flex w-full flex-wrap items-center gap-2 rounded-xl border border-border/50 bg-card/80 px-3 py-2.5">
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger className="h-8 w-[130px] border-border/60 text-[12px] rounded-lg">
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
                <SelectTrigger className="h-8 w-[130px] border-border/60 text-[12px] rounded-lg">
                  <SelectValue placeholder="Engine" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All engines</SelectItem>
                  {PRESETS.map((p) => (<SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>))}
                </SelectContent>
              </Select>
              {(filterStatus !== "all" || filterEngine !== "all") && (
                <button
                  onClick={() => { setFilterStatus("all"); setFilterEngine("all"); }}
                  className="flex h-8 items-center gap-1 rounded-lg border border-border/60 px-2.5 text-[12px] text-muted-foreground hover:text-foreground transition-colors"
                >
                  <X className="h-3 w-3" /> Clear
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── List ───────────────────────────────────────────── */}
      {isLoading ? (
        <div className="rounded-xl border border-border/60 bg-card overflow-hidden">
          {[0, 1, 2, 3].map(i => <SkeletonRow key={i} />)}
        </div>
      ) : error ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-destructive/20 bg-destructive/5 p-8 text-center">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
            <X className="h-5 w-5" />
          </div>
          <div>
            <p className="font-semibold text-foreground text-sm">Could not load batches</p>
            <p className="text-[13px] text-muted-foreground mt-0.5">Nothing was lost — try again in a moment.</p>
          </div>
          <Button variant="outline" size="sm" className="rounded-lg text-[13px]" onClick={() => queryClient.invalidateQueries({ queryKey: getListBatchesQueryKey() })}>
            Try again
          </Button>
        </div>
      ) : !batches?.length ? (
        /* Empty state */
        <div className="flex flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed border-border/60 bg-card/40 py-20 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-border/60 bg-card text-muted-foreground shadow-sm">
            <FileText className="h-6 w-6" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-foreground">No batches yet</h3>
            <p className="mt-1 text-[13px] text-muted-foreground max-w-xs">
              Upload invoices, receipts, or any document and brainhalf will extract the data for you.
            </p>
          </div>
          <Button onClick={() => setLocation("/app/upload")} className="rounded-lg h-9 px-5 text-[13px] font-semibold shadow-sm">
            <Plus className="mr-1.5 h-3.5 w-3.5" />Start extraction
          </Button>
        </div>
      ) : filteredBatches.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-border/50 bg-card/60 py-14 text-center">
          <p className="font-medium text-sm text-foreground">No results for these filters</p>
          <button onClick={() => { setFilterStatus("all"); setFilterEngine("all"); }} className="text-[13px] text-primary hover:underline">
            Clear filters
          </button>
        </div>
      ) : (
        <div className="rounded-xl border border-border/60 bg-card overflow-hidden shadow-sm">
          <div className="divide-y divide-border/50">
            {filteredBatches.map((batch: any, idx: number) => {
              const isSelected = selectedIds.has(batch.id);
              const progress = batch.totalDocuments > 0 ? (batch.completedDocuments / batch.totalDocuments) * 100 : 0;
              const isImage = batch.firstDocumentContentType?.startsWith("image/");
              const engineLabel = engineLabels.get(batch.engineType) ?? batch.engineType ?? "—";

              return (
                <div
                  key={batch.id}
                  className={`group flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors duration-100
                    ${isSelected ? "bg-primary/5 dark:bg-primary/10" : "hover:bg-muted/40"}
                    ${idx === 0 ? "" : ""}
                  `}
                  onClick={(e) => {
                    if ((e.target as HTMLElement).tagName === "INPUT" || (e.target as HTMLElement).closest("button")) return;
                    setLocation(`/app/batches/${batch.id}`);
                  }}
                >
                  {/* Checkbox */}
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 rounded border-border/60 shrink-0 cursor-pointer accent-primary"
                    checked={isSelected}
                    onChange={(e) => toggleSelect(batch.id, e as any)}
                    onClick={(e) => e.stopPropagation()}
                  />

                  {/* Thumbnail */}
                  <div className="h-10 w-10 shrink-0 rounded-lg bg-muted border border-border/50 overflow-hidden flex items-center justify-center group-hover:border-border transition-colors">
                    {batch.firstDocumentObjectPath ? (
                      isImage ? (
                        <img
                          src={storageUrl(batch.firstDocumentObjectPath)}
                          className="h-full w-full object-cover"
                          alt=""
                          loading="lazy"
                          onError={(e) => { e.currentTarget.style.display = "none"; }}
                        />
                      ) : (
                        <div className="flex flex-col items-center justify-center">
                          <FileText className="h-4 w-4 text-muted-foreground/60 mb-0.5" />
                          <span className="text-[7.5px] font-bold text-muted-foreground uppercase">{batch.firstDocumentContentType?.split("/").pop()?.slice(0, 4) ?? "DOC"}</span>
                        </div>
                      )
                    ) : (
                      <FileType2 className="h-4 w-4 text-muted-foreground/50" />
                    )}
                  </div>

                  {/* Info */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[13.5px] font-semibold text-foreground">Batch #{batch.id}</span>
                      <span className="rounded-md border border-border/50 bg-muted px-1.5 py-px text-[10px] font-medium text-muted-foreground">{engineLabel}</span>
                      <StatusChip status={batch.status} />
                    </div>
                    <p className="text-[12px] text-muted-foreground mt-0.5">
                      {formatDistanceToNow(new Date(batch.createdAt), { addSuffix: true })}
                    </p>
                  </div>

                  {/* Progress */}
                  <div className="hidden sm:flex flex-col gap-1 w-32 shrink-0">
                    <div className="flex justify-between text-[11px]">
                      <span className="text-muted-foreground font-medium">Progress</span>
                      <span className={`font-semibold ${progress === 100 ? "text-emerald-600 dark:text-emerald-400" : batch.status === "failed" ? "text-red-500" : "text-foreground"}`}>
                        {batch.completedDocuments}/{batch.totalDocuments}
                      </span>
                    </div>
                    <div className="h-1 w-full rounded-full bg-muted overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${progress === 100 ? "bg-emerald-500" : batch.status === "failed" ? "bg-red-400" : "bg-primary"}`}
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  </div>

                  {/* Arrow */}
                  <div className="shrink-0 flex items-center">
                    <div className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground/40 group-hover:text-muted-foreground group-hover:bg-muted transition-all">
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
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 rounded-xl border border-border/70 bg-card/95 px-3.5 py-2 shadow-xl backdrop-blur-md">
          <span className="text-[12.5px] font-semibold text-foreground pr-1">{selectedIds.size} selected</span>
          <div className="h-3.5 w-px bg-border/60" />
          <button onClick={exportCSV} disabled={isBusy} className="flex h-7 items-center gap-1 rounded-lg border border-border/60 bg-muted px-2.5 text-[12px] font-medium text-foreground hover:bg-muted/80 disabled:opacity-50 transition-colors">
            {isBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />} CSV
          </button>
          <button onClick={exportExcel} disabled={isBusy} className="flex h-7 items-center gap-1 rounded-lg border border-border/60 bg-muted px-2.5 text-[12px] font-medium text-foreground hover:bg-muted/80 disabled:opacity-50 transition-colors">
            {isBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />} Excel
          </button>
          <div className="h-3.5 w-px bg-border/60" />
          <button onClick={handleBulkDelete} disabled={isBusy} className="flex h-7 items-center gap-1 rounded-lg border border-red-200 bg-red-50 dark:border-red-800/50 dark:bg-red-950/40 px-2.5 text-[12px] font-medium text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-950/60 disabled:opacity-50 transition-colors">
            {isBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />} Delete
          </button>
          <div className="h-3.5 w-px bg-border/60" />
          <button onClick={() => setSelectedIds(new Set())} className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
