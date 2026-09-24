import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  checkUnsupportedBackendFeatures,
  executeBackendRequest,
  InMemoryDataStore,
  isFullStackProject,
  validateBackendFiles,
} from '../lib/backend-runner';

describe('Preview API behavior', () => {
  let store: InMemoryDataStore;

  beforeEach(() => {
    store = new InMemoryDataStore();
  });

  function request(method: string, url: string, body?: object, token?: string) {
    return executeBackendRequest({}, {
      method, url, body,
      headers: token ? { authorization: `Bearer ${token}` } : {},
    }, store);
  }

  async function register(email = 'owner@example.test') {
    const response = await request('POST', '/api/auth/signup', { email, password: 'preview-password' });
    expect(response.status).toBe(201);
    return response.body;
  }

  it('stores ordinary content mentioning runtimes without rejecting the request', async () => {
    const response = await request('POST', '/api/articles', { title: 'Trust and Rust', description: 'A PHP migration tool review' });
    expect(response.status).toBe(201);
    expect((await request('GET', `/api/articles/${response.body.id}`)).body.title).toBe('Trust and Rust');
    expect(checkUnsupportedBackendFeatures('Build a trustworthy network dashboard')).toEqual({ supported: true });
  });

  it('keeps empty collections empty after deletion', async () => {
    expect((await request('GET', '/api/tasks')).body).toEqual([]);
    const created = await request('POST', '/api/tasks', { title: 'Only task' });
    expect((await request('DELETE', `/api/tasks/${created.body.id}`)).status).toBe(200);
    expect((await request('GET', '/api/tasks')).body).toEqual([]);
    expect((await request('GET', '/api/tasks')).body).toEqual([]);
  });

  it('paginates the requested resource and exposes a consistent items list', async () => {
    store.seed('products', [{ id: 1, title: 'First' }, { id: 2, title: 'Second' }]);
    const response = await request('GET', '/api/products?page=2&limit=1');
    expect(response.status).toBe(200);
    expect(response.body.products).toHaveLength(1);
    expect(response.body.items).toEqual(response.body.products);
    expect(response.body.events).toBeUndefined();
    expect(response.body).toMatchObject({ total: 2, page: 2, limit: 1, totalPages: 2 });
  });

  it.each(['page=0', 'page=-1', 'page=1.5', 'page=nope', 'limit=0', 'limit=-1', 'limit=2oops', 'limit=Infinity', 'limit=10001'])('rejects invalid pagination: %s', async query => {
    const response = await request('GET', `/api/products?${query}`);
    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/positive integers/);
  });

  it.each([[1, '1'], ['1', 1]])('rejects IDs that address the same URL: %s then %s', async (firstId, duplicateId) => {
    expect((await request('POST', '/api/products', { id: firstId, name: 'Original' })).status).toBe(201);
    expect((await request('POST', '/api/products', { id: duplicateId, name: 'Duplicate' })).status).toBe(409);
    expect((await request('GET', '/api/products/1')).body.name).toBe('Original');
    expect((await request('DELETE', '/api/products/1')).status).toBe(200);
    expect(store.findAll('products')).toEqual([]);
  });

  it('does not bootstrap an account when login credentials are unknown', async () => {
    const response = await request('POST', '/api/auth/login', { email: 'unknown@example.test', password: 'anything' });
    expect(response.status).toBe(401);
    expect(response.body.token).toBeUndefined();
    expect(store.findAll('users')).toEqual([]);
    expect(store.findAll('organizations')).toEqual([]);
    expect(store.findAll('sessions')).toEqual([]);
  });

  it.each([{ email: 'missing@example.test' }, { email: 42, password: 'test' }, { email: 'bad@example.test', password: 42 }])('validates signup before creating any records', async body => {
    expect((await request('POST', '/api/auth/signup', body)).status).toBe(400);
    expect(store.findAll('users')).toEqual([]);
    expect(store.findAll('organizations')).toEqual([]);
  });

  it('allows only one account from concurrent signups for the same email', async () => {
    const body = { email: 'race@example.test', password: 'preview-password' };
    const results = await Promise.all([request('POST', '/api/auth/signup', body), request('POST', '/api/auth/signup', body)]);
    expect(results.map(result => result.status).sort()).toEqual([201, 409]);
    expect(store.findAll('users')).toHaveLength(1);
    expect(store.findAll('organizations')).toHaveLength(1);
  });

  it('creates distinct sessions even when the clock has not advanced', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1234567890);
    try {
      const created = await register();
      const login = await request('POST', '/api/auth/login', { email: 'owner@example.test', password: 'preview-password' });
      expect(login.status).toBe(200);
      expect(login.body.token).not.toBe(created.token);
      await request('POST', '/api/auth/logout', {}, login.body.token);
      expect((await request('GET', '/api/auth/me', undefined, created.token)).status).toBe(200);
      expect((await request('GET', '/api/auth/me', undefined, login.body.token)).status).toBe(401);
    } finally {
      clock.mockRestore();
    }
  });

  it('prevents generic CRUD from minting authentication sessions', async () => {
    const created = await register();
    expect((await request('POST', '/api/sessions', { token: 'forged', userId: created.user.id })).status).toBe(403);
    expect((await request('GET', '/api/sessions', undefined, created.token)).status).toBe(403);
    expect((await request('GET', '/api/auth/me', undefined, 'forged')).status).toBe(401);
  });

  it('preserves deliberately repeated events and prevents organization reassignment', async () => {
    const created = await register();
    const body = { name: 'Recurring event', value: 1, category: 'work' };
    const first = await request('POST', '/api/events', body, created.token);
    const second = await request('POST', '/api/events', body, created.token);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.id).not.toBe(first.body.id);
    expect((await request('POST', '/api/events', { ...body, orgId: 999 }, created.token)).status).toBe(403);
    expect((await request('PATCH', `/api/events/${first.body.id}`, { orgId: 999 }, created.token)).status).toBe(403);
    expect((await request('GET', '/api/events?page=1&limit=10', undefined, created.token)).body.events).toHaveLength(2);
  });

  it.each([-1, 0, 1.5, '2'])('rejects invalid order quantity %s without modifying stock', async quantity => {
    store.create('products', { id: 1, stock: 4 });
    expect((await request('POST', '/api/orders', { productId: 1, quantity })).status).toBe(400);
    expect(store.findById('products', 1).stock).toBe(4);
    expect(store.findAll('orders')).toEqual([]);
  });

  it('decrements stock only after a new order is successfully stored', async () => {
    store.create('products', { id: 1, stock: 4 });
    const body = { id: 'order-1', productId: 1, quantity: 2 };
    expect((await request('POST', '/api/orders', body)).status).toBe(201);
    expect((await request('POST', '/api/orders', body)).status).toBe(409);
    expect(store.findById('products', 1).stock).toBe(2);
    expect(store.findAll('orders')).toHaveLength(1);
  });

  it.each(['/server.js', 'server.ts', '/server.mjs', 'server.cjs'])('validates root backend entry %s', path => {
    const files = { [path]: 'const broken = ;' };
    expect(isFullStackProject(files)).toBe(true);
    expect(validateBackendFiles(files)?.file).toBe(path);
  });
});
