import { test, expect, type Page } from '@playwright/test';
import { BASE_URL, ARTIFACT_DIR, collectConsoleErrors } from './fixtures/helpers';

const CF_MODELS = [
  { id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', name: 'Llama 3.3 70B' },
  { id: '@cf/qwen/qwen2.5-coder-32b-instruct', name: 'Qwen 2.5 Coder 32B' },
  { id: '@cf/qwen/qwen3.8-27b', name: 'Qwen 3.8 27B' },
  { id: '@cf/zai-org/glm-5.3-flash', name: 'GLM 5.3 Flash' },
  { id: '@cf/moonshotai/kimi-k2.7-code', name: 'Kimi K2.7 Code' },
];

for (const model of CF_MODELS) {
  test.describe(`Model Stress: ${model.name}`, () => {
    test.setTimeout(120000);

    test(`Generate calculator app with ${model.name}`, async ({ page }) => {
      const errors = collectConsoleErrors(page);
      const startTime = Date.now();

      // Seed dev auth session
      await page.addInitScript(() => {
        try {
          localStorage.setItem('bh_session_token', 'bh_dev_local_token_not_a_real_session');
          localStorage.setItem('bh_session_user', JSON.stringify({ id: 'dev-user-1', email: 'dev@brainhalf.local' }));
        } catch {}
      });

      const projectId = `chaos-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      await page.goto(`${BASE_URL}/?project=${projectId}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(500);

      // Select model via picker
      const pickerBtn = page.locator('[data-testid="model-picker-btn"]');
      if (await pickerBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
        await pickerBtn.click();
        const modelBtn = page.locator(`button:has-text("${model.name}"), button:has-text("${model.id.split('/').pop()}")`).first();
        if (await modelBtn.isVisible().catch(() => false)) {
          await modelBtn.click();
        } else {
          await page.keyboard.press('Escape').catch(() => {});
        }
      }

      // Send prompt
      const textarea = page.locator('textarea[placeholder*="Ask BrainHalf"], textarea').first();
      await textarea.fill('Create a complete responsive calculator with keyboard support, calculation history, clear button, and clean modern UI using inline styles.');
      await page.waitForTimeout(200);

      const sendBtn = page.locator('button[title*="Send"], button:has-text("Send")').first();
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

      // Check preview if tab is present
      const previewTab = page.locator('[role="tablist"] button[role="tab"], button').filter({ hasText: 'Preview' }).first();
      if (await previewTab.isVisible().catch(() => false)) {
        await previewTab.click();
        await page.waitForTimeout(1000);
      }

      try {
        const fs = await import('fs');
        if (!fs.existsSync(ARTIFACT_DIR)) fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
        await page.screenshot({ path: `${ARTIFACT_DIR}/chaos_model_${model.name.replace(/\s+/g, '_')}.png` });
      } catch {}

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
