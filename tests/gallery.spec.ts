import { expect, test } from '@playwright/test';

const apps = [
  { id: 'app-one', name: 'Inventory Tracker', description: 'Tracks stock levels.', remixCount: 3, showcasedAt: 1 },
];

test('gallery lists showcased apps, links the live app, and explains remixing', async ({ page }) => {
  await page.route('**/api/gallery', route => route.fulfill({ json: { apps } }));
  await page.goto('/gallery', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Apps built with BrainHalf' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Inventory Tracker' })).toBeVisible();
  await expect(page.getByText('Tracks stock levels.')).toBeVisible();
  await expect(page.getByText('3 remixes')).toBeVisible();
  const open = page.getByRole('link', { name: /Open app/ });
  await expect(open).toHaveAttribute('href', '/p/app-one/');
  await expect(open).toHaveAttribute('target', '_blank');
  await expect(page.getByRole('link', { name: 'Sign in to remix' })).toHaveAttribute('href', '/#start-building');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('gallery shows an honest empty state and load failures', async ({ page }) => {
  await page.route('**/api/gallery', route => route.fulfill({ json: { apps: [] } }));
  await page.goto('/gallery', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('No apps in the gallery yet.')).toBeVisible();
  await page.unroute('**/api/gallery');
  await page.route('**/api/gallery', route => route.fulfill({ status: 502, json: { error: 'unavailable' } }));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('alert')).toContainText('could not be loaded');
});
