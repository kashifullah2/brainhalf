import React from "react";
import { SiteFooter } from "@/components/marketing";
import { usePageTitle } from "@/lib/use-page-title";

export function LegalLayout({ children, title, canonicalPath }: { children: React.ReactNode; title: string; canonicalPath?: string }) {
  usePageTitle(`${title} · BrainHalf`, {
    canonicalPath,
    noindex: false,
  });
  return (
    <div className="min-h-[calc(100dvh-var(--header-h))] bg-background font-sans text-foreground">
      {/* Content */}
      <main className="container max-w-4xl mx-auto px-4 md:px-6 py-12 md:py-20">
        <div className="space-y-8">
          <div className="space-y-2 border-b border-border/40 pb-8">
            <h1 className="text-3xl font-semibold tracking-tight lg:text-4xl">{title}</h1>
            <p className="text-muted-foreground">Last updated: August 2026</p>
          </div>
          {/* prose-slate brought Tailwind Typography's cool grey ramp onto a warm
              palette, so the legal pages' body copy read faintly blue against
              every other page. Bound to our own tokens instead. */}
          <div className="prose max-w-none prose-headings:font-semibold prose-headings:text-foreground prose-p:text-muted-foreground prose-li:text-muted-foreground prose-strong:text-foreground prose-a:text-primary prose-h2:text-2xl prose-h3:text-xl">
            {children}
          </div>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
