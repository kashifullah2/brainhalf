import type { Page } from '@playwright/test';
export async function openAdvanced(page: Page) {
  const advanced = page.getByRole('button', { name: 'Advanced', exact: true });
  if (await advanced.getAttribute('aria-expanded') !== 'true') await advanced.click();
}
