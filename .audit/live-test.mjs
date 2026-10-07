import { chromium } from '/home/kashifullah/brainhalf/node_modules/playwright/index.mjs';

const browser = await chromium.launch({
  headless: true,
  executablePath: '/usr/bin/google-chrome',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
});
const page = await browser.newPage();
page.setDefaultTimeout(30000);

const SHOTS = '/home/kashifullah/brainhalf/.audit';
function log(msg) { console.log(`[${new Date().toISOString().slice(11,19)}] ${msg}`); }
async function shot(name) {
  await page.screenshot({ path: `${SHOTS}/bh-${name}.png` });
  log(`screenshot: bh-${name}.png`);
}

try {
  log('Loading brainhalf.com...');
  await page.goto('https://brainhalf.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await shot('1-home');

  // Open sign-in modal (force click bypasses stacking context issues)
  await page.locator('button.landing-signin-btn, .landing-signin-btn').first().click({ force: true });
  await page.waitForTimeout(1500);
  await shot('2-modal');

  // Fill credentials in the modal
  const modal = page.locator('.login-screen');
  await modal.waitFor({ timeout: 8000 });
  await modal.locator('input[type="email"]').fill('whyai4@gmail.com');
  await modal.locator('input[type="password"]').fill('12345678');
  log('Credentials filled');

  // Click the blue Sign-in submit button (last button in modal = submit, not the "Sign in" tab)
  const submitBtns = modal.locator('button');
  const count = await submitBtns.count();
  log(`Modal buttons: ${count}`);
  // The submit button is the one with type="submit" or the last one
  await modal.locator('button[type="submit"]').click().catch(async () => {
    // Fallback: click by text match inside modal only
    await modal.locator('button').filter({ hasText: /^Sign in/ }).last().click();
  });
  log('Clicked submit');

  await page.waitForTimeout(5000);
  log(`Post-login URL: ${page.url()}`);
  await shot('3-post-login');

  // We're on /dashboard — click "+ New project"
  log(`Dashboard URL: ${page.url()}`);
  await shot('4-dashboard');

  const newProjBtn = page.locator('button:has-text("New project"), a:has-text("New project")').first();
  await newProjBtn.waitFor({ timeout: 10000 });
  await newProjBtn.click();
  log('Clicked New project');

  // Wait for navigation to project workspace
  await page.waitForURL(url => url.includes('/project/') || url.includes('/app/') || url.includes('/build'), { timeout: 20000 }).catch(async () => {
    log(`URL after new project click: ${page.url()}`);
    await page.waitForTimeout(3000);
  });
  log(`Project URL: ${page.url()}`);
  await shot('5-project');

  // Find prompt input — might be a textarea or contenteditable
  const promptInput = page.locator('textarea, [contenteditable="true"]').first();
  const hasPrompt = await promptInput.isVisible({ timeout: 15000 }).catch(() => false);
  log(`Prompt input visible: ${hasPrompt}`);

  if (!hasPrompt) {
    const html = await page.content();
    log(`HTML (first 1000): ${html.slice(0, 1000)}`);
    await browser.close();
    process.exit(0);
  }

  // ---- TEST 1: Task Manager ----
  log('\n=== TEST 1: Task Manager ===');
  await promptInput.click();
  await promptInput.fill('Build a task manager app with React - add tasks, mark complete, delete, filter by status, local storage persistence');
  await shot('6-prompt-typed');

  await page.keyboard.press('Enter');
  log('Prompt submitted');
  const t1Start = Date.now();

  let t1Files = 0, t1Error = '', t1Done = false, t1AutoFix = 0;
  for (let i = 0; i < 24; i++) {
    await page.waitForTimeout(5000);
    const elapsed = Math.round((Date.now() - t1Start) / 1000);

    const err = await page.locator('[class*="error"]:visible, [data-type="error"]:visible').first().textContent({ timeout: 300 }).catch(() => '');
    if (err && err.length > 5 && err !== t1Error) { t1Error = err.slice(0, 150); log(`[${elapsed}s] ERR: ${t1Error}`); }

    const fc = await page.locator('[class*="file-item"], [data-path], [class*="tree"] li').count().catch(() => 0);
    if (fc !== t1Files) { t1Files = fc; log(`[${elapsed}s] file tree: ${fc}`); }

    // Count auto-fix notices
    const fixNotices = await page.locator('[class*="notice"]:visible, [class*="generation_notice"]:visible').count().catch(() => 0);
    if (fixNotices > t1AutoFix) { t1AutoFix = fixNotices; log(`[${elapsed}s] fix notices: ${fixNotices}`); }

    const previewIframe = await page.locator('iframe').first().isVisible({ timeout: 300 }).catch(() => false);
    const spinner = await page.locator('.lucide-spin').first().isVisible({ timeout: 300 }).catch(() => false);

    if (previewIframe && !spinner) {
      t1Done = true;
      log(`[${elapsed}s] Generation complete, preview visible`);
      break;
    }
    if (elapsed > 110) { log('110s timeout'); break; }
    log(`[${elapsed}s] generating... files:${fc} iframe:${previewIframe} spinner:${spinner}`);
  }

  const t1Time = Math.round((Date.now() - t1Start) / 1000);
  await shot('6-t1-result');

  // Take screenshot of file tree specifically
  const fileTree = page.locator('[class*="file-tree"], [class*="sidebar"], [class*="explorer"]').first();
  if (await fileTree.isVisible({ timeout: 2000 }).catch(() => false)) {
    await fileTree.screenshot({ path: `${SHOTS}/bh-7-filetree.png` });
    log('File tree screenshot saved');
  }

  log('\n=== TEST 1 RESULTS ===');
  log(`Files in tree: ${t1Files}`);
  log(`Error: ${t1Error || 'none'}`);
  log(`Preview loaded: ${t1Done}`);
  log(`Auto-fix notices: ${t1AutoFix}`);
  log(`Time: ${t1Time}s`);

} catch (e) {
  log(`FATAL: ${e.message.slice(0, 400)}`);
  await shot('error').catch(() => {});
}

await browser.close();
