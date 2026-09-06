import { CheckCircle2, RefreshCw, Clock, AlertTriangle, CircleSlash } from "lucide-react";
import { cn } from "@/lib/utils";

type StatusConfig = {
  label: string;
  className: string;
  icon: React.ComponentType<{ className?: string }>;
  animate?: boolean;
};

const STATUS_CONFIGS: Record<string, StatusConfig> = {
  completed: {
    label: "Done",
    className: "bg-emerald-600 text-white dark:bg-emerald-600 dark:text-white border-emerald-700 shadow-2xs font-semibold",
    icon: CheckCircle2,
  },
  processing: {
    label: "Processing",
    className: "bg-amber-600 text-white dark:bg-amber-600 dark:text-white border-amber-700 shadow-2xs font-semibold",
    icon: RefreshCw,
    animate: true,
  },
  queued: {
    label: "Queued",
    className: "bg-slate-700 text-slate-100 dark:bg-slate-700 dark:text-slate-100 border-slate-600 shadow-2xs font-semibold",
    icon: Clock,
  },
  failed: {
    label: "Failed",
    className: "bg-rose-600 text-white dark:bg-rose-600 dark:text-white border-rose-700 shadow-2xs font-semibold",
    icon: AlertTriangle,
  },
  partial: {
    label: "Partial",
    className: "bg-amber-600 text-white dark:bg-amber-600 dark:text-white border-amber-700 shadow-2xs font-semibold",
    icon: AlertTriangle,
  },
  cancelled: {
    label: "Stopped",
    className: "bg-zinc-700 text-zinc-100 dark:bg-zinc-700 dark:text-zinc-100 border-zinc-600 shadow-2xs font-semibold",
    icon: CircleSlash,
  },
};

export function StatusBadge({ status, title }: { status: string; title?: string }) {
  const config = STATUS_CONFIGS[status] ?? {
    label: status,
    className: "bg-slate-700 text-slate-100 border-slate-600 font-semibold",
    icon: Clock,
  };
  const Icon = config.icon;

  return (
    <div
      title={title}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] leading-tight select-none shrink-0 transition-colors",
        config.className
      )}
    >
      <Icon className={cn("h-3 w-3 shrink-0", config.animate && "animate-spin")} aria-hidden="true" />
      <span>{config.label}</span>
    </div>
  );
}
