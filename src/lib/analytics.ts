import { appEvents } from './events';
import { getToken } from './auth-client';
import { getProjectStorageScope } from './project-store';
import { isPrivateSearch, pageMetadata } from '../seo/metadata';

export const GA_MEASUREMENT_ID = 'G-RRR516MXP2';
const DISABLE_KEY = `ga-disable-${GA_MEASUREMENT_ID}` as const;
let initialized = false;

/** Measure public production pages, keeping account and project URLs out of GA. */
export function initializeAnalytics(): void {
  if (initialized || window.self !== window.top) return;
  const url = new URL(window.location.href);
  if (url.protocol !== 'https:' || !['brainhalf.com', 'www.brainhalf.com'].includes(url.hostname)) return;
  if (getToken() || isPrivateSearch(url.search)) return;
  const path = url.pathname.replace(/\/$/, '') || '/';
  const metadata = pageMetadata(path === '/index.html' ? '/' : path);
  if (!metadata.canonical) return;
  initialized = true;

  const analytics = window as typeof window & {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
    [DISABLE_KEY]: boolean | undefined;
  };
  analytics.dataLayer = analytics.dataLayer || [];
  analytics.gtag = function (..._args: unknown[]) { analytics.dataLayer!.push(arguments); };
  // Retain only the referring origin, never another page's private path/query.
  let referrer = '';
  try { referrer = new URL(document.referrer).origin; } catch { /* Direct visit. */ }
  analytics.gtag('js', new Date());
  analytics.gtag('config', GA_MEASUREMENT_ID, {
    page_location: metadata.canonical,
    page_title: metadata.title,
    page_referrer: referrer,
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
  });

  // Signing in can open the workspace without a document navigation.
  // Disable collection before account-specific UI and URLs are displayed.
  const disable = () => { analytics[DISABLE_KEY] = true; };
  appEvents.on('project-account-changed', () => {
    if (getProjectStorageScope().accountId) disable();
  });
  window.addEventListener('storage', () => { if (getToken()) disable(); });

  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`;
  document.head.appendChild(script);
}
