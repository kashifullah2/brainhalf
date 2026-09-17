import { test, expect } from '@playwright/test';

test.describe('Platform Smoke Tests', () => {
  test('loads app, asserts clean render, zero console errors, and zero failed network requests', async ({ page }) => {
    const consoleErrors: string[] = [];
    const failedRequests: Array<{ url: string; status: number }> = [];

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        // Ignore expected browser/extension noise if any
        consoleErrors.push(text);
      }
    });

    page.on('response', (response) => {
      // 4xx or 5xx responses (excluding deliberate 404s/favicon)
      const status = response.status();
      const url = response.url();
      if (status >= 400 && !url.includes('favicon.ico')) {
        failedRequests.push({ url, status });
      }
    });

    // Navigate to local dev/preview server
    const response = await page.goto('/', { waitUntil: 'domcontentloaded' });
    expect(response?.status()).toBeLessThan(400);

    // Wait for the app container or login screen to render
    const appRoot = page.locator('#root');
    await expect(appRoot).toBeVisible();

    // Verify presence of either the main IDE shell or the login screen
    const isLoginVisible = await page.locator('button:has-text("Sign in"), button:has-text("Continue"), input[type="email"]').first().isVisible().catch(() => false);
    const isIdeVisible = await page.locator('.chat-panel, .workspace, nav, header').first().isVisible().catch(() => false);

    expect(isLoginVisible || isIdeVisible).toBeTruthy();

    // Give asynchronous requests a moment to settle
    await page.waitForTimeout(1000);

    // Assert zero console errors
    expect(consoleErrors, `Observed console errors: ${consoleErrors.join(', ')}`).toEqual([]);

    // Assert zero failed network requests
    expect(
      failedRequests,
      `Observed failed network requests: ${JSON.stringify(failedRequests)}`
    ).toEqual([]);
  });
});
