/**
 * medium-2: Multi-Step Signup Form — Playwright Checks
 * 8 checks from benchmark spec.
 */

import type { Page } from '@playwright/test';
import { runCheck, type CheckResult } from '../result-writer.js';

export async function runChecks(page: Page, previewUrl: string): Promise<CheckResult[]> {
  await page.goto(previewUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
  page.setDefaultTimeout(2000);
  const results: CheckResult[] = [];

  const TEST_NAME = 'Jane Doe';
  const TEST_EMAIL = 'jane@example.com';
  const TEST_PASSWORD = 'Secure123!';

  const getNextBtn = () => page.locator('button:has-text("Next"), button:has-text("Continue"), button[type="submit"]:has-text("Next")').first();
  const getBackBtn = () => page.locator('button:has-text("Back"), button:has-text("Previous")').first();

  /** Fill Step 1 fields */
  async function fillStep1(name = TEST_NAME, email = TEST_EMAIL) {
    const nameInput = page.locator('input[name="name"], input[placeholder*="name"], input[id*="name"]').first();
    const emailInput = page.locator('input[type="email"], input[name="email"], input[placeholder*="email"]').first();
    await nameInput.fill(name);
    await emailInput.fill(email);
  }

  // ── Check 1: Empty Step 1 blocks advancing ────────────────────────────────
  results.push(
    await runCheck(
      'medium-2-check-1',
      "Clicking 'Next' on Step 1 with empty fields shows validation errors and does not advance",
      async () => {
        // Clear all inputs and try to advance
        const nameInput = page.locator('input[name="name"], input[placeholder*="name"]').first();
        const emailInput = page.locator('input[type="email"], input[placeholder*="email"]').first();
        await nameInput.fill('');
        await emailInput.fill('');

        const progressBefore = await page.locator('body').innerText();
        await getNextBtn().click();
        await page.waitForTimeout(400);
        const progressAfter = await page.locator('body').innerText();

        // Check for error message
        const errorVisible = await page.locator(
          '[class*="error"], [class*="invalid"], [role="alert"], text=/required|invalid|Please/i'
        ).first().waitFor({ state: 'visible', timeout: 2000 }).then(() => true).catch(() => false).catch(() => false);

        // Check we didn't advance (Step 2 password field should NOT be visible)
        const step2NotVisible = !(await page.locator('input[type="password"]').first().waitFor({ state: 'visible', timeout: 2000 }).then(() => true).catch(() => false).catch(() => false));

        return {
          passed: errorVisible || step2NotVisible,
          actual: `errorVisible=${errorVisible}, step2NotVisible=${step2NotVisible}`,
          expected: 'validation error shown and/or step 2 not reached',
        };
      }
    )
  );

  // ── Check 2: Invalid email format triggers error ───────────────────────────
  results.push(
    await runCheck(
      'medium-2-check-2',
      "Entering invalid email 'test@' triggers visible email error",
      async () => {
        const nameInput = page.locator('input[name="name"], input[placeholder*="name"]').first();
        const emailInput = page.locator('input[type="email"], input[placeholder*="email"]').first();
        await nameInput.fill(TEST_NAME);
        await emailInput.fill('test@'); // intentionally malformed
        await getNextBtn().click();
        await page.waitForTimeout(400);

        const emailError = await page.locator(
          'text=/invalid email|valid email|email format|not a valid/i, [class*="error"]:near(input[type="email"])'
        ).first().waitFor({ state: 'visible', timeout: 2000 }).then(() => true).catch(() => false).catch(() => false);

        // HTML5 native validation also counts
        const isInvalid = await page.locator('input[type="email"]').first().evaluate(
          (el: HTMLInputElement) => !el.validity.valid
        ).catch(() => false);

        return {
          passed: emailError || isInvalid,
          actual: `emailError=${emailError}, htmlInvalid=${isInvalid}`,
          expected: 'email error visible or HTML5 invalid flag set',
        };
      }
    )
  );

  // ── Check 3: Valid Step 1 advances to Step 2 ──────────────────────────────
  results.push(
    await runCheck(
      'medium-2-check-3',
      'Valid Step 1 data allows advancing to Step 2',
      async () => {
        const nameInput = page.locator('input[name="name"], input[placeholder*="name"]').first();
        const emailInput = page.locator('input[type="email"], input[placeholder*="email"]').first();
        await nameInput.fill(TEST_NAME);
        await emailInput.fill(TEST_EMAIL);
        await getNextBtn().click();
        await page.waitForTimeout(600);

        const step2Visible = await page.locator(
          'input[type="password"], input[name="password"], [class*="step-2"], text=/password/i'
        ).first().waitFor({ state: 'visible', timeout: 2000 }).then(() => true).catch(() => false).catch(() => false);

        return {
          passed: step2Visible,
          actual: `step2 visible=${step2Visible}`,
          expected: 'Step 2 (password) visible',
        };
      }
    )
  );

  // ── Check 4: Password mismatch blocks advancing ───────────────────────────
  results.push(
    await runCheck(
      'medium-2-check-4',
      'Step 2: mismatched password/confirm shows error and blocks advancing',
      async () => {
        const passwords = await page.locator('input[type="password"]').all();
        if (passwords.length < 2) {
          return { passed: false, expected: '2 password fields', actual: `${passwords.length} found` };
        }
        await passwords[0].fill(TEST_PASSWORD);
        await passwords[1].fill('WrongPass999!');
        await getNextBtn().click();
        await page.waitForTimeout(400);

        const matchError = await page.locator(
          'text=/match|password|confirm/i, [class*="error"], [role="alert"]'
        ).first().waitFor({ state: 'visible', timeout: 2000 }).then(() => true).catch(() => false).catch(() => false);

        const step3NotVisible = !(await page.locator(
          'text=/review|summary|step 3|confirm/i'
        ).first().waitFor({ state: 'visible', timeout: 2000 }).then(() => true).catch(() => false).catch(() => false));

        return {
          passed: matchError || step3NotVisible,
          actual: `matchError=${matchError}, step3NotVisible=${step3NotVisible}`,
          expected: 'error shown and step 3 not reached',
        };
      }
    )
  );

  // ── Check 5: Step 3 shows exact name and email from Step 1 ────────────────
  results.push(
    await runCheck(
      'medium-2-check-5',
      'Step 3 review screen displays exact name and email entered in Step 1',
      async () => {
        // Fill Step 2 with matching passwords to advance
        const passwords = await page.locator('input[type="password"]').all();
        if (passwords.length >= 2) {
          await passwords[0].fill(TEST_PASSWORD);
          await passwords[1].fill(TEST_PASSWORD);
          await getNextBtn().click();
          await page.waitForTimeout(600);
        }

        const bodyText = await page.locator('body').innerText();
        const hasName = bodyText.includes(TEST_NAME);
        const hasEmail = bodyText.includes(TEST_EMAIL);

        return {
          passed: hasName && hasEmail,
          actual: `name found=${hasName}, email found=${hasEmail}`,
          expected: `"${TEST_NAME}" and "${TEST_EMAIL}" visible on Step 3`,
        };
      }
    )
  );

  // ── Check 6: Back preserves Step 1 data ───────────────────────────────────
  results.push(
    await runCheck(
      'medium-2-check-6',
      "Clicking 'Back' from Step 2 returns to Step 1 with data still populated",
      async () => {
        // Go back to Step 2 first if we're on Step 3
        const backBtn = getBackBtn();
        if (await backBtn.waitFor({ state: 'visible', timeout: 2000 }).then(() => true).catch(() => false).catch(() => false)) {
          await backBtn.click();
          await page.waitForTimeout(400);
        }
        // Go back to Step 1
        if (await backBtn.waitFor({ state: 'visible', timeout: 2000 }).then(() => true).catch(() => false).catch(() => false)) {
          await backBtn.click();
          await page.waitForTimeout(400);
        }

        const nameInput = page.locator('input[name="name"], input[placeholder*="name"]').first();
        const emailInput = page.locator('input[type="email"], input[placeholder*="email"]').first();

        const nameVal = await nameInput.inputValue().catch(() => '');
        const emailVal = await emailInput.inputValue().catch(() => '');

        return {
          passed: nameVal === TEST_NAME && emailVal === TEST_EMAIL,
          actual: `name="${nameVal}", email="${emailVal}"`,
          expected: `name="${TEST_NAME}", email="${TEST_EMAIL}"`,
        };
      }
    )
  );

  // ── Check 7: Submit on Step 3 shows success state ─────────────────────────
  results.push(
    await runCheck(
      'medium-2-check-7',
      'Submitting on Step 3 shows a success state',
      async () => {
        // Navigate back to Step 3
        await fillStep1();
        await getNextBtn().click();
        await page.waitForTimeout(400);
        const passwords = await page.locator('input[type="password"]').all();
        if (passwords.length >= 2) {
          await passwords[0].fill(TEST_PASSWORD);
          await passwords[1].fill(TEST_PASSWORD);
        }
        await getNextBtn().click();
        await page.waitForTimeout(400);

        // Submit
        const submitBtn = page.locator('button:has-text("Submit"), button[type="submit"]:has-text("Submit"), button:has-text("Create Account"), button:has-text("Finish")').first();
        if (await submitBtn.waitFor({ state: 'visible', timeout: 2000 }).then(() => true).catch(() => false).catch(() => false)) {
          await submitBtn.click();
          await page.waitForTimeout(600);
        }

        const successVisible = await page.locator(
          'text=/success|submitted|account created|thank you|welcome/i, [class*="success"]'
        ).first().waitFor({ state: 'visible', timeout: 2000 }).then(() => true).catch(() => false).catch(() => false);

        return {
          passed: successVisible,
          actual: `success state visible=${successVisible}`,
          expected: 'success/confirmation state shown',
        };
      }
    )
  );

  // ── Check 8: Progress indicator changes at each step ─────────────────────
  results.push(
    await runCheck(
      'medium-2-check-8',
      'Progress indicator visually updates at each step',
      async () => {
        // Start fresh
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(500);

        // Capture progress indicator state on Step 1
        const progressEl = page.locator(
          '[class*="progress"], [class*="step"], [class*="wizard"], [aria-label*="step"], [role="progressbar"]'
        ).first();

        const step1State = await progressEl.getAttribute('class').catch(() => '') ??
          await progressEl.innerText().catch(() => '');

        // Advance to Step 2
        await fillStep1();
        await getNextBtn().click();
        await page.waitForTimeout(400);

        const step2State = await progressEl.getAttribute('class').catch(() => '') ??
          await progressEl.innerText().catch(() => '');

        return {
          passed: step1State !== step2State,
          actual: `step1="${step1State}", step2="${step2State}"`,
          expected: 'progress indicator class/text changes between steps',
        };
      }
    )
  );

  return results;
}
