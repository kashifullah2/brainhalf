import { useState, useEffect, useCallback, useRef } from "react";
import { Link, useLocation, useRoute } from "wouter";
import {
  Check,
  X,
  CheckCircle2,
  AlertTriangle,
  FileText,
  Save,
  Sparkles,
  Keyboard,
  ZoomIn,
  ZoomOut,
  Maximize2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useConfidenceThreshold } from "@/hooks/use-confidence-threshold";
import { BackLink, EmptyState, ErrorState, ListSkeleton, PageHeader } from "@/components/app";
import { AutoResizingTextarea } from "@/components/ui/auto-resizing-textarea";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { humanizeFieldLabel } from "@/lib/humanize-field";
import { storageUrl } from "@/lib/api-client";
import {
  getFlaggedDocument,
  saveFieldResolution,
  getFieldResolutions,
  FlaggedDocument
} from "@/lib/review-queue-store";
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";
import { confidenceTone } from "@/components/ConfidenceIndicator";
import { usePageTitle } from "@/lib/use-page-title";
import { useReviewHotkeys } from "@/hooks/use-review-hotkeys";

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-[4px] border border-border/60 bg-muted/60 px-1.5 text-micro font-semibold text-muted-foreground shadow-sm select-none">
      {children}
    </kbd>
  );
}

function HotkeyHintBar() {
  return (
    <div className="flex items-center gap-4 flex-wrap px-4 py-2.5 border-t border-border/40 bg-muted/10 text-muted-foreground shrink-0">
      <div className="flex items-center gap-1.5">
        <Keyboard className="h-3.5 w-3.5 text-primary/60" />
        <span className="text-label font-semibold text-primary/80">Shortcuts</span>
      </div>
      <div className="flex items-center gap-1">
        <Kbd>J</Kbd><Kbd>K</Kbd>
        <span className="text-micro font-semibold">Navigate</span>
      </div>
      <div className="flex items-center gap-1">
        <Kbd>A</Kbd>
        <span className="text-micro font-semibold">Approve</span>
      </div>
      <div className="flex items-center gap-1">
        <Kbd>E</Kbd>
        <span className="text-micro font-semibold">Save Edit</span>
      </div>
      <div className="flex items-center gap-1">
        <Kbd>R</Kbd>
        <span className="text-micro font-semibold">Reject</span>
      </div>
      <div className="flex items-center gap-1">
        <Kbd>⇧A</Kbd>
        <span className="text-micro font-semibold">Approve All</span>
      </div>
      <div className="flex items-center gap-1">
        <Kbd>Esc</Kbd>
        <span className="text-micro font-semibold">Back</span>
      </div>
    </div>
  );
}

