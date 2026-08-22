import React from "react";
import { Link } from "wouter";
import { Navbar } from "@/components/layout/Navbar";
import { usePageTitle } from "@/lib/use-page-title";

export function LegalLayout({ children, title, canonicalPath }: { children: React.ReactNode; title: string; canonicalPath?: string }) {
  usePageTitle(`${title} · BrainHalf`, {
    canonicalPath,
    noindex: false,
  });
  return (
    <div className="min-h-screen bg-background font-sans text-foreground">
      <Navbar />

      {/* Content */}
      <main className="container max-w-4xl mx-auto px-4 md:px-6 py-12 md:py-20">
        <div className="space-y-8">
          <div className="space-y-2 border-b border-border/40 pb-8">
            <h1 className="text-3xl font-extrabold tracking-tight lg:text-4xl">{title}</h1>
            <p className="text-muted-foreground">Last updated: August 2026</p>
          </div>
          <div className="prose prose-slate dark:prose-invert max-w-none prose-headings:font-bold prose-h2:text-2xl prose-h3:text-xl">
            {children}
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-border/40 py-6 md:py-0 bg-muted/20 mt-12">
        <div className="container flex flex-col items-center justify-between gap-4 md:h-16 md:flex-row px-4 md:px-6">
          <p className="text-center text-sm leading-loose text-muted-foreground md:text-left">
            Built by <Link href="/" className="font-medium underline underline-offset-4">brainhalf</Link>. All rights reserved.
          </p>
          <div className="flex gap-4 text-sm font-medium text-muted-foreground">
            <Link href="/privacy" className="hover:text-foreground">Privacy</Link>
            <Link href="/terms" className="hover:text-foreground">Terms</Link>
            <Link href="/contact" className="hover:text-foreground">Contact</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
