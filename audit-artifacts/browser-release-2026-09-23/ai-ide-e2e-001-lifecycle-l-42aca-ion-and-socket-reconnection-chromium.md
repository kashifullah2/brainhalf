# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: ai-ide-e2e-001-lifecycle.spec.ts >> local lifecycle: stop, switch, authenticated deletion, reload, mobile generation and socket reconnection
- Location: tests/ai-ide-e2e-001-lifecycle.spec.ts:5:1

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
  1  | import { test, expect } from '@playwright/test';
  2  | import { accountId, lifecycleProjects, setupLifecycle } from './fixtures/lifecycle';
  3  | import { assertProjectIsolation, assertProjectView, openProject, readProjectFiles } from './project-evidence';
  4  | 
  5  | test('local lifecycle: stop, switch, authenticated deletion, reload, mobile generation and socket reconnection', async ({ page }) => {
  6  |   const errors: string[] = [];
  7  |   page.on('pageerror', error => errors.push(error.message));
  8  |   const state = await setupLifecycle(page);
  9  |   const [alpha, beta] = lifecycleProjects;
  10 | 
  11 |   await page.getByLabel('Message to the app builder').fill('Add alpha checkout');
  12 |   await page.getByTestId('send-prompt-btn').click();
  13 |   await page.getByRole('button', { name: 'Build downloadable app', exact: true }).click();
  14 |   await expect.poll(() => state.messages.filter(message => message.prompt === 'Add alpha checkout').length).toBe(1);
  15 |   await expect(page.getByTestId('stop-generation-btn')).toBeVisible();
  16 |   await expect(page.getByText('Working on the requested change.', { exact: true })).toBeVisible();
  17 |   await page.getByTestId('stop-generation-btn').click();
  18 |   await expect(page.getByTestId('stop-generation-btn')).toHaveCount(0);
  19 |   await expect.poll(() => state.messages.filter(message => message.projectId === alpha.id && message.type === 'stop').length).toBe(1);
  20 |   await expect.poll(() => readProjectFiles(page, accountId, alpha.id)).toEqual(alpha.files);
  21 | 
  22 |   await assertProjectIsolation(page, accountId, lifecycleProjects);
  23 |   await expect(page.getByText('Add alpha checkout', { exact: true })).toBeVisible();
  24 |   await page.getByRole('button', { name: 'Return to Home', exact: true }).click();
  25 |   await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
  26 |   const alphaCard = page.locator('.landing-project-card').filter({ hasText: alpha.prompt });
  27 |   await alphaCard.getByRole('button', { name: 'Project actions' }).click();
  28 |   await page.getByRole('button', { name: 'Delete', exact: true }).click();
  29 |   await page.getByRole('dialog').getByRole('button', { name: 'Delete Project', exact: true }).click();
  30 |   await expect(alphaCard).toHaveCount(0);
  31 |   expect(state.deletions).toEqual([alpha.id]);
  32 |   await expect.poll(() => readProjectFiles(page, accountId, alpha.id)).toBeNull();
  33 |   await page.reload({ waitUntil: 'domcontentloaded' });
> 34 |   await expect(page).toHaveURL(/\/dashboard$/);
     |                      ^ Error: expect(page).toHaveURL(expected) failed
  35 |   await expect(alphaCard).toHaveCount(0);
  36 |   await openProject(page, beta);
  37 |   await assertProjectView(page, beta, alpha);
  38 |   expect(await readProjectFiles(page, accountId, alpha.id)).toBeNull();
  39 | 
  40 |   for (const width of [1440, 768, 390]) {
  41 |     await page.setViewportSize({ width, height: 900 });
  42 |     await expect(page.locator('.app-container')).toBeVisible();
  43 |     await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
  44 |   }
  45 |   await page.getByRole('button', { name: 'Chat', exact: true }).click();
  46 |   await page.getByLabel('Message to the app builder').fill('Add beta mobile toggle');
  47 |   await page.getByTestId('send-prompt-btn').click();
  48 |   await expect.poll(() => state.messages.filter(message => message.projectId === beta.id && message.prompt === 'Add beta mobile toggle').length).toBe(1);
  49 |   await expect(page.getByTestId('stop-generation-btn')).toBeVisible();
  50 |   await page.getByTestId('stop-generation-btn').click();
  51 |   await expect(page.getByTestId('stop-generation-btn')).toHaveCount(0);
  52 |   await expect.poll(() => state.messages.filter(message => message.projectId === beta.id && message.type === 'stop').length).toBe(1);
  53 | 
  54 |   const previousConnections = state.sockets.length;
  55 |   await state.sockets.at(-1)!.socket.close({ code: 1012, reason: 'Controlled service restart' });
  56 |   await expect.poll(() => state.sockets.length, { timeout: 15000 }).toBeGreaterThan(previousConnections);
  57 |   await page.getByLabel('Message to the app builder').fill('Confirm beta reconnect');
  58 |   await page.getByTestId('send-prompt-btn').click();
  59 |   await expect.poll(() => state.messages.filter(message => message.projectId === beta.id && message.prompt === 'Confirm beta reconnect').length).toBe(1);
  60 |   await page.getByTestId('stop-generation-btn').click();
  61 |   await expect.poll(() => readProjectFiles(page, accountId, beta.id)).toEqual(beta.files);
  62 |   expect(await readProjectFiles(page, accountId, alpha.id)).toBeNull();
  63 |   expect(errors).toEqual([]);
  64 | });
  65 | 
```