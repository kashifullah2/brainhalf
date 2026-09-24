import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Duplex } from 'node:stream';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';

// Exercise real Node handlers, streams, sessions, scrypt and SQLite in process.
// No port is opened. This does not validate HTTP transport or browser behavior.
const temporary = mkdtempSync(join(tmpdir(), 'brainhalf-harbor-check-'));
const runtimeWarnings = [];
const onWarning = warning => runtimeWarnings.push(warning.name + ': ' + warning.message);
process.on('warning', onWarning);
process.env.DATABASE_PATH = join(temporary, 'app.sqlite');
process.env.APP_ORIGIN = 'http://localhost:5173';
process.env.NODE_ENV = 'test';
const { database, migrate } = await import('../server/db/index.ts');
const { createApp } = await import('../server/app.ts');
const { api, ApiRequestError } = await import('../src/lib/api.ts');
const server = createApp();
// Let Node emit module-initialization warnings before watching application errors.
await new Promise(resolve => setImmediate(resolve));
const originalFetch = globalThis.fetch;
const originalError = console.error;
const errors = [];
console.error = (...args) => { errors.push(args.map(String).join(' ')); originalError(...args); };
const results = [];
const requests = [];
let ownerCookie = '';
let otherCookie = '';
let noteId;
const password = 'A-long-test-password-2026!';

function request(path, { method = 'GET', body, raw, cookie, origin = process.env.APP_ORIGIN, contentType = 'application/json', address = '192.0.2.1' } = {}) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const socket = new Duplex({ read() {}, write(chunk, _encoding, done) { chunks.push(Buffer.from(chunk)); done(); } });
    Object.defineProperty(socket, 'remoteAddress', { value: address });
    const incoming = new IncomingMessage(socket);
    incoming.method = method;
    incoming.url = path;
    incoming.headers = { ...(origin ? { origin } : {}), ...(contentType ? { 'content-type': contentType } : {}), ...(cookie ? { cookie } : {}) };
    const response = new ServerResponse(incoming);
    response.assignSocket(socket);
    const timeout = setTimeout(() => { socket.destroy(); reject(new Error(method + ' ' + path + ' timed out')); }, 5_000);
    response.on('error', error => { clearTimeout(timeout); reject(error); });
    response.on('finish', () => {
      clearTimeout(timeout);
      try {
        const wire = Buffer.concat(chunks).toString('utf8');
        const split = wire.indexOf('\r\n\r\n');
        assert.notEqual(split, -1, 'Response includes a complete header block');
        // Every route ends in a single write: Node adds Content-Length, not chunked encoding.
        assert.doesNotMatch(wire.slice(0, split), /transfer-encoding: chunked/i);
        const text = wire.slice(split + 4);
        const result = { status: response.statusCode, headers: response.getHeaders(), body: text ? JSON.parse(text) : undefined, text };
        requests.push({ method, path, status: result.status });
        assert.ok(result.status < 500, method + ' ' + path + ' returned unexpected ' + result.status);
        resolve(result);
      } catch (error) { reject(error); }
      finally { socket.destroy(); }
    });
    server.emit('request', incoming, response);
    if (raw !== undefined || body !== undefined) incoming.push(Buffer.from(raw ?? JSON.stringify(body)));
    // The real HTTP parser sets this before ending the body stream.
    incoming.complete = true;
    incoming.push(null);
  });
}
async function check(name, action) {
  const started = performance.now();
  try { await action(); results.push({ name, status: 'passed', milliseconds: Math.round(performance.now() - started) }); console.log('PASS ' + name); }
  catch (error) { results.push({ name, status: 'failed', error: String(error) }); throw error; }
}
const sessionCookie = result => String(result.headers['set-cookie']).split(';')[0];

