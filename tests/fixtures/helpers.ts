import { expect, type Page } from '@playwright/test';

export const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';
export const ARTIFACT_DIR = process.env.ARTIFACT_DIR || 'test-results';
export const DEV_TOKEN = 'bh_dev_local_token_not_a_real_session';

export function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', err => errors.push(err.message));
  return errors;
}

export async function sendPrompt(page: Page, prompt: string) {
  const textarea = page.locator('textarea').first();
  await textarea.fill(prompt);
  await page.waitForTimeout(200);
  const sendBtn = page.locator('button[title*="Send"]').first();
  await expect(sendBtn).toBeEnabled({ timeout: 5000 });
  await sendBtn.click();
  await page.waitForTimeout(300);
}

export async function injectDevAuth(page: Page) {
  await page.evaluate((token) => {
    localStorage.setItem('bh_session_token', token);
  }, DEV_TOKEN);
}

export async function gotoAuthenticated(page: Page, path = '/') {
  await page.goto(BASE_URL + path, { waitUntil: 'networkidle' });
  await injectDevAuth(page);
  await page.reload({ waitUntil: 'networkidle' });
}
