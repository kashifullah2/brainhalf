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
  PanelLeftClose,
  PanelLeftOpen,
  Zap,
} from "lucide-react";
import type { ComponentType } from "react";

interface NavItem {
  title: string;
  url: string;
  icon: ComponentType<{ className?: string }>;
  badge?: number | null;
}

function initialsOf(name: string | undefined, email: string | undefined): string {
  const a = name?.trim();
  if (a) {
    const parts = a.split(/\s+/);
    if (parts.length > 1) return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
    return a.slice(0, 2).toUpperCase();
  }
  const b = email?.trim();
  return b ? b.slice(0, 2).toUpperCase() : "·";
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
    try {
      await logout();
      setLocation("/");
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not sign out",
        description: error instanceof Error
          ? `${error.message} You are still signed in — try again.`
          : "You are still signed in. Check your connection and try again.",
      });
    }
  };

  const navItems: NavItem[] = [
    { title: "Dashboard", url: "/app", icon: LayoutDashboard },
    { title: "Upload", url: "/app/upload", icon: UploadCloud },
    { title: "Review Queue", url: "/app/review-queue", icon: CheckSquare, badge: queueCount },
  ];

  const accountNavItems: NavItem[] = [
    { title: "Settings", url: "/app/settings", icon: SettingsIcon },
    { title: "Billing", url: "/app/settings/billing", icon: CreditCard },
  ];

  const isActive = (item: NavItem) => {
    if (item.url === "/app") return location === "/app" || location === "/app/";
    return location === item.url || location.startsWith(`${item.url}/`);
  };

  const isAccountActive = (item: NavItem) => {
    if (item.url === "/app/settings/billing") return location === item.url;
    return (
      location.startsWith("/app/settings") &&
      location !== "/app/settings/billing" &&
      (location === "/app/settings" || location.startsWith("/app/settings/"))
    );
  };

  const email = user?.email ?? "";
  const name = user?.name ?? "";
  const initials = initialsOf(name, email);

  return (
    <div className="flex min-h-screen bg-background">
      {/* ── Sidebar ─────────────────────────────────────── */}
      <aside
        className={`
          relative flex flex-col shrink-0 border-r border-border/50
          bg-sidebar transition-[width] duration-300 ease-in-out
          ${collapsed ? "w-[64px]" : "w-[240px]"}
        `}
      >
        {/* Logo */}
        <div className={`flex h-16 items-center border-b border-border/40 px-4 ${collapsed ? "justify-center" : "gap-3"}`}>
          <div className="flex aspect-square size-8 shrink-0 items-center justify-center rounded-[0.5rem] bg-primary text-primary-foreground shadow-md shadow-primary/30">
            <FileText className="size-4" />
          </div>
          {!collapsed && (
            <span className="text-[17px] font-semibold tracking-tight select-none">
              brain<span className="font-extrabold text-primary">half</span>
            </span>
          )}
        </div>

        {/* Nav */}
        <div className="flex flex-col flex-1 gap-1 py-4 px-2 overflow-y-auto overflow-x-hidden">
          {/* Section label */}
          {!collapsed && (
            <p className="px-2 mb-1 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground/60 select-none">
              Workspace
            </p>
          )}

          {navItems.map((item) => {
            const active = isActive(item);
            return (
              <Link key={item.title} href={item.url}>
                <div
                  title={collapsed ? item.title : undefined}
                  className={`
                    group relative flex items-center gap-3 rounded-xl px-3 py-2.5
                    cursor-pointer select-none transition-all duration-150
                    ${active
                      ? "bg-primary text-primary-foreground shadow-md shadow-primary/20"
                      : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                    }
                    ${collapsed ? "justify-center px-0" : ""}
                  `}
                >
                  <item.icon className={`shrink-0 ${collapsed ? "h-5 w-5" : "h-[18px] w-[18px]"}`} />
                  {!collapsed && (
                    <>
                      <span className="text-[14px] font-medium flex-1">{item.title}</span>
                      {item.badge != null && item.badge > 0 && (
                        <span className={`
                          flex h-5 min-w-5 items-center justify-center rounded-full
                          px-1.5 text-[11px] font-bold
                          ${active
                            ? "bg-primary-foreground/20 text-primary-foreground"
                            : "bg-primary/15 text-primary"
                          }
                        `}>
                          {item.badge}
                        </span>
                      )}
                    </>
                  )}
                  {/* Tooltip for collapsed */}
                  {collapsed && (
                    <div className="
                      pointer-events-none absolute left-full ml-3 z-50
                      rounded-lg bg-popover border border-border/60 px-3 py-1.5
                      text-sm font-medium text-popover-foreground shadow-lg
                      opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap
                    ">
                      {item.title}
                      {item.badge != null && item.badge > 0 && (
                        <span className="ml-2 rounded-full bg-primary/15 text-primary px-1.5 py-0.5 text-xs font-bold">
                          {item.badge}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </Link>
            );
          })}

          {/* Account section */}
          <div className={`mt-auto pt-4 ${!collapsed ? "border-t border-border/40" : ""}`}>
            {!collapsed && (
              <p className="px-2 mb-1 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground/60 select-none">
                Account
              </p>
            )}
            {collapsed && <div className="border-t border-border/40 mb-2" />}
            {accountNavItems.map((item) => {
              const active = isAccountActive(item);
              return (
                <Link key={item.title} href={item.url}>
                  <div
                    title={collapsed ? item.title : undefined}
                    className={`
                      group relative flex items-center gap-3 rounded-xl px-3 py-2.5
                      cursor-pointer select-none transition-all duration-150
                      ${active
                        ? "bg-primary/10 text-primary"
                        : "text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                      }
                      ${collapsed ? "justify-center px-0" : ""}
                    `}
                  >
                    <item.icon className="shrink-0 h-[18px] w-[18px]" />
                    {!collapsed && (
                      <span className="text-[14px] font-medium">{item.title}</span>
                    )}
                    {collapsed && (
                      <div className="
                        pointer-events-none absolute left-full ml-3 z-50
                        rounded-lg bg-popover border border-border/60 px-3 py-1.5
                        text-sm font-medium text-popover-foreground shadow-lg
                        opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap
                      ">
                        {item.title}
                      </div>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        </div>

        {/* User footer */}
        <div className={`border-t border-border/40 p-2 ${collapsed ? "flex justify-center" : ""}`}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className={`
                  group flex items-center gap-3 rounded-xl p-2 w-full
                  hover:bg-sidebar-accent transition-colors text-left
                  ${collapsed ? "justify-center w-auto" : ""}
                `}
                title={collapsed ? (name || email) : undefined}
              >
                <Avatar className="h-8 w-8 rounded-full shrink-0 ring-1 ring-border/40">
                  <AvatarImage src={user?.picture || undefined} alt={name || "Avatar"} />
                  <AvatarFallback className="rounded-full bg-primary/10 text-primary text-xs font-bold">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                {!collapsed && (
                  <>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-semibold text-sidebar-foreground">{name || "You"}</p>
                      <p className="truncate text-[11px] text-muted-foreground/70">{email}</p>
                    </div>
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0 group-hover:text-muted-foreground transition-colors" />
                  </>
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              className="w-60 rounded-2xl border-border/60 shadow-xl"
              align={collapsed ? "end" : "end"}
              side="right"
              sideOffset={8}
              forceMount
            >
              <DropdownMenuLabel className="font-normal px-3 py-3">
                <div className="flex items-center gap-3">
                  <Avatar className="h-9 w-9 rounded-full">
                    <AvatarImage src={user?.picture || undefined} alt={name || ""} />
                    <AvatarFallback className="bg-primary/10 text-primary font-bold text-sm">{initials}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate">{name || "You"}</p>
                    <p className="text-xs text-muted-foreground truncate">{email}</p>
                  </div>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild className="cursor-pointer rounded-lg mx-1 my-0.5">
                <Link href="/app/settings" className="flex w-full items-center">
                  <SettingsIcon className="mr-2 h-4 w-4" /> Settings
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild className="cursor-pointer rounded-lg mx-1 my-0.5">
                <Link href="/app/settings/billing" className="flex w-full items-center">
                  <CreditCard className="mr-2 h-4 w-4" /> Billing
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="cursor-pointer text-destructive focus:bg-destructive/10 focus:text-destructive rounded-lg mx-1 my-0.5 mb-1"
                onClick={handleSignOut}
              >
                <LogOut className="mr-2 h-4 w-4" /> Log out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Collapse toggle */}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="
            absolute -right-3.5 top-[72px] z-20
            flex h-7 w-7 items-center justify-center
            rounded-full border border-border/60 bg-background shadow-md
            text-muted-foreground hover:text-foreground hover:border-border
            transition-all duration-200 hover:scale-110
          "
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed
            ? <PanelLeftOpen className="h-3.5 w-3.5" />
            : <PanelLeftClose className="h-3.5 w-3.5" />
          }
        </button>
      </aside>

      {/* ── Main area ───────────────────────────────────── */}
      <div className="flex flex-col flex-1 min-w-0">
        {/* Topbar */}
        <header className="sticky top-0 z-40 flex h-16 shrink-0 items-center justify-between border-b border-border/40 bg-background/80 backdrop-blur-md px-6">
          <div className="flex items-center gap-3">
            {/* Breadcrumb-style page indicator */}
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Zap className="h-3.5 w-3.5 text-primary/70" />
              <span className="font-medium text-foreground/70">brainhalf</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="relative h-9 w-9 rounded-full border border-border/60 hover:border-primary/50 transition-colors overflow-hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  data-testid="button-user-menu"
                  aria-label="Account menu"
                >
                  <Avatar className="h-full w-full">
                    <AvatarImage src={user?.picture || undefined} alt={name || ""} />
                    <AvatarFallback className="bg-primary/10 text-primary font-bold text-xs">{initials}</AvatarFallback>
                  </Avatar>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-56 rounded-2xl border-border/60 shadow-xl" align="end" forceMount>
                <DropdownMenuLabel className="font-normal px-3 py-2">
                  <div className="flex flex-col">
                    <p className="text-sm font-semibold text-foreground">{name || "You"}</p>
                    <p className="text-xs text-muted-foreground">{email}</p>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild className="cursor-pointer rounded-lg mx-1 my-0.5">
                  <Link href="/app/settings" className="flex w-full items-center">
                    <SettingsIcon className="mr-2 h-4 w-4" /> Settings
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild className="cursor-pointer rounded-lg mx-1 my-0.5">
                  <Link href="/app/settings/billing" className="flex w-full items-center">
                    <CreditCard className="mr-2 h-4 w-4" /> Billing
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="cursor-pointer text-destructive focus:bg-destructive/10 focus:text-destructive rounded-lg mx-1 my-0.5 mb-1"
                  onClick={handleSignOut}
                >
                  <LogOut className="mr-2 h-4 w-4" /> Log out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-auto">
          <div className="w-full max-w-6xl mx-auto px-6 py-8">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
});
