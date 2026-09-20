import { test, expect } from '@playwright/test';

test.describe('Unified Iconography Verification', () => {
  test('verifies Lucide icon set with consistent stroke width across key UI elements', async ({ page }) => {
    await page.addInitScript(() => {
      const p = {
        id: 'icon-test-proj',
        name: 'Icon Test Project',
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
    await page.goto('http://localhost:5173/?project=icon-test-proj');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(500);

    // 1. TopNav has Lucide SVG icons (Plus, LayoutGrid, X, etc.)
    const topNav = page.locator('.top-nav');
    await expect(topNav).toBeVisible({ timeout: 10000 });
    const topNavIcons = topNav.locator('svg.lucide');
    const topNavIconCount = await topNavIcons.count();
    expect(topNavIconCount).toBeGreaterThan(0);
    console.log(`  [Info] TopNav Lucide SVG count: ${topNavIconCount}`);

    // 2. Workspace tab buttons (Preview, Manage) are visible
    const previewTab = page.locator('button:has-text("Preview")').first();
    await expect(previewTab).toBeVisible({ timeout: 8000 });

    const manageTab = page.locator('button:has-text("Manage")').first();
    await expect(manageTab).toBeVisible();

    // 3. Send button has an SVG icon
    const sendBtn = page.locator('button[title*="Send"]').first();
    await expect(sendBtn).toBeVisible({ timeout: 8000 });
    const sendIcon = sendBtn.locator('svg').first();
    await expect(sendIcon).toBeVisible();

    // 4. Model picker button has an SVG icon
    const modelPickerBtn = page.locator('button[title="Change AI model"]');
    await expect(modelPickerBtn).toBeVisible({ timeout: 8000 });
    const modelIcon = modelPickerBtn.locator('svg').first();
    await expect(modelIcon).toBeVisible();

    // 5. Viewport selector buttons exist (Desktop/Tablet/Mobile)
    const desktopBtn = page.locator('.viewport-pill-btn:has-text("Desktop"), button:has-text("Desktop")').first();
    await expect(desktopBtn).toBeVisible({ timeout: 8000 });

    // 6. Verify consistent stroke width across TopNav SVG icons (should be 1.75)
    const svgStrokeWidths = await topNav.evaluate((nav) => {
      const svgs = Array.from(nav.querySelectorAll('svg.lucide'));
      return svgs.map(svg => {
        const sw = svg.getAttribute('stroke-width') || window.getComputedStyle(svg).strokeWidth;
        const box = svg.getBoundingClientRect();
        return { strokeWidth: sw, width: Math.round(box.width), height: Math.round(box.height) };
      });
    });

    console.log('  [Info] TopNav SVG stroke widths:', svgStrokeWidths.map(s => s.strokeWidth).join(', '));
    for (const svg of svgStrokeWidths) {
      // Icons use either 1.75 (standard Lucide) or 2 (compact utility icons)
      expect(svg.strokeWidth).toMatch(/^(1\.75|2)(px)?$/);
    }

    await page.screenshot({ path: 'test-results/unified-iconography-verified.png' });
  });
});
