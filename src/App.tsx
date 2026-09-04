import React, { Suspense, lazy } from "react";
import { Check } from "lucide-react";
import { Switch, Route, Redirect, useLocation, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";

import { AuthProvider, useAuth } from "@/context/AuthContext";
import { Navbar } from "@/components/layout/Navbar";
import { MobileNavProvider } from "@/components/layout/mobile-nav";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { AnalyticsConsent } from "@/components/AnalyticsConsent";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { usePageTitle } from "@/lib/use-page-title";

const Home = lazy(() => import("@/pages/Home"));
// Chrome only signed-in or authenticating visitors ever see. Kept out of the
// entry chunk so a landing-page visit no longer downloads the sidebar shell
// (dialog, separator, scroll-area) or the auth form's checkbox.
const GoogleAuthCard = lazy(() =>
  import("@/components/GoogleAuthCard").then((m) => ({ default: m.GoogleAuthCard })),
);
const AppLayout = lazy(() =>
  import("@/components/layout/AppLayout").then((m) => ({ default: m.AppLayout })),
);
const AppHome = lazy(() => import("@/pages/AppHome"));
const UploadPage = lazy(() => import("@/pages/UploadPage"));
const BatchDetails = lazy(() => import("@/pages/BatchDetails"));
const DocumentDetails = lazy(() => import("@/pages/DocumentDetails"));
const ReviewQueue = lazy(() => import("@/pages/ReviewQueue"));
const ReviewQueueDetail = lazy(() => import("@/pages/ReviewQueueDetail"));
const TemplatesPage = lazy(() => import("@/pages/TemplatesPage"));
const AdminDashboard = lazy(() => import("@/pages/AdminDashboard"));
const Settings = lazy(() => import("@/pages/Settings"));
const ResetPassword = lazy(() => import("@/pages/ResetPassword"));
const NotFound = lazy(() => import("@/pages/not-found"));

function PageLoader() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-[60vh] w-full items-center justify-center"
    >
      <div className="flex flex-col items-center gap-3">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <span className="text-body-sm text-muted-foreground">Loading…</span>
      </div>
    </div>
  );
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,      // 30s — avoid refetching data on every mount
      gcTime: 10 * 60_000,    // 10min — keep unused cache around longer
      retry: 1,               // Single retry is enough; OCR is idempotent
      refetchOnWindowFocus: false,
    },
  },
});
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

const AUTH_FEATURES = [
  { label: "Extract data from any invoice or receipt", sub: "PDF, PNG, JPG, WEBP — all supported" },
  { label: "4 extraction modes", sub: "Full Text, Key-Value, Visual Q&A, Custom Prompt" },
  { label: "Export in one click", sub: "CSV, Excel, Markdown, or JSON — ready to use" },
];

/**
 * The dark half of the auth screen. It says what the product does, once, to
 * someone who may have arrived straight at /sign-up.
 *
 * The lockup that used to sit at the top of this panel is gone: the header now
 * renders on the auth routes too, so there were two wordmarks stacked 40px
 * apart. Colours come from the `inverse` token pair rather than a hardcoded
 * zinc ramp, which is what made this the one surface in the product that looked
 * the same in dark mode as in light and cool where everything else is warm.
 */
function AuthBrandPanel() {
  return (
    <div className="flex h-full flex-col justify-center gap-10 border-r border-border/60 bg-muted/40 p-12 text-foreground">
      <div>
        <h2 className="max-w-sm text-4xl font-bold leading-tight tracking-tight text-foreground xl:text-5xl">
          Stop typing.<br />Start <span className="text-primary">extracting.</span>
        </h2>
        <p className="mt-5 max-w-xs text-body-lg text-muted-foreground">
          Drop in documents and get clean, structured data out — no templates, no
          drawing boxes.
        </p>
      </div>

      <ul className="flex flex-col gap-5">
        {AUTH_FEATURES.map((f) => (
          <li key={f.label} className="flex items-start gap-3">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <div>
              <p className="text-body-sm font-semibold text-foreground">{f.label}</p>
              <p className="mt-0.5 text-caption text-muted-foreground">{f.sub}</p>
            </div>
          </li>
        ))}
      </ul>

      <p className="max-w-xs border-l-2 border-primary pl-4 text-body-sm leading-relaxed text-muted-foreground">
        We built this because we were tired of retyping invoices on Sundays.
      </p>
    </div>
  );
}

/**
 * Heights subtract the header rather than filling the viewport: the bar is a
 * sibling above this subtree now, so `100dvh` here meant the brand panel ran a
 * header's worth past the bottom of the screen and the form side always had
 * 64px of scroll it did not need.
 *
 * The mobile logo bar this used to carry is gone for the same reason — the
 * header renders on /sign-in and /sign-up too.
 */
function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[calc(100dvh-var(--header-h))] items-stretch">
      {/* Brand panel — desktop only */}
      <div className="sticky top-[var(--header-h)] hidden h-[calc(100dvh-var(--header-h))] shrink-0 flex-col lg:flex lg:w-[42%] xl:w-[38%]">
        <AuthBrandPanel />
      </div>

      {/* Form side — full-width on mobile */}
      <div className="flex flex-1 flex-col items-center justify-center bg-background px-6 py-12">
        <div className="w-full max-w-[400px]">{children}</div>
      </div>
    </div>
  );
}

