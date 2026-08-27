/// <reference types="vite/client" />

/**
 * Typed import.meta.env keys used by the client bundle. VITE_* values are
 * inlined into the public JavaScript at build time — never put a secret here.
 */
interface ImportMetaEnv {
  /** Build-time base path the app is served under (see vite.config.ts). */
  readonly BASE_URL: string;
  /** Public Google OAuth client ID for the sign-in button. */
  readonly VITE_GOOGLE_CLIENT_ID: string;
  /** EmailJS credentials for the /contact form. Public by design. */
  readonly VITE_EMAILJS_SERVICE_ID: string;
  readonly VITE_EMAILJS_TEMPLATE_ID: string;
  readonly VITE_EMAILJS_PUBLIC_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
