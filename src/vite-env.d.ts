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

/**
 * Google Identity Services, loaded from accounts.google.com by a <script> tag
 * rather than as a package, so there is no @types for it. Only the four members
 * AuthContext actually calls are declared — enough to drop the `(window as any)`
 * casts that were hiding typos in the call arguments.
 */
interface GoogleIdentityServices {
  accounts?: {
    id?: {
      initialize(config: {
        client_id: string;
        callback: (response: { credential?: string }) => void;
        auto_select?: boolean;
        /** Pre-fills the account chooser with an address the user just typed. */
        login_hint?: string;
      }): void;
      renderButton(
        element: HTMLElement,
        options: Record<string, string | number | undefined>,
      ): void;
      prompt(callback?: (notification: {
        isNotDisplayed?: () => boolean;
        isSkippedMoment?: () => boolean;
      }) => void): void;
      disableAutoSelect(): void;
    };
  };
}

interface Window {
  google?: GoogleIdentityServices;
}
