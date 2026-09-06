import * as React from "react";
import { Link, useLocation } from "wouter";
import {
  ChevronDown,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings as SettingsIcon,
} from "lucide-react";

import { useAuth } from "@/context/AuthContext";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useMobileNav } from "@/components/layout/mobile-nav";
import { useToast } from "@/hooks/use-toast";
import { SkipLink } from "@/components/ui/skip-link";

/** Landing-page sections the header can jump to. */
const MARKETING_SECTIONS = [
  { hash: "how-it-works", label: "How it works" },
  { hash: "faq", label: "FAQ" },
] as const;

const AUTH_ROUTES = ["/sign-in", "/sign-up", "/reset-password"];

/** The logo lockup. */
function Wordmark({ href }: { href: string }) {
  return (
    <Link
      href={href}
      aria-label="BrainHalf home"
      className="flex shrink-0 items-center gap-3 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background group"
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-background p-1.5 shadow-md border border-border/50 transition-transform group-hover:scale-105">
        <img
          src="/apple-touch-icon.png"
          alt="BrainHalf Logo"
          className="h-full w-full object-contain rounded-md"
        />
      </div>
      <span className="text-2xl tracking-tight text-foreground">
        <span className="font-semibold text-foreground">brain</span>
        <span className="font-extrabold text-primary">half</span>
      </span>
    </Link>
  );
}

/** Initial for the avatar fallback. */
function initialFor(user: { givenName?: string; name?: string; email?: string } | null) {
  return (
    user?.givenName?.charAt(0) ||
    user?.name?.charAt(0) ||
    user?.email?.charAt(0).toUpperCase() ||
    "B"
  );
}

