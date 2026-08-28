import { useState, useCallback, useMemo } from "react";
import { useLocation, Link } from "wouter";
import { formatDistanceToNow } from "date-fns";
import {
  Plus, FileText, Loader2, ArrowRight, Trash2, Download,
  CheckSquare, Square, X, Filter, ArrowDownUp, FileType2, Sparkles
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusDot } from "@/components/StatusDot";
import { PRESETS } from "@/components/UploadModal";
import { EmptyState, ErrorState, ListSkeleton, greeting } from "@/components/app";
import { useAuth } from "@/context/AuthContext";
import { useListBatches, getBatch, deleteBatch, getListBatchesQueryKey, storageUrl } from "@/lib/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { usePageTitle } from "@/lib/use-page-title";
import { sanitizeForExport } from "@/lib/utils";
import { recordsToCsv, recordsToXlsx, downloadBlob } from "@/lib/xlsx-writer";

export default function AppHome() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  usePageTitle("Dashboard · BrainHalf", { noindex: true });
  const queryClient = useQueryClient();
  const { data: batches, isLoading, error } = useListBatches();
  const { user } = useAuth();

  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [isBusy, setIsBusy] = useState(false);
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterEngine, setFilterEngine] = useState<string>("all");
  const [sortOrder, setSortOrder] = useState<"newest" | "oldest">("newest");

  const filteredBatches = useMemo(() => {
    if (!batches) return [];
    let result = [...batches];
    if (filterStatus !== "all") result = result.filter((b) => b.status === filterStatus);
    if (filterEngine !== "all") result = result.filter((b) => b.engineType === filterEngine);
    if (sortOrder === "newest") {
      result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    } else {
      result.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    }
    return result;
  }, [batches, filterStatus, filterEngine, sortOrder]);

  const allSelected = filteredBatches?.length > 0 && selectedIds.size === filteredBatches.length;
  const isSelecting = selectedIds.size > 0;

  const summary = useMemo(() => {
    if (!batches?.length) return null;
    const docs = batches.reduce((n: number, b: any) => n + (b.totalDocuments ?? 0), 0);
    const running = batches.filter((b: any) => b.status === "processing" || b.status === "queued").length;
    const failed = batches.filter((b: any) => b.status === "failed").length;
    const partial = batches.filter((b: any) => b.status === "partial").length;
    const done = batches.filter((b: any) => b.status === "completed").length;
    return { docs, running, failed, partial, done, total: batches.length };
  }, [batches]);

  const engineLabels = useMemo(() => new Map(PRESETS.map((p) => [p.id, p.label])), []);

  const toggleSelect = useCallback((id: number, e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    setSelectedIds((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }, []);

  const handleSelectAll = () => {
    if (!filteredBatches) return;
    if (selectedIds.size === filteredBatches.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(filteredBatches.map((b: any) => b.id)));
  };

  const handleClearSelection = () => setSelectedIds(new Set());

  const handleBulkDelete = async () => {
    if (!selectedIds.size) return;
    setIsBusy(true);
    const ids = [...selectedIds];
    try {
      const chunkSize = 3;
      for (let i = 0; i < ids.length; i += chunkSize) {
        await Promise.all(ids.slice(i, i + chunkSize).map((id) => deleteBatch(id)));
      }
      await queryClient.invalidateQueries({ queryKey: getListBatchesQueryKey() });
      setSelectedIds(new Set());
      toast({ title: `${ids.length} batch${ids.length > 1 ? "es" : ""} deleted`, description: "They're gone for good." });
    } catch (e: any) {
      toast({ title: "Delete failed", description: e.message, variant: "destructive" });
    } finally { setIsBusy(false); }
  };

  const fetchSelectedBatches = async () => {
    const ids = [...selectedIds];
    const results = [];
    const chunkSize = 3;
    for (let i = 0; i < ids.length; i += chunkSize) {
      const chunkResults = await Promise.all(ids.slice(i, i + chunkSize).map((id) => getBatch(id)));
      results.push(...chunkResults);
    }
    return results.map((batch, i) => ({ id: ids[i], columns: batch.columns, rows: batch.rows }));
  };

  const buildExportData = (batchDataList: Array<{ id: number; columns: string[]; rows: any[] }>) => {
    const allColumnsSet = new Set<string>();
    for (const { columns } of batchDataList) columns.forEach((c) => allColumnsSet.add(c));
    const allColumns = [...allColumnsSet];
    const exportData = [];
    for (const { id, rows } of batchDataList) {
      for (const row of rows) {
        const rowData: Record<string, string> = { Batch: String(id), Filename: String(row.filename ?? ""), Status: String(row.status ?? "") };
        for (const col of allColumns) rowData[col.replace(/_/g, " ")] = sanitizeForExport(String(row[col] ?? ""));
        exportData.push(rowData);
      }
    }
    return exportData;
  };

  const handleBulkExportCSV = async () => {
    if (!selectedIds.size) return; setIsBusy(true);
    try {
      const batchDataList = await fetchSelectedBatches();
      const exportData = buildExportData(batchDataList);
      const label = selectedIds.size === 1 ? `batch_${[...selectedIds][0]}` : `batches_${[...selectedIds].join("_")}`;
      downloadBlob(new Blob([recordsToCsv(exportData)], { type: "text/csv;charset=utf-8;" }), `${label}_export.csv`);
      toast({ title: "CSV exported", description: `${batchDataList.reduce((sum, b) => sum + b.rows.length, 0)} rows exported.` });
    } catch (e: any) { toast({ title: "Export failed", description: e.message, variant: "destructive" }); }
    finally { setIsBusy(false); }
  };

  const handleBulkExportExcel = async () => {
    if (!selectedIds.size) return; setIsBusy(true);
    try {
      const batchDataList = await fetchSelectedBatches();
      const exportData = buildExportData(batchDataList);
      const label = selectedIds.size === 1 ? `batch_${[...selectedIds][0]}` : `batches_${[...selectedIds].join("_")}`;
      downloadBlob(recordsToXlsx(exportData, "Extracted Data"), `${label}_export.xlsx`);
      toast({ title: "Excel exported", description: `${batchDataList.reduce((sum, b) => sum + b.rows.length, 0)} rows exported.` });
    } catch (e: any) { toast({ title: "Export failed", description: e.message, variant: "destructive" }); }
    finally { setIsBusy(false); }
  };

  const statusColor = (s: string) => {
    if (s === "completed") return "text-emerald-600 bg-emerald-50 border-emerald-200 dark:bg-emerald-950/40 dark:border-emerald-800/60 dark:text-emerald-400";
    if (s === "processing" || s === "queued") return "text-amber-600 bg-amber-50 border-amber-200 dark:bg-amber-950/40 dark:border-amber-800/60 dark:text-amber-400";
    if (s === "failed") return "text-red-600 bg-red-50 border-red-200 dark:bg-red-950/40 dark:border-red-800/60 dark:text-red-400";
    return "text-muted-foreground bg-muted border-border/60";
  };

  return (
    <div className={`flex flex-col flex-1 relative w-full ${isSelecting ? "pb-28" : ""}`}>

      {/* ── Page header ─────────────────────────────── */}
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-2">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          <span className="text-xs font-semibold uppercase tracking-widest text-primary">
            {greeting()}{user?.name ? `, ${user.name.split(" ")[0]}` : ""}
          </span>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-end gap-4">
          <div className="flex-1">
            <h1 className="text-3xl font-extrabold tracking-tight text-foreground">Your batches</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {summary
                ? `${summary.total} run${summary.total !== 1 ? "s" : ""} · ${summary.docs} document${summary.docs !== 1 ? "s" : ""} · ${summary.running > 0 ? `${summary.running} still working` : summary.failed > 0 ? `${summary.failed} need a rerun` : "Everything extracted and ready."}`
                : "Every extraction run in one place."}
            </p>
          </div>
          <Button
            className="h-10 shrink-0 rounded-full px-6 text-sm font-semibold shadow-md shadow-primary/20 hover:-translate-y-px transition-all"
            onClick={() => setLocation("/app/upload")}
          >
            <Plus className="mr-2 h-4 w-4" /> New Batch
          </Button>
        </div>
      </div>

      {/* ── Stats row ──────────────────────────────── */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
          {[
            { label: "Batches", value: summary.total },
            { label: "Documents", value: summary.docs },
            { label: "Completed", value: summary.done },
            summary.running > 0
              ? { label: "In Flight", value: summary.running }
              : { label: "Need Rerun", value: summary.failed + summary.partial },
          ].map((s) => (
            <div key={s.label} className="rounded-2xl border border-border/50 bg-card px-5 py-4 shadow-sm">
              <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground mb-1">{s.label}</p>
              <p className="text-3xl font-extrabold tracking-tight text-foreground">{s.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* ── Filters ────────────────────────────────── */}
      {batches && batches.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <div className="flex items-center gap-1.5 rounded-xl border border-border/50 bg-muted/40 p-1">
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="h-8 w-[130px] border-none bg-transparent text-xs font-semibold shadow-none focus:ring-0">
                <div className="flex items-center gap-1.5"><Filter className="h-3 w-3" /><SelectValue placeholder="Status" /></div>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="queued">Queued</SelectItem>
                <SelectItem value="processing">Processing</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="partial">Partial</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
              </SelectContent>
            </Select>
            <div className="h-4 w-px bg-border/60" />
            <Select value={filterEngine} onValueChange={setFilterEngine}>
              <SelectTrigger className="h-8 w-[130px] border-none bg-transparent text-xs font-semibold shadow-none focus:ring-0">
                <SelectValue placeholder="Engine" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Engines</SelectItem>
                {PRESETS.map((p) => (<SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>))}
              </SelectContent>
            </Select>
            <div className="h-4 w-px bg-border/60" />
            <Select value={sortOrder} onValueChange={(val: "newest" | "oldest") => setSortOrder(val)}>
              <SelectTrigger className="h-8 w-[130px] border-none bg-transparent text-xs font-semibold shadow-none focus:ring-0">
                <div className="flex items-center gap-1.5"><ArrowDownUp className="h-3 w-3" /><SelectValue /></div>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="newest">Newest First</SelectItem>
                <SelectItem value="oldest">Oldest First</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-10 rounded-xl border-border/50 text-xs font-semibold px-4"
            onClick={handleSelectAll}
          >
            {allSelected ? <><CheckSquare className="mr-1.5 h-3.5 w-3.5" />Deselect All</> : <><Square className="mr-1.5 h-3.5 w-3.5" />Select All</>}
          </Button>
        </div>
      )}

      {/* ── Batch list ────────────────────────────── */}
      {isLoading ? (
        <ListSkeleton rows={4} />
      ) : error ? (
        <ErrorState
          title="We couldn't reach your batches"
          body="The connection dropped on the way. Nothing was lost — try again in a moment."
          onRetry={() => queryClient.invalidateQueries({ queryKey: getListBatchesQueryKey() })}
        />
      ) : batches?.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="Let's get your weekend back."
          body="Drop in invoices, receipts, or any document — brainhalf will pull out the fields into a table you can actually use."
          action={
            <Button className="h-10 rounded-full px-7 text-sm font-semibold" onClick={() => setLocation("/app/upload")}>
              <Plus className="mr-2 h-4 w-4" /> Start extraction
            </Button>
          }
        />
      ) : (
        <div className="rounded-2xl border border-border/50 bg-card shadow-sm overflow-hidden">
          {filteredBatches.length === 0 ? (
            <EmptyState
              inset
              icon={Filter}
              title="Nothing matches those filters"
              body="Widen the status or engine filter, or start a fresh extraction."
              action={
                <Button variant="outline" className="rounded-full text-sm" onClick={() => { setFilterStatus("all"); setFilterEngine("all"); }}>
                  Clear filters
                </Button>
              }
            />
          ) : (
            <div className="divide-y divide-border/40">
              {filteredBatches.map((batch: any) => {
                const isSelected = selectedIds.has(batch.id);
                const progress = batch.totalDocuments > 0 ? (batch.completedDocuments / batch.totalDocuments) * 100 : 0;
                const isImage = batch.firstDocumentContentType?.startsWith("image/");
                const engineLabel = engineLabels.get(batch.engineType) ?? batch.engineType ?? "—";

                return (
                  <div
                    key={batch.id}
                    className={`group flex items-center gap-4 px-5 py-4 cursor-pointer transition-colors ${isSelected ? "bg-primary/[0.04]" : "hover:bg-muted/30"}`}
                    onClick={(e) => {
                      if ((e.target as HTMLElement).tagName === "INPUT" || (e.target as HTMLElement).closest("button")) return;
                      setLocation(`/app/batches/${batch.id}`);
                    }}
                  >
                    {/* Checkbox */}
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded shrink-0 cursor-pointer"
                      checked={isSelected}
                      onChange={(e) => toggleSelect(batch.id, e as any)}
                      onClick={(e) => e.stopPropagation()}
                    />

                    {/* Thumbnail */}
                    <div className="h-12 w-12 rounded-xl bg-muted border border-border/50 overflow-hidden shrink-0 flex items-center justify-center transition-colors group-hover:border-primary/30">
                      {batch.firstDocumentObjectPath && isImage ? (
                        <img
                          src={storageUrl(batch.firstDocumentObjectPath)}
                          className="w-full h-full object-cover"
                          alt={`Batch ${batch.id}`}
                          loading="lazy"
                          onError={(e) => { e.currentTarget.style.display = "none"; }}
                        />
                      ) : (
                        <FileType2 className="h-5 w-5 text-muted-foreground/40 group-hover:text-primary/50 transition-colors" />
                      )}
                    </div>

                    {/* Info */}
                    <div className="flex flex-col min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="font-bold text-[15px] text-foreground">Batch #{batch.id}</span>
                        <span className="hidden sm:inline-flex px-2 py-0.5 rounded-md bg-muted border border-border/40 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                          {engineLabel}
                        </span>
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] font-semibold ${statusColor(batch.status)}`}>
                          <StatusDot status={batch.status} />
                          {batch.status}
                        </span>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(batch.createdAt), { addSuffix: true })}
                      </span>
                    </div>

                    {/* Progress */}
                    <div className="hidden sm:flex flex-col gap-1.5 w-36 shrink-0">
                      <div className="flex justify-between text-[11px] font-semibold">
                        <span className="text-muted-foreground">{batch.status === "failed" ? "Nothing read" : "Progress"}</span>
                        <span className={progress === 100 ? "text-emerald-600" : batch.status === "failed" ? "text-destructive" : "text-foreground"}>
                          {batch.completedDocuments}/{batch.totalDocuments}
                        </span>
                      </div>
                      <div className={`h-1.5 w-full overflow-hidden rounded-full ${batch.status === "failed" ? "bg-destructive/15" : "bg-muted"}`}>
                        <div
                          className={`h-full transition-all duration-700 ease-out rounded-full ${progress === 100 ? "bg-emerald-500" : "bg-primary"}`}
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                    </div>

                    {/* Arrow */}
                    <Button
                      variant="ghost" size="icon"
                      className="h-8 w-8 shrink-0 rounded-full opacity-0 group-hover:opacity-100 transition-all hover:bg-primary/10 hover:text-primary hidden sm:flex"
                      asChild
                    >
                      <Link href={`/app/batches/${batch.id}`}><ArrowRight className="h-4 w-4" /></Link>
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Bulk action bar ───────────────────────── */}
      {isSelecting && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 bg-card/95 border border-border/60 shadow-2xl rounded-2xl px-4 py-2.5 backdrop-blur-md">
          <span className="text-sm font-bold text-foreground pr-1">{selectedIds.size} selected</span>
          <div className="h-4 w-px bg-border/60" />
          <Button variant="outline" size="sm" className="rounded-xl h-8 px-3 text-xs font-semibold border-border/50" onClick={handleBulkExportCSV} disabled={isBusy}>
            {isBusy ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Download className="h-3 w-3 mr-1" />} CSV
          </Button>
          <Button variant="outline" size="sm" className="rounded-xl h-8 px-3 text-xs font-semibold border-border/50" onClick={handleBulkExportExcel} disabled={isBusy}>
            {isBusy ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Download className="h-3 w-3 mr-1" />} Excel
          </Button>
          <div className="h-4 w-px bg-border/60" />
          <Button variant="outline" size="sm" className="rounded-xl h-8 px-3 text-xs font-semibold border-destructive/40 text-destructive hover:bg-destructive/10" onClick={handleBulkDelete} disabled={isBusy}>
            {isBusy ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Trash2 className="h-3 w-3 mr-1" />} Delete
          </Button>
          <div className="h-4 w-px bg-border/60" />
          <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground" onClick={handleClearSelection} disabled={isBusy}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}
    </div>
  );
}
