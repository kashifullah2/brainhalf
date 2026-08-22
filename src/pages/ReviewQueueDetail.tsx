import { useState, useEffect } from "react";
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
} from "lucide-react";
import { Button } from "@/components/ui/button";
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
  const [activeField, setActiveField] = useState<string | null>(null);

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

  if (isLoading) {
    return (
      <div className="flex justify-center items-center py-32">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary" />
      </div>
    );
  }

  if (!item) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <AlertTriangle className="h-12 w-12 text-warning mb-4" />
        <h2 className="text-xl font-extrabold">Document Not Found in Review Queue</h2>
        <p className="text-sm font-medium text-muted-foreground mt-1 max-w-sm">
          This document might have already been fully verified or removed.
        </p>
        <Button asChild variant="outline" className="rounded-full font-bold uppercase text-xs mt-6">
          <Link href="/app/review-queue">Back to Review Queue</Link>
        </Button>
      </div>
    );
  }

  const { document: doc, flaggedFields, batchId } = item;
  const fileUrl = storageUrl(doc.objectPath);

  const handleAction = async (
    fieldName: string,
    action: "approved" | "corrected" | "rejected",
    customValue?: string,
    // Approve-All loops this per field; without a quiet mode the screen drowned
    // in one toast per field on top of the summary toast.
    options?: { silent?: boolean }
  ) => {
    const originalField = flaggedFields.find((f) => f.normalizedField === fieldName);
    if (!originalField) return;

    const originalVal = originalField.value;
    const finalVal = action === "rejected" ? "[REJECTED]" : (customValue ?? fieldValues[fieldName] ?? originalVal);

    try {
      // batchId comes from the queue item, so the write does not need an extra
      // round trip to work out which batch this document belongs to.
      await saveFieldResolution(doc.id, fieldName, originalVal, finalVal, action, batchId);

      // Update local resolution state
      const resKey = `${doc.id}_${fieldName}`;
      setResolutions((prev) => ({
        ...prev,
        [resKey]: { documentId: doc.id, fieldName, originalValue: originalVal, resolvedValue: finalVal, status: action, timestamp: new Date().toISOString() }
      }));

      if (!options?.silent) {
        toast({
          title: `Field ${action.toUpperCase()}`,
          description: `"${humanizeFieldLabel(fieldName)}" set to "${finalVal}".`,
        });
      }
    } catch (err: any) {
      toast({
        title: "Action failed",
        description: err.message,
        variant: "destructive",
      });
      throw err;
    }
  };

  const handleApproveAll = async () => {
    const pending = flaggedFields.filter((f) => !resolutions[`${doc.id}_${f.normalizedField}`]);
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
          ? `${doc.filename} is now fully reviewed.`
          : "The rest still need attention — the failures are shown above.",
      });
    }
  };

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
              Reviewing {flaggedFields.length} low-confidence field{flaggedFields.length > 1 ? "s" : ""} (&lt;{(threshold * 100).toFixed(0)}%)
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
              {flaggedFields.map((field) => {
                const conf = field.confidence ?? 0.5;
                // Was a hardcoded 0.7 cut-off; now the same threshold-aware
                // tone the rest of the app uses.
                const tone = confidenceTone(conf, threshold);
                const isRed = tone === "destructive";
                
                const resKey = `${doc.id}_${field.normalizedField}`;
                const res = resolutions[resKey];
                const isResolved = !!res;

                const borderColor = isResolved
                  ? "border-success/40 bg-success/5"
                  : isRed
                  ? "border-destructive/60 bg-destructive/5"
                  : "border-warning/60 bg-warning/5";

                return (
                  <div 
                    key={field.normalizedField} 
                    id={`review-field-${field.normalizedField}`}
                    className={`p-4 rounded-2xl border transition-all duration-200 cursor-pointer ${activeField === field.normalizedField ? 'ring-2 ring-primary border-primary' : borderColor}`}
                    onMouseEnter={() => setActiveField(field.normalizedField)}
                    onMouseLeave={() => setActiveField(null)}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-extrabold uppercase tracking-wider text-foreground">
                        {humanizeFieldLabel(field.normalizedField)}
                      </span>
                      <div className="flex items-center gap-2">
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
          </Card>
        </div>
      </div>
    </div>
  );
}
