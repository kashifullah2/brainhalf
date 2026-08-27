import type { ReactNode } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Failure card. Says what broke and offers the one useful next action rather
 * than dead-ending on an error code.
 */
export function ErrorState({
  title = "That didn't load",
  body,
  onRetry,
}: {
  title?: string;
  body: ReactNode;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-3xl border border-destructive/20 bg-destructive/5 p-8 text-center shadow-sm">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
        <AlertCircle className="h-6 w-6" />
      </div>
      <div className="space-y-1">
        <h3 className="text-lg font-bold text-foreground">{title}</h3>
        <p className="text-sm font-medium text-muted-foreground">{body}</p>
      </div>
      {onRetry ? (
        <Button variant="outline" className="rounded-full" onClick={onRetry}>
          <RefreshCw className="mr-2 h-4 w-4" /> Try again
        </Button>
      ) : null}
    </div>
  );
}

/**
 * Row-shaped loading placeholder. Mirrors the real list geometry so the page
 * does not jump when the data lands.
 */
export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="overflow-hidden rounded-3xl border border-border/60 bg-card shadow-sm">
      <div className="divide-y divide-border/40">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-center gap-4 p-5">
            <Skeleton className="h-5 w-5 shrink-0 rounded" />
            <Skeleton className="h-14 w-14 shrink-0 rounded-xl" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-48" />
            </div>
            <Skeleton className="hidden h-2 w-32 rounded-full sm:block lg:w-48" />
          </div>
        ))}
      </div>
    </div>
  );
}
