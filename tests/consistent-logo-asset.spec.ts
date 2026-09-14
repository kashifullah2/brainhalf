import { test, expect } from '@playwright/test';

test.describe('Consistent BrainHalf SVG Logo Asset Verification', () => {
  test('verifies single consistent SVG logo is used across sidebar, chat avatar, top-nav, and centered empty-state', async ({ page }) => {
    // Clear project messages and ensure clean project
    await page.addInitScript(() => {
      const p = {
        id: 'logo-test-proj',
        name: 'Logo Test Project',
        framework: 'React 18 + Vite',
        status: 'ready',
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      localStorage.setItem('brainhalf_projects', JSON.stringify([p]));
      localStorage.setItem('brainhalf_active_project', p.id);
      localStorage.removeItem('brainhalf_messages_logo-test-proj');
      localStorage.removeItem('brainhalf_files_logo-test-proj');
    });

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('http://localhost:5173');
    await page.waitForLoadState('networkidle');

    // 1. Sidebar Brand Badge SVG
    const sidebarLogo = page.locator('.sidebar-brand-badge svg.lucide-brain-circuit');
    await expect(sidebarLogo).toBeVisible();
    const sidebarStrokeWidth = await sidebarLogo.evaluate((el) => window.getComputedStyle(el).strokeWidth);
    expect(sidebarStrokeWidth).toMatch(/1\.75px|1\.75/);

    // 2. Top-Nav Brand Icon SVG
    const topNavLogo = page.locator('.top-nav-left-cluster svg.lucide-brain-circuit');
    await expect(topNavLogo).toBeVisible();
    const topNavStrokeWidth = await topNavLogo.evaluate((el) => window.getComputedStyle(el).strokeWidth);
    expect(topNavStrokeWidth).toMatch(/1\.75px|1\.75/);

    // 3. Chat Panel Top-Bar Brand Icon SVG
    const chatBarLogo = page.locator('.chat-panel-top-bar svg.lucide-brain-circuit');
    await expect(chatBarLogo).toBeVisible();
    const chatBarStrokeWidth = await chatBarLogo.evaluate((el) => window.getComputedStyle(el).strokeWidth);
    expect(chatBarStrokeWidth).toMatch(/1\.75px|1\.75/);

    // 4. Chat Message AI Avatar SVG (from default welcome message)
    const chatAvatarLogo = page.locator('.chat-message svg.lucide-brain-circuit');
    await expect(chatAvatarLogo.first()).toBeVisible();
    const chatAvatarStrokeWidth = await chatAvatarLogo.first().evaluate((el) => window.getComputedStyle(el).strokeWidth);
    expect(chatAvatarStrokeWidth).toMatch(/1\.75px|1\.75/);

    // 5. Centered Empty-State Hero Icon in Preview Frame
    const previewIframe = page.locator('iframe[title="Cloudflare Edge Preview"]');
    await expect(previewIframe).toBeVisible();
    const frame = previewIframe.contentFrame();
    expect(frame).not.toBeNull();

    const heroContainer = frame!.locator('.hero-icon-container');
    await expect(heroContainer).toBeVisible();

    // Verify it is an SVG with the exact same brain-circuit shape, NOT an img tag!
    await expect(heroContainer.locator('img')).toHaveCount(0);
    const heroSvg = heroContainer.locator('svg.lucide-brain-circuit');
    await expect(heroSvg).toBeVisible();

    // Verify scaled up size (36px)
    const heroSvgBox = await heroSvg.boundingBox();
    expect(heroSvgBox).not.toBeNull();
    expect(Math.round(heroSvgBox!.width)).toBe(36);
    expect(Math.round(heroSvgBox!.height)).toBe(36);

    // Verify same strokeWidth (1.75)
    const heroStrokeWidth = await heroSvg.evaluate((el) => window.getComputedStyle(el).strokeWidth);
    expect(heroStrokeWidth).toMatch(/1\.75px|1\.75/);

    // Verify soft glow effect on the centered version
    const heroFilter = await heroSvg.evaluate((el) => window.getComputedStyle(el).filter);
    expect(heroFilter).not.toBe('none');
    expect(heroFilter).toContain('drop-shadow');

    // 6. Verify underlying SVG path data matches across all icons
    const sidebarPath = await sidebarLogo.locator('path').first().getAttribute('d');
    const heroPath = await heroSvg.locator('path').first().getAttribute('d');
    const chatPath = await chatAvatarLogo.first().locator('path').first().getAttribute('d');
    expect(sidebarPath).toBe(heroPath);
    expect(chatPath).toBe(heroPath);

    // Capture visual confirmation screenshot
    await page.screenshot({ path: 'test-results/consistent-logo-verified.png' });
  });
});
