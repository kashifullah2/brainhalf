import { expect, test } from '@playwright/test';
import { accountId, lifecycleProjects, setupLifecycle } from './fixtures/lifecycle';
import { readProjectFiles } from './project-evidence';

test('deletion retains recovery files on failure and awaits a successful authenticated retry', async ({ page }) => {
  const state = await setupLifecycle(page);
  const project = lifecycleProjects[0];
  await page.getByRole('button', { name: 'Return to Home', exact: true }).click();
  await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
  const card = page.locator('.landing-project-card').filter({ hasText: project.prompt });
  await card.getByRole('button', { name: 'Project actions' }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.route(`**/api/projects/${project.id}`, route => route.fulfill({ status: 503, json: { error: 'Controlled deletion failure' } }));
  await page.getByRole('dialog').getByRole('button', { name: 'Delete Project' }).click();
  await expect(page.getByRole('alert')).toHaveText('Controlled deletion failure');
  expect(await readProjectFiles(page, accountId, project.id)).toEqual(project.files);
  await expect(card).toBeVisible();
  await page.unroute(`**/api/projects/${project.id}`);
  let finish!: () => void;
  const delay = new Promise<void>(resolve => { finish = resolve; });
  await page.route(`**/api/projects/${project.id}`, async route => { await delay; await route.fallback(); });
  await page.getByRole('dialog').getByRole('button', { name: 'Delete Project' }).click();
  await expect(page.getByRole('button', { name: 'Deleting…' })).toBeDisabled();
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Cancel' })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(await readProjectFiles(page, accountId, project.id)).toEqual(project.files);
  finish();
  await expect(card).toHaveCount(0);
  expect(state.deletions).toEqual([project.id]);
  await expect.poll(() => readProjectFiles(page, accountId, project.id)).toBeNull();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect.poll(() => new URL(page.url()).searchParams.get('project')).toBe(lifecycleProjects[1].id);
  expect(await readProjectFiles(page, accountId, project.id)).toBeNull();
  await page.getByRole('button', { name: 'Return to Home', exact: true }).click();
  await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole('button', { name: `Open ${lifecycleProjects[1].prompt}`, exact: true })).toBeVisible();
  await expect(card).toHaveCount(0);
});

