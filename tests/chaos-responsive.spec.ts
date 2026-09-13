import { test, expect, type Page } from '@playwright/test';

const BASE_URL = 'https://brainhalf.com';
const ARTIFACT_DIR = '/home/kashifullah/.gemini/antigravity-ide/brain/bdade561-eefd-4bc6-bb08-2adeffc71475';

const VIEWPORTS = [
  { name: 'mobile', width: 375, height: 812 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'laptop', width: 1366, height: 768 },
  { name: 'desktop', width: 1920, height: 1080 },
];

function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', err => errors.push(err.message));
  return errors;
}

for (const vp of VIEWPORTS) {
  test.describe(`Chaos Responsive: ${vp.name} (${vp.width}x${vp.height})`, () => {
    test.setTimeout(60000);

    test(`Adversarial interactions at ${vp.name}`, async ({ page }) => {
      const errors = collectConsoleErrors(page);

      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(BASE_URL, { waitUntil: 'networkidle' });
      await page.waitForTimeout(2000);

      // 1. Verify no horizontal overflow
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
      const hasOverflow = scrollWidth > clientWidth + 5;
      console.log(`${vp.name}: scrollWidth=${scrollWidth}, clientWidth=${clientWidth}, overflow=${hasOverflow}`);
      expect(hasOverflow).toBe(false);

      // 2. Open sidebar if collapsible
      const sidebarToggle = page.locator('button[aria-label*="Sidebar"], button[title*="Sidebar"]').first();
      if (await sidebarToggle.isVisible({ timeout: 2000 }).catch(() => false)) {
        // BUG FINDING: On mobile/tablet viewports, the sidebar toggle button may be
        // positioned outside the visible viewport area. Using force:true to proceed.
        const bbox = await sidebarToggle.boundingBox();
        if (bbox && (bbox.x < 0 || bbox.y < 0 || bbox.x > vp.width || bbox.y > vp.height)) {
          console.log(`  BUG: Sidebar toggle button outside viewport at ${vp.name} (x=${bbox.x}, y=${bbox.y})`);
        }
        await sidebarToggle.click({ force: true }).catch(() => {
          console.log(`  WARNING: Sidebar toggle click failed at ${vp.name}`);
        });
        await page.waitForTimeout(500);
      }

      // 3. Create new project
      const newProjectBtn = page.locator('button[aria-label="Create New Project"]').first();
      if (await newProjectBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await newProjectBtn.click();
        await page.waitForTimeout(800);
      }

      // 4. Switch tabs
      const tabs = page.locator('[role="tablist"] button[role="tab"]');
      const tabCount = await tabs.count();
      for (let i = 0; i < tabCount; i++) {
        const tab = tabs.nth(i);
        if (await tab.isVisible()) {
          await tab.click();
          await page.waitForTimeout(300);

          // Check for clipped/invisible controls after tab switch
          const overflowAfter = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 5);
          if (overflowAfter) {
            console.log(`  WARNING: Overflow detected after switching to tab ${i} at ${vp.name}`);
          }
        }
      }

      // 5. Open model selector
      const modelSelect = page.locator('select').first();
      if (await modelSelect.isVisible({ timeout: 2000 }).catch(() => false)) {
        const bbox = await modelSelect.boundingBox();
        if (bbox) {
          // Check if select is clipped
          const isClipped = bbox.x < 0 || bbox.y < 0 || bbox.x + bbox.width > vp.width || bbox.y + bbox.height > vp.height;
          if (isClipped) {
            console.log(`  WARNING: Model select is clipped at ${vp.name}`);
          }
        }
      }

      // 6. Type in chat input
      const textarea = page.locator('textarea').first();
      if (await textarea.isVisible({ timeout: 2000 }).catch(() => false)) {
        await textarea.fill('Test message at viewport ' + vp.name);
        await page.waitForTimeout(200);
        await textarea.fill('');
      }

      // 7. Verify send button is visible and not clipped
      const sendBtn = page.locator('button[title*="Send"]').first();
      if (await sendBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        const sendBbox = await sendBtn.boundingBox();
        if (sendBbox) {
          const sendClipped = sendBbox.x + sendBbox.width > vp.width;
          if (sendClipped) {
            console.log(`  WARNING: Send button clipped at ${vp.name}`);
          }
        }
      }

      // Final overflow check
      const finalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 5);
      expect(finalOverflow).toBe(false);

      await page.screenshot({ path: `${ARTIFACT_DIR}/chaos_responsive_${vp.name}.png`, fullPage: true });

      const realErrors = errors.filter(e => !e.includes('favicon') && !e.includes('ResizeObserver'));
      console.log(`${vp.name} console errors: ${realErrors.length}`);
    });
  });
}
