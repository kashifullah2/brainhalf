// ---------------------------------------------------------------------------
// Authentication context.
//
// Identity is owned by the server. This file holds no credential, decides
// nothing about whether the user is signed in, and persists no identity to
// localStorage — the previous implementation did all three, which meant a user
// could sign in as anyone by writing a JSON blob into storage.
//
// The session lives in an HttpOnly cookie that JavaScript cannot read, and
// GET /api/auth/me is the only authority on who the caller is.
// ---------------------------------------------------------------------------

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
} from "react";

import { apiUrl } from "@/lib/api-paths";

export interface UserProfile {
  id: string;
  name: string;
  firstName?: string;
  lastName?: string;
  email: string;
  picture: string;
  givenName?: string;
}

interface SignUpData {
  firstName: string;
  lastName: string;
  email: string;
  password?: string;
}

interface SignInData {
  email: string;
  password?: string;
}

interface AuthContextType {
  user: UserProfile | null;
  isSignedIn: boolean;
  isLoading: boolean;
  loginWithGoogle: (emailHint?: string) => Promise<void>;
  loginWithEmail: (data: SignInData) => Promise<void>;
  signupWithEmail: (data: SignUpData) => Promise<void>;
  resetPassword: (email: string) => Promise<boolean>;
  /** Completes a reset from the emailed link. Signs the user in on success. */
  confirmPasswordReset: (token: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  renderGoogleButton: (element: HTMLElement) => void;
  clientId: string;
  isGoogleLoaded: boolean;
}

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim() || "";

const AuthContext = createContext<AuthContextType | undefined>(undefined);

/** Shape returned by the auth endpoints. */
interface ServerUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  pictureUrl: string | null;
  emailVerified: boolean;
}

function toProfile(user: ServerUser): UserProfile {
  const name = `${user.firstName} ${user.lastName}`.trim() || user.email.split("@")[0];
  return {
    id: user.id,
    name,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    picture:
      user.pictureUrl ||
      `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(user.email)}`,
    givenName: user.firstName,
  };
}

/**
 * Posts JSON and throws an Error carrying the server's message on failure, so
 * callers can surface it directly.
 */
