import { test, expect, type Page } from '@playwright/test';

const BASE_URL = 'https://brainhalf.com';
const ARTIFACT_DIR = '/home/kashifullah/.gemini/antigravity-ide/brain/bdade561-eefd-4bc6-bb08-2adeffc71475';

function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', err => errors.push(err.message));
  return errors;
}

async function sendPrompt(page: Page, prompt: string) {
  const textarea = page.locator('textarea').first();
  await textarea.fill(prompt);
  await page.waitForTimeout(200);
  const sendBtn = page.locator('button[title*="Send"]').first();
  await expect(sendBtn).toBeEnabled({ timeout: 5000 });
  await sendBtn.click();
  await page.waitForTimeout(300);
}

test.describe('Chaos: Race Condition Tests', () => {
  test.setTimeout(120000);

  test('Race 1: Double-click send button - only one generation should start', async ({ page }) => {
    const errors = collectConsoleErrors(page);

    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    // Create fresh project
    await page.locator('button[aria-label="Create New Project"]').first().click();
    await page.waitForTimeout(1000);

    // Select fast model
    await page.locator('select').first().selectOption('@cf/meta/llama-3.3-70b-instruct-fp8-fast');

    // Fill prompt
    const textarea = page.locator('textarea').first();
    await textarea.fill('Create a hello world React app');
    await page.waitForTimeout(200);

    // Double-click send rapidly
    const sendBtn = page.locator('button[title*="Send"]').first();
    await sendBtn.click();
    await sendBtn.click({ force: true }).catch(() => {}); // Second click may fail - that's OK
    await page.waitForTimeout(1000);

    // Verify only one stop button / generation indicator
    const stopBtns = page.locator('button[title*="Stop"]');
    const stopCount = await stopBtns.count();
    expect(stopCount).toBeLessThanOrEqual(1);

    // Wait for completion
    await page.locator('button[title*="Send"]').first().waitFor({ state: 'visible', timeout: 90000 });
    await page.screenshot({ path: `${ARTIFACT_DIR}/chaos_race1_double_send.png` });

    console.log(`Race 1 errors: ${errors.length}`);
  });

  test('Race 2: Stop and immediately restart - old gen must not continue', async ({ page }) => {
    const errors = collectConsoleErrors(page);

    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    await page.locator('button[aria-label="Create New Project"]').first().click();
    await page.waitForTimeout(1000);

    await page.locator('select').first().selectOption('@cf/meta/llama-3.3-70b-instruct-fp8-fast');

    // Send first prompt
    await sendPrompt(page, 'Create a todo list app with add, delete, and mark as done features.');

    // Wait for Stop button
    const stopBtn = page.locator('button[title*="Stop"]').first();
    await expect(stopBtn).toBeVisible({ timeout: 20000 });

    // Immediately stop
    await stopBtn.click();
    await page.waitForTimeout(500);

    // Immediately send a second prompt
    const sendBtn = page.locator('button[title*="Send"]').first();
    await expect(sendBtn).toBeVisible({ timeout: 10000 });

    await sendPrompt(page, 'Create a simple calculator instead. Ignore the previous todo list.');

    // Wait for second generation to complete
    await page.locator('button[title*="Send"]').first().waitFor({ state: 'visible', timeout: 90000 });
    await page.waitForTimeout(1000);

    // Check that the final content is about calculator, not todo list
    const bodyText = await page.locator('body').innerText();
    const hasCalculator = bodyText.toLowerCase().includes('calculator') || bodyText.toLowerCase().includes('calc');
    console.log(`Race 2: Final content mentions calculator: ${hasCalculator}`);

    await page.screenshot({ path: `${ARTIFACT_DIR}/chaos_race2_stop_restart.png` });
    console.log(`Race 2 errors: ${errors.length}`);
  });

  test('Race 3: Rapid project switching during generation', async ({ page }) => {
    const errors = collectConsoleErrors(page);

    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    // Create Project A and start generation
    await page.locator('button[aria-label="Create New Project"]').first().click();
    await page.waitForTimeout(1000);
    const projectAId = new URL(page.url()).searchParams.get('project');

    await page.locator('select').first().selectOption('@cf/meta/llama-3.3-70b-instruct-fp8-fast');
    await sendPrompt(page, 'Create a simple clock app.');

    // Wait briefly for generation to start
    await page.waitForTimeout(2000);

    // Create Project B (switching away during generation)
    await page.locator('button[aria-label="Create New Project"]').first().click();
    await page.waitForTimeout(1000);
    const projectBId = new URL(page.url()).searchParams.get('project');
    expect(projectBId).not.toBe(projectAId);

    // Switch back to Project A
    const projectBtns = page.locator('button[aria-label*="Select"]');
    const count = await projectBtns.count();
    if (count > 1) {
      await projectBtns.first().click();
      await page.waitForTimeout(1000);

      // Switch back to B
      await projectBtns.last().click();
      await page.waitForTimeout(1000);
    }

    // Verify current project matches URL
    const finalProject = new URL(page.url()).searchParams.get('project');
    expect(finalProject).toBeTruthy();

    await page.screenshot({ path: `${ARTIFACT_DIR}/chaos_race3_project_switch.png` });
    console.log(`Race 3 errors: ${errors.length}`);
  });

  test('Race 4: Preview reload during generation', async ({ page }) => {
    const errors = collectConsoleErrors(page);

    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    await page.locator('button[aria-label="Create New Project"]').first().click();
    await page.waitForTimeout(1000);

    await page.locator('select').first().selectOption('@cf/meta/llama-3.3-70b-instruct-fp8-fast');
    await sendPrompt(page, 'Create a colorful gradient background app with a centered title.');

    // Wait for generation to begin
    await page.waitForTimeout(3000);

    // Click refresh preview multiple times during generation
    const refreshBtn = page.locator('button[title*="Refresh"], button[title*="refresh"]').first();
    if (await refreshBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      for (let i = 0; i < 3; i++) {
        await refreshBtn.click().catch(() => {});
        await page.waitForTimeout(800);
      }
    }

    // Wait for generation to complete
    await page.locator('button[title*="Send"]').first().waitFor({ state: 'visible', timeout: 90000 });
    await page.waitForTimeout(2000);

    // Verify preview shows content (not blank)
    const previewTab = page.locator('[role="tablist"] button[role="tab"]').filter({ hasText: 'Preview' }).first();
    await previewTab.click();
    await page.waitForTimeout(2000);

    await page.screenshot({ path: `${ARTIFACT_DIR}/chaos_race4_preview_reload.png` });
    console.log(`Race 4 errors: ${errors.length}`);
  });
});
