import { useState, useEffect, useCallback, useRef } from "react";
import { Link, useLocation, useRoute } from "wouter";
import {
  ArrowLeft,
  Check,
  X,
  CheckCircle2,
  AlertTriangle,
  FileText,
  Save,
  Sparkles,
  Keyboard,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, ListSkeleton } from "@/components/app";
import { AutoResizingTextarea } from "@/components/ui/auto-resizing-textarea";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { humanizeFieldLabel } from "@/lib/humanizeField";
import { storageUrl } from "@/lib/api-client";
import {
  getFlaggedDocument,
  saveFieldResolution,
  getFieldResolutions,
  getConfidenceThreshold,
  FlaggedDocument
} from "@/lib/review-queue-store";
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";
import { confidenceTone } from "@/components/ConfidenceIndicator";
import { usePageTitle } from "@/lib/use-page-title";
import { useReviewHotkeys } from "@/hooks/use-review-hotkeys";

// ---------------------------------------------------------------------------
// Keyboard hint bar — sits at the bottom of the correction panel, always
// visible so users discover hotkeys immediately.
// ---------------------------------------------------------------------------

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-[5px] border border-border/60 bg-muted/60 px-1.5 text-[10px] font-bold text-muted-foreground shadow-[0_1px_0_1px_hsl(var(--border)/0.15)] select-none">
      {children}
    </kbd>
  );
}

function HotkeyHintBar() {
  return (
    <div className="flex items-center gap-4 flex-wrap px-4 py-2.5 border-t border-border/40 bg-muted/10 text-muted-foreground">
      <div className="flex items-center gap-1.5">
        <Keyboard className="h-3.5 w-3.5 text-primary/60" />
        <span className="text-[10px] font-extrabold uppercase tracking-widest text-primary/60">Shortcuts</span>
      </div>
      <div className="flex items-center gap-1">
        <Kbd>J</Kbd><Kbd>K</Kbd>
        <span className="text-[10px] font-semibold">Navigate</span>
      </div>
      <div className="flex items-center gap-1">
        <Kbd>A</Kbd>
        <span className="text-[10px] font-semibold">Approve</span>
      </div>
      <div className="flex items-center gap-1">
        <Kbd>E</Kbd>
        <span className="text-[10px] font-semibold">Save Edit</span>
      </div>
      <div className="flex items-center gap-1">
        <Kbd>R</Kbd>
        <span className="text-[10px] font-semibold">Reject</span>
      </div>
      <div className="flex items-center gap-1">
        <Kbd>⇧A</Kbd>
        <span className="text-[10px] font-semibold">Approve All</span>
      </div>
      <div className="flex items-center gap-1">
        <Kbd>Esc</Kbd>
        <span className="text-[10px] font-semibold">Back</span>
      </div>
    </div>
  );
}

