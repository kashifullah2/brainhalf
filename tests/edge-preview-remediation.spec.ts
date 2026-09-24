import { expect, test, type Page } from '@playwright/test';
import { transform } from 'sucrase';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildHarnessModuleSrc, buildPreviewIndexHtml } from '../src/lib/preview-templates';

async function setupEdge(page: Page, failing = false) {
  let revision = 1;
  let broken = failing;
  let loads = 0;
  const importMap = JSON.stringify({ imports: {
    react: '/preview/edge-fixture/vendor/react.js',
    'react-dom/client': '/preview/edge-fixture/react-dom-client.js',
    'react-router-dom': '/preview/edge-fixture/router.js',
  } });
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (!['localhost', '127.0.0.1'].includes(url.hostname)) return route.abort();
    if (url.pathname.startsWith('/preview/edge-fixture/vendor/')) {
      const filename = url.pathname.slice('/preview/edge-fixture/vendor/'.length);
      if (!/^[\w.-]+\.js$/.test(filename)) return route.abort();
      return route.fulfill({ contentType: 'application/javascript', body: readFileSync(join(process.cwd(), 'node_modules/.vite/deps', filename), 'utf8') });
    }
    if (url.pathname === '/preview/edge-fixture/react-dom-client.js') return route.fulfill({ contentType: 'application/javascript', body: "import client from './vendor/react-dom_client.js'; export const createRoot = client.createRoot; export default client;" });
    if (url.pathname === '/preview/edge-fixture/index.html') {
      loads += 1;
      return route.fulfill({ contentType: 'text/html', body: buildPreviewIndexHtml(importMap, '/src/App.tsx', revision) });
    }
    if (url.pathname === '/preview/edge-fixture/src/main.jsx') {
      return route.fulfill({ contentType: 'application/javascript', body: transform(buildHarnessModuleSrc('./App.tsx'), { transforms: ['jsx', 'typescript'] }).code });
    }
    if (url.pathname === '/preview/edge-fixture/src/App.tsx') {
      const source = `import React from 'react'; export default function App() { ${broken ? 'throw new Error("Edge regression failure");' : `return <h1>Edge revision ${revision}</h1>;`} }`;
      return route.fulfill({ contentType: 'application/javascript', body: transform(source, { transforms: ['jsx', 'typescript'] }).code });
    }
    if (url.pathname === '/preview/edge-fixture/router.js') return route.fulfill({ contentType: 'application/javascript', body: 'export const HashRouter = ({ children }) => children;' });
    if (url.pathname === '/preview/edge-fixture/src/styles.css') return route.fulfill({ contentType: 'text/css', body: '' });
    return route.continue();
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    (window as any).__edgeMessages = [];
    const frame = document.createElement('iframe');
    frame.title = 'Edge runtime regression';
    frame.src = '/preview/edge-fixture/index.html';
    window.addEventListener('message', event => {
      if (event.source === frame.contentWindow && event.origin === location.origin) (window as any).__edgeMessages.push(event.data);
    });
    document.body.append(frame);
  });
  const sendRevision = (next: number) => page.evaluate(next => {
    document.querySelector<HTMLIFrameElement>('iframe[title="Edge runtime regression"]')!.contentWindow!.postMessage({ type: 'preview-revision', revision: next }, location.origin);
  }, next);
  return {
    frame: page.frameLocator('iframe[title="Edge runtime regression"]'),
    loads: () => loads,
    setVersion: (next: number, error = false) => { revision = next; broken = error; },
    sendRevision,
    messages: () => page.evaluate(() => (window as any).__edgeMessages as Array<{ type: string }>),
  };
}

test('edge HTML reloads for a newer persisted revision, not repeated or forged notifications', async ({ page }) => {
  const edge = await setupEdge(page);
  await expect(edge.frame.getByRole('heading', { name: 'Edge revision 1' })).toBeVisible();
  await edge.sendRevision(1);
  await edge.frame.locator('body').evaluate(() => window.dispatchEvent(new MessageEvent('message', { origin: 'https://untrusted.invalid', source: window.parent, data: { type: 'preview-revision', revision: 999 } })));
  await page.waitForTimeout(500);
  expect(edge.loads()).toBe(1);
  edge.setVersion(2);
  await edge.sendRevision(2);
  await edge.sendRevision(2);
  await expect(edge.frame.getByRole('heading', { name: 'Edge revision 2' })).toBeVisible();
  await edge.sendRevision(2);
  await page.waitForTimeout(500);
  expect(edge.loads()).toBe(2);
});

