import { Link } from "wouter";
import { FileText } from "lucide-react";

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
            <div className="mb-4 flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
                <FileText className="h-4 w-4" />
              </div>
              <span className="text-xl font-semibold tracking-tight">
                brain<span className="font-bold text-primary">half</span>
              </span>
            </div>
            <p className="max-w-xs text-sm font-medium leading-relaxed text-muted-foreground">
              Automate your data entry workflows. Turn messy stacks of vendor
              receipts and invoices into clean, structured data instantly.
            </p>
          </div>

          {LINK_GROUPS.map((group) => (
            <div key={group.heading} className="space-y-4">
              <h4 className="text-sm font-bold uppercase tracking-wide text-foreground">
                {group.heading}
              </h4>
              <ul className="space-y-3 text-sm font-medium text-muted-foreground">
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

        <div className="flex flex-col items-center justify-between gap-4 border-t border-border/40 pt-8 text-xs font-medium text-muted-foreground sm:flex-row">
          <span>© 2026 brainhalf. All rights reserved.</span>
          <span>
            AI document extraction for invoices, receipts &amp; documents.
          </span>
        </div>
      </div>
    </footer>
  );
}
