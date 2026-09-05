import { clientApi } from './api-url';

type AuthError = { message?: string; error?: string };

function authCallbackUrl(): string {
  if (typeof window === "undefined") return "https://brainhalf.com/dashboard";
  return `${window.location.origin}/dashboard`;
}

async function parseAuthResponse(res: Response): Promise<{ ok: boolean; error?: string }> {
  if (res.ok) return { ok: true };
  try {
    const data = (await res.json()) as AuthError;
    const raw = data.message || data.error || res.statusText;
    if (res.status >= 500) {
      return {
        ok: false,
        error: raw || "Server error while contacting authentication service. Please try again.",
      };
    }
    return { ok: false, error: raw || "Authentication request failed." };
  } catch {
    const fallback =
      res.status >= 500
        ? "Internal server error on auth service. Please try again in a moment."
        : res.statusText || "Request failed";
    return { ok: false, error: fallback };
  }
}

export async function signInWithEmail(email: string, password: string) {
  const callbackURL = authCallbackUrl();
  const res = await fetch(clientApi('/api/auth/sign-in/email'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      email,
      password,
      // Force non-redirect auth flow so Better Auth never bounces to a stale base URL.
      redirect: false,
      callbackURL,
      redirectTo: callbackURL,
    }),
  });
  return parseAuthResponse(res);
}

export async function signUpWithEmail(email: string, password: string, name?: string) {
  const callbackURL = authCallbackUrl();
  const res = await fetch(clientApi('/api/auth/sign-up/email'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      email,
      password,
      name: name || email.split('@')[0],
      redirect: false,
      callbackURL,
      redirectTo: callbackURL,
    }),
  });
  return parseAuthResponse(res);
}

export async function signOut() {
  await fetch(clientApi('/api/auth/sign-out'), {
    method: 'POST',
    credentials: 'include',
  });
}
