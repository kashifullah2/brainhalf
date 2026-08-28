import { useState, useRef, useEffect, useMemo } from "react";
import { useRoute, Link } from "wouter";
import { formatDistanceToNow } from "date-fns";
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
  ChevronDown, Pencil, AlertTriangle, Trash2, Check, X
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
import { EmptyState, ListSkeleton } from "@/components/app";
import { StatusDot, StatusChip } from "@/components/StatusDot";
import { UploadFlow } from "@/components/UploadModal";
import { useToast } from "@/hooks/use-toast";
import { humanizeFieldLabel } from "@/lib/humanizeField";
import { humanizeExtractionError } from "@/lib/humanize-error";
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
        return status === "processing" || status === "queued" ? 3000 : false;
      },
    }
  });

  const retryDoc = useRetryDocument();
  const updateField = useUpdateDocumentField();
  const appendBatch = useAppendBatch();
  const [isUploadOpen, setIsUploadOpen] = useState(false);

  const [editingCell, setEditingCell] = useState<{ docId: number; field: string } | null>(null);
  const [editValue, setEditValue] = useState("");
  const editInputRef = useRef<HTMLTextAreaElement>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [page, setPage] = useState(0);
  usePageTitle(batch ? `Batch #${batch.id} · BrainHalf` : "Batch · BrainHalf", { noindex: true });
  const [threshold, setThreshold] = useState(0.8);

  useEffect(() => {
    getConfidenceThreshold().then(setThreshold).catch(() => {});
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
    } catch (e: any) {
      toast({ title: "Update failed", description: e.message, variant: "destructive" });
    } finally {
      setEditingCell(null);
    }
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

  const PAGE_SIZE = 50;
  const pageCount = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const pagedRows = useMemo(
    () => filteredRows.slice(currentPage * PAGE_SIZE, currentPage * PAGE_SIZE + PAGE_SIZE),
    [filteredRows, currentPage],
  );

  useEffect(() => { setPage(0); }, [searchTerm]);

  const buildExportData = (onlySelected = false) => {
    if (!batch) return [];
    const cols = batch.columns || [];
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
      for (const documentId of ids) {
        await deleteDocument(batchId, documentId);
      }
      await queryClient.invalidateQueries({ queryKey: getGetBatchQueryKey(batchId) });
      setSelectedRows(new Set());
      toast({ title: `${ids.length} document${ids.length === 1 ? "" : "s"} deleted` });
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
    data: { documents: any[]; mode: string; forceReprocess?: boolean; customPrompt?: string; },
    onProgress?: (progress: CreateBatchProgress) => void,
  ) => {
    if (!batch) throw new Error("The batch is still loading.");
    return appendBatch.mutateAsync({
      data: { batchId: batch.id, documents: data.documents, forceReprocess: data.forceReprocess, customPrompt: data.customPrompt },
      onProgress,
    });
  };

  const handleBatchAppended = () => {
    setIsUploadOpen(false);
    queryClient.invalidateQueries({ queryKey: getGetBatchQueryKey(batchId) });
    toast({ title: `Added to Batch #${batch?.id ?? ""}`.trim() });
  };

  const handleExportExcel = () => {
    if (!batch) return;
    downloadBlob(recordsToXlsx(buildExportData(), "Batch Data"), `batch_${batch.id}_export.xlsx`);
  };

  const handleCopyClipboard = () => {
    if (!batch) return;
    const cols = batch.columns || [];
    const headers = ["Filename", "Status", ...cols.map(humanizeFieldLabel)];
    const tsvRows = filteredRows.map(row => {
      return [row.filename, row.status, ...cols.map(col => sanitizeForExport(String(row[col] || "")))].join("\t");
    });
    const content = [headers.join("\t"), ...tsvRows].join("\n");
    navigator.clipboard.writeText(content);
    toast({ title: "Copied to clipboard" });
  };

  if (isLoading) return <ListSkeleton rows={6} />;

  if (!batch) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title="Batch not found"
        body="It may have been deleted, or the link points somewhere that doesn't exist."
        action={
          <Button asChild className="h-9 rounded-lg px-6 text-[13px] font-semibold">
            <Link href="/app">Return to dashboard</Link>
          </Button>
        }
      />
    );
  }

  const getCellDisplay = (row: any, col: string) => {
    const val = row[col];
    if (val === undefined || val === null) return "—";
    return String(val);
  };

  return (
    <div className="flex flex-col gap-6">
      {/* ── Header ─────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild className="rounded-lg h-10 w-10 border border-border/60 bg-card hover:bg-muted/80 transition-colors shrink-0">
            <Link href="/app"><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight text-foreground">Batch #{batch.id}</h1>
              <StatusChip status={batch.status} />
            </div>
            <p className="text-[13px] text-muted-foreground mt-1">
              Started {formatDistanceToNow(new Date(batch.createdAt), { addSuffix: true })}
              {" · "}
              {batch.completedDocuments} of {batch.totalDocuments} read
            </p>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="rounded-lg h-9 px-3.5 text-[13px] font-semibold border-border/60">
                <Download className="mr-1.5 h-3.5 w-3.5" /> Export <ChevronDown className="ml-1 h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-44 rounded-xl">
              <DropdownMenuItem onClick={handleExportCSV} className="rounded-lg text-[13px] cursor-pointer"><Download className="mr-2 h-3.5 w-3.5" /> CSV</DropdownMenuItem>
              <DropdownMenuItem onClick={handleExportExcel} className="rounded-lg text-[13px] cursor-pointer"><Download className="mr-2 h-3.5 w-3.5" /> Excel</DropdownMenuItem>
              <DropdownMenuItem onClick={handleExportJSON} className="rounded-lg text-[13px] cursor-pointer"><Download className="mr-2 h-3.5 w-3.5" /> JSON</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleCopyClipboard} className="rounded-lg text-[13px] cursor-pointer"><Copy className="mr-2 h-3.5 w-3.5" /> Copy to clipboard</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Dialog open={isUploadOpen} onOpenChange={setIsUploadOpen}>
            <DialogTrigger asChild>
              <Button className="rounded-lg h-9 px-4 text-[13px] font-semibold shadow-sm">
                <FileText className="mr-1.5 h-3.5 w-3.5" /> Add files
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-xl bg-card border border-border/60 p-0 overflow-hidden shadow-2xl rounded-2xl">
              <DialogHeader className="p-5 border-b border-border/60 bg-muted/20">
                <DialogTitle className="text-lg font-bold">Add to Batch #{batch.id}</DialogTitle>
              </DialogHeader>
              <div className="p-4 bg-background">
                <UploadFlow
                  mode={batch.engineType || "invoice"}
                  customPrompt={batch.prompt}
                  onBatchCreated={handleBatchAppended}
                  createBatchFn={handleAppendBatchWrapper}
                />
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {(() => {
        const docs = batch.documents ?? [];
        const failed = docs.filter((d: any) => d.status === "failed");
        if (!docs.length || failed.length !== docs.length) return null;
        const human = humanizeExtractionError(failed[0]?.error);
        return (
          <div className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4" title={failed[0]?.error ?? undefined}>
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
              <AlertTriangle className="h-4 w-4" />
            </div>
            <div className="min-w-0 space-y-0.5 mt-0.5">
              <p className="text-[13px] font-semibold text-foreground">{human.title}</p>
              <p className="text-[13px] text-muted-foreground">{human.body}</p>
            </div>
          </div>
        );
      })()}

      {/* ── Table & Panel ────────────────────────────────────── */}
      <div className="flex flex-col xl:flex-row gap-6 items-start">
        <div className="bg-card border border-border/60 rounded-xl shadow-sm flex flex-col flex-1 min-w-0 w-full overflow-hidden">
          
          {/* Toolbar */}
          <div className="p-3 border-b border-border/60 flex flex-col sm:flex-row gap-3 justify-between items-center bg-muted/20">
            <div className="relative w-full sm:w-80">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search..."
                className="pl-9 h-9 rounded-lg bg-background border-border/60 text-[13px]"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            {selectedRows.size > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-[12px] font-semibold text-muted-foreground pr-2">
                  {selectedRows.size} selected
                </span>
                <Button size="sm" variant="outline" className="h-8 rounded-lg px-3 text-[12px]" onClick={handleBulkExport}>
                  <Download className="mr-1.5 h-3.5 w-3.5" /> Export
                </Button>
                <Button size="sm" variant="outline" className="h-8 rounded-lg px-3 text-[12px] border-destructive/30 text-destructive hover:bg-destructive/10" onClick={handleBulkDelete} disabled={isDeleting}>
                  {isDeleting ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Trash2 className="mr-1.5 h-3.5 w-3.5" />} Delete
                </Button>
              </div>
            )}
          </div>

          <div className="overflow-x-auto min-h-[400px]">
            {(() => {
              const cols = batch.columns || [];
              const docs = batch.documents || [];
              return (
                <table className="w-full text-left border-collapse table-fixed min-w-[720px]">
                  <colgroup>
                    <col style={{ width: "48px" }} />
                    <col style={{ width: "240px" }} />
                    <col style={{ width: "120px" }} />
                    {cols.map((col) => <col key={col} style={{ width: "200px" }} />)}
                  </colgroup>
                  <thead className="bg-muted/80 backdrop-blur-sm sticky top-0 z-20 shadow-sm border-b border-border/60">
                    <tr>
                      <th className="px-4 py-3 whitespace-nowrap">
                        <input 
                          type="checkbox" 
                          className="rounded border-border/60 text-primary h-3.5 w-3.5 cursor-pointer accent-primary" 
                          checked={filteredRows.length > 0 && selectedRows.size === filteredRows.length}
                          onChange={toggleSelectAll}
                        />
                      </th>
                      <th className="px-4 py-3 whitespace-nowrap text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Document</th>
                      <th className="px-4 py-3 whitespace-nowrap text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Status</th>
                      {cols.map((col) => (
                        <th key={col} className="px-4 py-3 whitespace-nowrap overflow-hidden text-ellipsis text-[11px] font-semibold tracking-wide text-muted-foreground uppercase" title={humanizeFieldLabel(col)}>
                          {humanizeFieldLabel(col)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50 text-[13px]">
                    {filteredRows.length === 0 ? (
                      <tr>
                        <td colSpan={cols.length + 3} className="px-4 py-20 text-center">
                          <p className="font-semibold text-foreground">Nothing found</p>
                          <p className="text-muted-foreground mt-1 text-[13px]">No documents match your search.</p>
                        </td>
                      </tr>
                    ) : (
                      pagedRows.map((row) => {
                        const docId = Number(row.documentId);
                        const isFailed = row.status === "failed";
                        const docInfo = docs.find(d => d.id === docId);
                        const isDuplicate = Boolean(docInfo?.isDuplicate);
                        const isSelected = selectedRows.has(docId);
                        
                        return (
                          <tr 
                            key={docId} 
                            className={`bg-card hover:bg-muted/30 transition-colors cursor-pointer group ${isSelected ? "bg-primary/5" : ""} ${isDuplicate ? "bg-warning/5" : ""}`}
                            onClick={(e) => {
                              if ((e.target as HTMLElement).tagName === "INPUT" || (e.target as HTMLElement).tagName === "BUTTON") return;
                              setSidePanelDocId(docId);
                            }}
                          >
                            <td className="px-4 py-3">
                              <input 
                                type="checkbox" 
                                className="rounded border-border/60 text-primary h-3.5 w-3.5 cursor-pointer accent-primary"
                                checked={isSelected}
                                onChange={() => toggleRowSelect(docId)}
                                onClick={(e) => e.stopPropagation()}
                              />
                            </td>
                            <td className="px-4 py-3 min-w-0">
                              <div className="flex items-center gap-2">
                                <FileText className={`h-3.5 w-3.5 shrink-0 ${isDuplicate ? "text-warning" : "text-muted-foreground"}`} />
                                <div className="min-w-0">
                                  <p className="truncate font-medium text-foreground group-hover:text-primary transition-colors" title={String(row.filename)}>{String(row.filename)}</p>
                                  {isDuplicate && <span className="text-[10px] font-semibold text-warning uppercase">Duplicate</span>}
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              <StatusChip status={String(row.status)} title={isFailed ? docInfo?.error : undefined} />
                            </td>
                            {cols.map((col) => {
                              const isEditing = editingCell?.docId === docId && editingCell?.field === col;
                              const extractedField = docInfo?.extractedFields?.find(f => f.normalizedField === col);
                              const corrected = extractedField && extractedField.editedValue !== null;
                              const confidence = extractedField?.confidence;
                              const val = getCellDisplay(row, col);
                              
                              if (isFailed) return <td key={col} className="px-4 py-3 text-muted-foreground/40">—</td>;

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
                                    <div className="absolute inset-0 z-30 w-[300px] p-1.5 bg-card rounded-lg shadow-xl border border-primary">
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
                                        className="text-[13px] h-auto p-2"
                                        onClick={(e) => e.stopPropagation()}
                                      />
                                    </div>
                                  ) : (
                                    <div className="flex flex-col min-w-0 group/cell">
                                      <span className={`truncate block overflow-hidden text-ellipsis ${corrected ? "text-foreground font-semibold" : "text-foreground"}`} title={val}>
                                        {val}
                                      </span>
                                      {corrected ? (
                                        <span className="text-[10px] font-semibold text-success mt-0.5 flex items-center gap-1"><Pencil className="h-2.5 w-2.5" /> Edited</span>
                                      ) : (
                                        val !== "—" && confidence !== undefined && (
                                          <div className="flex items-center gap-1 mt-1 max-w-[80px]">
                                            <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden">
                                              <div className={`h-full ${confidence >= threshold ? 'bg-success' : 'bg-amber-400'}`} style={{ width: `${Math.min(100, Math.max(0, confidence * 100))}%` }} />
                                            </div>
                                            <span className={`text-[9px] font-semibold ${confidence >= threshold ? 'text-success' : 'text-amber-500'}`}>{(confidence * 100).toFixed(0)}%</span>
                                          </div>
                                        )
                                      )}
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
          <div className="p-3 border-t border-border/60 bg-muted/20 text-[12px] flex items-center justify-between gap-4">
            <span className="text-muted-foreground">{filteredRows.length} row{filteredRows.length === 1 ? "" : "s"}</span>
            {pageCount > 1 && (
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" className="h-7 rounded-lg px-2.5 text-[11px]" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={currentPage === 0}>Prev</Button>
                <span className="text-muted-foreground font-medium">{currentPage + 1} / {pageCount}</span>
                <Button variant="outline" size="sm" className="h-7 rounded-lg px-2.5 text-[11px]" onClick={() => setPage(p => Math.min(pageCount - 1, p + 1))} disabled={currentPage >= pageCount - 1}>Next</Button>
              </div>
            )}
          </div>
        </div>
        
        {sidePanelDocId && (
          <div className="w-full xl:w-[400px] shrink-0 xl:sticky xl:top-20 animate-in slide-in-from-right-4 duration-200">
            <DocumentSidePanel doc={(batch.documents || []).find(d => d.id === sidePanelDocId)} onClose={() => setSidePanelDocId(null)} />
          </div>
        )}
      </div>
    </div>
  );
}
