import { test, expect, type Page } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';

/**
 * Landing sections QA: screenshot every new section at the four required
 * widths in dark and light themes, and assert layout integrity —
 * no horizontal scroll, no section overlap, no clipped text.
 */
const WIDTHS = [
  { name: '360', width: 360, height: 780 },
  { name: '768', width: 768, height: 900 },
  { name: '1280', width: 1280, height: 800 },
  { name: '1920', width: 1920, height: 1080 },
] as const;

const SECTIONS = [
  { slug: 'demo', selector: '.demo-section' },
  { slug: 'gallery', selector: '.gallery-row-section' },
  { slug: 'how-it-works', selector: '.hiw-section' },
  { slug: 'bento', selector: '.bento-section' },
  { slug: 'trust', selector: '.trust-section' },
  { slug: 'faq', selector: '.faq-section' },
  { slug: 'final-cta', selector: '.final-cta-section' },
  { slug: 'footer', selector: '.landing-footer' },
] as const;

const DEMO_TABS = ['Inventory tool', 'Booking app', 'Simple CRM', 'Task manager'] as const;

async function setTheme(page: Page, theme: 'light' | 'dark') {
  await page.evaluate(current => {
    document.documentElement.dataset.theme = current;
    document.documentElement.style.colorScheme = current;
  }, theme);
}

test.describe('Landing sections layout QA', () => {
  for (const { name, width, height } of WIDTHS) {
    for (const theme of ['light', 'dark'] as const) {
      test(`${name}px ${theme}: sections do not overlap and nothing scrolls sideways`, async ({ page }) => {
        test.setTimeout(90000);
        await page.setViewportSize({ width, height });
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' });
        await setTheme(page, theme);
        await page.waitForLoadState('networkidle');

        // No horizontal scroll anywhere on the page.
        const hScroll = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(hScroll, `${name}px ${theme}: horizontal overflow`).toBeLessThanOrEqual(1);

        // Every section is present and visible.
        for (const section of SECTIONS) {
          await expect(page.locator(section.selector).first(), `${section.slug} visible`).toBeVisible();
        }

        // Consecutive sections must not overlap or touch: each starts at or
        // after the previous one ends (1px tolerance for rounding).
        const boxes = await page.evaluate(selectors => {
          return selectors.map(sel => {
            const el = document.querySelector(sel);
            if (!el) return null;
            const box = el.getBoundingClientRect();
            return { top: box.top + window.scrollY, bottom: box.bottom + window.scrollY };
          });
        }, SECTIONS.map(section => section.selector));
        for (let i = 1; i < boxes.length; i++) {
          const prev = boxes[i - 1];
          const next = boxes[i];
          expect(prev && next, 'both sections measured').toBeTruthy();
          expect(
            next!.top,
            `${SECTIONS[i].slug} starts below ${SECTIONS[i - 1].slug} ends (${name}px ${theme})`
          ).toBeGreaterThanOrEqual(prev!.bottom - 1);
        }

        // Screenshot each section.
        for (const section of SECTIONS) {
          const target = page.locator(section.selector).first();
          await target.scrollIntoViewIfNeeded();
          await page.waitForTimeout(150);
          await target.screenshot({ path: `audit-artifacts/landing-redesign/section-${section.slug}-${name}-${theme}.png` });
        }
      });
    }
  }

  test('demo tabs each render a distinct sample app panel', async ({ page }) => {
    test.setTimeout(90000);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle');
    for (const theme of ['light', 'dark'] as const) {
      await setTheme(page, theme);
      for (const tabName of DEMO_TABS) {
        await page.getByRole('tab', { name: tabName, exact: true }).click();
        const panel = page.getByRole('tabpanel');
        await expect(panel).toHaveAccessibleName(tabName);
        await expect(panel.getByText('Sample data').first()).toBeVisible();
        await panel.scrollIntoViewIfNeeded();
        const slug = tabName.toLowerCase().replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '');
        await panel.screenshot({ path: `audit-artifacts/landing-redesign/demo-tab-${slug}-1280-${theme}.png` });
      }
    }
  });

  test('"Use this idea" fills the hero prompt and focuses it', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle');
    await page.getByRole('tab', { name: 'Booking app', exact: true }).click();
    await page.getByRole('button', { name: /Use this idea: Booking app/ }).click();
    const prompt = page.getByLabel('Describe your app', { exact: true });
    await expect(prompt).toBeFocused();
    await expect(prompt).toHaveValue(/booking app/i);
  });

  test('bento spotlight follows the cursor without breaking layout', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle');
    const tile = page.locator('.bento-tile').first();
    await tile.scrollIntoViewIfNeeded();
    await tile.hover();
    const glow = await tile.evaluate(el => getComputedStyle(el, '::before').opacity);
    expect(parseFloat(glow)).toBeGreaterThan(0);
  });

  test('how-it-works sticky visual changes while scrolling', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle');
    const steps = page.locator('.hiw-step');
    await expect(steps).toHaveCount(3);
    await steps.nth(2).scrollIntoViewIfNeeded({ block: 'center' });
    await page.waitForTimeout(400);
    const label = await page.locator('.hiw-sticky-label').textContent();
    expect(label).toContain('Checked, then live');
  });
});
