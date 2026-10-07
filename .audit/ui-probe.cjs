const { chromium } = require('@playwright/test');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const consoleMsgs = [], failures = [];
  page.on('console', m => { if (['error','warning'].includes(m.type())) consoleMsgs.push(`[${m.type()}] ${m.text().slice(0,300)}`); });
  page.on('pageerror', e => consoleMsgs.push('[pageerror] ' + String(e).slice(0,300)));
  page.on('requestfailed', r => failures.push(`FAILED ${r.url()} ${r.failure()?.errorText}`));
  page.on('response', r => { if (r.status() >= 400) failures.push(`HTTP ${r.status()} ${r.url()}`); });

  const report = {};
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  report.landingTitle = await page.title();

  // Landing interactive elements
  const clickables = await page.$$eval('a[href], button', els => els.map(e => ({
    tag: e.tagName, text: (e.textContent||'').trim().slice(0,40), href: e.getAttribute('href'), type: e.getAttribute('type'), disabled: e.disabled || null, visible: !!(e.offsetWidth||e.offsetHeight)
  })));
  report.landingElements = clickables;

  // Sign-in modal
  const signIn = await page.$('button:has-text("Sign in"), a:has-text("Sign in")');
  if (signIn) { await signIn.click(); await page.waitForTimeout(800); report.modalVisible = await page.$$eval('[role=dialog], .modal, form', els => els.length); report.consoleAfterModal = consoleMsgs.slice(); }

  // anchor hrefs sanity
  const anchors = await page.$$eval('a[href]', els => els.map(e => e.getAttribute('href')));
  report.hashLinks = anchors.filter(h => h === '#');
  report.anchorSample = anchors.slice(0, 40);

  console.log(JSON.stringify(report, null, 2));
  console.log('CONSOLE:', JSON.stringify(consoleMsgs.slice(0, 30), null, 2));
  console.log('NETWORK ISSUES:', JSON.stringify(failures.slice(0, 30), null, 2));
  await browser.close();
})().catch(e => { console.error('PROBE ERROR', e); process.exit(1); });
