import * as React from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/context/AuthContext";
import { SidebarProvider,
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
  SidebarSeparator,
  SidebarRail,
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
import { 
  FileText, 
  LayoutDashboard, 
  Settings as SettingsIcon,
  CreditCard,
  LogOut,
  CheckSquare
} from "lucide-react";

const navItems = [
  {
    title: "Dashboard",
    url: "/app",
    icon: LayoutDashboard,
  },
  {
    title: "Review Queue",
    url: "/app/review-queue",
    icon: CheckSquare,
  },
  // "Templates" was removed: it linked to /app/templates, which has no route, so
  // it 404'd. Advertising a feature that does not exist is worse than omitting
  // it — add the entry back together with the page.
  //
  // "Batches" was also removed: it pointed at /app, the same destination as
  // Dashboard, so two nav items highlighted at once and neither was wrong.
];

const secondaryNavItems = [
  {
    title: "Settings",
    url: "/app/settings",
    icon: SettingsIcon,
  },
  {
    // Deep-links to the billing tab inside Settings.
    title: "Billing",
    url: "/app/settings/billing",
    icon: CreditCard,
  },
];

export const AppLayout = React.memo(function AppLayout({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useLocation();
  const { user, logout } = useAuth();

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

  return (
    <SidebarProvider>
      <Sidebar variant="inset" collapsible="icon">
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg" asChild tooltip="brainhalf">
                <Link href="/app">
                  <div className="flex aspect-square size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
                    <FileText className="size-4" />
                  </div>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate text-base font-semibold tracking-tight">
                      brain<span className="font-extrabold text-primary">half</span>
                    </span>
                    <span className="truncate text-xs text-muted-foreground">OCR Platform</span>
                  </div>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
        
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Platform</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {navItems.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton 
                      asChild 
                      isActive={location === item.url || (item.url !== '/app' && location.startsWith(item.url))}
                      tooltip={item.title}
                    >
                      <Link href={item.url}>
                        <item.icon className="h-4 w-4" />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

          <SidebarGroup className="mt-auto">
            <SidebarGroupLabel>Preferences</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {secondaryNavItems.map((item) => {
                  // Settings and Billing both live under /app/settings, so the
                  // generic startsWith check highlighted both entries at once
                  // on the billing tab. Billing owns its exact path; Settings
                  // owns the rest of the subtree.
                  const isActive =
                    item.url === "/app/settings/billing"
                      ? location === item.url
                      : item.url === "/app/settings"
                        ? location.startsWith("/app/settings") && location !== "/app/settings/billing"
                        : location === item.url || location.startsWith(item.url);
                  return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton 
                      asChild 
                      isActive={isActive}
                      tooltip={item.title}
                    >
                      <Link href={item.url}>
                        <item.icon className="h-4 w-4" />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        <SidebarSeparator />
        <SidebarRail />

        {/* Removed SidebarFooter as user dropdown is now in the top Navbar */}
      </Sidebar>

      <SidebarInset>
        {/* Opaque, not translucent: with bg-background/80 + backdrop-blur the
            page content showed through the bar while scrolling, which read as a
            rendering fault. */}
        {/* px mirrors <main> below so the header's contents stay vertically
            aligned with the page container at every breakpoint. */}
        <header className="sticky top-0 z-40 flex h-16 shrink-0 items-center gap-2 border-b border-border/40 bg-background px-4 md:px-6 lg:px-8">
          <div className="flex w-full max-w-7xl mx-auto items-center gap-2">
            <SidebarTrigger className="-ml-2" />
            <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="relative h-9 w-9 rounded-full shadow-sm border border-border/60 hover:border-primary/50 transition-colors" data-testid="button-user-menu">
                  <Avatar className="h-9 w-9">
                    <AvatarImage src={user?.picture} alt={user?.name || ""} />
                    <AvatarFallback className="bg-primary/10 text-primary font-bold">{user?.givenName?.charAt(0) || user?.name?.charAt(0) || "G"}</AvatarFallback>
                  </Avatar>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-56 rounded-xl" align="end" forceMount>
                <DropdownMenuLabel className="font-normal p-2">
                  <div className="flex flex-col space-y-1">
                    <p className="text-sm font-semibold leading-none text-foreground">{user?.name}</p>
                    <p className="text-xs leading-none text-muted-foreground">{user?.email}</p>
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