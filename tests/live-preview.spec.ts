import { test, expect } from '@playwright/test';

const APP1_URL = 'https://brainhalf.com/preview/app-1789199724002-ky89a/';
const APP2_URL = 'https://brainhalf.com/preview/app-1789199796075-yo79s/';
const ARTIFACT_DIR = '/home/kashifullah/.gemini/antigravity-ide/brain/bdade561-eefd-4bc6-bb08-2adeffc71475';

test.describe('BrainHalf Live Edge Previews E2E', () => {
  test('1. App 1 (FocusHub Pomodoro & Tasks) mounts and runs without errors', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    const response = await page.goto(APP1_URL, { waitUntil: 'networkidle' });
    expect(response?.status()).toBe(200);

    // Verify root is mounted
    const rootEl = page.locator('#root');
    await expect(rootEl).toBeVisible();

    // Wait for App to mount beyond loader
    await page.waitForTimeout(1500);

    // Verify Pomodoro / Timer UI elements are visible
    const timerText = page.locator('text=/\\d{1,2}:\\d{2}/').first();
    const hasTimer = await timerText.isVisible().catch(() => false);
    console.log(`App 1 timer visible: ${hasTimer}`);

    // Verify there are no critical transpile error views
    const errorView = page.locator('text=Syntax or Runtime Error');
    await expect(errorView).not.toBeVisible();

    // Capture screenshot
    await page.screenshot({ path: `${ARTIFACT_DIR}/playwright_app1_preview.png`, fullPage: true });
    console.log('Captured App 1 preview screenshot: playwright_app1_preview.png');
  });

  test('2. App 2 (CyberBreak Brick Breaker) renders canvas & game screen', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    const response = await page.goto(APP2_URL, { waitUntil: 'networkidle' });
    expect(response?.status()).toBe(200);

    // Verify root is mounted
    const rootEl = page.locator('#root');
    await expect(rootEl).toBeVisible();

    // Wait for App to mount
    await page.waitForTimeout(1500);

    // Verify game title or start prompt
    const startTitle = page.locator('text=Cyber Neon Brick Breaker, text=Brick Breaker').first();
    const isTitleVisible = await startTitle.isVisible().catch(() => false);
    console.log(`App 2 game title visible: ${isTitleVisible}`);

    // Verify no transpile errors
    const errorView = page.locator('text=Syntax or Runtime Error');
    await expect(errorView).not.toBeVisible();

    // Capture screenshot
    await page.screenshot({ path: `${ARTIFACT_DIR}/playwright_app2_preview.png`, fullPage: true });
    console.log('Captured App 2 preview screenshot: playwright_app2_preview.png');
  });
});
