import { Link } from "wouter";
import { FileQuestion, ArrowLeft } from "lucide-react";

import { EmptyState } from "@/components/app";
import { Button } from "@/components/ui/button";
import { usePageTitle } from "@/lib/use-page-title";

export default function NotFound() {
  usePageTitle("404 Page not found · BrainHalf", { noindex: true });
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6">
      <EmptyState
        icon={FileQuestion}
        title="We looked, it isn't here."
        body="The link may be out of date, or the page may have moved. Your batches and extracted data are exactly where you left them."
        action={
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Button
              asChild
              className="h-11 rounded-full px-6 text-sm font-semibold"
            >
              <Link href="/app">
                <ArrowLeft className="mr-2 h-4 w-4" /> Back to dashboard
              </Link>
            </Button>
            <Button
              asChild
              variant="outline"
              className="h-11 rounded-full border-border/60 px-6 text-sm font-semibold"
            >
              <Link href="/contact">Tell us what you were after</Link>
            </Button>
          </div>
        }
      />
    </div>
  );
}
