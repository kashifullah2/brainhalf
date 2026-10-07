import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const DIR = '/tmp/bh-ux'; mkdirSync(DIR, { recursive: true });
const ORIGIN = process.env.BH_ORIGIN || 'http://localhost:5173';
const browser = await chromium.launch({ channel: 'chrome', headless: true });

for (const [name, viewport] of [['desktop', { width: 1440, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e).slice(0, 200)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
  await page.goto(ORIGIN + '/', { waitUntil: 'networkidle', timeout: 40000 }).catch(() => {});
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${DIR}/rev-hero-${name}.png` });
  await page.screenshot({ path: `${DIR}/rev-full-${name}.png`, fullPage: true });
  // gallery fallback visible?
  const ideaCards = await page.locator('.idea-card').count();
  const buildChip = await page.locator('.hero-build').count();
  const underline = await page.locator('.hero-underline-stroke').count();
  // horizontal scroll check
  const hscroll = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  console.log(JSON.stringify({ name, ideaCards, buildChip, underline, hscroll, errors }));
  await page.close();
}
await browser.close();
