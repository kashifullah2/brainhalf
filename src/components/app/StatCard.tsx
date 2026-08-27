import type { ComponentType, ReactNode } from "react";

const TONES = {
  primary: "bg-primary/10 text-primary",
  warning: "bg-warning/10 text-warning",
  success: "bg-success/10 text-success",
  muted: "bg-muted text-muted-foreground",
} as const;

interface StatCardProps {
  label: string;
  value: ReactNode;
  /** Quiet second line: the denominator, a trend, a plain-language aside. */
  hint?: ReactNode;
  icon: ComponentType<{ className?: string }>;
  tone?: keyof typeof TONES;
}

/** One number, named. Used in rows of three or four across the app pages. */
export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "primary",
}: StatCardProps) {
  return (
    <div className="rounded-3xl border border-border/60 bg-card p-6 shadow-sm transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        {/* min-h reserves the second line so the numbers in a row share a
            baseline whether or not a label wraps. */}
        <span className="min-h-[2.25rem] text-xs font-bold uppercase tracking-widest text-muted-foreground">
          {label}
        </span>
        <div className={`shrink-0 rounded-xl p-2 ${TONES[tone]}`}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
      <div className="mt-3 font-mono text-3xl font-black tracking-tight text-foreground">
        {value}
        {hint ? (
          <span className="ml-1 font-sans text-sm font-bold text-muted-foreground">
            {hint}
          </span>
        ) : null}
      </div>
    </div>
  );
}
