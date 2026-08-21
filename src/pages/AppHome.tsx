import { useState, useCallback, useMemo } from "react";
import { useLocation } from "wouter";
import { Link } from "wouter";
import { formatDistanceToNow } from "date-fns";
import {
  Plus,
  FileText,
  Loader2,
  ArrowRight,
  Trash2,
  Download,
  CheckSquare,
  Square,
  X,
  Filter,
  ArrowDownUp,
  FileType2
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusDot } from "@/components/StatusDot";
import { PRESETS } from "@/components/UploadModal";
import {
  useListBatches,
  getBatch,
  deleteBatch,
  getListBatchesQueryKey,
  storageUrl,
} from "@/lib/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { usePageTitle } from "@/lib/use-page-title";
import { sanitizeForExport } from "@/lib/utils";
import { recordsToCsv, recordsToXlsx, downloadBlob } from "@/lib/xlsx-writer";

export default function AppHome() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  usePageTitle("Dashboard · BrainHalf");
  const queryClient = useQueryClient();
  const { data: batches, isLoading, error } = useListBatches();

  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [isBusy, setIsBusy] = useState(false);
  
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterEngine, setFilterEngine] = useState<string>("all");
  const [sortOrder, setSortOrder] = useState<"newest" | "oldest">("newest");

  const filteredBatches = useMemo(() => {
    if (!batches) return [];
    let result = [...batches];
    if (filterStatus !== "all") {
      result = result.filter((b) => b.status === filterStatus);
    }
    if (filterEngine !== "all") {
      result = result.filter((b) => b.engineType === filterEngine);
    }
    if (sortOrder === "newest") {
      result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    } else {
      result.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    }
    return result;
  }, [batches, filterStatus, filterEngine, sortOrder]);

  const allSelected = filteredBatches?.length > 0 && selectedIds.size === filteredBatches.length;

  const isSelecting = selectedIds.size > 0;

  const toggleSelect = useCallback((id: number, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleSelectAll = () => {
    if (!filteredBatches) return;
    if (selectedIds.size === filteredBatches.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredBatches.map((b: any) => b.id)));
    }
  };

  const handleClearSelection = () => setSelectedIds(new Set());

  const handleBulkDelete = async () => {
    if (!selectedIds.size) return;
    setIsBusy(true);
    const ids = [...selectedIds];
    try {
      // Chunk requests to avoid network spikes on large bulk deletes
      const chunkSize = 3;
      for (let i = 0; i < ids.length; i += chunkSize) {
        const chunk = ids.slice(i, i + chunkSize);
        await Promise.all(chunk.map((id) => deleteBatch(id)));
      }

      await queryClient.invalidateQueries({
        queryKey: getListBatchesQueryKey(),
      });
      setSelectedIds(new Set());
      toast({
        title: `${ids.length} batch${ids.length > 1 ? "es" : ""} deleted`,
        description: "They're gone for good.",
      });
    } catch (e: any) {
      toast({
        title: "Delete failed",
        description: e.message,
        variant: "destructive",
      });
    } finally {
      setIsBusy(false);
    }
  };

  const buildExportData = (
    batchDataList: Array<{ id: number; columns: string[]; rows: any[] }>,
  ) => {
    const allColumnsSet = new Set<string>();
    for (const { columns } of batchDataList) {
      columns.forEach((c) => allColumnsSet.add(c));
    }
    const allColumns = [...allColumnsSet];

    const exportData = [];
    for (const { id, rows } of batchDataList) {
      for (const row of rows) {
        const rowData: Record<string, string> = {
          Batch: String(id),
          Filename: String(row.filename ?? ""),
          Status: String(row.status ?? ""),
        };
        for (const col of allColumns) {
          rowData[col.replace(/_/g, " ")] = sanitizeForExport(
            String(row[col] ?? ""),
          );
        }
        exportData.push(rowData);
      }
    }
    return exportData;
  };

  const fetchSelectedBatches = async () => {
    const ids = [...selectedIds];

    // Chunk requests to avoid network spikes on large bulk exports
    const results = [];
    const chunkSize = 3;
    for (let i = 0; i < ids.length; i += chunkSize) {
      const chunk = ids.slice(i, i + chunkSize);
      const chunkResults = await Promise.all(chunk.map((id) => getBatch(id)));
      results.push(...chunkResults);
    }

    return results.map((batch, i) => ({
      id: ids[i],
      columns: batch.columns,
      rows: batch.rows,
    }));
  };

  const handleBulkExportCSV = async () => {
    if (!selectedIds.size) return;
    setIsBusy(true);
    try {
      const batchDataList = await fetchSelectedBatches();
      const exportData = buildExportData(batchDataList);

      const label =
        selectedIds.size === 1
          ? `batch_${[...selectedIds][0]}`
          : `batches_${[...selectedIds].join("_")}`;
      downloadBlob(
        new Blob([recordsToCsv(exportData)], { type: "text/csv;charset=utf-8;" }),
        `${label}_export.csv`,
      );
      toast({
        title: "CSV exported",
        description: `${batchDataList.reduce((sum, b) => sum + b.rows.length, 0)} rows across ${selectedIds.size} batch${selectedIds.size > 1 ? "es" : ""}.`,
      });
    } catch (e: any) {
      toast({
        title: "Export failed",
        description: e.message,
        variant: "destructive",
      });
    } finally {
      setIsBusy(false);
    }
  };

  const handleBulkExportExcel = async () => {
    if (!selectedIds.size) return;
    setIsBusy(true);
    try {
      const batchDataList = await fetchSelectedBatches();
      const exportData = buildExportData(batchDataList);

      const label =
        selectedIds.size === 1
          ? `batch_${[...selectedIds][0]}`
          : `batches_${[...selectedIds].join("_")}`;
      downloadBlob(recordsToXlsx(exportData, "Extracted Data"), `${label}_export.xlsx`);
      toast({
        title: "Excel exported",
        description: `${batchDataList.reduce((sum, b) => sum + b.rows.length, 0)} rows across ${selectedIds.size} batch${selectedIds.size > 1 ? "es" : ""}.`,
      });
    } catch (e: any) {
      toast({
        title: "Export failed",
        description: e.message,
        variant: "destructive",
      });
    } finally {
      setIsBusy(false);
    }
  };



  return (
    // Container width/padding come from AppLayout's <main>; this page must not
    // add its own max-width wrapper on top.
    <div
      className={`flex flex-col flex-1 relative w-full ${
        // Leaves room for the floating bulk-action bar, which otherwise sits on
        // top of the last batch row and hides it.
        isSelecting ? "pb-32" : ""
      }`}
    >
      {/* Background decoration */}
      <div className="absolute inset-0 pointer-events-none -z-10 overflow-hidden">
        <div className="absolute top-[-10%] right-[-5%] w-[40%] h-[40%] rounded-full bg-primary/5 blur-[120px]" />
        <div className="absolute bottom-[-10%] left-[-5%] w-[30%] h-[30%] rounded-full bg-accent/5 blur-[100px]" />
      </div>

      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 mb-10 border-b border-border/40 pb-8">
        <div className="space-y-3 min-w-0 lg:max-w-2xl">
          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight text-foreground">
            Batches
          </h1>
          <p className="text-muted-foreground text-base md:text-lg font-medium">
            Every extraction run in one place. Open a batch to review, edit,
            and export its data.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {batches && batches.length > 0 && (
            <div className="flex flex-wrap items-center gap-3">
              {/* Was `hidden md:flex`: on phones the only way to find a batch
                  was scrolling the whole list. flex-wrap keeps the controls
                  usable at any width. */}
              <div className="flex flex-wrap items-center gap-2 bg-muted/30 p-1 rounded-xl border border-border/40">
                <Select value={filterStatus} onValueChange={setFilterStatus}>
                  <SelectTrigger className="h-9 border-none bg-transparent shadow-none text-xs font-bold uppercase tracking-wider w-[130px]">
                    <div className="flex items-center gap-2"><Filter className="h-3.5 w-3.5" /> <SelectValue placeholder="Status" /></div>
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
                <div className="w-px h-4 bg-border/60 hidden sm:block" />
                {/* Options come from PRESETS so the filter always matches real
                    engine ids. */}
                <Select value={filterEngine} onValueChange={setFilterEngine}>
                  <SelectTrigger className="h-9 border-none bg-transparent shadow-none text-xs font-bold uppercase tracking-wider w-[140px]">
                    <SelectValue placeholder="Engine" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Engines</SelectItem>
                    {PRESETS.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="w-px h-4 bg-border/60 hidden sm:block" />
                <Select value={sortOrder} onValueChange={(val: "newest"|"oldest") => setSortOrder(val)}>
                  <SelectTrigger className="h-9 border-none bg-transparent shadow-none text-xs font-bold uppercase tracking-wider w-[130px]">
                    <div className="flex items-center gap-2"><ArrowDownUp className="h-3.5 w-3.5" /> <SelectValue placeholder="Sort" /></div>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="newest">Newest First</SelectItem>
                    <SelectItem value="oldest">Oldest First</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <Button
                variant="outline"
                className="rounded-full shadow-sm px-5 h-11 text-xs font-bold uppercase tracking-wide border-border/60"
                onClick={handleSelectAll}
              >
                {allSelected ? (
                  <>
                    <CheckSquare className="mr-2 h-4 w-4" /> Deselect All
                  </>
                ) : (
                  <>
                    <Square className="mr-2 h-4 w-4" /> Select All
                  </>
                )}
              </Button>
            </div>
          )}
          <Button
            className="rounded-full shadow-sm px-8 h-11 md:h-12 text-xs md:text-sm font-bold uppercase tracking-wide shrink-0"
            onClick={() => setLocation("/app/upload")}
          >
            <Plus className="mr-2 h-4 w-4" /> New Batch
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex flex-col justify-center items-center py-32 space-y-4">
          <Loader2 className="h-10 w-10 animate-spin text-primary/50" />
          <h2 className="text-xl font-bold text-foreground">
            Loading your batches…
          </h2>
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-destructive/20 bg-destructive/5 p-8 text-center text-destructive font-bold shadow-sm">
          We couldn't load your batches. Check your connection and try again.
        </div>
      ) : batches?.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-32 text-center max-w-lg mx-auto">
          <div className="flex h-24 w-24 items-center justify-center rounded-[2rem] bg-card border-2 border-dashed border-border/60 text-muted-foreground mb-8 rotate-3 shadow-sm">
            <FileText className="h-10 w-10" />
          </div>
          <h3 className="text-3xl font-extrabold tracking-tight mb-4 text-foreground text-balance">
            Let's get your weekend back.
          </h3>
          <p className="text-muted-foreground mb-8 text-base font-medium leading-relaxed">
            Drop in a few invoices, receipts, or any document — brainhalf will
            pull out the fields and line them up in a table you can actually
            use.
          </p>
          <Button
            className="rounded-full px-8 h-12 shadow-sm text-sm tracking-wide uppercase font-bold"
            onClick={() => setLocation("/app/upload")}
          >
            <Plus className="mr-2 h-4 w-4" /> Start extraction
          </Button>
        </div>
      ) : (
        <>
          <div className="bg-card border border-border/60 rounded-3xl shadow-sm overflow-hidden">
            {filteredBatches.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-24 text-center">
                <FileText className="h-12 w-12 text-muted-foreground/30 mb-4" />
                <h3 className="text-xl font-bold text-foreground">No batches found</h3>
                <p className="text-muted-foreground text-sm mt-1">Try adjusting your filters or start a new extraction.</p>
              </div>
            ) : (
              <div className="divide-y divide-border/40">
                {filteredBatches.map((batch: any) => {
                  const isSelected = selectedIds.has(batch.id);
                  const progress = batch.totalDocuments > 0 ? (batch.completedDocuments / batch.totalDocuments) * 100 : 0;
                  const isImage = batch.firstDocumentContentType?.startsWith("image/");
                  
                  return (
                    <div 
                      key={batch.id}
                      className={`group flex flex-col sm:flex-row sm:items-center gap-4 p-4 sm:p-5 transition-colors cursor-pointer ${isSelected ? 'bg-primary/[0.03]' : 'hover:bg-muted/30'}`}
                      onClick={(e) => {
                        // Avoid triggering link if clicking checkbox or buttons
                        if ((e.target as HTMLElement).tagName === "INPUT" || (e.target as HTMLElement).closest("button")) return;
                        setLocation(`/app/batches/${batch.id}`);
                      }}
                    >
                      <div className="flex items-center gap-4 w-full sm:w-auto sm:flex-1 min-w-0">
                        <input 
                          type="checkbox"
                          className="rounded border-border/60 text-primary focus:ring-primary/50 h-5 w-5 cursor-pointer shrink-0"
                          checked={isSelected}
                          onChange={(e) => toggleSelect(batch.id, e as any)}
                          onClick={(e) => e.stopPropagation()}
                        />
                        
                        <div className="h-14 w-14 sm:h-16 sm:w-16 rounded-xl bg-muted/40 border border-border/60 overflow-hidden shrink-0 flex items-center justify-center relative">
                          {batch.firstDocumentObjectPath && isImage ? (
                            <img
                              src={storageUrl(batch.firstDocumentObjectPath)}
                              className="w-full h-full object-cover"
                              alt={`First document in batch ${batch.id}`}
                              loading="lazy"
                              // Falls back to the file icon rather than showing
                              // a broken-image glyph.
                              onError={(e) => {
                                e.currentTarget.style.display = "none";
                              }}
                            />
                          ) : (
                            <FileType2 className="h-6 w-6 text-muted-foreground/50" />
                          )}
                          <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent pointer-events-none" />
                        </div>
                        
                        <div className="flex flex-col min-w-0 flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <h3 className="font-extrabold text-base sm:text-lg text-foreground truncate">
                              Batch #{batch.id}
                            </h3>
                            <span className="hidden sm:inline-flex px-2 py-0.5 rounded-full bg-muted border border-border/40 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
                              {batch.engineType || "Invoice"}
                            </span>
                          </div>
                          <div className="flex items-center gap-3 text-xs text-muted-foreground font-semibold">
                            <span>{formatDistanceToNow(new Date(batch.createdAt), { addSuffix: true })}</span>
                            <span className="w-1 h-1 rounded-full bg-border/80" />
                            <StatusDot status={batch.status} />
                          </div>
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-6 sm:gap-8 w-full sm:w-auto pl-9 sm:pl-0">
                        <div className="flex flex-col gap-1.5 w-full sm:w-32 lg:w-48 shrink-0">
                          <div className="flex justify-between text-[11px] font-extrabold uppercase tracking-widest">
                            <span className="text-muted-foreground">Progress</span>
                            <span className={progress === 100 ? "text-success" : "text-foreground"}>
                              {batch.completedDocuments} / {batch.totalDocuments}
                            </span>
                          </div>
                          <div className="h-2 w-full bg-muted rounded-full overflow-hidden border border-border/40">
                            <div 
                              className={`h-full transition-all duration-500 ${progress === 100 ? 'bg-success' : 'bg-primary'}`} 
                              style={{ width: `${progress}%` }} 
                            />
                          </div>
                        </div>
                        
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="h-10 w-10 shrink-0 rounded-full text-muted-foreground opacity-0 group-hover:opacity-100 transition-all hover:bg-primary/10 hover:text-primary hidden sm:flex"
                          asChild
                        >
                          <Link href={`/app/batches/${batch.id}`}>
                            <ArrowRight className="h-5 w-5" />
                          </Link>
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Bulk action bar */}
          {isSelecting && (
            <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-card border border-border/60 shadow-2xl rounded-2xl px-5 py-3.5 backdrop-blur-sm">
              <span className="text-sm font-extrabold text-foreground mr-1">
                {selectedIds.size} selected
              </span>

              <div className="h-5 w-px bg-border/60 mx-1" />

              <Button
                variant="outline"
                size="sm"
                className="rounded-full h-9 px-4 font-bold text-xs uppercase tracking-wide border-border/60 hover:bg-primary/5 hover:text-primary hover:border-primary/30 transition-colors"
                onClick={handleBulkExportCSV}
                disabled={isBusy}
              >
                {isBusy ? (
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                ) : (
                  <Download className="h-3.5 w-3.5 mr-1.5" />
                )}
                CSV
              </Button>

              <Button
                variant="outline"
                size="sm"
                className="rounded-full h-9 px-4 font-bold text-xs uppercase tracking-wide border-border/60 hover:bg-primary/5 hover:text-primary hover:border-primary/30 transition-colors"
                onClick={handleBulkExportExcel}
                disabled={isBusy}
              >
                {isBusy ? (
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                ) : (
                  <Download className="h-3.5 w-3.5 mr-1.5" />
                )}
                Excel
              </Button>

              <div className="h-5 w-px bg-border/60 mx-1" />

              <Button
                variant="outline"
                size="sm"
                className="rounded-full h-9 px-4 font-bold text-xs uppercase tracking-wide border-destructive/40 text-destructive hover:bg-destructive/10 hover:border-destructive transition-colors"
                onClick={handleBulkDelete}
                disabled={isBusy}
              >
                {isBusy ? (
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                )}
                Delete
              </Button>

              <div className="h-5 w-px bg-border/60 mx-1" />

              <Button
                variant="ghost"
                size="icon"
                className="rounded-full h-9 w-9 text-muted-foreground hover:text-foreground"
                onClick={handleClearSelection}
                disabled={isBusy}
                aria-label="Clear selection"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
