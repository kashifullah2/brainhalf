import { test, expect } from '@playwright/test';

test.describe('E2E App & LLM Generation Tests', () => {
  test('1. Unauthenticated Landing Page shows Get Started and Sign in', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    
    // Heading and landing hero elements
    const heading = page.locator('h1').first();
    await expect(heading).toBeVisible();

    // Verify Get Started button is visible for unauthenticated users
    const getStartedBtn = page.locator('button:has-text("Get Started")').first();
    await expect(getStartedBtn).toBeVisible();

    // Verify Sign in button is visible
    const signInBtn = page.locator('button:has-text("Sign in")').first();
    await expect(signInBtn).toBeVisible();

    // Clicking Sign in opens the login modal
    await signInBtn.click();
    await expect(page.getByLabel('Email Address')).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();

    // Closing the modal returns to landing page
    const closeBtn = page.locator('button[aria-label="Close dialog"]').or(page.locator('button:has-text("Cancel")')).or(page.locator('.close-btn, [aria-label="Close"]')).first();
    if (await closeBtn.isVisible().catch(() => false)) {
      await closeBtn.click();
      await expect(page.getByLabel('Email Address')).not.toBeVisible();
    }
  });

  test('2. Authentication and Workspace reachability', async ({ page }) => {
    // Navigate to a project directly to trigger login
    const testProjectId = `test-e2e-${Date.now()}`;
    await page.goto(`/?project=${testProjectId}`, { waitUntil: 'domcontentloaded' });

    // Should prompt for login
    await expect(page.getByLabel('Email Address')).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();

    // Log in with dev credentials
    await page.getByLabel('Email Address').fill('dev@brainhalf.local');
    await page.getByLabel('Password').fill('brainhalf-dev');
    await page.getByRole('button', { name: 'Sign in' }).click();

    // Workspace and TopNav should now be visible
    await expect(page.locator('.workspace-area')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.top-nav')).toBeVisible();
    await expect(page.locator('.chat-panel-container')).toBeVisible();
  });

  test('3. Model Selection, Streaming Generation, and Stop Button Flow', async ({ page }) => {
    // Seed dev auth session in localStorage
    await page.addInitScript(() => {
      try {
        localStorage.setItem('bh_session_token', 'bh_dev_local_token_not_a_real_session');
        localStorage.setItem('bh_session_user', JSON.stringify({ id: 'dev-user-1', email: 'dev@brainhalf.local' }));
      } catch {}
    });

    const testProjectId = `llm-stream-test-${Date.now()}`;
    await page.goto(`/?project=${testProjectId}`, { waitUntil: 'domcontentloaded' });

    await expect(page.locator('.chat-panel-container')).toBeVisible({ timeout: 10000 });

    // Verify Model selector button exists and shows current model
    const modelPickerBtn = page.locator('[data-testid="model-picker-btn"]');
    await expect(modelPickerBtn).toBeVisible();

    // Click model picker to view and select models
    await modelPickerBtn.click();

    // Choose Qwen model from the menu
    const qwenOption = page.locator('button:has-text("Qwen")').first();
    if (await qwenOption.isVisible().catch(() => false)) {
      await qwenOption.click();
    } else {
      // Close dropdown if already on Qwen
      await page.keyboard.press('Escape').catch(() => {});
    }

    // Find chat input
    const chatInput = page.locator('textarea[placeholder*="Ask BrainHalf"], textarea').first();
    await expect(chatInput).toBeVisible();
    await expect(chatInput).toBeEnabled();

    // Type prompt
    await chatInput.fill('Create a full-stack weather dashboard with 5-day forecast');

    // Send prompt
    const sendBtn = page.locator('button[title*="Send"]').or(page.locator('button:has-text("Send")')).first();
    await expect(sendBtn).toBeEnabled();
    await sendBtn.click();

    // Verify Stop button appears during generation
    const stopBtn = page.locator('button[title*="Stop"]').or(page.locator('button[aria-label*="Stop"]')).first();
    await expect(stopBtn).toBeVisible({ timeout: 10000 });

    // Click Stop button to interrupt generation cleanly
    await stopBtn.click();

    // Send button should reappear and chat input re-enabled
    await expect(sendBtn).toBeVisible({ timeout: 5000 });
    await expect(chatInput).toBeEnabled();

    // Send a second prompt and let it complete
    await chatInput.fill('Make a counter app');
    await sendBtn.click();

    // Stop button appears again
    await expect(stopBtn).toBeVisible({ timeout: 10000 });

    // Wait for full completion (Stop button disappears, Send button returns)
    await expect(stopBtn).toBeHidden({ timeout: 15000 });
    await expect(sendBtn).toBeVisible();
    await expect(chatInput).toBeEnabled();

    // Verify message list has AI response
    const aiMessages = page.locator('.message-ai, .chat-message-ai, [data-role="ai"], .prose');
    await expect(aiMessages.first()).toBeVisible();
  });
});
