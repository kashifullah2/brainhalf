import { useState, useEffect } from "react";
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
import { StatusDot } from "@/components/StatusDot";
import { ConfidenceIndicator } from "@/components/ConfidenceIndicator";
import { useToast } from "@/hooks/use-toast";
import { humanizeFieldLabel } from "@/lib/humanizeField";
import { getConfidenceThreshold } from "@/lib/review-queue-store";
import { usePageTitle } from "@/lib/use-page-title";
import {
  ArrowLeft, FileText, FileImage, FileType,
  Edit2, Check, X, AlertCircle, AlertTriangle, Loader2,
  ZoomIn, ZoomOut, Maximize
} from "lucide-react";
import { TransformWrapper, TransformComponent, useControls } from "react-zoom-pan-pinch";

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
                return <strong key={j} className="font-bold">{part.slice(2, -2)}</strong>;
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
    <div className="absolute bottom-4 right-4 z-50 flex items-center gap-1.5 bg-card/90 backdrop-blur-md p-1.5 rounded-full border border-border/60 shadow-lg">
      <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full hover:bg-muted" onClick={() => zoomIn()}>
        <ZoomIn className="h-4 w-4" />
      </Button>
      <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full hover:bg-muted" onClick={() => zoomOut()}>
        <ZoomOut className="h-4 w-4" />
      </Button>
      <div className="w-px h-4 bg-border/60 mx-1" />
      <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full hover:bg-muted" onClick={() => resetTransform()}>
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
  // Confidence bands come from the shared review-queue threshold so this
  // page and the queue always color the same field identically.
  const [threshold, setThreshold] = useState(0.8);

  useEffect(() => {
    getConfidenceThreshold()
      .then(setThreshold)
      .catch(() => {
        /* keep the default */
      });
  }, []);

  const { data: batch, isLoading } = useGetBatch(batchId, {
    query: {
      enabled: !!batchId,
      queryKey: getGetBatchQueryKey(batchId),
    }
  });

  const updateField = useUpdateDocumentField();
  const [editingField, setEditingField] = useState<string | null>(null);
  const [hoveredField, setHoveredField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const doc = batch?.documents.find(d => d.id === documentId);
  const isDuplicate = doc?.isDuplicate ?? false;

  // The batch payload omits ocrText on purpose, so the raw-text panel reads the
  // single document it is showing rather than the whole batch's text.
  const { data: docDetail } = useGetDocument(batchId, documentId);
  const ocrText = docDetail?.ocrText;

  const handleSaveEdit = async (normalizedField: string) => {
    if (!doc) return;
    setIsSaving(true);
    try {
      await updateField.mutateAsync({
        batchId,
        documentId: doc.id,
        data: { normalizedField, editedValue: editValue || null }
      });
      // Invalidate and refetch the full batch so isDuplicate is recomputed
      // for every document — editing a key field can change duplicate status
      // on both the edited document and any counterpart in the batch.
      await queryClient.invalidateQueries({ queryKey: getGetBatchQueryKey(batchId) });
      toast({ title: "Field updated successfully" });
      setEditingField(null);
    } catch (e: any) {
      toast({ title: "Update failed", description: e.message, variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center py-32">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!doc) {
    return (
      <div className="text-center py-20 text-destructive font-bold text-xl">Document not found.</div>
    );
  }

  const isPdf = doc.contentType === "application/pdf" || doc.filename.toLowerCase().endsWith(".pdf");
  const isImage = doc.contentType.startsWith("image/");
  const fileUrl = storageUrl(doc.objectPath);

  return (
    <div className="flex flex-col gap-8 h-[calc(100vh-8rem)]">
        <div className="flex items-center gap-5 shrink-0">
          <Button variant="ghost" size="icon" asChild className="rounded-full h-12 w-12 bg-card shadow-sm border border-border/40 hover:bg-muted/50 hover:text-primary transition-colors shrink-0">
            <Link href={`/app/batches/${batchId}`}>
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div className="flex flex-col">
            <h1 className="text-3xl font-extrabold tracking-tighter text-foreground truncate max-w-2xl" title={doc.filename}>
              {doc.filename}
            </h1>
            <div className="flex items-center gap-4 mt-2">
              <StatusDot status={doc.status} />
              <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">{doc.contentType}</span>
              {doc.overallConfidence !== undefined && (
                <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-card border border-border/60 shadow-sm">
                  <span className="text-[11px] font-extrabold uppercase tracking-widest text-muted-foreground">Document Score:</span>
                  <ConfidenceIndicator value={doc.overallConfidence} threshold={threshold} />
                </div>
              )}
            </div>
          </div>
        </div>

        {isDuplicate && (
          <div className="flex items-center gap-3 px-5 py-3.5 rounded-2xl border border-warning/40 bg-warning/8 text-warning shrink-0">
            <AlertTriangle className="h-5 w-5 shrink-0 text-warning" />
            <div>
              <p className="text-sm font-extrabold uppercase tracking-wide">Possible Duplicate</p>
              <p className="text-xs font-medium text-warning/80 dark:text-warning/70 mt-0.5">
                Another document with the same invoice number, vendor, and total already exists in your account.
              </p>
            </div>
          </div>
        )}

        {/* Surface the stored extraction error; a failed document would
            otherwise render as an empty field list with no explanation. */}
        {doc.status === "failed" && doc.error && (
          <div className="flex items-center gap-3 px-5 py-3.5 rounded-2xl border border-destructive/40 bg-destructive/5 text-destructive shrink-0">
            <AlertCircle className="h-5 w-5 shrink-0" />
            <div>
              <p className="text-sm font-extrabold uppercase tracking-wide">Extraction failed</p>
              <p className="text-xs font-medium mt-0.5 opacity-80">
                {doc.error}
              </p>
            </div>
          </div>
        )}

        <div className="flex flex-col lg:flex-row gap-8 min-h-0 flex-1">
          {/* LEFT: Document Preview */}
          <div className="flex-1 flex flex-col min-h-0 border border-border/60 rounded-3xl overflow-hidden bg-muted/20 shadow-sm relative">
            <div className="p-4 border-b border-border/60 bg-card/80 backdrop-blur-sm flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3 font-bold text-sm text-foreground">
                <div className="p-1.5 bg-primary/10 rounded-lg text-primary">
                  {isImage ? <FileImage className="h-5 w-5" /> : <FileType className="h-5 w-5" />}
                </div>
                Source Document
              </div>
              <Button asChild variant="outline" size="sm" className="h-9 rounded-full px-4 shadow-sm font-bold border-border/60 hover:bg-primary/5 hover:text-primary transition-colors uppercase tracking-wide text-[11px]">
                <a href={fileUrl} target="_blank" rel="noopener noreferrer">Open Original</a>
              </Button>
            </div>
            <div className="flex-1 overflow-auto flex items-center justify-center p-6 relative min-h-[300px]">
              {isImage ? (
                <>
                  {!imageLoaded && !imageError && (
                    <div className="absolute inset-0 flex items-center justify-center bg-muted/20 animate-pulse rounded-lg">
                      <div className="flex flex-col items-center text-muted-foreground">
                        <Loader2 className="h-10 w-10 animate-spin mb-4 opacity-50" />
                        <span className="text-sm font-bold tracking-wider uppercase">Loading Preview...</span>
                      </div>
                    </div>
                  )}
                  {imageError ? (
                    <div className="flex flex-col items-center justify-center text-muted-foreground w-full h-full p-8 border-2 border-dashed border-border/40 rounded-lg bg-muted/10">
                      <AlertTriangle className="h-16 w-16 mb-4 text-destructive/60" />
                      <p className="font-bold text-lg text-foreground">Preview unavailable</p>
                      <p className="text-sm font-medium mt-2 max-w-xs text-center text-muted-foreground">
                        The image preview could not be loaded from storage.
                      </p>
                      <Button asChild variant="outline" size="sm" className="mt-6 rounded-full px-6 font-bold shadow-sm uppercase tracking-wider">
                        <a href={fileUrl} target="_blank" rel="noopener noreferrer">Open Original</a>
                      </Button>
                    </div>
                  ) : (
                    <TransformWrapper
                      initialScale={1}
                      minScale={0.5}
                      maxScale={4}
                      centerOnInit
                      limitToBounds={false}
                    >
                      <div className={`relative w-full h-full bg-muted/5 rounded-lg overflow-hidden flex items-center justify-center transition-opacity duration-500 ${imageLoaded ? "opacity-100" : "opacity-0"}`}>
                        <TransformComponent wrapperClass="w-full h-full !flex items-center justify-center" contentClass="w-full h-full !flex items-center justify-center relative">
                          <div className="relative inline-block max-w-full max-h-full shadow-md bg-white">
                            <img 
                              src={fileUrl} 
                              alt={doc.filename} 
                              onLoad={() => setImageLoaded(true)}
                              onError={() => setImageError(true)}
                              className="w-auto h-auto max-w-full max-h-[800px] object-contain block" 
                            />
                            
                            {/* No bounding-box overlay: the engine returns
                                text and confidence scores, not coordinates. */}
                          </div>
                        </TransformComponent>
                        <Controls />
                      </div>
                    </TransformWrapper>
                  )}
                </>
              ) : (
                <div className="flex flex-col items-center justify-center text-muted-foreground w-full h-full border-2 border-dashed border-border/40 rounded-lg bg-muted/10">
                  <FileText className="h-20 w-20 mb-5 text-muted-foreground/40" />
                  <p className="font-bold text-lg text-foreground">PDF Preview not supported</p>
                  <p className="text-sm font-medium mt-2 max-w-xs text-center text-muted-foreground">
                    Native PDF rendering requires external viewers.
                  </p>
                  <Button asChild variant="outline" size="sm" className="mt-6 rounded-full px-6 font-bold shadow-sm uppercase tracking-wider">
                    <a href={fileUrl} target="_blank" rel="noopener noreferrer">Open Original</a>
                  </Button>
                </div>
              )}
            </div>
          </div>

          {/* RIGHT: Extracted Data */}
          <div className="w-full lg:w-[480px] flex flex-col min-h-0 shrink-0">
            <Tabs defaultValue="fields" className="flex flex-col h-full">
              <TabsList className="grid w-full grid-cols-2 shrink-0 p-1.5 bg-muted/50 rounded-2xl">
                <TabsTrigger value="fields" className="rounded-xl font-bold py-2 data-[state=active]:shadow-sm">Extracted Fields</TabsTrigger>
                <TabsTrigger value="raw" className="rounded-xl font-bold py-2 data-[state=active]:shadow-sm">Raw Text</TabsTrigger>
              </TabsList>
              
              <TabsContent value="fields" className="flex-1 mt-6 outline-none min-h-0">
                <Card className="h-full flex flex-col shadow-sm border-border/60 rounded-3xl overflow-hidden">
                  <CardHeader className="py-5 border-b border-border/60 shrink-0 bg-muted/20">
                    <CardTitle className="text-base font-extrabold flex items-center justify-between text-foreground">
                      <span>Structured Data</span>
                      <span className="text-xs font-bold text-muted-foreground bg-background px-2.5 py-1 rounded-full border shadow-sm uppercase tracking-widest">
                        {doc.extractedFields?.length || 0} fields
                      </span>
                    </CardTitle>
                  </CardHeader>
                  <ScrollArea className="flex-1 h-full">
                    <CardContent className="p-0 divide-y divide-border/40">
                      {doc.extractedFields?.length === 0 ? (
                        <div className="p-12 text-center text-muted-foreground flex flex-col items-center">
                          <AlertCircle className="h-10 w-10 mb-3 opacity-30" />
                          <p className="font-bold text-lg">No fields extracted.</p>
                        </div>
                      ) : (
                        doc.extractedFields?.map((field, idx) => {
                          const isEditing = editingField === field.normalizedField;
                          const isHovered = hoveredField === field.normalizedField;
                          const hasCorrection = field.editedValue !== null;
                          const displayValue = hasCorrection ? field.editedValue : field.value;
                          
                          return (
                            <div 
                              id={`field-${field.normalizedField}`}
                              key={idx} 
                              className={`p-5 transition-colors group cursor-pointer border-l-2 ${isHovered || isEditing ? 'bg-primary/5 border-primary' : 'bg-transparent border-transparent hover:bg-muted/30'}`}
                              onMouseEnter={() => setHoveredField(field.normalizedField)}
                              onMouseLeave={() => setHoveredField(null)}
                              onClick={() => {
                                if (!isEditing) {
                                  setEditingField(field.normalizedField);
                                  setEditValue(displayValue === "—" || !displayValue ? "" : displayValue);
                                }
                              }}
                            >
                              <div className="flex justify-between items-start mb-2">
                                <div className="flex items-center gap-2">
                                  <span className={`text-[11px] font-extrabold tracking-widest uppercase transition-colors ${isHovered || isEditing ? 'text-primary' : 'text-muted-foreground'}`}>
                                    {humanizeFieldLabel(field.normalizedField)}
                                  </span>
                                  {hasCorrection && (
                                    <Badge variant="outline" className="text-[11px] uppercase tracking-widest font-extrabold h-5 px-1.5 bg-success/10 text-success border-transparent shadow-none">
                                      Edited
                                    </Badge>
                                  )}
                                </div>
                                <ConfidenceIndicator value={field.confidence} threshold={threshold} />
                              </div>
                              
                              <div className="flex justify-between items-center gap-3">
                               {isEditing ? (
                                  <div className="flex w-full flex-col gap-2">
                                    <AutoResizingTextarea 
                                      value={editValue} 
                                      onChange={(e) => setEditValue(e.target.value)}
                                      minRows={2}
                                      maxRows={10}
                                      className="font-mono text-sm font-semibold shadow-sm border-primary ring-2 ring-primary/20"
                                      autoFocus
                                      disabled={isSaving}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter' && !e.shiftKey) {
                                          e.preventDefault();
                                          handleSaveEdit(field.normalizedField);
                                        }
                                        if (e.key === 'Escape') setEditingField(null);
                                      }}
                                    />
                                    <div className="flex items-center justify-end gap-2">
                                      <Button 
                                        size="sm" 
                                        variant="ghost" 
                                        className="h-8 text-xs font-bold text-success bg-success/10 hover:text-success hover:bg-success/20 rounded-lg px-3"
                                        onClick={() => handleSaveEdit(field.normalizedField)}
                                        disabled={isSaving}
                                      >
                                        <Check className="h-4 w-4 mr-1" /> Save
                                      </Button>
                                      <Button 
                                        size="sm" 
                                        variant="ghost" 
                                        className="h-8 text-xs font-bold text-muted-foreground bg-muted hover:bg-muted/80 rounded-lg px-3"
                                        onClick={() => setEditingField(null)}
                                        disabled={isSaving}
                                      >
                                        <X className="h-4 w-4 mr-1" /> Cancel
                                      </Button>
                                    </div>
                                  </div>
                                ) : (
                                  <>
                                    <div className={`font-mono text-base break-words whitespace-pre-wrap ${hasCorrection ? 'text-success font-bold' : 'text-foreground font-semibold'}`}>
                                      {displayValue === "—" ? (
                                        <span className="text-muted-foreground/40">—</span>
                                      ) : (
                                        <SimpleMarkdown text={displayValue as string} />
                                      )}
                                    </div>
                                    <Button 
                                      size="icon" 
                                      variant="ghost" 
                                      className={`h-9 w-9 transition-opacity shrink-0 rounded-full hover:bg-primary/10 hover:text-primary text-muted-foreground ${isHovered ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setEditingField(field.normalizedField);
                                        setEditValue(displayValue === "—" || !displayValue ? "" : displayValue);
                                      }}
                                    >
                                      <Edit2 className="h-4 w-4" />
                                    </Button>
                                  </>
                                )}
                              </div>
                              
                              <div className="mt-2">
                                <span className="text-[11px] font-bold tracking-wide uppercase text-muted-foreground/50 block truncate" title={`Found as: "${field.originalLabel}"`}>
                                  Found as: "{field.originalLabel}"
                                </span>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </CardContent>
                  </ScrollArea>
                </Card>
              </TabsContent>
              
              <TabsContent value="raw" className="flex-1 mt-6 outline-none min-h-0">
                <Card className="h-full flex flex-col shadow-sm border-border/60 rounded-3xl overflow-hidden">
                  <CardHeader className="py-5 border-b border-border/60 shrink-0 bg-muted/20">
                    <CardTitle className="text-base font-extrabold text-foreground">Raw Text</CardTitle>
                  </CardHeader>
                  <ScrollArea className="flex-1 h-full">
                    <CardContent className="p-6">
                      {ocrText ? (
                        <pre className="text-sm font-mono whitespace-pre-wrap text-muted-foreground leading-relaxed font-medium">
                          {ocrText}
                        </pre>
                      ) : (
                        <div className="text-center font-bold text-muted-foreground py-12">
                          No text extracted.
                        </div>
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
