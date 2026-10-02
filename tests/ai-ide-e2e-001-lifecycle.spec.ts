import { test, expect } from '@playwright/test';
import { accountId, lifecycleProjects, setupLifecycle } from './fixtures/lifecycle';
import { assertProjectIsolation, assertProjectView, readProjectFiles } from './project-evidence';

test('local lifecycle: stop, switch, authenticated deletion, reload, mobile generation and socket reconnection', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const state = await setupLifecycle(page);
  const [alpha, beta] = lifecycleProjects;

  await page.getByLabel('Message to the app builder').fill('Add alpha checkout');
  await page.getByTestId('send-prompt-btn').click();
  // Hosting admission is now decided by the server. This controlled socket
  // accepts the request; the explicit unavailable-hosting choice is covered
  // separately in managed-runtime.spec.ts.
  await expect.poll(() => state.messages.filter(message => message.prompt === 'Add alpha checkout').length).toBe(1);
  await expect(page.getByTestId('stop-generation-btn')).toBeVisible();
  await expect(page.getByText('Working on the requested change.', { exact: true })).toBeVisible();
  await page.getByTestId('stop-generation-btn').click();
  await expect(page.getByTestId('stop-generation-btn')).toHaveCount(0);
  await expect.poll(() => state.messages.filter(message => message.projectId === alpha.id && message.type === 'stop').length).toBe(1);
  await expect.poll(() => readProjectFiles(page, accountId, alpha.id)).toEqual(alpha.files);

  await assertProjectIsolation(page, accountId, lifecycleProjects);
  await expect(page.getByText('Add alpha checkout', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Return to Home', exact: true }).click();
  await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
  const alphaCard = page.locator('.landing-project-card').filter({ hasText: alpha.prompt });
  await alphaCard.getByRole('button', { name: 'Project actions' }).click();
  await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete Project', exact: true }).click();
  await expect(alphaCard).toHaveCount(0);
  expect(state.deletions).toEqual([alpha.id]);
  await expect.poll(() => readProjectFiles(page, accountId, alpha.id)).toBeNull();
  await page.reload({ waitUntil: 'domcontentloaded' });
  // Deleting the active project selects the remaining project, including its URL.
  await assertProjectView(page, beta, alpha);
  expect(await readProjectFiles(page, accountId, alpha.id)).toBeNull();

  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.locator('.app-container')).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
  }
  await page.getByRole('button', { name: 'Chat', exact: true }).click();
  await page.getByLabel('Message to the app builder').fill('Add beta mobile toggle');
  await page.getByTestId('send-prompt-btn').click();
  await expect.poll(() => state.messages.filter(message => message.projectId === beta.id && message.prompt === 'Add beta mobile toggle').length).toBe(1);
  await expect(page.getByTestId('stop-generation-btn')).toBeVisible();
  await page.getByTestId('stop-generation-btn').click();
  await expect(page.getByTestId('stop-generation-btn')).toHaveCount(0);
  await expect.poll(() => state.messages.filter(message => message.projectId === beta.id && message.type === 'stop').length).toBe(1);

  const previousConnections = state.sockets.length;
  await state.sockets.at(-1)!.socket.close({ code: 1012, reason: 'Controlled service restart' });
  await expect.poll(() => state.sockets.length, { timeout: 15000 }).toBeGreaterThan(previousConnections);
  await page.getByLabel('Message to the app builder').fill('Confirm beta reconnect');
  await page.getByTestId('send-prompt-btn').click();
  await expect.poll(() => state.messages.filter(message => message.projectId === beta.id && message.prompt === 'Confirm beta reconnect').length).toBe(1);
  await page.getByTestId('stop-generation-btn').click();
  await expect.poll(() => readProjectFiles(page, accountId, beta.id)).toEqual(beta.files);
  expect(await readProjectFiles(page, accountId, alpha.id)).toBeNull();
  expect(errors).toEqual([]);
});
