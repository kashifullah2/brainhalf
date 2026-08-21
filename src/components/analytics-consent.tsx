import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

/**
 * Analytics consent gate.
 *
 * Google Analytics used to load unconditionally from index.html — on a product
 * that also ships a Privacy Policy page. Under GDPR/ePrivacy, analytics cookies
 * need consent BEFORE the tag runs, so the tag now lives here and is only
 * injected once the visitor accepts.
 */

const STORAGE_KEY = "brainhalf_analytics_consent";
const MEASUREMENT_ID = "G-RRR516MXP2";

type Consent = "granted" | "denied";

function readConsent(): Consent | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === "granted" || stored === "denied" ? stored : null;
  } catch {
    // Storage can be blocked entirely; treat that as "not asked".
    return null;
  }
}

function loadAnalytics() {
  if (document.getElementById("ga-tag")) return;

  const script = document.createElement("script");
  script.id = "ga-tag";
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}`;
  document.head.appendChild(script);

  const w = window as unknown as { dataLayer?: unknown[] };
  w.dataLayer = w.dataLayer || [];
  function gtag(...args: unknown[]) {
    w.dataLayer!.push(args);
  }
  gtag("js", new Date());
  gtag("config", MEASUREMENT_ID, { anonymize_ip: true });
}

export function AnalyticsConsent() {
  const [consent, setConsent] = useState<Consent | null | "unknown">("unknown");

  useEffect(() => {
    const stored = readConsent();
    setConsent(stored);
    if (stored === "granted") loadAnalytics();
  }, []);

  const decide = (value: Consent) => {
    try {
      localStorage.setItem(STORAGE_KEY, value);
    } catch {
      // A blocked storage write must not stop the banner from dismissing.
    }
    setConsent(value);
    if (value === "granted") loadAnalytics();
  };

  // "unknown" is the pre-mount state; null means we have asked nothing yet.
  if (consent !== null) return null;

  return (
    <div
      role="dialog"
      aria-label="Cookie consent"
      className="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-sm sm:max-w-md rounded-2xl border border-border/40 bg-background/95 backdrop-blur-xl p-6 shadow-[0_8px_30px_rgb(0,0,0,0.12)] dark:shadow-[0_8px_30px_rgb(0,0,0,0.4)] sm:inset-x-auto sm:right-6 sm:bottom-6"
    >
      <div className="flex flex-col gap-4">
        <div className="space-y-2">
          <h3 className="text-base font-bold text-foreground tracking-tight">We value your privacy</h3>
          <p className="text-sm leading-relaxed text-muted-foreground">
            We use minimal analytics cookies to understand platform usage and improve our services. We do not use advertising cookies or sell your data. You can choose to accept or decline below.
          </p>
        </div>
        
        <div className="flex flex-col sm:flex-row gap-3 pt-2">
          <Button
            onClick={() => decide("granted")}
            className="flex-1 h-10 rounded-xl font-bold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shadow-sm"
          >
            Accept All
          </Button>
          <Button
            variant="outline"
            onClick={() => decide("denied")}
            className="flex-1 h-10 rounded-xl border-border/80 font-bold hover:bg-muted/50 transition-colors"
          >
            Decline
          </Button>
        </div>
      </div>
    </div>
  );
}
