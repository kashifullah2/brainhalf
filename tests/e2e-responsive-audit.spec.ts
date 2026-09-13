import { test, expect } from '@playwright/test';

const BASE_URL = 'https://brainhalf.com';
const ARTIFACT_DIR = '/home/kashifullah/.gemini/antigravity-ide/brain/bdade561-eefd-4bc6-bb08-2adeffc71475';

const VIEWPORTS = [
  // Mobile
  { name: 'mobile-320', width: 320, height: 568, tier: 'mobile' },
  { name: 'mobile-375', width: 375, height: 812, tier: 'mobile' },
  { name: 'mobile-390', width: 390, height: 844, tier: 'mobile' },
  { name: 'mobile-430', width: 430, height: 932, tier: 'mobile' },
  // Tablet
  { name: 'tablet-768', width: 768, height: 1024, tier: 'tablet' },
  { name: 'tablet-820', width: 820, height: 1180, tier: 'tablet' },
  // Desktop
  { name: 'desktop-1280', width: 1280, height: 720, tier: 'desktop' },
  { name: 'desktop-1440', width: 1440, height: 900, tier: 'desktop' },
  { name: 'desktop-1920', width: 1920, height: 1080, tier: 'desktop' },
];

test.describe('E2E Responsive Layout & Overflow Audit', () => {
  for (const vp of VIEWPORTS) {
    test(`Viewport ${vp.name} (${vp.width}x${vp.height}) layout integrity`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(BASE_URL, { waitUntil: 'networkidle' });
      await page.waitForTimeout(400);

      // Verify page title
      await expect(page).toHaveTitle(/brainhalf/i);

      // Check that there is NO unintended horizontal body scroll
      const hasHorizontalScroll = await page.evaluate(() => {
        return document.documentElement.scrollWidth > window.innerWidth + 5;
      });
      expect(hasHorizontalScroll).toBeFalsy();

      if (vp.tier === 'mobile') {
        // Mobile-specific checks: TopNav brand is visible
        const mobileBrand = page.locator('text=BrainHalf').first();
        await expect(mobileBrand).toBeVisible();

        // Check mobile bottom navigation bar or mobile tabs
        const mobileTabs = page.locator('button:has-text("Chat"), button:has-text("Preview"), button:has-text("Workspace")');
        const count = await mobileTabs.count();
        expect(count).toBeGreaterThan(0);
      } else if (vp.tier === 'tablet') {
        // Tablet: sidebar auto-collapses or stays toggleable
        const brand = page.locator('text=BrainHalf').first();
        await expect(brand).toBeVisible();
      } else {
        // Desktop: full sidebar and top bar visible
        const desktopBrand = page.locator('text=BrainHalf').first();
        await expect(desktopBrand).toBeVisible();
      }

      // Capture screenshots for sample viewports
      if (vp.name === 'mobile-375' || vp.name === 'tablet-768' || vp.name === 'desktop-1920') {
        await page.screenshot({ path: `${ARTIFACT_DIR}/playwright_viewport_${vp.name}.png` });
        console.log(`Captured screenshot for ${vp.name}`);
      }
    });
  }
});
