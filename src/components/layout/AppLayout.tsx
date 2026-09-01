import * as React from "react";
import { Link, useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  QUEUE_CHANGED_EVENT,
  getAwaitingReviewCount,
} from "@/lib/review-queue-store";
import { useIsMobile } from "@/hooks/use-mobile";
import { useMobileNav } from "@/components/layout/mobile-nav";
import { cn } from "@/lib/utils";
import {
  FileText,
  LayoutDashboard,
  CheckSquare,
  UploadCloud,
  Settings as SettingsIcon,
  CreditCard,
  PanelLeft,
} from "lucide-react";
import type { ComponentType } from "react";

interface NavItem {
  title: string;
  url: string;
  icon: ComponentType<{ className?: string }>;
  badge?: number | null;
  /** Names what the badge counts, for a tooltip and for screen readers. */
  badgeNoun?: string;
}

export const AppLayout = React.memo(function AppLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation(); // setLocation was never used here
  const isMobile = useIsMobile();
  const mobileNav = useMobileNav();
  const isDrawerOpen = !!mobileNav?.isOpen;

  /**
   * Desktop only: the rail can be narrowed to icons.
   *
   * On a phone this used to be the whole story — the sidebar collapsed to a
   * permanent 64px icon rail, spending 17% of a 375px viewport on unlabelled
   * chrome that could not be dismissed. Below 768px it is an off-canvas drawer
   * instead, always labelled, and the page gets the full width.
   */
  const [collapsed, setCollapsed] = React.useState(false);
  // Icons-only applies to the desktop rail. Inside the drawer the labels are
  // the point, so `collapsed` is ignored there.
  const isRail = !isMobile && collapsed;
  const queryClient = useQueryClient();

  /**
   * The sidebar badge.
   *
   * Two rounds of the same mistake, both fixed. It began as a bare useEffect keyed
   * on `location`, so every navigation refetched; useQuery made it cached and
   * deduped. But what it fetched was still the ENTIRE review queue — paged 100
   * documents at a time, up to fifty sequential requests, each joining
   * document_fields and grouping in Worker memory — to render one integer. It now
   * asks the endpoint for the count, which answers it with a single
   * COUNT(DISTINCT ...) over idx_fields_review.
   *
   * placeholderData keeps the last known count on screen while a refetch is in
   * flight, and a failed fetch leaves the previous value rather than blanking
   * the badge.
   */
  const { data: queueCount = null } = useQuery({
    queryKey: ["review-queue", "awaiting-count"],
    queryFn: getAwaitingReviewCount,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    placeholderData: (previous) => previous,
    retry: false,
  });

  React.useEffect(() => {
    const onQueueChanged = () => {
      void queryClient.invalidateQueries({ queryKey: ["review-queue", "awaiting-count"] });
    };
    window.addEventListener(QUEUE_CHANGED_EVENT, onQueueChanged);
    return () => window.removeEventListener(QUEUE_CHANGED_EVENT, onQueueChanged);
  }, [queryClient]);

  // One active-route rule for both nav groups. Previously Settings lit up on
  // /app/settings/billing/invoices while Billing itself went dark.
  const isRouteActive = (url: string) => {
    if (url === "/app") return location === "/app" || location === "/app/";
    if (url === "/app/settings/billing") return location === url || location.startsWith(`${url}/`);
    if (url === "/app/settings") {
      return (
        (location === "/app/settings" || location.startsWith("/app/settings/")) &&
        !location.startsWith("/app/settings/billing")
      );
    }
    return location === url || location.startsWith(`${url}/`);
  };

  const navItems: NavItem[] = [
    { title: "Dashboard", url: "/app", icon: LayoutDashboard },
    { title: "Upload", url: "/app/upload", icon: UploadCloud },
    {
      title: "Review Queue",
      url: "/app/review-queue",
      icon: CheckSquare,
      badge: queueCount,
      badgeNoun: "awaiting review",
    },
    { title: "Templates", url: "/app/templates", icon: FileText },
  ];

  const accountItems: NavItem[] = [
    { title: "Settings", url: "/app/settings", icon: SettingsIcon },
    { title: "Billing", url: "/app/settings/billing", icon: CreditCard },
  ];

  return (
    /* min-h is the viewport MINUS the header, which is now a sibling above this
       subtree. Left at 100dvh it would have guaranteed a header's worth of
       pointless scroll on every app page. */
    <div className="flex min-h-[calc(100dvh-var(--header-h))] flex-col bg-background">
      {/* `overflow-hidden` used to sit on this row. It creates a scroll
          container, which silently disables `position: sticky` for every
          descendant — including the sidebar below and any sticky table header
          a page might add. The window is the scroller. */}
      <div className="flex flex-1">
        {/* ── Sidebar ─────────────────────────────────────────── */}
        {/* Sticky under the navbar rather than in normal flow. In flow the aside
            stretched to the full content height, so its `mt-auto` Account block
            drifted further down the taller the page got — Settings and Billing
            sat 9px lower on the review screen than on the dashboard. */}
        {/* Backdrop for the mobile drawer. Tapping it dismisses, which is the
            gesture people try first. */}
        {isDrawerOpen && (
          <div
            aria-hidden
            onClick={mobileNav?.close}
            className="fixed inset-x-0 bottom-0 top-[var(--header-h)] z-30 bg-foreground/40 md:hidden"
          />
        )}

        <aside
          id="app-sidebar"
          /* The rail width is a desktop concern; on mobile the panel width is a
             class, so the inline style must not fight it. */
          style={isMobile ? undefined : { width: collapsed ? "64px" : "224px" }}
          className={cn(
            "z-40 flex h-[calc(100dvh-var(--header-h))] shrink-0 flex-col border-r border-sidebar-border bg-sidebar",
            // Mobile: off-canvas panel. `invisible` when closed keeps its links
            // out of the tab order rather than leaving a screenful of hidden
            // focus stops to the left of the viewport.
            "fixed left-0 top-[var(--header-h)] w-[264px] transition-transform duration-200 ease-out",
            isDrawerOpen ? "translate-x-0 shadow-xl" : "invisible -translate-x-full",
            /* Desktop: back to the in-flow sticky rail. Sticky rather than in
               normal flow because in flow the aside stretched to the full
               content height, so its `mt-auto` Account block drifted further
               down the taller the page got — Settings and Billing sat 9px lower
               on the review screen than on the dashboard. */
            "md:visible md:sticky md:z-20 md:w-auto md:translate-x-0 md:self-start md:shadow-none md:transition-[width] md:duration-200 md:ease-in-out",
          )}
        >
          {/* Navigation */}
          <nav className="flex flex-1 flex-col gap-0.5 px-2 py-3 pb-8 overflow-y-auto overflow-x-hidden">
            {/* Section label */}
            {!isRail && (
              <p className="px-2 pt-1 pb-2 text-micro font-semibold uppercase tracking-[0.1em] text-sidebar-foreground/40 select-none">
                Menu
              </p>
            )}

            {navItems.map((item) => {
              const active = isRouteActive(item.url);
              return (
                // FIX: aria-current + keyboard focus ring; removed the title
                // attr (it fought with the custom tooltip → double tooltip)
                <Link
                  key={item.title}
                  href={item.url}
                  aria-current={active ? "page" : undefined}
                  className="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar"
                >
                  <div
                    className={`
                      group relative flex h-9 items-center gap-2.5 rounded-lg px-2.5 cursor-pointer select-none
                      transition-colors duration-100
                      ${active
                        ? "bg-primary text-primary-foreground"
                        : "text-sidebar-foreground/65 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                      }
                      ${isRail ? "justify-center px-0" : ""}
                    `}
                  >
                    <item.icon className="shrink-0 h-4 w-4" />
                    {!isRail && (
                      <>
                        <span className="text-body-sm font-medium flex-1 whitespace-nowrap">{item.title}</span>
                        {(item.badge ?? 0) > 0 && (
                          // FIX: h-4.5 doesn't exist in Tailwind → h-[18px]
                          <span
                            title={item.badgeNoun ? `${item.badge} ${item.badgeNoun}` : undefined}
                            aria-label={item.badgeNoun ? `${item.badge} ${item.badgeNoun}` : undefined}
                            className={`flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-micro font-semibold
                            ${active ? "bg-white/20 text-white" : "bg-primary/15 text-primary"}`}
                          >
                            {item.badge}
                          </span>
                        )}
                      </>
                    )}
                    {isRail && (item.badge ?? 0) > 0 && (
                      <span className="absolute top-0.5 right-0.5 h-2 w-2 rounded-full bg-primary ring-2 ring-sidebar" />
                    )}
                    {/* Tooltip */}
                    {isRail && (
                      <div className="pointer-events-none absolute left-full ml-2.5 z-50 origin-left scale-95 opacity-0 group-hover:scale-100 group-hover:opacity-100 transition-all duration-100">
                        <div className="rounded-lg border border-border bg-popover px-2.5 py-1.5 text-label font-medium text-popover-foreground shadow-lg whitespace-nowrap">
                          {item.title}
                        </div>
                      </div>
                    )}
                  </div>
                </Link>
              );
            })}

            {/* Account items — pushed to bottom */}
            <div className="mt-auto">
              {!isRail && (
                <div className="mx-2 mb-4 rounded-xl border border-border/60 bg-card p-3 shadow-sm">
                  <p className="text-body-sm font-semibold text-foreground">Need help?</p>
                  <p className="mt-1 text-caption text-muted-foreground leading-snug">Read the docs or reach out to our team.</p>
                  <Link href="/contact" className="mt-2 inline-block text-label font-semibold text-primary hover:underline">
                    Contact Support &rarr;
                  </Link>
                </div>
              )}
              <div className="my-2 border-t border-sidebar-border/50" />
              {!isRail && (
                <p className="px-2 pb-2 text-micro font-semibold uppercase tracking-[0.1em] text-sidebar-foreground/40 select-none">
                  Account
                </p>
              )}
              {accountItems.map((item) => {
                const active = isRouteActive(item.url);
                return (
                  <Link
                    key={item.title}
                    href={item.url}
                    aria-current={active ? "page" : undefined}
                    className="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar"
                  >
                    <div
                      className={`
                        group relative flex h-9 items-center gap-2.5 rounded-lg px-2.5 cursor-pointer select-none
                        transition-colors duration-100
                        ${active
                          ? "bg-primary/10 text-primary"
                          : "text-sidebar-foreground/55 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                        }
                        ${isRail ? "justify-center px-0" : ""}
                      `}
                    >
                      <item.icon className="shrink-0 h-4 w-4" />
                      {!isRail && <span className="text-body-sm font-medium whitespace-nowrap">{item.title}</span>}
                      {isRail && (
                        <div className="pointer-events-none absolute left-full ml-2.5 z-50 origin-left scale-95 opacity-0 group-hover:scale-100 group-hover:opacity-100 transition-all duration-100">
                          <div className="rounded-lg border border-border bg-popover px-2.5 py-1.5 text-label font-medium text-popover-foreground shadow-lg whitespace-nowrap">
                            {item.title}
                          </div>
                        </div>
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>
          </nav>

          {/* Rail toggle. Desktop only: on mobile the drawer is dismissed from
              the header button or the backdrop, and a 24px tab hanging off the
              panel edge is not a touch target. */}
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            className="absolute -right-3 top-6 z-30 hidden h-6 w-6 items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-md transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:flex"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!collapsed}
            aria-controls="app-sidebar"
          >
            <PanelLeft
              className={`h-3 w-3 transition-transform duration-200 ${collapsed ? "" : "rotate-180"}`}
            />
          </button>
        </aside>

        {/* ── Main content ────────────────────────────────────── */}
        {/* No `z-0` here. A z-index on a flex item creates a stacking context,
            and it trapped every overlay a page renders — the document side
            panel, the bulk-action bar — underneath the z-50 navbar and the
            sidebar. It is why the side panel's own header and close button
            were hidden behind the navbar, and why neither the navbar nor the
            sidebar ever dimmed behind it. */}
        <div className="flex min-w-0 flex-1 flex-col">
          <main id="main-content" className="flex-1 bg-muted/10 flex justify-center">
            {/* The single content container for every app page. Pages used to
                add their own max-w-5xl / max-w-6xl wrappers on top of this one,
                giving four different frame widths across seven screens. */}
            <div className="w-full max-w-[1200px] px-6 py-7 md:px-8">
              {children}
            </div>
          </main>
        </div>
      </div>
    </div>
  );
});
