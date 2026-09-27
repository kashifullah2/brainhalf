import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const now = new Date('2026-09-24T12:00:00Z');
const names = ['Zeta analytics', 'Untitled Project', 'Alpine storefront', 'Member portal', 'Studio portfolio', 'Weekly workflow', 'Team messaging', 'Autumn reservations'];
const descriptions = ['Revenue reports and customer metrics.', 'A quiet place to organize your next idea.', 'A collection of everyday objects, made with care.', 'Shared files and updates for your clients.', 'Selected work and the stories behind it.', 'Tasks, priorities and a little more focus.', 'Bring the whole conversation together.', 'A simple booking calendar for busy days.'];
const projects = Array.from({ length: 32 }, (_, index) => ({
  id: `recent-${index}`, name: names[index] || (index === 31 ? 'Orchid booking' : `Archive app ${index}`),
  createdAt: now.getTime() - 40 * 86400000,
  updatedAt: now.getTime() - (index < 3 ? index * 60000 : index < 5 ? 86400000 + index * 60000 : index < 7 ? 2 * 86400000 + index * 60000 : (index + 1) * 86400000),
  status: index === 2 ? 'error' : index === 3 ? 'building' : 'ready',
  published: index % 4 === 0,
}));

async function setup(page: Page) {
  const errors: string[] = [];
  const deleted = new Set<string>();
  page.on('pageerror', error => errors.push(error.message));
  await page.clock.setFixedTime(now);
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (!['localhost', '127.0.0.1'].includes(url.hostname)) return route.abort();
    if (url.pathname === '/api/auth/session') return route.fulfill({ json: { userId: 'dev-user-1' } });
    if (url.pathname === '/api/account/deletions') return route.fulfill({ json: { deletions: [] } });
    if (url.pathname === '/api/projects') return route.fulfill({ json: { projects: projects.filter(project => !deleted.has(project.id)) } });
    if (url.pathname === '/api/auth/ws-ticket') return route.fulfill({ json: { ticket: 'bhwt_recent_fixture' } });
    if (url.pathname.endsWith('/publication')) return route.fulfill({ json: { published: false } });
    if (url.pathname.endsWith('/runtime/status')) return route.fulfill({ json: { enabled: false, jobs: [], releases: [], availability: { state: 'pilot_only', message: 'Hosting unavailable for this fixture.' } } });
    if (url.pathname.startsWith('/api/projects/') && route.request().method() === 'DELETE') {
      deleted.add(url.pathname.split('/').pop()!);
      return route.fulfill({ json: { ok: true } });
    }
    if (url.pathname.startsWith('/preview/')) return route.fulfill({ contentType: 'text/html', body: '<h1>Local project preview</h1>' });
    return route.continue();
  });
  await page.routeWebSocket(/\/agents\//, socket => socket.send(JSON.stringify({ type: 'history', data: [] })));
  await page.addInitScript(({ projects, descriptions }) => {
    if (window !== window.top || localStorage.getItem('recent-fixture')) return;
    localStorage.setItem('recent-fixture', 'true');
    localStorage.setItem('bh_session_token', 'bh_dev_local_token_not_a_real_session');
    localStorage.setItem('bh_session_user', JSON.stringify({ id: 'dev-user-1' }));
    localStorage.setItem('brainhalf_account:dev-user-1:brainhalf_projects', JSON.stringify(projects));
    for (const [index, project] of projects.entries()) {
      localStorage.setItem(`brainhalf_account:dev-user-1:brainhalf_messages_${project.id}`, JSON.stringify([{ role: 'user', content: descriptions[index] || (index === 31 ? 'Appointment management for Orchid.' : 'An earlier app idea.') }]));
    }
  }, { projects, descriptions });
  await page.goto('/', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.locator('.landing-project-card')).toHaveCount(8);
  return { errors, deleted };
}

test('caps the library, groups dates and searches and filters all 32 projects', async ({ page }) => {
  const { errors } = await setup(page);
  const library = page.locator('.recent-projects');
  await expect(library.getByRole('status')).toHaveText('Showing 8 of 32 projects');
  for (const group of ['Today', 'Yesterday', 'This week', 'Older']) await expect(library.getByRole('button', { name: new RegExp(`^${group} \\d`) })).toHaveAttribute('aria-expanded', 'true');
  const today = library.getByRole('button', { name: /^Today / });
  await today.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.landing-project-card')).toHaveCount(5);
  await expect(today).toHaveAttribute('aria-expanded', 'false');
  await page.keyboard.press('Space');
  await expect(page.locator('.landing-project-card')).toHaveCount(8);
  await library.getByRole('button', { name: /Show more/ }).click();
  await expect(page.locator('.landing-project-card')).toHaveCount(16);
  await library.getByRole('button', { name: /Show more/ }).click();
  await library.getByRole('button', { name: /Show more/ }).click();
  await expect(page.locator('.landing-project-card')).toHaveCount(32);
  await expect(library.getByRole('button', { name: /Show more/ })).toHaveCount(0);
  await library.getByRole('searchbox').fill('Orchid');
  await expect(page.locator('.landing-project-card')).toHaveCount(1);
  await expect(library.getByRole('button', { name: 'Open Orchid booking', exact: true })).toBeVisible();
  await library.getByLabel('Filter projects by status').selectOption('deployed');
  await expect(library.getByText('No matching projects')).toBeVisible();
  await library.getByRole('button', { name: 'Clear filters' }).click();
  await expect(page.locator('.landing-project-card')).toHaveCount(8);
  await library.getByLabel('Filter projects by status').selectOption('deployed');
  await expect(page.locator('.landing-project-card')).toHaveCount(8);
  await expect(page.locator('.recent-project-status:not(.status-deployed)')).toHaveCount(0);
  await library.getByLabel('Filter projects by status').selectOption('all');
  await library.getByLabel('Sort projects').selectOption('name');
  await expect(page.locator('.landing-card-title').first()).toHaveText('Alpine storefront');
  await library.getByLabel('Sort projects').selectOption('status');
  await expect(page.locator('.landing-card-title').first()).toHaveText('Alpine storefront');
  await library.getByLabel('Sort projects').selectOption('updated');
  await expect(page.locator('.landing-card-title').first()).toHaveText('Zeta analytics');
  expect(errors).toEqual([]);
});

