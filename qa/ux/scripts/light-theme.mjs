import { chromium } from 'playwright';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 40000 }).catch(() => {});
if (await page.locator('html').getAttribute('data-theme') !== 'light') {
  await page.getByRole('button', { name: 'Switch to light mode' }).click();
}
await page.waitForTimeout(2600);
await page.screenshot({ path: '/tmp/bh-ux/rev-hero-light.png' });
await browser.close();
