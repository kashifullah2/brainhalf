import { test, expect } from './auth.fixture';

/**
 * The login gate is the first thing every other spec depends on, and the thing
 * most easily broken by an auth change. This spec pins both halves of the
 * contract: an unauthenticated visit never reaches the workspace, and the
 * authenticated fixture does.
 *
 * Requires `npm run dev` (the webServer in playwright.config starts it); the
 * dev server stubs `/api/auth/*` (src/lib/dev-auth-mock.ts) or
 * `BRAINHALF_API_BASE` points at a real Worker.
 */

test.describe('login gate', () => {
  test('blocks the workspace for an anonymous visit', async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.removeItem('bh_session_token');
        localStorage.removeItem('bh_session_user');
      } catch {
        /* no storage */
      }
    });
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    // Unauthenticated visit to root renders the Landing Page with Get Started / Sign in, never the workspace
    await expect(page.locator('.workspace-area')).not.toBeVisible();
    await expect(page.locator('button:has-text("Get Started"), button:has-text("Sign in")').first()).toBeVisible();

    // Direct anonymous visit to a workspace route renders the login gate
    await page.goto('/?project=protected-test', { waitUntil: 'domcontentloaded' });
    await expect(page.getByLabel('Email Address')).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();
  });

  test('reaches the workspace with the authenticated fixture', async ({ authenticatedPage: page }) => {
    await page.goto('/?project=auth-test-proj', { waitUntil: 'domcontentloaded' });

    // A verified session reaches the workspace
    await expect(page.getByLabel('Email Address')).not.toBeVisible();
    await expect(page.locator('.workspace-area')).toBeVisible();
    await expect(page.locator('.top-nav')).toBeVisible();
  });

  test('rejects a bad password on the login screen', async ({ page }) => {
    await page.goto('/?project=bad-login-proj', { waitUntil: 'domcontentloaded' });
    await expect(page.getByLabel('Email Address')).toBeVisible();
    await page.getByLabel('Email Address').fill('dev@brainhalf.local');
    await page.getByLabel('Password').fill('wrong-password');
    await page.getByRole('button', { name: 'Sign in' }).click();

    // The dev stub rejects a bad login; the form surfaces it
    await expect(page.getByRole('alert')).toContainText(/invalid email or password/i);
  });
});
