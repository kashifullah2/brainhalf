// Resume test — check project that was already generating
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
async function shot(name) { await page.screenshot({ path: `${SHOTS}/bh-${name}.png` }); }

try {
  // Sign in again and navigate to project
  await page.goto('https://brainhalf.com', { waitUntil: 'domcontentloaded' });
  await page.locator('button.landing-signin-btn').click({ force: true });
  await page.waitForTimeout(1500);
  const modal = page.locator('.login-screen');
  await modal.waitFor({ timeout: 8000 });
  await modal.locator('input[type="email"]').fill('whyai4@gmail.com');
  await modal.locator('input[type="password"]').fill('12345678');
  await modal.locator('button[type="submit"]').click().catch(async () => {
    await modal.locator('button').filter({ hasText: /^Sign in/ }).last().click();
  });
  await page.waitForURL(url => String(url).includes('/dashboard'), { timeout: 15000 });

  // Navigate to the project already generating
  await page.goto('https://brainhalf.com/?project=proj-8e447cd0-9a11-45cf-b6c1-bd259ff705d8', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);
  log(`Project URL: ${page.url()}`);
  await shot('t1-continue-1');

  // Wait up to 3 more minutes for preview to appear
  const start = Date.now();
  let done = false;
  for (let i = 0; i < 36; i++) {
    await page.waitForTimeout(5000);
    const elapsed = Math.round((Date.now() - start) / 1000);

    // Check file count from bottom bar text
    const bottomText = await page.locator('[class*="bottom"], footer, [class*="status-bar"]').first().textContent({ timeout: 300 }).catch(() => '');
    const fileCountMatch = (await page.textContent('body').catch(() => '')).match(/(\d+)\s+(?:of\s+\d+\s+)?files?\s+written/i);
    const fileCount = fileCountMatch ? fileCountMatch[1] : '?';

    // Check for errors
    const errText = await page.locator('[class*="error"]:visible').first().textContent({ timeout: 300 }).catch(() => '');
    if (errText && errText.length > 5) { log(`[${elapsed}s] ERROR: ${errText.slice(0,150)}`); }

    // Check if "Building" status is gone
    const buildingStatus = await page.locator('text=Building').first().isVisible({ timeout: 300 }).catch(() => false);
    const readyStatus = await page.locator('text=Ready').first().isVisible({ timeout: 300 }).catch(() => false);
    const spinner = await page.locator('.lucide-spin').first().isVisible({ timeout: 300 }).catch(() => false);

    // Check for preview
    const hasPreview = await page.locator('iframe').first().getAttribute('src', { timeout: 300 }).catch(() => null);

    log(`[${elapsed}s] files:${fileCount} building:${buildingStatus} ready:${readyStatus} spinner:${spinner} iframe:${hasPreview ? 'yes' : 'no'}`);

    if (readyStatus && !buildingStatus && !spinner) {
      done = true;
      log(`[${elapsed}s] GENERATION COMPLETE`);
      await shot('t1-complete');
      break;
    }
    if (elapsed > 170) { log('3min extra timeout'); break; }
  }

  await shot('t1-final');

  // Get final file count and check preview
  const bodyText = await page.textContent('body').catch(() => '');
  const allFileMatches = bodyText.match(/(\d+)\s+(?:of\s+\d+\s+)?files?\s+written/gi) || [];
  log(`\n=== FINAL STATE ===`);
  log(`Generation complete: ${done}`);
  log(`File count mentions: ${allFileMatches.join(', ')}`);

  // Check if preview has actual content
  const iframe = page.locator('iframe').first();
  const iframeSrc = await iframe.getAttribute('src').catch(() => 'none');
  log(`iframe src: ${iframeSrc}`);

  // Take a screenshot of just the preview area
  const previewPanel = page.locator('[class*="preview"], [class*="workspace-right"], .preview-container').first();
  if (await previewPanel.isVisible({ timeout: 2000 }).catch(() => false)) {
    await previewPanel.screenshot({ path: `${SHOTS}/bh-t1-preview.png` });
    log('Preview panel screenshot saved');
  }

} catch (e) {
  log(`FATAL: ${e.message.slice(0, 300)}`);
  await page.screenshot({ path: `${SHOTS}/bh-wait-error.png` }).catch(() => {});
}
await browser.close();
