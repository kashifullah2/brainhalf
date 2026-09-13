import { test, expect } from '@playwright/test';

const BASE_URL = 'https://brainhalf.com';
const ARTIFACT_DIR = '/home/kashifullah/.gemini/antigravity-ide/brain/bdade561-eefd-4bc6-bb08-2adeffc71475';

test.describe('BrainHalf Platform E2E Tests', () => {
  test.beforeEach(async ({ page }) => {
    // Capture and verify console logs
    page.on('console', msg => {
      if (msg.type() === 'error') {
        console.error(`[Browser Console Error]: ${msg.text()}`);
      }
    });
  });

  test('1. Homepage loads with brand navbar, chat panel, and workspace', async ({ page }) => {
    await page.goto(`${BASE_URL}/?project=fresh-${Date.now()}`, { waitUntil: 'networkidle' });

    // Verify title
    await expect(page).toHaveTitle(/brainhalf/i);

    // Verify Brand Logo in TopNav
    const brandLogo = page.locator('text=BrainHalf').first();
    await expect(brandLogo).toBeVisible();

    // Verify Chat Input & Starter Prompts
    const chatTextarea = page.locator('textarea[placeholder*="Ask BrainHalf"]');
    await expect(chatTextarea).toBeVisible();

    const starterPrompt = page.locator('text=Interactive Kanban Board').first();
    await expect(starterPrompt).toBeVisible();

    // Verify Model Selector
    const modelSelector = page.locator('select').first();
    await expect(modelSelector).toBeVisible();

    // Verify initial options in model selector
    const modelOptions = await modelSelector.locator('option').allInnerTexts();
    expect(modelOptions.some(opt => opt.includes('Claude'))).toBeTruthy();
    expect(modelOptions.some(opt => opt.includes('Qwen'))).toBeTruthy();

    // Take screenshot of homepage
    await page.screenshot({ path: `${ARTIFACT_DIR}/playwright_homepage.png`, fullPage: true });
    console.log('Captured homepage screenshot: playwright_homepage.png');
  });

  test('2. Workspace tab navigation: Preview, Code, Console, Logs', async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });

    // 1. Switch to Code Tab
    const codeTab = page.locator('button:has-text("Code")').first();
    await codeTab.click();
    await page.waitForTimeout(500);

    // Verify Monaco editor or file tab appears
    const appFileTab = page.locator('text=App.jsx').first();
    await expect(appFileTab).toBeVisible();

    // 2. Switch to Console Tab
    const consoleTab = page.locator('button:has-text("Console")').first();
    await consoleTab.click();
    await page.waitForTimeout(300);

    const consoleHeader = page.locator('text=Console').first();
    await expect(consoleHeader).toBeVisible();

    // 3. Switch to Logs Tab
    const logsTab = page.locator('button:has-text("Logs")').first();
    await logsTab.click();
    await page.waitForTimeout(300);

    const activityHeader = page.locator('text=Activity').first();
    await expect(activityHeader).toBeVisible();

    // 4. Switch back to Preview Tab
    const previewTab = page.locator('button:has-text("Preview")').first();
    await previewTab.click();
    await page.waitForTimeout(500);

    const browserChrome = page.locator('.browser-chrome');
    await expect(browserChrome).toBeVisible();

    // Take screenshot of workspace navigation
    await page.screenshot({ path: `${ARTIFACT_DIR}/playwright_workspace_tabs.png`, fullPage: true });
    console.log('Captured workspace tabs screenshot: playwright_workspace_tabs.png');
  });

  test('3. Responsive viewport mode switcher: Desktop, Tablet, Mobile', async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });

    // Click Tablet mode
    const tabletBtn = page.locator('button:has-text("Tablet")').first();
    await tabletBtn.click();
    await page.waitForTimeout(300);

    const tabletChassis = page.locator('.viewport-frame-container.tablet, .viewport-device-chassis.tablet');
    await expect(tabletChassis.first()).toBeVisible();

    // Click Mobile mode
    const mobileBtn = page.locator('button:has-text("Mobile")').first();
    await mobileBtn.click();
    await page.waitForTimeout(300);

    const mobileChassis = page.locator('.viewport-frame-container.mobile, .viewport-device-chassis.mobile');
    await expect(mobileChassis.first()).toBeVisible();

    // Return to Desktop mode
    const desktopBtn = page.locator('button:has-text("Desktop")').first();
    await desktopBtn.click();
    await page.waitForTimeout(300);

    const desktopContainer = page.locator('.viewport-frame-container.desktop');
    await expect(desktopContainer.first()).toBeVisible();
  });

  test('4. Engine switcher: Edge vs Sandpack toggle', async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });

    // Switch to Sandpack Engine
    const sandpackBtn = page.locator('button:has-text("Sandpack")').first();
    await sandpackBtn.click();
    await page.waitForTimeout(500);

    // Verify badge updates to Sandpack
    const sandpackBadge = page.locator('text=Sandpack').first();
    await expect(sandpackBadge).toBeVisible();

    // Switch back to Edge Engine
    const edgeBtn = page.locator('button:has-text("Edge")').first();
    await edgeBtn.click();
    await page.waitForTimeout(500);

    const edgeBadge = page.locator('text=Edge').first();
    await expect(edgeBadge).toBeVisible();
  });

  test('5. Model dropdown selection persists correctly', async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });

    const modelSelect = page.locator('select').first();
    
    // Select Qwen 2.5 Coder 32B
    await modelSelect.selectOption('@cf/qwen/qwen2.5-coder-32b-instruct');
    let val = await modelSelect.inputValue();
    expect(val).toBe('@cf/qwen/qwen2.5-coder-32b-instruct');

    // Select Claude 3.7 Sonnet
    await modelSelect.selectOption('claude-3-7-sonnet');
    val = await modelSelect.inputValue();
    expect(val).toBe('claude-3-7-sonnet');
  });
});
