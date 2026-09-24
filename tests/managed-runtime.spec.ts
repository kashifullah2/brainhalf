import { expect, test, type Page } from '@playwright/test';
import { lifecycleProjects, setupLifecycle } from './fixtures/lifecycle';
import type { RuntimeStatus } from '../src/runtime/types';

const backendFiles = {
  ...lifecycleProjects[0].files,
  '/package.json': JSON.stringify({ private: true, scripts: { build: 'vite build' }, brainhalf: { runtime: 'workers' } }),
  '/worker/index.ts': 'export default { async fetch() { return new Response("saved backend"); } };',
};

function previewStatus(ready = false): RuntimeStatus {
  return {
    enabled: true, projectId: lifecycleProjects[0].id, environment: 'development',
    availability: { state: 'ready', message: 'Hosting is ready.' },
    capabilities: { sandbox: true, database: true, deployment: true, browser: true, secrets: true },
    jobs: ready ? [{ id: 'preview-job', kind: 'preview', environment: 'development', revision: 'saved-revision',
      status: 'running', previewReady: true, createdAt: 1, updatedAt: 1, leaseUntil: Date.now() + 60_000,
      processIds: [], message: 'App preview is running.' }] : [],
    releases: [], migrations: [], integrations: [], activeRelease: null, database: null, verification: null,
    previewUrl: '', productionUrl: '',
  };
}

async function reopenBackend(page: Page) {
  await page.evaluate(async ({ id, files }) => {
    const path = '/src/lib/project-store.ts';
    const store = await import(path);
    store.saveProjectFiles(id, files);
    await store.idbSet('files', id, files);
  }, { id: lifecycleProjects[0].id, files: backendFiles });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Design preview', { exact: true })).toBeVisible();
}

test('reopened backend starts one development preview using saved source', async ({ page }) => {
  await setupLifecycle(page);
  let status = previewStatus();
  const jobs: Array<{ environment: string | null; body: any }> = [];
  await page.route('**/api/projects/*/runtime/**', route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/jobs')) {
      jobs.push({ environment: url.searchParams.get('environment'), body: route.request().postDataJSON() });
      status = previewStatus(true);
      return route.fulfill({ json: { ok: true } });
    }
    return route.fulfill({ json: status });
  });
  await reopenBackend(page);
  const start = page.getByRole('button', { name: 'Start app preview', exact: true });
  await expect(start).toBeVisible();
  expect(jobs).toEqual([]);
  await expect(page.getByRole('button', { name: 'Refresh preview', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Open preview in a new tab' })).toBeDisabled();
  await start.click();
  await expect(page.getByRole('button', { name: 'Open app preview', exact: true })).toBeVisible();
  expect(jobs).toEqual([{ environment: 'development', body: { kind: 'preview', files: backendFiles } }]);
  await expect(page.getByRole('button', { name: 'Update app preview', exact: true })).toBeVisible();
});

for (const action of ['toolbar', 'button', 'blocked', 'switch'] as const) test(`managed preview opening handles ${action}`, async ({ page, context }) => {
  await setupLifecycle(page);
  let ticketRequests = 0;
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const target = 'https://managed-preview.example.test/__brainhalf/open?ticket=test-only';
  await context.route('https://managed-preview.example.test/**', route => route.fulfill({ contentType: 'text/html', body: '<h1>Running app</h1>' }));
  await page.route('**/api/projects/*/runtime/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/preview-ticket')) {
      ticketRequests++;
      expect(url.searchParams.get('environment')).toBe('development');
      expect(url.pathname).toContain(lifecycleProjects[0].id);
      expect(route.request().method()).toBe('POST');
      if (action === 'switch') await held;
      return route.fulfill({ json: { url: target } });
    }
    return route.fulfill({ json: previewStatus(true) });
  });
  await reopenBackend(page);
  const open = page.getByRole('button', { name: action === 'toolbar' ? 'Open preview in a new tab' : 'Open app preview', exact: true });
  await expect(open).toBeEnabled();
  if (action === 'blocked') {
    await page.evaluate(() => { window.open = () => null; });
    await open.click();
    await expect(page.getByText('Allow popups to open your app preview.', { exact: false })).toBeVisible();
    expect(ticketRequests).toBe(0);
    return;
  }
  const popupPromise = page.waitForEvent('popup');
  await open.click();
  const popup = await popupPromise;
  if (action === 'switch') {
    await expect.poll(() => ticketRequests).toBe(1);
    await page.route('**/api/projects/*/stop', route => route.fulfill({ json: { ok: true } }));
    await page.getByRole('button', { name: 'Return to Home', exact: true }).click();
    await page.getByRole('button', { name: 'Stop and close', exact: true }).click();
    await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
    await page.getByRole('button', { name: `Open ${lifecycleProjects[1].prompt}`, exact: true }).click();
    await expect(page.getByLabel('Message to the app builder')).toBeVisible();
    release();
    await expect.poll(() => popup.isClosed()).toBe(true);
    expect(popup.url()).toBe('about:blank');
  } else {
    await expect(popup).toHaveURL(target);
    await expect(popup.getByRole('heading', { name: 'Running app' })).toBeVisible();
    expect(await popup.evaluate(() => window.opener)).toBeNull();
    await popup.close();
  }
  expect(ticketRequests).toBe(1);
});

