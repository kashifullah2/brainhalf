import { useState, useRef, useEffect, useMemo } from "react";
import { useRoute, Link } from "wouter";
import { format } from "date-fns";
import { 
  useGetBatch, 
  getGetBatchQueryKey, 
  useRetryDocument, 
  useUpdateDocumentField,
  deleteDocument,
  useAppendBatch,
  type CreateBatchProgress
} from "@/lib/api-client";
import { getConfidenceThreshold } from "@/lib/review-queue-store";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AutoResizingTextarea } from "@/components/ui/auto-resizing-textarea";
import {
  ArrowLeft, Search, Loader2, Download, Copy, FileText,
  ChevronDown, Pencil, AlertTriangle, Trash2
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { DocumentSidePanel } from "@/components/DocumentSidePanel";
import { StatusDot } from "@/components/StatusDot";
import { UploadFlow } from "@/components/UploadModal";
import { useToast } from "@/hooks/use-toast";
import { humanizeFieldLabel } from "@/lib/humanizeField";
import { usePageTitle } from "@/lib/use-page-title";
import { recordsToCsv, recordsToXlsx, downloadBlob } from "@/lib/xlsx-writer";
import { sanitizeForExport } from "@/lib/utils";

export default function BatchDetails() {
  const [, params] = useRoute("/app/batches/:batchId");
  const batchId = params?.batchId ? parseInt(params.batchId, 10) : 0;
  
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [sidePanelDocId, setSidePanelDocId] = useState<number | null>(null);
  
  const { data: batch, isLoading } = useGetBatch(batchId, {
    query: {
      enabled: !!batchId,
      queryKey: getGetBatchQueryKey(batchId),
      // @ts-ignore
      refetchInterval: (query) => {
        const status = query.state.data?.status;
        // 'queued' polls too. A batch is created queued and only becomes
        // processing once its first document starts, so watching only
        // 'processing' meant a freshly created batch sat there showing 0/N
        // until the user reloaded by hand.
        return status === "processing" || status === "queued" ? 3000 : false;
      },
    }
  });

  const retryDoc = useRetryDocument();
  const updateField = useUpdateDocumentField();
  const appendBatch = useAppendBatch();
  const [isUploadOpen, setIsUploadOpen] = useState(false);

  const handleRetry = async (documentId: number) => {
    try {
      await retryDoc.mutateAsync({ batchId, documentId });
      queryClient.invalidateQueries({ queryKey: getGetBatchQueryKey(batchId) });
      toast({ title: "Retry initiated", description: "Document added back to queue." });
    } catch (e: any) {
      toast({ title: "Retry failed", description: e.message, variant: "destructive" });
    }
  };

  const [editingCell, setEditingCell] = useState<{ docId: number; field: string } | null>(null);
  const [editValue, setEditValue] = useState("");
  const editInputRef = useRef<HTMLTextAreaElement>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [page, setPage] = useState(0);
  usePageTitle(batch ? `Batch #${batch.id} · BrainHalf` : "Batch · BrainHalf", { noindex: true });
  // The confidence bars used a hardcoded 0.9 cut-off, so an 87% field looked
  // "warning" in the table while the review queue (80%) did not flag it at all.
  const [threshold, setThreshold] = useState(0.8);

  useEffect(() => {
    getConfidenceThreshold()
      .then(setThreshold)
      .catch(() => {
        /* keep the default */
      });
  }, []);

  useEffect(() => {
    if (editingCell && editInputRef.current) {
      editInputRef.current.focus();
    }
  }, [editingCell]);

  const handleSaveEdit = async () => {
    if (!editingCell) return;
    const { docId, field } = editingCell;
    const doc = batch?.documents.find(d => d.id === docId);
    const extractedField = doc?.extractedFields?.find(f => f.normalizedField === field);
    
    // If not changed or no need to update
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
      
      // Invalidate and refetch the full batch so isDuplicate is recomputed
      // correctly for every document in the batch (editing a key field can
      // change duplicate status for the edited doc AND its counterpart).
      await queryClient.invalidateQueries({ queryKey: getGetBatchQueryKey(batchId) });
      
      toast({ title: "Field updated" });
    } catch (e: any) {
      toast({ title: "Update failed", description: e.message, variant: "destructive" });
    } finally {
      setEditingCell(null);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSaveEdit();
    if (e.key === "Escape") setEditingCell(null);
  };

  const filteredRows = useMemo(() => {
    if (!batch?.rows) return [];
    if (!searchTerm) return batch.rows;
    const lower = searchTerm.toLowerCase();
    const cols = batch.columns || [];
    return batch.rows.filter(row => {
      if (String(row.filename || "").toLowerCase().includes(lower)) return true;
      return cols.some(col => {
        const val = row[col];
        return val && String(val).toLowerCase().includes(lower);
      });
    });
  }, [batch, searchTerm]);

  /** Large batches were rendered as one unbounded table. */
  const PAGE_SIZE = 50;
  const pageCount = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const pagedRows = useMemo(
    () => filteredRows.slice(currentPage * PAGE_SIZE, currentPage * PAGE_SIZE + PAGE_SIZE),
    [filteredRows, currentPage],
  );

  // A search that shrinks the result set must not leave you on a page that no
  // longer exists.
  useEffect(() => {
    setPage(0);
  }, [searchTerm]);

  const buildExportData = (onlySelected = false) => {
    if (!batch) return [];
    const cols = batch.columns || [];
    // Rows are keyed by the documentId the server puts on every row; filename
    // matching is ambiguous when a batch contains two same-named documents.
    const rowsToExport = onlySelected
      ? filteredRows.filter((r) => selectedRows.has(Number(r.documentId)))
      : filteredRows;
      
    return rowsToExport.map(row => {
      const rowData: Record<string, string> = {
        Filename: String(row.filename || ""),
        Status: String(row.status || "")
      };
      for (const col of cols) {
        rowData[humanizeFieldLabel(col)] = sanitizeForExport(String(row[col] || ""));
      }
      return rowData;
    });
  };

  const toggleSelectAll = () => {
    if (selectedRows.size === filteredRows.length) {
      setSelectedRows(new Set());
    } else {
      setSelectedRows(new Set(filteredRows.map((row) => Number(row.documentId))));
    }
  };

  const toggleRowSelect = (docId: number) => {
    const next = new Set(selectedRows);
    if (next.has(docId)) next.delete(docId);
    else next.add(docId);
    setSelectedRows(next);
  };

  const handleBulkExport = () => {
    if (!batch || selectedRows.size === 0) return;
    downloadBlob(
      new Blob([recordsToCsv(buildExportData(true))], { type: "text/csv;charset=utf-8;" }),
      `batch_${batch.id}_selected_export.csv`,
    );
    toast({ title: "Exported selected rows" });
  };

  const handleBulkDelete = async () => {
    if (selectedRows.size === 0) return;
    const ids = [...selectedRows];
    setIsDeleting(true);
    try {
      // Sequential: these are writes against one batch, and each one recomputes
      // the batch status server-side.
      for (const documentId of ids) {
        await deleteDocument(batchId, documentId);
      }
      await queryClient.invalidateQueries({ queryKey: getGetBatchQueryKey(batchId) });
      setSelectedRows(new Set());
      toast({
        title: `${ids.length} document${ids.length === 1 ? "" : "s"} deleted`,
        description: "Their extracted fields and stored files are gone too.",
      });
    } catch (e: any) {
      toast({ title: "Delete failed", description: e.message, variant: "destructive" });
    } finally {
      setIsDeleting(false);
    }
  };

  const handleExportCSV = () => {
    if (!batch) return;
    downloadBlob(
      new Blob([recordsToCsv(buildExportData())], { type: "text/csv;charset=utf-8;" }),
      `batch_${batch.id}_export.csv`,
    );
  };

  const handleExportJSON = () => {
    if (!batch) return;
    const cols = batch.columns || [];
    const payload = filteredRows.map(row => {
      const record: Record<string, unknown> = { filename: row.filename, status: row.status };
      for (const col of cols) record[col] = row[col] ?? "—";
      return record;
    });
    downloadBlob(
      new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }),
      `batch_${batch.id}_export.json`,
    );
  };

  const handleAppendBatchWrapper = async (
    data: {
      documents: any[];
      mode: string;
      forceReprocess?: boolean;
      customPrompt?: string;
      engine?: "auto" | "hunyuan" | "textract";
    },
    onProgress?: (progress: CreateBatchProgress) => void,
  ) => {
    // Defensive: the modal is only reachable past the `!batch` early return
    // further down, but this closure is created before it, so narrow explicitly
    // rather than asserting with `!`.
    if (!batch) throw new Error("The batch is still loading. Try again.");

    return appendBatch.mutateAsync({
      data: {
        batchId: batch.id,
        documents: data.documents,
        forceReprocess: data.forceReprocess,
        customPrompt: data.customPrompt,
        engine: data.engine,
      },
      onProgress,
    });
  };

  const handleBatchAppended = () => {
    setIsUploadOpen(false);
    queryClient.invalidateQueries({ queryKey: getGetBatchQueryKey(batchId) });
    toast({ title: "Documents appended", description: "New files added to this batch successfully." });
  };

  const handleExportExcel = () => {
    if (!batch) return;
    downloadBlob(
      recordsToXlsx(buildExportData(), "Batch Data"),
      `batch_${batch.id}_export.xlsx`,
    );
  };

  const handleCopyClipboard = () => {
    if (!batch) return;
    const cols = batch.columns || [];
    const headers = ["Filename", "Status", ...cols.map(humanizeFieldLabel)];
    const tsvRows = filteredRows.map(row => {
      return [
        row.filename,
        row.status,
        ...cols.map(col => sanitizeForExport(String(row[col] || "")))
      ].join("\t");
    });
    const content = [headers.join("\t"), ...tsvRows].join("\n");
    navigator.clipboard.writeText(content);
    toast({ title: "Copied to clipboard", description: "Table data ready to paste into Excel/Sheets." });
  };

  if (isLoading) {
    return (
      <div className="flex flex-col flex-1 items-center justify-center min-h-[60vh]">
        <Loader2 className="h-10 w-10 animate-spin text-primary/50 mb-4" />
        <h2 className="text-xl font-bold text-foreground">Loading extraction results...</h2>
      </div>
    );
  }

  if (!batch) {
    return (
      <div className="flex flex-col flex-1 items-center justify-center min-h-[60vh] text-center max-w-md mx-auto">
        <AlertTriangle className="h-12 w-12 text-destructive mb-4" />
        <h2 className="text-2xl font-bold text-foreground mb-2">Batch Not Found</h2>
        <p className="text-muted-foreground mb-8">This batch may have been deleted or never existed.</p>
        <Button asChild>
          <Link href="/app">Return to Dashboard</Link>
        </Button>
      </div>
    );
  }

  const getCellDisplay = (row: any, col: string) => {
    const val = row[col];
    if (val === undefined || val === null) return "—";
    return String(val);
  };

  const isCellCorrected = (documentId: number, field: string) => {
    const docs = batch.documents || [];
    const doc = docs.find(d => d.id === documentId);
    const f = doc?.extractedFields?.find(f => f.normalizedField === field);
    return f && f.editedValue !== null;
  };

  return (
      <div className="flex flex-col gap-8">
        <div className="flex flex-wrap items-center gap-5">
          <Button variant="ghost" size="icon" asChild className="rounded-full h-12 w-12 bg-card shadow-sm border border-border/40 hover:bg-muted/50 hover:text-primary transition-colors shrink-0">
            <Link href="/app">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div>
            <div className="flex items-center gap-4">
              <h1 className="text-3xl font-extrabold tracking-tighter text-foreground">Batch #{batch.id}</h1>
              <StatusDot status={batch.status} />
            </div>
            <p className="text-sm font-semibold text-muted-foreground mt-2">
              Created {format(new Date(batch.createdAt), "PPp")} • {batch.completedDocuments}/{batch.totalDocuments} processed
            </p>
          </div>
          
          <div className="ml-auto flex flex-wrap items-center gap-3">
            {/* One menu instead of four side-by-side pills (Copy / CSV / Excel /
                JSON), which consumed most of the header and wrapped badly. */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-full h-11 px-5 shadow-sm font-bold border-border/60 hover:bg-primary/5 hover:text-primary hover:border-primary/30 transition-colors uppercase tracking-wide text-xs"
                >
                  <Download className="mr-2 h-4 w-4" /> Export
                  <ChevronDown className="ml-2 h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-52 rounded-xl">
                <DropdownMenuItem onClick={handleExportCSV} className="cursor-pointer rounded-lg font-semibold">
                  <Download className="mr-2 h-4 w-4" /> Download CSV
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleExportExcel} className="cursor-pointer rounded-lg font-semibold">
                  <Download className="mr-2 h-4 w-4" /> Download Excel
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleExportJSON} className="cursor-pointer rounded-lg font-semibold">
                  <Download className="mr-2 h-4 w-4" /> Download JSON
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleCopyClipboard} className="cursor-pointer rounded-lg font-semibold">
                  <Copy className="mr-2 h-4 w-4" /> Copy to clipboard
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <Dialog open={isUploadOpen} onOpenChange={setIsUploadOpen}>
              <DialogTrigger asChild>
                <Button
                  className="rounded-full h-11 px-6 shadow-md font-bold transition-all hover:scale-105 active:scale-95 uppercase tracking-wide text-xs"
                >
                  <FileText className="mr-2 h-4 w-4" /> Upload More
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-xl bg-card border border-border/60 p-0 overflow-hidden shadow-2xl rounded-[2rem]">
                <DialogHeader className="p-6 pb-2 border-b border-border/40 bg-muted/20">
                  <DialogTitle className="text-xl font-bold tracking-tight">Add to Batch #{batch.id}</DialogTitle>
                </DialogHeader>
                <div className="p-4 bg-background">
                  <UploadFlow
                    mode={batch.engineType || "invoice"}
                    onBatchCreated={handleBatchAppended}
                    createBatchFn={handleAppendBatchWrapper}
                  />
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* Table and inspector sit side by side on wide screens. The panel used
            to be a sibling in a vertical stack, so a component named
            DocumentSidePanel actually rendered as a card underneath the table,
            pushing the page down and landing below the fold. */}
        <div className="flex flex-col xl:flex-row gap-6 items-start">
        <div className="bg-card border border-border/60 rounded-3xl shadow-sm overflow-hidden flex flex-col flex-1 min-w-0 w-full">
          <div className="p-5 border-b border-border/60 flex flex-col sm:flex-row gap-4 justify-between items-center bg-muted/20">
            <div className="flex flex-col sm:flex-row items-center gap-4 w-full">
              <div className="relative w-full sm:w-96">
                <Search className="absolute left-4 top-3.5 h-5 w-5 text-muted-foreground" />
                <Input
                  placeholder="Search filenames or values..."
                  className="pl-12 bg-background rounded-full h-12 border-border/60 focus-visible:ring-primary/50 shadow-sm text-sm font-semibold"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
              
              {selectedRows.size > 0 && (
                <div className="flex items-center gap-3 animate-in fade-in slide-in-from-left-4">
                  <span className="text-xs font-bold text-muted-foreground whitespace-nowrap bg-background px-3 py-1.5 rounded-full border border-border/60">
                    {selectedRows.size} selected
                  </span>
                  <Button size="sm" variant="outline" className="rounded-full h-10 px-4 shadow-sm font-bold border-border/60 bg-background hover:bg-muted" onClick={handleBulkExport}>
                    <Download className="mr-2 h-4 w-4" /> Export
                  </Button>
                  <Button size="sm" variant="destructive" className="rounded-full h-10 px-4 shadow-sm font-bold" onClick={handleBulkDelete} disabled={isDeleting}>
                    {isDeleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />} Delete
                  </Button>
                </div>
              )}
            </div>
          </div>

          <div className="overflow-x-auto max-h-[70vh] relative">
            {/* table-fixed with explicit widths: with auto layout the columns
                re-measured whenever a cell's content changed, so the whole table
                shifted sideways the moment you edited a value. */}
            {(() => {
              const cols = batch.columns || [];
              const docs = batch.documents || [];
              return (
                <table className="w-full text-left border-collapse table-fixed min-w-[720px]">
                  <colgroup>
                    <col style={{ width: "52px" }} />
                    <col style={{ width: "260px" }} />
                    <col style={{ width: "140px" }} />
                    {cols.map((col) => (
                      <col key={col} style={{ width: "200px" }} />
                    ))}
                  </colgroup>
                  <thead className="bg-muted/80 backdrop-blur-md sticky top-0 z-20 shadow-sm border-b border-border/60">
                    <tr>
                      <th className="px-6 py-4 whitespace-nowrap w-[50px]">
                        <input 
                          type="checkbox" 
                          className="rounded border-border/60 text-primary focus:ring-primary/50 h-4 w-4 cursor-pointer" 
                          checked={filteredRows.length > 0 && selectedRows.size === filteredRows.length}
                          onChange={toggleSelectAll}
                        />
                      </th>
                      <th className="px-6 py-4 whitespace-nowrap min-w-[200px] text-[11px] font-extrabold tracking-widest text-muted-foreground uppercase">Document</th>
                      <th className="px-6 py-4 whitespace-nowrap text-[11px] font-extrabold tracking-widest text-muted-foreground uppercase">Status</th>
                      {cols.map((col) => (
                        <th key={col} className="px-6 py-4 whitespace-nowrap overflow-hidden text-ellipsis text-[11px] font-extrabold tracking-widest text-muted-foreground uppercase" title={humanizeFieldLabel(col)}>
                          {humanizeFieldLabel(col)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40">
                    {filteredRows.length === 0 ? (
                      <tr>
                        <td colSpan={cols.length + 3} className="px-6 py-32 text-center">
                          <p className="text-lg font-bold text-foreground">Nothing found here.</p>
                          <p className="text-muted-foreground font-medium mt-1">
                            No document in this batch matches “{searchTerm}”.
                          </p>
                        </td>
                      </tr>
                    ) : (
                      pagedRows.map((row) => {
                        // server/batches.ts sets documentId on every row. A
                        // page-derived index would address the wrong document
                        // on any page after the first.
                        const docId = Number(row.documentId);
                        const isFailed = row.status === "failed";
                        const docInfo = docs.find(d => d.id === docId);
                        const isDuplicate = Boolean(docInfo?.isDuplicate);
                        const isSelected = selectedRows.has(docId);
                        
                        return (
                          <tr 
                            key={docId} 
                            className={`bg-card hover:bg-primary/5 hover:shadow-[inset_4px_0_0_0_hsl(var(--primary))] transition-all group cursor-pointer ${isDuplicate ? "ring-inset ring-1 ring-warning/30" : ""} ${isSelected ? "bg-primary/[0.03] shadow-[inset_4px_0_0_0_hsl(var(--primary))]" : ""}`}
                            onClick={(e) => {
                              if ((e.target as HTMLElement).tagName === "INPUT" || (e.target as HTMLElement).tagName === "BUTTON") return;
                              setSidePanelDocId(docId);
                            }}
                          >
                            <td className="px-6 py-4">
                              <input 
                                type="checkbox" 
                                className="rounded border-border/60 text-primary focus:ring-primary/50 h-4 w-4 cursor-pointer"
                                checked={isSelected}
                                onChange={() => toggleRowSelect(docId)}
                                onClick={(e) => e.stopPropagation()}
                              />
                            </td>
                            <td className="px-6 py-4 font-bold max-w-[300px] truncate text-sm">
                              <div className="flex items-center gap-3 transition-colors">
                                <div className={`p-2 rounded-lg shrink-0 ${isDuplicate ? "bg-warning/10 text-warning" : "bg-muted text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary transition-colors"}`}>
                                  {isDuplicate ? <AlertTriangle className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
                                </div>
                                <div className="flex flex-col min-w-0">
                                  <span className="truncate group-hover:text-primary transition-colors" title={String(row.filename)}>{String(row.filename)}</span>
                                  {isDuplicate && (
                                    <span className="text-[11px] font-extrabold uppercase tracking-widest text-warning leading-none mt-0.5">
                                      Possible Duplicate
                                    </span>
                                  )}
                                </div>
                              </div>
                            </td>
                            <td className="px-6 py-4">
                              {/* Failed documents carry the extraction error on
                                  the row; surface it as the status tooltip. */}
                              <StatusDot status={String(row.status)} title={isFailed ? docInfo?.error : undefined} />
                            </td>
                            {cols.map((col) => {
                              const isEditing = editingCell?.docId === docId && editingCell?.field === col;
                              const extractedField = docInfo?.extractedFields?.find(f => f.normalizedField === col);
                              const corrected = extractedField && extractedField.editedValue !== null;
                              const confidence = extractedField?.confidence;
                              const val = getCellDisplay(row, col);
                              
                              if (isFailed) {
                                return <td key={col} className="px-6 py-4 text-muted-foreground/50 bg-muted/10 font-mono">—</td>;
                              }

                              return (
                                <td 
                                  key={col} 
                                  className="px-6 py-3 relative min-w-[150px] max-w-[250px]"
                                  onDoubleClick={(e) => {
                                    e.stopPropagation();
                                    setEditingCell({ docId, field: col });
                                    setEditValue(val === "—" ? "" : val);
                                  }}
                                >
                                  {isEditing ? (
                                    <div className="absolute inset-0 z-30 w-[320px] max-w-[calc(100vw-2rem)] p-1.5 bg-card rounded-xl shadow-2xl border-2 border-primary">
                                      <AutoResizingTextarea
                                        ref={editInputRef}
                                        value={editValue}
                                        onChange={(e) => setEditValue(e.target.value)}
                                        onBlur={handleSaveEdit}
                                        onKeyDown={(e) => {
                                          if (e.key === "Enter" && !e.shiftKey) {
                                            e.preventDefault();
                                            handleSaveEdit();
                                          }
                                          if (e.key === "Escape") setEditingCell(null);
                                        }}
                                        minRows={1}
                                        maxRows={8}
                                        className="font-mono text-sm"
                                        onClick={(e) => e.stopPropagation()}
                                      />
                                    </div>
                                  ) : (
                                    <div 
                                      className="group-hover:bg-background/80 rounded-md px-2 py-1.5 font-mono text-sm flex items-center justify-between cursor-text border border-transparent group-hover:border-border/40 transition-colors"
                                      title={val}
                                    >
                                      <div className="flex flex-col min-w-0 flex-1">
                                        <span className={`truncate block overflow-hidden text-ellipsis whitespace-nowrap ${corrected ? "text-foreground font-bold" : "text-foreground font-semibold"}`}>
                                          {val}
                                        </span>
                                        {corrected ? (
                                          <span className="mt-1 inline-flex w-fit items-center gap-1 rounded-full bg-warning/10 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-warning">
                                            <Pencil className="h-2.5 w-2.5" /> Edited
                                          </span>
                                        ) : (
                                          val !== "—" && confidence !== undefined && (
                                            <div className="flex items-center gap-1.5 mt-0.5">
                                              <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden">
                                                <div
                                                  className={`h-full ${confidence >= threshold ? 'bg-success' : 'bg-warning'}`}
                                                  style={{ width: `${Math.min(100, Math.max(0, confidence * 100))}%` }}
                                                />
                                              </div>
                                              <span
                                                className={`text-[11px] font-bold ${confidence >= threshold ? 'text-success' : 'text-warning'}`}
                                                title={
                                                  confidence >= threshold
                                                    ? `Above your ${(threshold * 100).toFixed(0)}% review threshold`
                                                    : `Below your ${(threshold * 100).toFixed(0)}% review threshold — queued for review`
                                                }
                                              >
                                                {(confidence * 100).toFixed(0)}%
                                              </span>
                                            </div>
                                          )
                                        )}
                                      </div>
                                    </div>
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              );
            })()}
          </div>
          <div className="p-4 border-t border-border/60 bg-muted/20 text-xs font-bold uppercase tracking-widest text-muted-foreground flex flex-wrap items-center justify-between gap-3">
            <span>Double-click any extracted value to edit.</span>
            <div className="flex items-center gap-4">
              <span>
                {filteredRows.length} row{filteredRows.length === 1 ? "" : "s"}
              </span>
              {pageCount > 1 && (
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 rounded-full px-3 text-[11px] font-bold uppercase tracking-wider border-border/60"
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    disabled={currentPage === 0}
                  >
                    Prev
                  </Button>
                  <span className="tabular-nums">
                    {currentPage + 1} / {pageCount}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 rounded-full px-3 text-[11px] font-bold uppercase tracking-wider border-border/60"
                    onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                    disabled={currentPage >= pageCount - 1}
                  >
                    Next
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
        
        {sidePanelDocId && (
          <div className="w-full xl:w-[400px] shrink-0 xl:sticky xl:top-24 animate-in slide-in-from-right-8 duration-300">
            <DocumentSidePanel 
              doc={(batch.documents || []).find(d => d.id === sidePanelDocId)} 
              onClose={() => setSidePanelDocId(null)} 
            />
          </div>
        )}
        </div>
      </div>
  );
}
