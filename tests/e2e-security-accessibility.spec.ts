import { test, expect } from '@playwright/test';

const PROD_URL = 'https://brainhalf.com';

test.describe('E2E Security & Accessibility Audit', () => {
  test('1. Accessibility: Keyboard focus, ARIA landmarks, and input labels', async ({ page }) => {
    await page.addInitScript(() => {
      const p = {
        id: 'a11y-test-proj',
        name: 'A11y Test Project',
        framework: 'React 18 + Vite',
        status: 'ready',
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      localStorage.setItem('brainhalf_projects', JSON.stringify([p]));
      localStorage.setItem('brainhalf_active_project', p.id);
      localStorage.setItem('bh_session_token', 'bh_dev_local_token_not_a_real_session');
      localStorage.setItem('bh_session_user', JSON.stringify({ id: 'dev-user-1', email: 'dev@brainhalf.local' }));
    });

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('http://localhost:5173/?project=a11y-test-proj', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);

    // 1. Check TopNav ARIA landmark (role="banner")
    const banner = page.locator('[role="banner"]');
    await expect(banner).toBeVisible({ timeout: 10000 });

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
    // 1. Path traversal injection test on production edge preview endpoints (HTTP-only)
    const traversalUrls = [
      `${PROD_URL}/preview/test/../../etc/passwd`,
      `${PROD_URL}/preview/test/..%2f..%2fpackage.json`,
      `${PROD_URL}/preview/test/....//....//worker.ts`
    ];

    for (const url of traversalUrls) {
      const res = await request.get(url).catch((_e: unknown) => null);
      if (res) {
        // Status must not be 500 (server error) — 404 or 400 are acceptable
        expect(res.status()).not.toBe(500);
        const text = await res.text();
        expect(text).not.toContain('root:x:0:0');
        expect(text).not.toContain('ANTHROPIC_API_KEY');
      }
    }

    // 2. Frontend DOM secret leak check (on localhost)
    await page.addInitScript(() => {
      localStorage.setItem('bh_session_token', 'bh_dev_local_token_not_a_real_session');
      localStorage.setItem('bh_session_user', JSON.stringify({ id: 'dev-user-1', email: 'dev@brainhalf.local' }));
    });
    await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' });

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
