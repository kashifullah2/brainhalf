import { expect, test } from '@playwright/test';
import { authPage } from '../src/runtime/auth-page';
import { setupLifecycle } from './fixtures/lifecycle';

for (const email of [true, false]) test(`hosted sign-in waits for configuration and clearly offers ${email ? 'email and providers' : 'providers only'}`, async ({ page }) => {
  const html = authPage('Cedar Cuts');
  const body = await html.text();
  await page.route('**/hosted-auth', route => route.fulfill({ status: 200, headers: Object.fromEntries(html.headers), body }));
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/auth/config', async route => { await held; await route.fulfill({ json: { passwordEnabled: email, magicLinkEnabled: email, emailReady: email, googleReady: true, githubReady: email, development: false } }); });
  await page.goto('/hosted-auth', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Loading sign-in options…')).toBeVisible();
  await expect(page.locator('#form')).toBeHidden();
  await expect(page.getByRole('link', { name: 'Create account' })).toBeHidden();
  release();
  await expect(page.getByRole('link', { name: 'Continue with Google' })).toBeVisible();
  if (email) await expect(page.getByRole('link', { name: 'Continue with GitHub' })).toBeVisible();
  else await expect(page.getByRole('link', { name: 'Continue with GitHub' })).toBeHidden();
  if (email) {
    await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Forgot password' })).toBeVisible();
  } else {
    await expect(page.locator('#form')).toBeHidden();
    await expect(page.getByText('Continue with a connected provider to sign in.')).toBeVisible();
    await expect(page.getByText('This sign-in method is unavailable.', { exact: false })).toHaveCount(0);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('technical generation controls are optional and cannot manually claim publication success', async ({ page }) => {
  await setupLifecycle(page);
  await page.getByRole('button', { name: 'Project actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Project console', exact: true }).click();
  await page.getByRole('button', { name: 'Project settings', exact: true }).click();
  await expect(page.getByLabel('Output limit per model call')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Mark first release complete' })).toHaveCount(0);
  await page.getByText('Advanced generation settings', { exact: true }).click();
  await expect(page.getByLabel('Output limit per model call')).toBeVisible();
});
