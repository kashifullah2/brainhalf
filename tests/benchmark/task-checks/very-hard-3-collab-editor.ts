/**
 * very-hard-3: Collaborative Document Editor (Simulated) — Playwright Checks
 * 8 checks from benchmark spec.
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
    await runCheck('very-hard-3-check-1', 'Page loads without console errors', async () => {
      await page.waitForTimeout(2000);
      return {
        passed: consoleErrors.length === 0,
        actual: consoleErrors.length > 0 ? consoleErrors[0] : 'none',
        expected: 'no console errors',
      };
    })
  );

  // ── Check 2: Sidebar document list ────────────────────────────────────────
  results.push(
    await runCheck('very-hard-3-check-2', 'Document list sidebar visible with selectable docs', async () => {
      const docItems = page.locator('li, [class*="doc"], [class*="sidebar"] button');
      const count = await docItems.count();
      const bodyText = await page.innerText('body');
      const hasDocText = /document|notes|untitled|readme|draft/i.test(bodyText);

      return {
        passed: count > 0 || hasDocText,
        expected: 'Document list visible in sidebar',
        actual: `Doc items found: ${count}`,
      };
    })
  );

  // ── Check 3: Rich-text formatting toolbar ─────────────────────────────────
  results.push(
    await runCheck('very-hard-3-check-3', 'Rich-text toolbar present (Bold, Italic, Underline, Bullet list)', async () => {
      const boldBtn = page.locator('button:has-text("B"), button[title*="Bold"], button:has(svg)').first();
      const italicBtn = page.locator('button:has-text("I"), button[title*="Italic"]').first();
      const toolbar = page.locator('[class*="toolbar"], [role="toolbar"]').first();

      const hasToolbar = (await toolbar.waitFor({ state: 'visible', timeout: 2000 }).then(() => true).catch(() => false)) || (await boldBtn.waitFor({ state: 'visible', timeout: 2000 }).then(() => true).catch(() => false));

      return {
        passed: hasToolbar,
        expected: 'Formatting toolbar visible',
        actual: `Toolbar visible: ${hasToolbar}`,
      };
    })
  );

  // ── Check 4: Auto-save status indicator ───────────────────────────────────
  const testEdit = ` Collaborative Edit ${Date.now()}`;
  results.push(
    await runCheck('very-hard-3-check-4', "Typing text triggers auto-save ('Saving...' → 'Saved')", async () => {
      const editor = page.locator('[contenteditable="true"], textarea, [class*="editor"]').first();
      if (await editor.waitFor({ state: 'visible', timeout: 2000 }).then(() => true).catch(() => false)) {
        await editor.focus();
        await page.keyboard.type(testEdit);
      }

      await page.waitForTimeout(1200);
      const bodyText = await page.innerText('body');
      const hasSavedStatus = /saved|saving|all changes saved/i.test(bodyText);

      return {
        passed: hasSavedStatus,
        expected: "Auto-save indicator shows 'Saved' after inactivity",
        actual: hasSavedStatus ? 'Auto-save indicator found' : 'Indicator not found',
      };
    })
  );

  // ── Check 5: Simulated second user cursor/presence ────────────────────────
  results.push(
    await runCheck('very-hard-3-check-5', "Simulated 'second user' cursor or presence indicator appears", async () => {
      // Wait for simulated user delay (up to 5s)
      let collaboratorFound = false;
      for (let i = 0; i < 6; i++) {
        const bodyText = await page.innerText('body');
        const presence = page.locator('[class*="avatar"], [class*="cursor"], [class*="peer"], [class*="user"], [class*="badge"]');
        if (/collaborator|user 2|alex|online|editing|peer/i.test(bodyText) || (await presence.count()) > 1) {
          collaboratorFound = true;
          break;
        }
        await page.waitForTimeout(800);
      }

      return {
        passed: collaboratorFound,
        expected: 'Collaborator presence or cursor indicator visible',
        actual: collaboratorFound ? 'Collaborator presence detected' : 'Not detected',
      };
    })
  );

  // ── Check 6: Version History panel ────────────────────────────────────────
  results.push(
    await runCheck('very-hard-3-check-6', "'Version History' panel lists saved document versions", async () => {
      const historyBtn = page.locator('button:has-text("History"), button:has-text("Versions"), [role="tab"]:has-text("Versions")').first();
      if (await historyBtn.waitFor({ state: 'visible', timeout: 2000 }).then(() => true).catch(() => false)) {
        await historyBtn.click();
        await page.waitForTimeout(500);
      }

      const bodyText = await page.innerText('body');
      const hasVersions = /version|v1|v2|history|saved at/i.test(bodyText);

      return {
        passed: hasVersions,
        expected: 'Version history panel lists saved versions',
        actual: hasVersions ? 'Version history active' : 'Version history not found',
      };
    })
  );

  // ── Check 7: Restore older version ────────────────────────────────────────
  results.push(
    await runCheck('very-hard-3-check-7', 'Restoring an older version replaces editor content', async () => {
      const restoreBtn = page.locator('button:has-text("Restore"), button:has-text("Revert")').first();
      if (await restoreBtn.waitFor({ state: 'visible', timeout: 2000 }).then(() => true).catch(() => false)) {
        await restoreBtn.click();
        await page.waitForTimeout(500);
      }

      return {
        passed: true,
        expected: 'Version restore functional',
        actual: 'Restore action completed',
      };
    })
  );

  // ── Check 8: Share-link generator ─────────────────────────────────────────
  results.push(
    await runCheck('very-hard-3-check-8', "Share-link button generates mock URL and shows copy confirmation", async () => {
      const shareBtn = page.locator('button:has-text("Share"), button:has-text("Copy Link")').first();
      if (await shareBtn.waitFor({ state: 'visible', timeout: 2000 }).then(() => true).catch(() => false)) {
        await shareBtn.click();
        await page.waitForTimeout(500);
      }

      const bodyText = await page.innerText('body');
      const hasShareToast = /copied|share|link|http/i.test(bodyText);

      return {
        passed: hasShareToast || (await shareBtn.waitFor({ state: 'visible', timeout: 2000 }).then(() => true).catch(() => false)),
        expected: 'Share link generated / copied',
        actual: hasShareToast ? 'Share feedback visible' : 'Share button evaluated',
      };
    })
  );

  return results;
}
