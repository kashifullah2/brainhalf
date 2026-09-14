/**
 * hard-1: Analytics Dashboard with Charts — Playwright Checks
 * 7 checks from benchmark spec.
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
    await runCheck('hard-1-check-1', 'Page loads without console errors', async () => {
      await page.waitForTimeout(2000);
      return {
        passed: consoleErrors.length === 0,
        actual: consoleErrors.length > 0 ? consoleErrors[0] : 'none',
        expected: 'no console errors',
      };
    })
  );

  // ── Check 2: 4 KPI cards visible ──────────────────────────────────────────
  results.push(
    await runCheck('hard-1-check-2', '4 KPI cards visible (Revenue, Orders, Avg Order Value, Conversion Rate)', async () => {
      const pageText = await page.innerText('body');
      const hasRev = /revenue/i.test(pageText);
      const hasOrders = /orders/i.test(pageText);
      const hasAvg = /avg|average|order value/i.test(pageText);
      const hasConv = /conversion/i.test(pageText);

      const passed = hasRev && hasOrders && hasAvg && hasConv;
      return {
        passed,
        expected: 'All 4 KPI metrics present in text',
        actual: `rev:${hasRev}, orders:${hasOrders}, avg:${hasAvg}, conv:${hasConv}`,
      };
    })
  );

  // ── Check 3: Date range selector visible ──────────────────────────────────
  results.push(
    await runCheck('hard-1-check-3', 'Date-range selector present (7, 30, 90 days options)', async () => {
      const selector = page.locator(
        'select, button:has-text("7"), button:has-text("30"), button:has-text("90"), [role="tab"]:has-text("7")'
      ).first();
      const visible = await selector.waitFor({ state: 'visible', timeout: 2000 }).then(() => true).catch(() => false);
      const pageText = await page.innerText('body');
      const textMatch = /7\s*days|30\s*days|90\s*days/i.test(pageText);

      return {
        passed: visible || textMatch,
        expected: 'Date range controls visible',
        actual: String(visible || textMatch),
      };
    })
  );

  // ── Check 4: Changing date range updates KPI values ───────────────────────
  results.push(
    await runCheck('hard-1-check-4', 'Changing date range recomputes KPI values', async () => {
      const bodyInitial = await page.innerText('body');
      
      // Try selecting 30 days or 90 days
      const selectEl = page.locator('select').first();
      const option30 = page.locator('button:has-text("30"), [role="tab"]:has-text("30")').first();

      if (await selectEl.waitFor({ state: 'visible', timeout: 2000 }).then(() => true).catch(() => false)) {
        const options = await selectEl.locator('option').allInnerTexts();
        const targetOpt = options.find((o) => /30|90/i.test(o)) || options[1];
        if (targetOpt) {
          await selectEl.selectOption({ label: targetOpt });
        }
      } else if (await option30.waitFor({ state: 'visible', timeout: 2000 }).then(() => true).catch(() => false)) {
        await option30.click();
      }

      await page.waitForTimeout(1000);
      const bodyUpdated = await page.innerText('body');

      const changed = bodyInitial !== bodyUpdated;
      return {
        passed: changed,
        expected: 'KPI values change on date range switch',
        actual: changed ? 'Values updated' : 'No change detected',
      };
    })
  );

  // ── Check 5: Chart elements visible ───────────────────────────────────────
  results.push(
    await runCheck('hard-1-check-5', 'Line chart and Bar chart elements rendered', async () => {
      // SVG, Canvas, or chart container classes
      const chartElements = page.locator('svg, canvas, .recharts-wrapper, .chart-container, [class*="chart"]');
      const count = await chartElements.count();
      const isVis = count > 0;

      return {
        passed: isVis,
        expected: 'At least 1 chart element (svg/canvas/container) rendered',
        actual: `Found ${count} chart elements`,
      };
    })
  );

  // ── Check 6: CSV Export button present ────────────────────────────────────
  results.push(
    await runCheck('hard-1-check-6', 'CSV Export button present and clickable', async () => {
      const csvBtn = page.locator('button:has-text("CSV"), button:has-text("Export"), a:has-text("CSV")').first();
      const visible = await csvBtn.waitFor({ state: 'visible', timeout: 2000 }).then(() => true).catch(() => false);
      if (visible) {
        await csvBtn.click();
      }
      return {
        passed: visible,
        expected: 'CSV export button visible',
        actual: String(visible),
      };
    })
  );

  // ── Check 7: Layout integrity after switching date range back ─────────────
  results.push(
    await runCheck('hard-1-check-7', 'Charts and metrics remain populated after range toggle', async () => {
      const selectEl = page.locator('select').first();
      const option7 = page.locator('button:has-text("7"), [role="tab"]:has-text("7")').first();

      if (await selectEl.waitFor({ state: 'visible', timeout: 2000 }).then(() => true).catch(() => false)) {
        await selectEl.selectOption({ index: 0 });
      } else if (await option7.waitFor({ state: 'visible', timeout: 2000 }).then(() => true).catch(() => false)) {
        await option7.click();
      }

      await page.waitForTimeout(1000);
      const chartElements = page.locator('svg, canvas, .recharts-wrapper, .chart-container, [class*="chart"]');
      const count = await chartElements.count();

      return {
        passed: count > 0,
        expected: 'Charts still present after toggle',
        actual: `Found ${count} chart elements`,
      };
    })
  );

  return results;
}
