import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';

/**
 * Landing hero redesign: screenshot the new aurora hero at the four required
 * widths, in dark and light themes, and assert the hero's key hooks are present.
 */
const WIDTHS = [
  { name: '360', width: 360, height: 780 },
  { name: '768', width: 768, height: 900 },
  { name: '1280', width: 1280, height: 800 },
  { name: '1920', width: 1920, height: 1080 },
] as const;

test.describe('Landing hero redesign', () => {
  for (const { name, width, height } of WIDTHS) {
    test(`hero renders at ${name}px wide (dark)`, async ({ page }) => {
      test.setTimeout(60000);
      await page.setViewportSize({ width, height });
      await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' });
      // Headless Chrome reports light prefers-color-scheme; force dark explicitly.
      await page.evaluate(() => {
        document.documentElement.dataset.theme = 'dark';
        document.documentElement.style.colorScheme = 'dark';
      });

      const hero = page.locator('.landing-hero-redesign');
      await expect(hero).toBeVisible();
      await expect(page.locator('#hero-heading')).toBeVisible();
      await expect(page.locator('.hero-cta-primary', { hasText: 'Start building' })).toBeVisible();
      await expect(page.locator('.hero-cta-secondary', { hasText: 'See examples' })).toBeVisible();
      // Composer hooks unchanged: the new-project flow's entry point.
      await expect(page.locator('#start-building.landing-prompt-box')).toBeVisible();
      await expect(page.locator('#app-idea.landing-prompt-textarea')).toBeVisible();
      await expect(page.locator('.landing-submit-btn')).toBeVisible();
      // Product visual + chips.
      await expect(page.locator('.hero-shot img[src="/images/landing-workspace.png"]')).toBeVisible();
      await expect(page.locator('.hero-chip-inventory')).toBeVisible();
      await expect(page.locator('.hero-chip-bookings')).toBeVisible();

      await hero.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: `audit-artifacts/landing-redesign/hero-${name}-dark.png`,
      });
    });

    test(`hero renders at ${name}px wide (light)`, async ({ page }) => {
      test.setTimeout(60000);
      await page.setViewportSize({ width, height });
      await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' });
      await page.evaluate(() => {
        document.documentElement.dataset.theme = 'light';
      });
      const hero = page.locator('.landing-hero-redesign');
      await expect(hero).toBeVisible();
      await hero.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: `audit-artifacts/landing-redesign/hero-${name}-light.png`,
      });
    });
  }

  test('typing placeholder cycles while the composer is empty', async ({ page }) => {
    test.setTimeout(60000);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' });
    const textarea = page.locator('#app-idea');
    // Wait for the typewriter to start filling the placeholder.
    await expect
      .poll(async () => textarea.getAttribute('placeholder'), { timeout: 15000 })
      .toMatch(/A crop tracker/);
    // Focusing the composer stops the performance and shows the static hint.
    await textarea.focus();
    await expect
      .poll(async () => textarea.getAttribute('placeholder'), { timeout: 5000 })
      .toBe('Describe your app in plain words…');
  });

  test('nav condenses on scroll', async ({ page }) => {
    test.setTimeout(60000);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' });
    const nav = page.locator('.site-navbar');
    await expect(nav).not.toHaveClass(/site-navbar-condensed/);
    await page.evaluate(() => window.scrollTo(0, 600));
    await expect(nav).toHaveClass(/site-navbar-condensed/);
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(nav).not.toHaveClass(/site-navbar-condensed/);
  });
});
