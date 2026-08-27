import type { ReactNode } from "react";

/**
 * Local-time greeting. Small thing, but it makes the dashboard feel like it
 * belongs to the person reading it rather than to the database.
 */
export function greeting(date = new Date()): string {
  const hour = date.getHours();
  if (hour < 5) return "Still up";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

interface PageHeaderProps {
  /** Small uppercase line above the title — breadcrumb, greeting, section. */
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** Buttons and filters, right-aligned on wide screens. */
  actions?: ReactNode;
}

/** The one header every app page uses, so titles line up across the product. */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: PageHeaderProps) {
  return (
    // flex-wrap plus a floor on the title's basis is what keeps a wide toolbar
    // from crushing the heading: when the actions no longer fit beside a
    // readable title, the whole actions block wraps to its own line instead of
    // squeezing the description into a two-word column.
    <div className="mb-10 flex flex-wrap items-end justify-between gap-x-8 gap-y-5 border-b border-border/40 pb-8">
      <div className="min-w-0 grow basis-[min(100%,26rem)] space-y-3">
        {eyebrow ? (
          <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-primary">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="text-balance text-3xl font-extrabold tracking-tight text-foreground md:text-4xl lg:text-5xl">
          {title}
        </h1>
        {description ? (
          <p className="max-w-2xl text-base font-medium text-muted-foreground md:text-lg">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex flex-wrap items-center gap-3">{actions}</div>
      ) : null}
    </div>
  );
}
