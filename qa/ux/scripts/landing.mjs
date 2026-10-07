import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';

const ORIGIN = process.env.BH_ORIGIN || 'http://localhost:5173';
const DIR = '/tmp/bh-ux';
mkdirSync(DIR, { recursive: true });
const report = { origin: ORIGIN, consoleErrors: [], pageErrors: [], failedRequests: [], links: [], ctas: [], headings: null, fold: '', issues: [] };

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('console', m => { if (m.type() === 'error') report.consoleErrors.push(m.text().slice(0, 300)); });
page.on('pageerror', e => report.pageErrors.push(String(e).slice(0, 300)));
page.on('requestfailed', r => report.failedRequests.push(`${r.method()} ${r.url().slice(0, 120)} ${r.failure()?.errorText}`));
page.on('response', r => { if (r.status() >= 400) report.failedRequests.push(`${r.status()} ${r.url().slice(0, 120)}`); });

const t0 = Date.now();
await page.goto(ORIGIN + '/', { waitUntil: 'domcontentloaded' });
report.ttfb = Date.now() - t0;
await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
report.fullLoad = Date.now() - t0;

// Persona D: what a first-time visitor sees above the fold
report.fold = await page.evaluate(() => {
  const el = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
  return document.body.innerText.slice(0, 1200);
});
report.h1 = await page.locator('h1').allInnerTexts();
report.title = await page.title();

await page.screenshot({ path: `${DIR}/landing-1440.png`, fullPage: true });

// CTAs
for (const name of [/start building/i, /get started/i, /try/i, /open brainhalf/i]) {
  const loc = page.getByRole('link', { name }).or(page.getByRole('button', { name }));
  const n = await loc.count();
  if (n) report.ctas.push({ name: String(name), count: n, hrefs: await loc.evaluateAll(els => els.map(e => e.getAttribute('href') || e.textContent.trim().slice(0, 40))) });
}

// All links + dead-link check
const links = await page.evaluate(() => [...document.querySelectorAll('a[href]')].map(a => ({ href: a.getAttribute('href'), text: a.textContent.trim().slice(0, 60) })));
const seen = new Set();
for (const l of links) {
  if (!l.href || l.href.startsWith('#') || l.href.startsWith('mailto:') || seen.has(l.href)) continue;
  seen.add(l.href);
  if (l.href.startsWith('/')) {
    const r = await page.request.get(ORIGIN + l.href, { maxRedirects: 0 }).catch(() => null);
    report.links.push({ href: l.href, text: l.text, status: r ? r.status() : 'FETCH-FAILED' });
  } else report.links.push({ href: l.href.slice(0, 80), text: l.text, status: 'external' });
}

// Forms / inputs visible
report.inputs = await page.evaluate(() => [...document.querySelectorAll('input,textarea,select')].map(e => ({ tag: e.tagName, type: e.type, name: e.name, aria: e.getAttribute('aria-label'), labelled: !!(e.labels && e.labels.length) })));

writeFileSync(`${DIR}/landing-report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ttfb: report.ttfb, fullLoad: report.fullLoad, h1: report.h1, title: report.title, ctas: report.ctas, consoleErrors: report.consoleErrors.length, pageErrors: report.pageErrors.length, failed: report.failedRequests, linkCount: report.links.length, badLinks: report.links.filter(l => typeof l.status === 'number' && l.status >= 400), inputs: report.inputs }, null, 2));
await browser.close();
