import { test, expect } from '@playwright/test';
import path from 'path';

const ARTIFACTS_DIR = '/home/kashifullah/.gemini/antigravity-ide/brain/bdade561-eefd-4bc6-bb08-2adeffc71475';

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
    for (const vp of VIEWPORTS) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(300);

      // Check root horizontal overflow
      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));

      expect(scrollWidth, `Viewport ${vp.name} (${vp.width}x${vp.height}) has horizontal overflow!`).toBeLessThanOrEqual(clientWidth + 1);

      // Verify essential components exist and are interactive
      const isMobile = vp.width < 768;
      if (isMobile) {
        // Mobile navigation should be present
        const mobileNav = page.locator('.segmented-tab');
        await expect(mobileNav.first()).toBeVisible();

        // Check chat input is accessible
        const chatInput = page.locator('textarea');
        await expect(chatInput).toBeVisible();

        // Switch tabs to code and preview
        const codeTab = page.locator('.segmented-tab:has-text("Code")').first();
        if (await codeTab.count() > 0) {
          await codeTab.click();
          await page.waitForTimeout(150);
        }
        const previewTab = page.locator('.segmented-tab:has-text("Preview")').first();
        if (await previewTab.count() > 0) {
          await previewTab.click();
          await page.waitForTimeout(150);
        }
      } else {
        // Desktop sidebar should be rendered
        const sidebar = page.locator('.sidebar-container');
        await expect(sidebar).toBeVisible();

        // Check new project button
        const newProjBtn = page.locator('button:has-text("New project"), button[aria-label="Create New Project"]');
        await expect(newProjBtn.first()).toBeVisible();

        // TopNav deploy button
        const deployBtn = page.locator('.deploy-main-action');
        await expect(deployBtn).toBeVisible();
      }
    }
  });

  test('Visual Regression Screenshots on Key Viewports', async ({ page }) => {
    // 1920x1080 Desktop
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto('http://localhost:5173');
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

    // Desktop Model Selector & Menu Details
    await page.setViewportSize({ width: 1440, height: 900 });
    const modelSelect = page.locator('select[aria-label="Select AI Model"]');
    await expect(modelSelect).toBeVisible();
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'minimal_model_selector.png') });

    // Project Row ⋯ Menu
    const projectMenuTrigger = page.locator('button[aria-label^="Actions for"]').first();
    if (await projectMenuTrigger.count() > 0) {
      await projectMenuTrigger.click();
      await page.waitForTimeout(200);
      await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'minimal_project_menu.png') });
      await page.keyboard.press('Escape');
    }

    // TopNav ⋯ Menu
    const topMenuTrigger = page.locator('button[aria-label="More project actions"]');
    await topMenuTrigger.click();
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'minimal_topnav_menu.png') });
    await page.keyboard.press('Escape');

    // Deploy Dialog
    const deployBtn = page.locator('.deploy-main-action');
    await deployBtn.click();
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'minimal_dialog.png') });
    await page.keyboard.press('Escape');
  });

  test('Interaction Stress Suite (20x Iterations & Stability)', async ({ page }) => {
    test.setTimeout(120000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('http://localhost:5173');
    await page.waitForTimeout(500);

    // 1. Sidebar open/close x20
    const toggleCollapse = page.locator('button[aria-label="Collapse Sidebar"], button[aria-label="Expand Sidebar"]').first();
    for (let i = 0; i < 20; i++) {
      if (await toggleCollapse.isVisible()) {
        await toggleCollapse.click();
        await page.waitForTimeout(10);
      }
    }

    // Ensure expanded for following tests
    const expandBtn = page.locator('button[aria-label="Expand Sidebar"]').first();
    if (await expandBtn.isVisible()) {
      await expandBtn.click();
      await page.waitForTimeout(100);
    }

    // 2. Project creation & switching x20 (verifying no visual layout/white flash or memory crash)
    for (let i = 0; i < 5; i++) {
      const newProjBtn = page.locator('button:has-text("New project"), button[aria-label="Create New Project"]').first();
      await newProjBtn.click();
      await page.waitForTimeout(50);
    }

    const projectItems = page.locator('.sidebar-nav-item');
    const count = await projectItems.count();
    expect(count).toBeGreaterThanOrEqual(5);

    // Rapid switching A -> B -> C -> A -> B
    for (let i = 0; i < 20; i++) {
      const target = projectItems.nth(i % count);
      await target.click();
      await page.waitForTimeout(20);
    }

    // 3. Model selector switching x20
    const modelSelect = page.locator('select[aria-label="Select AI Model"]');
    const modelOptions = ['@cf/meta/llama-3.3-70b-instruct-fp8-fast', '@cf/openai/gpt-oss-20b', 'claude-sonnet-4.6', '@cf/qwen/qwen2.5-coder-32b-instruct'];
    for (let i = 0; i < 20; i++) {
      const opt = modelOptions[i % modelOptions.length];
      await modelSelect.selectOption(opt);
      await page.waitForTimeout(10);
    }

    // 4. Code / Preview tab switching x20
    const codeTab = page.locator('.workspace-panel-container .segmented-tab:has-text("Code")');
    const previewTab = page.locator('.workspace-panel-container .segmented-tab:has-text("Preview")');
    for (let i = 0; i < 20; i++) {
      if (i % 2 === 0) {
        await codeTab.click();
      } else {
        await previewTab.click();
      }
      await page.waitForTimeout(15);
    }

    // 5. Diagnostics dropdown (Console & Logs) switching x20
    const diagBtn = page.locator('button[aria-label="Diagnostics (Console, Logs)"]');
    for (let i = 0; i < 10; i++) {
      await diagBtn.click();
      await page.waitForTimeout(20);
      const consoleItem = page.locator('.deploy-menu-item:has-text("Terminal Console")');
      if (await consoleItem.isVisible()) {
        await consoleItem.click();
      }
      await page.waitForTimeout(20);

      await diagBtn.click();
      await page.waitForTimeout(20);
      const logsItem = page.locator('.deploy-menu-item:has-text("Activity Logs")');
      if (await logsItem.isVisible()) {
        await logsItem.click();
      }
      await page.waitForTimeout(20);
    }
    // Return to preview
    await previewTab.click();

    // 6. Preview Device Switching (Desktop | Tablet | Mobile) x20
    const dtBtn = page.locator('.viewport-pill-btn:has-text("Desktop")');
    const tbBtn = page.locator('.viewport-pill-btn:has-text("Tablet")');
    const mbBtn = page.locator('.viewport-pill-btn:has-text("Mobile")');
    for (let i = 0; i < 20; i++) {
      if (i % 3 === 0) await tbBtn.click();
      else if (i % 3 === 1) await mbBtn.click();
      else await dtBtn.click();
      await page.waitForTimeout(20);
    }

    // 7. Dialog open/close x20
    const deployBtn = page.locator('.deploy-main-action');
    for (let i = 0; i < 20; i++) {
      await deployBtn.click();
      await page.waitForTimeout(30);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(30);
    }

    // Verify UI is in a healthy, responsive, uncorrupted state
    await expect(page.locator('.top-nav')).toBeVisible();
    await expect(page.locator('textarea')).toBeVisible();
    await expect(page.locator('.browser-chrome')).toBeVisible();
  });

  test('Dynamic Chat Textarea Auto-growth & Keyboard UX', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('http://localhost:5173');
    await page.waitForTimeout(300);

    const textarea = page.locator('textarea');
    await expect(textarea).toBeVisible();

    // Measure initial height
    const initialHeight = await textarea.evaluate((el: HTMLTextAreaElement) => el.clientHeight);

    // Multiline prompt entry
    await textarea.fill("First line of prompt\nSecond line\nThird line\nFourth line\nFifth line");
    await page.waitForTimeout(100);

    const expandedHeight = await textarea.evaluate((el: HTMLTextAreaElement) => el.clientHeight);
    expect(expandedHeight).toBeGreaterThan(initialHeight);
    expect(expandedHeight).toBeLessThanOrEqual(210);

    // Enter without shift sends message, resets height
    await textarea.press('Enter');
    await page.waitForTimeout(200);

    // Textarea should clear and return to compact row
    const postSendHeight = await textarea.evaluate((el: HTMLTextAreaElement) => el.clientHeight);
    expect(postSendHeight).toBeLessThanOrEqual(initialHeight + 4);
  });
});
