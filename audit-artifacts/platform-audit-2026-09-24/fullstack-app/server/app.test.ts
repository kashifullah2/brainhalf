import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('real authentication, SQLite persistence, validation and ownership', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'application-api-'));
  process.env.DATABASE_PATH = join(directory, 'test.sqlite');
  process.env.APP_ORIGIN = 'http://localhost:5173';
  process.env.NODE_ENV = 'test';
  const { database, migrate } = await import('./db/index.ts');
  const { createApp } = await import('./app.ts');
  migrate(); migrate();
  const server = createApp();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = 'http://127.0.0.1:' + address.port;
  const request = (path: string, method = 'GET', body?: unknown, cookie = '') => fetch(base + path, { method, headers: { Origin: 'http://localhost:5173', 'Content-Type': 'application/json', Cookie: cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  try {
    assert.equal((await request('/api/items')).status, 401);
    assert.equal((await request('/api/auth/login', 'POST', { email: 'nobody@example.test', password: 'long-enough-password' })).status, 401);
    const signup = await request('/api/auth/register', 'POST', { email: 'owner@example.test', password: 'long-enough-password' });
    assert.equal(signup.status, 201);
    const cookie = signup.headers.get('set-cookie')?.split(';')[0];
    assert.ok(cookie);
    assert.match(signup.headers.get('set-cookie') || '', /HttpOnly; SameSite=Strict/);
    assert.equal((await request('/api/auth/register', 'POST', { email: 'owner@example.test', password: 'long-enough-password' })).status, 409);
    assert.deepEqual(await (await request('/api/items', 'GET', undefined, cookie)).json(), { items: [] });
    assert.equal((await request('/api/items', 'POST', { title: '' }, cookie)).status, 400);
    const created = await request('/api/items', 'POST', { title: 'Persisted record' }, cookie);
    assert.equal(created.status, 201);
    const item = await created.json();
    assert.equal(database.prepare('SELECT title FROM items WHERE id = ?').get(item.id)?.title, 'Persisted record');
    const reopened = new DatabaseSync(process.env.DATABASE_PATH);
    try { assert.equal(reopened.prepare('SELECT title FROM items WHERE id = ?').get(item.id)?.title, 'Persisted record'); } finally { reopened.close(); }
    assert.equal((await request('/api/items', 'POST', { title: 'x'.repeat(70000) }, cookie)).status, 413);
    const other = await request('/api/auth/register', 'POST', { email: 'other@example.test', password: 'long-enough-password' });
    const otherCookie = other.headers.get('set-cookie')?.split(';')[0];
    assert.ok(otherCookie);
    assert.equal((await request('/api/items/' + item.id, 'PATCH', { title: 'stolen' }, otherCookie)).status, 404);
    assert.equal((await request('/api/items/' + item.id, 'DELETE', undefined, otherCookie)).status, 404);
    assert.equal((await fetch(base + '/api/items', { method: 'POST', headers: { Cookie: cookie, Origin: 'https://attacker.invalid' } })).status, 403);
    assert.equal((await request('/api/items/' + item.id, 'PATCH', { title: 'Updated' }, cookie)).status, 200);
    assert.equal((await request('/api/auth/logout', 'POST', undefined, cookie)).status, 200);
    assert.equal((await request('/api/items', 'GET', undefined, cookie)).status, 401);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
