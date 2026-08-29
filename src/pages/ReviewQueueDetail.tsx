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

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-[4px] border border-border/60 bg-muted/60 px-1.5 text-[10px] font-bold text-muted-foreground shadow-sm select-none">
      {children}
    </kbd>
  );
}

function HotkeyHintBar() {
  return (
    <div className="flex items-center gap-4 flex-wrap px-4 py-2.5 border-t border-border/40 bg-muted/10 text-muted-foreground shrink-0">
      <div className="flex items-center gap-1.5">
        <Keyboard className="h-3.5 w-3.5 text-primary/60" />
        <span className="text-[12px] font-semibold text-primary/80">Shortcuts</span>
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

  const fieldCardRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  const loadData = async () => {
    setIsLoading(true);
    try {
      const thresh = await getConfidenceThreshold();
      setThreshold(thresh);
      const match = await getFlaggedDocument(documentId);
      
      if (match) {
        setItem(match);
        const res = await getFieldResolutions(documentId);
        setResolutions(res);

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
    options?: { silent?: boolean }
  ) => {
    if (!item) return;
    const originalField = item.flaggedFields.find((f) => f.normalizedField === fieldName);
    if (!originalField) return;

    const originalVal = originalField.value;
    const finalVal = action === "rejected" ? "[REJECTED]" : (customValue ?? fieldValues[fieldName] ?? originalVal);

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

  if (!item || !doc) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title="Nothing left to review here"
        body="This document has either been fully verified already or was removed from the queue."
        action={
          <Button asChild variant="outline" className="h-10 rounded-lg px-6 text-[13px] font-semibold">
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
    <div className="flex flex-col gap-5 h-[calc(100vh-8rem)]">
      {/* Top Bar */}
      <div className="flex items-center justify-between shrink-0 border-b border-border/40 pb-4">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild className="rounded-lg h-10 w-10 bg-card border border-border/40 hover:bg-muted/50 transition-colors">
            <Link href="/app/review-queue">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>

          <div className="flex flex-col">
            <div className="flex items-center gap-3">
              <h1 className="text-[20px] font-extrabold text-foreground truncate max-w-md" title={doc.filename}>
                {doc.filename}
              </h1>
              <Badge variant="outline" className="rounded-md font-semibold text-[11px] bg-warning/10 text-warning border-warning/20">
                Batch #{batchId}
              </Badge>
            </div>
            <p className="text-[12px] font-medium text-muted-foreground mt-1">
              {flaggedFields.length} field{flaggedFields.length > 1 ? "s" : ""} came
              back under {(threshold * 100).toFixed(0)}% — worth a glance.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            onClick={handleApproveAll}
            disabled={isComplete}
            variant="outline"
            className="rounded-lg font-semibold text-[13px] h-9 gap-1.5 border-border/60 hover:bg-success/10 hover:text-success"
          >
            <CheckCircle2 className="h-4 w-4" />
            Approve All
          </Button>

          <Button
            onClick={() => setLocation("/app/review-queue")}
            className="rounded-lg font-semibold text-[13px] h-9 px-5 shadow-sm"
          >
            {isComplete ? "Done — Back to Queue" : "Save & Continue"}
          </Button>
        </div>
      </div>

      {/* Main Workspace */}
      <div className="flex flex-col lg:flex-row gap-5 min-h-0 flex-1">
        {/* LEFT: Zoomable Source Image */}
        <div className="flex-1 flex flex-col min-h-0 border border-border/60 rounded-xl overflow-hidden bg-muted/20 shadow-sm relative">
          <div className="px-4 py-3 border-b border-border/60 bg-card/80 backdrop-blur-sm flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2 font-bold text-[13px] text-foreground">
              <FileText className="h-4 w-4 text-primary" />
              Source Inspection
            </div>
            <span className="text-[11px] font-medium text-muted-foreground">Pinch/Scroll to Zoom</span>
          </div>

          <div className="flex-1 overflow-auto flex items-center justify-center p-4 relative min-h-[300px]">
            <TransformWrapper initialScale={1} minScale={0.5} maxScale={4} centerOnInit>
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
              </div>
            </TransformWrapper>
          </div>
        </div>

        {/* RIGHT: Flagged Fields Correction Panel */}
        <div className="w-full lg:w-[440px] flex flex-col min-h-0 shrink-0">
          <Card className="h-full flex flex-col shadow-sm border-border/60 rounded-xl overflow-hidden bg-card">
            <CardHeader className="py-3 px-4 border-b border-border/60 shrink-0 bg-muted/20 flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-[14px] font-bold flex items-center gap-2 text-foreground">
                <Sparkles className="h-4 w-4 text-warning" />
                Low-Confidence Fields
              </CardTitle>
              <span className="text-[11px] font-semibold text-muted-foreground bg-background px-2.5 py-0.5 rounded border shadow-sm">
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
                      if (el) fieldCardRefs.current.set(index, el);
                      else fieldCardRefs.current.delete(index);
                    }}
                    className={`p-3 rounded-xl border transition-all duration-200 cursor-pointer ${
                      isFocused
                        ? "ring-1 ring-primary border-primary shadow-sm"
                        : borderColor
                    }`}
                    onClick={() => setFocusedFieldIndex(index)}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[13px] font-semibold text-foreground">
                        {humanizeFieldLabel(field.normalizedField)}
                      </span>
                      <div className="flex items-center gap-2">
                        {isFocused && !isResolved && (
                          <span className="text-[11px] font-semibold text-primary bg-primary/10 px-1.5 py-0.5 rounded">
                            Focused
                          </span>
                        )}
                        {isResolved ? (
                          <Badge variant="outline" className="rounded text-[11px] font-semibold bg-success/10 text-success border-success/20 py-0 h-5">
                            {res.status}
                          </Badge>
                        ) : (
                          <Badge variant="outline" className={`rounded text-[10px] font-mono font-bold py-0 h-5 ${isRed ? "bg-destructive/10 text-destructive border-destructive/20" : "bg-warning/10 text-warning border-warning/20"}`}>
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
                      className="font-medium text-[13px] rounded-lg bg-background border-border/60 focus-visible:ring-primary/40 p-2 min-h-[36px]"
                    />

                    <div className="flex items-center justify-end gap-2 mt-3">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleAction(field.normalizedField, "rejected")}
                        className="h-7 rounded-md px-2.5 text-[11px] font-semibold text-destructive hover:bg-destructive/10 hover:text-destructive border-border/40"
                      >
                        <X className="mr-1 h-3 w-3" /> Reject
                      </Button>

                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleAction(field.normalizedField, "corrected")}
                        className="h-7 rounded-md px-2.5 text-[11px] font-semibold text-primary hover:bg-primary/10 border-border/40"
                      >
                        <Save className="mr-1 h-3 w-3" /> Save Edit
                      </Button>

                      <Button
                        size="sm"
                        onClick={() => handleAction(field.normalizedField, "approved")}
                        className="h-7 rounded-md px-3 text-[11px] font-semibold bg-success hover:bg-success/90 text-white shadow-sm"
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
