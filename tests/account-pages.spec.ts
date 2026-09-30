import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

test('contact form uses real fields, handles delivery and displays the supplied logo', async ({ page }) => {
  let message: any;
  await page.route('**/api/contact', route => { message = route.request().postDataJSON(); return route.fulfill({ json: { ok: true } }); });
  await page.goto('/contact');
  await page.getByLabel('Your name', { exact: true }).fill('Example Person');
  await page.getByLabel('Email address', { exact: true }).fill('person@example.com');
  await page.getByLabel('How can we help?', { exact: true }).fill('Please help me understand my workspace.');
  await expect(page.locator('.landing-brand-logo image')).toHaveAttribute('href', '/android-chrome-512x512.png');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Your message has been sent');
  expect(message.email).toBe('person@example.com');
});

test('password reset keeps its token out of URLs and reports password mismatch', async ({ page }) => {
  let payload: any;
  await page.route('**/api/auth/reset-password', route => { payload = route.request().postDataJSON(); return route.fulfill({ json: { ok: true } }); });
  await page.goto(`/reset-password#token=${'a'.repeat(43)}`);
  await expect(page).toHaveURL(/\/reset-password$/);
  await expect(page.locator('meta[name=robots]')).toHaveAttribute('content', 'noindex, follow');
  await page.getByLabel('New password', { exact: true }).fill('new-password');
  await page.getByLabel('Confirm new password', { exact: true }).fill('different-password');
  await page.getByRole('button', { name: 'Update password' }).click();
  await expect(page.getByRole('alert')).toHaveText('The passwords do not match.');
  await page.getByLabel('Confirm new password', { exact: true }).fill('new-password');
  await page.getByRole('button', { name: 'Update password' }).click();
  await expect(page.getByRole('status')).toContainText('Your password is updated');
  expect(payload).toEqual({ token: 'a'.repeat(43), password: 'new-password' });
});

test('verification waits for a click and new signup directs users to their inbox', async ({ page }) => {
  let confirmations = 0;
  await page.route('**/api/auth/verify-email', route => { confirmations++; return route.fulfill({ json: { ok: true } }); });
  await page.goto(`/verify-email#token=${'b'.repeat(43)}`);
  await expect(page).toHaveURL(/\/verify-email$/);
  expect(confirmations).toBe(0);
  await page.getByRole('button', { name: 'Verify email', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Your email is verified');
  expect(confirmations).toBe(1);
  await page.route('**/api/auth/signup', route => route.fulfill({ status: 202, json: { verificationRequired: true, message: 'Check your email to verify your account, then sign in.' } }));
  await page.goto('/');
  await expect(page.locator('.top-nav')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Builder', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Get Started', exact: true }).click();
  await page.getByLabel('Email Address', { exact: true }).fill('person@example.com');
  await page.getByLabel('Password', { exact: true }).fill('strong-password');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Check your email');
  expect(await page.evaluate(() => localStorage.getItem('bh_session_token'))).toBeNull();
});

for (const theme of ['light', 'dark']) test(`${theme} account page and contact page fit mobile`, async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ['/contact', '/forgot-password']) {
    await page.goto(path);
    if (await page.locator('html').getAttribute('data-theme') !== theme) await page.getByRole('button', { name: `Switch to ${theme} mode` }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await mkdir('audit-artifacts/2026-09-22/account-pages', { recursive: true });
    await page.screenshot({ path: `audit-artifacts/2026-09-22/account-pages/${path.slice(1)}-${theme}.png`, fullPage: true });
  }
});
