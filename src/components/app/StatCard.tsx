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
    <div className={`flex flex-col gap-3 rounded-xl border p-4 ${tone === 'primary' ? 'border-primary/20 bg-primary/5' : tone === 'warning' ? 'border-warning/20 bg-warning/5' : tone === 'success' ? 'border-success/20 bg-success/5' : 'border-border/60 bg-card'}`}>
      <div className="flex items-center justify-between gap-3">
        {/* min-h reserves the second line so the numbers in a row share a
            baseline whether or not a label wraps. */}
        <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground line-clamp-2">
          {label}
        </span>
        <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${TONES[tone]}`}>
          <Icon className="h-3.5 w-3.5" />
        </div>
      </div>
      <div className={`text-3xl font-bold tracking-tight ${tone === 'primary' ? 'text-primary' : tone === 'warning' ? 'text-warning' : tone === 'success' ? 'text-success' : 'text-foreground'}`}>
        {value}
        {hint ? (
          <span className="ml-2 font-sans text-[12px] font-semibold text-muted-foreground">
            {hint}
          </span>
        ) : null}
      </div>
    </div>
  );
}
