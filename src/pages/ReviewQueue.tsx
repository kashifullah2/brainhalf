import { useState, useEffect } from "react";
import { Link } from "wouter";
import { 
  CheckSquare, 
  AlertTriangle, 
  CheckCircle2, 
  ArrowRight, 
  SlidersHorizontal,
  FileText,
  Sparkles,
  Layers
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { usePageTitle } from "@/lib/use-page-title";
import { 
  getReviewQueueItems, 
  getConfidenceThreshold, 
  markDocumentReviewed, 
  FlaggedDocument 
} from "@/lib/review-queue-store";

export default function ReviewQueue() {
  const { toast } = useToast();
  usePageTitle("Review queue · BrainHalf");
  const [items, setItems] = useState<FlaggedDocument[]>([]);
  const [threshold, setThreshold] = useState<number>(0.80);
  const [isLoading, setIsLoading] = useState(true);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const thresh = await getConfidenceThreshold();
      setThreshold(thresh);
      const queueItems = await getReviewQueueItems();
      setItems(queueItems);
    } catch (err) {
      console.error("Failed to load review queue:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleApproveDocument = async (batchId: number, documentId: number) => {
    try {
      await markDocumentReviewed(batchId, documentId);
      toast({
        title: "Fields approved",
        description: "The flagged fields on this document are marked as verified.",
      });
      loadData();
    } catch (err: any) {
      toast({
        title: "Action failed",
        description: err.message,
        variant: "destructive",
      });
    }
  };

  const totalFlaggedFields = items.reduce((sum, item) => sum + item.totalFlaggedCount, 0);

  // A document whose flagged fields are all resolved moves to the verified
  // list; the pending list only counts documents with open flags.
  const pendingItems = items.filter(
    (item) => item.reviewedCount < item.totalFlaggedCount,
  );
  const verifiedItems = items.filter(
    (item) => item.reviewedCount >= item.totalFlaggedCount,
  );
  const pendingFields = items.reduce(
    (sum, item) => sum + (item.totalFlaggedCount - item.reviewedCount),
    0
  );

  // AppLayout's <main> already supplies the max width and page padding; the
  // extra max-w-7xl/py-8 here doubled them.
  return (
    <div className="flex flex-col flex-1 w-full">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8 border-b border-border/40 pb-6">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-warning/10 px-3.5 py-1 text-xs font-bold uppercase tracking-widest text-warning border border-warning/20 shadow-sm mb-3">
            <CheckSquare className="h-3.5 w-3.5" />
            Human-in-the-Loop
          </div>
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-foreground">
            Review Queue
          </h1>
          <p className="text-base sm:text-lg font-medium text-muted-foreground mt-1">
            Fields extracted below your <span className="text-foreground font-bold">{(threshold * 100).toFixed(0)}%</span> confidence threshold are routed here for human verification.
          </p>
        </div>

        <Button asChild variant="outline" className="rounded-full font-bold uppercase text-xs tracking-wider gap-2 self-start md:self-auto border-border/60">
          <Link href="/app/settings">
            <SlidersHorizontal className="h-4 w-4" />
            Configure Threshold
          </Link>
        </Button>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-8">
        <Card className="rounded-3xl border-border/60 shadow-sm bg-card p-6">
          <div className="flex items-start justify-between gap-3">
            {/* min-h reserves the second line so the three cards' numbers share a
                baseline whether or not a label wraps. */}
            <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground min-h-[2.25rem]">Awaiting Review</span>
            <div className="p-2 rounded-xl bg-primary/10 text-primary shrink-0">
              <FileText className="h-5 w-5" />
            </div>
          </div>
          <div className="text-3xl font-black tracking-tight text-foreground mt-3">
            {pendingItems.length}
          </div>
        </Card>

        <Card className="rounded-3xl border-border/60 shadow-sm bg-card p-6">
          <div className="flex items-start justify-between gap-3">
            <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground min-h-[2.25rem]">Pending Field Verification</span>
            <div className="p-2 rounded-xl bg-warning/10 text-warning shrink-0">
              <AlertTriangle className="h-5 w-5" />
            </div>
          </div>
          <div className="text-3xl font-black tracking-tight text-foreground mt-3">
            {pendingFields}
            {/* The "/ N" denominator read as "0 /0" whenever the queue was
                clear. Only show it once flagged fields actually exist. */}
            {totalFlaggedFields > 0 && (
              <span className="text-sm font-bold text-muted-foreground"> of {totalFlaggedFields} flagged</span>
            )}
          </div>
        </Card>

        <Card className="rounded-3xl border-border/60 shadow-sm bg-card p-6">
          <div className="flex items-start justify-between gap-3">
            <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground min-h-[2.25rem]">Routing Threshold</span>
            <div className="p-2 rounded-xl bg-success/10 text-success shrink-0">
              <Sparkles className="h-5 w-5" />
            </div>
          </div>
          <div className="text-3xl font-black tracking-tight text-foreground mt-3">
            {(threshold * 100).toFixed(0)}%
          </div>
        </Card>
      </div>

      {/* Queue List */}
      {isLoading ? (
        <div className="flex justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      ) : items.length === 0 ? (
        <Card className="rounded-3xl border-border/60 p-12 text-center bg-card shadow-sm flex flex-col items-center">
          <div className="h-16 w-16 rounded-full bg-success/10 text-success flex items-center justify-center mb-4">
            <CheckCircle2 className="h-8 w-8" />
          </div>
          <h3 className="text-xl font-extrabold text-foreground">Review Queue Clear!</h3>
          <p className="text-sm font-medium text-muted-foreground max-w-md mt-2">
            All extracted document fields meet or exceed your confidence threshold of {(threshold * 100).toFixed(0)}%. No documents require manual correction.
          </p>
          <Button asChild className="rounded-full px-8 font-bold uppercase text-xs mt-6 shadow-sm">
            <Link href="/app/upload">Run New Batch</Link>
          </Button>
        </Card>
      ) : (
        <div className="space-y-8">
          <div className="space-y-4">
          <div className="flex items-center justify-between px-2">
            <h2 className="text-sm font-extrabold uppercase tracking-widest text-muted-foreground">
              Documents Awaiting Review ({pendingItems.length})
            </h2>
          </div>

          {pendingItems.length === 0 && (
            <Card className="rounded-3xl border-border/60 bg-card p-8 text-center shadow-sm">
              <p className="text-sm font-bold text-foreground">Nothing left to review.</p>
              <p className="mt-1 text-sm font-medium text-muted-foreground">
                Every flagged field has been verified.
              </p>
            </Card>
          )}

          <div className="space-y-3">
            {pendingItems.map((item) => {
              const pendingInDoc = item.totalFlaggedCount - item.reviewedCount;
              const isFullyReviewed = pendingInDoc === 0;

              return (
                <Card
                  key={`${item.batchId}_${item.document.id}`}
                  className={`rounded-3xl border transition-all duration-200 overflow-hidden shadow-sm hover:shadow-md ${
                    isFullyReviewed ? "border-success/40 bg-success/5" : "border-border/60 bg-card"
                  }`}
                >
                  <CardContent className="p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
                    <div className="flex items-start gap-4 min-w-0">
                      <div className={`p-3 rounded-2xl shrink-0 ${isFullyReviewed ? "bg-success/20 text-success" : "bg-warning/10 text-warning"}`}>
                        <FileText className="h-6 w-6" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-3">
                          <h3 className="text-lg font-extrabold text-foreground truncate max-w-xs sm:max-w-md" title={item.document.filename}>
                            {item.document.filename}
                          </h3>
                          <Link href={`/app/batches/${item.batchId}`}>
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-muted text-muted-foreground text-[11px] font-extrabold uppercase tracking-wider hover:bg-primary/10 hover:text-primary transition-colors cursor-pointer">
                              <Layers className="h-3 w-3" /> Batch #{item.batchId}
                            </span>
                          </Link>
                        </div>

                        <div className="flex items-center gap-4 mt-2">
                          <span className={`px-3 py-1 rounded-full text-xs font-bold border ${
                            isFullyReviewed
                              ? "bg-success/10 text-success border-success/20"
                              : "bg-warning/10 text-warning border-warning/20"
                          }`}>
                            {isFullyReviewed
                              ? "Fully Verified"
                              : `${pendingInDoc} field${pendingInDoc === 1 ? "" : "s"} ${pendingInDoc === 1 ? "needs" : "need"} review`}
                          </span>

                          <span className="text-xs font-semibold text-muted-foreground">
                            {item.reviewedCount} of {item.totalFlaggedCount} field
                            {item.totalFlaggedCount === 1 ? "" : "s"} verified
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 w-full sm:w-auto shrink-0 border-t sm:border-t-0 border-border/40 pt-4 sm:pt-0">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleApproveDocument(item.batchId, item.document.id)}
                        disabled={isFullyReviewed}
                        className="rounded-full font-bold uppercase text-[11px] tracking-wider border-border/60 hover:bg-success/10 hover:text-success hover:border-success/30"
                      >
                        <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                        {/* Was "Approve Batch": a batch-wide action rendered once
                            per document, so the same batch showed several
                            identical buttons and clicking any of them approved
                            documents the user was not looking at. */}
                        Approve fields
                      </Button>

                      <Button
                        asChild
                        size="sm"
                        className="rounded-full font-bold uppercase text-[11px] tracking-wider px-6 shadow-sm gap-1.5"
                      >
                        <Link href={`/app/review-queue/${item.document.id}?batchId=${item.batchId}`}>
                          Review & Correct <ArrowRight className="h-3.5 w-3.5" />
                        </Link>
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
          </div>

          {/* Resolved documents move out of the queue but stay visible, so a
              verified document is not simply gone the next time you look. */}
          {verifiedItems.length > 0 && (
            <div className="space-y-4">
              <h2 className="px-2 text-sm font-extrabold uppercase tracking-widest text-muted-foreground">
                Verified ({verifiedItems.length})
              </h2>
              <div className="space-y-3">
                {verifiedItems.map((item) => (
                  <Card
                    key={`${item.batchId}_${item.document.id}`}
                    className="rounded-3xl border border-success/40 bg-success/5 shadow-sm"
                  >
                    <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex min-w-0 items-center gap-4">
                        <div className="shrink-0 rounded-2xl bg-success/20 p-3 text-success">
                          <CheckCircle2 className="h-5 w-5" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-3">
                            <h3
                              className="truncate text-base font-extrabold text-foreground"
                              title={item.document.filename}
                            >
                              {item.document.filename}
                            </h3>
                            <Link href={`/app/batches/${item.batchId}`}>
                              <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-extrabold uppercase tracking-wider text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary">
                                <Layers className="h-3 w-3" /> Batch #{item.batchId}
                              </span>
                            </Link>
                          </div>
                          <p className="mt-1 text-xs font-semibold text-muted-foreground">
                            {item.totalFlaggedCount} field
                            {item.totalFlaggedCount === 1 ? "" : "s"} verified
                          </p>
                        </div>
                      </div>

                      <Button
                        asChild
                        variant="outline"
                        size="sm"
                        className="shrink-0 rounded-full border-border/60 text-[11px] font-bold uppercase tracking-wider"
                      >
                        <Link href={`/app/review-queue/${item.document.id}?batchId=${item.batchId}`}>
                          View
                        </Link>
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
