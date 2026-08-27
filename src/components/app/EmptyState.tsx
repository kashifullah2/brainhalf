import type { ComponentType, ReactNode } from "react";

interface EmptyStateProps {
  icon: ComponentType<{ className?: string }>;
  title: string;
  body: ReactNode;
  action?: ReactNode;
  /** Tighter padding for empties that sit inside an existing card. */
  inset?: boolean;
}

/**
 * Shared empty state. The tile is deliberately hand-drawn-looking — dashed and
 * slightly rotated — so a page with nothing in it still feels made by someone.
 */
export function EmptyState({
  icon: Icon,
  title,
  body,
  action,
  inset = false,
}: EmptyStateProps) {
  return (
    <div
      className={`mx-auto flex max-w-lg flex-col items-center justify-center text-center ${
        inset ? "py-20" : "py-28"
      }`}
    >
      <div className="mb-8 flex h-24 w-24 rotate-3 items-center justify-center rounded-[2rem] border-2 border-dashed border-border/60 bg-card text-muted-foreground shadow-sm">
        <Icon className="h-10 w-10" />
      </div>
      <h3 className="mb-4 text-balance text-2xl font-extrabold tracking-tight text-foreground sm:text-3xl">
        {title}
      </h3>
      <p className="text-base font-medium leading-relaxed text-muted-foreground">
        {body}
      </p>
      {action ? <div className="mt-8">{action}</div> : null}
    </div>
  );
}
