import * as React from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/context/AuthContext";
import { SidebarProvider,
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { toast } from "@/hooks/use-toast";
import { getReviewQueueItems } from "@/lib/review-queue-store";
import {
  Sparkles,
  FileText,
  LayoutDashboard,
  CheckSquare,
  UploadCloud,
  Settings as SettingsIcon,
  CreditCard,
  LogOut,
  ChevronsUpDown,
  Inbox,
} from "lucide-react";
import type { ComponentType } from "react";

interface NavItem {
  title: string;
  url: string;
  icon: ComponentType<{ className?: string }>;
}

/**
 * A small convenience: the first few letters of an email, used as the avatar
 * fallback when the account has no picture. Reads like a person, not a bug.
 */
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

  // "Review Queue" badge: how many documents still need a human look. Shown
  // only once the count is known — there is no misleading "0" before the fetch.
  const [queueCount, setQueueCount] = React.useState<number | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const items = await getReviewQueueItems();
        if (!cancelled) setQueueCount(items.length);
      } catch {
        // A quiet failure: the queue page still works, the badge just stays hidden.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSignOut = async () => {
    try {
      await logout();
      setLocation("/");
    } catch (error) {
      // Deliberately no navigation: logout() only clears local state once the
      // server has dropped the session, so leaving the user where they are is
      // the truthful outcome. Sending them to the marketing page would look
      // like a sign-out that did not happen.
      toast({
        variant: "destructive",
        title: "Could not sign out",
        description:
          error instanceof Error
            ? `${error.message} You are still signed in — try again.`
            : "You are still signed in. Check your connection and try again.",
      });
    }
  };

  // Workspace nav — the things someone opens every day.
  const navItems: NavItem[] = [
    { title: "Dashboard", url: "/app", icon: LayoutDashboard },
    { title: "Upload", url: "/app/upload", icon: UploadCloud },
    { title: "Review Queue", url: "/app/review-queue", icon: CheckSquare },
  ];

  // Lower-urgency settings & account. Billing deep-links to the tab inside
  // Settings — there is no /app/billing page.
  const accountNavItems: NavItem[] = [
    { title: "Settings", url: "/app/settings", icon: SettingsIcon },
    { title: "Billing", url: "/app/settings/billing", icon: CreditCard },
  ];

  /** Active = exact match for the top level, prefix match for children. */
  const isActive = (item: NavItem) => {
    if (item.url === "/app") return location === "/app" || location === "/app/";
    return location === item.url || location.startsWith(`${item.url}/`);
  };

  /** Settings owns the whole subtree except the billing tab, which owns its path. */
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
  const userMenuTestId = "button-user-menu";

  return (
    <SidebarProvider>
      <Sidebar variant="inset" collapsible="icon">

        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Workspace</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {navItems.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive(item)}
                      tooltip={item.title}
                      className="h-11 rounded-xl transition-all duration-200 hover:bg-primary/5 hover:text-primary data-[active=true]:bg-primary/10 data-[active=true]:text-primary data-[active=true]:shadow-sm font-medium"
                    >
                      <Link href={item.url}>
                        <item.icon className="!h-5 !w-5 opacity-80" />
                        <span className="text-[15px]">{item.title}</span>
                        {item.title === "Review Queue" && queueCount !== null && (
                          <SidebarMenuBadge className="ml-auto bg-primary/15 text-primary px-2 py-0.5 rounded-full text-xs font-bold">
                            {queueCount}
                          </SidebarMenuBadge>
                        )}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

          <SidebarGroup className="mt-auto">
            <SidebarGroupLabel>Account</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {accountNavItems.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      asChild
                      isActive={isAccountActive(item)}
                      tooltip={item.title}
                      className="h-11 rounded-xl transition-all duration-200 hover:bg-muted/80 data-[active=true]:bg-primary/5 data-[active=true]:text-primary font-medium"
                    >
                      <Link href={item.url}>
                        <item.icon className="!h-5 !w-5 opacity-70" />
                        <span className="text-[15px]">{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <SidebarMenuButton
                    size="lg"
                    className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground rounded-xl transition-all duration-200 hover:bg-muted/60 border border-transparent hover:border-border/40"
                    tooltip="Account"
                  >
                    <Avatar className="h-9 w-9 rounded-full shadow-sm ring-1 ring-border/50">
                      <AvatarImage src={user?.picture || undefined} alt={name || "Your avatar"} />
                      <AvatarFallback className="rounded-full bg-primary/10 text-primary font-semibold">
                        {initials}
                      </AvatarFallback>
                    </Avatar>
                    <div className="grid flex-1 text-left text-sm leading-tight ml-2">
                      <span className="truncate font-semibold text-[15px] text-foreground/90">{name || "You"}</span>
                      <span className="truncate text-xs text-muted-foreground/80">{email}</span>
                    </div>
                    <ChevronsUpDown className="ml-auto size-4 text-muted-foreground/60" />
                  </SidebarMenuButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-xl"
                  align="start"
                  side="right"
                  sideOffset={8}
                  forceMount
                >
                  <DropdownMenuLabel className="font-normal">
                    <div className="flex flex-col space-y-1">
                      <p className="text-sm font-semibold leading-none text-foreground">{name || "You"}</p>
                      <p className="text-xs leading-none text-muted-foreground">{email}</p>
                    </div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild className="cursor-pointer rounded-lg">
                    <Link href="/app/settings" className="flex w-full items-center">
                      <SettingsIcon className="mr-2 h-4 w-4" />
                      Settings
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild className="cursor-pointer rounded-lg">
                    <Link href="/app/settings/billing" className="flex w-full items-center">
                      <CreditCard className="mr-2 h-4 w-4" />
                      Billing
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="cursor-pointer text-destructive focus:bg-destructive/10 focus:text-destructive rounded-lg"
                    onClick={handleSignOut}
                  >
                    <LogOut className="mr-2 h-4 w-4" />
                    Log out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>

        <SidebarRail />
      </Sidebar>

      <SidebarInset>
        {/* Translucency is safe here (unlike the earlier bg-background/80 +
            backdrop-blur attempt that read as a fault): the inset sidebar layout
            gives this header its own opaque page background behind it, so the
            blur only ever softens page content scrolling beneath — the intended
            glass effect, not see-through chrome. */}
        {/* px mirrors <main> below so the header's contents stay vertically
            aligned with the page container at every breakpoint. */}
        <header className="sticky top-0 z-40 flex h-16 shrink-0 items-center gap-2 border-b border-border/40 bg-background/80 backdrop-blur-md px-4 md:px-6 lg:px-8">
          <div className="flex w-full max-w-7xl mx-auto items-center gap-2">
            <SidebarTrigger className="-ml-2 text-muted-foreground hover:text-foreground transition-colors" />
            <Link href="/app" className="flex items-center gap-2.5 hover:opacity-85 transition-opacity ml-1">
              <div className="flex aspect-square size-8 shrink-0 items-center justify-center rounded-[0.4rem] bg-primary text-primary-foreground shadow-sm shadow-primary/20">
                <FileText className="size-4" />
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-xl font-medium tracking-tight">
                  brain<span className="font-extrabold text-primary">half</span>
                </span>
              </div>
            </Link>
            <div className="ml-auto flex items-center gap-2">
              <ThemeToggle />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    className="relative h-9 w-9 rounded-full shadow-sm border border-border/60 hover:border-primary/50 transition-colors"
                    data-testid={userMenuTestId}
                    aria-label="Account menu"
                  >
                    <Avatar className="h-9 w-9">
                      <AvatarImage src={user?.picture || undefined} alt={name || ""} />
                      <AvatarFallback className="bg-primary/10 text-primary font-bold">{initials}</AvatarFallback>
                    </Avatar>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-56 rounded-xl" align="end" forceMount>
                  <DropdownMenuLabel className="font-normal p-2">
                    <div className="flex flex-col space-y-1">
                      <p className="text-sm font-semibold leading-none text-foreground">{name || "You"}</p>
                      <p className="text-xs leading-none text-muted-foreground">{email}</p>
                    </div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild className="cursor-pointer rounded-lg">
                    <Link href="/app/settings" className="flex w-full items-center">
                      <SettingsIcon className="mr-2 h-4 w-4" />
                      Settings
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild className="cursor-pointer rounded-lg">
                    <Link href="/app/settings/billing" className="flex w-full items-center">
                      <CreditCard className="mr-2 h-4 w-4" />
                      Billing
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="cursor-pointer text-destructive focus:bg-destructive/10 focus:text-destructive rounded-lg"
                    onClick={handleSignOut}
                  >
                    <LogOut className="mr-2 h-4 w-4" />
                    Log out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </header>
        <main className="flex-1 w-full max-w-7xl mx-auto px-4 md:px-6 lg:px-8 py-8 flex flex-col">
          {children}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
});
