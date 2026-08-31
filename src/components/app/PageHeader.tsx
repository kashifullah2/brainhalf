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
  /** Small line above the title — breadcrumb, greeting, section name. */
  eyebrow?: ReactNode;
  title: ReactNode;
  /** Sits inline after the title: a status badge, a batch chip. */
  titleAdornment?: ReactNode;
  description?: ReactNode;
  /** Buttons and filters, right-aligned on wide screens. */
  actions?: ReactNode;
  /** A back link, rendered to the left of the whole block. */
  back?: ReactNode;
  /**
   * `page` is the display step for a destination (Dashboard, Review Queue,
   * Settings). `detail` is a step down, for a record whose title is a filename
   * or an id and should not dominate the screen it labels.
   */
  size?: "page" | "detail";
  titleClassName?: string;
  /** Pass `mb-0` when the parent container already supplies a gap. */
  className?: string;
}

const TITLE_SIZE = {
  page: "text-3xl md:text-4xl",
  detail: "text-2xl md:text-3xl",
} as const;

/**
 * The one header every app page uses, so titles line up across the product.
 *
 * Four pages previously hand-rolled their own `h1` instead — which is how the
 * app ended up with six different title treatments across three font weights,
 * two of them weights the loaded fonts do not contain.
 */
export function PageHeader({
  eyebrow,
  title,
  titleAdornment,
  description,
  actions,
  back,
  size = "page",
  titleClassName = "",
  className = "",
}: PageHeaderProps) {
  return (
    // items-start, not items-end: bottom-aligning the toolbar pinned it to the
    // description's last line, so "Configure Threshold" and "Return to
    // Dashboard" floated well below the heading they belonged to.
    //
    // flex-wrap plus a floor on the title's basis is what keeps a wide toolbar
    // from crushing the heading: when the actions no longer fit beside a
    // readable title, the whole actions block wraps to its own line instead of
    // squeezing the description into a two-word column.
    <div
      className={`mb-6 flex flex-wrap items-start justify-between gap-x-8 gap-y-4 border-b border-border/40 pb-5 ${className}`}
    >
      <div className="flex min-w-0 grow basis-[min(100%,26rem)] items-start gap-4">
        {back}
        <div className="min-w-0 space-y-1.5">
          {eyebrow ? (
            <p className="flex items-center gap-2 text-body-sm font-medium text-muted-foreground">
              {eyebrow}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h1
              className={`text-balance font-sans font-bold tracking-tight text-foreground ${TITLE_SIZE[size]} ${titleClassName}`}
            >
              {title}
            </h1>
            {titleAdornment}
          </div>
          {description ? (
            <p className="max-w-2xl text-body font-medium text-muted-foreground md:text-body-lg">
              {description}
            </p>
          ) : null}
        </div>
      </div>
      {actions ? (
        <div className="flex flex-wrap items-center gap-3">{actions}</div>
      ) : null}
    </div>
  );
}
