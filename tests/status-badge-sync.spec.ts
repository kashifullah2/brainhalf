import { test, expect } from '@playwright/test';

test.describe('Status Badge Logic & Unified Single Source of Truth Verification', () => {
  test('fresh project with no prompt sent reads Ready (top-bar) and Active (model-panel), never Building', async ({ page }) => {
    // Initialize with a fresh/empty project
    await page.addInitScript(() => {
      const freshProj = {
        id: 'fresh-status-proj',
        name: 'Fresh Status Project',
        framework: 'React 18 + Vite',
        status: 'ready',
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      localStorage.setItem('brainhalf_projects', JSON.stringify([freshProj]));
      localStorage.setItem('brainhalf_active_project', freshProj.id);
      localStorage.setItem('bh_session_token', 'bh_dev_local_token_not_a_real_session');
      localStorage.setItem('bh_session_user', JSON.stringify({ id: 'dev-user-1', email: 'dev@brainhalf.local' }));
      localStorage.removeItem('brainhalf_messages_fresh-status-proj');
    });

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('http://localhost:5173/?project=fresh-status-proj');
    await page.waitForLoadState('domcontentloaded');

    // 1. Verify Top-bar status badge
    const topBarStatus = page.locator('[data-testid="topbar-status-pill"]');
    await expect(topBarStatus).toBeVisible();
    await expect(topBarStatus).toContainText('Ready');
    await expect(topBarStatus).not.toContainText('Building');

    // Check top bar dot is green
    const topBarDot = topBarStatus.locator('span').first();
    const topBarDotColor = await topBarDot.evaluate((el) => window.getComputedStyle(el).backgroundColor);
    // var(--color-success) resolves to rgb(16, 185, 129)
    expect(topBarDotColor).toBe('rgb(16, 185, 129)');

    // 2. Verify Model-panel status indicator
    const modelStatus = page.locator('[data-testid="model-status-pill"]');
    await expect(modelStatus).toBeVisible();
    await expect(modelStatus).toContainText('Active');
    await expect(modelStatus).not.toContainText('Building');

    // Check model panel dot is also green
    const modelDot = modelStatus.locator('span').first();
    const modelDotColor = await modelDot.evaluate((el) => window.getComputedStyle(el).backgroundColor);
    expect(modelDotColor).toBe('rgb(16, 185, 129)');

    // 3. Take screenshot of fresh state
    await page.screenshot({ path: 'test-results/status-badge-fresh-ready.png' });
  });

  test('top-bar and model-panel synchronously transition to Building when prompt is submitted', async ({ page }) => {
    await page.addInitScript(() => {
      const p = {
        id: 'build-test-proj',
        name: 'Build Test Project',
        framework: 'React 18 + Vite',
        status: 'ready',
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      localStorage.setItem('brainhalf_projects', JSON.stringify([p]));
      localStorage.setItem('brainhalf_active_project', p.id);
      localStorage.setItem('bh_session_token', 'bh_dev_local_token_not_a_real_session');
      localStorage.setItem('bh_session_user', JSON.stringify({ id: 'dev-user-1', email: 'dev@brainhalf.local' }));
      localStorage.removeItem('brainhalf_messages_build-test-proj');
    });

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('http://localhost:5173/?project=build-test-proj');
    await page.waitForLoadState('domcontentloaded');

    const topBarStatus = page.locator('[data-testid="topbar-status-pill"]');
    const modelStatus = page.locator('[data-testid="model-status-pill"]');

    // Initial state check
    await expect(topBarStatus).toContainText('Ready');
    await expect(modelStatus).toContainText('Active');

    // Type a prompt into chat textarea
    const chatInput = page.locator('textarea[placeholder*="BrainHalf"], textarea').first();
    await chatInput.fill('Build a simple counter widget');

    // Click send
    const sendBtn = page.locator('button[title*="Send"]');
    await sendBtn.click();

    // Both must synchronously show "Building" with blue dots
    await expect(topBarStatus).toContainText('Building');
    await expect(modelStatus).toContainText('Building');

    // Check blue dots
    const topDot = topBarStatus.locator('span').first();
    const modelDot = modelStatus.locator('span').first();
    const topDotColor = await topDot.evaluate((el) => window.getComputedStyle(el).backgroundColor);
    const modelDotColor = await modelDot.evaluate((el) => window.getComputedStyle(el).backgroundColor);
    expect(topDotColor).toBe('rgb(59, 130, 246)');
    expect(modelDotColor).toBe('rgb(59, 130, 246)');

    // Click stop button to test transition to Stopped
    const stopBtn = page.locator('button[title*="Stop"]');
    if (await stopBtn.isVisible()) {
      await stopBtn.click();
      await expect(topBarStatus).toContainText('Stopped');
      await expect(modelStatus).toContainText('Stopped');
    }

    await page.screenshot({ path: 'test-results/status-badge-sync-building.png' });
  });

  test('switching between projects does not contaminate fresh project status', async ({ page }) => {
    await page.addInitScript(() => {
      const p1 = {
        id: 'proj-with-history',
        name: 'Project With History',
        framework: 'React 18 + Vite',
        status: 'ready',
        createdAt: Date.now() - 5000,
        updatedAt: Date.now() - 5000
      };
      const p2 = {
        id: 'proj-empty-fresh',
        name: 'Project Empty Fresh',
        framework: 'React 18 + Vite',
        status: 'ready',
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      localStorage.setItem('brainhalf_projects', JSON.stringify([p1, p2]));
      localStorage.setItem('brainhalf_active_project', p1.id);
      localStorage.setItem('bh_session_token', 'bh_dev_local_token_not_a_real_session');
      localStorage.setItem('bh_session_user', JSON.stringify({ id: 'dev-user-1', email: 'dev@brainhalf.local' }));
      localStorage.setItem('brainhalf_messages_proj-with-history', JSON.stringify([
        { role: 'user', content: 'Initial prompt' },
        { role: 'ai', content: 'Generated code' }
      ]));
      localStorage.removeItem('brainhalf_messages_proj-empty-fresh');
    });

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('http://localhost:5173/?project=proj-with-history');
    await page.waitForLoadState('domcontentloaded');

    const topBarStatus = page.locator('[data-testid="topbar-status-pill"]');
    const modelStatus = page.locator('[data-testid="model-status-pill"]');

    // Both should start as Ready / Active
    await expect(topBarStatus).toContainText('Ready');
    await expect(modelStatus).toContainText('Active');

    // Switch to fresh project via URL navigation (workspace project switching uses URL params)
    await page.goto('http://localhost:5173/?project=proj-empty-fresh');
    await page.waitForLoadState('domcontentloaded');

    // Verify on the fresh project it is strictly Ready & Active, never Building
    await expect(topBarStatus).toContainText('Ready');
    await expect(topBarStatus).not.toContainText('Building');
    await expect(modelStatus).toContainText('Active');
    await expect(modelStatus).not.toContainText('Building');
  });
});
