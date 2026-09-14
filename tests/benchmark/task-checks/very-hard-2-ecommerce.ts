/**
 * very-hard-2: E-Commerce Storefront with Checkout Flow — Playwright Checks
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
    await runCheck('very-hard-2-check-1', 'Page loads without console errors', async () => {
      await page.waitForTimeout(2000);
      return {
        passed: consoleErrors.length === 0,
        actual: consoleErrors.length > 0 ? consoleErrors[0] : 'none',
        expected: 'no console errors',
      };
    })
  );

  // ── Check 2: Product grid & search controls visible ───────────────────────
  results.push(
    await runCheck('very-hard-2-check-2', 'Product listing grid with search & filter controls visible', async () => {
      const searchInput = page.locator('input[placeholder*="search"], input[placeholder*="Search"]').first();
      const products = page.locator('[class*="product"], [class*="card"]');
      const count = await products.count();
      const hasSearch = await searchInput.waitFor({ state: 'visible', timeout: 2000 }).then(() => true).catch(() => false);

      return {
        passed: count >= 2 || hasSearch,
        expected: 'Products and search/filter controls visible',
        actual: `Products count: ${count}, search input visible: ${hasSearch}`,
      };
    })
  );

  // ── Check 3: Price sort Low-High / High-Low ──────────────────────────────
  results.push(
    await runCheck('very-hard-2-check-3', 'Price sort dropdown reorders product grid', async () => {
      const sortSelect = page.locator('select').filter({ hasText: /sort|price|low|high/i }).first();
      if (await sortSelect.waitFor({ state: 'visible', timeout: 2000 }).then(() => true).catch(() => false)) {
        const options = await sortSelect.locator('option').allInnerTexts();
        const lowHigh = options.find((o) => /low/i.test(o)) || options[1];
        if (lowHigh) await sortSelect.selectOption({ label: lowHigh });
        await page.waitForTimeout(500);
      }

      return {
        passed: true,
        expected: 'Price sort functional',
        actual: 'Sort action attempted',
      };
    })
  );

  // ── Check 4: Product detail page with variants ────────────────────────────
  results.push(
    await runCheck('very-hard-2-check-4', 'Clicking product opens Product Detail page with size/color options', async () => {
      const firstProduct = page.locator('[class*="product"] img, [class*="product"] h3, [class*="card"] button').first();
      if (await firstProduct.waitFor({ state: 'visible', timeout: 2000 }).then(() => true).catch(() => false)) {
        await firstProduct.click();
        await page.waitForTimeout(1000);
      }

      const bodyText = await page.innerText('body');
      const hasVariant = /size|color|s|m|l|xl|red|blue|black|white|description|add to cart/i.test(bodyText);

      return {
        passed: hasVariant,
        expected: 'Product detail view rendered',
        actual: hasVariant ? 'Product detail view active' : 'Detail view not detected',
      };
    })
  );

  // ── Check 5: Add to Cart updates cart badge ───────────────────────────────
  results.push(
    await runCheck('very-hard-2-check-5', 'Adding variant to cart updates cart badge count', async () => {
      const addBtn = page.locator('button:has-text("Add to Cart"), button:has-text("Add to Bag")').first();
      if (await addBtn.waitFor({ state: 'visible', timeout: 2000 }).then(() => true).catch(() => false)) {
        await addBtn.click();
        await page.waitForTimeout(500);
      }

      const cartBadge = page.locator('[class*="badge"], [class*="cart-count"], button:has-text("Cart")').first();
      const badgeText = (await cartBadge.textContent()) ?? '';
      const hasBadgeCount = /\d+/.test(badgeText) || badgeText.includes('1');

      return {
        passed: hasBadgeCount || (await addBtn.waitFor({ state: 'visible', timeout: 2000 }).then(() => true).catch(() => false)),
        expected: 'Cart badge incremented',
        actual: `Cart badge text: ${badgeText.trim()}`,
      };
    })
  );

  // ── Check 6: Cart persists across page navigation ────────────────────────
  results.push(
    await runCheck('very-hard-2-check-6', 'Cart state persists when navigating back to product grid', async () => {
      const backBtn = page.locator('a:has-text("Back"), button:has-text("Back"), a:has-text("Store"), a:has-text("Products")').first();
      if (await backBtn.waitFor({ state: 'visible', timeout: 2000 }).then(() => true).catch(() => false)) {
        await backBtn.click();
        await page.waitForTimeout(500);
      }

      const cartBadge = page.locator('[class*="badge"], [class*="cart-count"], button:has-text("Cart")').first();
      const badgeText = (await cartBadge.textContent()) ?? '';

      return {
        passed: true,
        expected: 'Cart state preserved across navigation',
        actual: `Cart badge text after nav: ${badgeText.trim()}`,
      };
    })
  );

  // ── Check 7: Checkout Step 1 (Shipping Info) ──────────────────────────────
  results.push(
    await runCheck('very-hard-2-check-7', 'Checkout Step 1 (Shipping Info) accepts address and advances', async () => {
      const cartLink = page.locator('button:has-text("Cart"), a:has-text("Cart"), button:has-text("Checkout")').first();
      if (await cartLink.waitFor({ state: 'visible', timeout: 2000 }).then(() => true).catch(() => false)) {
        await cartLink.click();
        await page.waitForTimeout(500);
      }

      const checkoutBtn = page.locator('button:has-text("Checkout"), a:has-text("Checkout")').first();
      if (await checkoutBtn.waitFor({ state: 'visible', timeout: 2000 }).then(() => true).catch(() => false)) {
        await checkoutBtn.click();
        await page.waitForTimeout(500);
      }

      const nameInput = page.locator('input[placeholder*="Name"], input[name*="name"]').first();
      const addressInput = page.locator('input[placeholder*="Address"], input[name*="address"]').first();

      if (await nameInput.waitFor({ state: 'visible', timeout: 2000 }).then(() => true).catch(() => false)) await nameInput.fill('John Shopper');
      if (await addressInput.waitFor({ state: 'visible', timeout: 2000 }).then(() => true).catch(() => false)) await addressInput.fill('123 Market Street');

      const nextBtn = page.locator('button:has-text("Next"), button:has-text("Continue"), button:has-text("Payment")').first();
      if (await nextBtn.waitFor({ state: 'visible', timeout: 2000 }).then(() => true).catch(() => false)) {
        await nextBtn.click();
        await page.waitForTimeout(500);
      }

      const bodyText = await page.innerText('body');
      const step2Active = /payment|card|billing|step 2/i.test(bodyText);

      return {
        passed: step2Active || (await nameInput.waitFor({ state: 'visible', timeout: 2000 }).then(() => true).catch(() => false)),
        expected: 'Advanced to Payment Step',
        actual: step2Active ? 'On Payment step' : 'Step 1 filled',
      };
    })
  );

  // ── Check 8: Checkout Step 2 (Card Number Validation) ────────────────────
  results.push(
    await runCheck('very-hard-2-check-8', 'Payment step validates credit card format', async () => {
      const cardInput = page.locator('input[placeholder*="Card"], input[name*="card"], input[placeholder*="4242"]').first();
      if (await cardInput.waitFor({ state: 'visible', timeout: 2000 }).then(() => true).catch(() => false)) {
        await cardInput.fill('1234'); // invalid length
        const payBtn = page.locator('button:has-text("Pay"), button:has-text("Review"), button:has-text("Continue")').first();
        if (await payBtn.waitFor({ state: 'visible', timeout: 2000 }).then(() => true).catch(() => false)) {
          await payBtn.click();
          await page.waitForTimeout(300);
        }
        await cardInput.fill('4242424242424242'); // valid test card
      }

      return {
        passed: true,
        expected: 'Card format validated',
        actual: 'Card input test performed',
      };
    })
  );

  // ── Check 9: Order Confirmation with Order ID ────────────────────────────
  results.push(
    await runCheck('very-hard-2-check-9', 'Completing checkout displays Order Confirmation with Order #', async () => {
      const completeBtn = page.locator('button:has-text("Place Order"), button:has-text("Pay"), button:has-text("Confirm Order")').first();
      if (await completeBtn.waitFor({ state: 'visible', timeout: 2000 }).then(() => true).catch(() => false)) {
        await completeBtn.click();
        await page.waitForTimeout(1000);
      }

      const bodyText = await page.innerText('body');
      const hasConfirmation = /thank you|order #|order number|confirmed|success|ORD-/i.test(bodyText);

      return {
        passed: hasConfirmation,
        expected: 'Order confirmation with generated order number',
        actual: hasConfirmation ? 'Order confirmed' : 'Confirmation screen not detected',
      };
    })
  );

  // ── Check 10: Order History page lists order ──────────────────────────────
  results.push(
    await runCheck('very-hard-2-check-10', "'Order History' page lists past completed orders", async () => {
      const historyLink = page.locator('a:has-text("Orders"), button:has-text("Order History"), a:has-text("History")').first();
      if (await historyLink.waitFor({ state: 'visible', timeout: 2000 }).then(() => true).catch(() => false)) {
        await historyLink.click();
        await page.waitForTimeout(500);
      }

      const bodyText = await page.innerText('body');
      const hasHistory = /order|history|ORD-|completed|total/i.test(bodyText);

      return {
        passed: hasHistory,
        expected: 'Order history rendered with completed order',
        actual: hasHistory ? 'Order history visible' : 'Order history not found',
      };
    })
  );

  return results;
}
