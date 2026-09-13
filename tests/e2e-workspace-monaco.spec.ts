import { test, expect } from '@playwright/test';

const BASE_URL = 'https://brainhalf.com';
const ARTIFACT_DIR = '/home/kashifullah/.gemini/antigravity-ide/brain/bdade561-eefd-4bc6-bb08-2adeffc71475';

test.describe('E2E Workspace, Monaco Editor & Tooling Tests', () => {
  test('1. Monaco Editor file navigation, word wrap, and copy action', async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });

    // Switch to Code Tab
    const codeTab = page.locator('[role="tablist"] button[role="tab"]').filter({ hasText: 'Code' }).first();
    await codeTab.click();
    await page.waitForTimeout(800);

    // Verify file tabs in editor toolbar
    const appTab = page.locator('div.hover-bright', { hasText: 'App.jsx' }).first();
    const cssTab = page.locator('div.hover-bright', { hasText: 'styles.css' }).first();

    await expect(appTab).toBeVisible({ timeout: 10000 });
    await expect(cssTab).toBeVisible({ timeout: 10000 });

    // Switch to styles.css
    await cssTab.click();
    await page.waitForTimeout(400);
    const activeFileCss = page.locator('span:has-text("styles.css")').first();
    await expect(activeFileCss).toBeVisible();

    // Switch back to App.jsx
    await appTab.click();
    await page.waitForTimeout(400);
    const activeFileApp = page.locator('span:has-text("App.jsx")').first();
    await expect(activeFileApp).toBeVisible();

    // Test Word Wrap Toggle
    const wrapBtn = page.locator('button:has-text("Wrap")').first();
    await expect(wrapBtn).toBeVisible();
    await wrapBtn.click();
    await page.waitForTimeout(200);

    // Test Copy Button
    const copyBtn = page.locator('button:has-text("Copy")').first();
    await expect(copyBtn).toBeVisible();
    await copyBtn.click();
    await page.waitForTimeout(200);
    const copiedText = page.locator('text=Copied').first();
    await expect(copiedText).toBeVisible();

    // Take screenshot of Code Editor
    await page.screenshot({ path: `${ARTIFACT_DIR}/playwright_monaco_editor.png`, fullPage: true });
    console.log('Captured Monaco editor screenshot: playwright_monaco_editor.png');
  });

  test('2. ZIP Export, Console clear, and Activity Log timelines', async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });

    // Switch to Console Tab
    const consoleTab = page.locator('[role="tablist"] button[role="tab"]').filter({ hasText: 'Console' }).first();
    await consoleTab.click();
    await page.waitForTimeout(400);

    // Click Clear Output
    const clearConsoleBtn = page.locator('button:has-text("Clear Output")').first();
    await expect(clearConsoleBtn).toBeVisible();
    await clearConsoleBtn.click();
    await page.waitForTimeout(200);
    const emptyConsoleMsg = page.locator('text=/Console output will appear here/i').first();
    await expect(emptyConsoleMsg).toBeVisible({ timeout: 10000 });

    // Switch to Logs Tab
    const logsTab = page.locator('[role="tablist"] button[role="tab"]').filter({ hasText: 'Logs' }).first();
    await logsTab.click();
    await page.waitForTimeout(400);

    // Verify Activity header and Clear Activity button
    const clearLogsBtn = page.locator('button:has-text("Clear Activity")').first();
    await expect(clearLogsBtn).toBeVisible();
    await clearLogsBtn.click();
    await page.waitForTimeout(200);

    const emptyLogsMsg = page.locator('text=No activity recorded yet').first();
    await expect(emptyLogsMsg).toBeVisible();

    // Verify TopNav Export ZIP button exists and is clickable
    const topExportBtn = page.locator('button:has-text("Export")').first();
    await expect(topExportBtn).toBeVisible();
  });
});
