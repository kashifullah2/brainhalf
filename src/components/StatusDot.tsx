/**
 * Canonical batch/document status indicator, shared by every page so all
 * views render the same statuses the same way.
 */
const STATUS_STYLES: Record<string, { dot: string; label: string; pulse?: boolean }> = {
  completed: { dot: "bg-success", label: "Done" },
  processing: { dot: "bg-accent", label: "Processing", pulse: true },
  failed: { dot: "bg-destructive", label: "Failed" },
  partial: { dot: "bg-warning", label: "Partial" },
  queued: { dot: "bg-muted-foreground", label: "Queued", pulse: true },
};

export function StatusDot({ status, title }: { status: string; title?: string }) {
  const style = STATUS_STYLES[status] ?? { dot: "bg-muted-foreground", label: status };
  return (
    <div
      className="flex items-center gap-2 text-[11px] font-extrabold text-muted-foreground uppercase tracking-widest"
      title={title}
    >
      <span className={`h-2 w-2 rounded-full shrink-0 ${style.dot} ${style.pulse ? "animate-pulse" : ""}`} />
      <span>{style.label}</span>
    </div>
  );
}

export function StatusChip({ status, title }: { status: string; title?: string }) {
  const map: Record<string, { label: string; cls: string; dot: string }> = {
    completed: { label: "Done",       cls: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800/50", dot: "bg-emerald-500" },
    processing: { label: "Running",   cls: "bg-amber-50  text-amber-700  border-amber-200  dark:bg-amber-950/40  dark:text-amber-400  dark:border-amber-800/50",  dot: "bg-amber-500 animate-pulse"  },
    queued:     { label: "Queued",    cls: "bg-amber-50  text-amber-700  border-amber-200  dark:bg-amber-950/40  dark:text-amber-400  dark:border-amber-800/50",  dot: "bg-amber-400 animate-pulse"  },
    failed:     { label: "Failed",    cls: "bg-red-50    text-red-700    border-red-200    dark:bg-red-950/40    dark:text-red-400    dark:border-red-800/50",    dot: "bg-red-500"   },
    partial:    { label: "Partial",   cls: "bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/40 dark:text-orange-400 dark:border-orange-800/50", dot: "bg-orange-500" },
  };
  const s = map[status] ?? { label: status, cls: "bg-muted text-muted-foreground border-border/60", dot: "bg-muted-foreground" };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${s.cls}`} title={title}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}
