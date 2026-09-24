# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: managed-runtime.spec.ts >> a delayed hosting check cannot send a prompt after switch
- Location: tests/managed-runtime.spec.ts:47:51

# Error details

```
TimeoutError: locator.fill: Timeout 5000ms exceeded.
Call log:
  - waiting for getByLabel('Message to the app builder')
    - locator resolved to <textarea rows="1" class="chat-input" aria-label="Message to the app builder" placeholder="Ask for a change, a fix, or a new feature…"></textarea>
    - fill("Update the heading")
  - attempting fill action
    - waiting for element to be visible, enabled and editable
  - element was detached from the DOM, retrying

```

# Page snapshot

```yaml
- generic [ref=e4]:
  - heading "Something went wrong" [level=2] [ref=e8]
  - paragraph [ref=e9]: An unexpected runtime issue occurred. Your project files and settings are safely stored.
  - generic [ref=e10]: Cannot read properties of undefined (reading 'find')
  - generic [ref=e11]:
    - button "Reload Application" [ref=e12] [cursor=pointer]
    - button "Clear Cache & Refresh" [ref=e18] [cursor=pointer]
```

# Test source

```ts
  1  | import { expect, test, type Page } from '@playwright/test';
  2  | import { lifecycleProjects, setupLifecycle } from './fixtures/lifecycle';
  3  | 
  4  | async function generateBackend(page: Page, socket: { send: (data: string) => void }, messages: Array<{ prompt?: string }>) {
  5  |   await page.getByLabel('Message to the app builder').fill('Add a persistent backend to this app');
  6  |   await page.getByLabel('Message to the app builder').press('Enter');
  7  |   const exportChoice = page.getByRole('button', { name: 'Build downloadable app', exact: true });
  8  |   await expect.poll(async () => messages.some(message => message.prompt) || await exportChoice.isVisible()).toBe(true);
  9  |   if (await exportChoice.isVisible()) {
  10 |     expect(messages.some(message => message.prompt)).toBe(false);
  11 |     await exportChoice.click();
  12 |   }
  13 |   await expect.poll(() => messages.some(message => message.prompt)).toBe(true);
  14 |   socket.send(JSON.stringify({ type: 'file_updated', path: '/package.json', content: JSON.stringify({ private: true, scripts: { build: 'vite build' }, brainhalf: { runtime: 'workers' } }) }));
  15 |   socket.send(JSON.stringify({ type: 'file_updated', path: '/worker/index.ts', content: 'export default { async fetch() { return new Response("ok"); } };' }));
  16 |   socket.send(JSON.stringify({ type: 'stream', chunk: { response: 'Backend source is ready.', done: true } }));
  17 | }
  18 | for (const ready of [true, false]) test(`agent-generated backend ${ready ? 'automatically starts development hosting' : 'honors pilot availability'}`, async ({ page }) => {
  19 |   const state = await setupLifecycle(page); const jobs: Array<{ environment: string | null; body: any }> = [];
  20 |   await page.route('**/api/projects/*/runtime/**', route => {
  21 |     const url = new URL(route.request().url());
  22 |     if (url.pathname.endsWith('/jobs')) { jobs.push({ environment: url.searchParams.get('environment'), body: route.request().postDataJSON() }); return route.fulfill({ json: { ok: true } }); }
  23 |     return route.fulfill({ json: { enabled: ready, projectId: 'lifecycle-alpha', environment: 'development', availability: { state: ready ? 'ready' : 'pilot_only', message: ready ? 'Hosting is ready.' : 'Managed hosting is currently available to pilot accounts.' }, capabilities: {}, jobs: [], releases: [], migrations: [], integrations: [], activeRelease: null, database: null, verification: null } });
  24 |   });
  25 |   await generateBackend(page, state.sockets[0].socket, state.messages);
  26 |   if (ready) {
  27 |     await expect.poll(() => jobs.length).toBe(1);
  28 |     expect(jobs[0].environment).toBe('development'); expect(jobs[0].body.kind).toBe('preview'); expect(jobs[0].body.files['/worker/index.ts']).toContain('fetch');
  29 |     state.sockets[0].socket.send(JSON.stringify({ type: 'stream', chunk: { response: '', done: true } }));
  30 |     await expect.poll(() => jobs.length).toBe(1);
  31 |   } else {
  32 |     await expect(page.getByText('Managed hosting is currently available to pilot accounts.', { exact: true })).toBeVisible();
  33 |     expect(jobs).toEqual([]);
  34 |   }
  35 |   await expect(page.getByRole('button', { name: /Enable demo API|Disable demo API|Add Backend API/ })).toHaveCount(0);
  36 | });
  37 | 
  38 | test('frontend-only generations do not create hosting jobs', async ({ page }) => {
  39 |   const state = await setupLifecycle(page); const jobs: string[] = [];
  40 |   await page.route('**/api/projects/*/runtime/jobs*', route => { jobs.push(route.request().url()); return route.fulfill({ json: { ok: true } }); });
  41 |   await page.getByLabel('Message to the app builder').fill('Improve the heading'); await page.getByLabel('Message to the app builder').press('Enter');
  42 |   await expect.poll(() => state.messages.some(message => message.prompt)).toBe(true);
  43 |   state.sockets[0].socket.send(JSON.stringify({ type: 'stream', chunk: { response: '<file path="/src/App.jsx">export default () => <h1>Improved heading</h1>;</file>', done: true } }));
  44 |   await expect(page.getByRole('button', { name: 'Send message' })).toBeVisible(); expect(jobs).toEqual([]);
  45 | });
  46 | 
  47 | for (const action of ['stop', 'switch'] as const) test(`a delayed hosting check cannot send a prompt after ${action}`, async ({ page }) => {
  48 |   const state = await setupLifecycle(page);
  49 |   let release!: () => void;
  50 |   let requested = false;
  51 |   const held = new Promise<void>(resolve => { release = resolve; });
  52 |   await page.route('**/api/projects/*/runtime/status*', async route => {
  53 |     requested = true;
  54 |     await held;
  55 |     await route.fulfill({ json: { enabled: true, availability: { state: 'ready', message: 'Ready' } } }).catch(() => {});
  56 |   });
  57 |   await page.getByLabel('Message to the app builder').fill('Add a persistent backend');
  58 |   await page.getByTestId('send-prompt-btn').click();
  59 |   await expect.poll(() => requested).toBe(true);
  60 |   await expect(page.getByText('Checking hosting availability…', { exact: true })).toBeVisible();
  61 |   if (action === 'stop') await page.getByTestId('stop-generation-btn').click();
  62 |   else {
  63 |     await page.getByRole('button', { name: 'Return to Home', exact: true }).click();
  64 |     await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
  65 |     await page.getByRole('button', { name: `Open ${lifecycleProjects[1].prompt}`, exact: true }).click();
  66 |   }
  67 |   release();
  68 |   await expect(page.getByTestId('send-prompt-btn')).toBeVisible();
> 69 |   await page.getByLabel('Message to the app builder').fill('Update the heading');
     |                                                       ^ TimeoutError: locator.fill: Timeout 5000ms exceeded.
  70 |   await page.getByTestId('send-prompt-btn').click();
  71 |   await expect.poll(() => state.messages.filter(message => message.prompt).length).toBe(1);
  72 |   expect(state.messages.find(message => message.prompt)).toMatchObject({ prompt: 'Update the heading', projectId: lifecycleProjects[action === 'stop' ? 0 : 1].id });
  73 |   await expect(page.getByRole('button', { name: 'Build downloadable app', exact: true })).toHaveCount(0);
  74 | });
  75 | 
```