import { chromium } from '@playwright/test';

async function routes(context) {
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

async function seed(page) {
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

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ baseURL: 'http://127.0.0.1:4173' });
const page = await context.newPage();
await routes(context);
await seed(page);

await page.getByRole('button', { name: 'Sign in', exact: true }).click();
await page.getByLabel('Email Address').fill('a@example.test');
await page.getByLabel('Password', { exact: true }).fill('account-password');
await page.getByRole('dialog').locator('button[type="submit"]').click();
await page.getByRole('dialog').waitFor({ state: 'detached' });

const snap = async (label) => {
  const info = await page.evaluate(() => ({
    url: location.href,
    token: localStorage.getItem('bh_session_token'),
    user: localStorage.getItem('bh_session_user'),
    bodyHasSignedInText: document.body.textContent?.includes('Sign in') ?? false,
    buttons: Array.from(document.querySelectorAll('button')).slice(0,20).map(b => ({label:(b.getAttribute('aria-label')||b.textContent||'').trim(), text:(b.textContent||'').trim()})),
  }));
  console.log(label, JSON.stringify(info, null, 2));
};

await snap('after-login');
await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
await page.waitForTimeout(500);
await snap('after-dashboard-click');
const openCount = await page.getByRole('button', { name: 'Open account-a project', exact: true }).count();
console.log('openCount', openCount);

await browser.close();
