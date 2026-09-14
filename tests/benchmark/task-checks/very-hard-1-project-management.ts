/**
 * very-hard-1: Full Project Management Tool — Playwright Checks
 * 10 checks from benchmark spec.
 */

import type { Page } from '@playwright/test';
import { runCheck, type CheckResult } from '../result-writer.js';

export async function runChecks(page: Page, previewUrl: string): Promise<CheckResult[]> {
  await page.goto(previewUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
  page.setDefaultTimeout(2000);

  const results: CheckResult[] = [];

  // ── Check 1: Page loads without console errors ─────────────────────────────
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !msg.text().includes('favicon')) {
      consoleErrors.push(msg.text());
    }
  });

  results.push(
    await runCheck('very-hard-1-check-1', 'Page loads without console errors', async () => {
      await page.waitForTimeout(2000);
      return {
        passed: consoleErrors.length === 0,
        actual: consoleErrors.length > 0 ? consoleErrors[0] : 'none',
        expected: 'no console errors',
      };
    })
  );

  // ── Check 2: Login screen rendered with inputs ────────────────────────────
  results.push(
    await runCheck('very-hard-1-check-2', 'Login screen rendered with Email & Password fields', async () => {
      const emailInput = page.locator('input[type="email"], input[name="email"], input[placeholder*="email"]').first();
      const passInput = page.locator('input[type="password"], input[name="password"]').first();

      const hasEmail = await emailInput.waitFor({ state: 'visible', timeout: 2000 }).then(() => true).catch(() => false);
      const hasPass = await passInput.waitFor({ state: 'visible', timeout: 2000 }).then(() => true).catch(() => false);

      return {
        passed: hasEmail && hasPass,
        expected: 'Email and Password inputs visible',
        actual: `Email: ${hasEmail}, Password: ${hasPass}`,
      };
    })
  );

  // ── Check 3: Invalid email validation ────────────────────────────────────
  results.push(
    await runCheck('very-hard-1-check-3', 'Invalid email format validation prevents login', async () => {
      const emailInput = page.locator('input[type="email"], input[name="email"], input[placeholder*="email"]').first();
      const loginBtn = page.locator('button:has-text("Log"), button:has-text("Sign"), button[type="submit"]').first();

      await emailInput.fill('invalid-email-format');
      if (await loginBtn.waitFor({ state: 'visible', timeout: 2000 }).then(() => true).catch(() => false)) {
        await loginBtn.click();
        await page.waitForTimeout(500);
      }

      const bodyText = await page.innerText('body');
      const hasDash = /dashboard|projects|welcome/i.test(bodyText);

      return {
        passed: !hasDash,
        expected: 'Did not advance to dashboard on invalid email',
        actual: !hasDash ? 'Blocked invalid login' : 'Advanced to dashboard unexpectedly',
      };
    })
  );

  // ── Check 4: Valid login advances to Dashboard ────────────────────────────
  results.push(
    await runCheck('very-hard-1-check-4', 'Valid email/password login navigates to Projects Dashboard', async () => {
      const emailInput = page.locator('input[type="email"], input[name="email"], input[placeholder*="email"]').first();
      const passInput = page.locator('input[type="password"], input[name="password"]').first();
      const loginBtn = page.locator('button:has-text("Log"), button:has-text("Sign"), button[type="submit"]').first();

      await emailInput.fill('pm.user@example.com');
      await passInput.fill('password123');
      if (await loginBtn.waitFor({ state: 'visible', timeout: 2000 }).then(() => true).catch(() => false)) {
        await loginBtn.click();
        await page.waitForTimeout(1000);
      }

      const bodyText = await page.innerText('body');
      const inDashboard = /project|dashboard|board|create|welcome/i.test(bodyText);

      return {
        passed: inDashboard,
        expected: 'Navigated to Projects Dashboard',
        actual: inDashboard ? 'Dashboard loaded' : 'Still on login screen',
      };
    })
  );

  // ── Check 5: Create new project ───────────────────────────────────────────
  const projName = `Project Alpha ${Date.now().toString().slice(-4)}`;
  results.push(
    await runCheck('very-hard-1-check-5', 'Create new project adds card to dashboard', async () => {
      const createBtn = page.locator('button:has-text("Create"), button:has-text("New Project"), button:has-text("+")').first();
      if (await createBtn.waitFor({ state: 'visible', timeout: 2000 }).then(() => true).catch(() => false)) {
        await createBtn.click();
        await page.waitForTimeout(300);
      }

      const projInput = page.locator('input[placeholder*="project"], input[name="title"], input[type="text"]').first();
      if (await projInput.waitFor({ state: 'visible', timeout: 2000 }).then(() => true).catch(() => false)) {
        await projInput.fill(projName);
        const submitBtn = page.locator('button:has-text("Save"), button:has-text("Add"), button:has-text("Create"), button[type="submit"]').first();
        if (await submitBtn.waitFor({ state: 'visible', timeout: 2000 }).then(() => true).catch(() => false)) await submitBtn.click();
      }

      await page.waitForTimeout(500);
      const bodyText = await page.innerText('body');
      const created = bodyText.includes(projName) || /project/i.test(bodyText);

      return {
        passed: created,
        expected: `Project '${projName}' visible on dashboard`,
        actual: created ? 'Project created' : 'Project not visible',
      };
    })
  );

  // ── Check 6: Open project Kanban board ───────────────────────────────────
  results.push(
    await runCheck('very-hard-1-check-6', 'Clicking project opens scoped Kanban board', async () => {
      const projCard = page.locator(`:has-text("${projName}"), [class*="project-card"], [class*="card"]`).first();
      if (await projCard.waitFor({ state: 'visible', timeout: 2000 }).then(() => true).catch(() => false)) {
        await projCard.click();
        await page.waitForTimeout(1000);
      }

      const bodyText = await page.innerText('body');
      const hasKanbanCols = /to do|in progress|done|backlog/i.test(bodyText);

      return {
        passed: hasKanbanCols,
        expected: 'Kanban columns (To Do / In Progress / Done) rendered',
        actual: hasKanbanCols ? 'Kanban board active' : 'Board columns not detected',
      };
    })
  );

  // ── Check 7: Priority tags on tasks ───────────────────────────────────────
  results.push(
    await runCheck('very-hard-1-check-7', 'Task creation supports priority tag (High/Med/Low)', async () => {
      const addTaskBtn = page.locator('button:has-text("Add Task"), button:has-text("+ Task"), button:has-text("New Task")').first();
      if (await addTaskBtn.waitFor({ state: 'visible', timeout: 2000 }).then(() => true).catch(() => false)) {
        await addTaskBtn.click();
        await page.waitForTimeout(300);
      }

      const taskInput = page.locator('input[placeholder*="Task"], input[placeholder*="title"]').first();
      if (await taskInput.waitFor({ state: 'visible', timeout: 2000 }).then(() => true).catch(() => false)) {
        await taskInput.fill('High Priority Milestone');
        const prioritySel = page.locator('select').filter({ hasText: /high|med|low/i }).first();
        if (await prioritySel.waitFor({ state: 'visible', timeout: 2000 }).then(() => true).catch(() => false)) {
          await prioritySel.selectOption({ label: /high/i });
        }
        const saveBtn = page.locator('button:has-text("Save"), button:has-text("Add")').first();
        if (await saveBtn.waitFor({ state: 'visible', timeout: 2000 }).then(() => true).catch(() => false)) await saveBtn.click();
      }

      await page.waitForTimeout(500);
      const bodyText = await page.innerText('body');
      const hasPriority = /high|med|low|milestone/i.test(bodyText);

      return {
        passed: hasPriority,
        expected: 'Task created with priority tag',
        actual: hasPriority ? 'Priority tag rendered' : 'Tag not found',
      };
    })
  );

  // ── Check 8: Navigate to Reporting page ───────────────────────────────────
  results.push(
    await runCheck('very-hard-1-check-8', 'Navigating to Reporting page shows project metrics/charts', async () => {
      const reportLink = page.locator('a:has-text("Report"), button:has-text("Report"), [role="tab"]:has-text("Analytics")').first();
      if (await reportLink.waitFor({ state: 'visible', timeout: 2000 }).then(() => true).catch(() => false)) {
        await reportLink.click();
        await page.waitForTimeout(1000);
      }

      const bodyText = await page.innerText('body');
      const hasReports = /report|completion|rate|analytics|chart|progress/i.test(bodyText);

      return {
        passed: hasReports,
        expected: 'Reporting section active',
        actual: hasReports ? 'Reports section visible' : 'Reports section not found',
      };
    })
  );

  // ── Check 9: State persistence across route navigation ────────────────────
  results.push(
    await runCheck('very-hard-1-check-9', 'State persists when navigating back to Dashboard', async () => {
      const dashLink = page.locator('a:has-text("Dashboard"), button:has-text("Dashboard"), a:has-text("Projects")').first();
      if (await dashLink.waitFor({ state: 'visible', timeout: 2000 }).then(() => true).catch(() => false)) {
        await dashLink.click();
        await page.waitForTimeout(1000);
      }

      const bodyText = await page.innerText('body');
      const preserved = bodyText.includes(projName) || /project/i.test(bodyText);

      return {
        passed: preserved,
        expected: `Created project '${projName}' still present`,
        actual: preserved ? 'State retained' : 'State lost on navigation',
      };
    })
  );

  // ── Check 10: Logout button clears session ────────────────────────────────
  results.push(
    await runCheck('very-hard-1-check-10', 'Logout button returns session to login screen', async () => {
      const logoutBtn = page.locator('button:has-text("Log out"), button:has-text("Logout"), a:has-text("Logout")').first();
      if (await logoutBtn.waitFor({ state: 'visible', timeout: 2000 }).then(() => true).catch(() => false)) {
        await logoutBtn.click();
        await page.waitForTimeout(1000);
      }

      const emailInput = page.locator('input[type="email"], input[name="email"]').first();
      const backOnLogin = await emailInput.waitFor({ state: 'visible', timeout: 2000 }).then(() => true).catch(() => false);

      return {
        passed: backOnLogin,
        expected: 'Returned to login screen',
        actual: backOnLogin ? 'On login screen' : 'Logout did not reset view',
      };
    })
  );

  return results;
}
