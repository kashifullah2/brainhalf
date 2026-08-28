import * as React from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/context/AuthContext";
import { ThemeToggle } from "@/components/theme-toggle";
import { toast } from "@/hooks/use-toast";
import { getReviewQueueItems } from "@/lib/review-queue-store";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
    <div className="flex min-h-screen bg-background">

      {/* ── Sidebar ─────────────────────────────────────────── */}
      <aside
        style={{ width: collapsed ? "64px" : "224px" }}
        className="relative flex shrink-0 flex-col border-r border-sidebar-border bg-sidebar transition-[width] duration-200 ease-in-out overflow-hidden"
      >

        {/* Logo row */}
        <div className={`flex h-14 items-center border-b border-sidebar-border/60 transition-all duration-200 ${collapsed ? "justify-center px-0" : "gap-2.5 px-4"}`}>
          <div className="flex shrink-0 h-7 w-7 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
            <FileText className="h-3.5 w-3.5" />
          </div>
          {!collapsed && (
            <span className="text-[15px] font-bold tracking-tight text-sidebar-foreground select-none whitespace-nowrap">
              brain<span className="text-primary">half</span>
            </span>
          )}
        </div>

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

        {/* User footer */}
        <div className="border-t border-sidebar-border/60 p-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className={`group flex h-10 w-full items-center gap-2.5 rounded-lg px-2 hover:bg-sidebar-accent transition-colors ${collapsed ? "justify-center px-0" : ""}`}>
                <Avatar className="h-6 w-6 shrink-0 rounded-full ring-1 ring-border/50">
                  <AvatarImage src={user?.picture || undefined} alt={name || "Avatar"} />
                  <AvatarFallback className="rounded-full bg-primary/10 text-primary text-[10px] font-bold">{initials}</AvatarFallback>
                </Avatar>
                {!collapsed && (
                  <>
                    <div className="min-w-0 flex-1 text-left">
                      <p className="truncate text-[12.5px] font-semibold text-sidebar-foreground leading-tight">{name || "You"}</p>
                      <p className="truncate text-[11px] text-sidebar-foreground/45 leading-tight">{email}</p>
                    </div>
                    <ChevronRight className="h-3 w-3 text-sidebar-foreground/30 shrink-0" />
                  </>
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-56 rounded-xl border-border/70 shadow-xl" align="end" side="right" sideOffset={8} forceMount>
              <DropdownMenuLabel className="font-normal px-3 py-2.5">
                <div className="flex items-center gap-2.5">
                  <Avatar className="h-8 w-8 rounded-full">
                    <AvatarImage src={user?.picture || undefined} alt={name || ""} />
                    <AvatarFallback className="bg-primary/10 text-primary font-bold text-xs">{initials}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold text-foreground truncate">{name || "You"}</p>
                    <p className="text-[11px] text-muted-foreground truncate">{email}</p>
                  </div>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild className="cursor-pointer rounded-lg mx-1 text-[13px]">
                <Link href="/app/settings" className="flex w-full items-center"><SettingsIcon className="mr-2 h-3.5 w-3.5" />Settings</Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild className="cursor-pointer rounded-lg mx-1 text-[13px]">
                <Link href="/app/settings/billing" className="flex w-full items-center"><CreditCard className="mr-2 h-3.5 w-3.5" />Billing</Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleSignOut} className="cursor-pointer text-destructive focus:bg-destructive/10 focus:text-destructive rounded-lg mx-1 mb-1 text-[13px]">
                <LogOut className="mr-2 h-3.5 w-3.5" />Log out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Collapse toggle */}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="absolute -right-3 top-[52px] z-30 flex h-6 w-6 items-center justify-center rounded-full border border-border bg-background shadow-md text-muted-foreground hover:text-foreground hover:border-border/80 transition-all duration-150 hover:scale-110"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          <PanelLeft className={`h-3 w-3 transition-transform duration-200 ${collapsed ? "" : "rotate-180"}`} />
        </button>
      </aside>

      {/* ── Main content ────────────────────────────────────── */}
      <div className="flex flex-col flex-1 min-w-0">

        {/* Topbar */}
        <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center justify-between border-b border-border/60 bg-background/90 backdrop-blur-sm px-5">
          <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
            <Zap className="h-3.5 w-3.5 text-primary" />
            <span className="font-semibold text-foreground/60 select-none">brainhalf</span>
          </div>
          <div className="flex items-center gap-1.5">
            <ThemeToggle />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="relative h-8 w-8 rounded-full border border-border/60 overflow-hidden hover:ring-2 hover:ring-primary/30 transition-all focus:outline-none"
                  data-testid="button-user-menu"
                  aria-label="Account menu"
                >
                  <Avatar className="h-full w-full">
                    <AvatarImage src={user?.picture || undefined} alt={name || ""} />
                    <AvatarFallback className="bg-primary/10 text-primary font-bold text-xs">{initials}</AvatarFallback>
                  </Avatar>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-52 rounded-xl border-border/70 shadow-xl" align="end" forceMount>
                <DropdownMenuLabel className="font-normal px-3 py-2">
                  <p className="text-[13px] font-semibold text-foreground">{name || "You"}</p>
                  <p className="text-[11px] text-muted-foreground truncate">{email}</p>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild className="cursor-pointer rounded-lg mx-1 text-[13px]">
                  <Link href="/app/settings" className="flex w-full items-center"><SettingsIcon className="mr-2 h-3.5 w-3.5" />Settings</Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild className="cursor-pointer rounded-lg mx-1 text-[13px]">
                  <Link href="/app/settings/billing" className="flex w-full items-center"><CreditCard className="mr-2 h-3.5 w-3.5" />Billing</Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleSignOut} className="cursor-pointer text-destructive focus:bg-destructive/10 focus:text-destructive rounded-lg mx-1 mb-1 text-[13px]">
                  <LogOut className="mr-2 h-3.5 w-3.5" />Log out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {/* Page */}
        <main className="flex-1 overflow-auto">
          <div className="w-full max-w-5xl mx-auto px-6 py-7">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
});
