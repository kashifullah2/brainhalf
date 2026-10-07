import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
const DIR = '/tmp/bh-ux'; mkdirSync(DIR, { recursive: true });
const LIVE = 'https://brainhalf.com';
const report = { live: {}, local: {} };
const browser = await chromium.launch({ channel: 'chrome', headless: true });

// ---------- LIVE: negative auth paths (no account needed) ----------
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e).slice(0, 200)));
  await page.goto(LIVE + '/', { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
  // Open sign-in
  const signIn = page.getByRole('button', { name: /sign in/i }).first();
  report.live.signInVisible = await signIn.isVisible().catch(() => false);
  await signIn.click().catch(() => {});
  await page.screenshot({ path: `${DIR}/live-signin-modal.png` });
  const dialog = page.getByRole('dialog').first();
  report.live.dialogVisible = await dialog.isVisible().catch(() => false);

  // 1. empty submit
  const submit = dialog.getByRole('button', { name: /sign in|continue|log in/i }).first();
  await submit.click().catch(() => {});
  await page.waitForTimeout(600);
  report.live.emptySubmit = await dialog.innerText().catch(() => 'NO DIALOG');
  await page.screenshot({ path: `${DIR}/live-auth-empty.png` });

  // 2. malformed email
  const email = dialog.locator('input[type="email"], input[name="email"]').first();
  const pwd = dialog.locator('input[type="password"]').first();
  await email.fill('not-an-email').catch(() => {});
  await pwd.fill('Whatever123!').catch(() => {});
  await submit.click().catch(() => {});
  await page.waitForTimeout(1200);
  report.live.malformedEmail = await dialog.innerText().catch(() => '');
  await page.screenshot({ path: `${DIR}/live-auth-bademail.png` });

  // 3. nonexistent account
  await email.fill('qa-nonexistent-user@example.com').catch(() => {});
  await pwd.fill('WrongPassword123!').catch(() => {});
  await submit.click().catch(() => {});
  await page.waitForTimeout(2500);
  report.live.wrongCreds = await dialog.innerText().catch(() => '');
  await page.screenshot({ path: `${DIR}/live-auth-wrongcreds.png` });

  // 4. Google button present?
  report.live.googleBtn = await dialog.getByRole('button', { name: /google/i }).isVisible().catch(() => false);
  // 5. signup link present?
  report.live.signupSwitch = await dialog.getByRole('button', { name: /create|sign up/i }).or(dialog.getByRole('link', { name: /create|sign up/i })).count();
  report.live.forgotLink = await dialog.getByText(/forgot/i).count();
  report.live.consoleErrs = errors;
  await page.close();
}

// ---------- LOCAL: full login journey with dev auth ----------
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e).slice(0, 200)));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 200)); });
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
  await page.getByRole('button', { name: /sign in/i }).first().click();
  const dialog = page.getByRole('dialog').first();
  await dialog.locator('input[type="email"], input[name="email"]').first().fill('dev@brainhalf.local');
  await dialog.locator('input[type="password"]').first().fill('brainhalf-dev');
  await page.screenshot({ path: `${DIR}/local-signin-filled.png` });
  await dialog.getByRole('button', { name: /sign in|continue|log in/i }).first().click();
  await page.waitForTimeout(4000);
  report.local.afterLoginUrl = page.url();
  report.local.afterLoginText = (await page.locator('body').innerText()).slice(0, 500);
  await page.screenshot({ path: `${DIR}/local-after-login.png`, fullPage: false });
  // session persistence across refresh
  await page.reload({ waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForTimeout(2500);
  report.local.afterRefreshUrl = page.url();
  report.local.stillSignedIn = await page.getByRole('button', { name: /dashboard|user profile|account/i }).first().isVisible().catch(() => false);
  await page.screenshot({ path: `${DIR}/local-after-refresh.png` });
  report.local.errors = errors;
  await page.close();
}
writeFileSync(`${DIR}/auth-report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await browser.close();
