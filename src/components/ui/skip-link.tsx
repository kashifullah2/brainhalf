import { cn } from "@/lib/utils";

interface SkipLinkProps {
  targetId?: string;
  className?: string;
  children: React.ReactNode;
}

/**
 * "Skip to main content" link.
 *
 * Hidden visually until it receives keyboard focus, then shown at the top-left
 * of the viewport. This lets keyboard and screen-reader users bypass repeated
 * navigation and jump straight to the primary content.
 */
export function SkipLink({ targetId = "main-content", className, children }: SkipLinkProps) {
  return (
    <a
      href={`#${targetId}`}
      className={cn(
        "sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 z-[100]",
        "rounded-lg bg-primary px-4 py-2 text-body-sm font-semibold text-primary-foreground shadow-lg",
        "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background",
        className
      )}
    >
      {children}
    </a>
  );
}
