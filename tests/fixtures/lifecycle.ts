import { expect, type Page, type WebSocketRoute } from '@playwright/test';
import type { ProjectEvidence } from '../project-evidence';
import { resolve, sep } from 'node:path';

export const accountId = 'dev-user-1';
export const lifecycleProjects: [ProjectEvidence, ProjectEvidence] = [
  { id: 'lifecycle-alpha', prompt: 'Build the isolated alpha dashboard', uniqueFile: 'AlphaPanel.jsx', files: {
    '/src/App.jsx': 'export default function App() { return <h1>Alpha dashboard</h1>; }',
    '/src/AlphaPanel.jsx': 'export default function AlphaPanel() { return <p>Alpha only</p>; }',
  } },
  { id: 'lifecycle-beta', prompt: 'Build the isolated beta dashboard', uniqueFile: 'BetaPanel.jsx', files: {
    '/src/App.jsx': 'export default function App() { return <h1>Beta dashboard</h1>; }',
    '/src/BetaPanel.jsx': 'export default function BetaPanel() { return <p>Beta only</p>; }',
  } },
];

export async function setupLifecycle(page: Page, realPreview = false, deferHistory = false) {
  page.setDefaultTimeout(5000);
  const histories = new Map(lifecycleProjects.map(project => [project.id, [{ role: 'user', content: project.prompt }]]));
  const sockets: Array<{ id: string; socket: WebSocketRoute }> = [];
  const messages: Array<{ projectId: string; type?: string; prompt?: string }> = [];
  const deleted = new Set<string>();
  const deletions: string[] = [];
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (!['localhost', '127.0.0.1'].includes(url.hostname)) {
      const monacoPath = url.hostname === 'cdn.jsdelivr.net' && url.pathname.match(/^\/npm\/monaco-editor@[^/]+\/min\/vs\/(.+)$/);
      if (monacoPath) {
        const root = resolve('node_modules/monaco-editor/min/vs');
        const asset = resolve(root, monacoPath[1]);
        if (!asset.startsWith(`${root}${sep}`)) return route.abort();
        return route.fulfill({ path: asset });
      }
      if (route.request().resourceType() === 'script') return route.fulfill({ contentType: 'application/javascript', body: '' });
      return route.fulfill({ body: '' });
    }
    if (url.pathname === '/api/auth/session') return route.fulfill({ json: { userId: accountId } });
    if (url.pathname === '/api/auth/ws-ticket') return route.fulfill({ json: { ticket: 'bhwt_lifecycle' } });
    if (url.pathname === '/api/account/deletions') return route.fulfill({ json: { deletions: [] } });
    if (url.pathname.endsWith('/builder/configuration')) return route.fulfill({ json: { servers: [], skills: [] } });
    if (url.pathname.endsWith('/builder/attachments')) return route.fulfill({ json: { attachments: [] } });
    if (url.pathname === '/api/projects') return route.fulfill({ json: { projects: lifecycleProjects.filter(project => !deleted.has(project.id)).map(project => ({ id: project.id, name: project.prompt, createdAt: 1, updatedAt: 1 })) } });
    if (/^\/api\/projects\/[^/]+$/.test(url.pathname) && route.request().method() === 'DELETE') {
      if (route.request().headers().authorization !== 'Bearer bh_dev_local_token_not_a_real_session') return route.fulfill({ status: 401, json: { error: 'Unauthorized' } });
      const id = decodeURIComponent(url.pathname.split('/').pop()!);
      deletions.push(id);
      deleted.add(id);
      return route.fulfill({ json: { ok: true } });
    }
    if (/^\/api\/projects\/[^/]+\/publication$/.test(url.pathname)) return route.fulfill({ json: { published: false } });
    if (/^\/api\/projects\/[^/]+\/runtime\/status$/.test(url.pathname)) return route.fulfill({ json: { enabled: false, projectId: url.pathname.split('/')[3], environment: url.searchParams.get('environment') || 'development', availability: { state: 'pilot_only', message: 'Managed hosting is limited to approved pilot accounts.' }, capabilities: { sandbox: false, database: false, deployment: false, browser: false, secrets: false }, jobs: [], releases: [], migrations: [], integrations: [], activeRelease: null, database: null, verification: null } });
    if (url.pathname.startsWith('/preview/')) return realPreview ? route.continue() : route.fulfill({ contentType: 'text/html', body: '<h1>Controlled preview delivery — not a generation assertion</h1>' });
    return route.continue();
  });
  await page.routeWebSocket(/\/agents\//, socket => {
    const id = new URL(socket.url()).pathname.split('/').pop()!;
    sockets.push({ id, socket });
    if (!deferHistory) socket.send(JSON.stringify({ type: 'history', data: histories.get(id) || [] }));
    socket.onMessage(raw => {
      const message = JSON.parse(String(raw));
      messages.push({ ...message, projectId: id });
      if (message.prompt) {
        histories.get(id)?.push({ role: 'user', content: message.prompt });
        socket.send(JSON.stringify({ type: 'stream', chunk: { response: 'Working on the requested change.' }, done: false }));
      }
      if (message.type === 'rewrite_history') histories.set(id, message.messages);
      if (message.type === 'stop') {
        histories.get(id)?.push({ role: 'assistant', content: 'Working on the requested change.\n\n[Generation stopped by user]' });
        socket.send(JSON.stringify({ type: 'stopped' }));
      }
    });
  });
  await page.addInitScript(({ accountId, projects }) => {
    if (window !== window.top || localStorage.getItem('lifecycle-seeded')) return;
    localStorage.setItem('lifecycle-seeded', 'true');
    localStorage.setItem('bh_session_token', 'bh_dev_local_token_not_a_real_session');
    localStorage.setItem('bh_session_user', JSON.stringify({ id: accountId }));
    const prefix = `brainhalf_account:${accountId}:`;
    localStorage.setItem(`${prefix}brainhalf_projects`, JSON.stringify(projects.map(project => ({ id: project.id, name: project.prompt, createdAt: 1, updatedAt: 1 }))));
    localStorage.setItem(`${prefix}brainhalf_active_project`, projects[0].id);
    for (const project of projects) {
      localStorage.setItem(`${prefix}brainhalf_files_${project.id}`, JSON.stringify(project.files));
      localStorage.setItem(`${prefix}brainhalf_messages_${project.id}`, JSON.stringify([{ role: 'user', content: project.prompt }]));
    }
  }, { accountId, projects: lifecycleProjects });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/?project=${lifecycleProjects[0].id}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByLabel('Message to the app builder')).toBeVisible();
  await expect.poll(() => sockets.length).toBeGreaterThan(0);
  return { sockets, messages, deletions, deleted };
}
