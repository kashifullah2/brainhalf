import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BuilderService, BUILDER_SCHEMA } from '../lib/builder-service';
import { validateMcpUrl } from '../lib/builder-tools';
import { attachmentModules, validateAttachment } from '../lib/builder-attachments';
import { prepareCapabilities, runCapabilityLoop, imageMessages, cfImageMessages, acceptsImageInput } from '../lib/agent-capabilities';

const databases: DatabaseSync[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); vi.unstubAllGlobals(); });
function fixture() {
  const db = new DatabaseSync(':memory:'); databases.push(db); for (const sql of BUILDER_SCHEMA) db.exec(sql);
  const service = new BuilderService((sql, ...args) => db.prepare(sql).all(...args) as never, 'project', 'owner', 'a-long-private-session-secret-at-least-32-characters', work => {
    db.exec('BEGIN');
    try { const result = work(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  });
  const request = async (path: string, method = 'GET', body?: unknown) => service.handle(new Request('https://brainhalf.test' + path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }), path);
  return { service, request, db };
}
const textUpload = (text = 'Private product requirements') => ({ name: 'brief.md', mime: 'text/markdown', size: new TextEncoder().encode(text).length, text, dataUrl: `data:text/markdown;base64,${btoa(text)}` });
function mockMcp() {
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init: RequestInit) => {
    if (init.method === 'GET' || init.method === 'DELETE') return new Response(null, { status: 405 });
    const body = JSON.parse(String(init.body)); calls.push(body.method);
    if (body.id === undefined) return new Response(null, { status: 202 });
    const result = body.method === 'initialize' ? { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'test', version: '1' } }
      : body.method === 'tools/list' ? { tools: [{ name: 'lookup', description: 'Look up an item', inputSchema: { type: 'object', properties: { name: { type: 'string' } } }, annotations: { readOnlyHint: true } }] }
      : { content: [{ type: 'text', text: 'Result for ' + body.params.arguments.name }] };
    return Response.json({ jsonrpc: '2.0', id: body.id, result });
  }));
  return calls;
}
describe('Private builder attachments and skills', () => {
  it('round-trips a 5 MB image in bounded rows and removes every chunk on deletion', async () => {
    const { request, service, db } = fixture();
    const bytes = Buffer.alloc(5 * 1024 * 1024, 173); Buffer.from('89504e470d0a1a0a', 'hex').copy(bytes);
    const dataUrl = `data:image/png;base64,${bytes.toString('base64')}`;
    const response = await request('/attachments', 'POST', { name: 'large.png', mime: 'image/png', size: bytes.length, text: '', dataUrl });
    expect(response.status).toBe(201);
    const { attachment } = await response.json();
    expect(service.attachment(attachment.id).dataUrl).toBe(dataUrl);
    expect(db.prepare('SELECT MAX(length(CAST(content AS BLOB))) AS bytes FROM builder_attachment_chunks').get()?.bytes).toBeLessThan(1_000_000);
    expect(db.prepare('SELECT length(body) AS bytes FROM builder_attachments').get()?.bytes).toBeLessThan(1000);
    await request(`/attachments/${attachment.id}`, 'DELETE');
    expect(db.prepare('SELECT COUNT(*) AS count FROM builder_attachment_chunks').get()?.count).toBe(0);
  });
  it('rolls back metadata and earlier chunks if storing an upload fails', async () => {
    const { request, db } = fixture();
    db.exec("CREATE TRIGGER fail_chunk BEFORE INSERT ON builder_attachment_chunks WHEN NEW.part=1 BEGIN SELECT RAISE(ABORT,'Storage unavailable'); END");
    const response = await request('/attachments', 'POST', { ...textUpload(), text: '', size: 900_000, dataUrl: `data:text/markdown;base64,${Buffer.alloc(900_000, 65).toString('base64')}` });
    expect(response.status).toBe(400);
    expect(db.prepare('SELECT COUNT(*) AS count FROM builder_attachments').get()?.count).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS count FROM builder_attachment_chunks').get()?.count).toBe(0);
  });
  it('retains legacy inline uploads and refuses incomplete chunked data', async () => {
    const { request, service, db } = fixture(); const legacy = { ...textUpload(), id: crypto.randomUUID() };
    db.prepare('INSERT INTO builder_attachments VALUES (?,?,?,?)').run(legacy.id, JSON.stringify(legacy), legacy.size, Date.now());
    expect(service.attachment(legacy.id)).toEqual(legacy);
    const { attachment } = await (await request('/attachments', 'POST', textUpload())).json();
    db.prepare('DELETE FROM builder_attachment_chunks WHERE attachment_id=?').run(attachment.id);
    expect(() => service.attachment(attachment.id)).toThrow('incomplete');
  });
  it('persists validated uploads, lists metadata only, and isolates projects', async () => {
    const { request, service } = fixture(); const other = fixture();
    const result = await request('/attachments', 'POST', textUpload()); expect(result.status).toBe(201);
    const { attachment } = await result.json(); expect(attachment).not.toHaveProperty('dataUrl');
    expect(service.attachment(attachment.id).text).toContain('Private product');
    expect(() => other.service.attachment(attachment.id)).toThrow('not found');
    expect(JSON.stringify(await (await request('/attachments')).json())).not.toContain('Private product');
    await request(`/attachments/${attachment.id}`, 'DELETE'); expect(() => service.attachment(attachment.id)).toThrow('not found');
  });
  it('rejects forged image bytes, bad names, size mismatches and oversized text', () => {
    for (const value of [{ ...textUpload(), name: '../secret.md' }, { ...textUpload(), size: 1 }, { ...textUpload(), text: 'x'.repeat(120001) }, { name: 'fake.png', mime: 'image/png', text: '', size: 4, dataUrl: 'data:image/png;base64,dGVzdA==' }]) expect(() => validateAttachment(value)).toThrow();
  });
  it('does not export references until use_attachment is called and preserves original bytes', async () => {
    const { request, service } = fixture(); const { attachment } = await (await request('/attachments', 'POST', textUpload())).json();
    const save = vi.fn(async () => {}); const controller = new AbortController();
    const prepared = prepareCapabilities(service, [attachment.id], controller.signal, save, false);
    expect(prepared.context).toContain('Private product requirements'); expect(save).not.toHaveBeenCalled();
    const read = await prepared.capabilities.read_attachment.execute({ id: attachment.id }); expect(read).toMatchObject({ text: 'Private product requirements' });
    const used = await prepared.capabilities.use_attachment.execute({ id: attachment.id }); expect(used).toMatchObject({ path: `/src/assets/uploads/${attachment.id}.js` });
    const modules = attachmentModules(service.attachment(attachment.id)); expect(save).toHaveBeenCalledWith(modules.files);
    expect(modules.files[`/src/assets/uploads/${attachment.id}.0.js`]).toContain(service.attachment(attachment.id).dataUrl);
    controller.abort(); await expect(prepared.capabilities.use_attachment.execute({ id: attachment.id })).rejects.toThrow();
  });
  it('applies only enabled skills and enforces limits', async () => {
    const { request, service } = fixture(); const { skill } = await (await request('/skills', 'POST', { name: 'Access', instructions: 'Use semantic buttons.' })).json();
    const context = () => prepareCapabilities(service, [], new AbortController().signal, async () => {}, false).context;
    expect(context()).toContain('Use semantic buttons.');
    await request(`/skills/${skill.id}`, 'PATCH', { enabled: false }); expect(context()).not.toContain('Use semantic buttons.');
    expect((await request('/skills', 'POST', { name: 'Too long', instructions: 'a'.repeat(12001) })).status).toBe(400);
  });
});
describe('Real MCP transport and tool permissions', () => {
  it.each(['http://example.com/mcp','https://127.0.0.1/mcp','https://169.254.169.254/mcp','https://x.internal/mcp','https://user:pass@example.com/mcp','https://example.com/mcp?token=secret'])('rejects unsafe endpoint %s', url => expect(() => validateMcpUrl(url)).toThrow());
  it('discovers tools, encrypts credentials, requires selection, invokes MCP and honors disabling', async () => {
    const calls = mockMcp(); const { request, service, db } = fixture();
    const added = await request('/servers', 'POST', { name: 'Inventory', url: 'https://inventory.example.com/mcp', token: 'super-private-bearer' }); expect(added.status).toBe(201);
    const { server } = await added.json(); expect(server.enabled).toBe(false); expect(server.tools[0].name).toBe('lookup');
    expect(JSON.stringify(service.configuration())).not.toContain('super-private-bearer'); expect(JSON.stringify(db.prepare('SELECT * FROM builder_mcp').all())).not.toContain('super-private-bearer');
    await expect(service.callTool(server.id, 'lookup', { name: 'book' })).rejects.toThrow('not enabled');
    expect((await request(`/servers/${server.id}`, 'PATCH', { enabled: true, allowedTools: ['unknown'] })).status).toBe(400);
    await request(`/servers/${server.id}`, 'PATCH', { enabled: true, allowedTools: ['lookup'] });
    expect((await service.callTool(server.id, 'lookup', { name: 'book' })).result).toContain('Result for book'); expect(calls).toContain('tools/call');
    await request(`/servers/${server.id}`, 'PATCH', { enabled: false, allowedTools: ['lookup'] });
    await expect(service.callTool(server.id, 'lookup', {})).rejects.toThrow('not enabled');
  });
});
describe('Workers AI tool turns and vision payloads', () => {
  it('executes selected tools and sends the real result back to the same model loop', async () => {
    const execute = vi.fn(async args => ({ value: args.id }));
    const run = vi.fn().mockResolvedValueOnce({ choices: [{ message: { tool_calls: [{ id: '1', function: { name: 'lookup', arguments: '{"id":"123"}' } }] } }] }).mockResolvedValueOnce({ choices: [{ message: { content: 'Found 123' } }] });
    const messages: Array<Record<string, unknown>> = [{ role: 'user', content: 'Find 123' }];
    const answer = await runCapabilityLoop(run, messages, { lookup: { parameters: { type: 'object' }, description: 'lookup', execute } }, new AbortController().signal, () => {});
    expect(answer).toBe('Found 123'); expect(execute).toHaveBeenCalledWith({ id: '123' }); expect(messages[2]).toMatchObject({ role: 'tool', content: '{"value":"123"}' });
  });
  it('does not execute a late tool after cancellation', async () => {
    const controller = new AbortController(); const execute = vi.fn();
    const run = vi.fn(async () => { controller.abort(); return { tool_calls: [{ name: 'lookup', arguments: {} }] }; });
    await expect(runCapabilityLoop(run, [], { lookup: { parameters: {}, description: '', execute } }, controller.signal, () => {})).rejects.toThrow(); expect(execute).not.toHaveBeenCalled();
  });
  it('supplies actual image data only on verified vision models', () => {
    const messages = [{ role: 'user' as const, content: 'Read image' }]; const files = [{ id: crypto.randomUUID(), name: 'photo.png', mime: 'image/png', size: 8, text: '', dataUrl: 'data:image/png;base64,iVBORw0KGgo=' }];
    expect(acceptsImageInput('@cf/moonshotai/kimi-k2.7-code')).toBe(true); expect(acceptsImageInput('@cf/openai/gpt-oss-120b')).toBe(false);
    expect(JSON.stringify(imageMessages(messages, files, true))).toContain(files[0].dataUrl); expect(JSON.stringify(cfImageMessages(messages, files, true))).toContain('image_url'); expect(imageMessages(messages, files, false)).toEqual(messages);
  });
});
