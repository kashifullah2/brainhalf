import { expect, test } from '@playwright/test';
import { setupLifecycle, accountId, lifecycleProjects } from './fixtures/lifecycle';
import { readProjectFiles } from './project-evidence';
import { sourceSnapshot } from '../src/runtime/source';
import { setupPublication } from './fixtures/publication';

test('failed publishing shows its own build error and verification evidence on mobile', async ({ page }) => {
  const state = await setupLifecycle(page);
  const publishing = await setupPublication(page);
  state.sockets[0].socket.send(JSON.stringify({ type: 'file_updated', path: '/package.json', content: JSON.stringify({ scripts: { build: 'vite build' } }) }));
  await expect.poll(async () => (await readProjectFiles(page, accountId, lifecycleProjects[0].id))?.['/package.json']).toBeTruthy();
  await page.route('**/runtime/logs?**', route => route.fulfill({ json: {
    logs: [{ job: 'publication-job', text: 'src/App.tsx: Cannot resolve ./missing-component\n' + 'long-path/'.repeat(90) }, { job: 'other-job', text: 'Other job output must stay hidden' }],
    verification: { jobId: 'publication-job', checks: [{ name: 'App renders', passed: false, detail: 'Expected the dashboard heading' }] },
  } }));
  await page.getByRole('button', { name: 'Publish application', exact: true }).click();
  await expect.poll(() => publishing.submitted.length).toBe(1);
  publishing.fail();
  const dialog = page.getByRole('dialog', { name: 'Publish your app', exact: true });
  await expect(dialog.getByRole('alert')).toContainText('Building application failed (exit 1)', { timeout: 15000 });
  await expect(dialog.getByLabel('Failed publishing build log')).toContainText('Cannot resolve ./missing-component');
  await expect(dialog.getByText('Expected the dashboard heading', { exact: false })).toBeVisible();
  await expect(dialog).not.toContainText('Other job output must stay hidden');
  await expect(dialog.getByRole('link')).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(publishing.submitted).toHaveLength(1);
  await dialog.getByRole('button', { name: 'Fix publishing problem', exact: true }).click();
  await expect.poll(() => state.messages.some(message => message.prompt?.includes('Cannot resolve ./missing-component'))).toBe(true);
  expect(publishing.submitted).toHaveLength(1);
});

