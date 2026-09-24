import { expect, test, type Page } from '@playwright/test';
import { accountId, lifecycleProjects, setupLifecycle } from './fixtures/lifecycle';
import { runPlatformLevelChecks } from './platform-checks';
import { assertProjectView, readProjectFiles } from './project-evidence';

function listenerCount(page: Page, event: string): number {
  if ('listenerCount' in page && typeof page.listenerCount === 'function') return Number(page.listenerCount(event));
  throw new Error('Listener inspection is unavailable in this Playwright runtime');
}

test('platform checks perform real switching and restore viewport/listeners', async ({ page }) => {
  await setupLifecycle(page);
  const viewport = page.viewportSize();
  const consoleListeners = listenerCount(page, 'console');
  const errorListeners = listenerCount(page, 'pageerror');
  const results = await runPlatformLevelChecks(page, 'local-platform', 'Build', { accountId, projects: lifecycleProjects });
  expect(results).toHaveLength(8);
  for (const result of results) expect(result.passed, `${result.checkName}: ${result.error ?? ''}`).toBe(true);
  expect(page.viewportSize()).toEqual(viewport);
  expect(listenerCount(page, 'console')).toBe(consoleListeners);
  expect(listenerCount(page, 'pageerror')).toBe(errorListeners);
});

test('missing evidence cannot report persistence or isolation as passing', async ({ page }) => {
  await setupLifecycle(page);
  const results = await runPlatformLevelChecks(page, 'missing-evidence');
  for (const name of ['Browser reload preserves actual files and history', 'Project switching isolates files and history']) {
    expect(results.find(result => result.checkName === name)).toMatchObject({ passed: false });
  }
});

test('a cross-project history leak is detected in the actual mounted view', async ({ page }) => {
  const state = await setupLifecycle(page);
  const [alpha, beta] = lifecycleProjects;
  state.sockets.at(-1)!.socket.send(JSON.stringify({ type: 'history', data: [
    { role: 'user', content: alpha.prompt }, { role: 'user', content: beta.prompt },
  ] }));
  await expect(page.getByText(beta.prompt, { exact: true })).toBeVisible();
  await expect(assertProjectView(page, alpha, beta)).rejects.toThrow();
});

test('reload checks reject corrupted persisted source, not just an unchanged URL', async ({ page }) => {
  await setupLifecycle(page);
  const project = lifecycleProjects[0];
  await page.evaluate(async ({ accountId, projectId }) => {
    const modulePath = '/src/lib/project-store.ts';
    const store = await import(modulePath);
    store.setProjectAccount(accountId);
    await store.idbSet('files', projectId, { '/src/App.jsx': 'corrupt persisted source' });
  }, { accountId, projectId: project.id });
  expect(await readProjectFiles(page, accountId, project.id)).toEqual({ '/src/App.jsx': 'corrupt persisted source' });
  const results = await runPlatformLevelChecks(page, 'corrupt-files', undefined, { accountId, projects: lifecycleProjects });
  expect(results.find(result => result.checkName === 'Browser reload preserves actual files and history')).toMatchObject({ passed: false });
});

test('console and page errors fail the measured check and listeners are removed', async ({ page }) => {
  await setupLifecycle(page);
  const original = listenerCount(page, 'console');
  const checking = runPlatformLevelChecks(page, 'injected-browser-error');
  await page.evaluate(() => {
    console.error('Deliberate platform-check regression');
    setTimeout(() => { throw new Error('Deliberate uncaught regression'); }, 0);
  });
  const results = await checking;
  const errors = results.find(result => result.checkName === 'No browser errors during platform checks');
  expect(errors?.passed).toBe(false);
  expect(errors?.error).toContain('Deliberate platform-check regression');
  expect(errors?.error).toContain('Deliberate uncaught regression');
  expect(listenerCount(page, 'console')).toBe(original);
});
