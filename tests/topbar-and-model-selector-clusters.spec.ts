import { test, expect } from '@playwright/test';

test.describe('Top Bar & Model Selector Clusters Reorganization Verification', () => {
  test('verifies top bar two clusters and model selector row layout', async ({ page }) => {
    // Set up a clean project in localStorage
    await page.addInitScript(() => {
      const p = {
        id: 'cluster-test-proj',
        name: 'Cluster Test Project',
        framework: 'React 18 + Vite',
        status: 'ready',
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      localStorage.setItem('brainhalf_projects', JSON.stringify([p]));
      localStorage.setItem('brainhalf_active_project', p.id);
      localStorage.removeItem('brainhalf_messages_cluster-test-proj');
    });

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('http://localhost:5173');
    await page.waitForLoadState('networkidle');

    // ==========================================
    // 1. TOP BAR CLUSTERS VERIFICATION
    // ==========================================
    const leftCluster = page.locator('.top-nav-left-cluster');
    await expect(leftCluster).toBeVisible();

    // Verify left cluster contains project name
    const projectName = leftCluster.locator('h2');
    await expect(projectName).toHaveText('Cluster Test Project');

    // Verify left cluster contains status pill
    const statusPill = leftCluster.locator('.status-pill');
    await expect(statusPill).toBeVisible();
    await expect(statusPill).toContainText('Ready');

    // Verify right cluster
    const rightCluster = page.locator('.top-nav-right-cluster');
    await expect(rightCluster).toBeVisible();

    // Verify right cluster contains Deploy button
    const deployBtn = rightCluster.locator('.deploy-main-action');
    await expect(deployBtn).toBeVisible();
    await expect(deployBtn).toContainText('Deploy');

    // Verify right cluster contains More Options button
    const moreBtn = rightCluster.locator('button[aria-label="More project actions"]');
    await expect(moreBtn).toBeVisible();

    // Verify visible spacing between left cluster and right cluster
    const leftBox = await leftCluster.boundingBox();
    const rightBox = await rightCluster.boundingBox();
    expect(leftBox).not.toBeNull();
    expect(rightBox).not.toBeNull();

    // The gap between the end of the left cluster and the start of the right cluster
    const clusterSpacing = rightBox!.x - (leftBox!.x + leftBox!.width);
    expect(clusterSpacing).toBeGreaterThan(100);

    // ==========================================
    // 2. MODEL SELECTOR ROW VERIFICATION
    // ==========================================
    const modelRow = page.locator('.chat-panel-top-bar');
    await expect(modelRow).toBeVisible();

    // Left group contains model dropdown + connection status dot
    const modelLeftGroup = modelRow.locator('.model-selector-left-group');
    await expect(modelLeftGroup).toBeVisible();

    const modelSelect = modelLeftGroup.locator('select[aria-label="Select AI Model"]');
    await expect(modelSelect).toBeVisible();

    // Connection status indicator is inside the left group
    const connectionStatus = modelLeftGroup.locator('text=/Active|Connecting/');
    await expect(connectionStatus).toBeVisible();

    // Delete icon is isolated on the far right
    const deleteContainer = modelRow.locator('.model-selector-right-isolated');
    await expect(deleteContainer).toBeVisible();

    const deleteBtn = deleteContainer.locator('button[aria-label="Clear conversation history"]');
    await expect(deleteBtn).toBeVisible();

    // Verify delete container is isolated on the far right with spacing from model group
    const modelGroupRect = await modelLeftGroup.boundingBox();
    const deleteRect = await deleteContainer.boundingBox();
    expect(modelGroupRect).not.toBeNull();
    expect(deleteRect).not.toBeNull();

    // Right-aligned isolation check: delete icon is to the right with extra clearance
    const gapToTrash = deleteRect!.x - (modelGroupRect!.x + modelGroupRect!.width);
    expect(gapToTrash).toBeGreaterThan(20);

    // Verify extra margin / padding on delete container
    const deleteStyles = await deleteContainer.evaluate((el) => {
      const computed = window.getComputedStyle(el);
      return {
        marginLeft: computed.marginLeft,
        paddingLeft: parseFloat(computed.paddingLeft)
      };
    });
    expect(deleteStyles.paddingLeft).toBeGreaterThanOrEqual(12);
  });
});
