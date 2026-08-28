import * as React from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/context/AuthContext";
import { Navbar } from "@/components/layout/Navbar";
import { getReviewQueueItems } from "@/lib/review-queue-store";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useToast } from "@/hooks/use-toast";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  FileText,
  LayoutDashboard,
  CheckSquare,
  UploadCloud,
  Settings as SettingsIcon,
  CreditCard,
  LogOut,
  ChevronRight,
  PanelLeft,
  Zap,
} from "lucide-react";
import type { ComponentType } from "react";

interface NavItem {
  title: string;
  url: string;
  icon: ComponentType<{ className?: string }>;
  badge?: number | null;
}

function initialsOf(name?: string, email?: string): string {
  const a = name?.trim();
  if (a) {
    const parts = a.split(/\s+/);
    if (parts.length > 1) return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
    return a.slice(0, 2).toUpperCase();
  }
  return email?.trim().slice(0, 2).toUpperCase() ?? "·";
}

export const AppLayout = React.memo(function AppLayout({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useLocation();
  const { user, logout } = useAuth();
  const { toast } = useToast();
  const [collapsed, setCollapsed] = React.useState(false);
  const [queueCount, setQueueCount] = React.useState<number | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const items = await getReviewQueueItems();
        if (!cancelled) setQueueCount(items.length);
      } catch { /* silent */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleSignOut = async () => {
    try { await logout(); setLocation("/"); }
    catch (error) {
      toast({
        variant: "destructive",
        title: "Could not sign out",
        description: error instanceof Error ? `${error.message} Try again.` : "Check your connection and try again.",
      });
    }
  };

  const navItems: NavItem[] = [
    { title: "Dashboard", url: "/app", icon: LayoutDashboard },
    { title: "Upload", url: "/app/upload", icon: UploadCloud },
    { title: "Review Queue", url: "/app/review-queue", icon: CheckSquare, badge: queueCount },
  ];

  const accountItems: NavItem[] = [
    { title: "Settings", url: "/app/settings", icon: SettingsIcon },
    { title: "Billing", url: "/app/settings/billing", icon: CreditCard },
  ];

  const isActive = (item: NavItem) => {
    if (item.url === "/app") return location === "/app" || location === "/app/";
    return location === item.url || location.startsWith(`${item.url}/`);
  };

  const isAccountActive = (item: NavItem) => {
    if (item.url === "/app/settings/billing") return location === item.url;
    return location.startsWith("/app/settings") && location !== "/app/settings/billing";
  };

  const email = user?.email ?? "";
  const name = user?.name ?? "";
  const initials = initialsOf(name, email);

  return (
    <div className="flex flex-col min-h-screen bg-background">
      <Navbar />
      <div className="flex flex-1 overflow-hidden">
        {/* ── Sidebar ─────────────────────────────────────────── */}
        <aside
          style={{ width: collapsed ? "64px" : "224px" }}
          className="relative flex shrink-0 flex-col border-r border-sidebar-border bg-sidebar transition-[width] duration-200 ease-in-out overflow-hidden z-10"
        >


        {/* Navigation */}
        <nav className="flex flex-1 flex-col gap-0.5 px-2 py-3 overflow-y-auto overflow-x-hidden">

          {/* Section label */}
          {!collapsed && (
            <p className="px-2 pt-1 pb-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-sidebar-foreground/40 select-none">
              Menu
            </p>
          )}

          {navItems.map((item) => {
            const active = isActive(item);
            return (
              <Link key={item.title} href={item.url}>
                <div
                  title={collapsed ? item.title : undefined}
                  className={`
                    group relative flex h-9 items-center gap-2.5 rounded-lg px-2.5 cursor-pointer select-none
                    transition-colors duration-100
                    ${active
                      ? "bg-primary text-primary-foreground"
                      : "text-sidebar-foreground/65 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                    }
                    ${collapsed ? "justify-center px-0" : ""}
                  `}
                >
                  <item.icon className="shrink-0 h-4 w-4" />
                  {!collapsed && (
                    <>
                      <span className="text-[13.5px] font-medium flex-1 whitespace-nowrap">{item.title}</span>
                      {(item.badge ?? 0) > 0 && (
                        <span className={`flex h-4.5 min-w-[1.1rem] items-center justify-center rounded-full px-1 text-[10px] font-bold
                          ${active ? "bg-white/20 text-white" : "bg-primary/15 text-primary"}`}>
                          {item.badge}
                        </span>
                      )}
                    </>
                  )}
                  {collapsed && (item.badge ?? 0) > 0 && (
                    <span className="absolute top-0.5 right-0.5 h-2 w-2 rounded-full bg-primary ring-2 ring-sidebar" />
                  )}
                  {/* Tooltip */}
                  {collapsed && (
                    <div className="pointer-events-none absolute left-full ml-2.5 z-50 origin-left scale-95 opacity-0 group-hover:scale-100 group-hover:opacity-100 transition-all duration-100">
                      <div className="rounded-lg border border-border bg-popover px-2.5 py-1.5 text-[12.5px] font-medium text-popover-foreground shadow-lg whitespace-nowrap">
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
            <div className="my-2 border-t border-sidebar-border/50" />
            {!collapsed && (
              <p className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-sidebar-foreground/40 select-none">
                Account
              </p>
            )}
            {accountItems.map((item) => {
              const active = isAccountActive(item);
              return (
                <Link key={item.title} href={item.url}>
                  <div
                    title={collapsed ? item.title : undefined}
                    className={`
                      group relative flex h-9 items-center gap-2.5 rounded-lg px-2.5 cursor-pointer select-none
                      transition-colors duration-100
                      ${active
                        ? "bg-primary/10 text-primary"
                        : "text-sidebar-foreground/55 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                      }
                      ${collapsed ? "justify-center px-0" : ""}
                    `}
                  >
                    <item.icon className="shrink-0 h-4 w-4" />
                    {!collapsed && <span className="text-[13.5px] font-medium whitespace-nowrap">{item.title}</span>}
                    {collapsed && (
                      <div className="pointer-events-none absolute left-full ml-2.5 z-50 origin-left scale-95 opacity-0 group-hover:scale-100 group-hover:opacity-100 transition-all duration-100">
                        <div className="rounded-lg border border-border bg-popover px-2.5 py-1.5 text-[12.5px] font-medium text-popover-foreground shadow-lg whitespace-nowrap">
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

        {/* Collapse toggle */}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="absolute -right-3 top-6 z-30 flex h-6 w-6 items-center justify-center rounded-full border border-border bg-background shadow-md text-muted-foreground hover:text-foreground hover:border-border/80 transition-all duration-150 hover:scale-110"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          <PanelLeft className={`h-3 w-3 transition-transform duration-200 ${collapsed ? "" : "rotate-180"}`} />
        </button>
      </aside>

      {/* ── Main content ────────────────────────────────────── */}
      <div className="flex flex-col flex-1 min-w-0 z-0">
        {/* Page */}
        <main className="flex-1 overflow-auto bg-muted/10">
          <div className="w-full max-w-7xl px-6 md:px-8 py-7">
            {children}
          </div>
        </main>
      </div>
    </div>
  </div>
  );
});
