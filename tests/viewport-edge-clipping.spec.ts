import { test, expect } from '@playwright/test';

test.describe('Viewport Toolbar Clipping Verification', () => {
  const viewports = [
    { name: 'desktop-1920', width: 1920, height: 1080 },
    { name: 'desktop-1440', width: 1440, height: 900 },
    { name: 'laptop-1280', width: 1280, height: 800 },
    { name: 'tablet-1024', width: 1024, height: 768 },
    { name: 'tablet-768', width: 768, height: 1024, isMobileLayout: true },
    { name: 'mobile-390', width: 390, height: 844, isMobileLayout: true }
  ];

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      const p = {
        id: 'hero-test-proj',
        name: 'Hero Test Project',
        framework: 'React 18 + Vite',
        status: 'ready',
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      localStorage.setItem('brainhalf_projects', JSON.stringify([p]));
      localStorage.setItem('brainhalf_active_project', p.id);
      localStorage.setItem('bh_session_token', 'bh_dev_local_token_not_a_real_session');
      localStorage.setItem('bh_session_user', JSON.stringify({ id: 'u-123', email: 'test@brainhalf.com' }));
    });
  });

  for (const vp of viewports) {
    test(`all three viewport options remain fully visible at ${vp.name} (${vp.width}x${vp.height})`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto('http://localhost:5173/?project=hero-test-proj');

      // If mobile layout, switch to preview tab to view the toolbar
      if (vp.isMobileLayout) {
        const previewTabBtn = page.locator('.segmented-tab:has-text("Preview")').first();
        if (await previewTabBtn.isVisible()) {
          await previewTabBtn.click();
        }
      }

      const chrome = page.locator('.browser-chrome');
      await expect(chrome).toBeVisible({ timeout: 10000 });

      // Verify all three viewport options are present (Edge button was removed)
      const desktopBtn = page.locator('.viewport-pill-btn:has-text("Desktop")');
      const tabletBtn = page.locator('.viewport-pill-btn:has-text("Tablet")');
      const mobileBtn = page.locator('.viewport-pill-btn:has-text("Mobile")');

      await expect(desktopBtn).toBeVisible();
      await expect(tabletBtn).toBeVisible();
      await expect(mobileBtn).toBeVisible();

      // Check bounding boxes — buttons must not be clipped inside the browser chrome
      const chromeBox = await chrome.boundingBox();
      const mobileBox = await mobileBtn.boundingBox();
      expect(chromeBox).not.toBeNull();
      expect(mobileBox).not.toBeNull();

      if (chromeBox && mobileBox) {
        // Mobile button must have a real width (not collapsed to icon-only)
        expect(mobileBox.width).toBeGreaterThan(45);

        // Right edge of Mobile button must have clearance within the container
        const clearance = (chromeBox.x + chromeBox.width) - (mobileBox.x + mobileBox.width);
        console.log(`[${vp.name}] Clearance to container right edge: ${clearance.toFixed(1)}px (Button width: ${mobileBox.width.toFixed(1)}px)`);
        expect(clearance).toBeGreaterThanOrEqual(10);
      }
    });
  }

  test('visual screenshot capture across viewports', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('http://localhost:5173/?project=hero-test-proj');
    await page.waitForSelector('.browser-chrome');
    await page.screenshot({ path: 'test-results/viewport-verified.png' });
  });
});
