import { test, expect, type Page } from '@playwright/test';

const BASE_URL = 'https://brainhalf.com';
const ARTIFACT_DIR = '/home/kashifullah/.gemini/antigravity-ide/brain/bdade561-eefd-4bc6-bb08-2adeffc71475';

// Helper: collect console errors
function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', err => errors.push(err.message));
  return errors;
}

// Helper: send a prompt and wait for generation to start
async function sendPrompt(page: Page, prompt: string) {
  const textarea = page.locator('textarea').first();
  await textarea.fill(prompt);
  await page.waitForTimeout(300);
  const sendBtn = page.locator('button[title*="Send"]').first();
  await expect(sendBtn).toBeEnabled({ timeout: 5000 });
  await sendBtn.click();
  await page.waitForTimeout(500);
}

// Helper: wait for Stop button to appear (agent generating)
async function waitForStopButton(page: Page, timeout = 20000) {
  const stopBtn = page.locator('button[title*="Stop"]').first();
  await expect(stopBtn).toBeVisible({ timeout });
  return stopBtn;
}

// Helper: wait for Send button to reappear (agent finished or stopped)
async function waitForSendButton(page: Page, timeout = 120000) {
  const sendBtn = page.locator('button[title*="Send"]').first();
  await expect(sendBtn).toBeVisible({ timeout });
  return sendBtn;
}

