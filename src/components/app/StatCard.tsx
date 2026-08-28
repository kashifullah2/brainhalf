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
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        {/* min-h reserves the second line so the numbers in a row share a
            baseline whether or not a label wraps. */}
        <span className="text-sm font-medium text-muted-foreground line-clamp-2">
          {label}
        </span>
        <Icon className="h-4 w-4 text-muted-foreground/50" />
      </div>
      <div className="text-4xl font-serif text-foreground">
        {value}
        {hint ? (
          <span className="ml-2 font-sans text-sm font-medium text-muted-foreground">
            {hint}
          </span>
        ) : null}
      </div>
    </div>
  );
}