function AccountMenu({ onSignOut }: { onSignOut: () => void }) {
  const { user } = useAuth();
  const userName = user?.givenName || user?.name?.split(" ")[0] || user?.email?.split("@")[0] || "Account";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          aria-label="Open account menu"
          className="group flex h-9 items-center gap-2 rounded-xl border border-border/60 bg-muted/20 px-2 py-1 hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring transition-colors"
          data-testid="button-user-menu"
        >
          <Avatar className="h-6 w-6 rounded-md border border-border/40">
            <AvatarImage src={user?.picture} alt="" />
            <AvatarFallback className="bg-primary/10 text-[10px] font-bold text-primary">
              {initialFor(user)}
            </AvatarFallback>
          </Avatar>
          <span className="hidden md:inline-block text-xs font-semibold text-foreground max-w-[100px] truncate">
            {userName}
          </span>
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-180" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60 rounded-xl p-1.5">
        <DropdownMenuLabel className="px-2.5 py-2 font-normal">
          <p className="text-body-sm font-semibold text-foreground">{user?.name || "User Account"}</p>
          <p className="mt-0.5 text-label font-medium text-muted-foreground">{user?.email}</p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild className="rounded-lg px-2.5 py-2 font-semibold">
          <Link href="/app">
            <LayoutDashboard className="mr-2.5 h-4 w-4 text-muted-foreground" />
            Dashboard
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild className="rounded-lg px-2.5 py-2 font-semibold">
          <Link href="/app/settings">
            <SettingsIcon className="mr-2.5 h-4 w-4 text-muted-foreground" />
            Settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={onSignOut}
          data-testid="button-logout"
          className="rounded-lg px-2.5 py-2 font-semibold text-destructive focus:bg-destructive/10 focus:text-destructive"
        >
          <LogOut className="mr-2.5 h-4 w-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function Navbar() {
  const [location, setLocation] = useLocation();
  const { isSignedIn, logout } = useAuth();
  const { toast } = useToast();
  const mobileNav = useMobileNav();

  const isAppRoute = location.startsWith("/app");
  const isAuthRoute = AUTH_ROUTES.some(
    (route) => location === route || location.startsWith(`${route}/`),
  );
  const showSections = !isAppRoute && !isAuthRoute;

  // wouter's pushState does not scroll for a /#hash URL, so the jump is done by
  // hand. The links are still real hrefs — they were <button>s, which meant no
  // middle-click, no "open in new tab" and nothing in the history.
  const scrollTimer = React.useRef<number | null>(null);
  React.useEffect(
    () => () => {
      if (scrollTimer.current) window.clearTimeout(scrollTimer.current);
    },
    [],
  );

  const goToSection = (event: React.MouseEvent, hash: string) => {
    // Let the browser handle modified clicks (new tab, new window).
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    const scroll = () =>
      document.getElementById(hash)?.scrollIntoView({ behavior: "smooth", block: "start" });
    if (location === "/") {
      window.history.replaceState(null, "", `/#${hash}`);
      scroll();
      return;
    }
    setLocation("/");
    // One paint for the landing page to mount, then scroll.
    scrollTimer.current = window.setTimeout(scroll, 120);
  };

  const handleSignOut = async () => {
    try {
      await logout();
      setLocation("/");
    } catch (error) {
      // Staying put is the honest response to a failed revocation — the
      // session is still live.
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
    <>
      <SkipLink>Skip to main content</SkipLink>
      <header
        /* One height for every route, published as --header-h so AppLayout's
           sticky offsets read it instead of restating 4rem / 5rem. */
        className="sticky top-0 z-50 h-[var(--header-h)] w-full border-b border-border/60 bg-background/95 backdrop-blur-lg supports-[backdrop-filter]:bg-background/85"
      >
      <div className="mx-auto flex h-full w-full items-center justify-between gap-3 px-4 md:px-6">
        <div className="flex min-w-0 items-center gap-3 lg:gap-8">
          {isAppRoute && mobileNav ? (
            <Button
              variant="ghost"
              size="icon"
              aria-label="Open navigation"
              aria-expanded={mobileNav.isOpen}
              aria-controls="app-sidebar"
              onClick={mobileNav.toggle}
              className="h-9 w-9 shrink-0 md:hidden"
            >
              <Menu className="h-4 w-4" />
            </Button>
          ) : null}
          <Wordmark href={isSignedIn && !isAuthRoute ? "/app" : "/"} />

          {showSections && (
            <nav
              aria-label="Sections"
              className="hidden items-center gap-6 lg:ml-3 lg:flex"
            >
              {MARKETING_SECTIONS.map((section) => (
                <a
                  key={section.hash}
                  href={`/#${section.hash}`}
                  onClick={(event) => goToSection(event, section.hash)}
                  className="rounded-md text-body-sm font-semibold text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  {section.label}
                </a>
              ))}
            </nav>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2.5">
          <ThemeToggle />

          {!isAuthRoute && (
            <div className="h-4 w-px bg-border/60 mx-0.5" aria-hidden="true" />
          )}

          {/* Auth routes get neither: the account menu has nothing to show, and
              a "Log in" button on the log-in page is noise. */}
          {!isAuthRoute &&
            (isSignedIn ? (
              <AccountMenu onSignOut={handleSignOut} />
            ) : (
              <>
                {/* rounded-lg, not the rounded-full pills these used to be:
                    every other button in the product is rounded-lg. */}
                <Button asChild variant="ghost" className="hidden rounded-lg font-semibold sm:inline-flex">
                  <Link href="/sign-in">Log in</Link>
                </Button>
                <Button asChild className="rounded-lg font-semibold">
                  <Link href="/sign-up">Get started</Link>
                </Button>
              </>
            ))}

          {/* Mobile menu. Below lg the section links used to simply vanish, so
              "How it works" and the FAQ were unreachable on a phone. */}
          {showSections && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Open menu"
                  className="h-9 w-9 rounded-lg lg:hidden"
                >
                  <Menu className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56 rounded-xl p-1.5 lg:hidden">
                {MARKETING_SECTIONS.map((section) => (
                  <DropdownMenuItem key={section.hash} asChild className="rounded-lg px-2.5 py-2 font-semibold">
                    <a href={`/#${section.hash}`} onClick={(event) => goToSection(event, section.hash)}>
                      {section.label}
                    </a>
                  </DropdownMenuItem>
                ))}
                {!isSignedIn && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem asChild className="rounded-lg px-2.5 py-2 font-semibold">
                      <Link href="/sign-in">Log in</Link>
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
    </header>
    </>
  );
}