test('app preview start can be retried after a request fails', async ({ page }) => {
  await setupLifecycle(page);
  let requests = 0;
  await page.route('**/api/projects/*/runtime/**', route => {
    if (new URL(route.request().url()).pathname.endsWith('/jobs')) {
      requests++;
      return route.fulfill({ status: 503, json: { error: 'Hosting is temporarily unavailable. Try again.' } });
    }
    return route.fulfill({ json: previewStatus() });
  });
  await reopenBackend(page);
  const start = page.getByRole('button', { name: 'Start app preview', exact: true });
  await start.click();
  await expect(page.getByText('Hosting is temporarily unavailable. Try again.', { exact: false })).toBeVisible();
  await expect(start).toBeEnabled();
  await start.click();
  await expect.poll(() => requests).toBe(2);
});

test('running app preview controls fit a mobile screen', async ({ page }) => {
  await setupLifecycle(page);
  const status = previewStatus(true);
  status.jobs[0] = { ...status.jobs[0], status: 'stopped', previewReady: false, message: 'Stopped' };
  status.activeRelease = { id: 'saved-release', revision: 'saved-revision', environment: 'development', scriptName: 'app', createdAt: 1, databaseId: 'db', migrations: [], artifactKey: 'artifact' };
  await page.route('**/api/projects/*/runtime/**', route => route.fulfill({ json: status }));
  await reopenBackend(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  const explanation = page.locator('.preview-health-strip > span').filter({ hasText: 'Design preview' });
  expect((await explanation.boundingBox())!.width).toBeGreaterThan(250);
  await expect(explanation).toContainText('App preview is running.');
  for (const name of ['Open app preview', 'Update app preview']) {
    const button = page.getByRole('button', { name, exact: true });
    await expect(button).toBeVisible();
    const box = (await button.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    expect(box.y + box.height).toBeLessThanOrEqual(844);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'audit-artifacts/preview-flow-2026-09-25/mobile-regression.png' });
});

async function generateBackend(page: Page, socket: { send: (data: string) => void }, messages: Array<{ prompt?: string }>) {
  await page.getByLabel('Message to the app builder').fill('Add a persistent backend to this app');
  await page.getByLabel('Message to the app builder').press('Enter');
  const exportChoice = page.getByRole('button', { name: 'Build downloadable app', exact: true });
  await expect.poll(async () => messages.some(message => message.prompt) || await exportChoice.isVisible()).toBe(true);
  if (await exportChoice.isVisible()) {
    expect(messages.some(message => message.prompt)).toBe(false);
    await exportChoice.click();
  }
  await expect.poll(() => messages.some(message => message.prompt)).toBe(true);
  socket.send(JSON.stringify({ type: 'file_updated', path: '/package.json', content: JSON.stringify({ private: true, scripts: { build: 'vite build' }, brainhalf: { runtime: 'workers' } }) }));
  socket.send(JSON.stringify({ type: 'file_updated', path: '/worker/index.ts', content: 'export default { async fetch() { return new Response("ok"); } };' }));
  socket.send(JSON.stringify({ type: 'stream', chunk: { response: 'Backend source is ready.', done: true } }));
}
for (const ready of [true, false]) test(`agent-generated backend ${ready ? 'automatically starts development hosting' : 'honors pilot availability'}`, async ({ page }) => {
  const state = await setupLifecycle(page); const jobs: Array<{ environment: string | null; body: any }> = [];
  await page.route('**/api/projects/*/runtime/**', route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/jobs')) { jobs.push({ environment: url.searchParams.get('environment'), body: route.request().postDataJSON() }); return route.fulfill({ json: { ok: true } }); }
    return route.fulfill({ json: { enabled: ready, projectId: 'lifecycle-alpha', environment: 'development', availability: { state: ready ? 'ready' : 'pilot_only', message: ready ? 'Hosting is ready.' : 'Managed hosting is currently available to pilot accounts.' }, capabilities: {}, jobs: [], releases: [], migrations: [], integrations: [], activeRelease: null, database: null, verification: null } });
  });
  await generateBackend(page, state.sockets[0].socket, state.messages);
  if (ready) {
    await expect.poll(() => jobs.length).toBe(1);
    expect(jobs[0].environment).toBe('development'); expect(jobs[0].body.kind).toBe('preview'); expect(jobs[0].body.files['/worker/index.ts']).toContain('fetch');
    state.sockets[0].socket.send(JSON.stringify({ type: 'stream', chunk: { response: '', done: true } }));
    await expect.poll(() => jobs.length).toBe(1);
  } else {
    await expect(page.getByText('Managed hosting is currently available to pilot accounts.', { exact: false })).toBeVisible();
    expect(jobs).toEqual([]);
  }
  await expect(page.getByRole('button', { name: /Enable demo API|Disable demo API|Add Backend API/ })).toHaveCount(0);
});

