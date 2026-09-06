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
  /** The provider's profile image URL, or "" when there is none. */
  picture: string;
  givenName?: string;
  isAdmin?: boolean;
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
  isAdmin: boolean;
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

const FALLBACK_GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim() || "";

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

/**
 * What every auth endpoint answers with. `isAdmin` is the server's verdict, from
 * the allowlist in server/admin.ts — it is never computed here.
 */
interface IdentityResponse {
  user: ServerUser;
  isAdmin?: boolean;
}

function toProfile(user: ServerUser): UserProfile {
  const name = `${user.firstName} ${user.lastName}`.trim() || user.email.split("@")[0];
  return {
    id: user.id,
    name,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    /**
     * Empty when Google did not supply one, and deliberately not a generated
     * avatar. The fallback used to be
     * `api.dicebear.com/...?seed=<the user's email address>`, which sent every
     * signed-in user's plaintext email to a third party on every page load, for a
     * cartoon. Both places that render this (`Navbar`, `Settings`) already have an
     * `AvatarFallback` that draws the user's initials locally.
     */
    picture: user.pictureUrl ?? "",
    givenName: user.firstName,
  };
}

/**
 * Shown when `fetch` itself rejects. That is a TypeError raised before any
 * response exists — offline, DNS, a dropped connection, a blocked request, or
 * (locally) `pnpm dev:api` no longer listening. Its message is the browser's
 * own "Failed to fetch", which is what the sign-out button used to put in a
 * toast: "Could not sign out — Failed to fetch" told the user nothing about
 * what to do. src/lib/api-client.ts already normalises this for the data API;
 * the auth calls went straight to `fetch` and leaked it.
 */
const UNREACHABLE = "Could not reach the server. Check your connection.";

/**
 * The single door every auth request goes through. Always sends the session
 * cookie, always asks for JSON, and turns a transport failure into a message
 * worth showing. Returns the Response untouched — status handling belongs to
 * the caller, which is the only one that knows what a 401 means for it.
 */
async function authFetch(path: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(apiUrl(path), {
      ...init,
      // Send and accept the session cookie.
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        ...((init?.headers as Record<string, string> | undefined) ?? {}),
      },
    });
  } catch {
    throw new Error(UNREACHABLE);
  }
}

/**
 * Posts JSON and throws an Error carrying the server's message on failure, so
 * callers can surface it directly.
 */
