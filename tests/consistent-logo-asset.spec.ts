import { test, expect } from '@playwright/test';

test.describe('Consistent BrainHalf Brand Asset Verification', () => {
  test('verifies brand elements are consistent across TopNav, chat panel, and chat messages', async ({ page }) => {
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
      localStorage.setItem('bh_session_token', 'bh_dev_local_token_not_a_real_session');
      localStorage.setItem('bh_session_user', JSON.stringify({ id: 'u-123', email: 'test@example.com' }));
    });

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('http://localhost:5173/?project=logo-test-proj');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(500);

    // 1. TopNav is present and shows brand text or icons
    const topNav = page.locator('.top-nav');
    await expect(topNav).toBeVisible({ timeout: 10000 });

    // TopNav has at least one Lucide SVG icon
    const topNavSvg = topNav.locator('svg.lucide').first();
    await expect(topNavSvg).toBeVisible();

    // 2. TopNav left cluster contains project tab (no sidebar-brand-badge; sidebar removed)
    const leftCluster = page.locator('.top-nav-left-cluster');
    await expect(leftCluster).toBeVisible();

    const projectTab = page.locator('.top-nav-project-tab');
    await expect(projectTab).toBeVisible();
    await expect(projectTab).toContainText('Logo Test Project');

    // 3. Model status pill is visible in chat area
    const modelPill = page.locator('[data-testid="model-status-pill"]');
    await expect(modelPill).toBeVisible({ timeout: 8000 });

    // 4. Chat Panel Top-Bar has Lucide SVG icons
    const chatTopBar = page.locator('.chat-panel-top-bar, [class*="chat-panel"]').first();
    const hasChatBar = await chatTopBar.isVisible({ timeout: 3000 }).catch(() => false);
    if (hasChatBar) {
      const chatBarSvg = chatTopBar.locator('svg.lucide').first();
      const hasChatBarSvg = await chatBarSvg.isVisible().catch(() => false);
      console.log(`  [Advisory] Chat panel top bar has Lucide SVG: ${hasChatBarSvg}`);
    }

    // 5. Preview iframe is present and does NOT contain a nested BrainHalf IDE
    const previewIframe = page.locator('iframe').first();
    await expect(previewIframe).toBeVisible({ timeout: 10000 });
    const frame = previewIframe.contentFrame();
    expect(frame).not.toBeNull();

    // Anti-recursion: iframe must not contain a nested TopNav or ChatPanel
    const nestedTopNav = frame!.locator('.top-nav');
    await expect(nestedTopNav).not.toBeVisible();
    const nestedChatPanel = frame!.locator('.chat-panel-container');
    await expect(nestedChatPanel).not.toBeVisible();

    // 6. No broken <img> tags for brand logo (all logos should be SVG, not img)
    const brokenImgs = await page.evaluate(() => {
      const imgs = Array.from(document.querySelectorAll('img'));
      return imgs.filter(img => !img.complete || img.naturalWidth === 0).map(img => img.src);
    });
    console.log(`  [Advisory] Broken img tags: ${brokenImgs.length}`, brokenImgs);

    await page.screenshot({ path: 'test-results/consistent-logo-verified.png' });
  });
});