test('edge render failure never announces success before a corrected render', async ({ page }) => {
  const edge = await setupEdge(page, true);
  await expect(edge.frame.getByText('Preview Error', { exact: true })).toBeVisible();
  await expect.poll(async () => (await edge.messages()).some(message => message.type === 'preview-error')).toBe(true);
  expect((await edge.messages()).filter(message => message.type === 'preview-success')).toHaveLength(0);
  edge.setVersion(2);
  await edge.sendRevision(2);
  await expect(edge.frame.getByRole('heading', { name: 'Edge revision 2' })).toBeVisible();
  await expect.poll(async () => (await edge.messages()).some(message => message.type === 'preview-success')).toBe(true);
});

async function setupIsolatedPreview(page: Page, files: Record<string, string>, dependencies: Record<string, string> = {}) {
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (dependencies[url.href]) return route.fulfill({ contentType: 'application/javascript', headers: { 'Access-Control-Allow-Origin': '*' }, body: dependencies[url.href] });
    if (!['localhost', '127.0.0.1'].includes(url.hostname)) return route.abort();
    if (url.pathname === '/preview-runtime-fixture') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body></body></html>' });
    return route.continue();
  });
  await page.goto('/preview-runtime-fixture');
  await page.evaluate(files => {
    (window as any).__previewMessages = [];
    (window as any).__fixtureFiles = files;
    const iframe = document.createElement('iframe');
    iframe.title = 'Isolated application';
    iframe.src = '/preview/isolated-fixture/index.html';
    window.addEventListener('message', event => {
      if (event.source !== iframe.contentWindow) return;
      (window as any).__previewMessages.push(event.data);
      if (event.data?.type === 'request-preview-files') iframe.contentWindow!.postMessage({ type: 'sync-files', projectId: 'isolated-fixture', files: (window as any).__fixtureFiles }, '*');
    });
    document.body.append(iframe);
  }, files);
  return {
    frame: page.frameLocator('iframe[title="Isolated application"]'),
    sync: (next: Record<string, string>) => page.evaluate(next => {
      (window as any).__fixtureFiles = next;
      document.querySelector<HTMLIFrameElement>('iframe')!.contentWindow!.postMessage({ type: 'sync-files', projectId: 'isolated-fixture', files: next }, '*');
    }, next),
    messages: () => page.evaluate(() => (window as any).__previewMessages as Array<{ type: string; error?: string }>),
  };
}

test('isolated HTML applications execute local modules, inline scripts and styles', async ({ page }) => {
  const preview = await setupIsolatedPreview(page, {
    '/index.html': '<!doctype html><html><head><link rel="stylesheet" href="./styles.css"></head><body><h1>HTML application</h1><button id="counter">Count 0</button><img alt="Local logo" src="/logo.svg"><script type="module" src="./main.js"></script><script type="module">document.querySelector("h1").dataset.ready = "yes";</script><script>document.addEventListener("DOMContentLoaded", function () { document.body.dataset.loaded = "yes"; });</script></body></html>',
    '/styles.css': 'h1 { color: rgb(23, 100, 210); }',
    '/main.js': "import { next } from './counter.js'; let count = 0; document.querySelector('#counter').onclick = () => { count = next(count); document.querySelector('#counter').textContent = 'Count ' + count; };",
    '/counter.js': 'export const next = value => value + 1;',
    '/public/logo.svg': '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12"><rect width="12" height="12" fill="red" /></svg>',
  });
  await expect(preview.frame.getByRole('heading', { name: 'HTML application' })).toHaveCSS('color', 'rgb(23, 100, 210)');
  await expect(preview.frame.getByRole('heading')).toHaveAttribute('data-ready', 'yes');
  await expect(preview.frame.locator('body')).toHaveAttribute('data-loaded', 'yes');
  await preview.frame.getByRole('button', { name: 'Count 0' }).click();
  await expect(preview.frame.getByRole('button', { name: 'Count 1' })).toBeVisible();
  await expect(preview.frame.getByAltText('Local logo')).toHaveJSProperty('naturalWidth', 12);
  await expect.poll(async () => (await preview.messages()).some(message => message.type === 'preview-success')).toBe(true);
});

test('isolated previews report unavailable backends instead of fabricating API records', async ({ page }) => {
  const preview = await setupIsolatedPreview(page, {
    '/src/App.tsx': `import React from 'react'; export default function App() {
      const [result, setResult] = React.useState('Loading');
      React.useEffect(() => { fetch('/api/items').then(async response => setResult(response.status + ': ' + (await response.json()).code)); }, []);
      return <h1>{result}</h1>;
    }`,
  });
  await expect(preview.frame.getByRole('heading', { name: '501: BACKEND_NOT_RUNNING' })).toBeVisible();
});

