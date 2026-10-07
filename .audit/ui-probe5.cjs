const { chromium } = require('@playwright/test');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.click('button:has-text("Sign in")');
  const dialog = page.locator('[role=dialog]').first();
  await dialog.locator('button:has-text("Sign up")').click();
  await dialog.locator('input[type=email]').fill('dev@brainhalf.local');
  await dialog.locator('input[type=password]').fill('brainhalf-dev');
  await page.screenshot({ path: '.audit/modal-filled.png' });
  const submit = dialog.locator('button[type=submit]');
  console.log('submit disabled?', await submit.isDisabled(), 'count', await submit.count(), 'text:', await submit.textContent());
  // what element is at the submit's center point?
  const box = await submit.boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  const atPoint = await page.evaluate(({ cx, cy }) => {
    const el = document.elementFromPoint(cx, cy);
    return el ? { tag: el.tagName, cls: el.className?.toString?.().slice(0,120), text: (el.textContent||'').trim().slice(0,40) } : null;
  }, { cx, cy });
  console.log('element at submit center:', JSON.stringify(atPoint));
  try {
    await submit.click({ timeout: 5000 });
    console.log('click succeeded');
  } catch (e) {
    console.log('CLICK FAILED:', String(e).slice(0, 600));
    await submit.click({ force: true, timeout: 3000 }).then(() => console.log('force click ok')).catch(err => console.log('force failed', String(err).slice(0,200)));
  }
  await page.waitForTimeout(4000);
  console.log('url after:', page.url());
  console.log('body:', (await page.textContent('body')).replace(/\s+/g,' ').slice(0, 250));
  await page.screenshot({ path: '.audit/after-click.png' });
  await browser.close();
})().catch(e => { console.error('PROBE ERROR', String(e).slice(0,400)); process.exit(1); });
