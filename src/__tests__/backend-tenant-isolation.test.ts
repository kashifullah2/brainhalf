/**
 * Adversarial cover for the simulated backend's tenant isolation:
 * M2 (anonymous cross-org reads), M3 (unauthenticated account takeover),
 * L1 (forms submit echoing secrets). Anonymous demo CRUD on unscoped rows
 * must keep working — the preview's simple apps depend on it.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { executeBackendRequest, InMemoryDataStore } from '../lib/backend-runner';
import { parsePasswordHash } from '../lib/crypto';

const FILES = { '/server/.env': 'JWT_SECRET=local\n' };

function req(store: InMemoryDataStore, method: string, url: string, body?: unknown, token?: string) {
  return executeBackendRequest(FILES, {
    method,
    url: 'http://localhost' + url,
    headers: { 'Content-Type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body,
  }, store);
}

async function signup(store: InMemoryDataStore, email: string, password = 'correct-horse') {
  const res = await req(store, 'POST', '/api/auth/signup', { email, password });
  expect(res.status).toBe(201);
  return res.body;
}

async function login(store: InMemoryDataStore, email: string, password: string) {
  return req(store, 'POST', '/api/auth/login', { email, password });
}

describe('simulated backend tenant isolation', () => {
  let store: InMemoryDataStore;
  beforeEach(() => { store = new InMemoryDataStore(); });

  it('M2: anonymous collection reads never see another org\'s rows', async () => {
    const a = await signup(store, 'a@x.test');
    const created = await req(store, 'POST', '/api/orders', { item: 'widget' }, a.token);
    expect(created.status).toBe(201);

    const anon = await req(store, 'GET', '/api/orders');
    expect(anon.status).toBe(200);
    expect(anon.body).toEqual([]);

    // The owner still sees their own order.
    const own = await req(store, 'GET', '/api/orders', undefined, a.token);
    expect(own.status).toBe(200);
    expect(own.body).toHaveLength(1);
  });

  it('M2: anonymous single-item reads of tenant rows need authentication', async () => {
    const a = await signup(store, 'a@x.test');
    const created = await req(store, 'POST', '/api/orders', { item: 'widget' }, a.token);
    expect((await req(store, 'GET', `/api/orders/${created.body.id}`)).status).toBe(401);

    // A signed-in user from another org still gets the cross-tenant 403.
    const b = await signup(store, 'b@x.test');
    expect((await req(store, 'GET', `/api/orders/${created.body.id}`, undefined, b.token)).status).toBe(403);
  });

  it('M3: anonymous account takeover via user update is rejected', async () => {
    const victim = await signup(store, 'victim@x.test', 'victim-password');
    const userId = victim.user.id;

    // The exact audit repro: no auth header at all.
    expect((await req(store, 'PUT', `/api/users/${userId}`, { password: 'pwned123' })).status).toBe(401);
    expect((await req(store, 'PATCH', `/api/users/${userId}`, { password: 'pwned123' })).status).toBe(401);
    expect((await req(store, 'PUT', `/api/users/${userId}`, { role: 'admin' })).status).toBe(401);
    expect((await req(store, 'DELETE', `/api/users/${userId}`)).status).toBe(401);

    // The takeover did not happen: old password works, new one does not.
    expect((await login(store, 'victim@x.test', 'victim-password')).status).toBe(200);
    expect((await login(store, 'victim@x.test', 'pwned123')).status).toBe(401);
  });

  it('M3: anonymous callers cannot mint tenant rows or admin users', async () => {
    expect((await req(store, 'POST', '/api/orders', { item: 'x', orgId: 'someone-elses-org' })).status).toBe(403);
    expect((await req(store, 'POST', '/api/users', { email: 'evil@x.test', role: 'admin' })).status).toBe(403);
  });

  it('M3: passwords written through the generic users endpoint are hashed', async () => {
    const a = await signup(store, 'a@x.test');
    const created = await req(store, 'POST', '/api/users', { email: 'plain@x.test', password: 's3cret-pw' }, a.token);
    expect(created.status).toBe(201);
    const row = store.findAll('users').find(u => u.email === 'plain@x.test');
    expect(parsePasswordHash(String(row?.password))).not.toBeNull();
    expect(JSON.stringify(row)).not.toContain('s3cret-pw');
    // ...and the digest actually authenticates.
    expect((await login(store, 'plain@x.test', 's3cret-pw')).status).toBe(200);
  });

  it('M3: members cannot escalate their own role or rewrite other accounts', async () => {
    const admin = await signup(store, 'admin@x.test');
    const invited = await req(store, 'POST', '/api/org/invite', { email: 'member@x.test' }, admin.token);
    expect(invited.status).toBe(201);
    const memberId = invited.body.member.id;
    // Admin sets the member's password through the generic endpoint (hashed).
    expect((await req(store, 'PUT', `/api/users/${memberId}`, { password: 'member-pw' }, admin.token)).status).toBe(200);
    const memberLogin = await login(store, 'member@x.test', 'member-pw');
    expect(memberLogin.status).toBe(200);
    const memberToken = memberLogin.body.token;

    // Self role escalation is refused.
    expect((await req(store, 'PUT', `/api/users/${memberId}`, { role: 'admin' }, memberToken)).status).toBe(403);
    // Rewriting another account is refused.
    expect((await req(store, 'PUT', `/api/users/${admin.user.id}`, { password: 'pwned' }, memberToken)).status).toBe(403);
    // But members can still update their own profile fields.
    expect((await req(store, 'PUT', `/api/users/${memberId}`, { name: 'New Name' }, memberToken)).status).toBe(200);
  });

  it('L1: form submissions strip secret fields from the echo', async () => {
    const res = await req(store, 'POST', '/api/forms/submit', { password: 's3cret', token: 'tok123', feedback: 'great' });
    expect(res.status).toBe(201);
    expect(res.body.data.password).toBeUndefined();
    expect(res.body.data.token).toBeUndefined();
    expect(res.body.data.feedback).toBe('great');
  });

  it('anonymous CRUD on unscoped demo rows keeps working', async () => {
    const created = await req(store, 'POST', '/api/notes', { text: 'hello' });
    expect(created.status).toBe(201);
    expect((await req(store, 'GET', '/api/notes')).status).toBe(200);
    expect((await req(store, 'GET', `/api/notes/${created.body.id}`)).status).toBe(200);
    expect((await req(store, 'PUT', `/api/notes/${created.body.id}`, { text: 'edited' })).status).toBe(200);
    expect((await req(store, 'DELETE', `/api/notes/${created.body.id}`)).status).toBe(200);
    expect((await req(store, 'GET', '/api/notes')).body).toEqual([]);
  });
});
