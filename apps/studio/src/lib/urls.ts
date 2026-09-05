/** Production API — workers.dev until api.brainhalf.com DNS propagates. */
export const PROD_API_URL = "https://brainhalf-api.kashifullah919.workers.dev";
export const PROD_WEB_URL = "https://brainhalf.com";
/** Custom domain (enable after DNS record exists). */
export const PROD_API_CUSTOM_DOMAIN = "https://api.brainhalf.com";

function isLocalHostname(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname.endsWith(".localhost")
  );
}

/** True when running on deployed BrainHalf (custom domain or Pages preview). */
export function isDeployedBrainhalfHost(hostname?: string): boolean {
  const h =
    hostname ??
    (typeof window !== "undefined" ? window.location.hostname : "");
  if (!h) return import.meta.env.PROD;
  if (isLocalHostname(h)) return false;
  return (
    h.endsWith("brainhalf.com") ||
    h.endsWith(".brainhalf.pages.dev") ||
    h.includes("brainhalf-studio.pages.dev") ||
    h.includes("brainhalf-web.pages.dev")
  );
}

function looksLikeDevUrl(url: string): boolean {
  return /localhost|127\.0\.0\.1/.test(url);
}

/**
 * API base for fetch() calls.
 * - Local dev: empty string → Vite proxies /api to workers (8787).
 * - Production: always https://api.brainhalf.com (never studio origin).
 */
export function getApiBaseUrl(): string {
  const fromEnv = import.meta.env.VITE_API_URL?.trim().replace(/\/$/, "") ?? "";

  if (typeof window !== "undefined") {
    if (isDeployedBrainhalfHost()) {
      if (!fromEnv || looksLikeDevUrl(fromEnv)) return PROD_API_URL;
      return fromEnv;
    }
    return fromEnv;
  }

  if (import.meta.env.PROD) {
    if (!fromEnv || looksLikeDevUrl(fromEnv)) return PROD_API_URL;
    return fromEnv;
  }

  return fromEnv;
}

/** Marketing web app URL (sign-in, settings links from studio). */
export function getWebUrl(): string {
  const fromEnv = import.meta.env.VITE_WEB_URL?.trim().replace(/\/$/, "") ?? "";

  if (typeof window !== "undefined") {
    if (isDeployedBrainhalfHost()) {
      if (!fromEnv || looksLikeDevUrl(fromEnv)) return PROD_WEB_URL;
      return fromEnv;
    }
    return fromEnv || "http://localhost:5174";
  }

  if (import.meta.env.PROD) {
    if (!fromEnv || looksLikeDevUrl(fromEnv)) return PROD_WEB_URL;
    return fromEnv;
  }

  return fromEnv || "http://localhost:5174";
}
