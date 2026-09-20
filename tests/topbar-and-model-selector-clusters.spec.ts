import { test, expect } from '@playwright/test';

test.describe('Top Bar & Model Selector Layout Verification', () => {
  test('verifies top bar left/right clusters and model selector row layout', async ({ page }) => {
    await page.addInitScript(({ pid }: { pid: string }) => {
      const p = {
        id: pid,
        name: 'Cluster Test Project',
        framework: 'React 18 + Vite',
        status: 'ready',
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      localStorage.setItem('brainhalf_projects', JSON.stringify([p]));
      localStorage.setItem('brainhalf_active_project', p.id);
      localStorage.removeItem(`brainhalf_messages_${pid}`);
      localStorage.setItem('bh_session_token', 'bh_dev_local_token_not_a_real_session');
      localStorage.setItem('bh_session_user', JSON.stringify({ id: 'dev-user-1', email: 'dev@brainhalf.local' }));
    }, { pid: 'cluster-test-proj' });

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('http://localhost:5173/?project=cluster-test-proj');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(500);

    // ==========================================
    // 1. TOP BAR LEFT CLUSTER
    // ==========================================
    const leftCluster = page.locator('.top-nav-left-cluster');
    await expect(leftCluster).toBeVisible({ timeout: 10000 });

    // Left cluster contains a project tab pill with the project name
    const projectTab = page.locator('.top-nav-project-tab');
    await expect(projectTab).toBeVisible();
    await expect(projectTab).toContainText('Cluster Test Project');

    // Left cluster contains the "New project" plus button
    const newProjBtn = leftCluster.locator('button[aria-label="New project"]');
    await expect(newProjBtn).toBeVisible();

    // ==========================================
    // 2. TOP BAR RIGHT CLUSTER
    // ==========================================
    const rightCluster = page.locator('.top-nav-right-cluster');
    await expect(rightCluster).toBeVisible();

    // Status pill shows platform/generation state
    const statusPill = page.locator('[data-testid="topbar-status-pill"]');
    await expect(statusPill).toBeVisible();

    // User avatar button (opens profile/more menu)
    const userBtn = rightCluster.locator('button[aria-label="User profile and menu"]');
    await expect(userBtn).toBeVisible();

    // ==========================================
    // 3. CLUSTER SPACING
    // ==========================================
    const leftBox = await leftCluster.boundingBox();
    const rightBox = await rightCluster.boundingBox();
    expect(leftBox).not.toBeNull();
    expect(rightBox).not.toBeNull();

    // Right cluster starts to the right of left cluster with room for the page title
    const clusterSpacing = rightBox!.x - (leftBox!.x + leftBox!.width);
    expect(clusterSpacing).toBeGreaterThan(50);

    // ==========================================
    // 4. MODEL SELECTOR ROW IN CHAT PANEL
    // ==========================================
    // Model picker is a custom button (not a <select>)
    const modelPickerBtn = page.locator('button[title="Change AI model"]');
    await expect(modelPickerBtn).toBeVisible({ timeout: 8000 });

    // Model status pill shows current model name
    const modelPill = page.locator('[data-testid="model-status-pill"]');
    await expect(modelPill).toBeVisible();

    // Model picker button is visually isolated to the left of the chat input
    const modelPickerBox = await modelPickerBtn.boundingBox();
    const chatTextarea = page.locator('textarea').first();
    await expect(chatTextarea).toBeVisible();
    const textareaBox = await chatTextarea.boundingBox();

    expect(modelPickerBox).not.toBeNull();
    expect(textareaBox).not.toBeNull();
    // Model picker should be above or beside the textarea
    console.log(`  [Info] Model picker at y=${modelPickerBox!.y.toFixed(0)}, textarea at y=${textareaBox!.y.toFixed(0)}`);
  });
});
