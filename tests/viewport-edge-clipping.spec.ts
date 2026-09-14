import { test, expect } from '@playwright/test';

test.describe('Viewport Toolbar and Edge Button Clipping Verification', () => {
  const viewports = [
    { name: 'desktop-1920', width: 1920, height: 1080 },
    { name: 'desktop-1440', width: 1440, height: 900 },
    { name: 'laptop-1280', width: 1280, height: 800 },
    { name: 'tablet-1024', width: 1024, height: 768 },
    { name: 'tablet-768', width: 768, height: 1024, isMobileLayout: true },
    { name: 'mobile-390', width: 390, height: 844, isMobileLayout: true }
  ];

  for (const vp of viewports) {
    test(`all four options remain fully visible and clickable at ${vp.name} (${vp.width}x${vp.height})`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto('http://localhost:5173');

      // If mobile layout, switch to preview tab to view the toolbar
      if (vp.isMobileLayout) {
        const previewTabBtn = page.locator('.segmented-tab:has-text("Preview")').first();
        if (await previewTabBtn.isVisible()) {
          await previewTabBtn.click();
        }
      }

      const chrome = page.locator('.browser-chrome');
      await expect(chrome).toBeVisible({ timeout: 10000 });

      // Verify all four options are present
      const desktopBtn = page.locator('.viewport-pill-btn:has-text("Desktop")');
      const tabletBtn = page.locator('.viewport-pill-btn:has-text("Tablet")');
      const mobileBtn = page.locator('.viewport-pill-btn:has-text("Mobile")');
      const edgeBtn = page.locator('.viewport-pill-btn:has-text("Edge")');

      await expect(desktopBtn).toBeVisible();
      await expect(tabletBtn).toBeVisible();
      await expect(mobileBtn).toBeVisible();
      await expect(edgeBtn).toBeVisible();

      // Check bounding boxes
      const chromeBox = await chrome.boundingBox();
      const edgeBox = await edgeBtn.boundingBox();
      expect(chromeBox).not.toBeNull();
      expect(edgeBox).not.toBeNull();

      if (chromeBox && edgeBox) {
        // Edge button must not be constrained to 24px icon box
        expect(edgeBox.width).toBeGreaterThan(45);

        // Distance from right edge of Edge button to right edge of container must be > 0 (strictly inside with padding)
        const clearance = (chromeBox.x + chromeBox.width) - (edgeBox.x + edgeBox.width);
        console.log(`[${vp.name}] Clearance to container right edge: ${clearance.toFixed(1)}px (Button width: ${edgeBox.width.toFixed(1)}px)`);
        expect(clearance).toBeGreaterThanOrEqual(10); // At least 10px right padding/margin
      }

      // Verify Edge button is fully clickable and opens runtime menu
      await edgeBtn.click();
      const menu = page.locator('.deploy-menu-item:has-text("Cloudflare Edge")');
      await expect(menu).toBeVisible();

      // Close menu by clicking again
      await edgeBtn.click();
      await expect(menu).toBeHidden();
    });
  }

  test('visual screenshot capture across viewports', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('http://localhost:5173');
    await page.waitForSelector('.browser-chrome');
    await page.screenshot({
      path: '/home/kashifullah/.gemini/antigravity-ide/brain/bdade561-eefd-4bc6-bb08-2adeffc71475/viewport-edge-verified.png'
    });
  });
});
