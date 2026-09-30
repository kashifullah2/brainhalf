import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DurableObjectState } from '@cloudflare/workers-types';

vi.mock('agents', () => ({ routeAgentRequest: vi.fn(), Agent: class {} }));
vi.mock('../agent', () => ({ ChatAgent: class {} }));

import worker from '../worker';
import { AuthRegistry } from '../registry';
import { issueToken, sha256Hex } from '../lib/crypto';
import { PREVIEW_ACCESS_HEADER } from '../lib/project-access';

const secret = 'project-access-test-secret-at-least-32-characters';
const projectId = 'private-project';
const routes = [
  { path: `/preview/${projectId}/index.html` },
  { path: `/preview/${projectId}/src/App.jsx` },
  { path: `/preview/${projectId}/api/files` },
  { path: `/p/${projectId}` },
  { path: `/p/${projectId}/src/App.jsx` },
  { path: `/p/${projectId}/api/files` },
  { path: '/api/tasks', referer: `https://brainhalf.com/preview/${projectId}/index.html` },
  { path: '/api/files', referer: `https://brainhalf.com/p/${projectId}/` },
];

describe('Project access through the Worker and real Registry SQLite', () => {
  let database: DatabaseSync;
  let registry: AuthRegistry;
  let env: any;
  let tokens: Record<string, string>;
  const agentFetch = vi.fn(async (request: Request) => request.url.includes('/api/files')
    ? Response.json({ '/src/App.jsx': 'export default function App() { return <h1>Project</h1>; }', '/server/index.js': 'private backend', '/server/.env': 'secret' })
    : new Response('project content'));
  const dispatchFetch = vi.fn(async () => new Response('deployed content'));

  beforeEach(async () => {
    agentFetch.mockClear();
    dispatchFetch.mockClear();
    database = new DatabaseSync(':memory:');
    const state = registryState();
    registry = new AuthRegistry(state, {});
    await registry.fetch(new Request('https://registry/bootstrap'));
    tokens = {};
    for (const userId of ['owner', 'other']) {
      const { token } = await issueToken(secret, userId);
      tokens[userId] = token;
      database.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?)').run(await sha256Hex(token), userId, Date.now(), Date.now() + 60_000);
    }
    database.prepare('INSERT INTO project_owners (project_id, user_id, created_at, updated_at) VALUES (?, ?, ?, ?)').run(projectId, 'owner', Date.now(), Date.now());
    env = {
      SESSION_SECRET: secret,
      REGISTRY: { idFromName: () => 'auth', get: () => ({ fetch: (input: string | Request, init?: RequestInit) => registry.fetch(new Request(input, init)) }) },
      ChatAgent: { idFromName: (name: string) => name, get: () => ({ fetch: agentFetch }) },
    };
  });

  afterEach(() => database.close());

  function registryState(): DurableObjectState {
    return { storage: { setAlarm: async () => {}, transactionSync: (work: () => unknown) => { database.exec('BEGIN'); try { const result = work(); database.exec('COMMIT'); return result; } catch (error) { database.exec('ROLLBACK'); throw error; } }, sql: { exec: (query: string, ...params: any[]) => {
      const rows = database.prepare(query).all(...params);
      return { toArray: () => rows };
    } } } } as unknown as DurableObjectState;
  }

  async function request(path: string, userId?: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    if (userId) headers.set('Authorization', `Bearer ${tokens[userId]}`);
    return worker.fetch(new Request(`https://brainhalf.com${path}`, { ...init, headers }), env, {} as any);
  }

  async function publication(published: unknown, userId = 'owner') {
    return request(`/api/projects/${projectId}/publication`, userId, { method: 'PUT', body: JSON.stringify({ published, userId: 'owner' }) });
  }

  it('resolves a pilot account privately without returning credentials or exposing a public lookup', async () => {
    database.prepare('INSERT INTO users VALUES (?, ?, ?, ?)').run('owner', 'pilot@example.com', 'private-password-hash', Date.now());
    const response = await registry.fetch(new Request('https://registry/admin/account?email=%20PILOT%40example.com%20'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: 'owner', email: 'pilot@example.com' });
    expect((await registry.fetch(new Request('https://registry/admin/account?email=absent@example.com'))).status).toBe(404);
    expect((await registry.fetch(new Request('https://registry/admin/account?email=invalid'))).status).toBe(400);
    for (const userId of [undefined, 'owner']) {
      const external = await request('/api/admin/account?email=pilot@example.com', userId);
      expect(external.status).toBe(404);
      expect(await external.text()).not.toContain('pilot@example.com');
    }
  });

  it('lists accounts for operator tooling without credentials or OAuth subjects', async () => {
    database.prepare('INSERT INTO users VALUES (?, ?, ?, ?)').run('owner', 'pilot@example.com', 'private-password-hash', 1000);
    database.prepare('INSERT INTO users VALUES (?, ?, ?, ?)').run('second', 'second@example.com', 'another-private-hash', 2000);
    database.prepare("INSERT INTO oauth_identities (provider, subject, user_id) VALUES ('google', 'google-subject-secret', 'second')").run();
    database.prepare('INSERT INTO email_verification (user_id, verified_at) VALUES (?, ?)').run('owner', 1500);
    const response = await registry.fetch(new Request('https://registry/admin/users'));
    expect(response.status).toBe(200);
    const body = await response.json() as { users: Array<Record<string, unknown>> };
    // Newest accounts first; the beforeEach session rows mark 'owner' active.
    expect(body.users.map(user => user.email)).toEqual(['second@example.com', 'pilot@example.com']);
    const pilot = body.users.find(user => user.id === 'owner')!;
    expect(pilot).toMatchObject({ verified: true, projects: 1, createdAt: 1000 });
    expect(typeof pilot.lastLoginAt).toBe('number');
    const googleUser = body.users.find(user => user.id === 'second')!;
    expect(googleUser).toMatchObject({ verified: true, projects: 0, lastLoginAt: null });
    const raw = JSON.stringify(body);
    expect(raw).not.toContain('private-password-hash');
    expect(raw).not.toContain('another-private-hash');
    expect(raw).not.toContain('google-subject-secret');
  });

  it.each(routes)('denies private reads across $path for a guest and another account', async ({ path, referer }) => {
    env.DISPATCHER = { get: () => ({ fetch: dispatchFetch }) };
    for (const userId of [undefined, 'other']) {
      const response = await request(path, userId, { headers: referer ? { Referer: referer } : {} });
      expect(response.status).toBe(userId ? 403 : 401);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
    }
    expect(agentFetch).not.toHaveBeenCalled();
    expect(dispatchFetch).not.toHaveBeenCalled();
  });

  it.each(['/api/auth/session', '/api/auth/logout', `/api/projects/${projectId}`, '/api/auth/ws-ticket', `/agents/chat-agent/${projectId}`])('rejects opaque-origin platform access before using credentials: %s', async path => {
    for (const method of ['GET', 'POST', 'DELETE']) {
      const response = await request(path, 'owner', { method, headers: { Origin: 'null' } });
      expect(response.status).toBe(403);
    }
    expect(database.prepare('SELECT deleted_at FROM project_owners WHERE project_id = ?').get(projectId)?.deleted_at).toBeNull();
  });

  it('does not inherit platform credentials for opaque preview requests and embeds only public project files', async () => {
    expect((await request(`/preview/${projectId}/index.html`, 'owner', { headers: { Origin: 'null' } })).status).toBe(401);
    expect((await request(`/preview/${projectId}/index.html`, 'owner', { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status).toBe(401);
    await publication(true);
    const response = await request(`/preview/${projectId}/index.html`, 'owner', { headers: { Origin: 'null' } });
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Security-Policy')).toContain('sandbox allow-scripts allow-forms;');
    const html = await response.text();
    expect(html).toContain('preview-runtime.js');
    expect(html).not.toContain('private backend');
    expect(html).not.toContain('/server/.env');
    expect(html).not.toContain(tokens.owner);
  });

  it('overrides tenant headers that could affect platform cookies, storage, or execution policy', async () => {
    env.DISPATCHER = { get: () => ({ fetch: async () => new Response('<script>malicious()</script>', { headers: {
      'Content-Type': 'text/html', 'Set-Cookie': 'bh_session_token=attacker', 'Clear-Site-Data': '"storage"',
      'Content-Security-Policy': 'sandbox allow-scripts allow-same-origin', 'Refresh': '0;url=/',
      'Access-Control-Allow-Credentials': 'true',
    } }) }) };
    const response = await request(`/p/${projectId}/`, 'owner');
    for (const header of ['Set-Cookie', 'Clear-Site-Data', 'Refresh', 'Access-Control-Allow-Credentials']) expect(response.headers.has(header)).toBe(false);
    expect(response.headers.get('Content-Security-Policy')).toContain('sandbox allow-scripts allow-forms;');
    expect(response.headers.get('Content-Security-Policy')).not.toContain('allow-same-origin');
  });

  it.each(routes)('allows owner reads across $path without claiming on read', async ({ path, referer }) => {
    const response = await request(path, 'owner', { headers: referer ? { Referer: referer } : {} });
    expect([200, 302]).toContain(response.status);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(database.prepare('SELECT COUNT(*) AS count FROM project_owners').get()?.count).toBe(1);
  });

  it.each(routes)('denies tombstoned projects across $path even to their former owner', async ({ path, referer }) => {
    expect((await publication(true)).status).toBe(200);
    expect((await request(`/api/projects/${projectId}`, 'owner', { method: 'DELETE' })).status).toBe(202);
    env.DISPATCHER = { get: () => ({ fetch: dispatchFetch }) };
    for (const userId of [undefined, 'owner', 'other']) {
      expect((await request(path, userId, { headers: referer ? { Referer: referer } : {} })).status).toBe(404);
    }
    expect(agentFetch).not.toHaveBeenCalled();
    expect(dispatchFetch).not.toHaveBeenCalled();
    expect((await publication(true)).status).toBe(404);
    expect((await registry.fetch(new Request('https://registry/projects/claim', { method: 'POST', body: JSON.stringify({ projectId, userId: 'other' }) }))).status).toBe(410);
  });

  it('retries deletion idempotently without letting another owner delete or reclaim it', async () => {
    expect((await request(`/api/projects/${projectId}`, 'other', { method: 'DELETE' })).status).toBe(403);
    expect((await publication(true)).status).toBe(200);
    expect((await request(`/api/projects/${projectId}`, 'owner', { method: 'DELETE' })).status).toBe(202);
    expect((await request(`/api/projects/${projectId}`, 'owner', { method: 'DELETE' })).status).toBe(202);
    expect((await request(`/api/projects/${projectId}`, 'other', { method: 'DELETE' })).status).toBe(403);
    expect(database.prepare('SELECT published FROM project_owners WHERE project_id = ?').get(projectId)?.published).toBe(0);
    // L11: deleting a never-claimed id is a 404 and must not tombstone it —
    // otherwise any verified user could permanently reserve arbitrary ids.
    expect((await request('/api/projects/unclaimed-draft', 'owner', { method: 'DELETE' })).status).toBe(404);
    expect(database.prepare('SELECT COUNT(*) AS count FROM project_owners WHERE project_id = ?').get('unclaimed-draft')?.count).toBe(0);
    // And the id stays claimable afterwards: no squat happened.
    expect((await registry.fetch(new Request('https://registry/projects/claim', { method: 'POST', body: JSON.stringify({ projectId: 'unclaimed-draft', userId: 'owner' }) }))).status).toBe(200);
  });

  it('persists explicit publication and revokes public reads immediately on unpublish', async () => {
    expect(await (await request(`/api/projects/${projectId}/publication`, 'owner')).json()).toEqual({ published: false });
    expect((await publication(true, 'other')).status).toBe(403);
    expect((await publication('true')).status).toBe(400);
    expect((await publication(true)).status).toBe(200);
    registry = new AuthRegistry(registryState(), {});
    for (const userId of [undefined, 'other']) {
      const response = await request(`/preview/${projectId}/src/App.jsx`, userId, { headers: { [PREVIEW_ACCESS_HEADER]: 'owner' } });
      expect(response.status).toBe(200);
      const forwarded = agentFetch.mock.calls[agentFetch.mock.calls.length - 1];
      expect(forwarded[0].headers.get(PREVIEW_ACCESS_HEADER)).toBe('public');
    }
    expect((await publication(false)).status).toBe(200);
    expect((await request(`/preview/${projectId}/index.html`)).status).toBe(401);
  });

  it('returns confirmed publication with the owned project list', async () => {
    const listed = async () => (await (await request('/api/projects', 'owner')).json()) as { projects: Array<{ id: string; published: boolean }> };
    expect((await listed()).projects).toEqual([expect.objectContaining({ id: projectId, published: false })]);
    await publication(true);
    expect((await listed()).projects[0].published).toBe(true);
    expect(await (await request('/api/projects', 'other')).json()).toEqual({ projects: [] });
    await publication(false);
    expect((await listed()).projects[0].published).toBe(false);
  });

  it.each(['/api/files', '/nested/api/files', '/server/index.js', '/src/server/index.js', '/package.json', '/wrangler.toml', '/src/secret.key', '/src/.env'])('keeps workspace %s private after publication, including dispatch fallback', async path => {
    await publication(true);
    env.DISPATCHER = { get: () => { throw new Error('Missing deployment'); } };
    for (const prefix of ['/preview', '/p']) {
      expect((await request(`${prefix}/${projectId}${path}`, 'other')).status).toBe(403);
    }
    expect(agentFetch).not.toHaveBeenCalled();
    expect(dispatchFetch).not.toHaveBeenCalled();
  });

  it.each(['GET', 'HEAD'])('supports %s public frontend reads through dispatch and its missing-worker fallback', async method => {
    await publication(true);
    env.DISPATCHER = { get: () => ({ fetch: dispatchFetch }) };
    expect((await request(`/p/${projectId}/src/App.jsx`, undefined, { method })).status).toBe(200);
    expect(dispatchFetch).toHaveBeenCalledOnce();
    env.DISPATCHER.get = () => { throw new Error('Missing deployment'); };
    expect((await request(`/p/${projectId}/src/App.jsx`, undefined, { method })).status).toBe(200);
    expect(agentFetch).toHaveBeenCalledOnce();
  });

  it('keeps published tenant application routes distinct from workspace source routes', async () => {
    await publication(true);
    env.DISPATCHER = { get: () => ({ fetch: dispatchFetch }) };
    for (const path of ['/about', '/products/123', '/bundle.js', '/api/files']) {
      const response = await request(`/p/${projectId}${path}`);
      expect(response.status).toBe(200);
      expect(await response.text()).toBe('deployed content');
    }
    expect(agentFetch).not.toHaveBeenCalled();
    env.DISPATCHER.get = () => { throw new Error('Missing deployment'); };
    expect((await request(`/p/${projectId}/api/files`)).status).toBe(401);
    expect(agentFetch).not.toHaveBeenCalled();
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('retains owner-only %s mutations for published apps', async method => {
    await publication(true);
    for (const path of [`/preview/${projectId}/api/tasks`, `/p/${projectId}/api/tasks`, '/api/tasks']) {
      const headers = { Referer: `https://brainhalf.com/preview/${projectId}/` };
      expect((await request(path, 'other', { method, headers })).status).toBe(403);
      expect((await request(path, 'owner', { method, headers })).status).toBe(200);
    }
  });

  it('checks publication on Referer fallback reads and rejects forged origins', async () => {
    await publication(true);
    expect((await request('/api/tasks', undefined, { headers: { Referer: `https://brainhalf.com/preview/${projectId}/` } })).status).toBe(200);
    expect((await request('/api/files', undefined, { headers: { Referer: `https://brainhalf.com/preview/${projectId}/` } })).status).toBe(401);
    agentFetch.mockClear();
    for (const referer of [`https://evil.example/preview/${projectId}/`, `https://brainhalf.com/?path=/preview/${projectId}/`, 'invalid']) {
      expect((await request('/api/tasks', 'owner', { headers: { Referer: referer } })).status).toBe(404);
    }
    expect(agentFetch).not.toHaveBeenCalled();
  });

  it.each(['showcase-missing', 'public-missing', 'demo-missing', 'template-missing', 'all-models-studio', 'default'])('does not claim or publish %s because of its name', async missingId => {
    expect((await request(`/preview/${missingId}/index.html`, 'owner')).status).toBe(404);
    expect(database.prepare('SELECT COUNT(*) AS count FROM project_owners').get()?.count).toBe(1);
    expect(agentFetch).not.toHaveBeenCalled();
  });

  it('fails closed without dispatch or fallback during Registry outages', async () => {
    env.REGISTRY.get = () => { throw new Error('Registry unavailable'); };
    env.DISPATCHER = { get: () => ({ fetch: dispatchFetch }) };
    for (const route of routes) {
      expect((await request(route.path, undefined, { headers: route.referer ? { Referer: route.referer } : {} })).status).toBe(503);
    }
    expect(agentFetch).not.toHaveBeenCalled();
    expect(dispatchFetch).not.toHaveBeenCalled();
  });

  it('rejects unauthenticated, malformed and non-owner publication requests without changing state', async () => {
    const path = `/api/projects/${projectId}/publication`;
    expect((await request(path)).status).toBe(401);
    expect((await request(path, undefined, { method: 'PUT', body: '{"published":true}' })).status).toBe(401);
    expect((await request(path, 'other')).status).toBe(403);
    expect((await request(path, 'owner', { method: 'PUT', body: '{' })).status).toBe(400);
    expect((await request(path, 'owner', { method: 'POST', body: '{"published":true}' })).status).toBe(405);
    expect(await (await request(path, 'owner')).json()).toEqual({ published: false });
  });

  it.each(['PATCH', 'DELETE'])('returns a validation error for malformed encoded project IDs on %s', async method => {
    const response = await request('/api/projects/%E0%A4%A', 'owner', { method });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Invalid project id' });
    expect(database.prepare('SELECT deleted_at FROM project_owners WHERE project_id = ?').get(projectId)?.deleted_at).toBeNull();
  });

  it('migrates an existing registry to private publication without changing ownership or tombstones', async () => {
    database.exec('ALTER TABLE project_owners DROP COLUMN published');
    database.prepare('UPDATE project_owners SET deleted_at = ? WHERE project_id = ?').run(123, projectId);
    const state = registryState();
    registry = new AuthRegistry(state, {});
    await registry.fetch(new Request('https://registry/bootstrap'));
    expect(database.prepare('SELECT user_id, deleted_at, published FROM project_owners').get()).toEqual({ user_id: 'owner', deleted_at: 123, published: 0 });
    registry = new AuthRegistry(state, {});
    expect((await registry.fetch(new Request('https://registry/bootstrap'))).status).toBe(404);
  });
});
