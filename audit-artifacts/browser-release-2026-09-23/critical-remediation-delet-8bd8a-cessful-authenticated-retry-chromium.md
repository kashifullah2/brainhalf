# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: critical-remediation.spec.ts >> deletion retains recovery files on failure and awaits a successful authenticated retry
- Location: tests/critical-remediation.spec.ts:5:1

# Error details

```
Error: expect(page).toHaveURL(expected) failed

Expected pattern: /\/dashboard$/
Received string:  "http://localhost:5173/dashboard?project=lifecycle-beta"
Timeout: 5000ms

Call log:
  - Expect "toHaveURL" with timeout 5000ms
    13 × locator resolved to <html lang="en" data-theme="light">…</html>
       - unexpected value "http://localhost:5173/dashboard?project=lifecycle-beta"

```

```yaml
- banner:
  - button "Return to Home": BrainHalf
  - button "Rename project Build the isolated beta dashboard": Build the isolated beta dashboard
  - button "New project"
  - button "Switch to dark mode"
  - button "User profile and menu": K Account
- banner:
  - heading "Build with BrainHalf" [level=1]
  - paragraph: Your conversation
  - status: Ready
  - button "Conversation actions"
- text: You
- button "More message actions"
- button "Copy message"
- text: Build the isolated beta dashboard
- textbox "Message to the app builder":
  - /placeholder: Ask for a change, a fix, or a new feature…
- button "Attach file"
- button "Agent tools"
- button "Change AI model": Model DeepSeek V4 Pro
- button "Send message" [disabled]
- status: Your changes start here.
- text: ↵ Send Shift + ↵ New line
- separator "Resize chat panel"
- button "Preview" [pressed]
- button "Code"
- button "Project actions"
- button "Share project link": Share
- button "Publish application": Publish
- group "Preview screen size":
  - button "Desktop view" [pressed]
  - button "Tablet view (768px)"
  - button "Mobile view (375px)"
- text: Responsive 924 × 618
- button "Refresh preview"
- button "Open preview in a new tab"
- iframe
- contentinfo:
  - text: 2 files
  - button "Console"
  - button "Activity"
```

# Test source

