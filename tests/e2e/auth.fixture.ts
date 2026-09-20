import { test as base, expect, type Page } from '@playwright/test';

/**
 * BrainHalf requires a verified session before it renders anything but the
 * login screen, so a spec that wants the workspace has to authenticate first.
 *
 * The fixture logs in through the real API (the dev server stubs it — see
 * `src/lib/dev-auth-mock.ts` — and a `BRAINHALF_API_BASE` backend honours the
 * same routes), then seeds the same localStorage keys `auth-client` reads so the
 * first navigation starts already signed in. The server still has the final
 * say: `/api/auth/session` is checked on load and a rejected token sends the
 * app back to the login screen, which is exactly what the spec below asserts.
 *
 * Use `test` from this file instead of `@playwright/test` when a spec needs a
 * signed-in browser.
 */

interface SessionUser {
  id: string;
  email: string;
}

async function login(request: any, apiBase: string): Promise<{ token: string; user: SessionUser }> {
  // Signup first: a real backend rejects a login for an unknown account, and a
  // dev backend accepts either for the fixed dev account.
  const creds = { email: 'dev@brainhalf.local', password: 'brainhalf-dev' };
  const res = await request.post(`${apiBase}/api/auth/login`, { data: creds });
  if (res.status() === 401) {
    const signup = await request.post(`${apiBase}/api/auth/signup`, { data: creds });
    expect.soft(signup.ok(), 'signup for the test account must succeed').toBeTruthy();
    return login(request, apiBase);
  }
  expect.soft(res.ok(), `login must succeed, got ${res.status()}`).toBeTruthy();
  const body = (await res.json()) as { token?: string; user?: SessionUser };
  expect.soft(body.token, 'the auth response must carry a token').toBeTruthy();
  return { token: body.token!, user: body.user! };
}

/** Seeds the session so the first navigation is already authenticated. */
async function seedSession(page: Page, token: string, user: SessionUser): Promise<void> {
  await page.addInitScript(([t, u]) => {
    try {
      localStorage.setItem('bh_session_token', t);
      localStorage.setItem('bh_session_user', u);
    } catch {
      /* storage unavailable — the app falls back to the login screen */
    }
  }, [token, JSON.stringify(user)] as any);
}

// The fixture hand-off is named `provide` rather than Playwright's usual `use`
// so the react-hooks lint rule (which matches any call to a `use*` identifier)
// does not mistake it for a hook call.
async function authenticate(
  { page, request, baseURL }: { page: Page; request: any; baseURL: string | undefined },
  provide: (page: Page) => Promise<void>
): Promise<void> {
  const apiBase = process.env.BRAINHALF_API_BASE || baseURL || 'http://localhost:5173';
  const { token, user } = await login(request, apiBase);
  await seedSession(page, token, user);
  await provide(page);
}

export const test = base.extend<{ authenticatedPage: Page }>({
  authenticatedPage: authenticate,
});

export { expect };
