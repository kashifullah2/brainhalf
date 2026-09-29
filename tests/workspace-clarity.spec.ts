import { openAdvanced } from './advanced-controls';
import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { lifecycleProjects, setupLifecycle } from './fixtures/lifecycle';

test('preview and runtime polling wait for project authorization and tab changes keep the same session', async ({ page }) => {
  const previewRequests: string[] = [];
  const runtimeRequests: string[] = [];
  page.on('request', request => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith('/preview/')) previewRequests.push(request.url());
    if (path.endsWith('/runtime/status')) runtimeRequests.push(request.url());
  });
  const state = await setupLifecycle(page, false, true);
  await expect(page.getByRole('status').filter({ hasText: 'Connecting your preview' })).toBeVisible();
  expect(previewRequests).toEqual([]);
  expect(runtimeRequests).toEqual([]);
  await expect.poll(() => state.sockets.length).toBe(1);
  state.sockets[0].socket.send(JSON.stringify({ type: 'history', data: [] }));
  await expect(page.locator('iframe[title="Application Preview"]')).toBeVisible();
  // The iframe navigation plus the expired-session probe both fetch
  // /preview/.../index.html — the exact count is an implementation detail;
  // what matters is that nothing was requested before authorization.
  await expect.poll(() => previewRequests.length).toBeGreaterThan(0);
  await expect.poll(() => runtimeRequests.length).toBeGreaterThan(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Code', exact: true }).click();
  await page.getByRole('button', { name: 'Chat', exact: true }).click();
  await expect(page.getByLabel('Message to the app builder')).toBeVisible();
  expect(state.sockets).toHaveLength(1);
});

