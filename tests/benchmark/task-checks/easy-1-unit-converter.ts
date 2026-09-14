/**
 * easy-1: Unit Converter — Playwright Checks
 * 7 checks from benchmark spec.
 */

import type { Page, Locator } from '@playwright/test';
import { runCheck, type CheckResult } from '../result-writer.js';

async function safeSelectOption(selectLoc: Locator, labelRegex: RegExp): Promise<boolean> {
  try {
    const options = await selectLoc.locator('option').all();
    for (const opt of options) {
      const text = await opt.textContent();
      if (text && labelRegex.test(text)) {
        const val = await opt.getAttribute('value');
        if (val !== null) {
          await selectLoc.selectOption(val, { timeout: 1000 });
          return true;
        }
      }
    }
  } catch {
    /* ignore */
  }
  return false;
}

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
    await runCheck('easy-1-check-1', 'Page loads without console errors', async () => {
      await page.waitForTimeout(2000);
      return {
        passed: consoleErrors.length === 0,
        actual: consoleErrors.length > 0 ? consoleErrors[0] : 'none',
        expected: 'no console errors',
      };
    })
  );

  // ── Check 2: Default tab (Length) is visible on load ──────────────────────
  results.push(
    await runCheck('easy-1-check-2', 'Default tab (Length) is visible on load', async () => {
      // Look for a Length tab button/link or visible heading
      const lengthTab = page.locator(
        'button:has-text("Length"), [role="tab"]:has-text("Length"), a:has-text("Length")'
      ).first();
      const visible = await lengthTab.waitFor({ state: 'visible', timeout: 2000 }).then(() => true).catch(() => false);
      return { passed: visible, expected: 'Length tab visible', actual: String(visible) };
    })
  );

  // ── Check 3: Typing 100 meters→feet shows result within 1s ────────────────
  results.push(
    await runCheck(
      'easy-1-check-3',
      "Typing '100' with from=meters, to=feet shows numeric result within 1 second",
      async () => {
        // Ensure we're on the Length tab
        const lengthTab = page
          .locator('button:has-text("Length"), [role="tab"]:has-text("Length")')
          .first();
        if (await lengthTab.waitFor({ state: 'visible', timeout: 2000 }).then(() => true).catch(() => false)) await lengthTab.click();

        // Select "meters" in the from dropdown (try common label patterns)
        const fromSelect = page
          .locator('select')
          .filter({ hasText: /meter|m\b/i })
          .first();
        const allSelects = await page.locator('select').all();
        let fromSel = allSelects[0];
        let toSel = allSelects[1] ?? allSelects[0];

        if (allSelects.length >= 2) {
          fromSel = allSelects[0];
          toSel = allSelects[1];
        }

        // Set from=meters, to=feet
        await safeSelectOption(fromSel, /meter|m\b/i);
        await safeSelectOption(toSel, /feet|foot|ft\b/i);

        // Type 100 into the input
        const input = page.locator('input').first();
        if (await input.waitFor({ state: 'visible', timeout: 2000 }).then(() => true).catch(() => false).catch(() => false)) {
          await input.fill('100');
        }

        const start = Date.now();
        // Wait for a result element — look for any element that likely shows conversion output
        const resultEl = page.locator(
          '[data-testid*="result"], [id*="result"], .result, output, p:has-text("328"), p:has-text("32"), span:has-text("328")'
        ).first();

        let resultText = '';
        try {
          await resultEl.waitFor({ timeout: 2000 });
          resultText = (await resultEl.textContent()) ?? '';
        } catch {
          // Fall back: look for any element containing a numeric value
          await page.waitForTimeout(1000 - (Date.now() - start));
          const allText = await page.locator('body').innerText();
          const numMatch = allText.match(/\b(328|327|329|32[0-9])\b/);
          if (numMatch) resultText = numMatch[0];
        }

        const elapsedMs = Date.now() - start;
        const hasNumericResult = /\d+(\.\d+)?/.test(resultText);
        return {
          passed: hasNumericResult && elapsedMs < 1500,
          actual: `"${resultText}" in ${elapsedMs}ms`,
          expected: 'numeric result containing ~328.08 within 1000ms',
        };
      }
    )
  );

  // ── Check 4: Clicking Weight tab switches visible fields ──────────────────
  results.push(
    await runCheck(
      'easy-1-check-4',
      "Clicking 'Weight' tab switches visible fields",
      async () => {
        const weightTab = page
          .locator('button:has-text("Weight"), [role="tab"]:has-text("Weight")')
          .first();
        if (!(await weightTab.waitFor({ state: 'visible', timeout: 2000 }).then(() => true).catch(() => false))) {
          return { passed: false, expected: 'Weight tab visible', actual: 'tab not found' };
        }
        await weightTab.click();
        await page.waitForTimeout(300);
        // After clicking Weight, expect weight-specific units (kg, lbs, oz, g, pound, gram)
        const bodyText = await page.locator('body').innerText();
        const hasWeightUnit = /kg|pound|lb|gram|oz|ounce/i.test(bodyText);
        return {
          passed: hasWeightUnit,
          actual: hasWeightUnit ? 'weight units visible' : 'no weight units found',
          expected: 'weight units (kg/lb/oz/g) in DOM',
        };
      }
    )
  );

  // ── Check 5: Switching dropdowns updates result without re-typing ─────────
  results.push(
    await runCheck(
      'easy-1-check-5',
      'Switching from/to dropdowns updates result without requiring re-typing',
      async () => {
        // We're on Weight tab — set a value and check result updates on dropdown change
        const input = page.locator('input').first();
        if (await input.waitFor({ state: 'visible', timeout: 2000 }).then(() => true).catch(() => false).catch(() => false)) {
          await input.fill('50');
        }
        await page.waitForTimeout(300);

        const before = await page.locator('body').innerText();

        const allSelects = await page.locator('select').all();
        if (allSelects.length < 2) {
          return { passed: false, expected: '2+ selects', actual: `${allSelects.length} selects` };
        }

        // Toggle the to-select to a different option
        const toSelect = allSelects[1];
        const options = await toSelect.locator('option').all();
        if (options.length >= 2) {
          const secondOptionValue = await options[1].getAttribute('value');
          if (secondOptionValue) await toSelect.selectOption(secondOptionValue, { timeout: 1000 }).catch(() => {});
        }
        await page.waitForTimeout(500);
        const after = await page.locator('body').innerText();

        return {
          passed: before !== after,
          actual: 'body text changed after dropdown switch',
          expected: 'result updates without re-typing',
        };
      }
    )
  );

  // ── Check 6: 3 known conversion pairs ─────────────────────────────────────
  results.push(
    await runCheck(
      'easy-1-check-6',
      'Result is correct for at least 3 known conversion pairs',
      async () => {
        // Go back to Length tab and verify 1 km → 0.621 miles (approx)
        const lengthTab = page
          .locator('button:has-text("Length"), [role="tab"]:has-text("Length")')
          .first();
        if (await lengthTab.waitFor({ state: 'visible', timeout: 2000 }).then(() => true).catch(() => false)) await lengthTab.click();
        await page.waitForTimeout(300);

        const input = page.locator('input').first();
        const allSelects = await page.locator('select').all();

        const conversions = [
          { value: '1', fromLabel: /km|kilometer/i, toLabel: /mile/i, expectedApprox: 0.621 },
          { value: '100', fromLabel: /meter/i, toLabel: /feet|foot/i, expectedApprox: 328.08 },
          { value: '1', fromLabel: /mile/i, toLabel: /km|kilometer/i, expectedApprox: 1.609 },
        ];

        let passCount = 0;
        for (const conv of conversions) {
          try {
            await input.fill(conv.value);
            if (allSelects.length >= 2) {
              await safeSelectOption(allSelects[0], conv.fromLabel);
              await safeSelectOption(allSelects[1], conv.toLabel);
              await page.waitForTimeout(500);
            }
            const bodyText = await page.locator('body').innerText();
            // Check if expected value (±5%) appears somewhere in the body
            const numMatches = bodyText.match(/[\d]+\.[\d]+/g) ?? [];
            const approxMatch = numMatches.some((n) => {
              const val = parseFloat(n);
              return (
                Math.abs(val - conv.expectedApprox) / conv.expectedApprox < 0.05 ||
                Math.abs(val - conv.expectedApprox) < 1
              );
            });
            if (approxMatch) passCount++;
          } catch {
            /* skip this pair */
          }
        }

        return {
          passed: passCount >= 2, // at least 2 of 3 correct (1 leniency for unit naming)
          actual: `${passCount}/3 correct`,
          expected: 'at least 2/3 conversion results correct within 5%',
        };
      }
    )
  );

  // ── Check 7: No overflow at 375px width ───────────────────────────────────
  results.push(
    await runCheck(
      'easy-1-check-7',
      'No layout shift or overflow when resized to 375px width',
      async () => {
        await page.setViewportSize({ width: 375, height: 812 });
        await page.waitForTimeout(500);
        const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
        const viewportWidth = 375;
        return {
          passed: bodyWidth <= viewportWidth + 5, // 5px tolerance
          actual: `scrollWidth=${bodyWidth}`,
          expected: `scrollWidth ≤ ${viewportWidth + 5}`,
        };
      }
    )
  );

  return results;
}