test('legacy demo flags cannot fabricate records on first mount', async ({ page }) => {
  const preview = await setupIsolatedPreview(page, {
    '/package.json': JSON.stringify({ brainhalf: { previewApi: 'simulated' } }),
    '/src/App.tsx': `import React from 'react'; export default function App() {
      const [title, setTitle] = React.useState('Loading');
      React.useEffect(() => { fetch(new Request(location.origin + '/api/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Saved on first render' }) })).then(response => response.json()).then(record => setTitle(record.code)); }, []);
      return <h1>{title}</h1>;
    }`,
  });
  await expect(preview.frame.getByRole('heading', { name: 'BACKEND_NOT_RUNNING' })).toBeVisible();
  expect((await preview.messages()).filter(message => message.type === 'preview-error')).toEqual([]);
});

test('isolated previews load local lazy components and recover from asynchronous errors', async ({ page }) => {
  const preview = await setupIsolatedPreview(page, {
    '/src/App.jsx': `import React from 'react'; const Card = React.lazy(() => import('./Card')); export default function App() { return <React.Suspense fallback={<p>Loading</p>}><Card /></React.Suspense>; }`,
    '/src/Card.jsx': `export default function Card() { return <button onClick={() => Promise.reject(new Error('Asynchronous preview failure'))}>Lazy card</button>; }`,
  });
  await preview.frame.getByRole('button', { name: 'Lazy card' }).click();
  await expect(preview.frame.getByText('Asynchronous preview failure', { exact: true })).toBeVisible();
  await expect.poll(async () => (await preview.messages()).some(message => message.type === 'preview-error' && message.error === 'Asynchronous preview failure')).toBe(true);
  await preview.sync({ '/src/App.jsx': 'export default function App() { return <h1>Corrected application</h1>; }' });
  await expect(preview.frame.getByRole('heading', { name: 'Corrected application' })).toBeVisible();
});

test('isolated HTML script failures report errors without announcing successful rendering', async ({ page }) => {
  const preview = await setupIsolatedPreview(page, { '/index.html': '<h1>Broken</h1><script>document.addEventListener("DOMContentLoaded", () => { throw new Error("HTML script failure"); });</script>' });
  await expect(preview.frame.getByText('HTML script failure', { exact: true })).toBeVisible();
  expect((await preview.messages()).filter(message => message.type === 'preview-success')).toEqual([]);
  await preview.sync({ '/index.html': '<h1>Corrected HTML</h1>' });
  await expect(preview.frame.getByRole('heading', { name: 'Corrected HTML' })).toBeVisible();
});

test('HTML updates reset global declarations and listeners and keep the application root accessible', async ({ page }) => {
  const version = (label: string) => ({ '/index.html': `<div id="root"><h1>${label}</h1><button id="counter">Count 0</button></div><script>let count = 0; document.getElementById('counter').onclick = function () { count += 1; this.textContent = 'Count ' + count; }; document.getElementById('root').dataset.application = 'yes';</script>` });
  const preview = await setupIsolatedPreview(page, version('First version'));
  await expect(preview.frame.locator('#root')).toHaveAttribute('data-application', 'yes');
  await preview.frame.getByRole('button', { name: 'Count 0' }).click();
  await expect(preview.frame.getByRole('button', { name: 'Count 1' })).toBeVisible();
  await preview.sync(version('Updated version'));
  await expect(preview.frame.getByRole('heading', { name: 'Updated version' })).toBeVisible();
  await preview.frame.getByRole('button', { name: 'Count 0' }).click();
  await expect(preview.frame.getByRole('button', { name: 'Count 1' })).toBeVisible();
  expect((await preview.messages()).filter(message => message.type === 'preview-error')).toEqual([]);
  expect(await preview.frame.locator('body').evaluate(() => window.name)).toBe('');
});

test('versioned external dependencies and side effects share the preview React instance', async ({ page }) => {
  const preview = await setupIsolatedPreview(page, {
    '/package.json': '{"dependencies":{"zustand":"^5.0.3","clsx":"^2.1.1"}}',
    '/src/App.jsx': "import React from 'react'; import { useStore } from 'zustand'; import 'clsx'; export default function App() { return <h1>{useStore()} {globalThis.__loadedSideEffect ? 'with side effect' : 'missing side effect'}</h1>; }",
  }, {
    'https://esm.sh/zustand@5.0.3?external=react,react-dom': "import React from 'react'; export const useStore = () => React.useState('Shared React runtime')[0];",
    'https://esm.sh/clsx@2.1.1?external=react,react-dom': 'globalThis.__loadedSideEffect = true; export default value => value;',
  });
  await expect(preview.frame.getByRole('heading', { name: 'Shared React runtime with side effect' })).toBeVisible();
  expect((await preview.messages()).filter(message => message.type === 'preview-error')).toEqual([]);
});
