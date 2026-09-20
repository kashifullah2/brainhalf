import { test, expect } from '@playwright/test';
import path from 'path';

const ARTIFACTS_DIR = 'test-results';
const TEST_PROJ_ID = 'minimal-redesign-proj';

const VIEWPORTS = [
  { width: 320, height: 568, name: 'mobile-320' },
  { width: 360, height: 800, name: 'mobile-360' },
  { width: 375, height: 812, name: 'mobile-375' },
  { width: 390, height: 844, name: 'mobile-390' },
  { width: 430, height: 932, name: 'mobile-430' },
  { width: 500, height: 800, name: 'small-tablet-500' },
  { width: 600, height: 800, name: 'small-tablet-600' },
  { width: 768, height: 1024, name: 'tablet-768' },
  { width: 900, height: 800, name: 'tablet-900' },
  { width: 1024, height: 768, name: 'desktop-1024' },
  { width: 1280, height: 720, name: 'desktop-1280' },
  { width: 1440, height: 900, name: 'desktop-1440' },
  { width: 1920, height: 1080, name: 'desktop-1920' },
];

test.describe('BrainHalf Minimal Redesign Verification Suite', () => {

  test('Responsive Viewport Matrix & Zero Horizontal Overflow', async ({ page }) => {
    await page.addInitScript(({ pid }: { pid: string }) => {
      const p = {
        id: pid,
        name: 'Minimal Redesign Test',
        framework: 'React 18 + Vite',
        status: 'ready',
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      localStorage.setItem('brainhalf_projects', JSON.stringify([p]));
      localStorage.setItem('brainhalf_active_project', p.id);
      localStorage.setItem('bh_session_token', 'bh_dev_local_token_not_a_real_session');
      localStorage.setItem('bh_session_user', JSON.stringify({ id: 'dev-user-1', email: 'dev@brainhalf.local' }));
    }, { pid: TEST_PROJ_ID });

    for (const vp of VIEWPORTS) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(`http://localhost:5173/?project=${TEST_PROJ_ID}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(300);

      // Check root horizontal overflow
      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));

      expect(scrollWidth, `Viewport ${vp.name} (${vp.width}x${vp.height}) has horizontal overflow!`).toBeLessThanOrEqual(clientWidth + 1);

      // Verify essential components exist
      const isMobile = vp.width < 768;
      if (isMobile) {
        // Mobile: segmented tabs in TopNav should be present
        const mobileTab = page.locator('.segmented-tab').first();
        const hasMobileTab = await mobileTab.isVisible().catch(() => false);
        console.log(`  [${vp.name}] Mobile segmented tab visible: ${hasMobileTab}`);

        // Chat input should be accessible
        const chatInput = page.locator('textarea').first();
        await expect(chatInput).toBeVisible();
      } else {
        // Desktop: TopNav must be visible (sidebar was removed in this redesign)
        const topNav = page.locator('.top-nav');
        await expect(topNav).toBeVisible();

        // New project button exists in TopNav left cluster
        const newProjBtn = page.locator('button[aria-label="New project"]').first();
        await expect(newProjBtn).toBeVisible();
      }
    }
  });

  test('Visual Regression Screenshots on Key Viewports', async ({ page }) => {
    await page.addInitScript(({ pid }: { pid: string }) => {
      const p = {
        id: pid,
        name: 'Visual Regression Test',
        framework: 'React 18 + Vite',
        status: 'ready',
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      localStorage.setItem('brainhalf_projects', JSON.stringify([p]));
      localStorage.setItem('brainhalf_active_project', p.id);
      localStorage.setItem('bh_session_token', 'bh_dev_local_token_not_a_real_session');
      localStorage.setItem('bh_session_user', JSON.stringify({ id: 'dev-user-1', email: 'dev@brainhalf.local' }));
    }, { pid: TEST_PROJ_ID });

    // 1920x1080 Desktop
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(`http://localhost:5173/?project=${TEST_PROJ_ID}`);
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'minimal_desktop_1920x1080.png') });

    // 1440x900 Desktop
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'minimal_desktop_1440x900.png') });

    // 768x1024 Tablet
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'minimal_tablet_768x1024.png') });

    // 375x812 Mobile
    await page.setViewportSize({ width: 375, height: 812 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'minimal_mobile_375x812.png') });

    // 320x568 Extreme Small Mobile
    await page.setViewportSize({ width: 320, height: 568 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'minimal_mobile_320x568.png') });

    // Back to desktop: model status pill & selector
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`http://localhost:5173/?project=${TEST_PROJ_ID}`);
    await page.waitForTimeout(500);
    const modelPill = page.locator('[data-testid="model-status-pill"]');
    await expect(modelPill).toBeVisible({ timeout: 8000 });
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'minimal_model_selector.png') });

    // TopNav user profile menu
    const userMenuBtn = page.locator('button[aria-label="User profile and menu"]').first();
    await expect(userMenuBtn).toBeVisible();
    await userMenuBtn.click();
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'minimal_topnav_menu.png') });
    await page.keyboard.press('Escape');

    // Deploy dialog (triggered from user menu: Share Project Link -> skip; open via workspace Publish if available)
    const deployMenuBtn = page.locator('.deploy-menu-item:has-text("Share Project"), .deploy-menu-item:has-text("Export")').first();
    const hasDeployMenuItem = await deployMenuBtn.isVisible().catch(() => false);
    if (!hasDeployMenuItem) {
      // Re-open menu and close
      await userMenuBtn.click();
      await page.waitForTimeout(200);
      await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'minimal_dialog.png') });
      await page.keyboard.press('Escape');
    }
  });

  test('Interaction Stress Suite (20x Iterations & Stability)', async ({ page }) => {
    test.setTimeout(120000);
    await page.addInitScript(({ pid }: { pid: string }) => {
      const p = {
        id: pid,
        name: 'Stress Test Project',
        framework: 'React 18 + Vite',
        status: 'ready',
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      localStorage.setItem('brainhalf_projects', JSON.stringify([p]));
      localStorage.setItem('brainhalf_active_project', p.id);
      localStorage.setItem('bh_session_token', 'bh_dev_local_token_not_a_real_session');
      localStorage.setItem('bh_session_user', JSON.stringify({ id: 'dev-user-1', email: 'dev@brainhalf.local' }));
    }, { pid: TEST_PROJ_ID });

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`http://localhost:5173/?project=${TEST_PROJ_ID}`);
    await page.waitForTimeout(500);

    // 1. User profile menu open/close x20
    const userMenuBtn = page.locator('button[aria-label="User profile and menu"]').first();
    await expect(userMenuBtn).toBeVisible({ timeout: 10000 });
    for (let i = 0; i < 20; i++) {
      await userMenuBtn.click();
      await page.waitForTimeout(15);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(15);
    }

    // 2. Model picker open/close x10
    const modelPickerBtn = page.locator('button[title="Change AI model"]');
    const hasModelPicker = await modelPickerBtn.isVisible({ timeout: 5000 }).catch(() => false);
    if (hasModelPicker) {
      for (let i = 0; i < 10; i++) {
        await modelPickerBtn.click();
        await page.waitForTimeout(15);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(15);
      }
    }

    // 3. Workspace tab switching: Preview / Manage x20
    const previewTab = page.locator('button:has-text("Preview")').first();
    const manageTab = page.locator('button:has-text("Manage")').first();
    const hasWorkspaceTabs = await previewTab.isVisible({ timeout: 5000 }).catch(() => false);
    if (hasWorkspaceTabs) {
      for (let i = 0; i < 20; i++) {
        if (i % 2 === 0) {
          await manageTab.click();
        } else {
          await previewTab.click();
        }
        await page.waitForTimeout(15);
      }
      // Return to preview
      await previewTab.click();
      await page.waitForTimeout(100);
    }

    // 4. Preview Device Switching (Desktop | Tablet | Mobile) x20
    const dtBtn = page.locator('.viewport-pill-btn:has-text("Desktop"), button:has-text("Desktop")').first();
    const tbBtn = page.locator('.viewport-pill-btn:has-text("Tablet"), button:has-text("Tablet")').first();
    const mbBtn = page.locator('.viewport-pill-btn:has-text("Mobile"), button:has-text("Mobile")').first();
    const hasViewportBtns = await dtBtn.isVisible({ timeout: 5000 }).catch(() => false);
    if (hasViewportBtns) {
      for (let i = 0; i < 20; i++) {
        if (i % 3 === 0) await tbBtn.click();
        else if (i % 3 === 1) await mbBtn.click();
        else await dtBtn.click();
        await page.waitForTimeout(15);
      }
    }

    // Verify UI is in a healthy, responsive, uncorrupted state
    await expect(page.locator('.top-nav')).toBeVisible();
    await expect(page.locator('textarea')).toBeVisible();
    await expect(page.locator('.browser-chrome')).toBeVisible();
  });

  test('Dynamic Chat Textarea Auto-growth & Keyboard UX', async ({ page }) => {
    await page.addInitScript(({ pid }: { pid: string }) => {
      const p = {
        id: pid,
        name: 'Textarea Test Project',
        framework: 'React 18 + Vite',
        status: 'ready',
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      localStorage.setItem('brainhalf_projects', JSON.stringify([p]));
      localStorage.setItem('brainhalf_active_project', p.id);
      localStorage.setItem('bh_session_token', 'bh_dev_local_token_not_a_real_session');
      localStorage.setItem('bh_session_user', JSON.stringify({ id: 'dev-user-1', email: 'dev@brainhalf.local' }));
    }, { pid: TEST_PROJ_ID });

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`http://localhost:5173/?project=${TEST_PROJ_ID}`);
    await page.waitForTimeout(300);

    const textarea = page.locator('textarea').first();
    await expect(textarea).toBeVisible({ timeout: 10000 });

    // Measure initial height
    const initialHeight = await textarea.evaluate((el: HTMLTextAreaElement) => el.clientHeight);

    // Multiline prompt entry (Shift+Enter for newlines without sending)
    await textarea.click();
    await textarea.type('First line of prompt');
    await textarea.press('Shift+Enter');
    await textarea.type('Second line');
    await textarea.press('Shift+Enter');
    await textarea.type('Third line');
    await textarea.press('Shift+Enter');
    await textarea.type('Fourth line');
    await textarea.press('Shift+Enter');
    await textarea.type('Fifth line');
    await page.waitForTimeout(100);

    const expandedHeight = await textarea.evaluate((el: HTMLTextAreaElement) => el.clientHeight);
    expect(expandedHeight).toBeGreaterThan(initialHeight);
    expect(expandedHeight).toBeLessThanOrEqual(210);

    // Enter (without Shift) sends the message and resets height
    await textarea.press('Enter');
    await page.waitForTimeout(300);

    const postSendHeight = await textarea.evaluate((el: HTMLTextAreaElement) => el.clientHeight);
    expect(postSendHeight).toBeLessThanOrEqual(initialHeight + 4);
  });
});
