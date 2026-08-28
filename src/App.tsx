import React, { Suspense, lazy } from "react";
import { Switch, Route, Redirect, useLocation, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";

import { AuthProvider, useAuth } from "@/context/AuthContext";
import { ErrorBoundary } from "@/components/error-boundary";
import { AnalyticsConsent } from "@/components/analytics-consent";
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
const Settings = lazy(() => import("@/pages/Settings"));
const ResetPassword = lazy(() => import("@/pages/ResetPassword"));
const NotFound = lazy(() => import("@/pages/not-found"));

function PageLoader() {
  return (
    <div className="flex items-center justify-center min-h-[60vh] w-full">
      <div className="flex flex-col items-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Loading page...</span>
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
  { label: "5 extraction modes", sub: "Invoice, full text, table, key-value, receipt" },
  { label: "Export in one click", sub: "CSV, Excel, or JSON — ready to use" },
];

function AuthBrandPanel() {
  return (
    <div className="flex flex-col justify-between h-full p-12 bg-[hsl(20,25%,11%)] text-white relative overflow-hidden">
      {/* subtle warm glow */}
      <div className="absolute -top-32 -left-32 w-[500px] h-[500px] rounded-full bg-primary/20 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-0 right-0 w-[300px] h-[300px] rounded-full bg-primary/10 blur-[80px] pointer-events-none" />
      {/* Faint grid texture: gives the dark panel depth without another
          gradient. Pure CSS, no asset. */}
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.04]"
        style={{
          backgroundImage:
            "linear-gradient(hsl(38,25%,94%) 1px, transparent 1px), linear-gradient(90deg, hsl(38,25%,94%) 1px, transparent 1px)",
          backgroundSize: "44px 44px",
        }}
      />

      {/* logo */}
      <div className="relative z-10 flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-white shadow-lg shadow-primary/30">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
        </div>
        <span className="text-xl tracking-tight">
          <span className="font-normal text-white/80">Brain</span>
          <span className="font-extrabold text-primary">Half</span>
        </span>
      </div>

      {/* headline */}
      <div className="relative z-10 flex flex-col gap-8">
        <div>
          <p className="text-[11px] font-bold tracking-widest uppercase text-primary/80 mb-4">Powered by BH Model 1</p>
          <h2 className="text-4xl xl:text-5xl font-extrabold leading-[1.15] tracking-tight text-white">
            Stop typing.<br />Start{" "}
            <span className="bg-gradient-to-r from-primary to-warning bg-clip-text text-transparent">
              extracting.
            </span>
          </h2>
          <p className="mt-5 text-white/50 text-base font-medium leading-relaxed max-w-xs">
            Drop in documents and get clean, structured data out — no templates, no drawing boxes.
          </p>
        </div>

        <ul className="flex flex-col gap-4">
          {AUTH_FEATURES.map((f) => (
            <li key={f.label} className="flex items-start gap-3">
              <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/20 text-primary ring-1 ring-primary/30">
                <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              </div>
              <div>
                <p className="text-sm font-bold text-white/90">{f.label}</p>
                <p className="text-xs text-white/40 mt-0.5 font-medium">{f.sub}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>

      {/* bottom quote */}
      <div className="relative z-10 border-l-2 border-primary/40 pl-4">
        <p className="text-xs text-white/30 font-medium leading-relaxed">
          "We built this because we were tired of retyping invoices on Sundays."
        </p>
      </div>
    </div>
  );
}

function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-[100dvh] flex">
      {/* Brand panel — desktop only */}
      <div className="hidden lg:flex lg:w-[42%] xl:w-[38%] shrink-0 flex-col min-h-[100dvh]">
        <AuthBrandPanel />
      </div>

      {/* Form side — full-width on mobile */}
      <div className="flex-1 flex flex-col min-h-[100dvh] bg-background">
        {/* Mobile-only logo bar */}
        <div className="lg:hidden flex items-center gap-3 px-6 py-5 border-b border-border/40">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-white shadow-sm">
            <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
          </div>
          <span className="text-lg tracking-tight">
            <span className="font-normal text-foreground/70">brain</span>
            <span className="font-extrabold text-primary">half</span>
          </span>
        </div>

        {/* Centered form */}
        <div className="flex-1 flex items-center justify-center px-6 py-12">
          <div className="w-full max-w-[400px]">
            {children}
          </div>
        </div>
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
        <Route path="/reset-password">
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
              <RoutedErrorBoundary>
                <AppRoutes />
              </RoutedErrorBoundary>
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