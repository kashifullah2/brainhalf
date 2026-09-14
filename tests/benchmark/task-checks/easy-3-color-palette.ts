/**
 * easy-3: Color Palette Generator — Playwright Checks
 * 5 checks from benchmark spec.
 */

import type { Page } from '@playwright/test';
import { runCheck, type CheckResult } from '../result-writer.js';

const HEX_REGEX = /^#[0-9A-Fa-f]{6}$/;

export async function runChecks(page: Page, previewUrl: string): Promise<CheckResult[]> {
  await page.goto(previewUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
  page.setDefaultTimeout(2000);
  const results: CheckResult[] = [];

  /** Collect all hex strings visible in the DOM */
  async function getVisibleHexCodes(): Promise<string[]> {
    const bodyText = await page.locator('body').innerText();
    return (bodyText.match(/#[0-9A-Fa-f]{6}\b/g) ?? []).filter(
      (v, i, arr) => arr.indexOf(v) === i
    );
  }

  // ── Check 1: 5 swatches render on load ────────────────────────────────────
  results.push(
    await runCheck(
      'easy-3-check-1',
      '5 distinct swatches render on initial load',
      async () => {
        await page.waitForTimeout(1000);
        const hexCodes = await getVisibleHexCodes();
        // Also count swatch DOM elements (divs with background-color, or .swatch class)
        const swatchCount = await page.evaluate(() => {
          const swatches = [
            ...document.querySelectorAll(
              '[class*="swatch"], [class*="color"], [class*="palette"] > div, [class*="palette"] > button'
            ),
          ].filter((el) => {
            const bg = window.getComputedStyle(el).backgroundColor;
            return bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent';
          });
          return swatches.length;
        });

        const passed = hexCodes.length >= 5 || swatchCount >= 5;
        return {
          passed,
          actual: `hexCodes=${hexCodes.length}, swatchElements=${swatchCount}`,
          expected: 'at least 5 hex codes or swatch elements',
        };
      }
    )
  );

  // ── Check 2: Generate button changes at least 4/5 values ─────────────────
  results.push(
    await runCheck(
      'easy-3-check-2',
      "Clicking 'Generate' changes at least 4 of 5 hex values",
      async () => {
        const before = await getVisibleHexCodes();
        const generateBtn = page
          .locator(
            'button:has-text("Generate"), button:has-text("Randomize"), button:has-text("New"), button:has-text("Refresh")'
          )
          .first();
        if (!(await generateBtn.waitFor({ state: 'visible', timeout: 2000 }).then(() => true).catch(() => false))) {
          return { passed: false, expected: 'Generate button visible', actual: 'not found' };
        }
        await generateBtn.click();
        await page.waitForTimeout(500);
        const after = await getVisibleHexCodes();

        const changed = before.filter((hex) => !after.includes(hex)).length;
        const atLeast4 = changed >= 4;

        return {
          passed: atLeast4,
          actual: `${changed} hex values changed`,
          expected: 'at least 4 of 5 changed',
        };
      }
    )
  );

  // ── Check 3: Clicking swatch shows copy confirmation ─────────────────────
  results.push(
    await runCheck(
      'easy-3-check-3',
      'Clicking a swatch triggers a visible copy-confirmation UI element',
      async () => {
        // Intercept clipboard writes to avoid permission errors in headless mode
        await page.evaluate(() => {
          (window as any).__clipboardText = '';
          Object.defineProperty(navigator, 'clipboard', {
            value: {
              writeText: (text: string) => {
                (window as any).__clipboardText = text;
                return Promise.resolve();
              },
            },
            writable: true,
          });
        });

        // Click a swatch
        const swatch = page
          .locator(
            '[class*="swatch"]:visible, [class*="color-card"]:visible, [class*="palette"] > div:visible, [class*="palette"] > button:visible'
          )
          .first();
        if (!(await swatch.waitFor({ state: 'visible', timeout: 2000 }).then(() => true).catch(() => false))) {
          return { passed: false, expected: 'swatch visible', actual: 'no swatch found' };
        }
        await swatch.click();
        await page.waitForTimeout(1000);

        // Look for toast/confirmation element
        const toastVisible = await page
          .locator(
            'text=/copied|Copied|copy success/i, [class*="toast"], [class*="notification"], [class*="copied"], [role="alert"]'
          )
          .first()
          .waitFor({ state: 'visible', timeout: 2000 }).then(() => true).catch(() => false)
          .catch(() => false);

        const clipboardSet =
          (await page.evaluate(() => (window as any).__clipboardText || '').catch(() => '')) !== '';

        return {
          passed: toastVisible || clipboardSet,
          actual: `toastVisible=${toastVisible}, clipboardSet=${clipboardSet}`,
          expected: 'toast/confirmation visible OR clipboard written',
        };
      }
    )
  );

  // ── Check 4: Hex codes match valid format ─────────────────────────────────
  results.push(
    await runCheck(
      'easy-3-check-4',
      'Hex codes displayed match valid format ^#[0-9A-Fa-f]{6}$',
      async () => {
        const hexCodes = await getVisibleHexCodes();
        const allValid = hexCodes.every((h) => HEX_REGEX.test(h));
        const invalid = hexCodes.filter((h) => !HEX_REGEX.test(h));
        return {
          passed: hexCodes.length >= 5 && allValid,
          actual: invalid.length > 0 ? `invalid: ${invalid.join(', ')}` : `all ${hexCodes.length} valid`,
          expected: 'all 5+ hex codes match #[0-9A-Fa-f]{6}',
        };
      }
    )
  );

  // ── Check 5: No duplicate swatches in a single generation (soft) ──────────
  results.push(
    await runCheck(
      'easy-3-check-5',
      'No duplicate swatches in a single generation (soft check)',
      async () => {
        // Generate fresh set
        const generateBtn = page
          .locator('button:has-text("Generate"), button:has-text("Randomize"), button:has-text("New")')
          .first();
        if (await generateBtn.waitFor({ state: 'visible', timeout: 2000 }).then(() => true).catch(() => false)) await generateBtn.click();
        await page.waitForTimeout(500);

        const hexCodes = await getVisibleHexCodes();
        const unique = new Set(hexCodes);
        const hasDuplicates = unique.size < hexCodes.length;

        return {
          // Soft check — we pass if there are no exact duplicates, but we don't hard-fail since
          // random generation can occasionally produce a duplicate legitimately.
          passed: !hasDuplicates,
          actual: `${hexCodes.length} codes, ${unique.size} unique`,
          expected: 'no exact duplicates in a single generation',
        };
      }
    )
  );

  return results;
}
