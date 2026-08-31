import type { ComponentType, ReactNode } from "react";

/**
 * The icon tile's tint. Every caller already passed a `tone`; the prop was
 * accepted, destructured and then never used, so a "Failed" card and a
 * "Completed" card were rendered identically and this table was dead.
 */
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

/**
 * One number, named. Used in rows of three or four across the app pages.
 *
 * Heights are equalised by the grid, not by reserving space: `h-full` plus
 * `mt-auto` on the value means a row of cards whose labels all fit on one line
 * is one line tall, and a row where one label wraps grows all four together
 * with the numbers still sharing a baseline. The previous version reserved two
 * label lines unconditionally, so every card in the product carried ~22px of
 * dead space above its number whether it needed it or not.
 */
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
        <span className="text-body-sm font-medium text-muted-foreground">
          {label}
        </span>
        <span
          aria-hidden
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${TONES[tone]}`}
        >
          <Icon className="h-3.5 w-3.5" />
        </span>
      </div>
      <div className="mt-auto flex flex-wrap items-baseline gap-x-2 font-serif text-3xl text-foreground">
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
