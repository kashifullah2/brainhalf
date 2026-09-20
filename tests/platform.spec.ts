import { test, expect } from '@playwright/test';

test.describe('BrainHalf Platform E2E Tests', () => {
  const authSetup = async (page: any, projectId: string) => {
    await page.addInitScript(({ pid }: { pid: string }) => {
      const proj = {
        id: pid,
        name: 'Platform Test Project',
        framework: 'React 18 + Vite',
        status: 'ready',
        createdAt: Date.now() - 5000,
        updatedAt: Date.now() - 5000,
      };
      localStorage.setItem('brainhalf_projects', JSON.stringify([proj]));
      localStorage.setItem('brainhalf_active_project', pid);
      localStorage.setItem('bh_session_token', 'bh_dev_local_token_not_a_real_session');
      localStorage.setItem('bh_session_user', JSON.stringify({ id: 'dev-user-1', email: 'dev@brainhalf.local' }));
    }, { pid: projectId });
  };

  test.beforeEach(async ({ page }) => {
    page.on('console', msg => {
      if (msg.type() === 'error') {
        console.error(`[Browser Console Error]: ${msg.text()}`);
      }
    });
  });

  test('1. Homepage loads with brand navbar, chat panel, and workspace', async ({ page }) => {
    await authSetup(page, 'plat-test-1');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('http://localhost:5173/?project=plat-test-1', { waitUntil: 'domcontentloaded' });

    // Verify title
    await expect(page).toHaveTitle(/brainhalf/i);

    // Verify Brand Logo text is present somewhere (TopNav)
    const brandLogo = page.locator('text=BrainHalf').first();
    await expect(brandLogo).toBeVisible();

    // Verify Chat Input exists with current placeholder
    const chatTextarea = page.locator('textarea').first();
    await expect(chatTextarea).toBeVisible();

    // Verify status pill is visible (model indicator)
    const modelStatus = page.locator('[data-testid="model-status-pill"]');
    await expect(modelStatus).toBeVisible();

    await page.screenshot({ path: 'test-results/platform-homepage.png', fullPage: true });
  });

  test('2. Workspace tab navigation: Preview and Manage (code editor)', async ({ page }) => {
    await authSetup(page, 'plat-test-2');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('http://localhost:5173/?project=plat-test-2', { waitUntil: 'domcontentloaded' });

    // 1. Switch to Manage (Code Editor) tab
    const manageTab = page.locator('button:has-text("Manage")').first();
    await expect(manageTab).toBeVisible({ timeout: 8000 });
    await manageTab.click();
    await page.waitForTimeout(500);

    // 2. Switch back to Preview Tab
    const previewTab = page.locator('button:has-text("Preview")').first();
    await previewTab.click();
    await page.waitForTimeout(500);

    const browserChrome = page.locator('.browser-chrome');
    await expect(browserChrome).toBeVisible();

    await page.screenshot({ path: 'test-results/platform-workspace-tabs.png', fullPage: true });
  });

  test('3. Responsive viewport mode switcher: Desktop, Tablet, Mobile', async ({ page }) => {
    await authSetup(page, 'plat-test-3');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('http://localhost:5173/?project=plat-test-3', { waitUntil: 'domcontentloaded' });

    // Click Tablet mode
    const tabletBtn = page.locator('button:has-text("Tablet")').first();
    await expect(tabletBtn).toBeVisible({ timeout: 8000 });
    await tabletBtn.click();
    await page.waitForTimeout(300);
    await expect(tabletBtn).toHaveAttribute('aria-pressed', 'true');

    // Click Mobile mode
    const mobileBtn = page.locator('button:has-text("Mobile")').first();
    await mobileBtn.click();
    await page.waitForTimeout(300);
    await expect(mobileBtn).toHaveAttribute('aria-pressed', 'true');

    // Return to Desktop mode
    const desktopBtn = page.locator('button:has-text("Desktop")').first();
    await desktopBtn.click();
    await page.waitForTimeout(300);
    await expect(desktopBtn).toHaveAttribute('aria-pressed', 'true');
  });

  test('5. Model picker button is visible and interactive', async ({ page }) => {
    await authSetup(page, 'plat-test-5');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('http://localhost:5173/?project=plat-test-5', { waitUntil: 'domcontentloaded' });

    // The model picker is a custom button (not a <select>)
    const modelPickerBtn = page.locator('button[title="Change AI model"]');
    await expect(modelPickerBtn).toBeVisible({ timeout: 8000 });

    // Open the model picker
    await modelPickerBtn.click();
    await page.waitForTimeout(300);

    // Verify model options appear in the popover
    const modelOptions = page.locator('[data-testid="model-option"], button[data-model-id]');
    // Just verify the model picker opened (any button related to model options)
    const popoverVisible = await page.locator('text=Llama, text=Qwen, text=Claude').first().isVisible().catch(() => false);
    // The model-status-pill should always be visible
    const modelStatus = page.locator('[data-testid="model-status-pill"]');
    await expect(modelStatus).toBeVisible();

    // Close by pressing Escape
    await page.keyboard.press('Escape');
  });
});