async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(apiUrl(path), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // Send and accept the session cookie.
    credentials: "same-origin",
    body: JSON.stringify(body),
  });

  const raw = await response.text();
  let parsed: unknown = null;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    if (raw.trimStart().startsWith("<")) {
      throw new Error(
        "The auth API is not running. Start the app with `pnpm dev:api` so the " +
          "Pages Functions and database are available.",
      );
    }
  }

  if (!response.ok) {
    const message = (parsed as { error?: string } | null)?.error;
    throw new Error(message || `Request failed (${response.status}).`);
  }

  return parsed as T;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isGoogleLoaded, setIsGoogleLoaded] = useState(false);

  /**
   * Google Identity Services delivers its credential through a callback rather
   * than a promise. This holds the resolvers for an in-flight loginWithGoogle()
   * so the caller can await the round trip.
   */
  const pendingGoogle = useRef<{
    resolve: () => void;
    reject: (error: Error) => void;
  } | null>(null);

  const exchangeGoogleCredential = useCallback(async (credential: string) => {
    // The raw ID token goes straight to the server, which verifies its RS256
    // signature against Google's keys. It is never decoded for trust here.
    const data = await postJson<{ user: ServerUser }>("/auth/google", {
      credential,
    });
    setUser(toProfile(data.user));
  }, []);

  const handleCredentialResponse = useCallback(
    (response: { credential?: string }) => {
      const pending = pendingGoogle.current;
      pendingGoogle.current = null;

      if (!response?.credential) {
        pending?.reject(new Error("Google did not return a credential."));
        return;
      }

      exchangeGoogleCredential(response.credential)
        .then(() => pending?.resolve())
        .catch((error: Error) => {
          console.error("Google sign-in failed:", error);
          pending?.reject(error);
        });
    },
    [exchangeGoogleCredential],
  );

  // Ask the server who we are, and load Google Identity Services.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const response = await fetch(apiUrl("/auth/me"), {
          credentials: "same-origin",
          headers: { Accept: "application/json" },
        });
        if (response.ok) {
          const data = (await response.json()) as { user: ServerUser | null };
          if (!cancelled) setUser(data.user ? toProfile(data.user) : null);
        } else if (!cancelled) {
          setUser(null);
        }
      } catch {
        // Network failure or the API is not running. Treat as signed out rather
        // than guessing — guessing is what made the old implementation unsafe.
        if (!cancelled) setUser(null);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID || typeof window === "undefined") return;

    const existing = document.querySelector<HTMLScriptElement>(
      'script[src="https://accounts.google.com/gsi/client"]',
    );

    const initialize = () => {
      const google = (window as any).google;
      if (!google?.accounts?.id) return;
      google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: handleCredentialResponse,
        auto_select: false,
      });
      setIsGoogleLoaded(true);
    };

    if (existing) {
      initialize();
      return;
    }

    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = initialize;
    document.head.appendChild(script);
  }, [handleCredentialResponse]);

  const renderGoogleButton = useCallback((element: HTMLElement) => {
    const google = (window as any).google;
    if (GOOGLE_CLIENT_ID && google?.accounts?.id) {
      const containerWidth = element.offsetWidth || element.parentElement?.offsetWidth || 350;
      const validWidth = Math.max(200, Math.min(400, containerWidth));

      google.accounts.id.renderButton(element, {
        theme: "outline",
        size: "large",
        width: validWidth,
        text: "continue_with",
        shape: "rectangular",
      });
    }
  }, []);

  /**
   * Opens the Google prompt and resolves once the server has verified the
   * resulting credential. No profile is invented if Google is unavailable — the
   * call fails, which is the honest outcome.
   */
  const loginWithGoogle = useCallback(
    (emailHint?: string) =>
      new Promise<void>((resolve, reject) => {
        if (!GOOGLE_CLIENT_ID) {
          reject(
            new Error(
              "Google sign-in is not configured. Set VITE_GOOGLE_CLIENT_ID.",
            ),
          );
          return;
        }

        const google = (window as any).google;
        if (!google?.accounts?.id) {
          reject(
            new Error(
              "Google sign-in is still loading. Try again in a moment.",
            ),
          );
          return;
        }

        pendingGoogle.current?.reject(
          new Error("Superseded by another sign-in attempt."),
        );
        pendingGoogle.current = { resolve, reject };

        try {
          if (emailHint) {
            google.accounts.id.initialize({
              client_id: GOOGLE_CLIENT_ID,
              callback: handleCredentialResponse,
              auto_select: false,
              login_hint: emailHint,
            });
          }
          google.accounts.id.prompt((notification: any) => {
            // One Tap can be suppressed (cookie settings, prior dismissal).
            // Surface that instead of hanging forever.
            if (
              notification?.isNotDisplayed?.() ||
              notification?.isSkippedMoment?.()
            ) {
              const pending = pendingGoogle.current;
              pendingGoogle.current = null;
              pending?.reject(
                new Error(
                  "Google did not show the sign-in prompt. Use the Google " +
                    "button above instead.",
                ),
              );
            }
          });
        } catch (error) {
          pendingGoogle.current = null;
          reject(
            error instanceof Error
              ? error
              : new Error("Could not start Google sign-in."),
          );
        }
      }),
    [handleCredentialResponse],
  );

  const loginWithEmail = useCallback(async ({ email, password }: SignInData) => {
    const data = await postJson<{ user: ServerUser }>("/auth/login", {
      email,
      password,
    });
    setUser(toProfile(data.user));
  }, []);

  const signupWithEmail = useCallback(
    async ({ firstName, lastName, email, password }: SignUpData) => {
      const data = await postJson<{ user: ServerUser }>("/auth/signup", {
        firstName,
        lastName,
        email,
        password,
      });
      setUser(toProfile(data.user));
    },
    [],
  );

  const resetPassword = useCallback(async (email: string): Promise<boolean> => {
    // The endpoint answers identically whether or not the address exists, so a
    // `true` here means "request accepted", not "an account was found".
    await postJson("/auth/password-reset", { email });
    return true;
  }, []);

  const confirmPasswordReset = useCallback(
    async (token: string, password: string) => {
      // The endpoint revokes every existing session and issues a fresh one, so
      // the response is a signed-in user and this can set it directly.
      const data = await postJson<{ user: ServerUser }>(
        "/auth/password-reset-confirm",
        { token, password },
      );
      setUser(toProfile(data.user));
    },
    [],
  );

  const logout = useCallback(async () => {
    // Stop Google from silently re-authenticating on the next page load.
    const google = (window as any).google;
    if (GOOGLE_CLIENT_ID && google?.accounts?.id) {
      google.accounts.id.disableAutoSelect();
    }

    // The revocation is awaited, and the local state is only cleared once the
    // server has actually dropped the session row.
    //
    // The previous version cleared first and left the request unawaited. If it
    // failed -- offline, 500, tab closed before it left the queue -- the UI said
    // "signed out" over a session that was still live: one refresh signed the
    // user straight back in, and on a shared machine so would the next person.
    // Refusing to clear on failure is the honest outcome. The caller surfaces
    // the error and the user can try again.
    const response = await fetch(apiUrl("/auth/logout"), {
      method: "POST",
      credentials: "same-origin",
    });
    if (!response.ok) {
      throw new Error(`Could not sign out (${response.status}).`);
    }

    setUser(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        isSignedIn: !!user,
        isLoading,
        loginWithGoogle,
        loginWithEmail,
        signupWithEmail,
        resetPassword,
        confirmPasswordReset,
        logout,
        renderGoogleButton,
        clientId: GOOGLE_CLIENT_ID,
        isGoogleLoaded,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
