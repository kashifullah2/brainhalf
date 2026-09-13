import { test, expect, type Page } from '@playwright/test';

const BASE_URL = 'https://brainhalf.com';
const ARTIFACT_DIR = '/home/kashifullah/.gemini/antigravity-ide/brain/bdade561-eefd-4bc6-bb08-2adeffc71475';

const CF_MODELS = [
  { id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', name: 'Llama 3.3 70B' },
  { id: '@cf/qwen/qwen2.5-coder-32b-instruct', name: 'Qwen 2.5 Coder 32B' },
  { id: '@cf/qwen/qwen3.8-27b', name: 'Qwen 3.8 27B' },
  { id: '@cf/zai-org/glm-5.3-flash', name: 'GLM 5.3 Flash' },
  { id: '@cf/moonshotai/kimi-k2.7-code', name: 'Kimi K2.7 Code' },
];

function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', err => errors.push(err.message));
  return errors;
}

for (const model of CF_MODELS) {
  test.describe(`Model Stress: ${model.name}`, () => {
    test.setTimeout(120000);

    test(`Generate calculator app with ${model.name}`, async ({ page }) => {
      const errors = collectConsoleErrors(page);
      const startTime = Date.now();

      await page.goto(BASE_URL, { waitUntil: 'networkidle' });
      await page.waitForTimeout(2000);

      // Create fresh project
      await page.locator('button[aria-label="Create New Project"]').first().click();
      await page.waitForTimeout(1000);

      const projectId = new URL(page.url()).searchParams.get('project');
      expect(projectId).toBeTruthy();

      // Select model
      await page.locator('select').first().selectOption(model.id);
      const selectedVal = await page.locator('select').first().inputValue();
      expect(selectedVal).toBe(model.id);

      // Send prompt
      const textarea = page.locator('textarea').first();
      await textarea.fill('Create a complete responsive calculator with keyboard support, calculation history, clear button, and clean modern UI using inline styles.');
      await page.waitForTimeout(200);

      const sendBtn = page.locator('button[title*="Send"]').first();
      await sendBtn.click();

      const sendTime = Date.now();

      // Wait for Stop button (first token indicator)
      let firstTokenTime = 0;
      try {
        await page.locator('button[title*="Stop"]').first().waitFor({ state: 'visible', timeout: 30000 });
        firstTokenTime = Date.now() - sendTime;
      } catch {
        firstTokenTime = -1; // Timeout
      }

      // Wait for completion (Send button reappears)
      let totalGenTime = 0;
      let completed = false;
      try {
        await page.locator('button[title*="Send"]').first().waitFor({ state: 'visible', timeout: 90000 });
        totalGenTime = Date.now() - sendTime;
        completed = true;
      } catch {
        totalGenTime = -1;
      }

      // Check if code was generated
      const bodyText = await page.locator('body').innerText();
      const hasCode = bodyText.includes('function') || bodyText.includes('export') || bodyText.includes('return');
      const hasCalc = bodyText.toLowerCase().includes('calculator') || bodyText.toLowerCase().includes('calc');

      // Check preview
      const previewTab = page.locator('[role="tablist"] button[role="tab"]').filter({ hasText: 'Preview' }).first();
      await previewTab.click();
      await page.waitForTimeout(3000);

      await page.screenshot({ path: `${ARTIFACT_DIR}/chaos_model_${model.name.replace(/\s+/g, '_')}.png` });

      // Filter real errors
      const realErrors = errors.filter(e =>
        !e.includes('favicon') &&
        !e.includes('ResizeObserver') &&
        !e.includes('WebSocket')
      );

      // Log results
      console.log(`\n=== MODEL: ${model.name} (${model.id}) ===`);
      console.log(`  First token: ${firstTokenTime}ms`);
      console.log(`  Total gen: ${totalGenTime}ms`);
      console.log(`  Completed: ${completed}`);
      console.log(`  Has code: ${hasCode}`);
      console.log(`  Has calculator: ${hasCalc}`);
      console.log(`  Console errors: ${realErrors.length}`);
      for (const err of realErrors.slice(0, 3)) {
        console.log(`    ERR: ${err.substring(0, 120)}`);
      }

      // Assertions: model must produce some output within timeout
      expect(firstTokenTime).not.toBe(-1);
    });
  });
}