function SignInPage() {
  usePageTitle("Sign in · BrainHalf", { canonicalPath: "/sign-in", noindex: false });
  return (
    <AuthLayout>
      <GoogleAuthCard mode="sign-in" />
    </AuthLayout>
  );
}

function SignUpPage() {
  usePageTitle("Create account · BrainHalf", { canonicalPath: "/sign-up", noindex: false });
  return (
    <AuthLayout>
      <GoogleAuthCard mode="sign-up" />
    </AuthLayout>
  );
}

function HomeRedirect() {
  const { isSignedIn, isLoading } = useAuth();
  // Wait for the server to answer /api/auth/me before choosing, so a signed-in
  // user does not see the marketing page flash first.
  if (isLoading) return <PageLoader />;
  if (isSignedIn) return <Redirect to="/app" />;
  return <Home />;
}

function AppGuard({ children }: { children: React.ReactNode }) {
  const { isSignedIn, isLoading } = useAuth();
  // isLoading covers the initial /api/auth/me round trip. Rendering nothing
  // during it avoids briefly showing app chrome to a signed-out visitor.
  if (isLoading) return <PageLoader />;
  if (!isSignedIn) return <Redirect to="/sign-in" />;
  return <>{children}</>;
}

function RoutedErrorBoundary({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

const PrivacyPolicy = lazy(() => import("@/pages/legal/Privacy"));
const TermsOfService = lazy(() => import("@/pages/legal/Terms"));
const Contact = lazy(() => import("@/pages/legal/Contact"));

function AppRoutes() {
  const [location] = useLocation();
  const isAppRoute = location.startsWith("/app");

  const content = (
    <Suspense fallback={<PageLoader />}>
      <Switch>
        <Route path="/" component={HomeRedirect} />
        <Route path="/sign-in/*?" component={SignInPage} />
        <Route path="/sign-up/*?" component={SignUpPage} />
        {/* The address emailed by functions/api/auth/password-reset.ts. Without
            this route the reset link landed on the 404 page. */}
        <Route path="/reset-password/*?">
          <AuthLayout>
            <ResetPassword />
          </AuthLayout>
        </Route>
        
        <Route path="/privacy" component={PrivacyPolicy} />
        <Route path="/terms" component={TermsOfService} />
        <Route path="/contact" component={Contact} />
        
        <Route path="/app">
          <AppGuard><AppHome /></AppGuard>
        </Route>
        <Route path="/app/upload">
          <AppGuard><UploadPage /></AppGuard>
        </Route>
        <Route path="/app/batches/:batchId">
          <AppGuard><BatchDetails /></AppGuard>
        </Route>
        <Route path="/app/batches/:batchId/documents/:documentId">
          <AppGuard><DocumentDetails /></AppGuard>
        </Route>
        <Route path="/app/review-queue">
          <AppGuard><ReviewQueue /></AppGuard>
        </Route>
        <Route path="/app/review-queue/:documentId">
          <AppGuard><ReviewQueueDetail /></AppGuard>
        </Route>
        <Route path="/app/templates">
          <AppGuard><TemplatesPage /></AppGuard>
        </Route>
        <Route path="/app/admin">
          <AppGuard><AdminDashboard /></AppGuard>
        </Route>
        <Route path="/app/settings">
          <AppGuard><Settings /></AppGuard>
        </Route>
        {/* Deep-linkable tabs, so the sidebar's Billing entry can point straight
            at the billing panel instead of a route that does not exist. */}
        <Route path="/app/settings/:tab">
          <AppGuard><Settings /></AppGuard>
        </Route>
        
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );

  if (isAppRoute) {
    return (
      <AppGuard>
        {/* AppLayout is lazy and sits outside the route-level Suspense above,
            so it needs a boundary of its own. */}
        <Suspense fallback={<PageLoader />}>
          <AppLayout>{content}</AppLayout>
        </Suspense>
      </AppGuard>
    );
  }

  return content;
}

function App() {
  return (
    <WouterRouter base={basePath}>
      {/* attribute="class" matches the `@custom-variant dark (&:is(.dark *))`
          declaration in index.css, which is what makes the dark palette
          reachable at all. */}
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
        <AuthProvider>
          <QueryClientProvider client={queryClient}>
            <TooltipProvider>
              {/* Wraps both the header and the routes because the drawer's
                  trigger lives in one and the drawer itself in the other. */}
              <MobileNavProvider>
                {/* One header for every route. It used to be mounted inside
                    Home only, so the entire signed-in application, both legal
                    pages, /reset-password and the 404 screen had no header at
                    all — no theme toggle, no account menu, and no way to sign
                    out except the one button buried in Settings › Security. */}
                <Navbar />
                <RoutedErrorBoundary>
                  <AppRoutes />
                </RoutedErrorBoundary>
              </MobileNavProvider>
              <Toaster />
              <AnalyticsConsent />
            </TooltipProvider>
          </QueryClientProvider>
        </AuthProvider>
      </ThemeProvider>
    </WouterRouter>
  );
}

export default App;