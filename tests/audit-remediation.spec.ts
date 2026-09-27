import { openAdvanced } from './advanced-controls';
import { expect, test, type Page, type WebSocketRoute } from '@playwright/test';
import { setupPublication } from './fixtures/publication';
import { readProjectFiles } from './project-evidence';

const projectId = 'audit-regression';
const savedCode = 'export default function App() { return <h1>Manually edited</h1>; }';
const history = [
  { role: 'user', content: 'Build a dashboard' },
  { role: 'assistant', content: '<file path="/src/App.jsx">export default function App() { return <h1>Old version</h1>; }</file>' },
];

async function mockReadyHosting(page: Page) {
  // Recovery tests exercise backend prompts without depending on a live runtime.
  await page.route('**/api/projects/*/runtime/status*', route => {
    const url = new URL(route.request().url());
    return route.fulfill({ json: {
      enabled: true, projectId: url.pathname.split('/')[3],
      environment: url.searchParams.get('environment') || 'development',
      availability: { state: 'ready', message: 'Hosting is ready.' },
      capabilities: { sandbox: true, database: true, deployment: true, browser: true, secrets: true },
      jobs: [], releases: [], migrations: [], integrations: [],
      activeRelease: null, database: null, verification: null, previewUrl: '', productionUrl: '',
    } });
  });
}

