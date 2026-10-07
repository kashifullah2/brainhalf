import { chromium } from 'playwright';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 40000 }).catch(() => {});
await page.waitForTimeout(3200);
await page.locator('.hero-visual').scrollIntoViewIfNeeded();
await page.waitForTimeout(600);
await page.locator('.hero-visual').screenshot({ path: '/tmp/bh-ux/zoom-hero-visual.png' });
await page.locator('.idea-grid').scrollIntoViewIfNeeded();
await page.waitForTimeout(400);
await page.locator('.gallery-row-section').screenshot({ path: '/tmp/bh-ux/zoom-ideas.png' });
// hover one card for state check
await page.locator('.idea-card').first().hover();
await page.waitForTimeout(300);
await page.locator('.idea-card').first().screenshot({ path: '/tmp/bh-ux/zoom-idea-hover.png' });
// click "Use this idea" -> composer prefilled
await page.locator('.idea-card').first().click();
await page.waitForTimeout(1200);
const val = await page.locator('#app-idea').inputValue();
console.log('prefilled:', val.slice(0, 90));
await page.locator('.hero-prompt').screenshot({ path: '/tmp/bh-ux/zoom-prefill.png' });
await browser.close();
