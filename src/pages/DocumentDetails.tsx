import { useState, useEffect, useMemo } from "react";
import { useRoute, Link } from "wouter";
import {
  useGetBatch,
  getGetBatchQueryKey,
  useGetDocument,
  useUpdateDocumentField,
  storageUrl
} from "@/lib/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { AutoResizingTextarea } from "@/components/ui/auto-resizing-textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState, ListSkeleton } from "@/components/app";
import { ConfidenceIndicator } from "@/components/ConfidenceIndicator";
import { useToast } from "@/hooks/use-toast";
import { humanizeFieldLabel } from "@/lib/humanizeField";
import { humanizeExtractionError } from "@/lib/humanize-error";
import { getConfidenceThreshold } from "@/lib/review-queue-store";
import { usePageTitle } from "@/lib/use-page-title";
import { validateFieldMath, type MathWarning } from "@/lib/confidence-scorer";
import {
  ArrowLeft, FileText, FileImage, FileType, FileQuestion,
  Edit2, Check, X, AlertCircle, AlertTriangle, Loader2,
  ZoomIn, ZoomOut, Maximize
} from "lucide-react";
import { TransformWrapper, TransformComponent, useControls } from "react-zoom-pan-pinch";

function StatusChip({ status, title }: { status: string, title?: string }) {
  const map: Record<string, { label: string; cls: string; dot: string }> = {
    completed: { label: "Done",       cls: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800/50", dot: "bg-emerald-500" },
    processing: { label: "Running",   cls: "bg-amber-50  text-amber-700  border-amber-200  dark:bg-amber-950/40  dark:text-amber-400  dark:border-amber-800/50",  dot: "bg-amber-500 animate-pulse"  },
    queued:     { label: "Queued",    cls: "bg-amber-50  text-amber-700  border-amber-200  dark:bg-amber-950/40  dark:text-amber-400  dark:border-amber-800/50",  dot: "bg-amber-400 animate-pulse"  },
    failed:     { label: "Failed",    cls: "bg-red-50    text-red-700    border-red-200    dark:bg-red-950/40    dark:text-red-400    dark:border-red-800/50",    dot: "bg-red-500"   },
    partial:    { label: "Partial",   cls: "bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/40 dark:text-orange-400 dark:border-orange-800/50", dot: "bg-orange-500" },
  };
  const s = map[status] ?? { label: status, cls: "bg-muted text-muted-foreground border-border/60", dot: "bg-muted-foreground" };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${s.cls}`} title={title}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}

const SimpleMarkdown = ({ text }: { text: string }) => {
  if (!text) return null;
  const lines = text.split("\n");
  return (
    <>
      {lines.map((line, i) => {
        const parts = line.split(/(\*\*.*?\*\*)/g);
        return (
          <span key={i}>
            {parts.map((part, j) => {
              if (part.startsWith("**") && part.endsWith("**")) {
                return <strong key={j} className="font-semibold text-foreground">{part.slice(2, -2)}</strong>;
              }
              return part;
            })}
            {i < lines.length - 1 && <br />}
          </span>
        );
      })}
    </>
  );
};

const Controls = () => {
  const { zoomIn, zoomOut, resetTransform } = useControls();
  return (
    <div className="absolute bottom-4 right-4 z-50 flex items-center gap-1.5 bg-card/95 backdrop-blur-md p-1.5 rounded-xl border border-border/60 shadow-lg">
      <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg hover:bg-muted" onClick={() => zoomIn()}>
        <ZoomIn className="h-4 w-4" />
      </Button>
      <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg hover:bg-muted" onClick={() => zoomOut()}>
        <ZoomOut className="h-4 w-4" />
      </Button>
      <div className="w-px h-4 bg-border/60 mx-1" />
      <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg hover:bg-muted" onClick={() => resetTransform()}>
        <Maximize className="h-4 w-4" />
      </Button>
    </div>
  );
};

export default function DocumentDetails() {
  const [, params] = useRoute("/app/batches/:batchId/documents/:documentId");
  const batchId = params?.batchId ? parseInt(params.batchId, 10) : 0;
  const documentId = params?.documentId ? parseInt(params.documentId, 10) : 0;
  usePageTitle(`Document #${documentId} · BrainHalf`, { noindex: true });
  
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  const [imageError, setImageError] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [threshold, setThreshold] = useState(0.8);

  useEffect(() => { getConfidenceThreshold().then(setThreshold).catch(() => {}); }, []);

  const { data: batch, isLoading } = useGetBatch(batchId, { query: { enabled: !!batchId, queryKey: getGetBatchQueryKey(batchId) } });

  const updateField = useUpdateDocumentField();
  const [editingField, setEditingField] = useState<string | null>(null);
  const [hoveredField, setHoveredField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const doc = batch?.documents.find(d => d.id === documentId);
  const isDuplicate = doc?.isDuplicate ?? false;
  const { data: docDetail } = useGetDocument(batchId, documentId);
  const ocrText = docDetail?.ocrText;
  const mathWarnings: MathWarning[] = useMemo(() => (doc?.extractedFields ? validateFieldMath(doc.extractedFields) : []), [doc?.extractedFields]);

  const handleSaveEdit = async (normalizedField: string) => {
    if (!doc) return;
    setIsSaving(true);
    try {
      await updateField.mutateAsync({
        batchId, documentId: doc.id, data: { normalizedField, editedValue: editValue || null }
      });
      await queryClient.invalidateQueries({ queryKey: getGetBatchQueryKey(batchId) });
      toast({ title: "Field updated successfully" });
      setEditingField(null);
    } catch (e: any) { toast({ title: "Update failed", description: e.message, variant: "destructive" }); }
    finally { setIsSaving(false); }
  };

  if (isLoading) return <ListSkeleton rows={3} />;
  if (!doc) {
    return (
      <EmptyState
        icon={FileQuestion}
        title="Document not found"
        body="It may have been deleted, or the link is broken."
        action={<Button asChild className="h-9 rounded-lg px-6 text-[13px]"><Link href={`/app/batches/${batchId}`}>Back to batch</Link></Button>}
      />
    );
  }

  const isImage = doc.contentType.startsWith("image/");
  const fileUrl = storageUrl(doc.objectPath);

  return (
    <div className="flex flex-col gap-6 h-[calc(100vh-8rem)]">
      {/* ── Header ─────────────────────────────────────────── */}
      <div className="flex items-center gap-4 shrink-0">
        <Button variant="ghost" size="icon" asChild className="rounded-lg h-10 w-10 border border-border/60 bg-card hover:bg-muted/80 transition-colors shrink-0">
          <Link href={`/app/batches/${batchId}`}><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <div className="flex flex-col">
          <h1 className="text-2xl font-bold tracking-tight text-foreground truncate max-w-xl" title={doc.filename}>{doc.filename}</h1>
          <div className="flex items-center gap-3 mt-1.5">
            <StatusChip status={doc.status} />
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{doc.contentType}</span>
            {doc.overallConfidence !== undefined && (
              <div className="flex items-center gap-2 px-2 py-0.5 rounded-full bg-card border border-border/60">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Score</span>
                <ConfidenceIndicator value={doc.overallConfidence} threshold={threshold} />
              </div>
            )}
          </div>
        </div>
      </div>

      {isDuplicate && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-warning/30 bg-warning/5 text-warning shrink-0">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <div className="space-y-0.5">
            <p className="text-[13px] font-semibold text-foreground">You've uploaded this file before</p>
            <p className="text-[12px] text-muted-foreground">It is byte-for-byte identical to another document in your account.</p>
          </div>
        </div>
      )}

      {doc.status === "failed" && (() => {
        const human = humanizeExtractionError(doc.error);
        return (
          <div className="flex shrink-0 items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-destructive">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <div className="space-y-0.5">
              <p className="text-[13px] font-semibold text-foreground">{human.title}</p>
              <p className="text-[12px] text-muted-foreground">{human.body}</p>
            </div>
          </div>
        );
      })()}

      <div className="flex flex-col lg:flex-row gap-6 min-h-0 flex-1">
        {/* LEFT: Preview */}
        <div className="flex-1 flex flex-col min-h-0 border border-border/60 rounded-2xl overflow-hidden bg-muted/20 shadow-sm relative">
          <div className="p-3 border-b border-border/60 bg-card/80 backdrop-blur-sm flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2.5 font-semibold text-[13px] text-foreground">
              <div className="flex items-center justify-center h-6 w-6 bg-primary/10 rounded-md text-primary">
                {isImage ? <FileImage className="h-3.5 w-3.5" /> : <FileType className="h-3.5 w-3.5" />}
              </div>
              Source Document
            </div>
            <Button asChild variant="outline" size="sm" className="h-7 rounded-lg px-3 text-[11px] font-medium border-border/60">
              <a href={fileUrl} target="_blank" rel="noopener noreferrer">Open Original</a>
            </Button>
          </div>
          <div className="flex-1 overflow-auto flex items-center justify-center p-4 relative min-h-[300px]">
            {isImage ? (
              <>
                {!imageLoaded && !imageError && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-muted/10 animate-pulse text-muted-foreground">
                    <Loader2 className="h-6 w-6 animate-spin mb-3 opacity-50" />
                    <span className="text-[12px] font-medium">Fetching original...</span>
                  </div>
                )}
                {imageError ? (
                  <div className="flex flex-col items-center justify-center text-muted-foreground p-8 border border-dashed border-border/40 rounded-xl bg-muted/10">
                    <AlertTriangle className="h-8 w-8 mb-3 text-destructive/50" />
                    <p className="text-[13px] font-semibold text-foreground">Can't load preview</p>
                    <p className="text-[12px] mt-1 text-center text-muted-foreground">Open the original to see it.</p>
                  </div>
                ) : (
                  <TransformWrapper initialScale={1} minScale={0.5} maxScale={4} centerOnInit limitToBounds={false}>
                    <div className={`relative w-full h-full bg-background rounded-xl overflow-hidden flex items-center justify-center transition-opacity duration-500 ${imageLoaded ? "opacity-100" : "opacity-0"}`}>
                      <TransformComponent wrapperClass="w-full h-full !flex items-center justify-center" contentClass="w-full h-full !flex items-center justify-center relative">
                        <img src={fileUrl} alt={doc.filename} onLoad={() => setImageLoaded(true)} onError={() => setImageError(true)} className="w-auto h-auto max-w-full max-h-[800px] object-contain shadow-sm border border-border/60" />
                      </TransformComponent>
                      <Controls />
                    </div>
                  </TransformWrapper>
                )}
              </>
            ) : (
              <div className="flex flex-col items-center justify-center text-muted-foreground p-8 border border-dashed border-border/40 rounded-xl bg-muted/10 w-full h-full">
                <FileText className="h-10 w-10 mb-3 text-muted-foreground/30" />
                <p className="text-[13px] font-semibold text-foreground">PDF preview not supported</p>
                <p className="text-[12px] mt-1 text-muted-foreground">Native PDF rendering requires external viewers.</p>
              </div>
            )}
          </div>
        </div>

        {/* RIGHT: Data */}
        <div className="w-full lg:w-[460px] flex flex-col min-h-0 shrink-0">
          <Tabs defaultValue="fields" className="flex flex-col h-full">
            <TabsList className="grid w-full grid-cols-2 shrink-0 p-1 bg-muted/50 rounded-xl h-10 border border-border/40">
              <TabsTrigger value="fields" className="rounded-lg text-[13px] font-medium py-1.5 data-[state=active]:shadow-sm">Fields</TabsTrigger>
              <TabsTrigger value="raw" className="rounded-lg text-[13px] font-medium py-1.5 data-[state=active]:shadow-sm">Raw Text</TabsTrigger>
            </TabsList>
            
            <TabsContent value="fields" className="flex-1 mt-4 outline-none min-h-0 flex flex-col">
              {mathWarnings.length > 0 && (
                <div className="mb-4 space-y-2">
                  {mathWarnings.map((w, i) => (
                    <div key={i} className="flex items-start gap-2 px-3 py-2 rounded-xl border border-warning/30 bg-warning/5 text-warning">
                      <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                      <div>
                        <p className="text-[12px] font-semibold">Math mismatch</p>
                        <p className="text-[11px] mt-0.5 text-warning/80">{w.message}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <Card className="flex-1 flex flex-col shadow-sm border-border/60 rounded-2xl overflow-hidden min-h-0">
                <CardHeader className="py-3 px-4 border-b border-border/60 shrink-0 bg-muted/20">
                  <CardTitle className="text-[13px] font-semibold flex items-center justify-between text-foreground">
                    <span>Structured Data</span>
                    <span className="text-[10px] text-muted-foreground bg-background px-2 py-0.5 rounded-md border">{doc.extractedFields?.length || 0} fields</span>
                  </CardTitle>
                </CardHeader>
                <ScrollArea className="flex-1">
                  <CardContent className="p-0 divide-y divide-border/40">
                    {!doc.extractedFields?.length ? (
                      <div className="p-10 text-center text-muted-foreground flex flex-col items-center">
                        <AlertCircle className="h-8 w-8 mb-2 opacity-30" />
                        <p className="text-[13px] font-semibold text-foreground">No fields extracted</p>
                      </div>
                    ) : (
                      doc.extractedFields.map((field, idx) => {
                        const isEditing = editingField === field.normalizedField;
                        const isHovered = hoveredField === field.normalizedField;
                        const hasCorrection = field.editedValue !== null;
                        const displayValue = hasCorrection ? field.editedValue : field.value;
                        
                        return (
                          <div 
                            key={idx} 
                            className={`p-4 transition-colors group cursor-pointer border-l-[3px] ${isHovered || isEditing ? 'bg-primary/5 border-primary' : 'bg-transparent border-transparent hover:bg-muted/30'}`}
                            onMouseEnter={() => setHoveredField(field.normalizedField)}
                            onMouseLeave={() => setHoveredField(null)}
                            onClick={() => {
                              if (!isEditing) {
                                setEditingField(field.normalizedField);
                                setEditValue(displayValue === "—" || !displayValue ? "" : displayValue);
                              }
                            }}
                          >
                            <div className="flex justify-between items-start mb-1.5">
                              <div className="flex items-center gap-2">
                                <span className={`text-[11px] font-semibold uppercase tracking-wide transition-colors ${isHovered || isEditing ? 'text-primary' : 'text-muted-foreground'}`}>
                                  {humanizeFieldLabel(field.normalizedField)}
                                </span>
                                {hasCorrection && <Badge variant="outline" className="text-[10px] font-semibold h-4 px-1.5 bg-success/10 text-success border-success/20">Edited</Badge>}
                              </div>
                              <ConfidenceIndicator value={field.confidence} threshold={threshold} />
                            </div>
                            
                            <div className="flex justify-between items-center gap-3">
                              {isEditing ? (
                                <div className="flex w-full flex-col gap-2">
                                  <AutoResizingTextarea 
                                    value={editValue} 
                                    onChange={(e) => setEditValue(e.target.value)}
                                    minRows={2} maxRows={8}
                                    className="text-[13px] p-2 bg-background border-primary ring-2 ring-primary/20 rounded-lg"
                                    autoFocus disabled={isSaving}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSaveEdit(field.normalizedField); }
                                      if (e.key === 'Escape') setEditingField(null);
                                    }}
                                  />
                                  <div className="flex items-center justify-end gap-1.5">
                                    <Button size="sm" variant="ghost" className="h-7 text-[12px] text-muted-foreground hover:bg-muted rounded-md px-2.5" onClick={() => setEditingField(null)} disabled={isSaving}>Cancel</Button>
                                    <Button size="sm" className="h-7 text-[12px] bg-primary hover:bg-primary/90 text-primary-foreground rounded-md px-2.5" onClick={() => handleSaveEdit(field.normalizedField)} disabled={isSaving}>Save</Button>
                                  </div>
                                </div>
                              ) : (
                                <>
                                  <div className={`text-[13px] break-words whitespace-pre-wrap ${hasCorrection ? 'text-success font-medium' : 'text-foreground'}`}>
                                    {displayValue === "—" ? <span className="text-muted-foreground/40">—</span> : <SimpleMarkdown text={displayValue as string} />}
                                  </div>
                                  <Button size="icon" variant="ghost" className={`h-7 w-7 transition-opacity shrink-0 rounded-md hover:bg-muted text-muted-foreground ${isHovered ? 'opacity-100' : 'opacity-0'}`} onClick={(e) => {
                                    e.stopPropagation(); setEditingField(field.normalizedField); setEditValue(displayValue === "—" || !displayValue ? "" : displayValue);
                                  }}>
                                    <Edit2 className="h-3.5 w-3.5" />
                                  </Button>
                                </>
                              )}
                            </div>
                            <div className="mt-1">
                              <span className="text-[10px] text-muted-foreground/60 block truncate" title={field.originalLabel}>Found as: {field.originalLabel}</span>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </CardContent>
                </ScrollArea>
              </Card>
            </TabsContent>
            
            <TabsContent value="raw" className="flex-1 mt-4 outline-none min-h-0">
              <Card className="h-full flex flex-col shadow-sm border-border/60 rounded-2xl overflow-hidden min-h-0">
                <CardHeader className="py-3 px-4 border-b border-border/60 shrink-0 bg-muted/20">
                  <CardTitle className="text-[13px] font-semibold text-foreground">Raw Text</CardTitle>
                </CardHeader>
                <ScrollArea className="flex-1">
                  <CardContent className="p-4">
                    {ocrText ? (
                      <pre className="text-[12px] font-mono whitespace-pre-wrap text-muted-foreground leading-relaxed">{ocrText}</pre>
                    ) : (
                      <div className="text-center text-[13px] text-muted-foreground py-10">No text extracted.</div>
                    )}
                  </CardContent>
                </ScrollArea>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
