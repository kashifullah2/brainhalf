import { MarginNote } from "./MarginNote";

interface SectionHeadingProps {
  /** Ledger-entry eyebrow, e.g. `01 / how it works`. */
  eyebrow?: string;
  title: string;
  subtitle?: string;
}

/**
 * Section intro shared by every marketing band.
 *
 * The page previously ran two heading systems: this one, centered at
 * `font-semibold` with no eyebrow, and the FAQ's left-aligned `font-medium
 * tracking-[-0.035em]` under a MarginNote. Same page, two different ideas of
 * what a section heading is. This is now the single one, and the FAQ uses the
 * same weight and tracking.
 */
export function SectionHeading({ eyebrow, title, subtitle }: SectionHeadingProps) {
  return (
    <div className="mx-auto mb-12 max-w-2xl space-y-3 text-center">
      {eyebrow ? <MarginNote className="mb-4">{eyebrow}</MarginNote> : null}
      <h2 className="animate-fade-up text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
        {title}
      </h2>
      {subtitle ? (
        <p
          className="animate-fade-up text-body-lg text-muted-foreground"
          style={{ animationDelay: "80ms" }}
        >
          {subtitle}
        </p>
      ) : null}
    </div>
  );
}
