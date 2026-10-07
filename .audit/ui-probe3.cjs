const { chromium } = require('@playwright/test');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const consoleMsgs = [];
  page.on('console', m => { if (m.type() === 'error') consoleMsgs.push(m.text().slice(0,300)); });
  page.on('pageerror', e => consoleMsgs.push('[pageerror] ' + String(e).slice(0,300)));
  const report = {};
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.click('button:has-text("Sign in")');
  await page.waitForTimeout(600);
  await page.screenshot({ path: '.audit/modal.png' });
  // enumerate the dialog's controls
  report.dialog = await page.$$eval('[role=dialog] *, form *', els => els.filter(e => /^(BUTTON|A|INPUT)$/.test(e.tagName)).map(e => ({ tag: e.tagName, text: (e.textContent||'').trim().slice(0,30), type: e.getAttribute('type'), name: e.getAttribute('name'), disabled: e.disabled })).slice(0, 40));
  console.log(JSON.stringify(report, null, 2));
  console.log('CONSOLE ERRORS:', consoleMsgs.slice(0,10));
  await browser.close();
})().catch(e => { console.error('PROBE ERROR', String(e).slice(0,300)); process.exit(1); });
