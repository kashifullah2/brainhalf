import type { ComponentType, ReactNode } from "react";

/**
 * The icon tile's tint. Every caller already passed a `tone`; the prop was
 * accepted, destructured and then never used, so a "Failed" card and a
 * "Completed" card were rendered identically and this table was dead.
 */
const TONES = {
  primary: "bg-primary/10 text-primary border border-primary/20",
  warning: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30",
  success: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30",
  destructive: "bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/30",
  muted: "bg-muted text-muted-foreground border border-border/50",
} as const;

interface StatCardProps {
  label: string;
  value: ReactNode;
  /** Quiet second line: the denominator, a trend, a plain-language aside. */
  hint?: ReactNode;
  icon: ComponentType<{ className?: string }>;
  tone?: keyof typeof TONES;
}

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "primary",
}: StatCardProps) {
  return (
    <div className="flex h-full flex-col gap-4 rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <span className="text-body-sm font-semibold text-muted-foreground">
          {label}
        </span>
        <span
          aria-hidden
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${TONES[tone]}`}
        >
          <Icon className="h-3.5 w-3.5" />
        </span>
      </div>
      <div className="mt-auto flex flex-wrap items-baseline gap-x-2 font-sans font-bold text-3xl tracking-tight text-foreground">
        {value}
        {hint ? (
          <span className="font-sans text-body-sm font-medium text-muted-foreground">
            {hint}
          </span>
        ) : null}
      </div>
    </div>
  );
}
