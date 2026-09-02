/**
 * Google Identity Services, loaded from accounts.google.com by a <script> tag
 * rather than as a package, so there is no @types for it. Only the four members
 * AuthContext actually calls are declared — enough to drop the \`(window as any)\`
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
        isDismissedMoment?: () => boolean;
      }) => void): void;
      disableAutoSelect(): void;
    };
  };
}

interface Window {
  google?: GoogleIdentityServices;
}
