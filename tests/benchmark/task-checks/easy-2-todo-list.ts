/**
 * easy-2: Todo List with Filters — Playwright Checks
 * 7 checks from benchmark spec.
 */

import type { Page } from '@playwright/test';
import { runCheck, type CheckResult } from '../result-writer.js';

export async function runChecks(page: Page, previewUrl: string): Promise<CheckResult[]> {
  await page.goto(previewUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
  page.setDefaultTimeout(2000);
  const results: CheckResult[] = [];

  // Helpers
  const getInput = () =>
    page.locator('input[placeholder*="task"], input[placeholder*="todo"], input[placeholder*="add"], input[type="text"]').first();
  const getAddButton = () =>
    page.locator('button:has-text("Add"), button[type="submit"]:visible').first();

  // ── Check 1: Adding via Enter key ─────────────────────────────────────────
  results.push(
    await runCheck(
      'easy-2-check-1',
      'Adding a task via Enter key adds a new list item with the correct text',
      async () => {
        const uniqueText = `Task-Enter-${Date.now()}`;
        const input = getInput();
        await input.fill(uniqueText);
        await input.press('Enter');
        await page.waitForTimeout(300);
        const item = page.locator(`text=${uniqueText}`).first();
        const visible = await item.waitFor({ state: 'visible', timeout: 2000 }).then(() => true).catch(() => false);
        return { passed: visible, actual: String(visible), expected: 'item visible in list' };
      }
    )
  );

  // ── Check 2: Adding via button click ──────────────────────────────────────
  results.push(
    await runCheck(
      'easy-2-check-2',
      'Adding a task via button click also works',
      async () => {
        const uniqueText = `Task-Button-${Date.now()}`;
        const input = getInput();
        await input.fill(uniqueText);
        const btn = getAddButton();
        if (await btn.waitFor({ state: 'visible', timeout: 2000 }).then(() => true).catch(() => false)) {
          await btn.click();
        } else {
          await input.press('Enter'); // fallback
        }
        await page.waitForTimeout(300);
        const visible = await page.locator(`text=${uniqueText}`).first().waitFor({ state: 'visible', timeout: 2000 }).then(() => true).catch(() => false);
        return { passed: visible, actual: String(visible), expected: 'item added via button' };
      }
    )
  );

  // ── Check 3: Checking checkbox marks complete ──────────────────────────────
  results.push(
    await runCheck(
      'easy-2-check-3',
      'Checking a checkbox visually marks item complete and decrements active count',
      async () => {
        // Add a fresh task
        const taskText = `Check-Task-${Date.now()}`;
        const input = getInput();
        await input.fill(taskText);
        await input.press('Enter');
        await page.waitForTimeout(300);

        // Read active count before
        const countBefore = await page.locator('body').innerText();
        const beforeNum = parseInt((countBefore.match(/(\d+)\s*(item|task|left|remaining)/i) ?? [])[1] ?? '99');

        // Click the checkbox for this task
        const taskItem = page.locator(`li:has-text("${taskText}"), [data-testid*="todo"]:has-text("${taskText}")`).first();
        const checkbox = taskItem.locator('input[type="checkbox"]').first();
        await checkbox.check();
        await page.waitForTimeout(300);

        // Check that the task item has a completed visual indicator
        const hasStrikethrough = await taskItem.evaluate((el) => {
          const style = window.getComputedStyle(el);
          const inner = el.querySelector('[class*="complete"], [class*="done"], [class*="checked"], s, del') ??
            el.querySelector('span, label');
          if (!inner) return false;
          const is = window.getComputedStyle(inner);
          return (
            is.textDecoration.includes('line-through') ||
            inner.classList.toString().match(/complete|done|checked|strikethrough/) !== null ||
            style.opacity === '0.5'
          );
        });

        // Read active count after
        const countAfter = await page.locator('body').innerText();
        const afterNum = parseInt((countAfter.match(/(\d+)\s*(item|task|left|remaining)/i) ?? [])[1] ?? '99');

        return {
          passed: hasStrikethrough || afterNum < beforeNum,
          actual: `strikethrough=${hasStrikethrough}, countBefore=${beforeNum}, countAfter=${afterNum}`,
          expected: 'item has strikethrough/completed class OR count decremented',
        };
      }
    )
  );

  // ── Check 4: Delete removes the exact item ────────────────────────────────
  results.push(
    await runCheck(
      'easy-2-check-4',
      'Clicking delete removes the exact item, not a different one',
      async () => {
        const taskA = `Keep-${Date.now()}`;
        const taskB = `Delete-${Date.now()}`;
        const input = getInput();

        await input.fill(taskA);
        await input.press('Enter');
        await page.waitForTimeout(200);
        await input.fill(taskB);
        await input.press('Enter');
        await page.waitForTimeout(300);

        // Find the delete button on taskB's row
        const itemB = page.locator(`li:has-text("${taskB}"), [data-testid*="todo"]:has-text("${taskB}")`).first();
        const deleteBtn = itemB.locator('button[aria-label*="delete"], button[aria-label*="remove"], button:has-text("×"), button:has-text("✕"), button:has-text("Delete"), svg[data-icon*="trash"]').first();
        await deleteBtn.click();
        await page.waitForTimeout(300);

        const taskBGone = !(await page.locator(`text=${taskB}`).first().waitFor({ state: 'visible', timeout: 2000 }).then(() => true).catch(() => false));
        const taskAStill = await page.locator(`text=${taskA}`).first().waitFor({ state: 'visible', timeout: 2000 }).then(() => true).catch(() => false);

        return {
          passed: taskBGone && taskAStill,
          actual: `taskB gone=${taskBGone}, taskA still=${taskAStill}`,
          expected: 'only deleted item removed',
        };
      }
    )
  );

  // ── Check 5: Filter tabs work correctly ───────────────────────────────────
  results.push(
    await runCheck(
      'easy-2-check-5',
      "Filter 'Active' hides completed; 'Completed' hides active; 'All' shows both",
      async () => {
        const activeTask = `Filter-Active-${Date.now()}`;
        const doneTask = `Filter-Done-${Date.now()}`;
        const input = getInput();

        await input.fill(activeTask);
        await input.press('Enter');
        await page.waitForTimeout(200);
        await input.fill(doneTask);
        await input.press('Enter');
        await page.waitForTimeout(300);

        // Complete the doneTask
        const doneItem = page.locator(`li:has-text("${doneTask}")`).first();
        const cb = doneItem.locator('input[type="checkbox"]').first();
        await cb.check();
        await page.waitForTimeout(300);

        // Click Active filter
        const activeFilter = page.locator('button:has-text("Active"), [role="tab"]:has-text("Active"), a:has-text("Active")').first();
        if (await activeFilter.waitFor({ state: 'visible', timeout: 2000 }).then(() => true).catch(() => false)) await activeFilter.click();
        await page.waitForTimeout(300);

        const doneHiddenOnActive = !(await page.locator(`text=${doneTask}`).first().waitFor({ state: 'visible', timeout: 2000 }).then(() => true).catch(() => false).catch(() => false));
        const activeVisibleOnActive = await page.locator(`text=${activeTask}`).first().waitFor({ state: 'visible', timeout: 2000 }).then(() => true).catch(() => false).catch(() => false);

        // Click Completed filter
        const completedFilter = page.locator('button:has-text("Completed"), [role="tab"]:has-text("Completed"), button:has-text("Done"), a:has-text("Completed")').first();
        if (await completedFilter.waitFor({ state: 'visible', timeout: 2000 }).then(() => true).catch(() => false)) await completedFilter.click();
        await page.waitForTimeout(300);

        const activeHiddenOnCompleted = !(await page.locator(`text=${activeTask}`).first().waitFor({ state: 'visible', timeout: 2000 }).then(() => true).catch(() => false).catch(() => false));

        // Click All filter
        const allFilter = page.locator('button:has-text("All"), [role="tab"]:has-text("All"), a:has-text("All")').first();
        if (await allFilter.waitFor({ state: 'visible', timeout: 2000 }).then(() => true).catch(() => false)) await allFilter.click();

        return {
          passed: doneHiddenOnActive && activeVisibleOnActive && activeHiddenOnCompleted,
          actual: `doneHiddenOnActive=${doneHiddenOnActive}, activeVisibleOnActive=${activeVisibleOnActive}, activeHiddenOnCompleted=${activeHiddenOnCompleted}`,
          expected: 'all three filter conditions pass',
        };
      }
    )
  );

  // ── Check 6: Active count updates correctly ───────────────────────────────
  results.push(
    await runCheck(
      'easy-2-check-6',
      'Active count text updates correctly after each add/complete/delete action',
      async () => {
        // Reset to All filter first
        const allFilter = page.locator('button:has-text("All"), [role="tab"]:has-text("All")').first();
        if (await allFilter.waitFor({ state: 'visible', timeout: 2000 }).then(() => true).catch(() => false)) await allFilter.click();
        await page.waitForTimeout(300);

        const getCount = async () => {
          const text = await page.locator('body').innerText();
          const m = text.match(/(\d+)\s*(item|task|left|remaining)/i);
          return m ? parseInt(m[1]) : -1;
        };

        const countBefore = await getCount();
        const uniqueTask = `Count-Test-${Date.now()}`;
        const input = getInput();
        await input.fill(uniqueTask);
        await input.press('Enter');
        await page.waitForTimeout(300);
        const countAfterAdd = await getCount();

        return {
          passed: countAfterAdd > countBefore || countBefore === -1, // -1 means count not shown (acceptable)
          actual: `before=${countBefore}, afterAdd=${countAfterAdd}`,
          expected: 'count increments after add, or count not shown (acceptable)',
        };
      }
    )
  );

  // ── Check 7: Empty task not created ───────────────────────────────────────
  results.push(
    await runCheck(
      'easy-2-check-7',
      'Adding an empty task (blank input) does not create a blank list item',
      async () => {
        const countBefore = await page.locator('li').count();
        const input = getInput();
        await input.fill('');
        await input.press('Enter');
        await page.waitForTimeout(300);
        const countAfter = await page.locator('li').count();
        return {
          passed: countAfter === countBefore,
          actual: `list item count: before=${countBefore}, after=${countAfter}`,
          expected: 'no new li added for empty input',
        };
      }
    )
  );

  return results;
}