async function setup(page: Page, ticketDelay: number | Promise<void> = 0, cacheFiles = true, realPreview = false, remote?: { files: Record<string, string>; empty?: boolean }) {
  const connections: WebSocketRoute[] = [];
  const messages: Array<Record<string, any>> = [];
  let closed = 0;
  let generation: Record<string, unknown> | undefined;
  let revision = 1;
  let serverFiles = remote?.files || {};
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (!['localhost', '127.0.0.1'].includes(url.hostname)) return route.abort();
    if (url.pathname === '/api/auth/session') return route.fulfill({ json: { user: { id: 'dev-user-1' } } });
    if (url.pathname === '/api/account/deletions') return route.fulfill({ json: { deletions: [] } });
    if (url.pathname === '/api/projects') return route.fulfill({ json: { projects: [{ id: projectId, name: 'Audit project', createdAt: 1, updatedAt: 1 }] } });
    if (url.pathname === `/api/projects/${projectId}/stop`) return route.fulfill({ json: { ok: true } });
    if (url.pathname === '/api/auth/ws-ticket') {
      if (typeof ticketDelay !== 'number') await ticketDelay;
      else if (ticketDelay) await new Promise(resolve => setTimeout(resolve, ticketDelay));
      return route.fulfill({ json: { ticket: 'bhwt_regression' } });
    }
    if (url.pathname.startsWith('/preview/')) return realPreview ? route.continue() : route.fulfill({ contentType: 'text/html', body: '<h1>Test preview</h1>' });
    return route.continue();
  });
  await page.routeWebSocket(/\/agents\//, socket => {
    connections.push(socket);
    socket.onMessage(message => {
      const data = JSON.parse(String(message));
      messages.push(data);
      if (!remote) return;
      if (data.type === 'get_files') socket.send(JSON.stringify({ type: 'files_snapshot', protocol: 2, requestId: data.requestId, revision, files: serverFiles, offset: 0, nextOffset: Object.keys(serverFiles).length, hasMore: false }));
      if (data.type === 'sync_files') {
        if (data.expected_revision !== revision) {
          socket.send(JSON.stringify({ type: 'files_sync_conflict', revision }));
          return;
        }
        serverFiles = data.replace_all ? data.files : { ...serverFiles, ...data.files };
        revision += 1;
        socket.send(JSON.stringify({ type: 'files_synced', revision }));
      }
    });
    socket.onClose(() => { closed += 1; });
    socket.send(JSON.stringify({ type: 'history', data: history, generation, ...(remote ? { workspaceSync: 'snapshot-v2', workspaceEmpty: remote.empty === true } : {}) }));
  });
  await page.addInitScript(({ projectId, savedCode, cacheFiles }) => {
    if (window !== window.top) return;
    localStorage.setItem('bh_session_token', 'bh_dev_local_token_not_a_real_session');
    localStorage.setItem('bh_session_user', JSON.stringify({ id: 'dev-user-1', email: 'dev@brainhalf.local' }));
    localStorage.setItem('brainhalf_account:dev-user-1:brainhalf_projects', JSON.stringify([{ id: projectId, name: 'Audit project', createdAt: Date.now(), updatedAt: Date.now() }]));
    localStorage.setItem('brainhalf_account:dev-user-1:brainhalf_active_project', projectId);
    if (cacheFiles) localStorage.setItem(`brainhalf_account:dev-user-1:brainhalf_files_${projectId}`, JSON.stringify({ '/src/App.jsx': savedCode }));
    else localStorage.removeItem(`brainhalf_account:dev-user-1:brainhalf_files_${projectId}`);
  }, { projectId, savedCode, cacheFiles });
  await page.goto(`/?project=${projectId}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByLabel('Message to the app builder')).toBeVisible();
  return { connections, messages, closed: () => closed, serverFiles: () => serverFiles, changeServer: (files: Record<string, string>) => { serverFiles = files; revision += 1; }, setGeneration: (value: Record<string, unknown>) => { generation = value; } };
}

test('chat controls and content fit narrow screens without hiding overflow', async ({ page }) => {
  const state = await setup(page);
  for (const width of [768, 390, 360, 320, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    await page.getByLabel('Message to the app builder').fill('Update this application without replacing unrelated features');
    for (const locator of [page.locator('.chat-panel-container'), page.getByLabel('Message to the app builder'), page.getByTestId('send-prompt-btn'), page.getByRole('button', { name: 'User profile and menu' })]) {
      await expect.poll(async () => {
        const box = await locator.boundingBox();
        return Boolean(box && box.x >= -1 && box.x + box.width <= width + 1);
      }).toBe(true);
    }
    if (width <= 768) {
      const target = await page.getByTestId('send-prompt-btn').boundingBox();
      expect(target!.height).toBeGreaterThanOrEqual(44);
    }
    const assertContained = async (testId: string) => {
      await expect.poll(() => page.getByTestId(testId).evaluate(button => {
        const composer = button.closest('.chat-input-wrapper')!;
        const wrapper = composer.getBoundingClientRect();
        const style = getComputedStyle(composer);
        const box = button.getBoundingClientRect();
        return box.left >= wrapper.left + parseFloat(style.paddingLeft) - 1
          && box.right <= wrapper.right - parseFloat(style.paddingRight) + 1
          && box.bottom <= wrapper.bottom - parseFloat(style.paddingBottom) + 1
          && Math.abs(box.width - box.height) <= 1;
      })).toBe(true);
    };
    await assertContained('send-prompt-btn');
    const promptsBefore = state.messages.filter(message => message.prompt).length;
    await page.getByTestId('send-prompt-btn').click();
    await expect.poll(() => state.messages.filter(message => message.prompt).length).toBe(promptsBefore + 1);
    await assertContained('stop-generation-btn');
    if (width <= 768) {
      const target = await page.getByTestId('stop-generation-btn').boundingBox();
      expect(target!.width).toBeGreaterThanOrEqual(44);
      expect(target!.height).toBeGreaterThanOrEqual(44);
    }
    const stopsBefore = state.messages.filter(message => message.type === 'stop').length;
    await page.getByTestId('stop-generation-btn').click();
    await expect.poll(() => state.messages.filter(message => message.type === 'stop').length).toBe(stopsBefore + 1);
    await expect(page.getByTestId('send-prompt-btn')).toBeVisible();
  }
});

test('manual backend and demo controls are removed', async ({ page }) => {
  await setup(page);
  await page.getByRole('button', { name: 'Code', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Add Backend API', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Enable demo API|Disable demo API/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Project actions', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Project settings', exact: true })).toHaveCount(0);
});

test('reconnect preserves differing local files until the server version is explicitly chosen', async ({ page }) => {
  const remote = { '/src/App.tsx': 'export default function App() { return <h1>Newer server application</h1>; }' };
  const state = await setup(page, 0, true, false, { files: remote });
  await expect(page.getByRole('button', { name: 'Use server files', exact: true })).toBeVisible();
  expect(state.messages.filter(message => message.type === 'sync_files')).toEqual([]);
  expect(await page.evaluate(projectId => JSON.parse(localStorage.getItem(`brainhalf_account:dev-user-1:brainhalf_files_${projectId}`)!)['/src/App.jsx'], projectId)).toBe(savedCode);
  await page.getByRole('button', { name: 'Use server files', exact: true }).click();
  await expect.poll(() => page.evaluate(projectId => JSON.parse(localStorage.getItem(`brainhalf_account:dev-user-1:brainhalf_files_${projectId}`)!), projectId)).toEqual(remote);
  await page.getByLabel('Message to the app builder').fill('Update the server application');
  await page.getByTestId('send-prompt-btn').click();
  await expect.poll(() => state.messages.filter(message => message.prompt).length).toBe(1);
  expect(state.messages.find(message => message.prompt)).not.toHaveProperty('workspaceFiles');
  expect(state.serverFiles()).toEqual(remote);
});

test('local conflict resolution checks the latest server revision before releasing a queued prompt', async ({ page }) => {
  const state = await setup(page, 0, true, false, { files: { '/src/App.jsx': 'first server version' } });
  await expect(page.getByRole('button', { name: 'Keep local files', exact: true })).toBeVisible();
  await page.getByLabel('Message to the app builder').fill('Continue my offline edits');
  await page.getByTestId('send-prompt-btn').click();
  expect(state.messages.filter(message => message.prompt)).toHaveLength(0);
  state.changeServer({ '/src/App.jsx': 'concurrent server edit' });
  await page.getByRole('button', { name: 'Keep local files', exact: true }).click();
  await expect.poll(() => state.messages.filter(message => message.type === 'sync_files').length).toBe(1);
  await expect(page.getByRole('button', { name: 'Keep local files', exact: true })).toBeVisible();
  expect(state.serverFiles()['/src/App.jsx']).toBe('concurrent server edit');
  expect(state.messages.filter(message => message.prompt)).toHaveLength(0);
  await page.getByRole('button', { name: 'Keep local files', exact: true }).click();
  await expect.poll(() => state.messages.filter(message => message.prompt).length).toBe(1);
  expect(state.messages.filter(message => message.type === 'sync_files').map(message => message.expected_revision)).toEqual([1, 2]);
  expect(state.serverFiles()['/src/App.jsx']).toBe(savedCode);
});

test('an empty server restores a local application before accepting prompts', async ({ page }) => {
  const state = await setup(page, 0, true, false, { files: {}, empty: true });
  await expect.poll(() => state.serverFiles()['/src/App.jsx']).toBe(savedCode);
  expect(state.messages.filter(message => message.type === 'sync_files')).toHaveLength(1);
  await expect(page.getByRole('button', { name: 'Keep local files', exact: true })).toHaveCount(0);
  await page.getByLabel('Message to the app builder').fill('Extend restored app');
  await page.getByTestId('send-prompt-btn').click();
  await expect.poll(() => state.messages.filter(message => message.prompt).length).toBe(1);
});

test('rapid workspace saves serialize against acknowledged server revisions', async ({ page }) => {
  const state = await setup(page, 0, true, false, { files: { '/src/App.jsx': 'server version' } });
  await page.getByRole('button', { name: 'Use server files', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Use server files', exact: true })).toHaveCount(0);
  await page.evaluate(async () => {
    const modulePath = '/src/lib/events.ts';
    const { appEvents } = await import(modulePath);
    for (const content of ['first edit', 'second edit', 'latest edit']) {
      appEvents.emit('sync-files', { files: { '/src/App.jsx': content }, replaceAll: false });
    }
  });
  await expect.poll(() => state.serverFiles()['/src/App.jsx']).toBe('latest edit');
  expect(state.messages.filter(message => message.type === 'sync_files').map(message => message.expected_revision)).toEqual([1, 2]);
  await expect(page.getByRole('button', { name: 'Keep local files', exact: true })).toHaveCount(0);
});

test('automatic continuation waits for completion and runs exactly once', async ({ page }) => {
  const state = await setup(page);
  await expect.poll(() => state.connections.length).toBe(1);
  await page.getByLabel('Message to the app builder').fill('Build a complete app');
  await page.getByTestId('send-prompt-btn').click();
  await expect.poll(() => state.messages.filter(message => message.prompt).length).toBe(1);
  state.connections[0].send(JSON.stringify({ type: 'generation_notice', message: 'Continuing incomplete application' }));
  state.connections[0].send(JSON.stringify({ type: 'trigger-auto-reply', message: 'Continue remaining app files' }));
  await page.waitForTimeout(100);
  expect(state.messages.filter(message => message.prompt)).toHaveLength(1);
  state.connections[0].send(JSON.stringify({ type: 'stream', chunk: { response: 'First batch completed.', done: true } }));
  await expect.poll(() => state.messages.filter(message => message.prompt).length).toBe(2);
  expect(state.messages.filter(message => message.prompt)[1].prompt).toBe('Continue remaining app files');
  state.connections[0].send(JSON.stringify({ type: 'stream', chunk: { response: 'Remaining files completed.', done: true } }));
  await expect(page.getByTestId('send-prompt-btn')).toBeVisible();
  expect(state.messages.filter(message => message.prompt)).toHaveLength(2);
});

test('history reload leaves current editor files unchanged', async ({ page }) => {
  const state = await setup(page);
  await expect.poll(() => state.connections.length).toBe(1);
  await expect(page.getByText('Build a dashboard', { exact: true })).toBeVisible();
  const files = await page.evaluate(projectId => JSON.parse(localStorage.getItem(`brainhalf_account:dev-user-1:brainhalf_files_${projectId}`)!), projectId);
  expect(files['/src/App.jsx']).toBe(savedCode);
});

test('mobile preview switching preserves the socket and receives generated files', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await setup(page);
  await expect.poll(() => state.connections.length).toBe(1);
  await page.getByRole('button', { name: 'Preview', exact: true }).first().click();
  await expect(page.getByTitle('Application Preview')).toBeVisible();
  state.connections[0].send(JSON.stringify({ type: 'file_updated', path: '/src/New.jsx', content: 'export default () => null;' }));
  await expect.poll(() => page.evaluate(projectId => JSON.parse(localStorage.getItem(`brainhalf_account:dev-user-1:brainhalf_files_${projectId}`)!)['/src/New.jsx'], projectId)).toBe('export default () => null;');
  await page.getByRole('button', { name: 'Chat', exact: true }).click();
  await expect(page.getByLabel('Message to the app builder')).toBeVisible();
  expect(state.connections).toHaveLength(1);
  expect(state.closed()).toBe(0);
});

test('a prompt queued before connection is sent only once', async ({ page }) => {
  const state = await setup(page, 1500);
  await page.getByLabel('Message to the app builder').fill('Add a graph');
  await page.getByTestId('send-prompt-btn').click();
  await expect.poll(() => state.messages.filter(message => message.prompt).length).toBe(1);
  await page.waitForTimeout(1200);
  const prompts = state.messages.filter(message => message.prompt);
  expect(prompts).toHaveLength(1);
  expect(prompts[0].idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
  await expect(page.getByText('Add a graph', { exact: true })).toBeVisible();
  state.connections[0].send(JSON.stringify({ type: 'stream', chunk: { response: 'The graph is ready.', done: true } }));
  await expect(page.getByText('The graph is ready.', { exact: true })).toBeVisible();
  await expect(page.getByText('Add a graph', { exact: true })).toBeVisible();
});

test('authoritative file updates are not replayed from chat edits or echoed to the server', async ({ page }) => {
  const state = await setup(page);
  await expect.poll(() => state.messages.some(message => message.type === 'sync_files')).toBe(true);
  await page.getByLabel('Message to the app builder').fill('Add one paragraph');
  await page.getByTestId('send-prompt-btn').click();
  await expect.poll(() => state.messages.some(message => message.prompt)).toBe(true);
  const syncCount = state.messages.filter(message => message.type === 'sync_files').length;
  const replacement = '<h1>Manually edited</h1><p>Added once</p>';
  const updated = savedCode.replace('<h1>Manually edited</h1>', replacement);
  state.connections[0].send(JSON.stringify({ type: 'stream', chunk: { response: 'Applying the requested change.\n', done: false } }));
  state.connections[0].send(JSON.stringify({ type: 'file_updated', path: '/src/App.jsx', content: updated }));
  await expect.poll(() => page.evaluate(projectId => JSON.parse(localStorage.getItem(`brainhalf_account:dev-user-1:brainhalf_files_${projectId}`)!)['/src/App.jsx'], projectId)).toBe(updated);
  state.connections[0].send(JSON.stringify({ type: 'stream', chunk: { response: `<edit path="/src/App.jsx"><search><h1>Manually edited</h1></search><replace>${replacement}</replace></edit>`, done: false } }));
  await page.waitForTimeout(80);
  state.connections[0].send(JSON.stringify({ type: 'stream', chunk: { response: '\nFinished.', done: true } }));
  await expect(page.getByTestId('send-prompt-btn')).toBeVisible();
  const files = await page.evaluate(projectId => JSON.parse(localStorage.getItem(`brainhalf_account:dev-user-1:brainhalf_files_${projectId}`)!), projectId);
  expect(files['/src/App.jsx']).toBe(updated);
  expect(state.messages.filter(message => message.type === 'sync_files')).toHaveLength(syncCount);
});

test('redacted file updates preserve locally stored content', async ({ page }) => {
  const state = await setup(page);
  await expect.poll(() => state.connections.length).toBe(1);
  const secret = 'API_KEY=test-only-local-secret';
  state.connections[0].send(JSON.stringify({ type: 'file_updated', path: '/server/.env', content: secret }));
  await expect.poll(() => page.evaluate(projectId => JSON.parse(localStorage.getItem(`brainhalf_account:dev-user-1:brainhalf_files_${projectId}`)!)['/server/.env'], projectId)).toBe(secret);
  state.connections[0].send(JSON.stringify({ type: 'file_updated', path: '/server/.env', redacted: true }));
  state.connections[0].send(JSON.stringify({ type: 'file_updated', path: '/src/AfterRedaction.js', content: 'export const ready = true;' }));
  await expect.poll(() => page.evaluate(projectId => JSON.parse(localStorage.getItem(`brainhalf_account:dev-user-1:brainhalf_files_${projectId}`)!)['/src/AfterRedaction.js'], projectId)).toBe('export const ready = true;');
  const files = await page.evaluate(projectId => JSON.parse(localStorage.getItem(`brainhalf_account:dev-user-1:brainhalf_files_${projectId}`)!), projectId);
  expect(files['/server/.env']).toBe(secret);
});

test('stop preserves completed file writes and ignores trailing stream text', async ({ page }) => {
  const state = await setup(page);
  await expect.poll(() => state.connections.length).toBe(1);
  await page.getByLabel('Message to the app builder').fill('Update the app');
  await page.getByTestId('send-prompt-btn').click();
  await expect.poll(() => state.messages.some(message => message.prompt)).toBe(true);
  const updated = 'export default function App() { return <h1>Completed write</h1>; }';
  state.connections[0].send(JSON.stringify({ type: 'file_updated', path: '/src/App.jsx', content: updated }));
  await expect.poll(() => page.evaluate(projectId => JSON.parse(localStorage.getItem(`brainhalf_account:dev-user-1:brainhalf_files_${projectId}`)!)['/src/App.jsx'], projectId)).toBe(updated);
  await page.getByTestId('stop-generation-btn').click();
  state.connections[0].send(JSON.stringify({ type: 'stream', chunk: { response: 'Late discarded response', done: true } }));
  await expect(page.getByTestId('send-prompt-btn')).toBeVisible();
  await expect(page.getByText('Late discarded response', { exact: true })).toHaveCount(0);
  const files = await page.evaluate(projectId => JSON.parse(localStorage.getItem(`brainhalf_account:dev-user-1:brainhalf_files_${projectId}`)!), projectId);
  expect(files['/src/App.jsx']).toBe(updated);
});

test('closing an active project confirms and stops the server generation', async ({ page }) => {
  const state = await setup(page);
  await expect.poll(() => state.connections.length).toBe(1);
  await page.getByLabel('Message to the app builder').fill('Keep building this project');
  await page.getByTestId('send-prompt-btn').click();
  await expect(page.getByTestId('stop-generation-btn')).toBeVisible();

  await page.getByRole('button', { name: 'Return to Home' }).click();
  const dialog = page.getByRole('dialog', { name: 'Stop generation and close project?' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Keep building' }).click();
  await expect(page.getByTestId('stop-generation-btn')).toBeVisible();
  expect(state.messages.filter(message => message.type === 'stop')).toHaveLength(0);

  await page.getByRole('button', { name: 'Return to Home' }).click();
  await dialog.getByRole('button', { name: 'Stop and close' }).click();
  await expect.poll(() => state.messages.filter(message => message.type === 'stop').length).toBe(1);
  await expect(page.getByRole('heading', { name: /Build the tools your business needs/ })).toBeVisible();
});

test('project stays open when shutdown is not acknowledged and can retry', async ({ page }) => {
  await setup(page);
  let confirmed = false;
  await page.route(`**/api/projects/${projectId}/stop`, route => route.fulfill({ status: confirmed ? 200 : 503, json: confirmed ? { ok: true } : { error: 'Could not confirm shutdown. Retry.' } }));
  await page.getByLabel('Message to the app builder').fill('Build a project');
  await page.getByTestId('send-prompt-btn').click();
  await page.getByRole('button', { name: 'Return to Home' }).click();
  const dialog = page.getByRole('dialog', { name: 'Stop generation and close project?' });
  await dialog.getByRole('button', { name: 'Stop and close' }).click();
  await expect(dialog).toContainText('Could not confirm shutdown. Retry.');
  await expect(page).toHaveURL(new RegExp(`project=${projectId}`));
  confirmed = true;
  await dialog.getByRole('button', { name: 'Stop and close' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('heading', { name: /Build the tools your business needs/ })).toBeVisible();
});

test('runtime polling recovers from temporary failure and resumes heartbeats and close protection', async ({ page }) => {
  await setup(page);
  let polls = 0; let heartbeats = 0;
  await page.route(`**/api/projects/${projectId}/runtime/**`, async route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/heartbeat')) { heartbeats++; return route.fulfill({ json: { ok: true } }); }
    polls++;
    if (polls === 1) return route.fulfill({ status: 503, json: { error: 'Temporary runtime interruption' } });
    return route.fulfill({ json: { enabled: true, projectId, environment: 'development', capabilities: { secrets: true }, database: null, migrations: [], jobs: [{ id: 'running', kind: 'build', status: 'running', environment: 'development', revision: 'abc12345', message: 'Building' }], releases: [], activeRelease: null, integrations: [], verification: null } });
  });
  await page.reload();
  await expect.poll(() => heartbeats, { timeout: 15_000 }).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Return to Home' }).click();
  await expect(page.getByRole('dialog', { name: 'Stop generation and close project?' })).toBeVisible();
});

test('stream errors cancel queued animation frames without losing the error or partial text', async ({ page }) => {
  const state = await setup(page);
  await expect.poll(() => state.connections.length).toBe(1);
  await page.getByLabel('Message to the app builder').fill('Start a response');
  await page.getByTestId('send-prompt-btn').click();
  await expect.poll(() => state.messages.some(message => message.prompt)).toBe(true);
  await page.evaluate(() => {
    const frames = new Map<number, FrameRequestCallback>();
    let nextFrame = 0;
    const nativeRequest = window.requestAnimationFrame;
    const nativeCancel = window.cancelAnimationFrame;
    window.requestAnimationFrame = callback => {
      nextFrame += 1;
      frames.set(nextFrame, callback);
      return nextFrame;
    };
    window.cancelAnimationFrame = frame => { frames.delete(frame); };
    (window as any).__releaseChatFrames = () => {
      window.requestAnimationFrame = nativeRequest;
      window.cancelAnimationFrame = nativeCancel;
      for (const callback of frames.values()) callback(performance.now());
      frames.clear();
    };
  });
  state.connections[0].send(JSON.stringify({ type: 'stream', chunk: { response: 'Work completed before failure.', done: false } }));
  await page.waitForTimeout(80);
  state.connections[0].send(JSON.stringify({ type: 'error', error: 'Provider unavailable now' }));
  await expect(page.locator('.ai-message').last()).toContainText('Provider unavailable now');
  await page.evaluate(() => (window as any).__releaseChatFrames());
  await expect(page.locator('.ai-message').last()).toContainText('Provider unavailable now');
  await expect(page.locator('.ai-message').last()).toContainText('Work completed before failure.');
});

test('clearing chat preserves the application files', async ({ page }) => {
  const state = await setup(page);
  await expect.poll(() => state.connections.length).toBe(1);
  await page.getByRole('button', { name: 'Conversation actions' }).click();
  await page.getByRole('menuitem', { name: 'Clear conversation', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Clear Chat', exact: true }).click();
  await expect.poll(() => state.messages.some(message => message.type === 'clear')).toBe(true);
  const files = await page.evaluate(projectId => JSON.parse(localStorage.getItem(`brainhalf_account:dev-user-1:brainhalf_files_${projectId}`)!), projectId);
  expect(files['/src/App.jsx']).toBe(savedCode);
});

test('stop cancels a prompt queued during ticket acquisition', async ({ page }) => {
  let release!: () => void;
  const state = await setup(page, new Promise<void>(resolve => { release = resolve; }));
  await page.getByLabel('Message to the app builder').fill('Never send this');
  await page.getByTestId('send-prompt-btn').click();
  await page.getByTestId('stop-generation-btn').click();
  release();
  await expect.poll(() => state.connections.length).toBe(1);
  await page.getByLabel('Message to the app builder').fill('Send after stop');
  await page.getByTestId('send-prompt-btn').click();
  await expect.poll(() => state.messages.filter(message => message.prompt).map(message => message.prompt)).toEqual(['Send after stop']);
});

test('leaving before the ticket arrives does not open an orphan socket', async ({ page }) => {
  const state = await setup(page, 1500);
  await page.getByRole('button', { name: 'Return to Home', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.waitForTimeout(1800);
  expect(state.connections).toHaveLength(0);
});

test('keyboard message editing preserves history until submission and supports cancel', async ({ page }) => {
  const state = await setup(page);
  await expect.poll(() => state.connections.length).toBe(1);
  const actions = page.getByRole('button', { name: 'More message actions' }).first();
  await actions.press('ArrowDown');
  const edit = page.getByRole('menuitem', { name: 'Edit message', exact: true });
  await edit.focus();
  await expect(edit).toBeFocused();
  await expect(edit.locator('..')).toHaveCSS('opacity', '1');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Cancel edit' })).toBeVisible();
  expect(state.messages.filter(message => message.type === 'rewrite_history')).toHaveLength(0);
  await page.getByRole('button', { name: 'Cancel edit' }).click();
  await expect(page.getByText('Build a dashboard', { exact: true })).toBeVisible();
  expect(state.messages.filter(message => message.type === 'rewrite_history')).toHaveLength(0);

  await actions.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.getByLabel('Message to the app builder').fill('Build a different dashboard');
  await page.getByTestId('send-prompt-btn').click();
  await expect.poll(() => state.messages.filter(message => message.prompt).length).toBe(1);
  expect(state.messages.filter(message => message.type === 'rewrite_history')).toHaveLength(1);
});

test('mobile landing can scroll to its footer and return to the composer', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 640 });
  await setup(page);
  await page.getByRole('button', { name: 'Return to Home', exact: true }).click();
  await page.getByRole('contentinfo').scrollIntoViewIfNeeded();
  await expect(page.getByRole('contentinfo')).toBeInViewport();
  await page.getByLabel('Describe your app', { exact: true }).focus();
  await expect(page.getByLabel('Describe your app', { exact: true })).toBeInViewport();
});

test('landing controls expose labels, visible focus and keyboard project activation', async ({ page }) => {
  await setup(page);
  await page.getByRole('button', { name: 'Return to Home', exact: true }).click();
  const composer = page.getByLabel('Describe your app', { exact: true });
  await composer.focus();
  await expect(page.locator('.landing-prompt-box')).toHaveCSS('box-shadow', /0px 0px 0px 3px/);
  await expect(page.getByRole('button', { name: 'File attachments unavailable' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Voice input unavailable' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
  const project = page.getByRole('button', { name: /^Open / }).first();
  await project.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Message to the app builder')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Voice input unavailable' })).toHaveCount(0);
});

test('enabled Publish text meets normal-text contrast', async ({ page }) => {
  await setup(page);
  const publish = page.getByRole('button', { name: 'Publish application', exact: true });
  await expect(publish).toBeEnabled();
  const ratio = await publish.evaluate(button => {
    const style = getComputedStyle(button);
    const luminance = (color: string) => {
      const channels = color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(channel => {
        const value = channel / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    };
    const foreground = luminance(style.color);
    const background = luminance(style.backgroundColor);
    return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
  });
  expect(ratio).toBeGreaterThanOrEqual(4.5);
});

test('fallback preview recovers after a render error and corrected file sync', async ({ page }) => {
  await page.route('**/*', route => {
    const hostname = new URL(route.request().url()).hostname;
    return ['localhost', '127.0.0.1'].includes(hostname) ? route.continue() : route.abort();
  });
  await page.goto('/?fallback-test=true', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    const frame = document.createElement('iframe');
    frame.title = 'Fallback regression';
    frame.src = '/preview/fallback-regression/index.html';
    document.body.append(frame);
  });
  const frame = page.frameLocator('iframe[title="Fallback regression"]');
  await expect(frame.locator('#root')).not.toBeEmpty();
  const sendFiles = (code: string) => page.evaluate(code => {
    const preview = document.querySelector<HTMLIFrameElement>('iframe[title="Fallback regression"]')!;
    preview.contentWindow!.postMessage({ type: 'sync-files', projectId: 'fallback-regression', files: { '/src/App.jsx': code } }, '*');
  }, code);
  await sendFiles('export default function App() { throw new Error("Regression failure"); }');
  await expect(frame.getByText('Preview Runtime Error', { exact: true })).toBeVisible();
  await sendFiles('export default function App() { return <h1>Recovered preview</h1>; }');
  await expect(frame.getByRole('heading', { name: 'Recovered preview' })).toBeVisible();
  await expect(frame.getByText('Preview Runtime Error', { exact: true })).toHaveCount(0);
});