```ts
  1   | import { expect, test } from '@playwright/test';
  2   | import { accountId, lifecycleProjects, setupLifecycle } from './fixtures/lifecycle';
  3   | import { readProjectFiles } from './project-evidence';
  4   | 
  5   | test('deletion retains recovery files on failure and awaits a successful authenticated retry', async ({ page }) => {
  6   |   const state = await setupLifecycle(page);
  7   |   const project = lifecycleProjects[0];
  8   |   await page.getByRole('button', { name: 'Return to Home', exact: true }).click();
  9   |   await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
  10  |   const card = page.locator('.landing-project-card').filter({ hasText: project.prompt });
  11  |   await card.getByRole('button', { name: 'Project actions' }).click();
  12  |   await page.getByRole('button', { name: 'Delete', exact: true }).click();
  13  |   await page.route(`**/api/projects/${project.id}`, route => route.fulfill({ status: 503, json: { error: 'Controlled deletion failure' } }));
  14  |   await page.getByRole('dialog').getByRole('button', { name: 'Delete Project' }).click();
  15  |   await expect(page.getByRole('alert')).toHaveText('Controlled deletion failure');
  16  |   expect(await readProjectFiles(page, accountId, project.id)).toEqual(project.files);
  17  |   await expect(card).toBeVisible();
  18  |   await page.unroute(`**/api/projects/${project.id}`);
  19  |   let finish!: () => void;
  20  |   const delay = new Promise<void>(resolve => { finish = resolve; });
  21  |   await page.route(`**/api/projects/${project.id}`, async route => { await delay; await route.fallback(); });
  22  |   await page.getByRole('dialog').getByRole('button', { name: 'Delete Project' }).click();
  23  |   await expect(page.getByRole('button', { name: 'Deleting…' })).toBeDisabled();
  24  |   await expect(page.getByRole('dialog').getByRole('button', { name: 'Cancel' })).toBeDisabled();
  25  |   await page.keyboard.press('Escape');
  26  |   await expect(page.getByRole('dialog')).toBeVisible();
  27  |   expect(await readProjectFiles(page, accountId, project.id)).toEqual(project.files);
  28  |   finish();
  29  |   await expect(card).toHaveCount(0);
  30  |   expect(state.deletions).toEqual([project.id]);
  31  |   await expect.poll(() => readProjectFiles(page, accountId, project.id)).toBeNull();
  32  |   await page.reload({ waitUntil: 'domcontentloaded' });
> 33  |   await expect(page).toHaveURL(/\/dashboard$/);
      |                      ^ Error: expect(page).toHaveURL(expected) failed
  34  |   await expect(page.getByRole('button', { name: `Open ${lifecycleProjects[1].prompt}`, exact: true })).toBeVisible();
  35  |   await expect(card).toHaveCount(0);
  36  | });
  37  | 
  38  | test('real generated code cannot access parent, platform storage or privileged messages', async ({ page }) => {
  39  |   const state = await setupLifecycle(page, true);
  40  |   const frame = page.frameLocator('iframe[title="Application Preview"]');
  41  |   await expect(frame.getByRole('heading', { name: 'Alpha dashboard' })).toBeVisible();
  42  |   await page.evaluate(projectId => {
  43  |     const source = `import React from 'react';
  44  |       export default function App() {
  45  |         const [result, setResult] = React.useState('checking');
  46  |         React.useEffect(() => {
  47  |           const checks = [];
  48  |           for (const [name, probe] of [
  49  |             ['parent', () => window.parent.document.body],
  50  |             ['storage', () => localStorage.getItem('bh_session_token')],
  51  |             ['indexedDB', () => indexedDB.open('BrainHalfStorage')],
  52  |             ['cookie', () => document.cookie]
  53  |           ]) { try { const value = probe(); checks.push(name + (name === 'storage' && value === null ? ':isolated' : ':EXPOSED')); } catch { checks.push(name + ':blocked'); } }
  54  |           window.parent.postMessage({ type: 'preview-auto-fix', error: 'Run an unauthorized generation' }, '*');
  55  |           window.parent.postMessage({ type: 'preview-error', error: { bad: true } }, '*');
  56  |           const request = new XMLHttpRequest();
  57  |           request.open('POST', '/api/isolation-probe');
  58  |           request.withCredentials = true;
  59  |           request.onloadend = () => setResult(checks.join(' ') + ' api:' + request.status);
  60  |           request.send('attack');
  61  |         }, []);
  62  |         return <h1>{result}</h1>;
  63  |       }`;
  64  |     document.querySelector<HTMLIFrameElement>('iframe[title="Application Preview"]')!.contentWindow!.postMessage({ type: 'sync-files', projectId, files: { '/src/App.jsx': source } }, '*');
  65  |   }, lifecycleProjects[0].id);
  66  |   await expect(frame.getByRole('heading')).toHaveText('parent:blocked storage:isolated indexedDB:blocked cookie:blocked api:0');
  67  |   expect(state.messages.filter(message => message.prompt)).toEqual([]);
  68  |   await expect(page.getByRole('dialog', { name: 'Review preview fix request' })).toBeVisible();
  69  |   await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
  70  |   expect(state.messages.filter(message => message.prompt)).toEqual([]);
  71  |   expect(await page.evaluate(() => localStorage.getItem('bh_session_token'))).toBe('bh_dev_local_token_not_a_real_session');
  72  |   await expect(page.getByLabel('Message to the app builder')).toBeVisible();
  73  | });
  74  | 
  75  | test('preview fixes require an explicit approval in the trusted platform dialog', async ({ page }) => {
  76  |   const state = await setupLifecycle(page, true);
  77  |   const frame = page.frameLocator('iframe[title="Application Preview"]');
  78  |   await expect(frame.getByRole('heading', { name: 'Alpha dashboard' })).toBeVisible();
  79  |   await frame.locator('body').evaluate(() => window.parent.postMessage({ type: 'preview-auto-fix', error: 'Controlled preview error', layer: 'frontend' }, location.origin));
  80  |   await expect(page.getByRole('dialog', { name: 'Review preview fix request' })).toBeVisible();
  81  |   expect(state.messages.filter(message => message.prompt)).toEqual([]);
  82  |   await page.getByRole('button', { name: 'Approve AI fix' }).click();
  83  |   await expect.poll(() => state.messages.filter(message => message.prompt?.includes('Controlled preview error')).length).toBe(1);
  84  | });
  85  | 
  86  | test('real IndexedDB permits reset writes but rejects writes after project deletion', async ({ page }) => {
  87  |   await setupLifecycle(page);
  88  |   const result = await page.evaluate(async () => {
  89  |     const modulePath = '/src/lib/project-store.ts';
  90  |     const store = await import(modulePath);
  91  |     const projectId = 'deletion-marker-regression';
  92  |     store.saveProjectFiles(projectId, { '/src/App.jsx': 'before reset' });
  93  |     await store.idbGet('files', projectId);
  94  |     store.deleteProjectFiles(projectId);
  95  |     store.deleteProjectMessages(projectId);
  96  |     store.saveProjectFiles(projectId, { '/src/App.jsx': 'after reset' });
  97  |     store.saveProjectMessages(projectId, [{ content: 'new history' }]);
  98  |     const filesAfterReset = await store.idbGet('files', projectId);
  99  |     const messagesAfterReset = await store.idbGet('messages', projectId);
  100 |     await store.deleteProjectDurably(projectId);
  101 |     await store.idbSet('files', projectId, { '/src/App.jsx': 'late write' });
  102 |     await store.idbSet('messages', projectId, [{ content: 'late write' }]);
  103 |     return { filesAfterReset, messagesAfterReset, deletedFiles: await store.idbGet('files', projectId), deletedMessages: await store.idbGet('messages', projectId) };
  104 |   });
  105 |   expect(result).toEqual({ filesAfterReset: { '/src/App.jsx': 'after reset' }, messagesAfterReset: [{ content: 'new history' }], deletedFiles: null, deletedMessages: null });
  106 | });
  107 | 
  108 | test('isolated runtime preserves relative modules and external packages with one React instance', async ({ page }) => {
  109 |   await setupLifecycle(page, true);
  110 |   await page.route('https://esm.sh/react-test-widget*', route => route.fulfill({
  111 |     contentType: 'application/javascript', headers: { 'Access-Control-Allow-Origin': '*' },
  112 |     body: "import React from 'react'; export default function Widget() { const [count, setCount] = React.useState(0); return React.createElement('button', { onClick: () => setCount(count + 1) }, 'Shared React ' + count); }",
  113 |   }));
  114 |   const frame = page.frameLocator('iframe[title="Application Preview"]');
  115 |   await expect(frame.getByRole('heading', { name: 'Alpha dashboard' })).toBeVisible();
  116 |   await page.evaluate(projectId => {
  117 |     document.querySelector<HTMLIFrameElement>('iframe[title="Application Preview"]')!.contentWindow!.postMessage({ type: 'sync-files', projectId, files: {
  118 |       '/src/App.jsx': "import Card from '@/components/Card'; import Widget from 'react-test-widget'; export default () => <><Card/><Widget/></>;",
  119 |       '/src/components/Card.jsx': "import data from '../data/title.json'; export default () => <h1>{data.title}</h1>;",
  120 |       '/src/data/title.json': '{"title":"Nested module works"}',
  121 |     } }, '*');
  122 |   }, lifecycleProjects[0].id);
  123 |   await expect(frame.locator('body')).toContainText('Nested module works');
  124 |   await expect(frame.getByRole('heading', { name: 'Nested module works' })).toBeVisible();
  125 |   await frame.getByRole('button', { name: 'Shared React 0' }).click();
  126 |   await expect(frame.getByRole('button', { name: 'Shared React 1' })).toBeVisible();
  127 |   await frame.locator('body').evaluate(() => localStorage.setItem('generated-app-token', 'preview-only'));
  128 |   expect(await frame.locator('body').evaluate(() => localStorage.getItem('generated-app-token'))).toBe('preview-only');
  129 |   expect(await page.evaluate(() => localStorage.getItem('generated-app-token'))).toBeNull();
  130 | });
  131 | 
  132 | test('preview navigation is opaque even without iframe sandbox and malformed fallback never executes', async ({ page }) => {
  133 |   await page.route('https://cdn.tailwindcss.com/**', route => route.fulfill({ contentType: 'application/javascript', body: '' }));
```