test('frontend-only generations do not create hosting jobs', async ({ page }) => {
  const state = await setupLifecycle(page); const jobs: string[] = [];
  await page.route('**/api/projects/*/runtime/jobs*', route => { jobs.push(route.request().url()); return route.fulfill({ json: { ok: true } }); });
  await page.getByLabel('Message to the app builder').fill('Improve the heading'); await page.getByLabel('Message to the app builder').press('Enter');
  await expect.poll(() => state.messages.some(message => message.prompt)).toBe(true);
  state.sockets[0].socket.send(JSON.stringify({ type: 'stream', chunk: { response: '<file path="/src/App.jsx">export default () => <h1>Improved heading</h1>;</file>', done: true } }));
  await expect(page.getByRole('button', { name: 'Send message' })).toBeVisible(); expect(jobs).toEqual([]);
});

for (const action of ['stop', 'switch'] as const) test(`background hosting checks do not delay generation or replay it after ${action}`, async ({ page }) => {
  const state = await setupLifecycle(page);
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/projects/*/runtime/status*', async route => {
    await held;
    const url = new URL(route.request().url());
    // Workspace polling also reads this endpoint after the project switch.
    const status: RuntimeStatus = {
      enabled: true,
      projectId: url.pathname.split('/')[3],
      environment: url.searchParams.get('environment') === 'production' ? 'production' : 'development',
      availability: { state: 'ready', message: 'Ready' },
      capabilities: { sandbox: true, database: true, deployment: true, browser: true, secrets: true },
      jobs: [], releases: [], migrations: [], integrations: [],
      activeRelease: null, database: null, verification: null,
      previewUrl: '', productionUrl: '',
    };
    await route.fulfill({ json: status }).catch(() => {});
  });
  await page.route('**/api/projects/*/stop', route => route.fulfill({json:{ok:true}}));
  await page.reload({waitUntil:'domcontentloaded'});
  await page.getByLabel('Message to the app builder').fill('Add a persistent backend');
  await page.getByTestId('send-prompt-btn').click();
  await expect.poll(() => state.messages.filter(message => message.prompt).length).toBe(1);
  await expect(page.getByText('Checking hosting availability…', { exact: true })).toHaveCount(0);
  if (action === 'stop') await page.getByTestId('stop-generation-btn').click();
  else {
    await page.getByRole('button', { name: 'Return to Home', exact: true }).click();
    await page.getByRole('button', { name: 'Stop and close', exact: true }).click();
    await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
    await page.getByRole('button', { name: `Open ${lifecycleProjects[1].prompt}`, exact: true }).click();
  }
  release();
  await expect(page.getByTestId('send-prompt-btn')).toBeVisible();
  await page.getByLabel('Message to the app builder').fill('Update the heading');
  await page.getByTestId('send-prompt-btn').click();
  await expect.poll(() => state.messages.filter(message => message.prompt).length).toBe(2);
  expect(state.messages.filter(message => message.prompt).at(-1)).toMatchObject({ prompt: 'Update the heading', projectId: lifecycleProjects[action === 'stop' ? 0 : 1].id });
  await expect(page.getByRole('button', { name: 'Build downloadable app', exact: true })).toHaveCount(0);
});

test('generation timing distinguishes sending, model work and completed output', async ({ page }) => {
  const state = await setupLifecycle(page);
  await page.getByLabel('Message to the app builder').fill('Change the welcome heading');
  await page.getByTestId('send-prompt-btn').click();
  await expect.poll(() => state.messages.some(message => message.prompt)).toBe(true);
  const request = state.messages.find(message => message.prompt)! as any;
  state.sockets[0].socket.send(JSON.stringify({ type: 'generation_notice', stage: 'accepted', requestId: request.idempotencyKey, message: 'Preparing your app request…' }));
  state.sockets[0].socket.send(JSON.stringify({ type: 'generation_notice', stage: 'model', requestId: request.idempotencyKey, message: 'The app builder is working…' }));
  state.sockets[0].socket.send(JSON.stringify({ type: 'stream', chunk: { response: 'The welcome heading is ready.', done: true } }));
  await expect.poll(() => page.evaluate(() => {
    const key = Object.keys(localStorage).find(key => key.includes('generation-timing:'));
    return key ? JSON.parse(localStorage.getItem(key)!)[0] : null;
  })).toMatchObject({ id: request.idempotencyKey, outcome: 'completed', elapsed: { sent: expect.any(Number), accepted: expect.any(Number), model: expect.any(Number), activity: expect.any(Number) } });
  await expect(page.getByRole('button', { name: 'Send message' })).toBeVisible();
});

test('unavailable managed hosting offers an explicit download choice without automatic fallback', async ({ page }) => {
  const state = await setupLifecycle(page);
  await page.getByLabel('Message to the app builder').fill('Build a customer portal with login');
  await page.getByTestId('send-prompt-btn').click();
  await expect.poll(() => state.messages.filter(message => message.prompt).length).toBe(1);
  state.sockets[0].socket.send(JSON.stringify({ type: 'error', code: 'hosting_unavailable', error: 'Online app services are unavailable right now.' }));
  const choice = page.getByRole('button', { name: 'Build downloadable app', exact: true });
  await expect(choice).toBeVisible();
  expect(state.messages.filter(message => message.prompt)).toHaveLength(1);
  await choice.click();
  await expect.poll(() => state.messages.filter(message => message.prompt).length).toBe(2);
  expect(state.messages.filter(message => message.prompt).at(-1)).toMatchObject({ executionTarget: 'export' });
});