for (const cacheFiles of [true, false]) {
  test(`IndexedDB restores files before workspace seeding with ${cacheFiles ? 'stale' : 'absent'} local cache`, async ({ page }) => {
    const state = await setup(page, 0, cacheFiles);
    await expect.poll(() => state.messages.some(message => message.type === 'sync_files')).toBe(true);
    const recovered = 'export default function App() { return <h1>Recovered from IndexedDB</h1>; }';
    await page.evaluate(async ({ projectId, recovered }) => {
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('BrainHalfStorage', 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction('files', 'readwrite');
          transaction.objectStore('files').put({ '/src/App.jsx': recovered }, `brainhalf_account:dev-user-1:${projectId}`);
          transaction.oncomplete = () => { database.close(); resolve(); };
          transaction.onerror = () => reject(transaction.error);
        };
      });
    }, { projectId, recovered });
    state.messages.length = 0;
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect.poll(() => page.evaluate(projectId => JSON.parse(localStorage.getItem(`brainhalf_account:dev-user-1:brainhalf_files_${projectId}`) || '{}')['/src/App.jsx'], projectId)).toBe(recovered);
    await expect.poll(() => state.messages.filter(message => message.type === 'sync_files').length).toBeGreaterThan(0);
    for (const message of state.messages.filter(message => message.type === 'sync_files')) {
      expect(message.files['/src/App.jsx']).toBe(recovered);
    }
  });
}

