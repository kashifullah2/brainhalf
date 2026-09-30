import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DurableObjectState } from '@cloudflare/workers-types';

vi.mock('agents', () => ({ routeAgentRequest: vi.fn(), Agent: class {} }));
vi.mock('../agent', () => ({ ChatAgent: class {} }));

import { AuthRegistry } from '../registry';

describe('Admin project and user management', () => {
  let database: DatabaseSync;
  let registry: AuthRegistry;
  const cleanupCalls: string[] = [];
  let env: any;

  function registryState(): DurableObjectState {
    return { storage: { setAlarm: async () => {}, transactionSync: (work: () => unknown) => { database.exec('BEGIN'); try { const result = work(); database.exec('COMMIT'); return result; } catch (error) { database.exec('ROLLBACK'); throw error; } }, sql: { exec: (query: string, ...params: any[]) => {
      const rows = database.prepare(query).all(...params);
      return { toArray: () => rows };
    } } } } as unknown as DurableObjectState;
  }

  beforeEach(async () => {
    cleanupCalls.length = 0;
    database = new DatabaseSync(':memory:');
    env = {
      RUNTIME: { fetch: vi.fn(async () => { cleanupCalls.push('runtime'); return new Response('{}', { status: 200 }); }) },
      ChatAgent: {
        idFromName: (name: string) => ({ toString: () => `do-id-${name}` }),
        get: () => ({ fetch: vi.fn(async () => { cleanupCalls.push('agent'); return new Response('{}', { status: 200 }); }) }),
      },
      PROJECT_BACKUPS: { delete: vi.fn(async () => { cleanupCalls.push('backup'); }) },
    };
    registry = new AuthRegistry(registryState(), env);
    await registry.fetch(new Request('https://registry/bootstrap'));
    // Two users: one verified with a project, one unverified with a project.
    database.prepare('INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)').run('u1', 'owner@example.com', 'hash', 1000);
    database.prepare('INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)').run('u2', 'unverified@example.com', 'hash', 2000);
    database.prepare('INSERT INTO email_verification (user_id, verified_at) VALUES (?, ?)').run('u1', 1500);
    database.prepare("INSERT INTO project_owners (project_id, user_id, name, created_at, updated_at, published, showcase) VALUES (?, ?, ?, ?, ?, ?, ?)").run('proj-one', 'u1', 'First App', 1100, 1200, 1, 0);
    database.prepare("INSERT INTO project_owners (project_id, user_id, name, created_at, updated_at, published, showcase) VALUES (?, ?, ?, ?, ?, ?, ?)").run('proj-two', 'u2', 'Second App', 2100, 2200, 0, 0);
    database.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run('tok', 'u2', 2000, 9999999999999);
  });

  afterEach(() => database.close());

  it('lists all projects with owner email and status', async () => {
    const res = await registry.fetch(new Request('https://registry/admin/projects'));
    expect(res.status).toBe(200);
    const body = await res.json() as { projects: Array<Record<string, unknown>> };
    expect(body.projects).toHaveLength(2);
    const one = body.projects.find(p => p.id === 'proj-one')!;
    expect(one).toMatchObject({ ownerEmail: 'owner@example.com', name: 'First App', published: true, showcase: false, deleted: false });
    const two = body.projects.find(p => p.id === 'proj-two')!;
    expect(two).toMatchObject({ ownerEmail: 'unverified@example.com', name: 'Second App' });
  });

  it('hard-deletes a project: storage erased before the registry row is removed', async () => {
    const res = await registry.fetch(new Request('https://registry/admin/projects/proj-one', { method: 'DELETE' }));
    expect(res.status).toBe(200);
    // Cleanup ran: runtime slot, agent DO, R2 backups.
    expect(cleanupCalls).toContain('runtime');
    expect(cleanupCalls).toContain('agent');
    expect(cleanupCalls).toContain('backup');
    // Registry row is fully gone — not a tombstone.
    const rows = database.prepare('SELECT * FROM project_owners WHERE project_id = ?').all('proj-one');
    expect(rows).toHaveLength(0);
    // The other project is untouched.
    expect(database.prepare('SELECT * FROM project_owners WHERE project_id = ?').all('proj-two')).toHaveLength(1);
  });

  it('hard-delete returns 404 for an unknown project and 400 for an invalid id', async () => {
    expect((await registry.fetch(new Request('https://registry/admin/projects/nope-missing', { method: 'DELETE' }))).status).toBe(404);
    expect((await registry.fetch(new Request('https://registry/admin/projects/INVALID!!', { method: 'DELETE' }))).status).toBe(400);
  });

  it('deletes a user with all projects, sessions, and verification rows', async () => {
    const res = await registry.fetch(new Request('https://registry/admin/users/u2', { method: 'DELETE' }));
    expect(res.status).toBe(200);
    const body = await res.json() as { deletedUser: string; deletedProjects: number };
    expect(body).toMatchObject({ deletedUser: 'unverified@example.com', deletedProjects: 1 });
    // User row gone.
    expect(database.prepare('SELECT * FROM users WHERE id = ?').all('u2')).toHaveLength(0);
    // Their project fully gone.
    expect(database.prepare('SELECT * FROM project_owners WHERE user_id = ?').all('u2')).toHaveLength(0);
    // Sessions gone.
    expect(database.prepare('SELECT * FROM sessions WHERE user_id = ?').all('u2')).toHaveLength(0);
    // Storage cleanup ran for their project.
    expect(cleanupCalls).toContain('agent');
    // The other user and project are untouched.
    expect(database.prepare('SELECT * FROM users WHERE id = ?').all('u1')).toHaveLength(1);
    expect(database.prepare('SELECT * FROM project_owners WHERE project_id = ?').all('proj-one')).toHaveLength(1);
  });

  it('user delete returns 404 for an unknown user and 400 for a bad id', async () => {
    expect((await registry.fetch(new Request('https://registry/admin/users/u-missing', { method: 'DELETE' }))).status).toBe(404);
    expect((await registry.fetch(new Request('https://registry/admin/users/' + 'x'.repeat(200), { method: 'DELETE' }))).status).toBe(400);
  });

  it('hard-delete still removes the registry row when storage cleanup fails', async () => {
    env.RUNTIME.fetch = vi.fn(async () => new Response('busy', { status: 500 }));
    const res = await registry.fetch(new Request('https://registry/admin/projects/proj-two', { method: 'DELETE' }));
    expect(res.status).toBe(200);
    expect(database.prepare('SELECT * FROM project_owners WHERE project_id = ?').all('proj-two')).toHaveLength(0);
  });
});