async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await authFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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

  if (parsed === null) {
    throw new Error("The server returned an unreadable response.");
  }

  return parsed as T;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  /**
   * The server's answer, not a local calculation.
   *
   * This used to be derived in the browser by substring-matching the signed-in
   * user's email, display name AND first name against a list that contained the
   * bare words "kashif" and "kashifullah". Every part of that was wrong: the
   * name fields come from the signup form, so registering as "Kashif" granted
   * admin; a substring match let kashif@anything.example through; and being a
   * client-side computation it could simply be edited in DevTools.
   *
   * It is now decided in server/admin.ts by exact email match, returned by the
   * auth endpoints, and re-checked by every admin endpoint — so this flag only
   * decides whether to render the entry, never whether access is allowed.
   */
  const [isAdmin, setIsAdmin] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isGoogleLoaded, setIsGoogleLoaded] = useState(false);
  const [dynamicClientId, setDynamicClientId] = useState<string>(FALLBACK_GOOGLE_CLIENT_ID);
  
  const GOOGLE_CLIENT_ID = dynamicClientId || FALLBACK_GOOGLE_CLIENT_ID;

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
    const data = await postJson<IdentityResponse>("/auth/google", {
      credential,
    });
    setUser(toProfile(data.user));
    setIsAdmin(data.isAdmin === true);
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
        const response = await authFetch("/auth/me");
        if (response.ok) {
          const data = (await response.json()) as {
            user: ServerUser | null;
            isAdmin?: boolean;
            googleClientId?: string;
          };
          if (!cancelled) {
            setUser(data.user ? toProfile(data.user) : null);
            setIsAdmin(data.user ? data.isAdmin === true : false);
            if (data.googleClientId) {
              setDynamicClientId(data.googleClientId);
            }
          }
        } else if (!cancelled) {
          setUser(null);
          setIsAdmin(false);
        }
      } catch {
        // Network failure or the API is not running. Treat as signed out rather
        // than guessing — guessing is what made the old implementation unsafe.
        if (!cancelled) {
          setUser(null);
          setIsAdmin(false);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const handleUnauthorized = () => {
      setUser(null);
      setIsAdmin(false);
    };
    window.addEventListener("auth:unauthorized", handleUnauthorized);
    return () => {
      window.removeEventListener("auth:unauthorized", handleUnauthorized);
    };
  }, []);

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID || typeof window === "undefined") return;

    const existing = document.querySelector<HTMLScriptElement>(
      'script[src="https://accounts.google.com/gsi/client"]',
    );

    const initialize = () => {
      const google = window.google;
      if (!google?.accounts?.id) return;
      google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: handleCredentialResponse,
        auto_select: false,
      });
      setIsGoogleLoaded(true);
    };

    if (existing) {
      existing.addEventListener("load", initialize);
      initialize();
      return () => {
        existing.removeEventListener("load", initialize);
      };
    }

    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = initialize;
    document.head.appendChild(script);
  }, [handleCredentialResponse, GOOGLE_CLIENT_ID]);

  const renderGoogleButton = useCallback((element: HTMLElement) => {
    const google = window.google;
    if (GOOGLE_CLIENT_ID && google?.accounts?.id) {
      const containerWidth = element.getBoundingClientRect().width || element.parentElement?.getBoundingClientRect().width || 350;
      const validWidth = Math.max(200, Math.min(400, containerWidth));

      google.accounts.id.renderButton(element, {
        theme: "outline",
        size: "large",
        width: validWidth,
        text: "continue_with",
        shape: "rectangular",
      });
    }
  }, [GOOGLE_CLIENT_ID]);

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
              "Google sign-in is not configured. Add GOOGLE_CLIENT_ID to the backend environment variables.",
            ),
          );
          return;
        }

        const google = window.google;
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
          google.accounts.id.prompt((notification) => {
            if (
              notification?.isNotDisplayed?.() ||
              notification?.isSkippedMoment?.() ||
              notification?.isDismissedMoment?.()
            ) {
              const pending = pendingGoogle.current;
              pendingGoogle.current = null;
              pending?.reject(
                new Error(
                  "Google sign-in was dismissed or could not be shown. Use the Google " +
                    "button above instead.",
                ),
              );
            }
          });

          // Fallback timeout in case the callback never fires or the user walks away.
          setTimeout(() => {
            const pending = pendingGoogle.current;
            if (pending) {
              pendingGoogle.current = null;
              pending.reject(new Error("Sign-in timed out. Please try again."));
            }
          }, 60000);
        } catch (error) {
          pendingGoogle.current = null;
          reject(
            error instanceof Error
              ? error
              : new Error("Could not start Google sign-in."),
          );
        }
      }),
    [handleCredentialResponse, GOOGLE_CLIENT_ID],
  );

  const loginWithEmail = useCallback(async ({ email, password }: SignInData) => {
    const data = await postJson<IdentityResponse>("/auth/login", {
      email,
      password,
    });
    setUser(toProfile(data.user));
    setIsAdmin(data.isAdmin === true);
  }, []);

  const signupWithEmail = useCallback(
    async ({ firstName, lastName, email, password }: SignUpData) => {
      const data = await postJson<IdentityResponse>("/auth/signup", {
        firstName,
        lastName,
        email,
        password,
      });
      setUser(toProfile(data.user));
      setIsAdmin(data.isAdmin === true);
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
      const data = await postJson<IdentityResponse>(
        "/auth/password-reset-confirm",
        { token, password },
      );
      setUser(toProfile(data.user));
      setIsAdmin(data.isAdmin === true);
    },
    [],
  );

  const logout = useCallback(async () => {
    // Stop Google from silently re-authenticating on the next page load.
    const google = window.google;
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
    const response = await authFetch("/auth/logout", { method: "POST" });
    if (!response.ok) {
      throw new Error(`The server refused the request (${response.status}).`);
    }

    setUser(null);
    setIsAdmin(false);
    // GOOGLE_CLIENT_ID is read above, so it belongs in the dependency list --
    // without it this closure keeps whatever value was current on first render and
    // stops calling disableAutoSelect() once the id arrives from /auth/me.
  }, [GOOGLE_CLIENT_ID]);

  return (
    <AuthContext.Provider
      value={{
        user: user ? { ...user, isAdmin } : null,
        isSignedIn: !!user,
        isAdmin,
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
