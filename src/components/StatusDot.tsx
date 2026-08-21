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
