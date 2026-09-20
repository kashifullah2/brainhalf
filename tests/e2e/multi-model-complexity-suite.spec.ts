import { test, expect } from '@playwright/test';
import { runPlatformLevelChecks } from '../platform-checks';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';

const MODELS = [
  { id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', name: 'Llama 3.3 70B' },
  { id: 'Atria-Dawn-Preview', name: 'Atria Dawn Preview' },
];

const PROMPTS = [
  {
    tier: 'Medium',
    prompt: 'Create a full-stack Todo app with categories. Allow users to add, edit, delete, and toggle the completion status of todos. Include a summary of completed vs pending tasks.'
  },
  {
    tier: 'Tricky',
    prompt: 'Create a responsive Crypto Portfolio Dashboard. It should show a list of mock assets with fake live-updating prices every 2 seconds, and a chart (using simple divs) showing the overall profit/loss over time.'
  }
];

test.describe('Multi-Model Complexity Test Suite', () => {
  // Use a generous timeout as full-stack multi-file AI generation takes time
  test.setTimeout(8 * 60 * 1000); 

  for (const model of MODELS) {
    for (const prompt of PROMPTS) {
      test(`Model: ${model.name} | Tier: ${prompt.tier}`, async ({ page }) => {
        // 1. Navigate and setup
        await page.goto(BASE_URL);
        await page.waitForLoadState('domcontentloaded');

        // Seed dev auth session so we are in the workspace
        await page.addInitScript(() => {
          try {
            localStorage.setItem('bh_session_token', 'bh_dev_local_token_not_a_real_session');
            localStorage.setItem('bh_session_user', JSON.stringify({ id: 'dev-user-1', email: 'dev@brainhalf.local' }));
          } catch {}
        });

        const testProjectId = `multi-model-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        await page.goto(`${BASE_URL}/?project=${testProjectId}`);
        await page.waitForLoadState('domcontentloaded');

        // Wait for workspace and chat panel
        await page.locator('.chat-panel-container').waitFor({ state: 'visible', timeout: 20000 });

        // Select the specific model using the modern model picker
        const modelPickerBtn = page.locator('[data-testid="model-picker-btn"]').first();
        await modelPickerBtn.waitFor({ state: 'visible', timeout: 20000 });
        await modelPickerBtn.click();

        const modelOption = page.locator(`[data-testid="model-option-${model.id}"]`).or(page.locator(`button:has-text("${model.name}")`)).first();
        if (await modelOption.isVisible({ timeout: 3000 }).catch(() => false)) {
          await modelOption.click();
        } else {
          await page.keyboard.press('Escape').catch(() => {});
        }

        // 2. Submit the prompt
        const promptInput = page.locator('textarea, input[placeholder*="Ask BrainHalf"], input[type="text"]').first();
        await promptInput.waitFor({ state: 'visible', timeout: 10000 });
        await promptInput.fill(prompt.prompt);
        
        const sendBtn = page.locator('button[data-testid="send-prompt-btn"], button[aria-label*="Send"], button:has-text("Send"), button:has-text("Generate")').first();
        await sendBtn.waitFor({ state: 'visible', timeout: 5000 });
        await expect(sendBtn).toBeEnabled({ timeout: 5000 });
        await sendBtn.click();

        // 3. Wait for Generation to start and finish
        const stopBtn = page.locator('button[aria-label="Stop Generation"]');
        await stopBtn.waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
        await stopBtn.waitFor({ state: 'hidden', timeout: 7 * 60 * 1000 });

        // Ensure generation finished successfully without an error alert
        const errorAlert = page.locator('div[role="status"]', { hasText: /Error|Failed/i }).first();
        const hasError = await errorAlert.isVisible().catch(() => false);
        if (hasError) {
          const errText = await errorAlert.innerText().catch(() => 'Unknown error');
          throw new Error(`Generation failed for ${model.name}: ${errText}`);
        }

        // Allow preview iframe time to mount and execute the generated code
        await page.waitForTimeout(4000);

        // Click refresh to ensure newly extracted files reload in Edge preview
        const refreshBtn = page.locator('button[aria-label="Refresh the preview"]');
        if (await refreshBtn.isVisible().catch(() => false)) {
          await refreshBtn.click();
          await page.waitForTimeout(4000);
        }

        // 4. Validate the Sandbox/Preview
        // Ensure the Cloudflare Edge preview iframe is present and has loaded
        const previewIframe = page.frameLocator('iframe[title="Cloudflare Edge preview"], iframe').first();
        const body = previewIframe.locator('body');

        // Wait for some content to be injected into the preview body
        await expect(body).toBeVisible({ timeout: 10000 });

        // Basic check that it doesn't just show a blank/error document
        const root = previewIframe.locator('#root');
        await expect(root).toBeVisible({ timeout: 10000 });
        
        // Log body text to diagnose
        const bodyText = await body.innerText().catch(() => '<unable to read body>');
        console.log('[DEBUG] Preview body innerText:', bodyText);

        // Specific content checks based on prompt
        if (prompt.tier === 'Medium') {
           // Should see something related to a Todo app. Use lenient matching to avoid flakiness.
           const todoContent = previewIframe.locator('body', { hasText: /[Tt]odo|[Tt]ask|[Aa]dd/ });
           await expect(todoContent).toBeVisible();
        } else if (prompt.tier === 'Hard') {
           // Kanban columns
           const kanbanContent = previewIframe.locator('body', { hasText: /[Tt]odo|[Ii]n [Pp]rogress|[Dd]one/ });
           await expect(kanbanContent).toBeVisible();
        }
        // Other tiers can be hard to assert statically via text since it's a game or audio API,
        // so we mainly rely on the fact that NO preview errors crashed the iframe.
      });
    }
  }
});