async function expectFocusContained(page: Page) {
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  for (let index = 0; index < 12; index += 1) {
    await page.keyboard.press(index < 6 ? 'Tab' : 'Shift+Tab');
    expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
  }
}

test('project rename and panel resize work entirely from the keyboard', async ({ page }) => {
  await setup(page);
  const rename = page.getByRole('button', { name: /^Rename project / });
  await rename.focus();
  await page.keyboard.press('Enter');
  await page.getByLabel('Rename project input').fill('Keyboard project');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Rename project Keyboard project' })).toBeVisible();
  const divider = page.getByRole('separator', { name: 'Resize chat panel' });
  await divider.focus();
  await page.keyboard.press('Home');
  const minimum = Number(await divider.getAttribute('aria-valuemin'));
  await expect(divider).toHaveAttribute('aria-valuenow', String(minimum));
  await page.keyboard.press('ArrowRight');
  await expect(divider).toHaveAttribute('aria-valuenow', String(minimum + 10));
  await page.keyboard.press('End');
  await expect(divider).toHaveAttribute('aria-valuenow', (await divider.getAttribute('aria-valuemax'))!);
});

test('deploy and agent tools dialogs contain focus and restore their triggers', async ({ page }) => {
  await setup(page);
  const publish = page.getByRole('button', { name: 'Publish application', exact: true });
  await publish.click();
  await expectFocusContained(page);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(publish).toBeFocused();
  const plusBtn = page.getByRole('button', { name: 'Add and configure options', exact: true });
  await plusBtn.click();
  const skillsItem = page.getByRole('menuitem', { name: 'Upload skills', exact: true });
  await skillsItem.click();
  await expectFocusContained(page);
  await page.keyboard.press('Escape');
});

