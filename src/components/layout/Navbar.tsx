import { Link, useLocation } from "wouter";
import { useAuth } from "@/context/AuthContext";
import { 
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger 
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { FileText, LogOut, LayoutDashboard, Settings as SettingsIcon } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { ThemeToggle } from "@/components/theme-toggle";

export function Navbar() {
  const [, setLocation] = useLocation();
  const { user, isSignedIn, logout } = useAuth();

  const handleSignOut = async () => {
    try {
      await logout();
      setLocation("/");
    } catch (error) {
      // See AppLayout: staying put is the honest response to a failed
      // revocation, because the session is still live.
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
    <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/80 backdrop-blur-md supports-[backdrop-filter]:bg-background/60">
      <div className="container max-w-7xl mx-auto flex h-16 md:h-20 items-center justify-between px-6 md:px-8">
        <div className="flex items-center gap-6 md:gap-10">
          <Link href={isSignedIn ? "/app" : "/"} className="flex items-center gap-3 group">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-md shadow-primary/25 group-hover:scale-105 group-hover:shadow-lg transition-all duration-300">
              <FileText className="h-5 w-5" />
            </div>
            <span className="hidden tracking-tight text-2xl text-foreground md:block">
              <span className="font-medium">brain</span>
              <span className="font-extrabold text-primary">half</span>
            </span>
          </Link>
          {/* Anchor links to the marketing page's sections; hidden while signed
              in because the dashboard is then one click away anyway. */}
          {!isSignedIn && (
            <nav className="hidden lg:flex items-center gap-6 text-sm font-semibold text-muted-foreground">
              <Link href="/#how-it-works" className="hover:text-foreground transition-colors">
                How it works
              </Link>
              <Link href="/#faq" className="hover:text-foreground transition-colors">
                FAQ
              </Link>
            </nav>
          )}
        </div>
        
        <div className="flex items-center gap-4 md:gap-6">
          <ThemeToggle />
          {isSignedIn ? (
            <>
              <Link href="/app" className="text-sm font-bold text-muted-foreground hover:text-foreground transition-colors hidden sm:block">
                Dashboard
              </Link>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="relative h-11 w-11 rounded-full shadow-sm border border-border/60 hover:border-primary/50 transition-colors" data-testid="button-user-menu">
                    <Avatar className="h-11 w-11">
                      <AvatarImage src={user?.picture} alt={user?.name || ""} />
                      <AvatarFallback className="bg-primary/10 text-primary font-bold">{user?.givenName?.charAt(0) || user?.name?.charAt(0) || "G"}</AvatarFallback>
                    </Avatar>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-64 rounded-2xl p-2 border-border/60 shadow-lg" align="end" forceMount>
                  <DropdownMenuLabel className="font-normal p-3">
                    <div className="flex flex-col space-y-1.5">
                      <p className="text-sm font-bold leading-none text-foreground">{user?.name}</p>
                      <p className="text-xs font-medium leading-none text-muted-foreground">
                        {user?.email}
                      </p>
                    </div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator className="bg-border/40" />
                  <DropdownMenuItem asChild className="rounded-xl p-3 focus:bg-muted/50 focus:text-foreground">
                    <Link href="/app" className="cursor-pointer w-full flex items-center font-semibold">
                      <LayoutDashboard className="mr-3 h-4 w-4 text-muted-foreground" />
                      <span>Dashboard</span>
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild className="rounded-xl p-3 focus:bg-muted/50 focus:text-foreground">
                    <Link href="/app/settings" className="cursor-pointer w-full flex items-center font-semibold">
                      <SettingsIcon className="mr-3 h-4 w-4 text-muted-foreground" />
                      <span>Settings</span>
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator className="bg-border/40" />
                  <DropdownMenuItem 
                    className="cursor-pointer rounded-xl p-3 font-semibold text-destructive focus:text-destructive focus:bg-destructive/10"
                    onClick={handleSignOut}
                    data-testid="button-logout"
                  >
                    <LogOut className="mr-3 h-4 w-4" />
                    <span>Log out</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : (
            <nav className="flex items-center gap-4 md:gap-6">
              <Button asChild variant="outline" className="h-10 px-5 rounded-full font-bold text-xs uppercase tracking-wider border-border/80 hover:border-primary/50">
                <Link href="/sign-in">Log in</Link>
              </Button>
              <Button asChild className="h-10 px-5 rounded-full font-bold text-xs uppercase tracking-wider shadow-md shadow-primary/20 hover:shadow-lg">
                <Link href="/sign-up">
                  Get Started
                </Link>
              </Button>
            </nav>
          )}
        </div>
      </div>
    </header>
  );
}
