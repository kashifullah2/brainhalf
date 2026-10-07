const { chromium } = require('@playwright/test');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const consoleMsgs = [], failures = [];
  page.on('console', m => { if (m.type() === 'error') consoleMsgs.push(m.text().slice(0,300)); });
  page.on('pageerror', e => consoleMsgs.push('[pageerror] ' + String(e).slice(0,300)));
  page.on('response', r => { if (r.status() >= 400) failures.push(`HTTP ${r.status()} ${r.url()}`); });
  const report = {};

  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.click('button:has-text("Sign in")');
  const dialog = page.locator('[role=dialog]').first();
  await dialog.locator('button:has-text("Sign up")').click();
  await dialog.locator('input[type=email]').fill('dev@brainhalf.local');
  await dialog.locator('input[type=password]').fill('brainhalf-dev');
  const [resp] = await Promise.all([
    page.waitForResponse(r => /\/api\/auth\/(signup|login)/.test(r.url()), { timeout: 15000 }),
    dialog.locator('button[type=submit]').click(),
  ]);
  report.signupStatus = resp.status();
  await page.waitForTimeout(3000);
  report.urlAfter = page.url();
  report.bodySnippet = (await page.textContent('body')).replace(/\s+/g,' ').slice(0, 250);
  await page.screenshot({ path: '.audit/after-signup.png' });

  // workspace: create a project by submitting the hero prompt if visible, else direct
  const promptBox = await page.$('textarea');
  report.promptBox = !!promptBox;
  if (promptBox) {
    await promptBox.fill('Build a simple counter app');
    await page.screenshot({ path: '.audit/prompt.png' });
    const startBtn = await page.$('button[type=submit]:has-text("Start building")');
    if (startBtn && !(await startBtn.isDisabled())) {
      await startBtn.click();
      await page.waitForTimeout(12000);
      report.workspaceUrl = page.url();
      await page.screenshot({ path: '.audit/workspace.png' });
    }
  }
  report.consoleErrors = consoleMsgs.slice(0, 15);
  report.httpFailures = failures.slice(0, 15);
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
})().catch(e => { console.error('PROBE ERROR', String(e).slice(0,400)); process.exit(1); });
