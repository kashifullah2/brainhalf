import { Link } from "wouter";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * The back affordance on every detail page. Three pages each had their own
 * version — differing in size, border opacity and hover colour — and none of
 * them carried an accessible name, so all a screen reader announced was
 * "button".
 */
export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Button
      variant="outline"
      size="icon"
      asChild
      className="mt-0.5 h-9 w-9 shrink-0 rounded-lg bg-card"
    >
      <Link href={href} aria-label={label}>
        <ArrowLeft className="h-4 w-4" />
      </Link>
    </Button>
  );
}