test('Publish deploys one saved frontend/backend version and exposes its URL only when complete', async ({ page }, testInfo) => {
  const state = await setupLifecycle(page);
  const publishing = await setupPublication(page);
  for (const [path, content] of Object.entries({ '/package.json': JSON.stringify({ scripts: { build: 'vite build', test: 'node --test' }, brainhalf: { runtime: 'workers' } }), '/worker/index.ts': 'export default { fetch() { return new Response("ok"); } };' })) state.sockets[0].socket.send(JSON.stringify({ type: 'file_updated', path, content }));
  await expect.poll(async () => (await readProjectFiles(page, accountId, lifecycleProjects[0].id))?.['/worker/index.ts']).toBeTruthy();
  expect(publishing.submitted).toEqual([]);
  await page.getByRole('button', { name: 'Publish application', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Publish your app', exact: true });
  await expect(dialog).toBeVisible();
  await expect.poll(() => publishing.submitted.length).toBe(1);
  expect(publishing.submitted[0]).toMatchObject({ kind: 'publish', environment: 'production' });
  expect(publishing.submitted[0].files['worker/index.ts']).toBeTruthy();
  const submittedRevision = (await sourceSnapshot(publishing.submitted[0].files)).revision;
  await expect(dialog.getByRole('link')).toHaveCount(0);
  await expect(dialog.getByText('Publishing continues on the server.', { exact: false })).toBeVisible();
  await dialog.getByRole('button', { name: 'Close publishing' }).click();
  publishing.complete();
  await page.getByRole('button', { name: 'Publish application', exact: true }).click();
  await expect(dialog.getByRole('link')).toHaveAttribute('href', 'https://published.apps.example.test');
  await expect(dialog.getByRole('button', { name: 'Up to date' })).toBeDisabled();
  expect(publishing.submitted).toHaveLength(1);
  state.sockets[0].socket.send(JSON.stringify({ type: 'file_updated', path: '/worker/index.ts', content: 'export default { fetch() { return new Response("changed"); } };' }));
  await expect(dialog.getByRole('button', { name: 'Publish changes' })).toBeEnabled();
  expect((await sourceSnapshot(publishing.submitted[0].files)).revision).toBe(submittedRevision);
  await page.screenshot({ path: testInfo.outputPath('publication-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('publication-mobile.png') });
  await dialog.getByRole('button', { name: 'Take app offline', exact: true }).click();
  await dialog.getByRole('button', { name: 'Confirm take offline', exact: true }).click();
  await expect(dialog.getByRole('link')).toHaveCount(0);
  await expect(dialog.getByText('Your app is live', { exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Publish app', exact: true })).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

test('older public preview links can still be made private independently of publishing', async ({ page }) => {
  const state = await setupLifecycle(page);
  await setupPublication(page);
  const updates: unknown[] = [];
  await page.route('**/api/projects/*/publication', route => {
    if (route.request().method() === 'PUT') {
      updates.push(route.request().postDataJSON());
      return route.fulfill({ json: { published: false } });
    }
    return route.fulfill({ json: { published: true } });
  });
  state.sockets[0].socket.send(JSON.stringify({ type: 'file_updated', path: '/package.json', content: JSON.stringify({ scripts: { build: 'vite build' } }) }));
  await page.getByRole('button', { name: 'Project actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Project console', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Project console', exact: true });
  await dialog.getByRole('button', { name: 'Make old preview private', exact: true }).click();
  expect(updates).toEqual([{ published: false }]);
  await expect(dialog.getByRole('button', { name: 'Make old preview private', exact: true })).toHaveCount(0);
});

test('source recovery and AI allowance remain accessible outside the hosting pilot', async ({ page }) => {
  await setupLifecycle(page);
  await page.route('**/agents/chat-agent/*/checkpoints', route => route.fulfill({ json: { revision: 1, checkpoints: [] } }));
  await page.route('**/agents/chat-agent/*/usage', route => route.fulfill({ json: { generations: [] } }));
  await page.route('**/api/account/ai-usage', route => route.fulfill({ json: { day: '2026-09-23', calls: 2, reservedOutputTokens: 8192, activeGenerations: 0, limits: { dailyCalls: 60, dailyOutputTokens: 2000000, concurrentGenerations: 2 } } }));
  await page.route('**/api/account/outcomes', route => route.fulfill({ json: {
    measuredAt: Date.UTC(2026, 8, 23), generations: 2, completedGenerations: 1, verifiedWorkingGenerations: 1,
    workingAppsPerGeneration: 0.5, publishAttempts: 0, published: 0, failedPublishes: 0, publishingSuccessRate: null,
    medianTimeToFirstLiveMs: null, firstLiveAccounts: 0, matureWeekOneAccounts: 0, returnedWeekOneAccounts: 0, weekOneRetention: null,
  } }));
  await page.getByRole('button', { name: 'Project actions', exact: true }).click(); await page.getByRole('menuitem', { name: 'Project console', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Project console', exact: true });
  await dialog.getByRole('button', { name: 'Source history', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Save checkpoint' })).toBeEnabled();
  await dialog.getByRole('button', { name: 'AI usage', exact: true }).click();
  await expect(dialog.getByText('Account allowance · 2026-09-23 UTC')).toBeVisible();
  await expect(dialog.getByText('Awaiting full 14-day window', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Database', exact: true }).click();
  await expect(dialog.getByText('Managed hosting is limited to approved pilot accounts.')).toBeVisible();
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
});
