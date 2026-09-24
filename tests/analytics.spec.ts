import { expect, test } from '@playwright/test';

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'wait' });
});

for (const path of ['/', '/guides/build-an-app-with-ai']) {
  test(`Google Analytics loads under the production CSP on ${path}`, async ({ page, request }) => {
    const violations: string[] = [];
    let tags = 0;
    page.on('console', message => {
      if (/Content Security Policy|Refused to load/i.test(message.text())) violations.push(message.text());
    });
    // Exercise production hostname guards with locally built responses. Stub
    // Google itself so automated checks never send traffic to the real property.
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.hostname === 'www.googletagmanager.com') {
        expect(url.searchParams.get('id')).toBe('G-RRR516MXP2');
        tags += 1;
        return route.fulfill({ contentType: 'application/javascript', body: 'window.__analyticsLoaded = true;' });
      }
      if (url.hostname !== 'brainhalf.com') return route.abort();
      const response = await request.get(`http://localhost:8789${url.pathname}${url.search}`);
      return route.fulfill({ response });
    });
    await page.goto(`https://brainhalf.com${path}?utm_source=test#example`);
    await expect.poll(() => page.evaluate(() => Boolean((window as any).__analyticsLoaded))).toBe(true);
    const commands = await page.evaluate(() => (window as any).dataLayer.map((args: IArguments) => Array.from(args)));
    expect(commands.filter((command: unknown[]) => command[0] === 'config')).toEqual([
      ['config', 'G-RRR516MXP2', expect.objectContaining({ page_location: `https://brainhalf.com${path}` })],
    ]);
    expect(JSON.stringify(commands)).not.toContain('utm_source');
    expect(tags).toBe(1);
    expect(violations).toEqual([]);
  });
}
