import { test, expect } from '@playwright/test';

const BASE_URL = 'https://brainhalf.com';

test.describe('E2E Agent Streaming & Stop Control Tests', () => {
  test('1. Agent generation flow, streaming indicators, and Stop generation button', async ({ page }) => {
    // Navigate with fresh test project ID to isolate
    const testProjId = `qa-stop-${Date.now()}`;
    await page.goto(`${BASE_URL}/?project=${testProjId}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);

    const chatInput = page.locator('textarea[placeholder*="Ask BrainHalf"]');
    await expect(chatInput).toBeVisible();

    // Select fast edge model Qwen 2.5 Coder
    const modelSelect = page.locator('select').first();
    await modelSelect.selectOption('@cf/qwen/qwen2.5-coder-32b-instruct');

    // Type a prompt that produces code
    await chatInput.fill('Create a minimalist digital clock in React with seconds and date.');
    
    // Click Send Button
    const sendBtn = page.locator('button[title*="Send"]').first();
    await expect(sendBtn).toBeEnabled();
    await sendBtn.click();
    await page.waitForTimeout(300);

    // Verify Stop button appears
    const stopBtn = page.locator('button[title*="Stop"]').first();
    await expect(stopBtn).toBeVisible({ timeout: 10000 });

    // Click Stop during generation
    await stopBtn.click();
    await page.waitForTimeout(600);

    // Verify Send button reappears and input is re-enabled
    await expect(sendBtn).toBeVisible();
    await expect(chatInput).toBeEnabled();

    // Immediately send another short prompt to verify clean state recovery
    await chatInput.fill('Say hello');
    await sendBtn.click();
    await page.waitForTimeout(600);

    // Verify Stop button appears again for the second prompt
    await expect(stopBtn).toBeVisible({ timeout: 10000 });
  });
});
