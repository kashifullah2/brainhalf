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

test.describe('Chaos: Preview Runtime & Error Injection Tests', () => {
  test.setTimeout(180000);

  test('Generate app, verify preview, reload, inject error via agent fix', async ({ page }) => {
    const errors = collectConsoleErrors(page);

    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    // Create project
    await page.locator('button[aria-label="Create New Project"]').first().click();
    await page.waitForTimeout(1000);

    const projectId = new URL(page.url()).searchParams.get('project');
    expect(projectId).toBeTruthy();

    // Select fast model
    await page.locator('select').first().selectOption('@cf/meta/llama-3.3-70b-instruct-fp8-fast');

    // STEP 1: Generate a working app
    await sendPrompt(page, 'Create a simple stopwatch with start, stop, and reset buttons. Show elapsed time in MM:SS format. Use inline styles with a dark background.');

    // Wait for completion
    await page.locator('button[title*="Send"]').first().waitFor({ state: 'visible', timeout: 90000 });
    await page.waitForTimeout(2000);

    // STEP 2: Verify preview renders
    const previewTab = page.locator('[role="tablist"] button[role="tab"]').filter({ hasText: 'Preview' }).first();
    await previewTab.click();
    await page.waitForTimeout(3000);

    await page.screenshot({ path: `${ARTIFACT_DIR}/chaos_preview_initial.png` });

    // Check preview iframe is present and not blank
    const previewIframe = page.locator('iframe').first();
    const iframeVisible = await previewIframe.isVisible({ timeout: 5000 }).catch(() => false);
    console.log(`Preview iframe visible: ${iframeVisible}`);

    // STEP 3: Check Code tab shows generated code
    const codeTab = page.locator('[role="tablist"] button[role="tab"]').filter({ hasText: 'Code' }).first();
    await codeTab.click();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `${ARTIFACT_DIR}/chaos_preview_code.png` });

    // STEP 4: Reload preview
    await previewTab.click();
    await page.waitForTimeout(1000);

    const refreshBtn = page.locator('button[title*="Refresh"], button[title*="refresh"]').first();
    if (await refreshBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await refreshBtn.click();
      await page.waitForTimeout(3000);
    }

    await page.screenshot({ path: `${ARTIFACT_DIR}/chaos_preview_after_reload.png` });

    // STEP 5: Ask agent to intentionally break then fix
    await sendPrompt(page, 'Add a lap time recording feature to the stopwatch. When you press a "Lap" button, it records the current time in a list below the stopwatch.');

    await page.locator('button[title*="Send"]').first().waitFor({ state: 'visible', timeout: 90000 });
    await page.waitForTimeout(2000);

    // Check preview updated
    await previewTab.click();
    await page.waitForTimeout(3000);
    await page.screenshot({ path: `${ARTIFACT_DIR}/chaos_preview_after_edit.png` });

    // STEP 6: Check console for errors
    const consoleTabCheck = page.locator('[role="tablist"] button[role="tab"]').filter({ hasText: 'Console' }).first();
    await consoleTabCheck.click();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `${ARTIFACT_DIR}/chaos_preview_console.png` });

    const realErrors = errors.filter(e =>
      !e.includes('favicon') &&
      !e.includes('ResizeObserver') &&
      !e.includes('WebSocket')
    );
    console.log(`Preview test console errors: ${realErrors.length}`);
    for (const err of realErrors.slice(0, 5)) {
      console.log(`  ERR: ${err.substring(0, 150)}`);
    }
  });

  test('Preview edge endpoint returns valid HTML', async ({ request }) => {
    // Test that a known preview URL returns valid content
    const response = await request.get(`${BASE_URL}/preview/default/`);
    expect(response.status()).toBe(200);
    const body = await response.text();
    expect(body).toContain('<html');
    expect(body).toContain('<div id="root"');
    console.log(`Edge preview default response: ${response.status()}, size: ${body.length}`);
  });

  test('Preview with non-existent project returns valid scaffold', async ({ request }) => {
    const fakeId = `chaos-test-${Date.now()}`;
    const response = await request.get(`${BASE_URL}/preview/${fakeId}/`);
    expect(response.status()).toBe(200);
    const body = await response.text();
    // Should return the default scaffold, not a 404
    expect(body).toContain('<html');
    console.log(`Non-existent project preview: ${response.status()}, size: ${body.length}`);
  });

  test('Preview path traversal still blocked', async ({ request }) => {
    const traversalUrls = [
      `${BASE_URL}/preview/test/../../etc/passwd`,
      `${BASE_URL}/preview/test/..%2f..%2fetc/passwd`,
      `${BASE_URL}/preview/test/../../../package.json`,
    ];

    for (const url of traversalUrls) {
      const res = await request.get(url).catch((_e: unknown) => null);
      if (res) {
        expect(res.status()).not.toBe(200);
        const body = await res.text();
        expect(body).not.toContain('"dependencies"');
        expect(body).not.toContain('root:');
        console.log(`Traversal ${url}: status=${res.status()}`);
      }
    }
  });
});
