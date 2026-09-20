import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';

test.describe('E2E Agent Streaming & Stop Control Tests', () => {
  test('1. Agent generation flow, streaming indicators, and Stop generation button', async ({ page }) => {
    // Seed dev auth session
    await page.addInitScript(() => {
      try {
        localStorage.setItem('bh_session_token', 'bh_dev_local_token_not_a_real_session');
        localStorage.setItem('bh_session_user', JSON.stringify({ id: 'dev-user-1', email: 'dev@brainhalf.local' }));
      } catch {}
    });

    // Navigate with fresh test project ID to isolate
    const testProjId = `qa-stop-${Date.now()}`;
    await page.goto(`${BASE_URL}/?project=${testProjId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);

    const chatInput = page.locator('textarea[placeholder*="Ask BrainHalf"], textarea').first();
    await expect(chatInput).toBeVisible({ timeout: 10000 });

    // Type a prompt that produces code
    await chatInput.fill('Create a minimalist digital clock in React with seconds and date.');
    
    // Click Send Button
    const sendBtn = page.locator('button[title*="Send"]').first();
    await expect(sendBtn).toBeEnabled();
    await sendBtn.click();
    await page.waitForTimeout(300);

    // Verify Stop button appears
    const stopBtn = page.locator('[data-testid="stop-generation-btn"]').or(page.locator('button[title*="Stop"]')).first();
    await expect(stopBtn).toBeVisible({ timeout: 10000 });

    // Click Stop during generation
    await stopBtn.click();
    await page.waitForTimeout(600);

    // Verify Send button reappears and input is re-enabled
    await expect(sendBtn).toBeVisible();
    await expect(chatInput).toBeEnabled();

    // Immediately send another short prompt to verify clean state recovery
    await chatInput.fill('Create another component in React');
    await expect(sendBtn).toBeEnabled({ timeout: 5000 });
    await sendBtn.click();

    // Verify Stop button appears again for the second prompt
    await expect(stopBtn).toBeVisible({ timeout: 10000 });
  });
});
