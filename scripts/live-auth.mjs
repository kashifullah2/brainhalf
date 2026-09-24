import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

function platformPage(page, origin) {
  try { return !page.isClosed() && new URL(page.url()).origin === origin; }
  catch { return false; }
}

function pageLocation(page, origin) {
  try {
    const url = new URL(page.url());
    if (url.origin !== origin) return 'external-sign-in';
    // Never persist OAuth query strings, verification codes or arbitrary paths.
    return ['/', '/dashboard', '/account', '/verify-email', '/reset-password'].includes(url.pathname) ? url.pathname : 'other-platform-page';
  } catch { return 'unavailable'; }
}

export async function readPlatformSession(context, origin) {
  let response;
  try {
    // Playwright's context request shares the real browser cookies. No token is
    // copied into the runner, and no credentials or response bodies are saved.
    response = await context.request.get(`${origin}/api/auth/session`, { timeout: 5000, maxRedirects: 0 });
    const body = await response.json().catch(() => null);
    const id = body?.userId ?? body?.user?.id;
    return { status: response.status(), authenticated: response.ok() && typeof id === 'string' && id.length > 0 };
  } catch { return { status: null, authenticated: false }; }
  finally { await response?.dispose().catch(() => {}); }
}

export async function waitForPlatformSignIn(context, { origin, directory, timeoutMs = 10 * 60_000, intervalMs = 1000 }) {
  const deadline = Date.now() + timeoutMs;
  let session = { status: null, authenticated: false };
  let closed = false;
  const onClose = () => { closed = true; };
  context.on('close', onClose);
  try {
    while (Date.now() < deadline && !closed) {
      if (context.pages().every(page => page.isClosed())) break;
      session = await readPlatformSession(context, origin);
      if (session.authenticated) {
        // Sign-in may return to a dashboard, workspace, or another tab.
        for (const page of context.pages().filter(page => platformPage(page, origin))) {
          if (await page.getByRole('button', { name: /^(?:Dashboard|User profile(?: and menu)?)$/i }).first().isVisible().catch(() => false)) return page;
        }
      }
      await delay(Math.min(intervalMs, Math.max(0, deadline - Date.now())));
    }
    if (directory) {
      const pages = context.pages().filter(page => !page.isClosed());
      writeFileSync(resolve(directory, 'sign-in-diagnostic.json'), JSON.stringify({
        status: 'authentication-blocked', sessionStatus: session.status,
        sessionAuthenticated: session.authenticated, browserClosed: closed,
        pages: pages.map(page => pageLocation(page, origin)),
      }, null, 2) + '\n');
      const page = pages.find(page => platformPage(page, origin));
      if (page && !session.authenticated) await page.screenshot({
        path: resolve(directory, 'sign-in-blocked.png'), timeout: 5000,
        mask: [page.locator('form, input, textarea, [contenteditable], [role="dialog"], [role="alert"], a[href*="token="]')],
      }).catch(() => {});
    }
    throw new Error('Sign-in was not confirmed by both the server and an authenticated BrainHalf page. No app generation was started. Run the command again and finish sign-in or email verification in the Chrome window it opens; the runner closes that window when it exits.');
  } finally { context.off('close', onClose); }
}
