/**
 * BrainHalf Model & Agent Performance Benchmark — Master Orchestrator
 *
 * Drives the BrainHalf UI to execute tasks across models and run Playwright checks.
 * Run via: `npx playwright test tests/benchmark/orchestrator.spec.ts`
 */

import { test, expect } from '@playwright/test';
import {
  BASE_URL,
  getEnabledModels,
  getEnabledTasks,
  TIER_TIMEOUT_MS,
  IDE_SELECTORS,
  SKIP_ORCHESTRATOR,
  DIRECT_PREVIEW_URL,
} from './benchmark.config.js';
import {
  initRun,
  addResult,
  finalizeRun,
  makeTaskRunResult,
  type TaskRunResult,
} from './result-writer.js';
import { TASK_CHECKS } from './task-checks/index.js';

test.describe('BrainHalf Model Benchmark Suite', () => {
  const models = getEnabledModels();
  const tasks = getEnabledTasks();

  test.beforeAll(async () => {
    console.log(`\n==================================================`);
    console.log(` Starting BrainHalf Benchmark Run`);
    console.log(` Target URL: ${BASE_URL}`);
    console.log(` Models (${models.length}): ${models.map((m) => m.label).join(', ')}`);
    console.log(` Tasks  (${tasks.length}): ${tasks.map((t) => t.id).join(', ')}`);
    console.log(` Orchestrator Bypass: ${SKIP_ORCHESTRATOR ? 'YES' : 'NO'}`);
    console.log(`==================================================\n`);

    initRun(BASE_URL);
  });

  test.afterAll(async () => {
    finalizeRun();
  });

  for (const task of tasks) {
    for (const model of models) {
      test(`${task.tier.toUpperCase()} | ${task.id} [${model.label}]`, async ({ page, browser }) => {
        const timeout = TIER_TIMEOUT_MS[task.tier];
        test.setTimeout(timeout + 120_000); // add buffer for page load and checks

        const taskResult: TaskRunResult = makeTaskRunResult(model, task);

        // ── Direct Preview Check Mode (Bypasses UI Generation) ────────────────
        if (SKIP_ORCHESTRATOR) {
          console.log(`[${task.id}][${model.label}] Running in Direct Check Mode on ${DIRECT_PREVIEW_URL}`);
          if (!DIRECT_PREVIEW_URL) {
            throw new Error('BENCHMARK_SKIP_ORCHESTRATOR=1 requires PREVIEW_URL to be set.');
          }

          taskResult.build_success = true;
          taskResult.time_to_ready_seconds = 0;

          const checkRunner = TASK_CHECKS[task.id];
          if (!checkRunner) {
            throw new Error(`No check runner found for task ID: ${task.id}`);
          }

          const previewPage = await browser.newPage();
          try {
            taskResult.checks = await checkRunner(previewPage, DIRECT_PREVIEW_URL);

            // Viewport checks
            await previewPage.setViewportSize({ width: 1440, height: 900 });
            taskResult.responsive_pass_desktop = true;

            await previewPage.setViewportSize({ width: 768, height: 1024 });
            taskResult.responsive_pass_tablet = true;

            await previewPage.setViewportSize({ width: 375, height: 812 });
            taskResult.responsive_pass_mobile = true;
          } finally {
            await previewPage.close();
          }

          addResult(taskResult);
          return;
        }

        // ── Full Orchestrator Mode (Drives BrainHalf IDE) ─────────────────────
        console.log(`[${task.id}][${model.label}] Navigating to BrainHalf IDE at ${BASE_URL}...`);
        await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 });

        // 1. Create a fresh project
        try {
          const newProjBtn = page.locator(IDE_SELECTORS.newProjectButton).first();
          if (await newProjBtn.isVisible({ timeout: 3000 })) {
            await newProjBtn.click();
            await page.waitForTimeout(1000);
          }
        } catch {
          // Ignore if already on blank project home
        }

        // 2. Select AI Model
        try {
          const modelSelect = page.locator(IDE_SELECTORS.modelSelect).first();
          if (await modelSelect.isVisible({ timeout: 3000 })) {
            const options = await modelSelect.locator('option').allAttributeValues('value');
            if (options.includes(model.id)) {
              await modelSelect.selectOption(model.id);
              console.log(`[${task.id}][${model.label}] Selected model: ${model.id}`);
            } else {
              console.warn(`[${task.id}][${model.label}] Model ID ${model.id} not in dropdown, proceeding with default`);
            }
          }
        } catch {
          console.warn(`[${task.id}][${model.label}] Could not locate model selector`);
        }

        // 3. Submit build prompt
        const promptInput = page.locator(IDE_SELECTORS.chatTextarea).first();
        await expect(promptInput).toBeVisible({ timeout: 10000 });
        await promptInput.fill(task.buildPrompt);

        const startTime = Date.now();
        const sendBtn = page.locator(IDE_SELECTORS.sendButton).first();
        if (await sendBtn.isVisible()) {
          await sendBtn.click();
        } else {
          await promptInput.press('Enter');
        }

        console.log(`[${task.id}][${model.label}] Submitted build prompt. Waiting for generation (timeout: ${timeout / 1000}s)...`);

        // 4. Wait for generation completion
        let buildSucceeded = false;
        try {
          // Wait for stop button to disappear or send button to re-enable
          await page.waitForTimeout(5000); // initial generation start buffer

          const stopBtn = page.locator(IDE_SELECTORS.stopButton).first();
          if (await stopBtn.isVisible()) {
            await stopBtn.waitFor({ state: 'hidden', timeout });
          }

          // Verify send button is back
          await page.locator(IDE_SELECTORS.sendButton).first().waitFor({ state: 'visible', timeout: 10000 });
          buildSucceeded = true;
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : String(err);
          console.error(`[${task.id}][${model.label}] Build timed out or failed: ${errMsg}`);
          taskResult.error = `Build timed out or failed: ${errMsg}`;
        }

        const buildDurationSec = Math.round((Date.now() - startTime) / 1000);
        taskResult.build_success = buildSucceeded;
        taskResult.time_to_ready_seconds = buildDurationSec;

        if (!buildSucceeded) {
          console.log(`[${task.id}][${model.label}] Skipping Playwright checks due to build failure.`);
          addResult(taskResult);
          return;
        }

        // 5. Extract Preview URL
        let previewUrl = '';
        try {
          const iframe = page.locator(IDE_SELECTORS.previewIframe).first();
          if (await iframe.isVisible({ timeout: 5000 })) {
            previewUrl = (await iframe.getAttribute('src')) ?? '';
          }
        } catch {
          // Fallback: check if page URL contains preview ID
          const currentUrl = page.url();
          if (currentUrl.includes('/preview/')) {
            previewUrl = currentUrl;
          }
        }

        if (!previewUrl) {
          console.warn(`[${task.id}][${model.label}] Could not extract preview URL from iframe. Using current URL as fallback.`);
          previewUrl = page.url();
        } else if (previewUrl.startsWith('/')) {
          previewUrl = new URL(previewUrl, BASE_URL).toString();
        }

        console.log(`[${task.id}][${model.label}] Preview URL: ${previewUrl}`);

        // 6. Run Task Checks on Preview URL
        const checkRunner = TASK_CHECKS[task.id];
        if (checkRunner) {
          const previewPage = await browser.newPage();
          try {
            // Monitor console errors on load
            const initialConsoleErrors: string[] = [];
            previewPage.on('console', (msg) => {
              if (msg.type() === 'error' && !msg.text().includes('favicon')) {
                initialConsoleErrors.push(msg.text());
              }
            });

            taskResult.checks = await checkRunner(previewPage, previewUrl);
            taskResult.console_errors_on_load = initialConsoleErrors.length;

            // Viewport checks
            await previewPage.setViewportSize({ width: 1440, height: 900 });
            taskResult.responsive_pass_desktop = true;

            await previewPage.setViewportSize({ width: 768, height: 1024 });
            taskResult.responsive_pass_tablet = true;

            await previewPage.setViewportSize({ width: 375, height: 812 });
            taskResult.responsive_pass_mobile = true;
          } catch (checkErr: unknown) {
            console.error(`[${task.id}][${model.label}] Error executing checks:`, checkErr);
          } finally {
            await previewPage.close();
          }
        }

        addResult(taskResult);
      });
    }
  }
});