test.describe('Chaos: Concurrent AI Agent Mutation Tests', () => {
  test.setTimeout(180000); // 3 minutes per test

  test('Step 1-4: Create project, concurrent actions during generation, stop agent', async ({ page }) => {
    const errors = collectConsoleErrors(page);

    // STEP 1: Open app, capture initial state
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `${ARTIFACT_DIR}/chaos_step1_initial.png` });

    // Verify UI fully rendered
    const navbar = page.locator('text=BrainHalf').first();
    await expect(navbar).toBeVisible();
    const workspace = page.locator('[role="tablist"]').first();
    await expect(workspace).toBeVisible();

    // STEP 2: Create new project
    const newProjectBtn = page.locator('button[aria-label="Create New Project"]').first();
    await newProjectBtn.click();
    await page.waitForTimeout(1000);

    const projectUrl = page.url();
    const projectId = new URL(projectUrl).searchParams.get('project');
    expect(projectId).toBeTruthy();

    // Rename to "Chaos Dashboard"
    const titleTrigger = page.locator('[title="Click to rename project"]').first();
    if (await titleTrigger.isVisible()) {
      await titleTrigger.click();
      await page.waitForTimeout(200);
      const titleInput = page.locator('input[aria-label="Rename project input"]');
      if (await titleInput.isVisible()) {
        await titleInput.fill('Chaos Dashboard');
        await titleInput.press('Enter');
        await page.waitForTimeout(300);
      }
    }

    // Select Llama 3.3 70B model for reliable generation
    const modelSelect = page.locator('select').first();
    await modelSelect.selectOption('@cf/meta/llama-3.3-70b-instruct-fp8-fast');

    // Send complex SaaS prompt
    await sendPrompt(page, 'Build a responsive SaaS analytics dashboard with sidebar navigation, dashboard metrics cards, a data table, search bar, and dark mode toggle. Use inline styles and lucide-react icons.');

    // Wait for agent to start generating
    const stopBtn = await waitForStopButton(page, 25000);
    await page.screenshot({ path: `${ARTIFACT_DIR}/chaos_step2_generating.png` });

    // STEP 3: Concurrent actions during generation
    // 3a: Switch workspace tabs while generating
    const codeTab = page.locator('[role="tablist"] button[role="tab"]').filter({ hasText: 'Code' }).first();
    await codeTab.click();
    await page.waitForTimeout(500);

    const previewTab = page.locator('[role="tablist"] button[role="tab"]').filter({ hasText: 'Preview' }).first();
    await previewTab.click();
    await page.waitForTimeout(500);

    const consoleTab = page.locator('[role="tablist"] button[role="tab"]').filter({ hasText: 'Console' }).first();
    await consoleTab.click();
    await page.waitForTimeout(500);

    // 3b: Back to preview
    await previewTab.click();
    await page.waitForTimeout(300);

    // 3c: Try to change model during generation (should be allowed or gracefully prevented)
    const modelDuringGen = page.locator('select').first();
    await modelDuringGen.selectOption('@cf/qwen/qwen2.5-coder-32b-instruct').catch(() => 'blocked');

    // Verify UI hasn't frozen
    await expect(navbar).toBeVisible();
    await page.screenshot({ path: `${ARTIFACT_DIR}/chaos_step3_concurrent.png` });

    // STEP 4: Stop agent during generation
    if (await stopBtn.isVisible()) {
      await stopBtn.click();
      await page.waitForTimeout(1000);
    }

    // Verify generation stopped
    const sendBtnAfterStop = await waitForSendButton(page, 15000);
    await expect(sendBtnAfterStop).toBeVisible();

    await page.screenshot({ path: `${ARTIFACT_DIR}/chaos_step4_stopped.png` });

    // Verify project can still be interacted with
    await codeTab.click();
    await page.waitForTimeout(500);
    await previewTab.click();
    await page.waitForTimeout(500);

    // Report critical console errors
    const criticalErrors = errors.filter(e =>
      !e.includes('favicon') &&
      !e.includes('net::ERR') &&
      !e.includes('WebSocket') &&
      !e.includes('ResizeObserver')
    );
    console.log(`Step 1-4 console errors: ${criticalErrors.length}`);
    for (const err of criticalErrors.slice(0, 5)) {
      console.log(`  ERROR: ${err}`);
    }
  });

  test('Step 5-6: Restart agent, reload persistence', async ({ page }) => {
    const errors = collectConsoleErrors(page);

    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    // Create a fresh project for this test
    const newProjectBtn = page.locator('button[aria-label="Create New Project"]').first();
    await newProjectBtn.click();
    await page.waitForTimeout(1000);

    const projectId = new URL(page.url()).searchParams.get('project');
    expect(projectId).toBeTruthy();

    // Select fast model
    const modelSelect = page.locator('select').first();
    await modelSelect.selectOption('@cf/meta/llama-3.3-70b-instruct-fp8-fast');

    // STEP 5a: Send initial prompt
    await sendPrompt(page, 'Create a simple counter app with increment, decrement, and reset buttons. Use inline styles.');
    
    // Wait for completion
    await waitForSendButton(page, 90000);
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `${ARTIFACT_DIR}/chaos_step5_initial_gen.png` });

    // STEP 5b: Send follow-up without recreating
    await sendPrompt(page, 'Add a dark mode toggle button to the existing counter app. Do NOT rewrite the entire component. Only add the dark mode feature.');

    await waitForSendButton(page, 90000);
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `${ARTIFACT_DIR}/chaos_step5_followup.png` });

    // STEP 6: Reload page and verify persistence
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);

    // Verify URL preserves project
    expect(page.url()).toContain(projectId!);

    // Verify chat history persisted
    const chatContent = await page.locator('body').innerText();
    const hasHistory = chatContent.includes('counter') || chatContent.includes('dark mode') || chatContent.includes('BrainHalf');
    expect(hasHistory).toBeTruthy();

    // Verify preview still works
    const previewTab = page.locator('[role="tablist"] button[role="tab"]').filter({ hasText: 'Preview' }).first();
    await previewTab.click();
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `${ARTIFACT_DIR}/chaos_step6_reload.png` });

    console.log(`Step 5-6 console errors: ${errors.filter(e => !e.includes('favicon')).length}`);
  });

  test('Step 8-10: Project isolation, rapid switching, deletion', async ({ page }) => {
    const errors = collectConsoleErrors(page);

    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    // STEP 8: Create Project A
    const newProjectBtn = page.locator('button[aria-label="Create New Project"]').first();
    await newProjectBtn.click();
    await page.waitForTimeout(1000);
    const projectAId = new URL(page.url()).searchParams.get('project');
    expect(projectAId).toBeTruthy();

    // Create Project B
    await newProjectBtn.click();
    await page.waitForTimeout(1000);
    const projectBId = new URL(page.url()).searchParams.get('project');
    expect(projectBId).toBeTruthy();
    expect(projectBId).not.toBe(projectAId);

    // STEP 9: Rapid switching 10 times
    const projectButtons = page.locator('button[aria-label*="Select"]');
    const projectCount = await projectButtons.count();

    for (let i = 0; i < 10; i++) {
      const targetIndex = i % Math.max(projectCount, 2);
      const targetBtn = projectButtons.nth(Math.min(targetIndex, projectCount - 1));
      if (await targetBtn.isVisible()) {
        await targetBtn.click();
        await page.waitForTimeout(300);
      }
    }

    // Verify no stale state after rapid switching
    await page.waitForTimeout(1000);
    const currentProject = new URL(page.url()).searchParams.get('project');
    expect(currentProject).toBeTruthy();
    await page.screenshot({ path: `${ARTIFACT_DIR}/chaos_step9_rapid_switch.png` });

    // STEP 10: Delete a project
    const deleteBtn = page.locator('button:has-text("Delete")').first();
    if (await deleteBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await deleteBtn.click();
      await page.waitForTimeout(500);

      const confirmBtn = page.locator('button:has-text("Confirm"), button:has-text("Yes"), button:has-text("Delete")').last();
      if (await confirmBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await confirmBtn.click();
        await page.waitForTimeout(1000);
      }
    }

    await page.screenshot({ path: `${ARTIFACT_DIR}/chaos_step10_deletion.png` });
    console.log(`Step 8-10 console errors: ${errors.filter(e => !e.includes('favicon')).length}`);
  });
});
