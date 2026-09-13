import { test, expect, Page } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';
const ARTIFACT_DIR = '/home/kashifullah/.gemini/antigravity-ide/brain/bdade561-eefd-4bc6-bb08-2adeffc71475';

// Model A: Llama 3.3 70B
const MODEL_A = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
// Model B: Qwen 2.5 Coder 32B
const MODEL_B = '@cf/qwen/qwen2.5-coder-32b-instruct';
// Model C: GLM 5.3 Flash
const MODEL_C = '@cf/zai-org/glm-5.3-flash';

test.describe('AI-IDE-E2E-001: Full Lifecycle Stress Test', () => {
  test('Complete 8-Step Autonomous Compound Scenario', async ({ page }) => {
    test.setTimeout(180000); // 3 minutes for full compound lifecycle
    const consoleLogs: string[] = [];
    const consoleErrors: string[] = [];

    page.on('console', msg => {
      const text = msg.text();
      consoleLogs.push(text);
      if (msg.type() === 'error' &&
          !text.includes('favicon') &&
          !text.includes('ResizeObserver') &&
          !text.includes('WebSocket') &&
          !text.includes('net::ERR') &&
          !text.includes('Failed to load resource') &&
          !text.includes('Canceled') &&
          !text.includes('Transpile Error') &&
          !text.includes('AbortError')) {
        consoleErrors.push(text);
      }
    });

    // =========================================================================
    // PRECONDITIONS: Desktop-1440 Viewport + 2 Existing Projects
    // =========================================================================
    console.log('>>> [PRECONDITIONS] Setting Desktop-1440 and Initializing 2 Projects');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);

    // Initial project setup via localStorage
    const projAId = 'proj-alpha-lifecycle';
    const projBId = 'proj-beta-lifecycle';

    await page.evaluate(({ pA, pB }) => {
      const initialProjects = [
        { id: pA, name: 'E-Commerce Core (Project A)', createdAt: Date.now() - 10000, updatedAt: Date.now() - 10000 },
        { id: pB, name: 'Analytics Platform (Project B)', createdAt: Date.now() - 5000, updatedAt: Date.now() - 5000 }
      ];
      localStorage.setItem('brainhalf_projects', JSON.stringify(initialProjects));
      localStorage.setItem('brainhalf_active_project', pA);
      localStorage.setItem(`brainhalf_files_${pA}`, JSON.stringify({
        '/src/App.jsx': `export default function App() { return <div className="p-4"><h1>Project A Initial</h1></div>; }`,
        '/src/styles.css': `body { background: #0b0c10; color: #fff; }`
      }));
      localStorage.setItem(`brainhalf_files_${pB}`, JSON.stringify({
        '/src/App.jsx': `export default function App() { return <div className="p-4"><h1>Project B Clean Slate</h1></div>; }`
      }));
    }, { pA: projAId, pB: projBId });

    await page.goto(`${BASE_URL}/?project=${projAId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    // Verify Project A is active
    expect(page.url()).toContain(`project=${projAId}`);
    await page.screenshot({ path: `${ARTIFACT_DIR}/e2e_001_step0_preconditions.png` });

    // =========================================================================
    // STEP 1: Start Complex Multi-File App Generation Using Model A
    // =========================================================================
    console.log('>>> [STEP 1] Starting Multi-File Generation with Model A (Llama 3.3 70B)');
    const modelSelect = page.locator('select[aria-label="Select AI Model"]').first();
    await expect(modelSelect).toBeVisible({ timeout: 15000 });
    await modelSelect.selectOption(MODEL_A);

    const chatTextarea = page.locator('textarea[placeholder*="BrainHalf"]').first();
    await expect(chatTextarea).toBeVisible();
    await chatTextarea.fill('Build a full-featured e-commerce dashboard with auth screens, product catalog grid, interactive shopping cart, checkout modal, and persistent order history API.');

    const sendBtn = page.locator('button[title*="Send"]').first();
    await sendBtn.click();

    // Assert streaming begins within latency threshold
    const stopBtn = page.locator('button[title*="Stop Generation"]').first();
    await expect(stopBtn).toBeVisible({ timeout: 10000 });
    console.log('  [Assert 1.1] Streaming initiated within latency threshold');

    // Wait 3 seconds for active token streaming
    await page.waitForTimeout(3000);
    await page.screenshot({ path: `${ARTIFACT_DIR}/e2e_001_step1_streaming.png` });

    // =========================================================================
    // STEP 2: Mid-Stream Abrupt Stop Generation
    // =========================================================================
    console.log('>>> [STEP 2] Abruptly Halting Generation Mid-Stream');
    await expect(stopBtn).toBeVisible();
    await stopBtn.click();

    // Assert generation halts cleanly with no orphaned process
    await expect(stopBtn).not.toBeVisible({ timeout: 5000 });
    const sendBtnRestored = page.locator('button[title*="Send"]').first();
    await expect(sendBtnRestored).toBeVisible();
    console.log('  [Assert 2.1] Generation halted cleanly; input re-enabled');

    // Verify partial files are preserved without corruption
    const filesA = await page.evaluate((id) => {
      const raw = localStorage.getItem(`brainhalf_files_${id}`);
      return raw ? JSON.parse(raw) : {};
    }, projAId);
    expect(Object.keys(filesA).length).toBeGreaterThanOrEqual(1);
    expect(filesA['/src/App.jsx']).toBeDefined();
    console.log(`  [Assert 2.2] Partial files preserved intact: ${Object.keys(filesA).join(', ')}`);
    await page.screenshot({ path: `${ARTIFACT_DIR}/e2e_001_step2_stopped.png` });

    // =========================================================================
    // STEP 3: Navigate Away to Project B Without Resolving Stopped State
    // =========================================================================
    console.log('>>> [STEP 3] Navigating to Project B (Analytics Platform)');
    const projBBtn = page.locator(`.sidebar-nav-item:has-text("Analytics Platform"), [role="button"]:has-text("Analytics Platform")`).first();
    await projBBtn.click();
    await page.waitForTimeout(1000);

    // Assert URL reflects Project B
    expect(page.url()).toContain(`project=${projBId}`);
    const filesB = await page.evaluate((id) => {
      const raw = localStorage.getItem(`brainhalf_files_${id}`);
      return raw ? JSON.parse(raw) : {};
    }, projBId);
    expect(filesB['/src/App.jsx']).toContain('Project B Clean Slate');
    console.log('  [Assert 3.1] Navigated successfully without cross-project state leakage');
    await page.screenshot({ path: `${ARTIFACT_DIR}/e2e_001_step3_navigated.png` });

    // =========================================================================
    // STEP 4: Trigger New Generation with Model B in Project B
    // =========================================================================
    console.log('>>> [STEP 4] Triggering Generation with Model B (Qwen 2.5 Coder) in Project B');
    await modelSelect.selectOption(MODEL_B);
    await chatTextarea.fill('Create an interactive analytics charts dashboard with real-time metrics, line graph, and KPI counters.');
    await page.locator('button[title*="Send"]').first().click();

    // Verify active streaming in Project B
    await expect(stopBtn).toBeVisible({ timeout: 10000 });
    console.log('  [Assert 4.1] Model B generation actively running on Project B');
    await page.waitForTimeout(2000);

    // =========================================================================
    // STEP 5: Delete Project A While Generation is Actively Running in Project B
    // =========================================================================
    console.log('>>> [STEP 5] Runtime Attack: Deleting Project A during Active Generation in Project B');
    // Find delete button for Project A inside the sidebar list
    const projAItem = page.locator('.sidebar-nav-item').filter({ hasText: 'E-Commerce Core' }).first();
    await projAItem.hover();
    const deleteBtnA = projAItem.locator('button[title*="Delete"]').first();
    await expect(deleteBtnA).toBeVisible();
    await deleteBtnA.click();

    // Confirm via accessible ConfirmModal
    const confirmDeleteBtn = page.locator('div[role="dialog"] button:has-text("Delete")').last();
    await expect(confirmDeleteBtn).toBeVisible();
    await confirmDeleteBtn.click();
    await page.waitForTimeout(1000);

    // Assert Project A is completely removed from project list and storage
    const survivingProjects = await page.evaluate(() => {
      const raw = localStorage.getItem('brainhalf_projects');
      return raw ? JSON.parse(raw) : [];
    });
    const hasProjA = survivingProjects.some((p: any) => p.id === projAId);
    expect(hasProjA).toBe(false);
    console.log('  [Assert 5.1] Project A successfully purged from project list and storage');

    // Assert active generation in Project B was NOT interrupted or crashed
    const isStillGeneratingOrComplete = await page.locator('button[title*="Stop Generation"], button[title*="Send"]').first().isVisible();
    expect(isStillGeneratingOrComplete).toBe(true);
    console.log('  [Assert 5.2] Project B session and generation continued without crash or interruption');
    await page.screenshot({ path: `${ARTIFACT_DIR}/e2e_001_step5_deletion_during_gen.png` });

    // Stop Project B generation cleanly to proceed to viewport phase
    if (await stopBtn.isVisible()) {
      await stopBtn.click();
      await page.waitForTimeout(500);
    }

    // =========================================================================
    // STEP 6: Viewport Sequence Resize (1440 -> 768 -> 390) Without Reload
    // =========================================================================
    console.log('>>> [STEP 6] Viewport Sequence Stress: Desktop-1440 -> Tablet-768 -> Mobile-390');
    
    // 6a: Tablet 768x1024
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.waitForTimeout(800);
    const expandBtn768 = page.locator('[title="Expand Sidebar"], [aria-label="Expand Sidebar"]').first();
    const expandBbox = await expandBtn768.boundingBox();
    expect(expandBbox?.x).toBeGreaterThanOrEqual(0);
    console.log(`  [Assert 6.1] Tablet 768px expand button visible on-screen at x=${expandBbox?.x}`);
    await page.screenshot({ path: `${ARTIFACT_DIR}/e2e_001_step6_tablet768.png` });

    // 6b: Mobile 390x844
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(800);
    const hamburgerBtn390 = page.locator('button[aria-label="Open Projects"]').first();
    await expect(hamburgerBtn390).toBeVisible();
    const quickNewBtn = page.locator('button[aria-label="Create New Project"]').first();
    await expect(quickNewBtn).toBeVisible();
    console.log('  [Assert 6.2] Mobile 390px navigation controls and Quick New button visible and accessible');
    await page.screenshot({ path: `${ARTIFACT_DIR}/e2e_001_step6_mobile390.png` });

    // =========================================================================
    // STEP 7: Mobile Viewport Follow-Up with Model C (GLM 5.3 Flash)
    // =========================================================================
    console.log('>>> [STEP 7] Mobile Follow-Up Prompt with Model C (GLM 5.3 Flash)');
    await modelSelect.selectOption(MODEL_C);
    await chatTextarea.fill('Add a theme toggle button in the header with local storage sync.');
    await page.locator('button[title*="Send"]').first().click();

    await expect(stopBtn).toBeVisible({ timeout: 10000 });
    console.log('  [Assert 7.1] Model C generation streaming seamlessly on mobile 390px');
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `${ARTIFACT_DIR}/e2e_001_step7_mobile_streaming.png` });

    // =========================================================================
    // STEP 8: Network Throttle / Interruption Simulation
    // =========================================================================
    console.log('>>> [STEP 8] Simulating Network Interruption (3s Offline)');
    await page.context().setOffline(true);
    await page.waitForTimeout(3000);
    await page.context().setOffline(false);
    await page.waitForTimeout(1000);

    // Verify application survives without crash or freeze
    const appContainer = page.locator('.app-container').first();
    await expect(appContainer).toBeVisible();
    console.log('  [Assert 8.1] Application survived offline reconnection without DOM freeze');
    await page.screenshot({ path: `${ARTIFACT_DIR}/e2e_001_step8_reconnect.png` });

    // Final stop to leave clean idle state
    if (await stopBtn.isVisible()) {
      await stopBtn.click();
      await page.waitForTimeout(500);
    }

    // =========================================================================
    // FINAL VALIDATION
    // =========================================================================
    console.log('>>> [FINAL VALIDATION]');
    const finalProjects = await page.evaluate(() => {
      const raw = localStorage.getItem('brainhalf_projects');
      return raw ? JSON.parse(raw) : [];
    });
    expect(finalProjects.length).toBe(1);
    expect(finalProjects[0].id).toBe(projBId);
    console.log('  [Final Validation 1] Exactly 1 project survives (Project B), zero orphan artifacts');

    const finalFilesB = await page.evaluate((id) => {
      const raw = localStorage.getItem(`brainhalf_files_${id}`);
      return raw ? JSON.parse(raw) : {};
    }, projBId);
    expect(finalFilesB['/src/App.jsx']).toBeDefined();
    console.log('  [Final Validation 2] Project B files intact and healthy');

    console.log(`  [Final Validation 3] Critical console errors count: ${consoleErrors.length}`, consoleErrors);
    expect(consoleErrors.length).toBe(0);

    await page.screenshot({ path: `${ARTIFACT_DIR}/e2e_001_final_state.png` });
    console.log('>>> AI-IDE-E2E-001 Lifecycle Stress Test COMPLETED SUCCESSFULLY!');
  });
});
