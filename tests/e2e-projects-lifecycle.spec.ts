import { test, expect } from '@playwright/test';

test.describe('E2E Project Lifecycle & Isolation Tests', () => {
  test('1. Create, rename, switch, and persist multiple projects', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('bh_session_token', 'bh_dev_local_token_not_a_real_session');
      localStorage.setItem('bh_session_user', JSON.stringify({ id: 'dev-user-1', email: 'dev@brainhalf.local' }));
    });

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('http://localhost:5173/');
    await page.waitForLoadState('domcontentloaded');

    // 1. Create Project A by submitting a prompt from the landing page
    const promptTextarea = page.locator('.landing-prompt-textarea');
    await expect(promptTextarea).toBeVisible();
    await promptTextarea.fill('Build a simple counter app');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(800);

    const projectAId = new URL(page.url()).searchParams.get('project');
    expect(projectAId).toBeTruthy();

    // Rename Project A via TopNav click-to-edit
    const titleTriggerA = page.locator('[title="Click to rename project"]').first();
    await expect(titleTriggerA).toBeVisible();
    await titleTriggerA.click();
    await page.waitForTimeout(200);

    const titleInputA = page.locator('input[aria-label="Rename project input"]');
    await expect(titleInputA).toBeVisible();
    await titleInputA.fill('Alpha Project');
    await titleInputA.press('Enter');
    await page.waitForTimeout(400);

    // Verify renamed in TopNav tab
    await expect(page.locator('[title="Click to rename project"]').first()).toContainText('Alpha Project');

    // 2. Create Project B via the "New project" icon button in TopNav
    await page.locator('button[aria-label="New project"]').click();
    await page.waitForTimeout(600);

    const projectBId = new URL(page.url()).searchParams.get('project');
    expect(projectBId).toBeTruthy();
    expect(projectBId).not.toBe(projectAId);

    const titleTriggerB = page.locator('[title="Click to rename project"]').first();
    await titleTriggerB.click();
    await page.waitForTimeout(200);

    const titleInputB = page.locator('input[aria-label="Rename project input"]');
    await titleInputB.fill('Beta Project');
    await titleInputB.press('Enter');
    await page.waitForTimeout(400);

    // 3. Create Project C
    await page.locator('button[aria-label="New project"]').click();
    await page.waitForTimeout(600);

    const projectCId = new URL(page.url()).searchParams.get('project');
    expect(projectCId).toBeTruthy();
    expect(projectCId).not.toBe(projectBId);

    const titleTriggerC = page.locator('[title="Click to rename project"]').first();
    await titleTriggerC.click();
    await page.waitForTimeout(200);

    const titleInputC = page.locator('input[aria-label="Rename project input"]');
    await titleInputC.fill('Gamma Project');
    await titleInputC.press('Enter');
    await page.waitForTimeout(400);

    // 4. Switch back to Project A via URL navigation
    await page.goto(`http://localhost:5173/?project=${projectAId}`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(400);

    expect(new URL(page.url()).searchParams.get('project')).toBe(projectAId);
    await expect(page.locator('[title="Click to rename project"]').first()).toContainText('Alpha Project');

    // 5. Test Browser Refresh Persistence
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(600);

    expect(new URL(page.url()).searchParams.get('project')).toBe(projectAId);
    await expect(page.locator('[title="Click to rename project"]').first()).toContainText('Alpha Project');

    await page.screenshot({ path: 'test-results/projects-lifecycle-switching.png', fullPage: true });
  });

  test('2. Delete project flow with confirmation modal safety', async ({ page }) => {
    await page.addInitScript(() => {
      const proj = {
        id: 'proj-to-delete',
        name: 'Project To Delete',
        framework: 'React 18 + Vite',
        status: 'ready',
        createdAt: Date.now() - 3000,
        updatedAt: Date.now() - 3000,
      };
      localStorage.setItem('brainhalf_projects', JSON.stringify([proj]));
      localStorage.setItem('brainhalf_active_project', proj.id);
      localStorage.setItem('bh_session_token', 'bh_dev_local_token_not_a_real_session');
      localStorage.setItem('bh_session_user', JSON.stringify({ id: 'dev-user-1', email: 'dev@brainhalf.local' }));
    });

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('http://localhost:5173/');
    await page.waitForLoadState('domcontentloaded');

    // Verify project shows up in Recent Projects
    const projectCard = page.locator('.landing-project-card', { hasText: 'Project To Delete' });
    await expect(projectCard).toBeVisible();

    // Open the "..." actions menu
    const actionsBtn = projectCard.locator('button[aria-label="Project actions"]');
    await actionsBtn.click();
    await page.waitForTimeout(200);

    // Click Delete in the dropdown
    const deleteItem = page.locator('.landing-card-dropdown-item.danger');
    await expect(deleteItem).toBeVisible();
    await deleteItem.click();
    await page.waitForTimeout(200);

    // ConfirmModal should appear
    const confirmModal = page.locator('[role="dialog"]').first();
    await expect(confirmModal).toBeVisible();

    // Cancel deletion — project should survive
    await confirmModal.locator('button', { hasText: 'Cancel' }).click();
    await page.waitForTimeout(300);
    await expect(projectCard).toBeVisible();

    // Re-open menu and confirm deletion
    await actionsBtn.click();
    await page.waitForTimeout(200);
    await page.locator('.landing-card-dropdown-item.danger').click();
    await page.waitForTimeout(200);

    const confirmModal2 = page.locator('[role="dialog"]').first();
    await expect(confirmModal2).toBeVisible();
    await confirmModal2.locator('button', { hasText: 'Delete Project' }).click();
    await page.waitForTimeout(600);

    // Project should be gone
    await expect(page.locator('.landing-project-card', { hasText: 'Project To Delete' })).toHaveCount(0);

    await page.screenshot({ path: 'test-results/projects-lifecycle-delete.png', fullPage: true });
  });
});
