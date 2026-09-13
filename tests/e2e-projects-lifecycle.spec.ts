import { test, expect } from '@playwright/test';

const BASE_URL = 'https://brainhalf.com';
const ARTIFACT_DIR = '/home/kashifullah/.gemini/antigravity-ide/brain/bdade561-eefd-4bc6-bb08-2adeffc71475';

test.describe('E2E Project Lifecycle & Isolation Tests', () => {
  test('1. Create, rename, switch, and persist multiple projects', async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });

    // 1. Create Project A
    const newProjectBtn = page.locator('button:has-text("New project")').first();
    await newProjectBtn.click();
    await page.waitForTimeout(600);

    const projectAId = new URL(page.url()).searchParams.get('project');
    expect(projectAId).toBeTruthy();

    // Rename Project A to "Alpha Project" via click-to-edit
    const titleEditTriggerA = page.locator('[title="Click to rename project"]').first();
    await expect(titleEditTriggerA).toBeVisible();
    await titleEditTriggerA.click();
    await page.waitForTimeout(200);

    const titleInputA = page.locator('input[aria-label="Rename project input"]');
    await expect(titleInputA).toBeVisible();
    await titleInputA.fill('Alpha Project');
    await titleInputA.press('Enter');
    await page.waitForTimeout(400);

    // Verify Project A appears in sidebar
    const sidebarAlpha = page.locator('.sidebar-nav-item', { hasText: 'Alpha Project' }).first();
    await expect(sidebarAlpha).toBeVisible();

    // 2. Create Project B
    await newProjectBtn.click();
    await page.waitForTimeout(600);

    const projectBId = new URL(page.url()).searchParams.get('project');
    expect(projectBId).toBeTruthy();
    expect(projectBId).not.toBe(projectAId);

    // Rename Project B to "Beta Project"
    const titleEditTriggerB = page.locator('[title="Click to rename project"]').first();
    await titleEditTriggerB.click();
    await page.waitForTimeout(200);

    const titleInputB = page.locator('input[aria-label="Rename project input"]');
    await titleInputB.fill('Beta Project');
    await titleInputB.press('Enter');
    await page.waitForTimeout(400);

    // 3. Create Project C
    await newProjectBtn.click();
    await page.waitForTimeout(600);

    const projectCId = new URL(page.url()).searchParams.get('project');
    expect(projectCId).toBeTruthy();
    expect(projectCId).not.toBe(projectBId);

    const titleEditTriggerC = page.locator('[title="Click to rename project"]').first();
    await titleEditTriggerC.click();
    await page.waitForTimeout(200);

    const titleInputC = page.locator('input[aria-label="Rename project input"]');
    await titleInputC.fill('Gamma Project');
    await titleInputC.press('Enter');
    await page.waitForTimeout(400);

    // 4. Switch back to Project A ("Alpha Project")
    const selectAlpha = page.locator('.sidebar-nav-item', { hasText: 'Alpha Project' }).first();
    await selectAlpha.click();
    await page.waitForTimeout(600);

    expect(new URL(page.url()).searchParams.get('project')).toBe(projectAId);
    await expect(page.locator('text=Alpha Project').first()).toBeVisible();

    // 5. Test Browser Refresh Persistence
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(600);

    expect(new URL(page.url()).searchParams.get('project')).toBe(projectAId);
    await expect(page.locator('text=Alpha Project').first()).toBeVisible();

    await page.screenshot({ path: `${ARTIFACT_DIR}/playwright_projects_switching.png`, fullPage: true });
    console.log('Captured project switching screenshot: playwright_projects_switching.png');
  });

  test('2. Delete project flow with confirmation modal safety', async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });

    // Create a temporary project to delete
    const newProjectBtn = page.locator('button:has-text("New project")').first();
    await newProjectBtn.click();
    await page.waitForTimeout(600);

    const titleEdit = page.locator('[title="Click to rename project"]').first();
    await titleEdit.click();
    await page.waitForTimeout(200);

    const titleInput = page.locator('input[aria-label="Rename project input"]');
    await titleInput.fill('Project To Delete');
    await titleInput.press('Enter');
    await page.waitForTimeout(400);

    const sidebarItem = page.locator('.sidebar-nav-item', { hasText: 'Project To Delete' }).first();
    await expect(sidebarItem).toBeVisible();

    // Handle dialog: Cancel first
    page.once('dialog', async dialog => {
      expect(dialog.message()).toContain('Delete');
      await dialog.dismiss();
    });

    const deleteBtn = sidebarItem.locator('button[title="Delete project"]');
    if (await deleteBtn.isVisible()) {
      await deleteBtn.click();
      await page.waitForTimeout(300);
      // Project should still exist after cancel
      await expect(sidebarItem).toBeVisible();

      // Now confirm deletion
      page.once('dialog', async dialog => {
        await dialog.accept();
      });
      await deleteBtn.click();
      await page.waitForTimeout(600);

      // Verify project is deleted
      const checkDeleted = page.locator('.sidebar-nav-item', { hasText: 'Project To Delete' });
      await expect(checkDeleted).toHaveCount(0);
    }
  });
});
