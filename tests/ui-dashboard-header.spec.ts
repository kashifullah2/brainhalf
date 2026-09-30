import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const now = new Date('2026-09-30T12:00:00Z');
const projects = Array.from({ length: 4 }, (_, i) => ({
  id: `hdr-${i}`, name: `Header fixture ${i + 1}`,
  createdAt: now.getTime() - 86400000, updatedAt: now.getTime() - i * 3600000, status: 'ready',
}));

async function setup(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.clock.setFixedTime(now);
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (!['localhost', '127.0.0.1'].includes(url.hostname)) return route.abort();
    if (url.pathname === '/api/auth/session') return route.fulfill({ json: { userId: 'dev-user-1' } });
    if (url.pathname === '/api/account/deletions') return route.fulfill({ json: { deletions: [] } });
    if (url.pathname === '/api/account/project-quota') return route.fulfill({ json: { live: 4, limit: 50 } });
    if (url.pathname === '/api/projects') return route.fulfill({ json: { projects } });
    if (url.pathname === '/api/auth/ws-ticket') return route.fulfill({ json: { ticket: 'bhwt_hdr_fixture' } });
    if (url.pathname.endsWith('/runtime/status')) return route.fulfill({ json: { enabled: false, jobs: [], releases: [], availability: { state: 'pilot_only', message: 'Hosting unavailable for this fixture.' } } });
    return route.continue();
  });
  await page.addInitScript(({ projects }) => {
    if (window !== window.top || localStorage.getItem('hdr-fixture')) return;
    localStorage.setItem('hdr-fixture', 'true');
    localStorage.setItem('bh_session_token', 'bh_dev_local_token_not_a_real_session');
    localStorage.setItem('bh_session_user', JSON.stringify({ id: 'dev-user-1' }));
    localStorage.setItem('brainhalf_account:dev-user-1:brainhalf_projects', JSON.stringify(projects));
  }, { projects });
  await page.goto('/', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.locator('.landing-project-card')).toHaveCount(4);
  return { errors };
}

test('dashboard header has one Projects heading, stable subtitle spacing, and a visible quota fill', async ({ page }) => {
  const { errors } = await setup(page);
  await mkdir('audit-artifacts/ui-fixes-2026-09-30', { recursive: true });

  // Exactly one "Projects" heading (the H1) — the duplicate H2 is gone.
  await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'Projects', exact: true }).first()).toHaveJSProperty('tagName', 'H1');

  // The count line survives as plain text under the H1 area.
  await expect(page.getByText('4 projects · pick up where you left off.')).toBeVisible();

  // Subtitle keeps its spacing even after the quota meter renders (the old
  // p:last-child selector collapsed the H1/subtitle gap to 0).
  const quota = page.locator('.dashboard-quota');
  await expect(quota).toContainText('4 of 50 projects used');
  const subtitleGap = await page.locator('.dashboard-subtitle').evaluate(node => {
    const prev = node.previousElementSibling as HTMLElement;
    const a = node.getBoundingClientRect();
    const b = prev.getBoundingClientRect();
    return a.top - b.bottom;
  });
  expect(subtitleGap).toBeGreaterThanOrEqual(16);

  // The 4/50 usage bar shows a real, visible fill (the old --studio-accent
  // token was undefined, so the fill was transparent).
  const fill = page.locator('.dashboard-quota-bar > span');
  const fillStyle = await fill.evaluate(node => {
    const box = node.getBoundingClientRect();
    const computed = getComputedStyle(node as HTMLElement);
    return { width: box.width, background: computed.backgroundColor };
  });
  expect(fillStyle.width).toBeGreaterThan(0);
  expect(fillStyle.background).not.toBe('rgba(0, 0, 0, 0)');

  await page.locator('.dashboard-welcome').screenshot({ path: 'audit-artifacts/ui-fixes-2026-09-30/dashboard-header.png' });
  expect(errors).toEqual([]);
});
