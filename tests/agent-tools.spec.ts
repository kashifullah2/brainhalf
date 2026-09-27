import { openAdvanced } from './advanced-controls';
import { expect, test, type Page } from '@playwright/test';
import JSZip from 'jszip';
import { setupLifecycle } from './fixtures/lifecycle';

async function toolsFixture(page: Page) {
  const state = await setupLifecycle(page); const uploads: any[] = []; const skills: any[] = []; const servers: any[] = []; const requests: any[] = [];
  await page.route('**/agents/chat-agent/*/builder/**', async route => {
    const path = new URL(route.request().url()).pathname.split('/builder')[1]; const method = route.request().method(); const body = route.request().postDataJSON();
    requests.push({ path, method, body });
    if (path === '/configuration') return route.fulfill({ json: { skills, servers } });
    if (path === '/attachments' && method === 'POST') { const file = { ...body, id: crypto.randomUUID() }; uploads.push(file); const { text: _text, dataUrl: _data, ...attachment } = file; return route.fulfill({ status: 201, json: { attachment } }); }
    if (path === '/attachments') return route.fulfill({ json: { attachments: uploads.map(({ dataUrl: _url, text: _text, ...file }) => file) } });
    if (path === '/skills' && method === 'POST') { const skill = { ...body, id: crypto.randomUUID(), enabled: true }; skills.push(skill); return route.fulfill({ json: { skill } }); }
    if (path.startsWith('/skills/') && method === 'PATCH') { Object.assign(skills.find(skill => skill.id === path.split('/')[2]), body); return route.fulfill({ json: { ok: true } }); }
    if (path === '/servers' && method === 'POST') { const server = { id: crypto.randomUUID(), name: body.name, url: body.url, enabled: false, allowedTools: [], hasToken: true, tools: [{ name: 'lookup', description: 'Find records', readOnly: true, inputSchema: { type: 'object' } }] }; servers.push(server); return route.fulfill({ json: { server } }); }
    if (path.startsWith('/servers/') && method === 'PATCH') { Object.assign(servers.find(server => server.id === path.split('/')[2]), body); return route.fulfill({ json: { ok: true } }); }
    return route.fulfill({ json: { ok: true } });
  });
  return { ...state, uploads, skills, servers, requests };
}
function pdf() {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  const stream = 'BT /F1 18 Tf 50 700 Td (PDF requirement: use a green header) Tj ET'; objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  let value = '%PDF-1.4\n'; const offsets = [0]; for (const [i, object] of objects.entries()) { offsets.push(Buffer.byteLength(value)); value += `${i + 1} 0 obj\n${object}\nendobj\n`; }
  const xref = Buffer.byteLength(value); value += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset => String(offset).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`; return Buffer.from(value);
}
test('PDF, DOCX and Markdown are extracted and attached by ID instead of dumping binary into chat', async ({ page }) => {
  const state = await toolsFixture(page); const zip = new JSZip(); zip.file('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Word requirement: accessible navigation</w:t></w:r></w:p></w:body></w:document>');
  await page.getByLabel('Message to the app builder').fill('Build using these documents');
  await page.getByLabel('Attach file or screenshot').setInputFiles([
    { name: 'brief.pdf', mimeType: 'application/pdf', buffer: pdf() },
    { name: 'requirements.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: await zip.generateAsync({ type: 'nodebuffer' }) },
    { name: 'notes.md', mimeType: 'text/markdown', buffer: Buffer.from('# Project\nUse readable headings.') },
  ]);
  await expect.poll(() => state.uploads.length, { timeout: 20000 }).toBe(3);
  expect(state.uploads[0].text).toContain('PDF requirement'); expect(state.uploads[1].text).toContain('accessible navigation'); expect(state.uploads[2].text).toContain('readable headings');
  await expect(page.getByLabel('Message to the app builder')).toHaveValue('Build using these documents');
  await page.getByLabel('Message to the app builder').press('Enter');
  await expect.poll(() => state.messages.filter(message => message.prompt).length).toBe(1);
  const sent = state.messages.find(message => message.prompt) as any; expect(sent.attachmentIds).toHaveLength(3); expect(JSON.stringify(sent)).not.toContain('data:'); expect(sent.prompt).toContain('brief.pdf');
});
test('an image can be sent without text and failed uploads preserve the draft', async ({ page }) => {
  const state = await toolsFixture(page);
  await page.getByLabel('Attach file or screenshot').setInputFiles({ name: 'image.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6DQAAAAASUVORK5CYII=', 'base64') });
  await expect.poll(() => state.uploads.length).toBe(1);
  await page.getByRole('button', { name: 'Send message' }).click(); await expect.poll(() => state.messages.filter(message => message.prompt).length).toBe(1);
  expect((state.messages.find(message => message.prompt) as any).attachmentIds).toEqual([state.uploads[0].id]);
  state.sockets[0].socket.send(JSON.stringify({ type: 'stream', chunk: { response: 'Received.', done: true } }));
  await page.getByLabel('Message to the app builder').fill('Keep my draft');
  await page.getByLabel('Attach file or screenshot').setInputFiles({ name: 'bad.pdf', mimeType: 'application/pdf', buffer: Buffer.from('not a PDF') });
  await expect(page.locator('.composer-upload-status[role=alert]')).toBeVisible({ timeout: 15000 }); await expect(page.getByLabel('Message to the app builder')).toHaveValue('Keep my draft');
});
test('image uploads recognize their bytes despite misleading or missing MIME labels', async ({ page }) => {
  const state = await toolsFixture(page);
  const buffer = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6DQAAAAASUVORK5CYII=', 'base64');
  await page.getByLabel('Attach file or screenshot').setInputFiles([
    { name: 'download.jpg', mimeType: 'image/jpeg', buffer },
    { name: 'screenshot.png', mimeType: '', buffer },
    { name: 'download.bin', mimeType: 'application/octet-stream', buffer },
  ]);
  await expect.poll(() => state.uploads.length).toBe(3);
  for (const upload of state.uploads) {
    expect(upload.mime).toBe('image/png');
    expect(upload.dataUrl).toBe(`data:image/png;base64,${buffer.toString('base64')}`);
  }
  await expect(page.getByRole('alert')).toHaveCount(0);
});
test('MCP selection, skill import and focus work without a project settings screen', async ({ page }) => {
  const state = await toolsFixture(page); await openAdvanced(page);
  // Open agent tools via + menu → Upload skills
  const trigger = page.getByRole('button', { name: 'Add and configure options', exact: true });
  await trigger.click();
  await page.getByRole('menuitem', { name: 'Upload skills', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Agent tools', exact: true }); await expect(dialog).toBeVisible();
  // Switch to MCP connections tab
  await dialog.getByRole('button', { name: 'MCP connections', exact: true }).click();
  await dialog.getByLabel('Name', { exact: true }).fill('Inventory'); await dialog.getByLabel('Server URL').fill('https://inventory.example.com/mcp'); await dialog.getByLabel('Bearer token').fill('private-browser-token');
  await dialog.getByRole('button', { name: 'Connect and discover tools' }).click(); await expect.poll(() => state.servers.length).toBe(1);
  await expect(dialog.getByLabel('Enabled for the agent')).toBeDisabled(); await dialog.getByText('0 of 1 tools selected').click(); await dialog.getByLabel('lookup', { exact: false }).check();
  await expect(dialog.getByLabel('Enabled for the agent')).toBeEnabled(); await dialog.getByLabel('Enabled for the agent').check(); await expect.poll(() => state.servers[0].enabled).toBe(true);
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('private-browser-token'); expect(JSON.stringify(state.messages)).not.toContain('private-browser-token');
  await dialog.getByRole('button', { name: 'Skills', exact: true }).click(); await dialog.getByLabel('Import Markdown or text').setInputFiles({ name: 'Accessibility.md', mimeType: 'text/markdown', buffer: Buffer.from('Use semantic buttons and visible focus.') });
  await dialog.getByRole('button', { name: 'Save skill' }).click(); await expect.poll(() => state.skills.length).toBe(1); await dialog.getByLabel('Accessibility', { exact: true }).uncheck(); await expect.poll(() => state.skills[0].enabled).toBe(false);
  await page.setViewportSize({ width: 390, height: 844 }); expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: '/tmp/brainhalf-agent-tools-mobile.png', fullPage: true }); await page.keyboard.press('Escape'); await expect(trigger).toBeFocused();
});

test('a pending tool selection stays checked and rolls back when saving fails', async ({ page }) => {
  const state = await toolsFixture(page);
  await openAdvanced(page);
  await page.getByRole('button', { name: 'Add and configure options', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Upload skills', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Agent tools', exact: true });
  await dialog.getByRole('button', { name: 'MCP connections', exact: true }).click();
  await dialog.getByLabel('Name', { exact: true }).fill('Inventory');
  await dialog.getByLabel('Server URL').fill('https://inventory.example.com/mcp');
  await dialog.getByRole('button', { name: 'Connect and discover tools' }).click();
  await dialog.getByText('0 of 1 tools selected').click();
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route(`**/builder/servers/${state.servers[0].id}`, async route => {
    await held;
    await route.fulfill({ status: 503, json: { error: 'Selection could not be saved.' } });
  }, { times: 1 });
  const tool = dialog.getByRole('checkbox', { name: /lookup/ });
  await tool.check();
  await expect(tool).toBeChecked();
  await expect(tool).toBeDisabled();
  expect(state.servers[0].allowedTools).toEqual([]);
  release();
  await expect(dialog.getByRole('alert')).toContainText('Selection could not be saved.');
  await expect(tool).not.toBeChecked();
  await expect(tool).toBeEnabled();
  await expect(dialog.getByLabel('Enabled for the agent')).toBeDisabled();
  await tool.check();
  await expect.poll(() => state.servers[0].allowedTools).toEqual(['lookup']);
  await expect(dialog.getByLabel('Enabled for the agent')).toBeEnabled();
});