export default function ReviewQueueDetail() {
  const [, setLocation] = useLocation();
  const [, params] = useRoute("/app/review-queue/:documentId");
  const documentId = params?.documentId ? parseInt(params.documentId, 10) : 0;
  const { toast } = useToast();
  usePageTitle("Review document · BrainHalf", { noindex: true });

  const [item, setItem] = useState<FlaggedDocument | null>(null);
  const threshold = useConfidenceThreshold();
  const [resolutions, setResolutions] = useState<Record<string, any>>({});
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  // Kept separate from `item`: a failed fetch and a document that is no
  // longer in the queue both leave `item` null, and they need to say very
  // different things to the person looking at the screen.
  const [loadError, setLoadError] = useState<Error | null>(null);
  const [focusedFieldIndex, setFocusedFieldIndex] = useState(0);

  const fieldCardRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const loadData = async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const match = await getFlaggedDocument(documentId);
      
      if (match) {
        setItem(match);
        const res = await getFieldResolutions(documentId);
        setResolutions(res);

        const initialVals: Record<string, string> = {};
        match.flaggedFields.forEach((f) => {
          const key = `${match.document.id}_${f.normalizedField}`;
          if (res[key]) {
            initialVals[f.normalizedField] = res[key].resolvedValue ?? "";
          } else {
            initialVals[f.normalizedField] = f.editedValue ?? f.value;
          }
        });
        setFieldValues(initialVals);
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [documentId]);

  useEffect(() => {
    const card = fieldCardRefs.current.get(flaggedFields[focusedFieldIndex]?.normalizedField);
    if (card) {
      card.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [focusedFieldIndex]);

  const flaggedFields = item?.flaggedFields ?? [];
  const doc = item?.document;
  const batchId = item?.batchId;

  const handleAction = useCallback(async (
    fieldName: string,
    action: "approved" | "corrected" | "rejected",
    customValue?: string,
    options?: { silent?: boolean }
  ) => {
    if (!item) return;
    const originalField = item.flaggedFields.find((f) => f.normalizedField === fieldName);
    if (!originalField) return;

    const originalVal = originalField.value;
    const finalVal = action === "rejected" ? null : (customValue ?? fieldValues[fieldName] ?? originalVal);

    try {
      await saveFieldResolution(item.document.id, fieldName, originalVal, finalVal, action, item.batchId);
      const resKey = `${item.document.id}_${fieldName}`;
      setResolutions((prev) => ({
        ...prev,
        [resKey]: { documentId: item.document.id, fieldName, originalValue: originalVal, resolvedValue: finalVal, status: action, timestamp: new Date().toISOString() }
      }));

      if (!options?.silent) {
        toast({
          title: `Field ${action}`,
          description: `"${humanizeFieldLabel(fieldName)}" set to "${finalVal}".`,
        });
      }

      if (!options?.silent) {
        const nextUnresolved = flaggedFields.findIndex((f, i) => {
          if (i <= focusedFieldIndex) return false;
          const key = `${item.document.id}_${f.normalizedField}`;
          return !resolutions[key] && f.normalizedField !== fieldName;
        });
        if (nextUnresolved !== -1) {
          setFocusedFieldIndex(nextUnresolved);
        }
      }
    } catch (err) {
      toast({
        title: "Action failed",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
      throw err;
    }
  }, [item, fieldValues, resolutions, flaggedFields, focusedFieldIndex, toast]);

  const handleApproveAll = useCallback(async () => {
    if (!item) return;
    const pending = item.flaggedFields.filter((f) => !resolutions[`${item.document.id}_${f.normalizedField}`]);
    let approved = 0;
    for (const f of pending) {
      try {
        await handleAction(f.normalizedField, "approved", undefined, { silent: true });
        approved++;
      } catch {
        break;
      }
    }
    if (approved > 0) {
      toast({
        title: approved === pending.length ? "All fields verified" : `${approved} of ${pending.length} fields approved`,
        description: approved === pending.length
          ? `${item.document.filename} is now fully reviewed.`
          : "The rest still need attention — the failures are shown above.",
      });
    }
  }, [item, resolutions, handleAction, toast]);

  useReviewHotkeys({
    fieldCount: flaggedFields.length,
    focusedIndex: focusedFieldIndex,
    onFocusField: setFocusedFieldIndex,
    onApprove: (index) => {
      const field = flaggedFields[index];
      if (field) handleAction(field.normalizedField, "approved");
    },
    onCorrect: (index) => {
      const field = flaggedFields[index];
      if (field) handleAction(field.normalizedField, "corrected");
    },
    onReject: (index) => {
      const field = flaggedFields[index];
      if (field) handleAction(field.normalizedField, "rejected");
    },
    onApproveAll: handleApproveAll,
    onBack: () => setLocation("/app/review-queue"),
  });

  if (isLoading) {
    return <ListSkeleton rows={3} />;
  }

  if (loadError) {
    return (
      <ErrorState
        title="Could not load this document"
        body="Nothing has been changed. Your review decisions so far are saved."
        onRetry={() => void loadData()}
      />
    );
  }

  if (!item || !doc) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title="Nothing left to review here"
        body="This document has either been fully verified already or was removed from the queue."
        action={
          <Button asChild variant="outline">
            <Link href="/app/review-queue">Back to the queue</Link>
          </Button>
        }
      />
    );
  }

  // Failed docs may have no stored file; objectPath is null in that case.
  // storageUrl(null) silently becomes "/api/storage/null" — guard it here.
  const fileUrl: string | null = doc.objectPath ? storageUrl(doc.objectPath) : null;
  const reviewedCount = flaggedFields.filter((f) => resolutions[`${doc.id}_${f.normalizedField}`]).length;
  const isComplete = reviewedCount === flaggedFields.length;

  return (
    <div className="flex flex-col gap-5 h-[calc(100vh-8rem)]">
      {/* Top Bar */}
      <div className="shrink-0">
        <PageHeader
          className="mb-0"
          size="detail"
          back={<BackLink href="/app/review-queue" label="Back to review queue" />}
          title={doc.filename}
          titleClassName="truncate"
          titleAdornment={
            /* This chip was gold here and neutral grey on the queue listing —
               the same batch reference in two colours on adjacent screens. */
            <Badge variant="neutral" className="font-data">
              Batch #{batchId}
            </Badge>
          }
          description={
            <>
              {flaggedFields.length} field{flaggedFields.length > 1 ? "s" : ""} came
              back under <span className="font-data">{(threshold * 100).toFixed(0)}%</span> — worth a glance.
            </>
          }
          actions={
            <>
              <Button
                onClick={handleApproveAll}
                disabled={isComplete}
                variant="outline"
                className="gap-1.5 rounded-lg font-semibold"
              >
                <CheckCircle2 className="h-4 w-4" />
                Approve All
              </Button>
              <Button
                onClick={() => setLocation("/app/review-queue")}
                className="rounded-lg px-5 font-semibold shadow-sm"
              >
                {isComplete ? "Done — Back to Queue" : "Save & Continue"}
              </Button>
            </>
          }
        />
      </div>

      {/* Main Workspace */}
      <div className="flex flex-col lg:flex-row gap-5 min-h-0 flex-1">
        {/* LEFT: Zoomable Source Image */}
        <div className="flex-1 flex flex-col min-h-0 border border-border/60 rounded-xl overflow-hidden bg-muted/20 shadow-sm relative">
          <div className="px-4 py-3 border-b border-border/60 bg-card/80 backdrop-blur-sm flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2 font-semibold text-body-sm text-foreground">
              <FileText className="h-4 w-4 text-primary" />
              Source Inspection
            </div>
            <span className="text-caption font-medium text-muted-foreground">Scroll or pinch to zoom</span>
          </div>

          <div className="flex-1 overflow-auto flex items-center justify-center p-4 relative min-h-[300px]">
            {fileUrl ? (
              <TransformWrapper initialScale={1} minScale={0.5} maxScale={4} centerOnInit>
                {/* Render prop, so the zoom controls can reach the transform. The
                    panel used to offer only the words "Pinch/Scroll to Zoom":
                    discoverable if you happen to try it, and unusable with a
                    trackpad-less mouse or by keyboard. */}
                {({ zoomIn, zoomOut, resetTransform }) => (
                  <div className="relative w-full h-full bg-muted/5 rounded-lg overflow-hidden flex items-center justify-center">
                    <TransformComponent wrapperClass="w-full h-full !flex items-center justify-center" contentClass="w-full h-full !flex items-center justify-center relative">
                      <div className="relative inline-block max-w-full max-h-full shadow-md bg-white">
                        <img
                          src={fileUrl}
                          alt={doc.filename}
                          className="max-w-full max-h-[70vh] object-contain block"
                        />
                      </div>
                    </TransformComponent>

                    {/* stopPropagation on pointer-down: without it the wrapper
                        reads a press on a button as the start of a pan. */}
                    <div
                      className="absolute bottom-3 right-3 flex items-center gap-0.5 rounded-lg border border-border/60 bg-card/95 p-1 shadow-md backdrop-blur-sm"
                      onPointerDown={(event) => event.stopPropagation()}
                    >
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 rounded-md"
                        aria-label="Zoom out"
                        title="Zoom out"
                        onClick={() => zoomOut()}
                      >
                        <ZoomOut className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 rounded-md"
                        aria-label="Fit to panel"
                        title="Fit to panel"
                        onClick={() => resetTransform()}
                      >
                        <Maximize2 className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 rounded-md"
                        aria-label="Zoom in"
                        title="Zoom in"
                        onClick={() => zoomIn()}
                      >
                        <ZoomIn className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                )}
              </TransformWrapper>
            ) : (
              <div className="flex flex-col items-center justify-center text-muted-foreground p-8 border border-dashed border-border/40 rounded-xl bg-muted/10 w-full h-full">
                <FileText className="h-10 w-10 mb-3 text-muted-foreground/30" />
                <p className="text-body-sm font-semibold text-foreground">No file stored</p>
                <p className="text-label mt-1 text-center text-muted-foreground">This document has no source image to inspect.</p>
              </div>
            )}
          </div>
        </div>

        {/* RIGHT: Flagged Fields Correction Panel */}
        <div className="w-full lg:w-[440px] flex flex-col min-h-0 shrink-0">
          <Card className="h-full flex flex-col shadow-sm border-border/60 rounded-xl overflow-hidden bg-card">
            <CardHeader className="py-3 px-4 border-b border-border/60 shrink-0 bg-muted/20 flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-body font-semibold flex items-center gap-2 text-foreground">
                <Sparkles className="h-4 w-4 text-warning" />
                Low-Confidence Fields
              </CardTitle>
              <span className="text-caption font-semibold text-muted-foreground bg-background px-2.5 py-0.5 rounded border shadow-sm">
                {reviewedCount} / {flaggedFields.length} Verified
              </span>
            </CardHeader>

            <CardContent className="p-4 overflow-y-auto flex-1 space-y-4">
              {flaggedFields.map((field, index) => {
                const conf = field.confidence ?? 0.5;
                const tone = confidenceTone(conf, threshold);
                const isRed = tone === "destructive";
                
                const resKey = `${doc.id}_${field.normalizedField}`;
                const res = resolutions[resKey];
                const isResolved = !!res;
                const isFocused = index === focusedFieldIndex;

                const borderColor = isResolved
                  ? "border-success/40 bg-success/5"
                  : isRed
                  ? "border-destructive/60 bg-destructive/5"
                  : "border-warning/60 bg-warning/5";

                return (
                  <div 
                    key={field.normalizedField} 
                    id={`review-field-${field.normalizedField}`}
                    ref={(el) => {
                      if (el) fieldCardRefs.current.set(field.normalizedField, el);
                      else fieldCardRefs.current.delete(field.normalizedField);
                    }}
                    className={`p-3 rounded-xl border transition-all duration-200 cursor-pointer ${
                      isFocused
                        ? "ring-1 ring-primary border-primary shadow-sm"
                        : borderColor
                    }`}
                    onClick={() => setFocusedFieldIndex(index)}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-body-sm font-semibold text-foreground">
                        {humanizeFieldLabel(field.normalizedField)}
                      </span>
                      <div className="flex items-center gap-2">
                        {isFocused && !isResolved && (
                          <span className="text-caption font-semibold text-primary bg-primary/10 px-1.5 py-0.5 rounded">
                            Focused
                          </span>
                        )}
                        {isResolved ? (
                          <Badge variant="outline" className="rounded text-caption font-semibold bg-success/10 text-success border-success/20 py-0 h-5">
                            {res.status}
                          </Badge>
                        ) : (
                          <Badge variant="outline" className={`rounded text-micro font-data font-semibold py-0 h-5 ${isRed ? "bg-destructive/10 text-destructive border-destructive/20" : "bg-warning/10 text-warning border-warning/20"}`}>
                            {(conf * 100).toFixed(0)}% Conf
                          </Badge>
                        )}
                      </div>
                    </div>

                    <AutoResizingTextarea
                      value={fieldValues[field.normalizedField] ?? ""}
                      onChange={(e) => setFieldValues((prev) => ({ ...prev, [field.normalizedField]: e.target.value }))}
                      placeholder="Enter corrected value..."
                      minRows={1}
                      maxRows={6}
                      className="font-medium text-body-sm rounded-lg bg-background border-border/60 focus-visible:ring-primary/40 p-2 min-h-[36px]"
                    />

                    <div className="flex items-center justify-end gap-2 mt-3">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleAction(field.normalizedField, "rejected")}
                        className="h-7 rounded-md px-2.5 text-caption font-semibold text-destructive hover:bg-destructive/10 hover:text-destructive border-border/40"
                      >
                        <X className="mr-1 h-3 w-3" /> Reject
                      </Button>

                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleAction(field.normalizedField, "corrected")}
                        className="h-7 rounded-md px-2.5 text-caption font-semibold text-primary hover:bg-primary/10 border-border/40"
                      >
                        <Save className="mr-1 h-3 w-3" /> Save Edit
                      </Button>

                      <Button
                        size="sm"
                        onClick={() => handleAction(field.normalizedField, "approved")}
                        className="h-7 rounded-md px-3 text-caption font-semibold bg-success hover:bg-success/90 text-success-foreground shadow-sm"
                      >
                        <Check className="mr-1 h-3 w-3" /> Approve
                      </Button>
                    </div>
                  </div>
                );
              })}
            </CardContent>

            <HotkeyHintBar />
          </Card>
        </div>
      </div>
    </div>
  );
}
