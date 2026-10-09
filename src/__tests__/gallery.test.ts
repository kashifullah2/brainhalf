import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import { AuthRegistry } from '../registry';
import type { DurableObjectState } from '@cloudflare/workers-types';

let database: DatabaseSync;
let registry: AuthRegistry;

beforeEach(async () => {
  database = new DatabaseSync(':memory:');
  // Execute at exec time, just like Durable Object SQLite.
  const storage = { sql: { exec: (query: string, ...values: any[]) => { const rows = database.prepare(query).all(...values); return { toArray: () => rows }; } }, transactionSync: (fn: () => unknown) => fn() };
  registry = new AuthRegistry({ storage } as unknown as DurableObjectState, {});
  await registry.fetch(new Request('https://registry/bootstrap'));
});

const call = (path: string, method = 'GET', body?: unknown) => registry.fetch(new Request(`https://registry${path}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
const claim = (projectId: string, userId: string, name = 'My App') => call('/projects/claim', 'POST', { projectId, userId, name });
const publish = (projectId: string, userId: string) => call(`/projects/publication?projectId=${projectId}&userId=${userId}`, 'PUT', { published: true });
const unpublish = (projectId: string, userId: string) => call(`/projects/publication?projectId=${projectId}&userId=${userId}`, 'PUT', { published: false });
const showcase = (projectId: string, userId: string, body: unknown) => call(`/projects/showcase?projectId=${projectId}&userId=${userId}`, 'PUT', body);
const galleryApps = async () => ((await (await call('/gallery')).json()) as { apps: unknown[] }).apps;
const showcaseStatus = async (projectId: string) => ((await (await call(`/projects/showcase-status?projectId=${projectId}`)).json()) as { showcase: boolean }).showcase;

describe('gallery showcase', () => {
  it('lists only published apps whose owners opted in, without private data', async () => {
    await claim('app-one', 'owner-1', 'Inventory Tracker');
    await publish('app-one', 'owner-1');
    await showcase('app-one', 'owner-1', { showcase: true, description: 'Tracks stock levels.' });
    await claim('app-two', 'owner-2', 'Private App');
    await publish('app-two', 'owner-2');
    const response = await call('/gallery');
    expect(response.status).toBe(200);
    const { apps } = await response.json() as { apps: Array<Record<string, unknown>> };
    expect(apps).toHaveLength(1);
    expect(apps[0]).toEqual({ id: 'app-one', name: 'Inventory Tracker', description: 'Tracks stock levels.', remixCount: 0, showcasedAt: expect.any(Number), productionUrl: '' });
    expect(JSON.stringify(apps)).not.toContain('owner-1');
  });

  it('requires ownership and a live app before listing, and removes listings', async () => {
    await claim('app-one', 'owner-1');
    expect((await showcase('app-one', 'owner-1', { showcase: true })).status).toBe(409);
    expect((await showcase('app-one', 'intruder', { showcase: true })).status).toBe(403);
    expect((await showcase('app-one', 'owner-1', {})).status).toBe(400);
    await publish('app-one', 'owner-1');
    expect((await showcase('app-one', 'owner-1', { showcase: true, description: 'x'.repeat(400) })).status).toBe(200);
    const listed = await (await call('/projects/showcase?projectId=app-one&userId=owner-1')).json() as { showcase: boolean; description: string };
    expect(listed.showcase).toBe(true);
    expect(listed.description).toHaveLength(280);
    await showcase('app-one', 'owner-1', { showcase: false });
    expect(((await (await call('/gallery')).json()) as { apps: unknown[] }).apps).toHaveLength(0);
  });

  it('reports showcase status for the agent remix export gate', async () => {
    await claim('app-one', 'owner-1');
    expect(((await (await call('/projects/showcase-status?projectId=app-one')).json()) as { showcase: boolean }).showcase).toBe(false);
    await publish('app-one', 'owner-1');
    await showcase('app-one', 'owner-1', { showcase: true });
    expect(((await (await call('/projects/showcase-status?projectId=app-one')).json()) as { showcase: boolean }).showcase).toBe(true);
    expect((await call('/projects/showcase-status?projectId=bad id!')).status).toBe(400);
  });

  it('drops the gallery listing when the app is taken offline, and requires a live app to re-list', async () => {
    await claim('app-one', 'owner-1', 'Inventory Tracker');
    await publish('app-one', 'owner-1');
    await showcase('app-one', 'owner-1', { showcase: true, description: 'Tracks stock levels.' });
    expect(await galleryApps()).toHaveLength(1);
    // Taking the app offline clears the published flag AND the gallery listing,
    // so the gallery never links to a dead app.
    expect((await unpublish('app-one', 'owner-1')).status).toBe(200);
    expect(await galleryApps()).toHaveLength(0);
    expect(await showcaseStatus('app-one')).toBe(false);
    // Re-listing while offline is refused; republishing re-enables it.
    expect((await showcase('app-one', 'owner-1', { showcase: true })).status).toBe(409);
    await publish('app-one', 'owner-1');
    expect((await showcase('app-one', 'owner-1', { showcase: true, description: 'Tracks stock levels.' })).status).toBe(200);
    expect(await galleryApps()).toHaveLength(1);
  });

  it('re-marking a live app as published keeps its gallery listing', async () => {
    await claim('app-one', 'owner-1', 'Inventory Tracker');
    await publish('app-one', 'owner-1');
    await showcase('app-one', 'owner-1', { showcase: true });
    // The client re-marks published when a publish job goes live; that must be
    // idempotent and must not disturb an existing listing.
    expect((await publish('app-one', 'owner-1')).status).toBe(200);
    expect(await galleryApps()).toHaveLength(1);
  });
});

describe('gallery remix', () => {
  it('creates an owned copy named after the source and counts the remix', async () => {
    await claim('app-one', 'owner-1', 'Inventory Tracker');
    await publish('app-one', 'owner-1');
    await showcase('app-one', 'owner-1', { showcase: true });
    const response = await call('/projects/remix', 'POST', { userId: 'remixer-1', sourceProjectId: 'app-one' });
    expect(response.status).toBe(201);
    const { projectId, name } = await response.json() as { projectId: string; name: string };
    expect(projectId).toMatch(/^[a-zA-Z0-9_-]{1,128}$/);
    expect(name).toBe('Inventory Tracker (remix)');
    const owner = database.prepare('SELECT user_id FROM project_owners WHERE project_id = ?').get(projectId) as { user_id: string };
    expect(owner.user_id).toBe('remixer-1');
    expect(((await (await call('/gallery')).json()) as { apps: Array<{ remixCount: number }> }).apps[0].remixCount).toBe(1);
  });

  it('refuses to remix apps that are not listed, deleted, or missing', async () => {
    await claim('app-one', 'owner-1');
    expect((await call('/projects/remix', 'POST', { userId: 'remixer-1', sourceProjectId: 'app-one' })).status).toBe(404);
    expect((await call('/projects/remix', 'POST', { userId: 'remixer-1', sourceProjectId: 'missing' })).status).toBe(404);
    expect((await call('/projects/remix', 'POST', { userId: 'remixer-1', sourceProjectId: 'bad id!' })).status).toBe(400);
  });

  it('enforces the per-user project limit on remixes', async () => {
    await claim('app-one', 'owner-1');
    await publish('app-one', 'owner-1');
    await showcase('app-one', 'owner-1', { showcase: true });
    const insert = database.prepare('INSERT INTO project_owners (project_id, user_id, name, created_at, updated_at) VALUES (?, ?, ?, 1, 1)');
    for (let index = 0; index < 200; index++) insert.run(`fill-${index}`, 'remixer-1', 'Filler');
    expect((await call('/projects/remix', 'POST', { userId: 'remixer-1', sourceProjectId: 'app-one' })).status).toBe(409);
    expect((database.prepare('SELECT remix_count AS count FROM project_owners WHERE project_id = ?').get('app-one') as { count: number }).count).toBe(0);
  });

  it('upgrades registries created before the gallery columns existed', async () => {
    const legacy = new DatabaseSync(':memory:');
    legacy.exec("CREATE TABLE project_owners (project_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL DEFAULT 'Untitled Project', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)");
    legacy.exec("INSERT INTO project_owners VALUES ('app-old', 'owner-1', 'Old App', 1, 1)");
    const storage = { sql: { exec: (query: string, ...values: any[]) => { const rows = legacy.prepare(query).all(...values); return { toArray: () => rows }; } }, transactionSync: (fn: () => unknown) => fn() };
    const upgraded = new AuthRegistry({ storage } as unknown as DurableObjectState, {});
    await upgraded.fetch(new Request('https://registry/bootstrap'));
    expect(((await (await upgraded.fetch(new Request('https://registry/projects/showcase-status?projectId=app-old'))).json()) as { showcase: boolean }).showcase).toBe(false);
    legacy.close();
  });

  it('caches the gallery listing and invalidates on showcase changes', async () => {
    await claim('app-one', 'owner-1', 'Cached App');
    await publish('app-one', 'owner-1');
    await showcase('app-one', 'owner-1', { showcase: true, description: 'First.' });
    const first = await galleryApps();
    expect(first).toHaveLength(1);
    // Remove from showcase behind the cache's back via direct SQL — the cached
    // response must still show it (proves the cache was hit).
    database.prepare('UPDATE project_owners SET showcase = 0 WHERE project_id = ?').run('app-one');
    expect(await galleryApps()).toHaveLength(1);
    // Toggling showcase through the API invalidates the cache.
    await showcase('app-one', 'owner-1', { showcase: false });
    expect(await galleryApps()).toHaveLength(0);
  });
});
