import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
const origin = 'https://brainhalf.com';
const directory = 'audit-artifacts/platform-audit-2026-09-24';
mkdirSync(directory, { recursive: true });
const result = { measuredAt: new Date().toISOString(), endpoints: [], pages: [] };
const routes = [
  ['/', 200], ['/dashboard', 200], ['/robots.txt', 200], ['/sitemap.xml', 200], ['/preview-rules.json', 200],
  ['/api/auth/session', 401], ['/api/projects', 401], ['/api/account/ai-usage', 401],
  ['/api/account/deletions', 401], ['/api/account/outcomes', 401], ['/api/admin/outcomes', 401],
  ['/api/projects/audit-not-owned/runtime/status?environment=production', 401], ['/api/not-a-route', 404],
];
for (const [path, expected] of routes) {
  const samples = [];
  for (let index = 0; index < 3; index++) {
    const start = performance.now();
    const response = await fetch(origin + path, { signal: AbortSignal.timeout(30_000), redirect: 'manual' });
    const headersMs = performance.now() - start;
    await response.arrayBuffer();
    samples.push({ status: response.status, headersMs: Math.round(headersMs), totalMs: Math.round(performance.now() - start) });
  }
  result.endpoints.push({ path, expected, samples, passed: samples.every(sample => sample.status === expected) });
}
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      window.auditVitals = { lcp: 0, layoutShiftSum: 0 };
      new PerformanceObserver(list => { for (const entry of list.getEntries()) window.auditVitals.lcp = entry.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
      new PerformanceObserver(list => { for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.auditVitals.layoutShiftSum += entry.value; }).observe({ type: 'layout-shift', buffered: true });
    });
    await page.goto(origin, { waitUntil: 'networkidle' });
    const metrics = await page.evaluate(() => {
      const nav = performance.getEntriesByType('navigation')[0];
      return { ...window.auditVitals, ttfbMs: nav.responseStart, loadMs: nav.loadEventEnd, fcpMs: performance.getEntriesByName('first-contentful-paint')[0]?.startTime, overflow: document.documentElement.scrollWidth > innerWidth + 1 };
    });
    await page.screenshot({ path: `${directory}/homepage-${width}.png`, fullPage: true });
    const links = await page.locator('a[href]').evaluateAll(anchors => [...new Set(anchors.map(anchor => anchor.getAttribute('href')))].filter(href => href.startsWith('/') && !href.startsWith('//')));
    const linkChecks = [];
    for (const path of links) {
      const response = await context.request.get(origin + path);
      linkChecks.push({ path, status: response.status() });
    }
    const signIn = page.getByRole('button', { name: 'Sign in', exact: true }).first();
    await signIn.click();
    const loginVisible = await page.getByRole('dialog').isVisible();
    await page.keyboard.press('Escape');
    result.pages.push({ width, metrics, errors, links: linkChecks, loginVisible });
    await context.close();
  }
} finally { await browser.close(); }
writeFileSync(`${directory}/public-audit.json`, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