try {
  await check('Database migrations are idempotent', () => {
    migrate(); migrate();
    assert.equal(database.prepare('SELECT count(*) AS count FROM schema_migrations').get().count, 1);
  });
  await check('Health uses the real database and disables caching', async () => {
    const result = await request('/api/health');
    assert.equal(result.status, 200); assert.deepEqual(result.body, { status: 'ok' });
    assert.equal(result.headers['cache-control'], 'no-store');
    assert.equal(result.headers['x-content-type-options'], 'nosniff');
  });
  await check('Anonymous requests cannot read private data', async () => {
    for (const path of ['/api/items', '/api/auth/me']) assert.equal((await request(path)).status, 401);
  });
  await check('Registration rejects invalid input and normalizes email', async () => {
    for (const body of [{ email: 'bad', password }, { email: 'owner@example.test', password: 'short' }]) assert.equal((await request('/api/auth/register', { method: 'POST', body })).status, 400);
    const result = await request('/api/auth/register', { method: 'POST', body: { email: ' Owner@Example.Test ', password } });
    assert.equal(result.status, 201); assert.equal(result.body.user.email, 'owner@example.test');
    assert.match(result.headers['set-cookie'], /HttpOnly; SameSite=Strict; Path=\//);
    ownerCookie = sessionCookie(result);
    assert.equal((await request('/api/auth/me', { cookie: ownerCookie })).body.user.id, result.body.user.id);
  });
  await check('Passwords and session tokens are stored as hashes', () => {
    const user = database.prepare('SELECT * FROM users').get();
    assert.notEqual(user.password_hash, password); assert.equal(user.password_hash.length, 128); assert.equal(user.salt.length, 32);
    const session = database.prepare('SELECT * FROM sessions').get();
    assert.notEqual(session.token_hash, ownerCookie.slice('app_session='.length)); assert.equal(session.token_hash.length, 64);
  });
  await check('Duplicate accounts and wrong passwords produce handled errors', async () => {
    assert.equal((await request('/api/auth/register', { method: 'POST', body: { email: 'owner@example.test', password } })).status, 409);
    assert.equal((await request('/api/auth/login', { method: 'POST', body: { email: 'owner@example.test', password: 'A-wrong-password-2026!' } })).status, 401);
    assert.equal((await request('/api/auth/login', { method: 'POST', body: { email: 'absent@example.test', password } })).status, 401);
  });
  await check('New accounts start with an empty list', async () => {
    const result = await request('/api/items', { cookie: ownerCookie });
    assert.equal(result.status, 200); assert.deepEqual(result.body, { items: [] });
  });
  await check('Create, list and get return the saved note', async () => {
    const created = await request('/api/items', { method: 'POST', cookie: ownerCookie, body: { title: '  Plan the launch  ' } });
    assert.equal(created.status, 201); assert.equal(created.body.title, 'Plan the launch');
    assert.equal(typeof created.body.createdAt, 'number'); noteId = created.body.id;
    assert.deepEqual((await request('/api/items/' + noteId, { cookie: ownerCookie })).body, created.body);
    assert.deepEqual((await request('/api/items', { cookie: ownerCookie })).body.items, [created.body]);
  });
  await check('Update persists and keeps the same ID', async () => {
    const result = await request('/api/items/' + noteId, { method: 'PATCH', cookie: ownerCookie, body: { title: 'Ship Harbor Notes' } });
    assert.equal(result.status, 200); assert.equal(result.body.id, noteId); assert.equal(result.body.title, 'Ship Harbor Notes');
  });
  await check('A separate SQLite connection can reopen the saved data', () => {
    const reopened = new DatabaseSync(process.env.DATABASE_PATH);
    try { assert.deepEqual(reopened.prepare('SELECT id, title FROM items').all().map(row => ({ ...row })), [{ id: noteId, title: 'Ship Harbor Notes' }]); }
    finally { reopened.close(); }
  });
  await check('Another account cannot list, read, change or delete the owner note', async () => {
    const registered = await request('/api/auth/register', { method: 'POST', body: { email: 'other@example.test', password } });
    assert.equal(registered.status, 201); otherCookie = sessionCookie(registered);
    assert.deepEqual((await request('/api/items', { cookie: otherCookie })).body.items, []);
    for (const method of ['GET', 'PATCH', 'DELETE']) assert.equal((await request('/api/items/' + noteId, { method, cookie: otherCookie, ...(method === 'PATCH' ? { body: { title: 'Stolen' } } : {}) })).status, 404);
    assert.equal((await request('/api/items/' + noteId, { cookie: ownerCookie })).body.title, 'Ship Harbor Notes');
  });
  await check('Empty, overlong and invalid titles are rejected', async () => {
    for (const title of ['', '  ', 'a'.repeat(201), 42, null]) assert.equal((await request('/api/items', { method: 'POST', cookie: ownerCookie, body: { title } })).status, 400);
    assert.equal((await request('/api/items/' + noteId, { method: 'PATCH', cookie: ownerCookie, body: { title: '' } })).status, 400);
  });
  await check('Malformed, non-object, oversized and non-JSON payloads are rejected', async () => {
    for (const raw of ['{broken', 'null', '[]']) assert.equal((await request('/api/items', { method: 'POST', cookie: ownerCookie, raw })).status, 400);
    assert.equal((await request('/api/items', { method: 'POST', cookie: ownerCookie, body: { title: 'a'.repeat(70_000) } })).status, 413);
    assert.equal((await request('/api/items', { method: 'POST', cookie: ownerCookie, body: { title: 'No' }, contentType: 'text/plain' })).status, 415);
  });
  await check('Missing or foreign origins cannot write; allowed preflight works', async () => {
    for (const origin of ['', 'https://untrusted.example']) assert.equal((await request('/api/items', { method: 'POST', origin, cookie: ownerCookie, body: { title: 'No' } })).status, 403);
    const result = await request('/api/items', { method: 'OPTIONS' });
    assert.equal(result.status, 204); assert.equal(result.headers['access-control-allow-origin'], process.env.APP_ORIGIN);
    assert.equal((await request('/api/items', { method: 'OPTIONS', origin: 'https://untrusted.example' })).status, 403);
  });
  await check('SQL-shaped content stays data and remains editable', async () => {
    const title = "'); DROP TABLE users; -- <script>alert(1)</script>";
    const result = await request('/api/items', { method: 'POST', cookie: ownerCookie, body: { title } });
    assert.equal(result.status, 201); assert.equal(result.body.title, title);
    assert.equal(database.prepare('SELECT count(*) AS count FROM users').get().count, 2);
    assert.equal((await request('/api/items/' + result.body.id, { method: 'DELETE', cookie: ownerCookie })).status, 204);
  });
  await check('Deletion is persistent and a missing note returns 404', async () => {
    assert.equal((await request('/api/items/' + noteId, { method: 'DELETE', cookie: ownerCookie })).status, 204);
    assert.equal((await request('/api/items/' + noteId, { cookie: ownerCookie })).status, 404);
    assert.equal((await request('/api/items/' + noteId, { method: 'DELETE', cookie: ownerCookie })).status, 404);
    assert.deepEqual((await request('/api/items', { cookie: ownerCookie })).body.items, []);
  });
  await check('Frontend API client interoperates with real handlers', async () => {
    let cookie = '';
    globalThis.fetch = async (url, init = {}) => {
      const result = await request(String(url), { method: init.method, cookie, ...(init.body === undefined ? {} : { raw: String(init.body) }), contentType: new Headers(init.headers).get('content-type') || '' });
      if (result.headers['set-cookie']) cookie = sessionCookie(result);
      return new Response(result.status === 204 ? null : result.text, { status: result.status, headers: result.headers });
    };
    const account = await api.login('owner@example.test', password);
    assert.equal(account.email, 'owner@example.test'); assert.deepEqual(await api.me(), account);
    const created = await api.createItem('Client-created note');
    assert.deepEqual(await api.items(), [created]);
    assert.equal((await api.updateItem(created.id, 'Client-updated note')).title, 'Client-updated note');
    await api.deleteItem(created.id); assert.deepEqual(await api.items(), []);
    await assert.rejects(api.createItem(''), error => error instanceof ApiRequestError && error.status === 400);
    await api.logout(); await assert.rejects(api.me(), error => error instanceof ApiRequestError && error.status === 401);
    globalThis.fetch = originalFetch;
  });
  await check('Logout revokes the session and clears the cookie', async () => {
    const result = await request('/api/auth/logout', { method: 'POST', cookie: ownerCookie });
    assert.equal(result.status, 200); assert.match(result.headers['set-cookie'], /Max-Age=0/);
    assert.equal((await request('/api/auth/me', { cookie: ownerCookie })).status, 401);
  });
  await check('Expired or invented sessions cannot access notes', async () => {
    database.prepare('UPDATE sessions SET expires_at = 0').run();
    for (const cookie of [otherCookie, 'app_session=invented']) assert.equal((await request('/api/items', { cookie })).status, 401);
  });
  await check('Repeated authentication attempts are rate limited', async () => {
    const options = { method: 'POST', address: '192.0.2.42', body: { email: 'bad', password: 'short' } };
    for (let attempt = 0; attempt < 20; attempt++) assert.equal((await request('/api/auth/login', options)).status, 400);
    assert.equal((await request('/api/auth/login', options)).status, 429);
  });
  await check('Uploaded image reconstructs its original bytes', async () => {
    const { default: dataUrl } = await import('../src/assets/uploads/bc11a38c-f227-4b63-8388-33c6b3fc8c67.js');
    assert.ok(dataUrl.startsWith('data:image/png;base64,'));
    const bytes = Buffer.from(dataUrl.split(',')[1], 'base64');
    const originalHash = readFileSync(new URL('./original-image.sha256', import.meta.url), 'utf8').trim();
    assert.equal(createHash('sha256').update(bytes).digest('hex'), originalHash);
  });
  await check('No unexpected server errors were logged', () => { assert.deepEqual(errors, []); });
} catch (error) {
  process.exitCode = 1; originalError(error);
} finally {
  globalThis.fetch = originalFetch; console.error = originalError;
  process.off('warning', onWarning);
  database.close(); rmSync(temporary, { recursive: true, force: true });
  const report = { app: 'Harbor Notes', checkedAt: new Date().toISOString(), scope: 'In-process real Node request handlers and SQLite; no HTTP listener, browser or live model', passed: results.filter(result => result.status === 'passed').length, failed: results.filter(result => result.status === 'failed').length, requests: requests.length, runtimeWarnings, unexpectedServerErrors: errors, checks: results, requestResults: requests };
  writeFileSync(new URL('../../handler-results.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
  console.log(`${report.passed} passed, ${report.failed} failed; ${report.requests} handler requests.`);
}
