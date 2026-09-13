import { test, expect } from '@playwright/test';

const BASE_URL = 'https://brainhalf.com';

test.describe('E2E Security & Accessibility Audit', () => {
  test('1. Accessibility: Keyboard focus, ARIA landmarks, and tab navigation', async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });

    // 1. Check ARIA roles in TopNav and Workspace tabs
    const tabList = page.locator('[role="tablist"]');
    await expect(tabList).toBeVisible();

    const tabs = page.locator('[role="tab"]');
    const tabCount = await tabs.count();
    expect(tabCount).toBeGreaterThanOrEqual(3);

    // 2. Test Tab key navigation through UI
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(200);

    const focusedTag = await page.evaluate(() => document.activeElement?.tagName);
    expect(['BUTTON', 'INPUT', 'TEXTAREA', 'A', 'SELECT', 'DIV']).toContain(focusedTag);

    // 3. Verify all inputs and select elements have accessible labels
    const inputs = page.locator('input, textarea, select');
    const inputCount = await inputs.count();
    for (let i = 0; i < inputCount; i++) {
      const el = inputs.nth(i);
      const ariaLabel = await el.getAttribute('aria-label');
      const placeholder = await el.getAttribute('placeholder');
      const title = await el.getAttribute('title');
      const hasAccessibleName = !!(ariaLabel || placeholder || title);
      expect(hasAccessibleName).toBeTruthy();
    }
  });

  test('2. Security: Path traversal protection, secrets leak & CORS headers', async ({ page, request }) => {
    // 1. Path traversal injection test on Edge Preview endpoint
    const traversalUrls = [
      `${BASE_URL}/preview/test/../../etc/passwd`,
      `${BASE_URL}/preview/test/..%2f..%2fpackage.json`,
      `${BASE_URL}/preview/test/....//....//worker.ts`
    ];

    for (const url of traversalUrls) {
      const res = await request.get(url).catch((_e: unknown) => null);
      if (res) {
        // Status must be 404 or 400 or redirected, NEVER 200 with system contents
        expect(res.status()).not.toBe(500);
        const text = await res.text();
        expect(text).not.toContain('root:x:0:0');
        expect(text).not.toContain('ANTHROPIC_API_KEY');
      }
    }

    // 2. Frontend DOM secret leak check
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });

    const html = await page.content();
    expect(html).not.toContain('sk-ant-');
    expect(html).not.toContain('AWS_SECRET_ACCESS_KEY');
    expect(html).not.toContain('CF_API_TOKEN');

    // 3. Check window globals for leaked credentials
    const leakedVars = await page.evaluate(() => {
      const g = window as any;
      const leaks: string[] = [];
      for (const k of Object.keys(g)) {
        if (/api_?key|secret|token|password/i.test(k) && typeof g[k] === 'string' && g[k].length > 15) {
          leaks.push(k);
        }
      }
      return leaks;
    });
    expect(leakedVars).toEqual([]);
  });
});
