import { Link } from "wouter";

import { openAnalyticsConsentSettings } from "@/components/AnalyticsConsent";

const LINK_GROUPS = [
  {
    heading: "Product",
    links: [
      { href: "/app", label: "Dashboard" },
      { href: "/app/upload", label: "Extraction Engine" },
    ],
  },
  {
    heading: "Company",
    links: [
      { href: "/privacy", label: "Privacy Policy" },
      { href: "/terms", label: "Terms of Service" },
      { href: "/contact", label: "Contact Us" },
    ],
  },
];

/** Marketing-surface footer. Shared by the landing page and legal pages. */
export function SiteFooter() {
  return (
    <footer className="border-t border-border/40 bg-background py-12">
      <div className="container mx-auto max-w-7xl px-6 md:px-8">
        <div className="mb-12 grid grid-cols-1 gap-8 sm:grid-cols-2 md:grid-cols-4">
          <div className="col-span-1 space-y-4 sm:col-span-2">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white p-1.5 shadow-sm ring-1 ring-border/60 dark:ring-white/30">
                <img
                  src="/apple-touch-icon.png"
                  alt="BrainHalf Logo"
                  className="h-full w-full object-contain rounded-md"
                />
              </div>
              <span className="text-2xl font-bold tracking-tight text-foreground">
                <span className="font-semibold text-foreground">brain</span>
                <span className="font-extrabold text-primary">half</span>
              </span>
            </div>
            <p className="max-w-xs text-body font-medium leading-relaxed text-foreground/70">
              Automate your data entry workflows. Turn messy stacks of vendor
              receipts and invoices into clean, structured data instantly.
            </p>
          </div>

          {LINK_GROUPS.map((group) => (
            <div key={group.heading} className="space-y-4">
              <h4 className="text-micro font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                {group.heading}
              </h4>
              <ul className="space-y-3 text-body font-medium text-muted-foreground">
                {group.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="transition-colors hover:text-primary"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="flex flex-col items-center justify-between gap-4 border-t border-border/40 pt-8 text-label font-medium text-muted-foreground sm:flex-row">
          <span>© 2026 brainhalf. All rights reserved.</span>
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
            {/* Withdrawing consent has to be as easy as giving it, and there was
                no control anywhere in the product to do it -- the banner asked
                once and never came back. */}
            <button
              type="button"
              onClick={openAnalyticsConsentSettings}
              className="font-medium underline-offset-4 transition-colors hover:text-primary hover:underline"
            >
              Cookie settings
            </button>
            <span aria-hidden="true" className="hidden sm:inline">
              ·
            </span>
            <span>
              AI document extraction for invoices, receipts &amp; documents.
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
}
