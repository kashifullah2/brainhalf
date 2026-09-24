import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { PUBLIC_PAGES, SITE_URL, contentModified } from '../src/seo/content';

const paths = ['/', ...PUBLIC_PAGES.map(page => page.path)];
test('opaque previews can load their empty prefetch rules without CORS errors', async ({ page }) => {
  await page.goto('/');
  const endpoint = new URL('/preview-rules.json', page.url()).href;
  await page.evaluate(() => {
    const frame = document.createElement('iframe'); frame.title = 'Prefetch rules test';
    frame.sandbox.add('allow-scripts'); frame.srcdoc = '<html><body>Preview</body></html>';
    document.body.append(frame);
  });
  const result = await page.frameLocator('iframe[title="Prefetch rules test"]').locator('body').evaluate(async (_body, endpoint) => {
    const response = await fetch(endpoint, { credentials: 'omit' });
    return { origin: globalThis.origin, status: response.status, rules: await response.json() };
  }, endpoint);
  expect(result).toEqual({ origin: 'null', status: 200, rules: {} });
});
test('public scripts and styles use versioned URLs with immutable browser caching', async ({ request }) => {
  const html = await (await request.get('/')).text();
  const assets = [...html.matchAll(/(?:src|href)="(\/[^"?#]+\.(?:js|css))"/g)].map(match => match[1]);
  expect(assets.length).toBeGreaterThanOrEqual(3);
  for (const asset of new Set(assets)) {
    expect(asset).toMatch(/^\/assets\/.+-[\w-]+\.(?:js|css)$/);
    const response = await request.get(asset);
    expect(response.status()).toBe(200);
    expect(response.headers()['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(response.headers()['content-type']).toMatch(/javascript|text\/css/);
  }
  const legacy = await request.get('/theme-init.js');
  expect(legacy.headers()['cache-control']).toBe('public, max-age=3600, must-revalidate');
});

test.describe('versioned theme startup before the application loads', () => {
  const scenarios = [
    { name: 'saved dark overrides a light system', saved: 'dark', system: 'light' as const, expected: 'dark', blocked: false },
    { name: 'saved light overrides a dark system', saved: 'light', system: 'dark' as const, expected: 'light', blocked: false },
    { name: 'invalid preference follows the system', saved: 'invalid', system: 'dark' as const, expected: 'dark', blocked: false },
    { name: 'blocked storage follows the system', saved: '', system: 'dark' as const, expected: 'dark', blocked: true },
  ];
  // Each fresh page gets its own deadline and trace, including when local
  // Wrangler needs to recover a dropped asset connection.
  for (const scenario of scenarios) {
    test(scenario.name, async ({ page, context }) => {
      await page.emulateMedia({ colorScheme: scenario.system });
      await context.addInitScript(({ saved, blocked }) => {
        if (blocked) Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Storage unavailable', 'SecurityError'); } });
        else localStorage.setItem('brainhalf_theme', saved);
      }, scenario);
      await page.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.hostname !== 'localhost' || (url.pathname.endsWith('.js') && !/^\/assets\/theme-init-[a-f0-9]+\.js$/.test(url.pathname))) return route.abort();
        return route.continue();
      });
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await expect(page.locator('html')).toHaveAttribute('data-theme', scenario.expected);
      await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', scenario.expected === 'dark' ? '#111722' : '#f8f9fc');
    });
  }
});

test.describe('Worker SEO responses', () => {
  test('robots advertises the sitemap', async ({ request }) => {
    const robots = await request.get('/robots.txt');
    expect(robots.status()).toBe(200);
    expect(await robots.text()).toContain(`Sitemap: ${SITE_URL}/sitemap.xml`);
  });
  test('sitemap lists public pages with matching revision dates', async ({ request }) => {
    const sitemap = await request.get('/sitemap.xml');
    expect(sitemap.status()).toBe(200);
    expect(sitemap.headers()['content-type']).toContain('xml');
    const xml = await sitemap.text();
    for (const path of paths) expect(xml).toContain(`<loc>${SITE_URL}${path}</loc><lastmod>${contentModified(path)}</lastmod>`);
  });
  test('llms lists the public pages', async ({ request }) => {
    const llms = await request.get('/llms.txt');
    expect(llms.status()).toBe(200);
    expect(llms.headers()['content-type']).toContain('text/plain');
    const readerText = await llms.text();
    for (const path of paths) expect(readerText).toContain(`](${SITE_URL}${path})`);
  });
  test('unknown pages return a non-indexable 404', async ({ request }) => {
    const missing = await request.get('/this-page-does-not-exist');
    expect(missing.status()).toBe(404);
    expect(await missing.text()).toContain('noindex, follow');
  });
  test('trailing slashes redirect to the canonical page', async ({ request }) => {
    const redirect = await request.get('/guides/build-an-app-with-ai/', { maxRedirects: 0 });
    expect([301, 307, 308]).toContain(redirect.status());
    expect(redirect.headers().location).toMatch(/\/guides\/build-an-app-with-ai$/);
  });
  for (const search of ['?project=private', '?google=complete', '?token=value', '?_uid=user']) {
    test(`private query ${search} stays non-indexable`, async ({ request }) => {
      const response = await request.get(`/${search}`);
      expect(response.status()).toBe(200);
      expect(response.headers()['x-robots-tag']).toBe('noindex, nofollow');
    });
  }
  test('the public homepage has no private robots header', async ({ request }) => {
    const response = await request.get('/');
    expect(response.status()).toBe(200);
    expect(response.headers()['x-robots-tag']).toBeUndefined();
  });
});

for (const path of paths) test(`public HTML and hydration work for ${path}`, async ({ page, request }) => {
  const response = await request.get(path);
  expect(response.status()).toBe(200);
  const html = await response.text();
  expect(html).toContain('<main');
  expect(html).toContain(`rel="canonical" href="${SITE_URL}${path}"`);
  expect(html).toContain('application/ld+json');
  expect(html).not.toMatch(/rel="modulepreload"[^>]+vendor-(?:monaco|jszip|sucrase)/);
  const problems: string[] = [];
  const loads: string[] = [];
  page.on('pageerror', error => problems.push(error.message));
  page.on('console', message => { if (message.type() === 'error') problems.push(message.text()); });
  page.on('request', request => loads.push(request.url()));
  await page.route('**/*', route => new URL(route.request().url()).hostname === 'localhost' ? route.continue() : route.abort());
  await page.goto(path);
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(problems).toEqual([]);
  expect(loads.filter(url => /(?:vendor-(monaco|jszip|sucrase)|editor\.api|Workspace-|ChatPanel-|TopNav-)/.test(url))).toEqual([]);
});

test('appointment walkthrough exposes its evidence and demo limits on mobile without JavaScript', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  try {
    const page = await context.newPage();
    await page.goto('http://localhost:8789/guides/ai-appointment-app-example');
    const figure = page.locator('figure');
    await figure.scrollIntoViewIfNeeded();
    await expect(figure.locator('img')).toBeVisible();
    await expect.poll(() => figure.locator('img').evaluate(image => (image as HTMLImageElement).naturalWidth)).toBe(390);
    await expect(figure.locator('figcaption')).toContainText('no booking is stored');
    await expect(page.getByRole('link', { name: 'Try the Cedar Cuts frontend demo' })).toHaveAttribute('href', 'https://deb260c733cb9b82876ea09cda516d76.apps.brainhalf.com');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await mkdir('audit-artifacts/seo-growth-2026-09-24', { recursive: true });
    await page.screenshot({ path: 'audit-artifacts/seo-growth-2026-09-24/appointment-mobile.png', fullPage: true });
    await page.goto('http://localhost:8789/use-cases/ai-inventory-app-builder');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Build an inventory app around your stock workflow');
    await expect(page.getByRole('link', { name: 'Understand BrainHalf databases, sign-in and recovery' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: 'audit-artifacts/seo-growth-2026-09-24/inventory-mobile.png', fullPage: true });
  } finally { await context.close(); }
});

test('public content and navigation work without JavaScript', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto('http://localhost:8789/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  const faq = await page.locator('script[type="application/ld+json"]').evaluate(element => JSON.parse(element.textContent || '{}')['@graph'].find((node: { '@type': string }) => node['@type'] === 'FAQPage'));
  expect(faq.mainEntity.length).toBeGreaterThan(0);
  await expect(page.locator('.studio-faq-list details')).toHaveCount(faq.mainEntity.length);
  for (const question of faq.mainEntity) {
    const details = page.locator(`#${new URL(question['@id']).hash.slice(1)}`);
    await expect(details.locator('summary h3')).toHaveText(question.name);
    if (!(await details.evaluate(element => element.hasAttribute('open')))) await details.locator('summary').click();
    await expect(details.locator('p')).toBeVisible();
    await expect(details.locator('p')).toHaveText(question.acceptedAnswer.text);
  }
  await expect(page.locator('ol[aria-label="How it works"] > li')).toHaveCount(3);
  await page.getByRole('link', { name: 'How to build an app with AI', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('How to build an app with AI');
  await expect(page.locator('.public-article')).toContainText('Start with one person and one job');
  await context.close();
});

test('FAQ controls remain usable by keyboard after hydration', async ({ page }) => {
  await page.goto('/');
  const details = page.locator('#free-access');
  const summary = details.locator('summary');
  await summary.focus();
  await page.keyboard.press('Enter');
  await expect(details.locator('p')).toBeVisible();
  await page.keyboard.press('Space');
  await expect(details.locator('p')).toBeHidden();
});

test('example previews support keyboard navigation and preserve a prompt through signup dismissal', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  const travel = page.getByRole('tab', { name: 'Inventory tool', exact: true });
  const board = page.getByRole('tab', { name: 'Task manager', exact: true });
  const analytics = page.getByRole('tab', { name: 'Simple CRM', exact: true });
  await expect(travel).toHaveAttribute('aria-selected', 'true');
  await travel.focus();
  await page.keyboard.press('ArrowRight');
  await expect(board).toBeFocused();
  await expect(board).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel')).toHaveAccessibleName('Task manager');
  await page.keyboard.press('End');
  await expect(analytics).toBeFocused();
  await expect(page.getByRole('tabpanel')).toHaveAccessibleName('Simple CRM');
  await page.keyboard.press('ArrowRight');
  await expect(travel).toBeFocused();
  await page.getByRole('button', { name: 'Use this idea' }).click();
  const prompt = page.getByLabel('Describe your app', { exact: true });
  await expect(prompt).toBeFocused();
  await expect(prompt).toHaveValue(/inventory tool/);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const draft = `${await prompt.inputValue()} Include supplier details.`;
  await prompt.fill(draft);
  await page.getByRole('button', { name: 'Create app from prompt', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(prompt).toHaveValue(draft);
});

test('all example previews fit narrow and wide landing layouts in both themes', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  for (const theme of ['light', 'dark']) {
    if (await page.locator('html').getAttribute('data-theme') !== theme) {
      await page.getByRole('button', { name: `Switch to ${theme} mode` }).click();
    }
    for (const width of [320, 390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const name of ['Inventory tool', 'Task manager', 'Simple CRM']) {
        await page.getByRole('tab', { name, exact: true }).click();
        const overflows = await page.locator('.landing-hero-shell').evaluate(element => {
          return [...element.querySelectorAll('button, textarea, .studio-browser, .sample-columns, .sample-metrics')]
            .filter(node => {
              const box = node.getBoundingClientRect();
              return box.width > 0 && (box.left < -1 || box.right > innerWidth + 1 || node.scrollWidth > node.clientWidth + 1);
            }).map(node => node.className);
        });
        expect(overflows, `${name}, ${theme}, ${width}px`).toEqual([]);
      }
    }
  }
});

for (const theme of ['light', 'dark']) test(`${theme} mobile pages and prompt handoff stay usable`, async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/guides/build-an-app-with-ai');
  if (await page.locator('html').getAttribute('data-theme') !== theme) await page.getByRole('button', { name: `Switch to ${theme} mode` }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const contrast = await page.getByRole('link', { name: 'Start building', exact: true }).evaluate(element => {
    const style = getComputedStyle(element);
    const luminance = (color: string) => {
      const channels = (color.match(/[\d.]+/g) || []).slice(0, 3).map(Number).map(channel => {
        const value = channel / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    };
    const foreground = luminance(style.color);
    const background = luminance(style.backgroundColor);
    return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
  });
  expect(contrast).toBeGreaterThanOrEqual(4.5);
  await mkdir('audit-artifacts/2026-09-23/seo-refresh', { recursive: true });
  await page.screenshot({ path: `audit-artifacts/2026-09-23/seo-refresh/guide-${theme}-mobile.png`, fullPage: true });
  await page.getByRole('link', { name: 'Start building', exact: true }).click();
  await page.getByLabel('Describe your app', { exact: true }).fill('Build a weekly habit tracker');
  await page.getByRole('button', { name: 'Create app from prompt', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `audit-artifacts/2026-09-23/seo-refresh/home-${theme}-mobile.png`, fullPage: true });
});
