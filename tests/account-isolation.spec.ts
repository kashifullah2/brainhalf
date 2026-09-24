import { expect, test, type BrowserContext, type Page } from '@playwright/test';

async function routes(context: BrowserContext) {
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (!['localhost', '127.0.0.1'].includes(url.hostname)) return route.abort();
    const token = route.request().headers().authorization || '';
    const id = token.includes('account-b') ? 'account-b' : 'account-a';
    if (url.pathname === '/api/auth/session') return route.fulfill({ json: { userId: id } });
    if (url.pathname === '/api/auth/logout') return route.fulfill({ json: { ok: true } });
    if (url.pathname === '/api/account/deletions') return route.fulfill({ json: { deletions: [] } });
    if (url.pathname === '/api/auth/login') {
      const userId = route.request().postDataJSON().email.startsWith('a@') ? 'account-a' : 'account-b';
      return route.fulfill({ json: { token: `token-${userId}`, user: { id: userId, email: `${userId}@example.test` } } });
    }
    if (url.pathname === '/api/projects') return route.fulfill({ json: { projects: [{ id, name: `${id} project`, createdAt: 1, updatedAt: 1 }] } });
    if (url.pathname === '/api/auth/ws-ticket') return route.fulfill({ json: { ticket: 'bhwt_isolation' } });
    if (url.pathname.endsWith('/runtime/status')) return route.fulfill({ json: { enabled: false, jobs: [], releases: [], availability: { state: 'pilot_only', message: 'Hosting unavailable for this fixture.' } } });
    if (url.pathname.startsWith('/preview/')) return route.fulfill({ contentType: 'text/html', body: '<h1>Isolated test preview</h1>' });
    return route.continue();
  });
}

async function login(page: Page, account: 'a' | 'b') {
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByLabel('Email Address').fill(`${account}@example.test`);
  await page.getByLabel('Password', { exact: true }).fill('account-password');
  await page.getByRole('dialog').locator('button[type="submit"]').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

async function seed(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    for (const id of ['account-a', 'account-b']) {
      const prefix = `brainhalf_account:${id}:`;
      localStorage.setItem(`${prefix}brainhalf_projects`, JSON.stringify([{ id, name: `${id} project`, createdAt: 1, updatedAt: 1 }]));
      localStorage.setItem(`${prefix}brainhalf_messages_${id}`, JSON.stringify([{ role: 'user', content: `${id} private prompt` }]));
      localStorage.setItem(`${prefix}brainhalf_files_${id}`, JSON.stringify({ '/src/App.jsx': `export default function App(){return <h1>${id}</h1>}` }));
    }
    localStorage.setItem('brainhalf_projects', JSON.stringify([{ id: 'legacy-secret', name: 'Unverified legacy secret', createdAt: 1, updatedAt: 1 }]));
  });
}

test('signed-out landing never displays cached projects or unverified legacy metadata', async ({ page, context }) => {
  await routes(context);
  await seed(page);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  await expect(page.getByText('Unverified legacy secret')).toHaveCount(0);
  await expect(page.getByText(/account-[ab] private prompt/)).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Recent projects' })).toHaveCount(0);
});

test('logout and another-account login detach both tabs and never copy old history', async ({ page, context }) => {
  await routes(context);
  await seed(page);
  await page.routeWebSocket(/\/agents\//, socket => socket.send(JSON.stringify({ type: 'history', data: [] })));
  await login(page, 'a');
  await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open account-a project', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Open account-a project', exact: true }).click();
  await expect(page.getByLabel('Message to the app builder')).toBeVisible();

  const otherTab = await context.newPage();
  await otherTab.goto('/dashboard', { waitUntil: 'domcontentloaded' });
  await expect(otherTab.getByRole('button', { name: 'Open account-a project', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'User profile and menu' }).click();
  await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
  for (const tab of [page, otherTab]) {
    await expect(tab.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
    await expect(tab.getByText('account-a private prompt', { exact: true })).toHaveCount(0);
    await expect(tab.getByRole('button', { name: 'Open account-a project', exact: true })).toHaveCount(0);
    await expect(tab.getByLabel('Message to the app builder')).toHaveCount(0);
  }

  await login(otherTab, 'b');
  for (const tab of [page, otherTab]) {
    if (new URL(tab.url()).pathname !== '/dashboard') await tab.getByRole('button', { name: 'Dashboard', exact: true }).click();
    await expect(tab.getByRole('button', { name: 'Open account-b project', exact: true })).toBeVisible();
    await expect(tab.getByText('account-a private prompt', { exact: true })).toHaveCount(0);
    await expect(tab.getByRole('button', { name: 'Open account-a project', exact: true })).toHaveCount(0);
  }
  const data = await otherTab.evaluate(() => ({
    copied: localStorage.getItem('brainhalf_account:account-b:brainhalf_messages_account-a'),
    old: localStorage.getItem('brainhalf_account:account-a:brainhalf_messages_account-a'),
  }));
  expect(data.copied).toBeNull();
  expect(data.old).toContain('account-a private prompt');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: 'Open account-b project', exact: true })).toBeVisible();
  await otherTab.close();
});

test('real IndexedDB isolates identical ids and discards an in-flight read after switching', async ({ page, context }) => {
  await routes(context);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const result = await page.evaluate(async () => {
    const modulePath = '/src/lib/project-store.ts';
    const store = await import(modulePath);
    store.setProjectAccount('account-a');
    await store.idbSet('files', 'shared', { '/src/App.jsx': 'source-a' });
    await store.idbSet('messages', 'shared', [{ role: 'user', content: 'prompt-a' }]);
    const pending = store.getProjectFilesAsync('shared');
    store.setProjectAccount('account-b');
    const abandoned = await pending;
    const absent = await store.getProjectMessagesAsync('shared');
    await store.idbSet('files', 'shared', { '/src/App.jsx': 'source-b' });
    const second = await store.getProjectFilesAsync('shared');
    store.setProjectAccount('account-a');
    const first = await store.getProjectFilesAsync('shared');
    const history = await store.getProjectMessagesAsync('shared');
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('BrainHalfStorage', 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction('files', 'readwrite');
        transaction.objectStore('files').put({ '/src/App.jsx': 'legacy-owned-source' }, 'legacy-owned');
        transaction.oncomplete = () => { database.close(); resolve(); };
        transaction.onerror = () => { database.close(); reject(transaction.error); };
      };
    });
    const unverifiedLegacy = await store.getProjectFilesAsync('legacy-owned');
    store.reconcileOwnedProjects([{ id: 'legacy-owned', name: 'Owned', createdAt: 1, updatedAt: 1 }]);
    const verifiedLegacy = await store.getProjectFilesAsync('legacy-owned');
    store.setProjectAccount(null);
    return { abandoned, absent, second, first, history, unverifiedLegacy, verifiedLegacy, signedOut: await store.getProjectFilesAsync('shared') };
  });
  expect(result).toEqual({ abandoned: null, absent: null, second: { '/src/App.jsx': 'source-b' }, first: { '/src/App.jsx': 'source-a' }, history: [{ role: 'user', content: 'prompt-a' }], unverifiedLegacy: null, verifiedLegacy: { '/src/App.jsx': 'legacy-owned-source' }, signedOut: null });
});
