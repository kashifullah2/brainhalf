import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const now = new Date('2026-09-30T12:00:00Z');
const projects = [
  { id: 'menu-1', name: 'Corner bakery storefront', createdAt: now.getTime() - 86400000, updatedAt: now.getTime() - 3600000, status: 'ready' },
  { id: 'menu-2', name: 'Untitled Project', createdAt: now.getTime() - 172800000, updatedAt: now.getTime() - 7200000, status: 'draft' },
];

async function setup(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.clock.setFixedTime(now);
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (!['localhost', '127.0.0.1'].includes(url.hostname)) return route.abort();
    if (url.pathname === '/api/auth/session') return route.fulfill({ json: { userId: 'dev-user-1' } });
    if (url.pathname === '/api/account/deletions') return route.fulfill({ json: { deletions: [] } });
    if (url.pathname === '/api/projects') return route.fulfill({ json: { projects } });
    if (url.pathname === '/api/auth/ws-ticket') return route.fulfill({ json: { ticket: 'bhwt_menu_fixture' } });
    if (url.pathname.endsWith('/runtime/status')) return route.fulfill({ json: { enabled: false, jobs: [], releases: [], availability: { state: 'pilot_only', message: 'Hosting unavailable for this fixture.' } } });
    return route.continue();
  });
  await page.addInitScript(({ projects }) => {
    if (window !== window.top || localStorage.getItem('menu-fixture')) return;
    localStorage.setItem('menu-fixture', 'true');
    localStorage.setItem('bh_session_token', 'bh_dev_local_token_not_a_real_session');
    localStorage.setItem('bh_session_user', JSON.stringify({ id: 'dev-user-1' }));
    localStorage.setItem('brainhalf_account:dev-user-1:brainhalf_projects', JSON.stringify(projects));
  }, { projects });
  await page.goto('/', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.locator('.landing-project-card')).toHaveCount(2);
  return { errors };
}

function intersects(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

test('project-card menu is a portaled popover that never covers the Open button', async ({ page }) => {
  const { errors } = await setup(page);
  await mkdir('audit-artifacts/ui-fixes-2026-09-30', { recursive: true });

  const card = page.locator('.landing-project-card').first();
  const menuButton = card.getByRole('button', { name: /^Project actions for/ });
  await menuButton.click();

  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();

  // Portaled: the menu must be a direct child of <body>, not inside the card.
  const inBody = await menu.evaluate(node => node.parentElement === document.body);
  expect(inBody).toBe(true);

  // Popover styling: visible border, shadow, and a high z-index.
  const style = await menu.evaluate(node => {
    const computed = getComputedStyle(node as HTMLElement);
    return { borderStyle: computed.borderStyle, borderWidth: computed.borderWidth, boxShadow: computed.boxShadow, zIndex: computed.zIndex, position: computed.position, background: computed.backgroundColor };
  });
  expect(style.position).toBe('fixed');
  expect(Number(style.zIndex)).toBeGreaterThanOrEqual(1000);
  expect(style.borderStyle).not.toBe('none');
  expect(style.boxShadow).not.toBe('none');
  expect(style.background).not.toBe('rgba(0, 0, 0, 0)');

  // The menu must not overlap the card's Open button.
  const menuBox = await menu.boundingBox();
  const openButton = card.locator('.landing-project-open');
  const openBox = await openButton.boundingBox();
  expect(menuBox && openBox && !intersects(menuBox, openBox)).toBe(true);

  await page.screenshot({ path: 'audit-artifacts/ui-fixes-2026-09-30/card-menu-popover.png' });

  // Keyboard: ArrowDown opens with first item focused, arrows move, Esc closes.
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await menuButton.focus();
  await page.keyboard.press('ArrowDown');
  await expect(menu).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Open' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: 'Rename' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(menuButton).toBeFocused();

  // Click-outside closes the menu.
  await menuButton.click();
  await expect(menu).toBeVisible();
  await page.mouse.click(20, 20);
  await expect(menu).toBeHidden();

  expect(errors).toEqual([]);
});
