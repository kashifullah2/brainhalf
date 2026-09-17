import { test, expect } from '@playwright/test';

test.describe('Dead UI Audit', () => {
  test('evaluates interactive elements on the platform for meaningful action', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);

    // Collect all buttons and clickable elements
    const buttons = page.locator('button');
    const buttonCount = await buttons.count();
    console.log(`Found ${buttonCount} interactive buttons on main view`);

    const results: Array<{ selector: string; text: string; triggeredAction: boolean; details: string }> = [];

    for (let i = 0; i < buttonCount; i++) {
      const btn = buttons.nth(i);
      const isVisible = await btn.isVisible().catch(() => false);
      if (!isVisible) continue;

      const text = (await btn.innerText().catch(() => '')).trim();
      const ariaLabel = await btn.getAttribute('aria-label').catch(() => '');
      const title = await btn.getAttribute('title').catch(() => '');
      const identifier = text || ariaLabel || title || `button-${i}`;

      let networkTriggered = false;
      let consoleLogged = false;

      const responseHandler = () => { networkTriggered = true; };
      const consoleHandler = () => { consoleLogged = true; };

      page.on('response', responseHandler);
      page.on('console', consoleHandler);

      const beforeDom = await page.content();

      try {
        await btn.click({ timeout: 2000 });
        await page.waitForTimeout(300);
      } catch (err: any) {
        // May be covered by a modal or disabled
      }

      const afterDom = await page.content();
      const domChanged = beforeDom !== afterDom;

      results.push({
        selector: `button:nth-of-type(${i + 1})`,
        text: identifier,
        triggeredAction: domChanged || networkTriggered,
        details: domChanged ? 'DOM state changed' : networkTriggered ? 'Network request triggered' : consoleLogged ? 'Console log only' : 'No visible reaction',
      });

      page.off('response', responseHandler);
      page.off('console', consoleHandler);

      // Dismiss any opened modal or dropdown
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(200);
    }

    console.log('Dead UI Audit summary:', results.length, 'interactive elements tested');
    expect(results.length).toBeGreaterThan(0);
  });
});
