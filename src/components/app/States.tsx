import type { ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export function ErrorState({
  title = "Something went wrong",
  body,
  onRetry,
}: { title?: string; body: ReactNode; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-destructive/20 bg-destructive/5 p-8 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
        <AlertTriangle className="h-5 w-5" />
      </div>
      <div className="space-y-1">
        <h3 className="text-[14px] font-semibold text-foreground">{title}</h3>
        <p className="text-[13px] text-muted-foreground">{body}</p>
      </div>
      {onRetry && (
        <Button variant="outline" size="sm" className="rounded-lg h-8 text-[12.5px]" onClick={onRetry}>
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Try again
        </Button>
      )}
    </div>
  );
}

export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border/60 bg-card shadow-sm">
      <div className="divide-y divide-border/50">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3 animate-pulse">
            <Skeleton className="h-3.5 w-3.5 shrink-0 rounded" />
            <Skeleton className="h-10 w-10 shrink-0 rounded-lg" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3 w-28 rounded-full" />
              <Skeleton className="h-2.5 w-40 rounded-full" />
            </div>
            <Skeleton className="hidden sm:block h-1 w-28 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