export default function ReviewQueueDetail() {
  const [, setLocation] = useLocation();
  // Read the id from the route pattern instead of splitting window.location —
  // the string split broke on any trailing slash or future nested path.
  const [, params] = useRoute("/app/review-queue/:documentId");
  const documentId = params?.documentId ? parseInt(params.documentId, 10) : 0;
  const { toast } = useToast();
  usePageTitle("Review document · BrainHalf", { noindex: true });

  const [item, setItem] = useState<FlaggedDocument | null>(null);
  const [threshold, setThreshold] = useState<number>(0.80);
  const [resolutions, setResolutions] = useState<Record<string, any>>({});
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [focusedFieldIndex, setFocusedFieldIndex] = useState(0);

  // Refs for scrolling field cards into view on keyboard navigation.
  const fieldCardRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  const loadData = async () => {
    setIsLoading(true);
    try {
      const thresh = await getConfidenceThreshold();
      setThreshold(thresh);
      
      // The store filters server-side to this one document.
      const match = await getFlaggedDocument(documentId);
      
      if (match) {
        setItem(match);
        const res = await getFieldResolutions(documentId);
        setResolutions(res);

        // Pre-fill initial form state
        const initialVals: Record<string, string> = {};
        match.flaggedFields.forEach((f) => {
          const key = `${match.document.id}_${f.normalizedField}`;
          if (res[key]) {
            initialVals[f.normalizedField] = res[key].resolvedValue;
          } else {
            initialVals[f.normalizedField] = f.editedValue ?? f.value;
          }
        });
        setFieldValues(initialVals);
      }
    } catch (err) {
      console.error("Failed to load review item:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [documentId]);

  // Scroll the focused field card into view when it changes.
  useEffect(() => {
    const card = fieldCardRefs.current.get(focusedFieldIndex);
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
    // Approve-All loops this per field; without a quiet mode the screen drowned
    // in one toast per field on top of the summary toast.
    options?: { silent?: boolean }
  ) => {
    if (!item) return;
    const originalField = item.flaggedFields.find((f) => f.normalizedField === fieldName);
    if (!originalField) return;

    const originalVal = originalField.value;
    const finalVal = action === "rejected" ? "[REJECTED]" : (customValue ?? fieldValues[fieldName] ?? originalVal);

    try {
      // batchId comes from the queue item, so the write does not need an extra
      // round trip to work out which batch this document belongs to.
      await saveFieldResolution(item.document.id, fieldName, originalVal, finalVal, action, item.batchId);

      // Update local resolution state
      const resKey = `${item.document.id}_${fieldName}`;
      setResolutions((prev) => ({
        ...prev,
        [resKey]: { documentId: item.document.id, fieldName, originalValue: originalVal, resolvedValue: finalVal, status: action, timestamp: new Date().toISOString() }
      }));

      if (!options?.silent) {
        toast({
          title: `Field ${action.toUpperCase()}`,
          description: `"${humanizeFieldLabel(fieldName)}" set to "${finalVal}".`,
        });
      }

      // Auto-advance to the next unresolved field after an action.
      if (!options?.silent) {
        const nextUnresolved = flaggedFields.findIndex((f, i) => {
          if (i <= focusedFieldIndex) return false;
          const key = `${item.document.id}_${f.normalizedField}`;
          // Check both existing resolutions and whether the field we just resolved is this one.
          return !resolutions[key] && f.normalizedField !== fieldName;
        });
        if (nextUnresolved !== -1) {
          setFocusedFieldIndex(nextUnresolved);
        }
      }
    } catch (err: any) {
      toast({
        title: "Action failed",
        description: err.message,
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
        // handleAction already surfaced the failure; stop instead of reporting
        // success for fields that did not save.
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

  // -------------------------------------------------------------------------
  // Keyboard hotkeys
  // -------------------------------------------------------------------------
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

  if (!item || !doc) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title="Nothing left to review here"
        body="This document has either been fully verified already or was removed from the queue."
        action={
          <Button asChild variant="outline" className="h-12 rounded-full px-8 text-xs font-bold uppercase tracking-wide">
            <Link href="/app/review-queue">Back to the queue</Link>
          </Button>
        }
      />
    );
  }

  const fileUrl = storageUrl(doc.objectPath);

  const reviewedCount = flaggedFields.filter((f) => resolutions[`${doc.id}_${f.normalizedField}`]).length;
  const isComplete = reviewedCount === flaggedFields.length;

  return (
    <div className="flex flex-col gap-6 h-[calc(100vh-8rem)]">
      {/* Top Bar */}
      <div className="flex items-center justify-between shrink-0 border-b border-border/40 pb-4">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild className="rounded-full h-10 w-10 bg-card border border-border/40 hover:bg-muted/50 transition-colors">
            <Link href="/app/review-queue">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>

          <div className="flex flex-col">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-extrabold text-foreground truncate max-w-md" title={doc.filename}>
                {doc.filename}
              </h1>
              <Badge variant="outline" className="rounded-full font-extrabold uppercase text-[11px] tracking-widest bg-warning/10 text-warning border-warning/20">
                Batch #{batchId}
              </Badge>
            </div>
            <p className="text-xs font-semibold text-muted-foreground mt-0.5">
              {flaggedFields.length} field{flaggedFields.length > 1 ? "s" : ""} came
              back under {(threshold * 100).toFixed(0)}% — worth a glance before
              you export.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button
            onClick={handleApproveAll}
            disabled={isComplete}
            variant="outline"
            className="rounded-full font-bold uppercase text-xs tracking-wider gap-1.5 border-border/60 hover:bg-success/10 hover:text-success"
          >
            <CheckCircle2 className="h-4 w-4" />
            Approve All
          </Button>

          <Button
            onClick={() => setLocation("/app/review-queue")}
            className="rounded-full font-bold uppercase text-xs tracking-wider px-6 shadow-sm"
          >
            {isComplete ? "Done — Back to Queue" : "Save & Continue"}
          </Button>
        </div>
      </div>

      {/* Main Workspace */}
      <div className="flex flex-col lg:flex-row gap-6 min-h-0 flex-1">
        {/* LEFT: Zoomable Source Image */}
        <div className="flex-1 flex flex-col min-h-0 border border-border/60 rounded-3xl overflow-hidden bg-muted/20 shadow-sm relative">
          <div className="p-4 border-b border-border/60 bg-card/80 backdrop-blur-sm flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2 font-bold text-sm text-foreground">
              <FileText className="h-4 w-4 text-primary" />
              Source Document Inspection
            </div>
            <span className="text-xs font-semibold text-muted-foreground">Pinch/Scroll to Zoom & Pan</span>
          </div>

          <div className="flex-1 overflow-auto flex items-center justify-center p-6 relative min-h-[300px]">
            <TransformWrapper initialScale={1} minScale={0.5} maxScale={4} centerOnInit>
              <div className="relative w-full h-full bg-muted/5 rounded-lg overflow-hidden flex items-center justify-center">
                <TransformComponent wrapperClass="w-full h-full !flex items-center justify-center" contentClass="w-full h-full !flex items-center justify-center relative">
                  <div className="relative inline-block max-w-full max-h-full shadow-md bg-white">
                    <img
                      src={fileUrl}
                      alt={doc.filename}
                      className="max-w-full max-h-[70vh] object-contain block"
                    />
                    {/* No bounding-box overlay: the OCR engine returns no
                        field coordinates. */}
                  </div>
                </TransformComponent>
              </div>
            </TransformWrapper>
          </div>
        </div>

        {/* RIGHT: Flagged Fields Correction Panel */}
        <div className="w-full lg:w-[480px] flex flex-col min-h-0 shrink-0">
          <Card className="h-full flex flex-col shadow-sm border-border/60 rounded-3xl overflow-hidden bg-card">
            <CardHeader className="py-4 border-b border-border/60 shrink-0 bg-muted/20 flex flex-row items-center justify-between">
              <CardTitle className="text-base font-extrabold flex items-center gap-2 text-foreground">
                <Sparkles className="h-4 w-4 text-warning" />
                Low-Confidence Fields
              </CardTitle>
              <span className="text-xs font-extrabold text-muted-foreground bg-background px-3 py-1 rounded-full border shadow-sm uppercase tracking-widest">
                {reviewedCount} / {flaggedFields.length} Verified
              </span>
            </CardHeader>

            <CardContent className="p-6 overflow-y-auto flex-1 space-y-6">
              {flaggedFields.map((field, index) => {
                const conf = field.confidence ?? 0.5;
                // Was a hardcoded 0.7 cut-off; now the same threshold-aware
                // tone the rest of the app uses.
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
                      if (el) fieldCardRefs.current.set(index, el);
                      else fieldCardRefs.current.delete(index);
                    }}
                    className={`p-4 rounded-2xl border transition-all duration-200 cursor-pointer ${
                      isFocused
                        ? "ring-2 ring-primary border-primary shadow-md"
                        : borderColor
                    }`}
                    onClick={() => setFocusedFieldIndex(index)}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-extrabold uppercase tracking-wider text-foreground">
                        {humanizeFieldLabel(field.normalizedField)}
                      </span>
                      <div className="flex items-center gap-2">
                        {isFocused && !isResolved && (
                          <span className="text-[10px] font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-full uppercase tracking-wider">
                            Focused
                          </span>
                        )}
                        {isResolved ? (
                          <Badge variant="outline" className="rounded-full text-[11px] font-extrabold uppercase tracking-widest bg-success/10 text-success border-success/20">
                            {res.status}
                          </Badge>
                        ) : (
                          <Badge variant="outline" className={`rounded-full text-[11px] font-mono font-bold ${isRed ? "bg-destructive/10 text-destructive border-destructive/20" : "bg-warning/10 text-warning border-warning/20"}`}>
                            {(conf * 100).toFixed(0)}% Confidence
                          </Badge>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 mt-2">
                      <AutoResizingTextarea
                        value={fieldValues[field.normalizedField] ?? ""}
                        onChange={(e) => setFieldValues((prev) => ({ ...prev, [field.normalizedField]: e.target.value }))}
                        placeholder="Enter corrected value..."
                        minRows={1}
                        maxRows={8}
                        className="font-semibold text-sm rounded-xl bg-background border-border/60 focus-visible:ring-primary/40"
                      />
                    </div>

                    <div className="flex items-center justify-end gap-2 pt-1">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleAction(field.normalizedField, "rejected")}
                        className="h-8 rounded-full text-xs font-bold text-destructive hover:bg-destructive/10 hover:text-destructive border-border/40"
                      >
                        <X className="mr-1 h-3.5 w-3.5" /> Reject
                      </Button>

                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleAction(field.normalizedField, "corrected")}
                        className="h-8 rounded-full text-xs font-bold text-primary hover:bg-primary/10 border-border/40"
                      >
                        <Save className="mr-1 h-3.5 w-3.5" /> Save Edit
                      </Button>

                      <Button
                        size="sm"
                        onClick={() => handleAction(field.normalizedField, "approved")}
                        className="h-8 rounded-full text-xs font-bold bg-success hover:bg-success/90 text-white shadow-sm"
                      >
                        <Check className="mr-1 h-3.5 w-3.5" /> Approve
                      </Button>
                    </div>
                  </div>
                );
              })}
            </CardContent>

            {/* Persistent keyboard shortcut hint bar */}
            <HotkeyHintBar />
          </Card>
        </div>
      </div>
    </div>
  );
}