test('dashboard and dashboard project links survive reload', async ({ page }) => {
  await setup(page);
  await page.reload();
  await expect(page.locator('.recent-projects')).toBeVisible();
  await page.getByRole('button', { name: 'Open Zeta analytics', exact: true }).click();
  await expect(page).toHaveURL(/\?project=recent-0/);
  await page.reload();
  await expect(page.getByLabel('Message to the app builder')).toBeVisible();
  await expect(page.locator('.recent-projects')).toHaveCount(0);
});

test('keeps draft actions separate, supports menus and responds to live status changes', async ({ page }) => {
  const { deleted } = await setup(page);
  const draft = page.locator('.landing-project-card').filter({ has: page.getByRole('heading', { name: 'Untitled project', exact: true }) });
  await expect(draft.getByRole('button', { name: 'Continue building' })).toBeVisible();
  await expect(draft.getByRole('button', { name: 'Open Untitled project', exact: true })).toBeVisible();
  await expect(draft.locator('.recent-project-status')).toHaveText('Draft');
  await page.evaluate(async () => {
    const path = '/src/lib/status-store.ts';
    const status = await import(path);
    status.setPlatformStatus('Building', '', 'recent-1');
  });
  await expect(draft.locator('.recent-project-status')).toHaveText('Building');
  await page.evaluate(async () => {
    const path = '/src/lib/status-store.ts';
    const status = await import(path);
    status.setPlatformStatus('Error', '', 'recent-1');
  });
  await expect(draft.locator('.recent-project-status')).toHaveText('Error');
  const actions = draft.getByRole('button', { name: /Project actions/ });
  await actions.click();
  await page.keyboard.press('Escape');
  await expect(actions).toBeFocused();
  await actions.click();
  await draft.getByRole('button', { name: 'Rename', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox').fill('Cedar workspace');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  const renamed = page.locator('.landing-project-card').filter({ hasText: 'Cedar workspace' });
  await expect(renamed.getByRole('button', { name: 'Continue building' })).toHaveCount(0);
  await renamed.getByRole('button', { name: /Project actions/ }).click();
  await renamed.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete Project', exact: true }).click();
  await expect(renamed).toHaveCount(0);
  expect(deleted.has('recent-1')).toBe(true);
  // Click the thumbnail to verify the Open button's whole-card hit area.
  const thumbnail = page.locator('.recent-project-thumbnail').first();
  await thumbnail.scrollIntoViewIfNeeded();
  const box = (await thumbnail.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByLabel('Message to the app builder')).toBeVisible();
});

for (const theme of ['light', 'dark'] as const) {
  for (const width of [1440, 390]) {
    test(`${theme} theme at ${width}px has readable cards and no horizontal overflow`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      const { errors } = await setup(page);
      if (await page.locator('html').getAttribute('data-theme') !== theme) await page.getByRole('button', { name: `Switch to ${theme} mode` }).click();
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const library = page.locator('.recent-projects');
      await library.scrollIntoViewIfNeeded();
      await expect(page.locator('.landing-project-card')).toHaveCount(8);
      const appearance = await library.evaluate(element => {
        const rgb = (value: string) => value.match(/[\d.]+/g)!.slice(0, 3).map(Number);
        const luminance = (color: number[]) => color.map(value => { const channel = value / 255; return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4; }).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
        const contrast = (a: string, b: string) => { const x = luminance(rgb(a)); const y = luminance(rgb(b)); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
        const card = getComputedStyle(element.querySelector('.landing-project-card')!);
        return {
          overflow: document.documentElement.scrollWidth > innerWidth,
          titleContrast: contrast(getComputedStyle(element.querySelector('.landing-card-title')!).color, card.backgroundColor),
          borderContrast: contrast(card.borderColor, card.backgroundColor),
          chipContrast: [...element.querySelectorAll('.recent-project-status')].map(chip => { const style = getComputedStyle(chip); return contrast(style.color, style.backgroundColor); }),
        };
      });
      expect(appearance.overflow).toBe(false);
      expect(appearance.titleContrast).toBeGreaterThanOrEqual(4.5);
      for (const contrast of appearance.chipContrast) expect(contrast).toBeGreaterThanOrEqual(4.5);
      if (theme === 'dark') expect(appearance.borderContrast).toBeGreaterThanOrEqual(3);
      await mkdir('audit-artifacts/2026-09-22/recent-projects', { recursive: true });
      await library.screenshot({ path: `audit-artifacts/2026-09-22/recent-projects/${theme}-${width}.png` });
      expect(errors).toEqual([]);
    });
  }
}
