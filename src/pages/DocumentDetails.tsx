import { useState, useEffect, useMemo } from "react";
import { useRoute, Link } from "wouter";
import {
  useGetBatch,
  getGetBatchQueryKey,
  useGetDocument,
  useRetryDocument,
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
import { BackLink, EmptyState, ErrorState, ListSkeleton, PageHeader } from "@/components/app";
import { StatusBadge } from "@/components/StatusBadge";
import { ConfidenceIndicator } from "@/components/ConfidenceIndicator";
import { useToast } from "@/hooks/use-toast";
import { humanizeFieldLabel } from "@/lib/humanize-field";
import { humanizeExtractionError } from "@/lib/humanize-error";
import { useConfidenceThreshold } from "@/hooks/use-confidence-threshold";
import { usePageTitle } from "@/lib/use-page-title";
import { validateFieldMath, type MathWarning } from "@/lib/confidence-scorer";
import { Copy, FileText, FileImage, FileType, FileQuestion,
  Edit2, AlertCircle, AlertTriangle, Loader2, RotateCcw,
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
  const threshold = useConfidenceThreshold();


  const { data: batch, isLoading, error, refetch } = useGetBatch(batchId, {
    query: { enabled: !!batchId },
  });

  const updateField = useUpdateDocumentField();
  const [editingField, setEditingField] = useState<string | null>(null);
  const [hoveredField, setHoveredField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  // FIX: reset view/edit state when navigating document → document (wouter
  // keeps this component mounted, so the old doc's "loaded" image state and
  // stuck editor used to leak through)
  useEffect(() => {
    setImageError(false);
    setImageLoaded(false);
    setEditingField(null);
    setHoveredField(null);
    setEditValue("");
  }, [batchId, documentId]);

  const doc = batch?.documents?.find((d: any) => d.id === documentId);
  const isDuplicate = doc?.isDuplicate ?? false;

  /**
   * Re-runs extraction for this document.
   *
   * The bytes come back out of storage rather than from the browser's memory, so
   * this works on a document whose upload happened in a session that is long
   * gone -- which is every failed document a user comes back to.
   */
  const retry = useRetryDocument();
  const handleRetry = async () => {
    if (!doc || !batch) return;
    try {
      await retry.mutateAsync({
        batchId,
        documentId,
        filename: doc.filename,
        contentType: doc.contentType,
        mode: batch.engineType || "invoice",
        customPrompt: batch.prompt,
      });
      toast({
        title: "Extraction finished",
        description: "The document was read again — check the fields below.",
      });
    } catch (err) {
      toast({
        title: "Retry failed",
        description:
          err instanceof Error ? err.message : "Could not read the document again.",
        variant: "destructive",
      });
    }
  };

  // FIX: don't fetch with documentId=0 on first render (route params aren't
  // parsed yet) — was firing a doomed request every mount
  const { data: docDetail } = useGetDocument(batchId, documentId, {
    query: { enabled: !!batchId && !!documentId },
  });
  const ocrText = docDetail?.ocrText;

  const mathWarnings: MathWarning[] = useMemo(
    () => (doc?.extractedFields ? validateFieldMath(doc.extractedFields) : []),
    [doc?.extractedFields],
  );

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
    } catch (e: any) {
      toast({ title: "Update failed", description: e.message, variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  // FIX: audit asked for per-field copy — raw text was copy-hostile before
  const handleCopyOcr = async () => {
    try {
      await navigator.clipboard.writeText(ocrText ?? "");
      toast({ title: "Raw text copied" });
    } catch {
      toast({ title: "Copy failed", description: "Your browser blocked clipboard access.", variant: "destructive" });
    }
  };

  // FIX: Escape shouldn't yank the editor away mid-save
  const tryCancelEdit = () => { if (!isSaving) setEditingField(null); };

  if (isLoading) return <ListSkeleton rows={3} />;
  if (error) {
    return (
      <ErrorState
        title="Could not load this document"
        body="Nothing has been changed. Try again in a moment."
        onRetry={() => void refetch()}
      />
    );
  }
  if (!doc) {
    return (
      <EmptyState
        icon={FileQuestion}
        title="Document not found"
        body="It may have been deleted, or the link is broken."
        action={
          <Button asChild>
            <Link href={`/app/batches/${batchId}`}>Back to batch</Link>
          </Button>
        }
      />
    );
  }

  const isImage = doc.contentType?.startsWith("image/") ?? false; // FIX: could crash on missing contentType
  // FIX: failed docs can have no stored file — storageUrl(null) used to throw
  const fileUrl: string | null = doc.objectPath ? storageUrl(doc.objectPath) : null;

  return (
    <div className="flex flex-col gap-6 h-[calc(100vh-8rem)]">
      {/* ── Header ─────────────────────────────────────────── */}
      <div className="shrink-0">
        <PageHeader
          className="mb-0"
          size="detail"
          back={<BackLink href={`/app/batches/${batchId}`} label="Back to batch" />}
          title={doc.filename}
          titleClassName="truncate"
          titleAdornment={<StatusBadge status={doc.status} />}
          description={
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <span className="font-data text-body-sm font-medium">{doc.contentType}</span>
              {doc.overallConfidence !== undefined && (
                <span className="flex items-center gap-2 rounded-full border border-border/60 bg-card px-2 py-0.5">
                  <span className="text-caption font-semibold text-muted-foreground">Score</span>
                  <ConfidenceIndicator value={doc.overallConfidence} threshold={threshold} />
                </span>
              )}
            </span>
          }
        />
      </div>

      {isDuplicate && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-warning/30 bg-warning/5 text-warning shrink-0">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <div className="space-y-0.5">
            <p className="text-body-sm font-semibold text-foreground">You've uploaded this file before</p>
            <p className="text-label text-muted-foreground">It is byte-for-byte identical to another document in your account.</p>
          </div>
        </div>
      )}

      {doc.status === "failed" && (() => {
        const human = humanizeExtractionError(doc.error);
        return (
          <div className="flex shrink-0 flex-wrap items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-destructive">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <div className="min-w-0 flex-1 space-y-0.5">
              <p className="text-body-sm font-semibold text-foreground">{human.title}</p>
              <p className="text-label text-muted-foreground">{human.body}</p>
            </div>
            {/* There was no way to retry anything, anywhere in the product: a
                document that failed once stayed failed, and deleting it and
                uploading it again was the only route forward. */}
            <Button
              variant="outline"
              size="sm"
              onClick={handleRetry}
              disabled={retry.isPending}
              className="h-8 shrink-0 gap-1.5 rounded-lg border-destructive/40 bg-card px-3 text-label font-semibold text-foreground"
            >
              {retry.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RotateCcw className="h-3.5 w-3.5" />
              )}
              {retry.isPending ? "Reading again…" : "Retry extraction"}
            </Button>
          </div>
        );
      })()}

      <div className="flex flex-col lg:flex-row gap-6 min-h-0 flex-1">
        {/* LEFT: Preview */}
        <div className="flex-1 flex flex-col min-h-0 border border-border rounded-xl overflow-hidden bg-muted/20 shadow-sm relative">
          <div className="p-3 border-b border-border/60 bg-card/80 backdrop-blur-sm flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2.5 font-semibold text-body-sm text-foreground">
              <div className="flex items-center justify-center h-6 w-6 bg-primary/10 rounded-md text-primary">
                {isImage ? <FileImage className="h-3.5 w-3.5" /> : <FileType className="h-3.5 w-3.5" />}
              </div>
              Source Document
            </div>
            {/* FIX: no more dead download link for docs without a stored file */}
            {fileUrl ? (
              <Button asChild variant="outline" size="sm" className="h-7 rounded-lg px-3 text-caption font-medium border-border/60">
                <a href={fileUrl} target="_blank" rel="noopener noreferrer">Open Original</a>
              </Button>
            ) : (
              <span className="text-caption text-muted-foreground">No file stored</span>
            )}
          </div>
          <div className="flex-1 overflow-auto flex items-center justify-center p-4 relative min-h-[300px]">
            {isImage ? (
              <>
                {!imageLoaded && !imageError && fileUrl && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-muted/10 animate-pulse text-muted-foreground">
                    <Loader2 className="h-6 w-6 animate-spin mb-3 opacity-50" />
                    <span className="text-label font-medium">Fetching original...</span>
                  </div>
                )}
                {!fileUrl || imageError ? (
                  <div className="flex flex-col items-center justify-center text-muted-foreground p-8 border border-dashed border-border/40 rounded-xl bg-muted/10">
                    <AlertTriangle className="h-8 w-8 mb-3 text-destructive/50" />
                    <p className="text-body-sm font-semibold text-foreground">Can't load preview</p>
                    <p className="text-label mt-1 text-center text-muted-foreground">
                      {fileUrl ? "Open the original to see it." : "This document has no stored file."}
                    </p>
                  </div>
                ) : (
                  <TransformWrapper initialScale={1} minScale={0.5} maxScale={4} centerOnInit limitToBounds={false}>
                    <div className={`relative w-full h-full bg-background rounded-xl overflow-hidden flex items-center justify-center transition-opacity duration-500 ${imageLoaded ? "opacity-100" : "opacity-0"}`}>
                      <TransformComponent wrapperClass="w-full h-full !flex items-center justify-center" contentClass="w-full h-full !flex items-center justify-center relative">
                        <img
                          src={fileUrl}
                          alt={doc.filename}
                          onLoad={() => setImageLoaded(true)}
                          onError={() => setImageError(true)}
                          className="w-auto h-auto max-w-full max-h-[800px] object-contain shadow-sm border border-border/60"
                        />
                      </TransformComponent>
                      <Controls />
                    </div>
                  </TransformWrapper>
                )}
              </>
            ) : fileUrl ? (
              /* PDFs used to say "PDF preview not supported — native PDF rendering
                 requires external viewers", which is not true: every current
                 browser renders a PDF itself. Two things were actually in the way.
                 The page CSP set `frame-src https://accounts.google.com` with no
                 'self', so the browser refused the frame; and nothing here ever
                 tried. Both are fixed — see public/_headers.

                 The stored object is served with `default-src 'none'; sandbox`
                 (functions/api/storage), so it cannot run anything in our origin,
                 and the sandbox attribute here says the same from this side. "Open
                 Original" stays in the header above regardless, so there is a
                 working route to the file even if a browser declines to render it
                 inline. */
              <iframe
                src={fileUrl}
                title={`PDF preview of ${doc.filename}`}
                sandbox=""
                className="h-full w-full rounded-lg border border-border/60 bg-background"
              />
            ) : (
              <div className="flex flex-col items-center justify-center text-muted-foreground p-8 border border-dashed border-border/40 rounded-xl bg-muted/10 w-full h-full">
                <FileText className="h-10 w-10 mb-3 text-muted-foreground/30" />
                <p className="text-body-sm font-semibold text-foreground">No file stored</p>
                <p className="text-label mt-1 text-muted-foreground">
                  This document has no stored source file, so there is nothing to preview.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* RIGHT: Data */}
        <div className="w-full lg:w-[460px] flex flex-col min-h-0 shrink-0">
          <Tabs defaultValue="fields" className="flex flex-col h-full">
            <TabsList className="grid w-full grid-cols-2 shrink-0 p-1 bg-muted/50 rounded-xl h-10 border border-border/40">
              <TabsTrigger value="fields" className="rounded-lg text-body-sm font-medium py-1.5 data-[state=active]:shadow-sm">Fields</TabsTrigger>
              <TabsTrigger value="raw" className="rounded-lg text-body-sm font-medium py-1.5 data-[state=active]:shadow-sm">Raw Text</TabsTrigger>
            </TabsList>

            <TabsContent value="fields" className="flex-1 mt-4 outline-none min-h-0 flex flex-col">
              {mathWarnings.length > 0 && (
                <div className="mb-4 space-y-2">
                  {mathWarnings.map((w, i) => (
                    <div key={i} className="flex items-start gap-2 px-3 py-2 rounded-xl border border-warning/30 bg-warning/5 text-warning">
                      <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                      <div>
                        <p className="text-label font-semibold">Math mismatch</p>
                        <p className="text-caption mt-0.5 text-warning/80">{w.message}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <Card className="flex-1 flex flex-col shadow-sm border-border rounded-xl overflow-hidden min-h-0">
                <CardHeader className="py-3 px-4 border-b border-border/60 shrink-0 bg-muted/20">
                  <CardTitle className="text-body-sm font-semibold flex items-center justify-between text-foreground">
                    <span>Structured Data</span>
                    <span className="text-micro text-muted-foreground bg-background px-2 py-0.5 rounded-md border">{doc.extractedFields?.length || 0} fields</span>
                  </CardTitle>
                </CardHeader>
                <ScrollArea className="flex-1">
                  <CardContent className="p-0 divide-y divide-border/40">
                    {!doc.extractedFields?.length ? (
                      <div className="p-10 text-center text-muted-foreground flex flex-col items-center">
                        <AlertCircle className="h-8 w-8 mb-2 opacity-30" />
                        <p className="text-body-sm font-semibold text-foreground">No fields extracted</p>
                      </div>
                    ) : (
                      doc.extractedFields.map((field: any, idx: number) => {
                        const isEditing = editingField === field.normalizedField;
                        const isHovered = hoveredField === field.normalizedField;
                        const hasCorrection = field.editedValue !== null;
                        const displayValue = hasCorrection ? field.editedValue : field.value;

                        const openEditor = () => {
                          if (isEditing) return;
                          setEditValue(displayValue == null || displayValue === "" || displayValue === "—" ? "" : String(displayValue));
                          setEditingField(field.normalizedField);
                        };

                        return (
                          <div
                            key={idx}
                            className={`p-4 transition-colors group cursor-pointer border-l-[3px] ${isHovered || isEditing ? 'bg-primary/5 border-primary' : 'bg-transparent border-transparent hover:bg-muted/30'}`}
                            onMouseEnter={() => setHoveredField(field.normalizedField)}
                            onMouseLeave={() => setHoveredField(null)}
                            onClick={openEditor}
                          >
                            <div className="flex justify-between items-start mb-1.5">
                              <div className="flex items-center gap-2">
                                <span className={`text-label font-semibold transition-colors ${isHovered || isEditing ? 'text-primary' : 'text-muted-foreground'}`}>
                                  {humanizeFieldLabel(field.normalizedField)}
                                </span>
                                {hasCorrection && <Badge variant="outline" className="text-micro font-semibold h-4 px-1.5 bg-success/10 text-success border-success/20">Edited</Badge>}
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
                                    className="text-body-sm p-2 bg-background border-primary ring-2 ring-primary/20 rounded-lg"
                                    autoFocus disabled={isSaving}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSaveEdit(field.normalizedField); }
                                      if (e.key === 'Escape') tryCancelEdit();
                                    }}
                                  />
                                  <div className="flex items-center justify-end gap-1.5">
                                    <Button size="sm" variant="ghost" className="h-7 text-label text-muted-foreground hover:bg-muted rounded-md px-2.5" onClick={tryCancelEdit} disabled={isSaving}>Cancel</Button>
                                    <Button size="sm" className="h-7 text-label bg-primary hover:bg-primary/90 text-primary-foreground rounded-md px-2.5" onClick={() => handleSaveEdit(field.normalizedField)} disabled={isSaving}>Save</Button>
                                  </div>
                                </div>
                              ) : (
                                <>
                                  <div className={`text-body-sm break-words whitespace-pre-wrap ${hasCorrection ? 'text-success font-medium' : 'text-foreground'}`}>
                                    {displayValue == null || displayValue === "" ? <span className="text-muted-foreground/40">—</span> : <SimpleMarkdown text={displayValue as string} />}
                                  </div>
                                  <Button
                                    size="icon" variant="ghost"
                                    aria-label={`Edit ${humanizeFieldLabel(field.normalizedField)}`}
                                    className={`h-7 w-7 transition-opacity shrink-0 rounded-md hover:bg-muted text-muted-foreground ${isHovered ? 'opacity-100' : 'opacity-0'}`}
                                    onClick={(e) => { e.stopPropagation(); openEditor(); }}
                                  >
                                    <Edit2 className="h-3.5 w-3.5" />
                                  </Button>
                                </>
                              )}
                            </div>
                            <div className="mt-1">
                              <span className="text-micro text-muted-foreground/60 block truncate" title={field.originalLabel}>Found as: {field.originalLabel}</span>
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
              <Card className="h-full flex flex-col shadow-sm border-border rounded-xl overflow-hidden min-h-0">
                <CardHeader className="py-3 px-4 border-b border-border/60 shrink-0 bg-muted/20 flex flex-row items-center justify-between space-y-0">
                  <CardTitle className="text-body-sm font-semibold text-foreground">Raw Text</CardTitle>
                  {ocrText && (
                    <Button variant="outline" size="sm" className="h-7 rounded-lg px-3 text-caption font-medium border-border/60" onClick={handleCopyOcr}>
                      <Copy className="mr-1.5 h-3 w-3" /> Copy
                    </Button>
                  )}
                </CardHeader>
                <ScrollArea className="flex-1">
                  <CardContent className="p-4">
                    {ocrText ? (
                      <pre className="text-label font-mono whitespace-pre-wrap text-muted-foreground leading-relaxed">{ocrText}</pre>
                    ) : (
                      <div className="text-center text-body-sm text-muted-foreground py-10">No text extracted.</div>
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
