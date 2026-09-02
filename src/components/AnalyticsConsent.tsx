import { useEffect, useState } from "react";
import { Link } from "wouter";

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

/**
 * Fired when something asks to revisit the analytics decision.
 *
 * Consent was a one-way door: Accept or Decline, stored, and never surfaced
 * again. Under GDPR/ePrivacy withdrawing consent has to be as easy as giving it,
 * and there was no control anywhere in the product to do it -- clearing site data
 * by hand was the only route. The footer and Settings both dispatch this.
 */
export const CONSENT_SETTINGS_EVENT = "brainhalf:analytics-consent-settings";

/** Fired once a choice has been recorded, so any panel showing it can update. */
export const CONSENT_CHANGED_EVENT = "brainhalf:analytics-consent-changed";

export type Consent = "granted" | "denied";

export function readAnalyticsConsent(): Consent | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === "granted" || stored === "denied" ? stored : null;
  } catch {
    // Storage can be blocked entirely; treat that as "not asked".
    return null;
  }
}

/** Re-opens the consent notice so the current choice can be changed. */
export function openAnalyticsConsentSettings(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(CONSENT_SETTINGS_EVENT));
}

/**
 * Stops analytics collecting anything further, in this page view.
 *
 * `window['ga-disable-<ID>'] = true` is Google's own documented kill switch and
 * is honoured by an already-loaded gtag, which matters because a <script> that
 * has executed cannot be un-executed. Removing the tag and dropping dataLayer
 * stops our own events queueing behind it, and the next page load will not load
 * gtag at all.
 */
function disableAnalytics(): void {
  const w = window as unknown as Record<string, unknown>;
  w[`ga-disable-${MEASUREMENT_ID}`] = true;
  document.getElementById("ga-tag")?.remove();
  delete w.dataLayer;
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

export function trackAnalyticsEvent(eventName: string, eventParams?: Record<string, unknown>) {
  if (typeof window === "undefined") return;
  const w = window as unknown as { dataLayer?: unknown[] };
  if (!w.dataLayer) return;
  
  w.dataLayer.push({
    event: eventName,
    ...eventParams,
  });
}

export function AnalyticsConsent() {
  const [consent, setConsent] = useState<Consent | null | "unknown">("unknown");
  /** True while the notice is open to CHANGE an existing decision. */
  const [isRevisiting, setIsRevisiting] = useState(false);

  useEffect(() => {
    const stored = readAnalyticsConsent();
    setConsent(stored);
    if (stored === "granted") loadAnalytics();
  }, []);

  useEffect(() => {
    const onOpen = () => setIsRevisiting(true);
    window.addEventListener(CONSENT_SETTINGS_EVENT, onOpen);
    return () => window.removeEventListener(CONSENT_SETTINGS_EVENT, onOpen);
  }, []);

  const decide = (value: Consent) => {
    try {
      localStorage.setItem(STORAGE_KEY, value);
    } catch {
      // A blocked storage write must not stop the banner from dismissing.
    }
    setConsent(value);
    setIsRevisiting(false);
    if (value === "granted") loadAnalytics();
    else disableAnalytics();
    window.dispatchEvent(new Event(CONSENT_CHANGED_EVENT));
  };

  // "unknown" is the pre-mount state; null means we have asked nothing yet. A
  // decision already on record keeps the notice closed until something asks to
  // revisit it.
  if (consent !== null && !isRevisiting) return null;

  return (
    <div
      /* Not role="dialog": this notice never traps focus and the page stays
         fully usable behind it, so a landmark region is the honest role. */
      role="region"
      aria-label="Cookie consent"
      className="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-sm rounded-xl border border-border bg-background/95 p-5 shadow-lg backdrop-blur-xl sm:inset-x-auto sm:right-6 sm:bottom-6"
    >
      <div className="flex flex-col gap-3">
        <div className="space-y-1.5">
          <h3 className="text-body-lg font-semibold tracking-tight text-foreground">
            We value your privacy
          </h3>
          {/* Deliberately short. This box is fixed to the viewport, so every
              extra line is another line of the page it covers -- the long
              version reached far enough up to sit over the sign-in form's
              "Create account" link. */}
          <p className="text-body-sm leading-relaxed text-muted-foreground">
            We use minimal analytics cookies to understand usage. No advertising
            cookies, and we never sell your data.{' '}
            {/* Link, not <a>: a plain anchor reloaded the whole SPA from the
                consent banner, throwing away whatever the visitor was doing. */}
            <Link
              href="/privacy"
              className="font-semibold text-primary underline-offset-4 hover:underline"
            >
              Privacy Policy
            </Link>
          </p>
        </div>

        {isRevisiting && consent !== null && (
          <p className="text-caption font-semibold text-muted-foreground">
            Currently: {consent === "granted" ? "analytics allowed" : "analytics declined"}.
          </p>
        )}

        <div className="flex flex-col gap-2 sm:flex-row">
          {/* Colour, hover and press states come from the Button variants. */}
          <Button
            onClick={() => decide("granted")}
            className="h-10 flex-1 rounded-lg font-semibold"
          >
            {isRevisiting ? "Allow" : "Accept All"}
          </Button>
          <Button
            variant="outline"
            onClick={() => decide("denied")}
            className="h-10 flex-1 rounded-lg font-semibold"
          >
            Decline
          </Button>
        </div>

        {isRevisiting && (
          <button
            type="button"
            onClick={() => setIsRevisiting(false)}
            className="self-center text-caption font-semibold text-muted-foreground underline-offset-4 hover:underline"
          >
            Keep my current choice
          </button>
        )}
      </div>
    </div>
  );
}
