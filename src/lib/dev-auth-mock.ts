/**
 * Dev-only stand-in for the Worker's `/api/auth/*` routes.
 *
 * `npm run dev` serves the frontend from Vite with an in-process simulation of
 * the backend (see `backendDevPlugin` in vite.config.ts), but the auth routes
 * live in the Worker, so without this stub every visit lands on the login
 * screen: `verifyStoredSession()` gets a backend-runner 404 and fails closed.
 * That breaks both the documented local-dev flow and any Playwright spec that
 * needs to reach the workspace.
 *
 * It accepts any credentials for one fixed account. Nothing here is ever
 * imported by the Worker bundle — only by vite.config.ts — and it must not be
 * used as a model for production auth.
 */

export interface DevAuthResult {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

const DEV_USER = { id: 'dev-user-1', email: 'dev@brainhalf.local' };
const DEV_PASSWORD = 'brainhalf-dev';
/** Deterministic, unmistakably dev-only. Never a value the Worker would mint. */
const DEV_TOKEN = 'bh_dev_local_token_not_a_real_session';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

/**
 * Handles a `/api/auth/*` request, or returns `null` when the path is not an
 * auth route (so the caller falls through to the rest of the dev server).
 */
export function handleDevAuth(
  method: string,
  url: string,
  headers: Record<string, string>,
  body: unknown
): DevAuthResult | null {
  const path = url.split('?')[0]!;
  if (!path.startsWith('/api/auth/')) return null;
  if (path.startsWith('/api/auth/google/')) {
    return { status: 503, body: { error: 'Google sign-in is not available in this local preview. Please continue with email.' }, headers: JSON_HEADERS };
  }

  // The session check is what the app makes on load; any well-formed bearer is
  // accepted, mirroring "the server has the authoritative say" without a real
  // signature to verify.
  if (path === '/api/auth/session' && method === 'GET') {
    const auth = headers['authorization'] ?? headers['Authorization'];
    if (!auth?.startsWith('Bearer ')) return { status: 401, body: { error: 'Sign in' }, headers: JSON_HEADERS };
    return { status: 200, body: { user: DEV_USER }, headers: JSON_HEADERS };
  }

  if ((path === '/api/auth/login' || path === '/api/auth/signup') && method === 'POST') {
    const submitted = (body as { password?: string } | null)?.password;
    // Signup creates the account in dev, so a wrong password on login is a real
    // rejection — keeps specs that assert on bad credentials meaningful.
    if (path === '/api/auth/login' && submitted !== DEV_PASSWORD) {
      return { status: 401, body: { error: 'Invalid email or password' }, headers: JSON_HEADERS };
    }
    return {
      status: 200,
      body: { token: DEV_TOKEN, user: DEV_USER },
      headers: {
        ...JSON_HEADERS,
        // Mirrors the Worker's navigational transport; not Secure because the
        // dev server is plain http and the browser would drop the cookie.
        'Set-Cookie': `bh_session=${DEV_TOKEN}; Path=/; SameSite=Lax; HttpOnly`,
      },
    };
  }

  if (path === '/api/auth/logout' && method === 'POST') {
    return {
      status: 200,
      body: { ok: true },
      headers: { ...JSON_HEADERS, 'Set-Cookie': 'bh_session=; Path=/; Max-Age=0' },
    };
  }

  if (path === '/api/auth/ws-ticket' && method === 'POST') {
    return { status: 201, body: { ticket: 'bhwt_dev_local_not_a_real_ticket' }, headers: JSON_HEADERS };
  }

  if (path === '/api/auth/forgot-password' && method === 'POST') {
    return { status: 202, body: { ok: true, message: 'If this address is eligible, you will receive an email with the next steps. Check your spam folder too.' }, headers: JSON_HEADERS };
  }

  if (path === '/api/auth/reset-password' && method === 'POST') {
    return { status: 200, body: { ok: true, message: 'Your password has been reset. You can now sign in.' }, headers: JSON_HEADERS };
  }

  if (path === '/api/auth/resend-verification' && method === 'POST') {
    return { status: 202, body: { ok: true, message: 'If this address is eligible, you will receive an email with the next steps. Check your spam folder too.' }, headers: JSON_HEADERS };
  }

  if (path === '/api/auth/verify-email' && method === 'POST') {
    return { status: 200, body: { ok: true, message: 'Email verified. You can now sign in.' }, headers: JSON_HEADERS };
  }

  if (path === '/api/contact' && method === 'POST') {
    return { status: 200, body: { ok: true }, headers: JSON_HEADERS };
  }

  return { status: 404, body: { error: 'not found' }, headers: JSON_HEADERS };
}

export const DEV_CREDENTIALS = { email: DEV_USER.email, password: DEV_PASSWORD };
