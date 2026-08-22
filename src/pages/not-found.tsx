import { Link } from "wouter";
import { FileQuestion, ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { usePageTitle } from "@/lib/use-page-title";

export default function NotFound() {
  usePageTitle("404 Page not found · BrainHalf", { noindex: true });
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-24 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
        <FileQuestion className="h-8 w-8" />
      </div>

      <h1 className="mt-6 text-3xl font-extrabold tracking-tight text-foreground">
        This page doesn't exist
      </h1>
      <p className="mt-3 max-w-md text-base font-medium leading-relaxed text-muted-foreground">
        The link may be out of date, or the page may have moved. Your batches and
        extracted data are unaffected.
      </p>

      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Button asChild className="h-11 rounded-full px-6 text-xs font-bold uppercase tracking-wide">
          <Link href="/app">
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to dashboard
          </Link>
        </Button>
        <Button
          asChild
          variant="outline"
          className="h-11 rounded-full px-6 text-xs font-bold uppercase tracking-wide border-border/60"
        >
          <Link href="/contact">Contact support</Link>
        </Button>
      </div>
    </div>
  );
}
