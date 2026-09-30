import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';

/**
 * UI fix 7: scrollbar thumbs must stay visible in both themes (the old CSS
 * hardcoded white thumbs, nearly invisible in light mode), and the
 * `select { color-scheme: dark }` rule must not force dark native controls
 * in light mode.
 */
test.describe('Themed scrollbars', () => {
  test('scrollbar colors and select color-scheme follow the active theme', async ({ page }) => {
    test.setTimeout(60000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' });

    const values = await page.evaluate(() => {
      const sel = document.createElement('select');
      document.body.appendChild(sel);
      const read = () => ({
        thumb: getComputedStyle(document.documentElement).getPropertyValue('--scrollbar-thumb').trim(),
        selectScheme: getComputedStyle(sel).colorScheme,
      });
      const dark = read();
      document.documentElement.dataset.theme = 'light';
      const light = read();
      sel.remove();
      return { dark, light };
    });

    // Dark theme (default): light thumbs on dark surfaces.
    expect(values.dark.thumb).toBe('rgba(255, 255, 255, 0.16)');
    expect(values.dark.selectScheme).toBe('dark');
    // Light theme: dark thumbs stay visible on light surfaces.
    expect(values.light.thumb).toBe('rgba(0, 0, 0, 0.28)');
    expect(values.light.selectScheme).toBe('light');

    await page.screenshot({ path: 'audit-artifacts/ui-fixes-2026-09-30/scrollbars-light.png' });
  });
});
