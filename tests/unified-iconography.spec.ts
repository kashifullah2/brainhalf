import { test, expect } from '@playwright/test';

test.describe('Unified Iconography Verification', () => {
  test('verifies single consistent icon set (Lucide) with uniform stroke width and size', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('http://localhost:5173');
    await page.waitForLoadState('networkidle');

    // 1. Verify Logo is now a Lucide SVG icon (BrainCircuit) instead of an img tag
    const brandBadge = page.locator('.sidebar-brand-badge');
    await expect(brandBadge).toBeVisible();
    const brandSvg = brandBadge.locator('svg.lucide');
    await expect(brandSvg).toBeVisible();
    await expect(brandBadge.locator('img')).toHaveCount(0);

    // 2. Verify Code icon in sidebar project items and workspace tabs
    const projectItems = page.locator('.sidebar-nav-item');
    await expect(projectItems.first()).toBeVisible();
    const projectCodeIcon = projectItems.first().locator('svg.lucide').first();
    await expect(projectCodeIcon).toBeVisible();

    const codeTab = page.locator('.segmented-tab', { hasText: 'Code' });
    await expect(codeTab).toBeVisible();
    const codeTabIcon = codeTab.locator('svg.lucide');
    await expect(codeTabIcon).toBeVisible();

    // 3. Verify Paperclip icon in chat input bar
    const paperclipBtn = page.locator('button[title*="Attach File"]');
    await expect(paperclipBtn).toBeVisible();
    const paperclipIcon = paperclipBtn.locator('svg.lucide');
    await expect(paperclipIcon).toBeVisible();

    // 4. Verify Send arrow icon in chat input bar
    const sendBtn = page.locator('button[title*="Send Message"]');
    await expect(sendBtn).toBeVisible();
    const sendIcon = sendBtn.locator('svg.lucide');
    await expect(sendIcon).toBeVisible();

    // 5. Verify Settings gear icon in sidebar footer
    const settingsBtn = page.locator('button', { hasText: 'Settings' });
    await expect(settingsBtn).toBeVisible();
    const settingsIcon = settingsBtn.locator('svg.lucide');
    await expect(settingsIcon).toBeVisible();

    // 6. Verify consistent stroke width across all tested key icons
    const icons = [brandSvg, projectCodeIcon, codeTabIcon, paperclipIcon, sendIcon, settingsIcon];
    for (const icon of icons) {
      const strokeWidth = await icon.evaluate((el) => {
        return window.getComputedStyle(el).strokeWidth;
      });
      expect(strokeWidth).toMatch(/1\.75px|1\.75/);

      const box = await icon.boundingBox();
      expect(box).not.toBeNull();
      expect(Math.round(box!.width)).toBe(16);
      expect(Math.round(box!.height)).toBe(16);
    }

    // Capture visual confirmation screenshot
    await page.screenshot({ path: '/home/kashifullah/.gemini/antigravity-ide/brain/bdade561-eefd-4bc6-bb08-2adeffc71475/unified_iconography_verified.png' });
  });
});
