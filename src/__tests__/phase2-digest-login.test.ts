/**
 * Phase 2 regression cover: the generated app's own auth, which the auto-CRUD
 * layer used to implement badly.
 *
 * Two things had to change. Login ignored the password entirely — any password
 * logged any existing account in — and signup stored it in plaintext in a store
 * that `GET /api/users` then handed to the browser. The fix verifies a digest on
 * login and strips secrets from responses; these tests pin both, including the
 * upgrade path for rows written before digests existed.
 */

import { describe, it, expect } from 'vitest';
import { executeBackendRequest, InMemoryDataStore } from '../lib/backend-runner';
import { parsePasswordHash } from '../lib/crypto';

const FILES = { '/server/.env': 'JWT_SECRET=local\n' };

async function signup(store: InMemoryDataStore, email: string, password: string) {
  return executeBackendRequest(FILES, {
    method: 'POST',
    url: 'http://localhost/api/auth/signup',
    headers: { 'Content-Type': 'application/json' },
    body: { email, password },
  }, store);
}

async function login(store: InMemoryDataStore, email: string, password: string) {
  return executeBackendRequest(FILES, {
    method: 'POST',
    url: 'http://localhost/api/auth/login',
    headers: { 'Content-Type': 'application/json' },
    body: { email, password },
  }, store);
}

describe('generated-app auth (Task 2.6)', () => {
  it('stores a digest on signup, never the plaintext', async () => {
    const store = new InMemoryDataStore();
    await signup(store, 'a@b.c', 'hunter2-secret');

    const stored = store.findAll('users')[0];
    expect(stored.email).toBe('a@b.c');
    // `pbkdf2$...` shape, and the plaintext is nowhere in the row.
    expect(parsePasswordHash(stored.password)).not.toBeNull();
    expect(JSON.stringify(stored)).not.toContain('hunter2-secret');
  });

  it('accepts the correct password', async () => {
    const store = new InMemoryDataStore();
    await signup(store, 'a@b.c', 'hunter2-secret');
    const res = await login(store, 'a@b.c', 'hunter2-secret');
    expect(res.status).toBe(200);
    expect(res.body.error).toBeUndefined();
  });

  it('rejects the wrong password', async () => {
    const store = new InMemoryDataStore();
    await signup(store, 'a@b.c', 'hunter2-secret');
    // This is the regression: the old login path returned 200 for any password.
    const res = await login(store, 'a@b.c', 'totally-wrong');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid email or password');
    // And it did not hand out a session.
    expect(res.body.token).toBeUndefined();
  });

  it('upgrades a legacy plaintext row on login and keeps the password working', async () => {
    const store = new InMemoryDataStore();
    // A row from before digests: the password sits in the store as plaintext.
    store.create('users', { email: 'legacy@b.c', password: 'plaintext-pw', status: 'active' });

    const ok = await login(store, 'legacy@b.c', 'plaintext-pw');
    expect(ok.status).toBe(200);

    const upgraded = store.findAll('users').find((u) => u.email === 'legacy@b.c');
    // The plaintext is gone.
    expect(upgraded?.password).not.toBe('plaintext-pw');
    expect(parsePasswordHash(upgraded?.password ?? '')).not.toBeNull();
    // ...and the digest actually verifies, so the upgrade did not lock the user out.
    const again = await login(store, 'legacy@b.c', 'plaintext-pw');
    expect(again.status).toBe(200);
  });

  it('rejects the wrong password against a legacy plaintext row too', async () => {
    const store = new InMemoryDataStore();
    store.create('users', { email: 'legacy@b.c', password: 'plaintext-pw', status: 'active' });
    const res = await login(store, 'legacy@b.c', 'nope');
    expect(res.status).toBe(401);
  });

  it('never returns the digest from the generic users listing', async () => {
    const store = new InMemoryDataStore();
    await signup(store, 'a@b.c', 'hunter2-secret');

    const res = await executeBackendRequest(FILES, {
      method: 'GET',
      url: 'http://localhost/api/users',
      headers: {},
    }, store);
    expect(res.status).toBe(200);
    const body = res.body;
    const rows = Array.isArray(body) ? body : body?.items ?? body?.users ?? [];
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(res.body)).not.toContain('pbkdf2$');
    expect(rows[0].password).toBeUndefined();
  });
});
