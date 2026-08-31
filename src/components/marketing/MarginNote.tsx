import type { ReactNode } from "react";

/**
 * The landing page's ledger-entry eyebrow (`02 / how it works`).
 *
 * Uppercase is kept deliberately here and only here: at 10-11px with widened
 * tracking it reads as a printed marginal annotation, which is the page's whole
 * conceit. Everywhere else in the product ALL-CAPS was removed.
 */
export function MarginNote({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <p
      className={`font-data text-caption uppercase tracking-[0.14em] text-primary ${className}`}
    >
      {children}
    </p>
  );
}
