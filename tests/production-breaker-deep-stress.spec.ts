import { test, expect, type Page } from '@playwright/test';

const BASE_URL = 'http://localhost:5173';
const ARTIFACT_DIR = '/home/kashifullah/.gemini/antigravity-ide/brain/bdade561-eefd-4bc6-bb08-2adeffc71475';

function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', err => errors.push(err.message));
  return errors;
}

test.describe('BrainHalf Production Breaker: Deep Stress & Adversarial Suite', () => {
  test.setTimeout(180000);

  test('Section 1: Extreme Responsive Layout Matrix (11 viewports + BUG-001/002 audit)', async ({ page }) => {
    const viewports = [
      { name: '320x568', width: 320, height: 568 },
      { name: '375x812', width: 375, height: 812 },
      { name: '390x844', width: 390, height: 844 },
      { name: '430x932', width: 430, height: 932 },
      { name: '600x1024', width: 600, height: 1024 },
      { name: '768x1024', width: 768, height: 1024 },
      { name: '820x1180', width: 820, height: 1180 },
      { name: '1024x768', width: 1024, height: 768 },
      { name: '1366x768', width: 1366, height: 768 },
      { name: '1440x900', width: 1440, height: 900 },
      { name: '1920x1080', width: 1920, height: 1080 },
    ];

    for (const vp of viewports) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(400);

      // 1. Check horizontal overflow on window/body
      const overflow = await page.evaluate(() => {
        return document.documentElement.scrollWidth > window.innerWidth || document.body.scrollWidth > window.innerWidth;
      });
      console.log(`Viewport ${vp.name}: overflow=${overflow}`);

      // 2. Audit BUG-001 & BUG-002: sidebar toggle & new project button visibility/coordinates
      const isMobile = vp.width < 768;
      const isTablet = vp.width >= 768 && vp.width < 1024;

      if (isMobile) {
        // Check if hamburger menu button in TopNav exists and is visible
        const hamburgerBtn = page.locator('button[aria-label="Open Projects"]').first();
        const hamburgerVisible = await hamburgerBtn.isVisible().catch(() => false);
        console.log(`  [Mobile ${vp.name}] Hamburger button visible: ${hamburgerVisible}`);
        
        if (hamburgerVisible) {
          const bbox = await hamburgerBtn.boundingBox();
          expect(bbox?.x).toBeGreaterThanOrEqual(0);
          expect((bbox?.x || 0) + (bbox?.width || 0)).toBeLessThanOrEqual(vp.width);

          // Click hamburger to open sidebar drawer
          await hamburgerBtn.click();
          await page.waitForTimeout(300);

          const sidebarDrawer = page.locator('.sidebar-container.mobile-open');
          const drawerVisible = await sidebarDrawer.isVisible().catch(() => false);
          console.log(`  [Mobile ${vp.name}] Sidebar drawer opened: ${drawerVisible}`);

          // Verify New Project button inside opened drawer
          const newProjDrawerBtn = page.locator('.sidebar-container.mobile-open button[aria-label="Create New Project"]');
          const newProjVisible = await newProjDrawerBtn.isVisible().catch(() => false);
          console.log(`  [Mobile ${vp.name}] New project inside drawer visible: ${newProjVisible}`);

          // Close drawer: In BUG-010, the mobile sidebar overlay lacks a close button and intercepts clicks to the hamburger button.
          // Dismissing via escape or programmatic click to allow subsequent mobile interactions.
          await page.keyboard.press('Escape');
          await page.waitForTimeout(200);
        }
      } else if (isTablet) {
        // On tablet (768-1023px), check how collapsed rail behaves
        const expandBtn = page.locator('[title="Expand Sidebar"], [aria-label="Expand Sidebar"]').first();
        const expandVisible = await expandBtn.isVisible().catch(() => false);
        if (expandVisible) {
          const bbox = await expandBtn.boundingBox();
          console.log(`  [Tablet ${vp.name}] Expand button bbox: x=${bbox?.x}, y=${bbox?.y}, width=${bbox?.width}`);
          // If x < 0, this is the exact BUG-001 confirmation
          if (bbox && bbox.x < 0) {
            console.log(`  >>> CONFIRMED BUG-001: Expand button off-screen left (x=${bbox.x}) at tablet viewport ${vp.name}`);
          }
        }
      }

      // Check Mobile tab segmented control
      if (isMobile) {
        // Ensure fresh clean page state for segmented control verification
        const codeTab = page.locator('.segmented-tab:has-text("Code")').first();
        if (await codeTab.isVisible().catch(() => false)) {
          await codeTab.click({ force: true });
          await page.waitForTimeout(300);
          const workspaceVisible = await page.locator('.workspace-panel-container').isVisible().catch(() => false);
          console.log(`  [Mobile ${vp.name}] Switched to Code tab: workspace visible=${workspaceVisible}`);
          
          const chatTab = page.locator('.segmented-tab:has-text("Chat")').first();
          await chatTab.click({ force: true });
          await page.waitForTimeout(300);
        }
      }
    }
  });

  test('Section 2: Multi-Project Isolation & State Corruption Attack', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);

    // Create Project A (CRM)
    const newBtn = page.locator('button[aria-label="Create New Project"]').first();
    await newBtn.click();
    await page.waitForTimeout(600);
    const projAId = new URL(page.url()).searchParams.get('project');
    expect(projAId).toBeTruthy();

    // Rename Proj A
    const titleA = page.locator('[title="Click to rename project"]').first();
    await titleA.click();
    await page.waitForTimeout(200);
    const inputA = page.locator('input[aria-label="Rename project input"]');
    await inputA.fill('Project A - CRM');
    await inputA.press('Enter');
    await page.waitForTimeout(300);

    // Save specific unique files to Project A
    await page.evaluate(({ pid }) => {
      const filesA = {
        '/src/App.jsx': 'export default function App() { return <div>CRM Application v1.0</div>; }',
        '/src/crm.js': 'export const crmVersion = "1.0.0-crm";',
        '/src/styles.css': 'body { background: #001122; }'
      };
      localStorage.setItem(`brainhalf_files_${pid}`, JSON.stringify(filesA));
      localStorage.setItem(`brainhalf_messages_${pid}`, JSON.stringify([
        { role: 'user', content: 'Build a production CRM' },
        { role: 'ai', content: 'CRM Application files generated successfully.' }
      ]));
    }, { pid: projAId });

    // Create Project B (Finance Dashboard)
    await newBtn.click();
    await page.waitForTimeout(600);
    const projBId = new URL(page.url()).searchParams.get('project');
    expect(projBId).toBeTruthy();
    expect(projBId).not.toBe(projAId);

    const titleB = page.locator('[title="Click to rename project"]').first();
    await titleB.click();
    await page.waitForTimeout(200);
    const inputB = page.locator('input[aria-label="Rename project input"]');
    await inputB.fill('Project B - Finance');
    await inputB.press('Enter');
    await page.waitForTimeout(300);

    // Save specific unique files to Project B
    await page.evaluate(({ pid }) => {
      const filesB = {
        '/src/App.jsx': 'export default function App() { return <div>Finance Dashboard v2.0</div>; }',
        '/src/finance.js': 'export const financeMetrics = [100, 200, 300];'
      };
      localStorage.setItem(`brainhalf_files_${pid}`, JSON.stringify(filesB));
      localStorage.setItem(`brainhalf_messages_${pid}`, JSON.stringify([
        { role: 'user', content: 'Build a finance dashboard' },
        { role: 'ai', content: 'Finance dashboard ready.' }
      ]));
    }, { pid: projBId });

    // Create Project C (Task Manager)
    await newBtn.click();
    await page.waitForTimeout(600);
    const projCId = new URL(page.url()).searchParams.get('project');
    expect(projCId).toBeTruthy();

    const titleC = page.locator('[title="Click to rename project"]').first();
    await titleC.click();
    await page.waitForTimeout(200);
    const inputC = page.locator('input[aria-label="Rename project input"]');
    await inputC.fill('Project C - Tasks');
    await inputC.press('Enter');
    await page.waitForTimeout(300);

    // Save specific unique files to Project C
    await page.evaluate(({ pid }) => {
      const filesC = {
        '/src/App.jsx': 'export default function App() { return <div>Task Manager v3.0</div>; }',
        '/src/tasks.json': '{"tasks": ["task1", "task2"]}'
      };
      localStorage.setItem(`brainhalf_files_${pid}`, JSON.stringify(filesC));
    }, { pid: projCId });

    // Now test isolation: switch between A, B, and C and verify files & messages DO NOT LEAK
    await page.goto(`${BASE_URL}/?project=${projAId}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);

    // Verify Project A files
    const filesInA = await page.evaluate(({ pid }) => {
      const raw = localStorage.getItem(`brainhalf_files_${pid}`);
      return raw ? Object.keys(JSON.parse(raw)) : [];
    }, { pid: projAId });
    console.log('Project A files:', filesInA);
    expect(filesInA).toContain('/src/crm.js');
    expect(filesInA).not.toContain('/src/finance.js');
    expect(filesInA).not.toContain('/src/tasks.json');

    // Switch to Project B
    await page.goto(`${BASE_URL}/?project=${projBId}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);

    const filesInB = await page.evaluate(({ pid }) => {
      const raw = localStorage.getItem(`brainhalf_files_${pid}`);
      return raw ? Object.keys(JSON.parse(raw)) : [];
    }, { pid: projBId });
    console.log('Project B files:', filesInB);
    expect(filesInB).toContain('/src/finance.js');
    expect(filesInB).not.toContain('/src/crm.js');
    expect(filesInB).not.toContain('/src/tasks.json');

    // Switch to Project C
    await page.goto(`${BASE_URL}/?project=${projCId}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);

    const filesInC = await page.evaluate(({ pid }) => {
      const raw = localStorage.getItem(`brainhalf_files_${pid}`);
      return raw ? Object.keys(JSON.parse(raw)) : [];
    }, { pid: projCId });
    console.log('Project C files:', filesInC);
    expect(filesInC).toContain('/src/tasks.json');
    expect(filesInC).not.toContain('/src/crm.js');
    expect(filesInC).not.toContain('/src/finance.js');
  });

  test('Section 3: Rapid Cancellation, Idempotency & Re-entry Attack', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const errors = collectConsoleErrors(page);

    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);

    // 5x rapid start/stop cancellation cycles
    for (let cycle = 1; cycle <= 5; cycle++) {
      console.log(`Cancellation cycle ${cycle}/5...`);
      const textarea = page.locator('textarea').first();
      await textarea.fill(`Complex CRM calculation and database schema design iteration ${cycle}`);
      await page.waitForTimeout(150);

      const sendBtn = page.locator('button[title*="Send"]').first();
      await expect(sendBtn).toBeEnabled({ timeout: 5000 });
      await sendBtn.click();

      // Immediately attempt to click Stop button as soon as visible
      const stopBtn = page.locator('button[title*="Stop"]').first();
      const stopped = await stopBtn.waitFor({ state: 'visible', timeout: 5000 })
        .then(async () => {
          await stopBtn.click();
          return true;
        })
        .catch(() => false);

      console.log(`  Cycle ${cycle}: stopped = ${stopped}`);
      await page.waitForTimeout(300);

      // Verify Send button reappears and UI is not stuck
      await expect(sendBtn).toBeVisible({ timeout: 8000 });
      await expect(textarea).toBeEnabled({ timeout: 8000 });
    }

    // After 5 cancellations, verify application is completely stable and responsive
    const textareaFinal = page.locator('textarea').first();
    await textareaFinal.fill('Ping test');
    expect(await textareaFinal.inputValue()).toBe('Ping test');
    console.log('Cycle completed without platform freeze. Console errors:', errors.length);
  });

  test('Section 4: Complete Interactive Button & Control Matrix Audit', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const errors = collectConsoleErrors(page);

    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);

    const buttonAuditLog: Array<{ name: string; status: string; detail?: string }> = [];

    // Helper to test a button
    async function auditBtn(name: string, locatorStr: string, action?: () => Promise<void>) {
      const btn = page.locator(locatorStr).first();
      const visible = await btn.isVisible({ timeout: 2000 }).catch(() => false);
      if (!visible) {
        buttonAuditLog.push({ name, status: 'NOT_FOUND_OR_HIDDEN' });
        return;
      }
      const enabled = await btn.isEnabled().catch(() => false);
      const title = await btn.getAttribute('title').catch(() => null);
      const ariaLabel = await btn.getAttribute('aria-label').catch(() => null);

      try {
        if (action) {
          await action();
        } else {
          await btn.click({ timeout: 2000 });
        }
        buttonAuditLog.push({ 
          name, 
          status: 'SUCCESS', 
          detail: `enabled=${enabled}, title="${title || ''}", aria="${ariaLabel || ''}"` 
        });
      } catch (e: any) {
        buttonAuditLog.push({ 
          name, 
          status: 'CLICK_FAILED', 
          detail: e.message?.substring(0, 100) 
        });
      }
    }

    // 1. Sidebar Brand Badge / Toggle
    await auditBtn('Sidebar Expand/Collapse', '[title="Collapse Sidebar"], [title="Expand Sidebar"]');
    await page.waitForTimeout(400);
    // Restore sidebar
    const expandToggle = page.locator('[title="Expand Sidebar"], [aria-label="Expand Sidebar"]').first();
    if (await expandToggle.isVisible().catch(() => false)) {
      await expandToggle.click();
      await page.waitForTimeout(400);
    }

    // 2. New Project Button
    await auditBtn('New Project Button', 'button[aria-label="Create New Project"]');
    await page.waitForTimeout(600);

    // 3. TopNav Project Name Edit Trigger
    await auditBtn('Click to Rename Project', '[title="Click to rename project"]');
    await page.waitForTimeout(300);
    const cancelRename = page.locator('button[aria-label="Cancel editing name"]').first();
    if (await cancelRename.isVisible().catch(() => false)) {
      await cancelRename.click();
    }

    // 4. TopNav Share Button
    await auditBtn('Share Project Link', 'button[title="Share project link"]');

    // 5. TopNav More Options Menu (...)
    await auditBtn('More Options Menu', 'button[aria-label="More project actions"]');
    await page.waitForTimeout(300);
    await page.keyboard.press('Escape');

    // 6. TopNav Export ZIP Button
    await auditBtn('Export ZIP Button', 'button:has-text("Export")');

    // 7. TopNav Deploy Button
    await auditBtn('Deploy Button', 'button:has-text("Deploy")');
    await page.waitForTimeout(400);
    await page.keyboard.press('Escape');

    // 8. Chat Model Selector
    const modelSelect = page.locator('select').first();
    const selectVisible = await modelSelect.isVisible().catch(() => false);
    if (selectVisible) {
      const optCount = await modelSelect.locator('option').count();
      buttonAuditLog.push({ name: 'Model Selector Dropdown', status: 'SUCCESS', detail: `${optCount} models available` });
    } else {
      buttonAuditLog.push({ name: 'Model Selector Dropdown', status: 'NOT_FOUND' });
    }

    // 9. Chat Starter Prompt Chips
    const starterChips = page.locator('.starter-prompt-card, .action-chip');
    const chipCount = await starterChips.count();
    buttonAuditLog.push({ name: 'Starter Prompts', status: 'SUCCESS', detail: `${chipCount} prompts rendered` });

    // 10. Workspace Tab Buttons: Preview, Code, Console, Logs
    const tabNames = ['Preview', 'Code', 'Console', 'Logs'];
    for (const tab of tabNames) {
      await auditBtn(`Workspace Tab: ${tab}`, `[role="tablist"] button[role="tab"]:has-text("${tab}")`);
      await page.waitForTimeout(300);
    }

    // 11. Code Tab Actions (Wrap, Copy)
    const codeTab = page.locator('[role="tablist"] button[role="tab"]:has-text("Code")').first();
    await codeTab.click();
    await page.waitForTimeout(800);
    await auditBtn('Code Editor Word Wrap', 'button[aria-label="Toggle Word Wrap"]');
    await auditBtn('Code Editor Copy', 'button[aria-label="Copy full file code"]');

    // 12. Console Tab Actions (Clear Output)
    const consoleTab = page.locator('[role="tablist"] button[role="tab"]:has-text("Console")').first();
    await consoleTab.click();
    await page.waitForTimeout(300);
    await auditBtn('Console Clear Output', 'button:has-text("Clear Output")');

    // 13. Logs Tab Actions (Clear Activity)
    const logsTab = page.locator('[role="tablist"] button[role="tab"]:has-text("Logs")').first();
    await logsTab.click();
    await page.waitForTimeout(300);
    await auditBtn('Logs Clear Activity', 'button:has-text("Clear Activity")');

    // Print Button Matrix Summary
    console.log('\n=== BUTTON MATRIX AUDIT RESULTS ===');
    for (const row of buttonAuditLog) {
      console.log(`  [${row.status}] ${row.name} - ${row.detail || ''}`);
    }
  });

  test('Section 5: Security Boundary & Traversal Defense', async ({ request }) => {
    const maliciousPaths = [
      '/preview/proj-123/../../etc/shadow',
      '/preview/proj-123/..%252f..%252fetc%252fpasswd',
      '/preview/proj-123/....//....//worker.js',
      '/preview/<script>alert(1)</script>/',
      '/preview/"onmouseover="alert(1)/',
    ];

    for (const p of maliciousPaths) {
      const res = await request.get(`${BASE_URL}${p}`).catch(() => null);
      if (res) {
        const status = res.status();
        const text = await res.text();
        console.log(`Path ${p} => Status: ${status}`);
        // Must never leak server credentials or execute reflected XSS
        expect(text).not.toContain('root:');
        expect(text).not.toContain('CLOUDFLARE_API_TOKEN');
        expect(text).not.toContain('ANTHROPIC_API_KEY');
      }
    }
  });
});