test('one Publish click starts publication and it can be cancelled before going live', async ({ page }) => {
  const state = await setup(page);
  const publishing = await setupPublication(page);
  state.connections[0].send(JSON.stringify({ type: 'file_updated', path: '/package.json', content: '{"scripts":{"build":"vite build"}}' }));
  await expect.poll(async () => (await readProjectFiles(page, 'dev-user-1', projectId))?.['/package.json']).toBeTruthy();
  expect(publishing.submitted).toEqual([]);
  await page.getByRole('button', { name: 'Publish application', exact: true }).click();
  const publication = page.getByRole('region', { name: 'Project publication' });
  await publication.getByRole('button', { name: /Skip/ }).click();
  await expect(publication.getByRole('button', { name: 'Cancel publishing' })).toBeVisible();
  expect(publishing.submitted).toHaveLength(1);
  await publication.getByRole('button', { name: 'Cancel publishing' }).click();
  await expect(publication.getByText('Publishing cancelled').first()).toBeVisible();
  await expect(publication.getByRole('link')).toHaveCount(0);
});

test('publication ownership failures preserve the session without exposing a public URL', async ({ page }) => {
  const state = await setup(page);
  const publishing = await setupPublication(page, true);
  state.connections[0].send(JSON.stringify({ type: 'file_updated', path: '/package.json', content: '{"scripts":{"build":"vite build"}}' }));
  await expect.poll(async () => (await readProjectFiles(page, 'dev-user-1', projectId))?.['/package.json']).toBeTruthy();
  await page.getByRole('button', { name: 'Publish application', exact: true }).click();
  const publication = page.getByRole('region', { name: 'Project publication' });
  await publication.getByRole('button', { name: /Skip/ }).click();
  await expect(publication.getByRole('alert')).toHaveText('Not the project owner');
  expect(publishing.submitted).toHaveLength(1);
  expect(await page.evaluate(() => localStorage.getItem('bh_session_token'))).toBeTruthy();
  await expect(publication.getByRole('link')).toHaveCount(0);
});

test('dashboard rename and confirmation dialogs trap and restore focus', async ({ page }) => {
  await setup(page);
  await page.getByRole('button', { name: 'Return to Home', exact: true }).click();
  await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
  const actions = page.getByRole('button', { name: 'Project actions' }).first();
  await actions.click();
  await page.getByRole('button', { name: 'Rename', exact: true }).click();
  await expect(page.getByLabel('Project name', { exact: true })).toBeFocused();
  await expectFocusContained(page);
  await page.keyboard.press('Escape');
  await expect(actions).toBeFocused();
  await actions.click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expectFocusContained(page);
  await page.keyboard.press('Escape');
  await expect(actions).toBeFocused();
});