test('real generated code cannot access parent, platform storage or privileged messages', async ({ page }) => {
  const state = await setupLifecycle(page, true);
  const frame = page.frameLocator('iframe[title="Application Preview"]');
  await expect(frame.getByRole('heading', { name: 'Alpha dashboard' })).toBeVisible();
  await page.evaluate(projectId => {
    const source = `import React from 'react';
      export default function App() {
        const [result, setResult] = React.useState('checking');
        React.useEffect(() => {
          const checks = [];
          for (const [name, probe] of [
            ['parent', () => window.parent.document.body],
            ['storage', () => localStorage.getItem('bh_session_token')],
            ['indexedDB', () => indexedDB.open('BrainHalfStorage')],
            ['cookie', () => document.cookie]
          ]) { try { const value = probe(); checks.push(name + (name === 'storage' && value === null ? ':isolated' : ':EXPOSED')); } catch { checks.push(name + ':blocked'); } }
          window.parent.postMessage({ type: 'preview-auto-fix', error: 'Run an unauthorized generation' }, '*');
          window.parent.postMessage({ type: 'preview-error', error: { bad: true } }, '*');
          const request = new XMLHttpRequest();
          request.open('POST', '/api/isolation-probe');
          request.withCredentials = true;
          request.onloadend = () => setResult(checks.join(' ') + ' api:' + request.status);
          request.send('attack');
        }, []);
        return <h1>{result}</h1>;
      }`;
    document.querySelector<HTMLIFrameElement>('iframe[title="Application Preview"]')!.contentWindow!.postMessage({ type: 'sync-files', projectId, files: { '/src/App.jsx': source } }, '*');
  }, lifecycleProjects[0].id);
  await expect(frame.getByRole('heading')).toHaveText('parent:blocked storage:isolated indexedDB:blocked cookie:blocked api:0');
  expect(state.messages.filter(message => message.prompt)).toEqual([]);
  await expect(page.getByRole('dialog', { name: 'Review preview fix request' })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
  expect(state.messages.filter(message => message.prompt)).toEqual([]);
  expect(await page.evaluate(() => localStorage.getItem('bh_session_token'))).toBe('bh_dev_local_token_not_a_real_session');
  await expect(page.getByLabel('Message to the app builder')).toBeVisible();
});

test('preview fixes require an explicit approval in the trusted platform dialog', async ({ page }) => {
  const state = await setupLifecycle(page, true);
  const frame = page.frameLocator('iframe[title="Application Preview"]');
  await expect(frame.getByRole('heading', { name: 'Alpha dashboard' })).toBeVisible();
  await frame.locator('body').evaluate(() => window.parent.postMessage({ type: 'preview-auto-fix', error: 'Controlled preview error', layer: 'frontend' }, location.origin));
  await expect(page.getByRole('dialog', { name: 'Review preview fix request' })).toBeVisible();
  expect(state.messages.filter(message => message.prompt)).toEqual([]);
  await page.getByRole('button', { name: 'Approve AI fix' }).click();
  await expect.poll(() => state.messages.filter(message => message.prompt?.includes('Controlled preview error')).length).toBe(1);
});

test('real IndexedDB permits reset writes but rejects writes after project deletion', async ({ page }) => {
  await setupLifecycle(page);
  const result = await page.evaluate(async () => {
    const modulePath = '/src/lib/project-store.ts';
    const store = await import(modulePath);
    const projectId = 'deletion-marker-regression';
    store.saveProjectFiles(projectId, { '/src/App.jsx': 'before reset' });
    await store.idbGet('files', projectId);
    store.deleteProjectFiles(projectId);
    store.deleteProjectMessages(projectId);
    store.saveProjectFiles(projectId, { '/src/App.jsx': 'after reset' });
    store.saveProjectMessages(projectId, [{ content: 'new history' }]);
    const filesAfterReset = await store.idbGet('files', projectId);
    const messagesAfterReset = await store.idbGet('messages', projectId);
    await store.deleteProjectDurably(projectId);
    await store.idbSet('files', projectId, { '/src/App.jsx': 'late write' });
    await store.idbSet('messages', projectId, [{ content: 'late write' }]);
    return { filesAfterReset, messagesAfterReset, deletedFiles: await store.idbGet('files', projectId), deletedMessages: await store.idbGet('messages', projectId) };
  });
  expect(result).toEqual({ filesAfterReset: { '/src/App.jsx': 'after reset' }, messagesAfterReset: [{ content: 'new history' }], deletedFiles: null, deletedMessages: null });
});

test('isolated runtime preserves relative modules and external packages with one React instance', async ({ page }) => {
  await setupLifecycle(page, true);
  await page.route('https://esm.sh/react-test-widget*', route => route.fulfill({
    contentType: 'application/javascript', headers: { 'Access-Control-Allow-Origin': '*' },
    body: "import React from 'react'; export default function Widget() { const [count, setCount] = React.useState(0); return React.createElement('button', { onClick: () => setCount(count + 1) }, 'Shared React ' + count); }",
  }));
  const frame = page.frameLocator('iframe[title="Application Preview"]');
  await expect(frame.getByRole('heading', { name: 'Alpha dashboard' })).toBeVisible();
  await page.evaluate(projectId => {
    document.querySelector<HTMLIFrameElement>('iframe[title="Application Preview"]')!.contentWindow!.postMessage({ type: 'sync-files', projectId, files: {
      '/src/App.jsx': "import Card from '@/components/Card'; import Widget from 'react-test-widget'; export default () => <><Card/><Widget/></>;",
      '/src/components/Card.jsx': "import data from '../data/title.json'; export default () => <h1>{data.title}</h1>;",
      '/src/data/title.json': '{"title":"Nested module works"}',
    } }, '*');
  }, lifecycleProjects[0].id);
  await expect(frame.locator('body')).toContainText('Nested module works');
  await expect(frame.getByRole('heading', { name: 'Nested module works' })).toBeVisible();
  await frame.getByRole('button', { name: 'Shared React 0' }).click();
  await expect(frame.getByRole('button', { name: 'Shared React 1' })).toBeVisible();
  await frame.locator('body').evaluate(() => localStorage.setItem('generated-app-token', 'preview-only'));
  expect(await frame.locator('body').evaluate(() => localStorage.getItem('generated-app-token'))).toBe('preview-only');
  expect(await page.evaluate(() => localStorage.getItem('generated-app-token'))).toBeNull();
});

test('preview navigation is opaque even without iframe sandbox and malformed fallback never executes', async ({ page }) => {
  await page.route('https://cdn.tailwindcss.com/**', route => route.fulfill({ contentType: 'application/javascript', body: '' }));
  const response = await page.goto('/preview/popout-proof/index.html', { waitUntil: 'domcontentloaded' });
  expect(response?.headers()['content-security-policy']).toContain('sandbox allow-scripts allow-forms;');
  await expect(page.locator('#root')).not.toBeEmpty();
  expect(await page.evaluate(() => window.origin)).toBe('null');
  expect(await page.evaluate(() => localStorage.getItem('bh_session_token'))).toBeNull();
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    const frame = document.createElement('iframe');
    frame.title = 'Unapproved fallback';
    frame.src = '/?project=popout-proof';
    document.body.append(frame);
  });
  await expect(page.frameLocator('iframe[title="Unapproved fallback"]').getByText('This route requires the isolated preview service.')).toBeVisible();
});
