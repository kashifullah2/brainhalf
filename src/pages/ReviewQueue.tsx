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
import {
  EmptyState,
  ListSkeleton,
  PageHeader,
  StatCard,
} from "@/components/app";
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
  usePageTitle("Review queue · BrainHalf", { noindex: true });
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

  return (
    <div className="flex flex-col flex-1 w-full">
      <PageHeader
        eyebrow={<><CheckSquare className="h-3.5 w-3.5" /> Human in the loop</>}
        title="Second pair of eyes"
        description={
          <>
            Anything the model read below your{" "}
            <span className="font-semibold text-foreground">
              {(threshold * 100).toFixed(0)}%
            </span>{" "}
            confidence line waits here. Nothing is exported until you are happy
            with it.
          </>
        }
        actions={
          <Button asChild variant="outline" className="gap-2 self-start rounded-lg border-border/60 text-[12px] font-semibold h-9 md:self-auto hover:bg-muted">
            <Link href="/app/settings">
              <SlidersHorizontal className="h-4 w-4" />
              Configure Threshold
            </Link>
          </Button>
        }
      />

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          label="Awaiting Review"
          value={pendingItems.length}
          icon={FileText}
          tone="primary"
        />
        <StatCard
          label="Pending Field Verification"
          value={pendingFields}
          hint={totalFlaggedFields > 0 ? `of ${totalFlaggedFields} flagged` : undefined}
          icon={AlertTriangle}
          tone="warning"
        />
        <StatCard
          label="Routing Threshold"
          value={`${(threshold * 100).toFixed(0)}%`}
          icon={Sparkles}
          tone="success"
        />
      </div>

      {isLoading ? (
        <ListSkeleton rows={3} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={CheckCircle2}
          title="Nothing needs you right now"
          body={`Every field came back at or above your ${(threshold * 100).toFixed(0)}% threshold, so there is nothing to correct.`}
          action={
            <Button asChild className="h-10 rounded-lg px-6 text-[13px] font-semibold shadow-sm">
              <Link href="/app/upload">Run a new batch</Link>
            </Button>
          }
        />
      ) : (
        <div className="space-y-6">
          <div className="space-y-3">
            <div className="flex items-center justify-between px-1">
              <h2 className="text-[12px] font-bold uppercase tracking-widest text-muted-foreground">
                Documents Awaiting Review ({pendingItems.length})
              </h2>
            </div>

            {pendingItems.length === 0 && (
              <Card className="rounded-xl border-border/60 bg-card p-6 text-center shadow-sm">
                <p className="text-[14px] font-semibold text-foreground">All caught up.</p>
                <p className="mt-1 text-[13px] text-muted-foreground">
                  Every flagged field on this list has been checked off.
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
                    className={`rounded-xl border transition-all duration-200 overflow-hidden shadow-sm hover:shadow-md ${
                      isFullyReviewed ? "border-success/40 bg-success/5" : "border-border/60 bg-card"
                    }`}
                  >
                    <CardContent className="p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                      <div className="flex items-start gap-4 min-w-0">
                        <div className={`p-2.5 rounded-lg shrink-0 ${isFullyReviewed ? "bg-success/20 text-success" : "bg-warning/10 text-warning"}`}>
                          <FileText className="h-5 w-5" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <h3 className="text-[15px] font-semibold text-foreground truncate max-w-xs sm:max-w-md" title={item.document.filename}>
                              {item.document.filename}
                            </h3>
                            <Link href={`/app/batches/${item.batchId}`}>
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-muted text-muted-foreground text-[10px] font-bold uppercase tracking-wider hover:bg-primary/10 hover:text-primary transition-colors cursor-pointer border border-transparent hover:border-primary/20">
                                <Layers className="h-3 w-3" /> Batch #{item.batchId}
                              </span>
                            </Link>
                          </div>

                          <div className="flex items-center gap-3 mt-1.5">
                            <span className={`px-2 py-0.5 rounded text-[11px] font-semibold border ${
                              isFullyReviewed
                                ? "bg-success/10 text-success border-success/20"
                                : "bg-warning/10 text-warning border-warning/20"
                            }`}>
                              {isFullyReviewed
                                ? "Fully Verified"
                                : `${pendingInDoc} field${pendingInDoc === 1 ? "" : "s"} ${pendingInDoc === 1 ? "needs" : "need"} review`}
                            </span>

                            <span className="text-[12px] font-medium text-muted-foreground">
                              {item.reviewedCount} of {item.totalFlaggedCount} field
                              {item.totalFlaggedCount === 1 ? "" : "s"} verified
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 w-full sm:w-auto shrink-0 border-t sm:border-t-0 border-border/40 pt-3 sm:pt-0">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleApproveDocument(item.batchId, item.document.id)}
                          disabled={isFullyReviewed}
                          className="rounded-lg h-8 px-3 text-[12px] font-semibold border-border/60 hover:bg-success/10 hover:text-success hover:border-success/30"
                        >
                          <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                          Approve fields
                        </Button>

                        <Button
                          asChild
                          size="sm"
                          className="rounded-lg h-8 px-4 shadow-sm gap-1.5 text-[12px] font-semibold"
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

          {verifiedItems.length > 0 && (
            <div className="space-y-3 pt-4">
              <h2 className="px-1 text-[12px] font-bold uppercase tracking-widest text-muted-foreground">
                Verified ({verifiedItems.length})
              </h2>
              <div className="space-y-3">
                {verifiedItems.map((item) => (
                  <Card
                    key={`${item.batchId}_${item.document.id}`}
                    className="rounded-xl border border-success/40 bg-success/5 shadow-sm"
                  >
                    <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex min-w-0 items-center gap-4">
                        <div className="shrink-0 rounded-lg bg-success/20 p-2.5 text-success">
                          <CheckCircle2 className="h-5 w-5" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <h3
                              className="truncate text-[14px] font-semibold text-foreground"
                              title={item.document.filename}
                            >
                              {item.document.filename}
                            </h3>
                            <Link href={`/app/batches/${item.batchId}`}>
                              <span className="inline-flex items-center gap-1 rounded-md bg-success/10 border border-success/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-success transition-colors hover:bg-success/20">
                                <Layers className="h-3 w-3" /> Batch #{item.batchId}
                              </span>
                            </Link>
                          </div>
                          <p className="mt-1 text-[12px] font-medium text-muted-foreground">
                            {item.totalFlaggedCount} field
                            {item.totalFlaggedCount === 1 ? "" : "s"} verified
                          </p>
                        </div>
                      </div>

                      <Button
                        asChild
                        variant="outline"
                        size="sm"
                        className="shrink-0 rounded-lg h-8 px-4 border-success/30 text-[12px] font-semibold text-success hover:bg-success/10 hover:text-success"
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