test('login dialog remains usable in a short viewport and restores focus', async ({ page }) => {
  await page.setViewportSize({ width: 720, height: 320 });
  await page.route('**/*', route => {
    const hostname = new URL(route.request().url()).hostname;
    return ['localhost', '127.0.0.1'].includes(hostname) ? route.continue() : route.abort();
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const signIn = page.getByRole('button', { name: 'Sign in', exact: true });
  await signIn.click();
  await expectFocusContained(page);
  const submit = page.getByRole('dialog').getByRole('button', { name: /Sign in|Log in/ }).first();
  await submit.scrollIntoViewIfNeeded();
  const bounds = await submit.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(320);
  await page.keyboard.press('Escape');
  await expect(signIn).toBeFocused();
});

test('reset is explicitly labelled and cancelling preserves files', async ({ page }) => {
  await setup(page);
  await expect(page.getByRole('button', { name: 'Reset workspace to default' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Project actions', exact: true }).click();
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('menuitem', { name: 'Reset workspace', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  const files = await page.evaluate(projectId => JSON.parse(localStorage.getItem(`brainhalf_account:dev-user-1:brainhalf_files_${projectId}`)!), projectId);
  expect(files['/src/App.jsx']).toBe(savedCode);
});

test('chat status is announced and compact actions have usable hit areas', async ({ page }) => {
  const state = await setup(page);
  await expect.poll(() => state.connections.length).toBe(1);
  const status = page.getByTestId('model-status-pill');
  await expect(status).toHaveAttribute('role', 'status');
  await expect(status).toHaveAttribute('aria-live', 'polite');
  for (const name of ['Conversation actions', 'Copy message', 'Project actions']) {
    const target = page.getByRole('button', { name, exact: true }).first();
    await expect(target).toBeVisible();
    const bounds = await target.boundingBox();
    expect(bounds!.width).toBeGreaterThanOrEqual(28);
    expect(bounds!.height).toBeGreaterThanOrEqual(28);
  }
});

test('snapshot pages apply atomically and preserve edits made while downloading', async ({ page }) => {
  const state = await setup(page);
  await expect.poll(() => state.connections.length).toBe(1);
  state.connections[0].send(JSON.stringify({ type: 'files_changed' }));
  await expect.poll(() => state.messages.filter(message => message.type === 'get_files').length).toBe(1);
  const request = state.messages.find(message => message.type === 'get_files')!;
  const firstPage = Object.fromEntries(Array.from({ length: 200 }, (_, index) => [`/src/page-${index}.js`, `export const value = ${index};`]));
  state.connections[0].send(JSON.stringify({ type: 'files_snapshot', protocol: 2, requestId: request.requestId, revision: 400, files: firstPage, offset: 0, nextOffset: 200, hasMore: true }));
  await expect.poll(() => state.messages.filter(message => message.type === 'get_files').length).toBe(2);
  const readFiles = () => page.evaluate(projectId => JSON.parse(localStorage.getItem(`brainhalf_account:dev-user-1:brainhalf_files_${projectId}`)!), projectId);
  expect(await readFiles()).toEqual({ '/src/App.jsx': savedCode });
  await page.evaluate(async projectId => {
    const modulePath = '/src/lib/events.ts';
    const { appEvents } = await import(modulePath);
    appEvents.emit('workspace-files-changed', { projectId, files: { '/src/App.jsx': 'local concurrent edit', '/src/local.js': 'new local file' } });
  }, projectId);
  state.connections[0].send(JSON.stringify({ type: 'files_snapshot', protocol: 2, requestId: request.requestId, revision: 400, files: { '/src/App.jsx': 'outdated server edit', '/src/last.js': 'last page' }, offset: 200, nextOffset: 202, hasMore: false }));
  await expect.poll(async () => Object.keys(await readFiles()).length).toBe(203);
  expect((await readFiles())['/src/App.jsx']).toBe('local concurrent edit');
  expect((await readFiles())['/src/local.js']).toBe('new local file');
  expect((await readFiles())['/src/last.js']).toBe('last page');
});

test('interrupted or legacy partial snapshots never erase local files', async ({ page }) => {
  const state = await setup(page);
  await expect.poll(() => state.connections.length).toBe(1);
  state.connections[0].send(JSON.stringify({ type: 'files_snapshot', files: { '/src/partial.js': 'partial' }, hasMore: true }));
  state.connections[0].send(JSON.stringify({ type: 'files_changed' }));
  await expect.poll(() => state.messages.filter(message => message.type === 'get_files').length).toBe(1);
  const request = state.messages.find(message => message.type === 'get_files')!;
  state.connections[0].send(JSON.stringify({ type: 'files_snapshot', protocol: 2, requestId: request.requestId, revision: 4, files: { '/src/partial.js': 'partial' }, offset: 0, nextOffset: 1, hasMore: true }));
  await expect.poll(() => state.messages.filter(message => message.type === 'get_files').length).toBe(2);
  state.connections[0].close();
  await expect.poll(() => state.closed()).toBeGreaterThan(0);
  const files = await page.evaluate(projectId => JSON.parse(localStorage.getItem(`brainhalf_account:dev-user-1:brainhalf_files_${projectId}`)!), projectId);
  expect(files).toEqual({ '/src/App.jsx': savedCode });
});

test('stale snapshot retries ignore old responses and commit a complete empty workspace', async ({ page }) => {
  const state = await setup(page);
  await expect.poll(() => state.connections.length).toBe(1);
  state.connections[0].send(JSON.stringify({ type: 'files_changed' }));
  await expect.poll(() => state.messages.filter(message => message.type === 'get_files').length).toBe(1);
  const first = state.messages.find(message => message.type === 'get_files')!;
  state.connections[0].send(JSON.stringify({ type: 'files_snapshot_stale', requestId: first.requestId }));
  await expect.poll(() => state.messages.filter(message => message.type === 'get_files').length).toBe(2);
  const second = state.messages.filter(message => message.type === 'get_files')[1];
  expect(second.requestId).not.toBe(first.requestId);
  state.connections[0].send(JSON.stringify({ type: 'files_snapshot', protocol: 2, requestId: first.requestId, revision: 2, files: { '/src/old.js': 'stale' }, offset: 0, nextOffset: 1, hasMore: false }));
  state.connections[0].send(JSON.stringify({ type: 'files_snapshot', protocol: 2, requestId: second.requestId, revision: 3, files: {}, offset: 0, nextOffset: 0, hasMore: false }));
  await expect.poll(() => page.evaluate(projectId => JSON.parse(localStorage.getItem(`brainhalf_account:dev-user-1:brainhalf_files_${projectId}`)!), projectId)).toEqual({});
});

test('fallback preview renders generated TSX beside a JSX starter', async ({ page }) => {
  await setup(page, 0, true, true);
  await page.evaluate(() => {
    const frame = document.createElement('iframe');
    frame.title = 'TSX selection regression';
    frame.src = '/preview/tsx-selection/index.html';
    document.body.append(frame);
  });
  const frame = page.frameLocator('iframe[title="TSX selection regression"]');
  await expect(frame.locator('#root')).not.toBeEmpty();
  await page.evaluate(() => {
    const preview = document.querySelector<HTMLIFrameElement>('iframe[title="TSX selection regression"]')!;
    preview.contentWindow!.postMessage({ type: 'sync-files', projectId: 'tsx-selection', files: {
      '/src/App.jsx': 'export default function App() { return <h1>What do you want to build?</h1>; }',
      '/src/main.jsx': "import App from './App.jsx';",
      '/src/App.tsx': 'export default function App() { const title: string = "Generated TypeScript app"; return <h1>{title}</h1>; }',
    } }, '*');
  });
  await expect(frame.getByRole('heading', { name: 'Generated TypeScript app' })).toBeVisible();
  await expect(frame.getByRole('heading', { name: 'What do you want to build?' })).toHaveCount(0);
});

test('persisted file revisions reach the active preview, including after its listener loads', async ({ page }) => {
  const state = await setup(page);
  await expect.poll(() => state.connections.length).toBe(1);
  const preview = page.frameLocator('iframe[title="Application Preview"]');
  await expect(preview.getByRole('heading', { name: 'Test preview' })).toBeVisible();
  await preview.locator('body').evaluate(() => {
    (window as any).__revisions = [];
    window.addEventListener('message', event => {
      if (event.data?.type === 'preview-revision') (window as any).__revisions.push(event.data.revision);
    });
  });
  state.connections[0].send(JSON.stringify({ type: 'files_synced', revision: 12 }));
  await expect.poll(() => preview.locator('body').evaluate(() => (window as any).__revisions)).toContain(12);
  await preview.locator('body').evaluate(() => {
    (window as any).__revisions = [];
    window.parent.postMessage({ type: 'request-preview-revision' }, location.origin);
  });
  await expect.poll(() => preview.locator('body').evaluate(() => (window as any).__revisions)).toEqual([12]);
});

test('actual preview render errors stay visible until recovery and do not leak across projects', async ({ page }) => {
  const state = await setup(page, 0, true, true);
  await expect.poll(() => state.connections.length).toBe(1);
  const preview = page.frameLocator('iframe[title="Application Preview"]');
  await expect(preview.getByRole('heading', { name: 'Manually edited' })).toBeVisible();
  const syncSource = (source: string) => page.evaluate(source => {
    document.querySelector<HTMLIFrameElement>('iframe[title="Application Preview"]')!.contentWindow!.postMessage({ type: 'sync-files', projectId: 'audit-regression', files: { '/src/App.jsx': source } }, '*');
  }, source);
  await syncSource('export default function App() { throw new Error("Visible preview failure"); }');
  await expect(preview.getByText('Preview Runtime Error', { exact: true })).toBeVisible();
  await expect(page.getByTestId('model-status-pill')).toHaveText('Error');
  await expect(page.getByTestId('model-status-pill')).toHaveText('Error');
  state.connections[0].send(JSON.stringify({ type: 'history', data: history }));
  await expect(page.getByText('Build a dashboard', { exact: true })).toBeVisible();
  await page.waitForTimeout(200);
  await expect(page.getByTestId('model-status-pill')).toHaveText('Error');
  await syncSource('export default function App() { return <h1>Recovered actual preview</h1>; }');
  await expect(preview.getByRole('heading', { name: 'Recovered actual preview' })).toBeVisible();
  await expect(page.getByTestId('model-status-pill')).toHaveText('Ready');
  await page.evaluate(async () => {
    const modulePath = '/src/lib/events.ts';
    const { appEvents } = await import(modulePath);
    appEvents.emit('generation-status', { status: 'Error', projectId: 'different-project', error: 'Other project failed' });
  });
  await expect(page.getByTestId('model-status-pill')).toHaveText('Ready');
});

for (const response of ['', 'I am building your app. ']) test(`refresh resumes an active generation without an empty-reply error (${response ? 'streaming' : 'waiting'})`, async ({ page }) => {
  const state = await setup(page);
  await mockReadyHosting(page);
  const prompt = 'Build a habit tracker with weekly progress';
  await page.getByLabel('Message to the app builder').fill(prompt);
  await page.getByTestId('send-prompt-btn').click();
  await expect.poll(() => state.messages.filter(message => message.prompt).length).toBe(1);
  state.setGeneration({ id: 'live-request', model: '@cf/deepseek-ai/deepseek-v4-pro-0813', prompt, response, startedAt: Date.now(), filesChanged: false, truncated: false });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect.poll(() => state.connections.length).toBe(2);
  await expect(page.getByTestId('model-status-pill')).toHaveText('Building');
  await expect(page.getByText('No response received', { exact: true })).toHaveCount(0);
  state.connections[1].send(JSON.stringify({ type: 'stream', chunk: { response: 'Your habit tracker is ready.', done: true } }));
  await expect(page.getByText(response + 'Your habit tracker is ready.', { exact: true })).toBeVisible();
  await expect(page.getByTestId('model-status-pill')).toHaveText('Ready');
  await expect(page.getByText(prompt, { exact: true })).toHaveCount(1);
  expect(state.messages.filter(message => message.prompt)).toHaveLength(1);
  expect(state.messages.filter(message => message.type === 'rewrite_history')).toHaveLength(0);
});

test('empty replies show recovery, survive reload, and retry the saved prompt once', async ({ page }) => {
  const state = await setup(page, 0, false);
  await mockReadyHosting(page);
  await page.getByLabel('Message to the app builder').fill('Build a habit tracker with weekly progress');
  await page.getByTestId('send-prompt-btn').click();
  await expect.poll(() => state.messages.filter(message => message.prompt).length).toBe(1);
  state.connections[0].send(JSON.stringify({ type: 'stream', chunk: { response: ' \n ', done: true } }));
  await expect(page.getByText('No response received', { exact: true })).toBeVisible();
  await expect(page.getByTestId('model-status-pill')).toContainText('Error');
  await expect(page.getByText("Your app hasn't been built yet.", { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Refresh preview', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Change model', exact: true }).click();
  await expect(page.getByRole('listbox')).toBeVisible();
  expect(state.messages.filter(message => message.prompt)).toHaveLength(1);
  await page.keyboard.press('Escape');
  // Reload must recover the failure from saved content, not a transient React flag.
  const saved = await page.evaluate(projectId => JSON.parse(localStorage.getItem(`brainhalf_account:dev-user-1:brainhalf_messages_${projectId}`)!), projectId);
  expect(saved[saved.length - 1].content).toContain('didn’t return a response');
  await page.reload({ waitUntil: 'networkidle' });
  await expect.poll(() => state.connections.length).toBe(2);
  await expect(page.getByTestId('model-status-pill')).toContainText('Error');
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect.poll(() => state.messages.filter(message => message.prompt).length).toBe(2);
  expect(state.messages.filter(message => message.prompt)[1].prompt).toBe('Build a habit tracker with weekly progress');
  state.connections[1].send(JSON.stringify({ type: 'file_updated', path: '/src/App.tsx', content: 'export default function App(){ return <h1>Habit tracker</h1>; }' }));
  state.connections[1].send(JSON.stringify({ type: 'stream', chunk: { response: '', done: true } }));
  await expect(page.getByText('Application files updated. Open the preview to review your changes.', { exact: true })).toBeVisible();
  await expect(page.getByTestId('model-status-pill')).not.toContainText('Error');
  await expect(page.locator('.studio-preview-empty')).toHaveCount(0);
});

test('message tools share a header above the text on touch screens and editing remains usable', async ({ page }) => {
  await setup(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    const message = page.locator('.chat-message-user').first();
    const geometry = await message.evaluate(element => {
      const textNode = element.querySelector('.studio-user-message-text')!;
      const range = document.createRange();
      range.selectNodeContents(textNode);
      return { textTop: range.getBoundingClientRect().top, actionsBottom: element.querySelector('.studio-message-meta .studio-message-actions')!.getBoundingClientRect().bottom };
    });
    expect(geometry.actionsBottom).toBeLessThanOrEqual(geometry.textTop);
    await page.getByRole('button', { name: 'More message actions' }).first().click();
    const edit = page.getByRole('menuitem', { name: 'Edit message', exact: true });
    await edit.click();
    await expect(page.getByLabel('Message to the app builder')).toHaveValue('Build a dashboard');
    await expect(page.getByLabel('Message to the app builder')).toBeFocused();
    await page.getByRole('button', { name: 'Cancel edit', exact: true }).click();
  }
});

test('empty preview opens and focuses chat on mobile', async ({ page }) => {
  await setup(page, 0, false);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Preview', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Describe your app', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Describe your app', exact: true }).click();
  await expect(page.getByLabel('Message to the app builder')).toBeVisible();
  await expect(page.getByLabel('Message to the app builder')).toBeFocused();
});

test('appearance: theme follows the system, persists a choice, and keeps account screens readable on mobile', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'Switch to light mode' }).click();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  const otherTab = await page.context().newPage();
  await otherTab.goto('/');
  await expect(otherTab.locator('html')).toHaveAttribute('data-theme', 'light');
  await otherTab.getByRole('button', { name: 'Switch to dark mode' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await otherTab.close();
  await page.getByRole('button', { name: 'Get Started', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Continue with Google', exact: true })).toBeVisible();
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    for (const theme of ['light', 'dark']) {
      const current = await page.locator('html').getAttribute('data-theme');
      if (current !== theme) await dialog.getByRole('button', { name: `Switch to ${theme} mode` }).click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expect(dialog.getByRole('button', { name: 'Create account', exact: true })).toBeInViewport();
      await expect(dialog).toHaveJSProperty('scrollWidth', width);
      await expect(dialog.getByLabel('Email Address')).toHaveCSS('background-color', theme === 'dark' ? 'rgb(25, 34, 48)' : 'rgb(255, 255, 255)');
      await dialog.screenshot({ path: `/tmp/brainhalf-auth-${theme}-${width}.png` });
    }
  }
  await dialog.getByRole('button', { name: 'Continue with Google', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Please continue with email');
  await expect(dialog.getByRole('button', { name: 'Continue with Google', exact: true })).toBeEnabled();
  await dialog.getByRole('tab', { name: 'Sign in', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Continue with Google', exact: true })).toBeVisible();
  await dialog.getByRole('tab', { name: 'Sign in', exact: true }).press('ArrowRight');
  await expect(dialog.getByRole('tab', { name: 'Sign up', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  for (const theme of ['light', 'dark']) {
    if (await page.locator('html').getAttribute('data-theme') !== theme) await page.getByRole('button', { name: `Switch to ${theme} mode` }).click();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({ path: `/tmp/brainhalf-landing-${theme}.png`, fullPage: true, animations: 'disabled' });
    await page.setViewportSize({ width: 320, height: 844 });
    expect(await page.evaluate(() => document.body.scrollWidth)).toBe(320);
  }
});

test('appearance: workspace, code editor and agent tools share the selected theme', async ({ page }) => {
  await setup(page);
  for (const theme of ['dark', 'light']) {
    if (await page.locator('html').getAttribute('data-theme') !== theme) await page.getByRole('button', { name: `Switch to ${theme} mode` }).click();
    await page.getByRole('button', { name: 'Code', exact: true }).click();
    await expect(page.locator('.monaco-editor').first()).toBeVisible();
    await expect(page.locator('.monaco-editor').first()).toHaveCSS('background-color', theme === 'dark' ? 'rgb(34, 37, 34)' : 'rgb(255, 255, 255)');
    await page.screenshot({ path: `/tmp/brainhalf-workspace-${theme}.png`, fullPage: true });
    await openAdvanced(page);
    await page.screenshot({ path: `/tmp/brainhalf-agent-tools-${theme}.png`, fullPage: true });
  }
  for (const width of [768, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.getByRole('button', { name: 'Chat', exact: true }).click();
    await expect(page.getByRole('button', { name: /Switch to .* mode/ })).toBeInViewport();
    const overflow = await page.locator('.top-nav').evaluate(element => element.scrollWidth > element.clientWidth);
    expect(overflow).toBe(false);
    const metadata = page.locator('.studio-artifact-identity > div:last-child > span:last-child').first();
    expect(await metadata.evaluate(element => element.getBoundingClientRect().height)).toBeLessThan(35);
    await expect(page.locator('.studio-artifact-path').first()).toBeInViewport();
    for (const theme of ['dark', 'light']) {
      if (await page.locator('html').getAttribute('data-theme') !== theme) await page.getByRole('button', { name: `Switch to ${theme} mode` }).click();
      await page.screenshot({ path: `/tmp/brainhalf-themed-workspace-${theme}-${width}.png`, fullPage: true, animations: 'disabled' });
    }
  }
});

test('Google return: a single exchange restores the session and saved idea', async ({ page }) => {
  let exchanges = 0;
  const prompt = 'Build a small reading list with notes';
  await page.addInitScript(prompt => {
    if (window === window.top) sessionStorage.setItem('bh_google_pending_prompt', JSON.stringify({ prompt, appType: 'web', savedAt: Date.now() }));
  }, prompt);
  await page.route('**/api/auth/google/complete', route => { exchanges += 1; return route.fulfill({ json: { token: 'bh_test_google_session', user: { id: 'google-user', email: 'google@example.com' } } }); });
  await page.route('**/api/projects', route => route.fulfill({ json: { projects: [] } }));
  await page.route('**/api/auth/ws-ticket', route => route.fulfill({ json: { ticket: 'bhwt_test' } }));
  await page.routeWebSocket(/\/agents\//, socket => { socket.send(JSON.stringify({ type: 'history', data: [] })); socket.onMessage(() => {}); });
  await page.goto('/?google=complete');
  await expect(page.getByLabel('Message to the app builder')).toBeVisible();
  await expect(page.getByText(prompt, { exact: true })).toBeVisible();
  expect(exchanges).toBe(1);
  expect(page.url()).not.toContain('google=');
  expect(await page.evaluate(() => sessionStorage.getItem('bh_google_pending_prompt'))).toBeNull();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('bh_session_user')!).id)).toBe('google-user');
});

test('Google return: cancellation offers email sign-in', async ({ page }) => {
  await page.goto('/?google=cancelled');
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Google sign-in was cancelled');
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Sign in', exact: true })).toBeEnabled();
  expect(page.url()).not.toContain('google=');
});

for (const theme of ['light', 'dark']) test(`landing prompt works on desktop and mobile in ${theme} mode`, async ({ page }) => {
  await page.emulateMedia({ colorScheme: theme as 'light' | 'dark', reducedMotion: 'reduce' });
  await page.route('**/*', route => ['localhost', '127.0.0.1'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  const hero = page.getByRole('region', { name: 'Build the tools your business needs.', exact: true });
  const form = hero.locator('form');
  const input = hero.getByRole('textbox', { name: 'Describe your app' });
  const submit = hero.getByRole('button', { name: 'Create app from prompt' });
  await expect(hero.getByRole('heading', { level: 1 })).toHaveCount(1);
  await expect(hero.getByRole('textbox')).toHaveCount(1);
  await expect(form.getByRole('textbox')).toHaveCount(1);
  await expect(form.getByRole('button')).toHaveCount(1);
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  await expect(submit).toBeDisabled();
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(input).toBeInViewport();
    const box = await submit.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `/tmp/brainhalf-input-hero-${theme}-${width}.png`, fullPage: true });
  }
  await input.fill('Build a real-time chat app');
  await input.press('Shift+Enter');
  await input.pressSequentially('Include user presence');
  await expect(input).toHaveValue('Build a real-time chat app\nInclude user presence');
  await expect(submit).toBeEnabled();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await input.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(errors).toEqual([]);
});
