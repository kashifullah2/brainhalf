import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';

/**
 * UI fix 6: the login modal must lock body scroll while open, keep the
 * "Resend verification email" link hidden until an unverified-email error
 * occurs, and use a neutral sign-in password placeholder.
 */
test.describe('Login modal', () => {
  test('locks body scroll, hides resend until verification is required', async ({ page }) => {
    test.setTimeout(60000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' });

    await page.locator('.landing-signin-btn').first().click({ timeout: 15000 });
    const modal = page.locator('.login-screen.is-modal');
    await expect(modal).toBeVisible({ timeout: 15000 });

    // Body scroll is locked while the modal is open.
    await expect
      .poll(async () => page.evaluate(() => document.body.style.overflow), { timeout: 5000 })
      .toBe('hidden');

    // The resend link is not offered until an unverified-email sign-in error.
    await expect(page.locator('.studio-auth-resend')).toHaveCount(0);

    // Neutral sign-in password placeholder (no signup hint text).
    await expect(page.locator('#login-password')).toHaveAttribute('placeholder', 'Enter your password');

    await page.screenshot({ path: 'audit-artifacts/ui-fixes-2026-09-30/login-modal.png' });

    // Closing the modal restores body scroll.
    await modal.locator('.studio-auth-close').click();
    await expect(modal).toBeHidden({ timeout: 5000 });
    await expect
      .poll(async () => page.evaluate(() => document.body.style.overflow), { timeout: 5000 })
      .not.toBe('hidden');
  });
});