for (const recovery of ['reconnect', 'retry'] as const) test(`an empty internal retry after a greeting recovers through ${recovery}`, async ({ page }) => {
  const state = await setupLifecycle(page);
  const greeting = [
    { role: 'user', content: 'Hello' },
    { role: 'assistant', content: 'Hi! What would you like to build?' },
  ];
  const socket = state.sockets[0].socket;
  socket.send(JSON.stringify({ type: 'history', data: [...greeting,
    { role: 'user', content: '[AUTO-RETRY-FULL-APP] Generate complete files' },
    { role: 'assistant', content: '' },
  ] }));
  await expect(page.getByText('No response received', { exact: true })).toBeVisible();
  await expect(page.locator('.studio-message-stream')).not.toContainText('The model finished without a reply');
  if (recovery === 'reconnect') {
    socket.send(JSON.stringify({ type: 'history', data: greeting }));
    await expect(page.getByText('No response received', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Hi! What would you like to build?', { exact: true })).toBeVisible();
    await expect(page.locator('.chat-message-ai')).toHaveCount(1);
  } else {
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await expect.poll(() => state.messages.filter(message => message.prompt).map(message => message.prompt)).toEqual(['Hello']);
  }
});

test('DeepSeek V4 Pro is selected by default and Dahl MiniMax is unavailable', async ({ page }) => {
  await setupLifecycle(page);
  await openAdvanced(page);
  const picker = page.getByTestId('model-picker-btn');
  await expect(picker).toContainText('DeepSeek V4 Pro');
  await picker.click();
  await expect(page.getByTestId('model-option-@cf/deepseek-ai/deepseek-v4-pro-0813')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('model-option-MiniMaxAI/MiniMax-M2.7')).toHaveCount(0);
});

for (const rejection of [4401, 4409]) test(`new project stays isolated when switching to chat after rejection ${rejection}`,  async ({ page }) => {
  const state = await setupLifecycle(page);
  const oldProject = lifecycleProjects[0];
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Code', exact: true }).click();
  await page.getByRole('button', { name: 'New project', exact: true }).click();
  const newId = new URL(page.url()).searchParams.get('project')!;
  expect(newId).not.toBe(oldProject.id);
  await expect(page.getByLabel('Message to the app builder')).toBeVisible();
  await page.getByRole('button', { name: 'Code', exact: true }).click();
  await page.getByRole('button', { name: 'Chat', exact: true }).click();
  await expect(page.locator('.studio-message-stream')).not.toContainText(oldProject.prompt);
  await expect.poll(() => state.sockets.some(item => item.id === newId)).toBe(true);
  state.sockets.find(item => item.id === newId)!.socket.close({ code: rejection, reason: 'Connection rejected' });
  await expect(page.getByTestId('model-status-pill')).toHaveText('Error');
  expect(new URL(page.url()).searchParams.get('project')).toBe(newId);
  await expect(page.locator('.studio-message-stream')).not.toContainText(oldProject.prompt);
  const data = await page.evaluate(id => ({
    files: localStorage.getItem(`brainhalf_account:dev-user-1:brainhalf_files_${id}`),
    messages: localStorage.getItem(`brainhalf_account:dev-user-1:brainhalf_messages_${id}`),
  }), newId);
  expect(data.files || '').not.toContain('Alpha');
  expect(data.messages || '').not.toContain(oldProject.prompt);
});

test('legacy tool blocks collapse into a summary and internal retries never use a user bubble', async ({ page }) => {
  const state = await setupLifecycle(page);
  const socket = state.sockets[0].socket;
  socket.send(JSON.stringify({ type: 'history', data: [
    { role: 'user', content: 'Build a useful dashboard', timestamp: Date.now() },
    { role: 'assistant', content: 'Inspecting the project. <tool_call>{"name":"read_file","arguments":{"path":"/src/App.jsx","secret":"private-args"}}</tool_call><function_call>{"name":"list_files"}</function_call> Ready to continue.' },
    { role: 'user', content: '[AUTO-RETRY-FULL-APP] Regenerate incomplete files' },
    { role: 'assistant', content: 'The dashboard is ready for review.' },
  ] }));
  await expect(page.getByText('The dashboard is ready for review.')).toBeVisible();
  const transcript = page.locator('.studio-message-stream');
  await expect(transcript).not.toContainText('AUTO-RETRY-FULL-APP');
  await expect(transcript).not.toContainText('tool_call');
  await expect(transcript).not.toContainText('function_call');
  await expect(transcript).not.toContainText('private-args');
  const summary = page.locator('.studio-tool-summary');
  await expect(summary).not.toHaveAttribute('open');
  await expect(summary.locator('summary')).toHaveText('Agent used tools (2)');
  await summary.locator('summary').click();
  await expect(summary.getByText('Read a file', { exact: true })).toBeVisible();
  await expect(summary.getByText('Listed project files', { exact: true })).toBeVisible();
  await expect(page.locator('.chat-message-user')).toHaveCount(1);
  for (const message of await page.locator('.chat-message').all()) {
    await expect(message.locator('.studio-message-meta').getByRole('button', { name: 'Copy message' })).toBeVisible();
  }
  await openAdvanced(page);
  await expect(page.getByTestId('model-picker-btn')).toContainText('Model');
  await expect(page.getByTestId('model-picker-btn').locator('.lucide-chevron-down')).toBeVisible();
  await mkdir('audit-artifacts/2026-09-22/workspace-clarity', { recursive: true });
  await page.locator('.chat-panel-container').screenshot({ path: 'audit-artifacts/2026-09-22/workspace-clarity/tool-summary.png' });
});

test('file progress follows writing, saved and stopped events before an app entry exists', async ({ page }) => {
  await setupLifecycle(page);
  await page.evaluate(async projectId => {
    const path = '/src/lib/events.ts';
    const { appEvents } = await import(path);
    appEvents.emit('clear-workspace');
    appEvents.emit('generation-status', { status: 'Generating', projectId, file: '/src/metrics.ts', detail: 'Writing metrics' });
    appEvents.emit('file-generated', { projectId, path: '/src/metrics.ts', content: 'export const revenue =', isComplete: false });
  }, lifecycleProjects[0].id);
  const progress = page.getByRole('list', { name: 'File progress' });
  await expect(progress.getByText('/src/metrics.ts', { exact: true })).toBeVisible();
  await expect(progress.locator('li').filter({ hasText: '/src/metrics.ts' })).toContainText('Writing…');
  await expect(page.getByTestId('model-status-pill')).toHaveText('Building');
  await expect(page.getByTestId('model-status-pill')).toHaveText('Building');
  await page.evaluate(async projectId => {
    const path = '/src/lib/events.ts';
    const { appEvents } = await import(path);
    appEvents.emit('file-generated', { projectId, path: '/src/metrics.ts', content: 'export const revenue = 120;', isComplete: true });
    appEvents.emit('file-generated', { projectId, path: '/src/chart.ts', content: 'export const chart =', isComplete: false });
    appEvents.emit('generation-status', { status: 'Stopped', projectId });
  }, lifecycleProjects[0].id);
  await expect(progress.locator('li').filter({ hasText: '/src/metrics.ts' })).toContainText('Saved');
  await expect(progress.locator('li').filter({ hasText: '/src/chart.ts' })).toContainText('Partial');
  await expect(page.getByTestId('model-status-pill')).toHaveText('Stopped');
  await expect(page.getByTestId('model-status-pill')).toHaveText('Stopped');
  const footer = page.getByLabel('Build information');
  await expect(footer).toContainText('files');
  await expect(footer.getByRole('button', { name: 'Build' })).toBeVisible();
  await expect(footer.getByRole('button', { name: 'Activity' })).toBeVisible();
  const count = await footer.locator('span').innerText();
  await expect(page.locator('.studio-build-progress summary')).toContainText(count.replace(' files', ' project files'));
  await mkdir('audit-artifacts/2026-09-22/workspace-clarity', { recursive: true });
  await page.locator('.workspace-panel-container').screenshot({ path: 'audit-artifacts/2026-09-22/workspace-clarity/file-progress.png' });
});

test('chat divider supports dragging without jumping and keyboard resizing', async ({ page }) => {
  await setupLifecycle(page);
  const divider = page.getByRole('separator', { name: 'Resize chat panel' });
  const before = Number(await divider.getAttribute('aria-valuenow'));
  const box = (await divider.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect(divider).toHaveAttribute('aria-valuenow', String(before + 80));
  await divider.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(divider).toHaveAttribute('aria-valuenow', String(before + 70));
  await page.keyboard.press('Enter');
  await expect(divider).toHaveAttribute('aria-valuenow', '440');
  await expect(page.locator('body')).not.toHaveClass(/is-resizing/);
  await page.setViewportSize({ width: 820, height: 900 });
  await expect(divider).toHaveAttribute('aria-valuenow', '320');
  expect((await page.locator('.chat-panel-container').boundingBox())!.width).toBeCloseTo(320, 0);
});

for (const theme of ['light', 'dark'] as const) {
  test(`${theme} mobile workspace keeps chat actions and preview controls inside the viewport`, async ({ page }) => {
    await setupLifecycle(page);
    await page.setViewportSize({ width: 390, height: 844 });
    if (await page.locator('html').getAttribute('data-theme') !== theme) await page.getByRole('button', { name: `Switch to ${theme} mode` }).click();
    await expect(page.getByLabel('Message to the app builder')).toBeVisible();
    await page.getByRole('button', { name: 'More message actions' }).click();
    await expect(page.getByRole('menuitem', { name: 'Edit message', exact: true })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Delete message', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const messageBox = (await page.locator('.chat-message-user .message-content').first().boundingBox())!;
    expect(messageBox.x).toBeGreaterThanOrEqual(0);
    expect(messageBox.x + messageBox.width).toBeLessThanOrEqual(390);
    await mkdir('audit-artifacts/2026-09-22/workspace-clarity', { recursive: true });
    await page.screenshot({ path: `audit-artifacts/2026-09-22/workspace-clarity/${theme}-mobile-chat.png` });
    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    await expect(page.getByLabel('Build information').getByRole('button', { name: 'Build' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Mobile view (375px)' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `audit-artifacts/2026-09-22/workspace-clarity/${theme}-mobile-preview.png` });
  });

  test(`${theme} workspace controls have clear hierarchy, target-theme icons and accessible contrast`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await setupLifecycle(page, true);
    if (await page.locator('html').getAttribute('data-theme') !== theme) await page.getByRole('button', { name: `Switch to ${theme} mode` }).click();
    const toggle = page.getByRole('button', { name: `Switch to ${theme === 'light' ? 'dark' : 'light'} mode` });
    await expect(toggle.locator(theme === 'light' ? '.lucide-moon' : '.lucide-sun')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Desktop view', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Tablet view (768px)' }).click();
    await expect(page.getByRole('button', { name: 'Tablet view (768px)' })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Desktop view', exact: true }).click();
    const styles = await page.evaluate(() => {
      const luminance = (color: string) => color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(value => { const c = value / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; }).reduce((sum, value, i) => sum + value * [.2126, .7152, .0722][i], 0);
      const ratio = (a: string, b: string) => { const x = luminance(a); const y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
      const targets = ['.studio-message-actions button', '.viewport-pill-btn.active', '.studio-theme-toggle'];
      const contrasts = targets.flatMap(selector => [...document.querySelectorAll(selector)].map(element => { const style = getComputedStyle(element); return { selector, color: style.color, background: style.backgroundColor, ratio: ratio(style.color, style.backgroundColor) }; }));
      const primary = getComputedStyle(document.querySelector('.studio-publish-button')!);
      const secondary = getComputedStyle(document.querySelector('.studio-share-button')!);
      const device = document.querySelector('.viewport-pill-btn svg')!.getBoundingClientRect();
      return { contrasts, primary: primary.backgroundColor, secondary: secondary.backgroundColor, deviceWidth: device.width, overflow: document.documentElement.scrollWidth > innerWidth };
    });
    for (const contrast of styles.contrasts) expect(contrast.ratio, JSON.stringify(contrast)).toBeGreaterThanOrEqual(4.5);
    expect(styles.primary).not.toBe(styles.secondary);
    expect(styles.deviceWidth).toBeGreaterThanOrEqual(18);
    expect(styles.overflow).toBe(false);
    await mkdir('audit-artifacts/2026-09-22/workspace-clarity', { recursive: true });
    await page.screenshot({ path: `audit-artifacts/2026-09-22/workspace-clarity/${theme}-desktop.png` });
  });
}

test('project and conversation menus consolidate actions and restore keyboard focus', async ({ page }) => {
  await setupLifecycle(page);
  await expect(page.getByTestId('topbar-status-pill')).toHaveCount(0);
  const actions = page.getByRole('button', { name: 'Project actions', exact: true });
  await actions.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: 'Project settings', exact: true })).toHaveCount(0);
  await expect(page.getByRole('menuitem').first()).toBeFocused();
  await page.keyboard.press('End');
  await expect(page.getByRole('menuitem', { name: 'Reset workspace', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(actions).toBeFocused();
  await openAdvanced(page);
  await page.getByRole('button', { name: 'User profile and menu' }).click();
  await expect(page.getByRole('menuitem', { name: /Export|Project settings|Reset/ })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.getByTestId('model-picker-btn').click();
  await expect(page.getByRole('dialog', { name: 'Choose a model' })).toBeVisible();
  await expect(page.getByText('Clear History', { exact: true })).toHaveCount(0);
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('model-picker-btn')).toBeFocused();
  await page.getByRole('button', { name: 'Conversation actions' }).click();
  await page.getByRole('menuitem', { name: 'Clear conversation' }).click();
  await expect(page.getByRole('dialog')).toContainText('Clear');
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('.chat-message-user')).toHaveCount(1);
});

test('drafting during generation is preserved and composing Enter does not send a message', async ({ page }) => {
  const state = await setupLifecycle(page);
  const composer = page.getByLabel('Message to the app builder');
  await composer.fill('Add a revenue chart');
  await page.getByTestId('send-prompt-btn').click();
  await expect(page.getByTestId('stop-generation-btn')).toBeVisible();
  await expect(composer).toBeEnabled();
  await composer.fill('Make the chart easier to read');
  await composer.press('Enter');
  expect(state.messages.filter(message => message.prompt)).toHaveLength(1);
  await page.getByTestId('stop-generation-btn').click();
  await expect(page.getByTestId('send-prompt-btn')).toBeVisible();
  await expect(composer).toHaveValue('Make the chart easier to read');
  await composer.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true });
  expect(state.messages.filter(message => message.prompt)).toHaveLength(1);
  await expect(composer).toHaveValue('Make the chart easier to read');
  await composer.press('Enter');
  await expect.poll(() => state.messages.filter(message => message.prompt).length).toBe(2);
});

test('device zoom fits the available canvas and resets when the device changes', async ({ page }) => {
  await setupLifecycle(page);
  await page.setViewportSize({ width: 1024, height: 700 });
  await page.getByRole('button', { name: 'Mobile view (375px)' }).click();
  const zoom = page.getByRole('combobox', { name: 'Preview zoom' });
  await expect(zoom).toHaveValue('fit');
  await expect.poll(async () => page.locator('.preview-canvas-scroll').evaluate(element => element.scrollWidth <= element.clientWidth && element.scrollHeight <= element.clientHeight)).toBe(true);
  expect(await page.locator('.preview-device-mobile iframe').evaluate(element => element.clientWidth)).toBe(375);
  await zoom.selectOption('1');
  await expect(page.locator('.preview-device-mobile')).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');
  await page.getByRole('button', { name: 'Tablet view (768px)' }).click();
  await expect(zoom).toHaveValue('fit');
  expect(await page.locator('.preview-device-tablet iframe').evaluate(element => element.clientWidth)).toBe(768);
  await expect.poll(async () => page.locator('.preview-canvas-scroll').evaluate(element => element.scrollWidth <= element.clientWidth && element.scrollHeight <= element.clientHeight)).toBe(true);
  await page.setViewportSize({ width: 320, height: 740 });
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Preview', exact: true })).toHaveCount(1);
  await page.getByRole('button', { name: 'Project actions' }).click();
  const bounds = (await page.getByRole('menu', { name: 'Project actions' }).boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(320);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(740);
});

test('share feedback is visible and clipboard failure provides a copyable link', async ({ page }) => {
  await setupLifecycle(page);
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => {} } });
  });
  const share = page.getByRole('button', { name: 'Copy project link' });
  await share.click();
  await expect(share).toHaveText('Copied!');
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('Denied'); } } });
    document.execCommand = () => false;
  });
  await share.click();
  await expect(page.getByRole('dialog')).toContainText('?project=lifecycle-alpha');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(share).toBeFocused();
});

test('returning from a small screen preserves the chosen desktop chat width', async ({ page }) => {
  await setupLifecycle(page);
  const divider = page.getByRole('separator', { name: 'Resize chat panel' });
  await divider.press('ArrowRight');
  await expect(divider).toHaveAttribute('aria-valuenow', '450');
  await page.setViewportSize({ width: 820, height: 900 });
  await expect(divider).toHaveAttribute('aria-valuenow', '320');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(divider).toHaveAttribute('aria-valuenow', '450');
});

test('composer always shows model, agent tools, and hosting controls', async ({ page }) => {
  await setupLifecycle(page);
  await expect(page.getByTestId('model-picker-btn')).toBeVisible();
  await expect(page.getByLabel('Message to the app builder')).toBeVisible();
});
