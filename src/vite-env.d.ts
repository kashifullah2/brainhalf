/// <reference types="vite/client" />

/**
 * Typed import.meta.env keys used by the client bundle.
 *
 * A VITE_-prefixed value is substituted into the emitted JavaScript at build time
 * and is readable by anyone who opens the page, so a secret must never appear
 * here. forbidSecretViteVars() in vite.config.ts fails the build if one does.
 *
 * There is deliberately no VITE_AWS_* entry. A previous revision read
 * VITE_AWS_ACCESS_KEY_ID / VITE_AWS_SECRET_ACCESS_KEY in src/lib/ocr-client.ts to
 * build a Textract client in the browser; AWS is reached server-side now
 * (server/aws-ocr.ts). Nor a VITE_ADMIN_EMAILS: who is an administrator is
 * decided in server/admin.ts, not in the bundle.
 */
interface ImportMetaEnv {
  /** Build-time base path the app is served under (see vite.config.ts). */
  readonly BASE_URL: string;
  /** Public Google OAuth client ID for the sign-in button. */
  readonly VITE_GOOGLE_CLIENT_ID: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
