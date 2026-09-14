/**
 * hard-3: Booking/Reservation Calendar — Playwright Checks
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
    await runCheck('hard-3-check-1', 'Page loads without console errors', async () => {
      await page.waitForTimeout(2000);
      return {
        passed: consoleErrors.length === 0,
        actual: consoleErrors.length > 0 ? consoleErrors[0] : 'none',
        expected: 'no console errors',
      };
    })
  );

  // ── Check 2: Month-view calendar visible ──────────────────────────────────
  results.push(
    await runCheck('hard-3-check-2', 'Month-view calendar visible with date grid', async () => {
      const dates = page.locator('button:has-text("15"), [class*="day"]:has-text("15"), td:has-text("15")').first();
      const visible = await dates.waitFor({ state: 'visible', timeout: 2000 }).then(() => true).catch(() => false);
      const bodyText = await page.innerText('body');
      const hasMonth = /january|february|march|april|may|june|july|august|september|october|november|december|sun|mon|tue|wed|thu|fri|sat/i.test(bodyText);

      return {
        passed: visible || hasMonth,
        expected: 'Calendar grid visible on screen',
        actual: `Date visible: ${visible}, Month text: ${hasMonth}`,
      };
    })
  );

  // ── Check 3: Clicking date opens time slot picker ─────────────────────────
  results.push(
    await runCheck('hard-3-check-3', 'Clicking a date displays available time slots', async () => {
      // Click day 15 or 20
      const targetDate = page.locator('button:has-text("15"), [class*="day"]:has-text("15"), div:has-text("15")').first();
      if (await targetDate.waitFor({ state: 'visible', timeout: 2000 }).then(() => true).catch(() => false)) {
        await targetDate.click();
        await page.waitForTimeout(500);
      }

      const slots = page.locator('button:has-text("AM"), button:has-text("PM"), button:has-text("00"), [class*="slot"]');
      const slotCount = await slots.count();
      const bodyText = await page.innerText('body');
      const hasSlotsText = /9:00|10:00|11:00|1:00|2:00|3:00|slot|select time/i.test(bodyText);

      return {
        passed: slotCount > 0 || hasSlotsText,
        expected: 'Time slot options visible after clicking date',
        actual: `Slot elements found: ${slotCount}`,
      };
    })
  );

  // ── Check 4: Book slot with Name + Email ──────────────────────────────────
  const testName = 'Jane Doe Benchmark';
  const testEmail = 'jane.doe@example.com';
  results.push(
    await runCheck('hard-3-check-4', 'Booking a time slot with Name + Email succeeds', async () => {
      const slots = page.locator('button:has-text("AM"), button:has-text("PM"), button:has-text("00"), [class*="slot"]');
      const firstSlot = slots.first();
      if (await firstSlot.waitFor({ state: 'visible', timeout: 2000 }).then(() => true).catch(() => false)) {
        await firstSlot.click();
        await page.waitForTimeout(300);
      }

      const nameInput = page.locator('input[placeholder*="Name"], input[type="text"]').first();
      const emailInput = page.locator('input[placeholder*="Email"], input[type="email"]').first();
      const confirmBtn = page.locator('button:has-text("Book"), button:has-text("Confirm"), button:has-text("Submit")').first();

      if (await nameInput.waitFor({ state: 'visible', timeout: 2000 }).then(() => true).catch(() => false)) await nameInput.fill(testName);
      if (await emailInput.waitFor({ state: 'visible', timeout: 2000 }).then(() => true).catch(() => false)) await emailInput.fill(testEmail);

      if (await confirmBtn.waitFor({ state: 'visible', timeout: 2000 }).then(() => true).catch(() => false)) {
        await confirmBtn.click();
        await page.waitForTimeout(1000);
      }

      const bodyText = await page.innerText('body');
      const confirmed = bodyText.includes(testName) || /success|booked|confirmed/i.test(bodyText);

      return {
        passed: confirmed,
        expected: `Booking confirmed for ${testName}`,
        actual: confirmed ? 'Booking confirmed' : 'Confirmation not detected',
      };
    })
  );

  // ── Check 5: Booked indicator on calendar date ────────────────────────────
  results.push(
    await runCheck('hard-3-check-5', 'Booked date shows visual indicator (badge/dot/highlight)', async () => {
      const indicators = page.locator('[class*="dot"], [class*="badge"], [class*="booked"], [class*="active"]');
      const count = await indicators.count();
      const bodyText = await page.innerText('body');
      const isIndicated = count > 0 || bodyText.includes(testName);

      return {
        passed: isIndicated,
        expected: 'Visual indicator present on booked date',
        actual: `Indicators found: ${count}`,
      };
    })
  );

  // ── Check 6: My Bookings section lists the booking ────────────────────────
  results.push(
    await runCheck('hard-3-check-6', "'My Bookings' section displays the newly booked reservation", async () => {
      const bookingsTab = page.locator('button:has-text("My Bookings"), [role="tab"]:has-text("Bookings"), a:has-text("Bookings")').first();
      if (await bookingsTab.waitFor({ state: 'visible', timeout: 2000 }).then(() => true).catch(() => false)) {
        await bookingsTab.click();
        await page.waitForTimeout(500);
      }

      const bodyText = await page.innerText('body');
      const inList = bodyText.includes(testName) || bodyText.includes(testEmail);

      return {
        passed: inList,
        expected: `Booking for ${testName} listed in My Bookings`,
        actual: inList ? 'Found booking in list' : 'Not found in list',
      };
    })
  );

  // ── Check 7: Cancelling booking frees up slot ─────────────────────────────
  results.push(
    await runCheck('hard-3-check-7', 'Cancelling booking removes it from list and frees up slot', async () => {
      const cancelBtn = page.locator('button:has-text("Cancel"), button:has-text("Delete"), button:has-text("Remove")').first();
      if (await cancelBtn.waitFor({ state: 'visible', timeout: 2000 }).then(() => true).catch(() => false)) {
        await cancelBtn.click();
        await page.waitForTimeout(1000);
      }

      const bodyText = await page.innerText('body');
      const isRemoved = !bodyText.includes(testName) || /no bookings|cancelled/i.test(bodyText);

      return {
        passed: isRemoved,
        expected: 'Booking removed after cancellation',
        actual: isRemoved ? 'Booking successfully removed' : 'Booking still present',
      };
    })
  );

  return results;
}
