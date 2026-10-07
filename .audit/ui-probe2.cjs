const { chromium } = require('@playwright/test');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const consoleMsgs = [], failures = [];
  page.on('console', m => { if (m.type() === 'error') consoleMsgs.push(m.text().slice(0,300)); });
  page.on('pageerror', e => consoleMsgs.push('[pageerror] ' + String(e).slice(0,300)));
  page.on('response', r => { if (r.status() >= 400 && !r.url().includes('favicon')) failures.push(`HTTP ${r.status()} ${r.url()}`); });
  const report = {};

  // 1. Gallery page
  await page.goto('http://localhost:5173/gallery', { waitUntil: 'networkidle', timeout: 60000 });
  report.gallery = { title: await page.title(), bodySnippet: (await page.textContent('body')).slice(0, 200) };

  // 2. Sign up through modal
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  const signInBtn = await page.$('button:has-text("Sign in")');
  if (signInBtn) {
    await signInBtn.click(); await page.waitForTimeout(500);
    const emailInput = await page.$('input[type=email], input[name=email]');
    report.emailInputFound = !!emailInput;
    if (emailInput) {
      await emailInput.fill('dev@brainhalf.local');
      const pw = await page.$('input[type=password]');
      if (pw) await pw.fill('brainhalf-dev');
      // find signup tab/button
      const signupTab = await page.$('button:has-text("Sign up"), [role=tab]:has-text("Sign up"), a:has-text("Sign up")');
      if (signupTab) { await signupTab.click(); await page.waitForTimeout(300); }
      const submit = await page.$('form button[type=submit], button:has-text("Create account"), button:has-text("Sign up")');
      if (submit) { await submit.click(); await page.waitForTimeout(2500); }
      report.afterSignupUrl = page.url();
    }
  }
  report.consoleAfterSignup = consoleMsgs.slice(0, 10);

  // 3. Dashboard
  await page.goto('http://localhost:5173/dashboard', { waitUntil: 'networkidle', timeout: 60000 }).catch(e => report.dashErr = String(e).slice(0,200));
  report.dashboardSnippet = (await page.textContent('body') || '').slice(0, 200);

  // 4. Contact form
  await page.goto('http://localhost:5173/contact', { waitUntil: 'networkidle', timeout: 60000 });
  const form = await page.$('form');
  report.contactForm = !!form;
  if (form) {
    const fields = await form.$$eval('input, textarea', els => els.map(e => ({ name: e.name, type: e.type, required: e.required })));
    report.contactFields = fields;
    await page.fill('input[name=name]', 'Audit Test').catch(()=>{});
    await page.fill('input[name=email]', 'audit@example.com').catch(()=>{});
    await page.fill('textarea[name=message]', 'Audit probe message').catch(()=>{});
    await Promise.all([
      page.waitForResponse(r => r.url().includes('/api/contact'), { timeout: 15000 }).catch(() => null),
      form.$eval('button[type=submit], button:not([type])', b => b.click()).catch(e => report.contactClickErr = String(e).slice(0,150)),
    ]).then(([resp]) => { report.contactResponse = resp ? resp.status() : 'no response observed'; });
    await page.waitForTimeout(800);
    report.contactAfterText = (await page.textContent('body')).slice(0, 300);
  }

  console.log(JSON.stringify(report, null, 2));
  console.log('CONSOLE ERRORS:', JSON.stringify(consoleMsgs.slice(0, 20), null, 2));
  console.log('HTTP FAILURES:', JSON.stringify(failures.slice(0, 20), null, 2));
  await browser.close();
})().catch(e => { console.error('PROBE ERROR', String(e).slice(0, 500)); process.exit(1); });
