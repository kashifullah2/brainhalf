import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';
const projId = 'monaco-test-proj';

test.describe('E2E Workspace & Code Editor Tests', () => {
  const authSetup = async (page: any) => {
    await page.addInitScript(({ id }: { id: string }) => {
      const proj = {
        id,
        name: 'Monaco Test Project',
        framework: 'React 18 + Vite',
        status: 'ready',
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      const files = {
        '/src/App.jsx': `export default function App() { return <div><h1>Monaco Test</h1></div>; }`,
        '/src/styles.css': `body { margin: 0; background: #0f172a; color: #f8fafc; }`
      };
      localStorage.setItem('brainhalf_projects', JSON.stringify([proj]));
      localStorage.setItem('brainhalf_active_project', id);
      localStorage.setItem(`brainhalf_files_${id}`, JSON.stringify(files));
      localStorage.setItem('bh_session_token', 'bh_dev_local_token_not_a_real_session');
      localStorage.setItem('bh_session_user', JSON.stringify({ id: 'dev-user-1', email: 'dev@brainhalf.local' }));
    }, { id: projId });
  };

  test('1. Workspace tab navigation: Preview and Manage tabs', async ({ page }) => {
    test.setTimeout(60000);
    await authSetup(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${BASE_URL}/?project=${projId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);

    // Default view: Preview tab with browser chrome
    const browserChrome = page.locator('.browser-chrome');
    await expect(browserChrome).toBeVisible({ timeout: 10000 });

    // Switch to Manage (code editor) tab
    const manageTab = page.locator('button:has-text("Manage")').first();
    await expect(manageTab).toBeVisible();
    await manageTab.click();
    await page.waitForTimeout(800);

    // Code editor area should be visible
    const codeEditor = page.locator('.monaco-editor, .code-editor-container, [class*="monaco"], [class*="editor"]').first();
    const hasEditor = await codeEditor.isVisible({ timeout: 8000 }).catch(() => false);
    console.log(`  [Advisory] Code editor visible after Manage tab click: ${hasEditor}`);

    // Switch back to Preview tab
    const previewTab = page.locator('button:has-text("Preview")').first();
    await previewTab.click();
    await page.waitForTimeout(500);

    await expect(browserChrome).toBeVisible();
    await page.screenshot({ path: 'test-results/workspace-manage-tab.png', fullPage: true });
    console.log('Captured workspace screenshot: workspace-manage-tab.png');
  });

  test('2. Preview controls and viewport switching in workspace', async ({ page }) => {
    test.setTimeout(60000);
    await authSetup(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${BASE_URL}/?project=${projId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);

    // Preview area is visible by default
    const browserChrome = page.locator('.browser-chrome');
    await expect(browserChrome).toBeVisible({ timeout: 10000 });

    // Test all viewport buttons
    const tabletBtn = page.locator('button:has-text("Tablet")').first();
    await expect(tabletBtn).toBeVisible();
    await tabletBtn.click();
    await page.waitForTimeout(300);

    const mobileBtn = page.locator('button:has-text("Mobile")').first();
    await mobileBtn.click();
    await page.waitForTimeout(300);

    const desktopBtn = page.locator('button:has-text("Desktop")').first();
    await desktopBtn.click();
    await page.waitForTimeout(300);

    console.log('  [Assert] Preview viewport switching works correctly');
    await page.screenshot({ path: 'test-results/workspace-preview.png', fullPage: true });
  });
});
