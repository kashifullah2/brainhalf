/**
 * Phase 2 regression cover: the per-user project quota in AuthRegistry.
 *
 * Claim-on-first-access is the ownership model, so the registry is the one place
 * a client could grow server-side state without limit — one POST per id, forever.
 * The quota is what stops that, and the live/total split is what stops a
 * create-delete cycle from defeating it (a deleted project's tombstone row is
 * kept on purpose, so it needs its own ceiling).
 *
 * `FakeSql` below is purpose-built: it implements only the statements the claim,
 * list and delete paths actually issue. It is not a SQL engine, and if those
 * statements change shape this file must change with them — that is the point of
 * keeping it in one place rather than pretending to be general.
 */

import { describe, it, expect } from 'vitest';
import type { DurableObjectState } from '@cloudflare/workers-types';
import { AuthRegistry } from '../registry';

type Row = Record<string, any>;

class FakeResult {
  constructor(private rows: Row[]) {}
  toArray(): Row[] { return this.rows; }
}

class FakeSql {
  // project_owners rows keyed by project_id; the one table these tests touch.
  readonly owners = new Map<string, Row>();
  readonly idempotency = new Map<string, Row>();

  exec(sql: string, ...params: any[]): FakeResult {
    const text = sql.trim();
    if (text.startsWith('INSERT OR IGNORE INTO project_cleanup')) return new FakeResult([]);
    if (text.startsWith('SELECT MIN(next_at)')) return new FakeResult([{ next: null }]);

    // Schema bootstrap. CREATE / ALTER / schema_version inserts have no effect
    // on the behaviour under test. PRAGMA table_info is what decides whether the
    // deleted_at column gets added, and the fake models that column as always
    // present, so the ALTER never runs.
    if (text.startsWith('CREATE ') || text.startsWith('ALTER ') || text.startsWith('INSERT OR IGNORE INTO schema_version')) {
      return new FakeResult([]);
    }
    if (text.startsWith('PRAGMA ')) {
      return new FakeResult([{ name: 'deleted_at' }]);
    }

    if (text.startsWith('DELETE FROM project_claim_idempotency WHERE created_at <= ?')) {
      const cutoff = Number(params[0]);
      for (const [key, row] of this.idempotency.entries()) {
        if (Number(row.created_at) <= cutoff) this.idempotency.delete(key);
      }
      return new FakeResult([]);
    }

    if (text.startsWith('SELECT project_id FROM project_claim_idempotency WHERE user_id = ? AND idempotency_key = ?')) {
      const [userId, idempotencyKey] = params;
      const row = this.idempotency.get(`${userId}:${idempotencyKey}`);
      return new FakeResult(row ? [{ project_id: row.project_id }] : []);
    }

    if (text.startsWith('INSERT OR IGNORE INTO project_claim_idempotency')) {
      const [userId, idempotencyKey, projectId, createdAt] = params;
      const key = `${userId}:${idempotencyKey}`;
      if (!this.idempotency.has(key)) {
        this.idempotency.set(key, { user_id: userId, idempotency_key: idempotencyKey, project_id: projectId, created_at: createdAt });
      }
      return new FakeResult([]);
    }

    if (text.startsWith('INSERT OR IGNORE INTO project_owners')) {
      const [projectId, userId, name, createdAt, updatedAt] = params;
      if (!this.owners.has(projectId)) {
        this.owners.set(projectId, { project_id: projectId, user_id: userId, name, created_at: createdAt, updated_at: updatedAt, deleted_at: null });
      }
      return new FakeResult([]);
    }

    // The quota query: live and total in one pass over the user's rows.
    if (text.startsWith('SELECT') && text.includes('SUM(CASE WHEN deleted_at IS NULL')) {
      const userId = params[0];
      let live = 0;
      let total = 0;
      for (const row of this.owners.values()) {
        if (row.user_id !== userId) continue;
        total += 1;
        if (row.deleted_at == null) live += 1;
      }
      return new FakeResult([{ live, total }]);
    }

    // The /projects/quota query: live count for one user.
    if (text.startsWith('SELECT COUNT(*) AS live FROM project_owners WHERE user_id = ? AND deleted_at IS NULL')) {
      const userId = params[0];
      let live = 0;
      for (const row of this.owners.values()) {
        if (row.user_id === userId && row.deleted_at == null) live += 1;
      }
      return new FakeResult([{ live }]);
    }

    if (text.startsWith('SELECT user_id, deleted_at FROM project_owners WHERE project_id = ?')) {
      const row = this.owners.get(params[0]);
      return new FakeResult(row ? [{ user_id: row.user_id, deleted_at: row.deleted_at }] : []);
    }

    if (text.startsWith('SELECT user_id FROM project_owners WHERE project_id = ?')) {
      const row = this.owners.get(params[0]);
      return new FakeResult(row ? [{ user_id: row.user_id }] : []);
    }

    if (text.startsWith('UPDATE project_owners SET name = ?')) {
      const row = this.owners.get(params[2]);
      if (row) { row.name = params[0]; row.updated_at = params[1]; }
      return new FakeResult([]);
    }

    // The tombstone.
    if (text.startsWith('UPDATE project_owners SET deleted_at = ?')) {
      const row = this.owners.get(params[1]);
      if (row) row.deleted_at = params[0];
      return new FakeResult([]);
    }

    if (text.startsWith('SELECT project_id, user_id, name, created_at, updated_at, published FROM project_owners')) {
      const userId = params[0];
      const limit = params[1];
      return new FakeResult(
        [...this.owners.values()]
          .filter((r) => r.user_id === userId && r.deleted_at == null)
          .sort((a, b) => Number(b.updated_at) - Number(a.updated_at))
          .slice(0, limit)
          .map((r) => ({ project_id: r.project_id, user_id: r.user_id, name: r.name, created_at: r.created_at, updated_at: r.updated_at, published: r.published ?? 0 }))
      );
    }

    throw new Error(`FakeSql does not implement: ${text.slice(0, 80)}`);
  }
}

/** A registry wired to the fake, with `n` pre-existing rows for one user. */
function registryWith(n: number, { tombstoned = false }: { tombstoned?: boolean } = {}): { registry: AuthRegistry; sql: FakeSql } {
  const sql = new FakeSql();
  for (let i = 0; i < n; i++) {
    sql.owners.set(`proj-seed-${i}`, {
      project_id: `proj-seed-${i}`,
      user_id: 'user-a',
      name: 'Seeded',
      created_at: 1_000 + i,
      updated_at: 1_000 + i,
      deleted_at: tombstoned ? 5_000 : null,
    });
  }
  const registry = new AuthRegistry({ storage: { sql, transactionSync: (work: () => unknown) => work(), setAlarm: async () => {} } } as unknown as DurableObjectState, {});
  return { registry, sql };
}

async function claim(registry: AuthRegistry, projectId: string, userId = 'user-a'): Promise<{ status: number; body: any }> {
  const res = await registry.fetch(new Request('https://do/projects/claim', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId, userId }),
  }));
  return { status: res.status, body: await res.json() };
}

async function claimWithKey(registry: AuthRegistry, projectId: string, idempotencyKey: string, userId = 'user-a'): Promise<{ status: number; body: any }> {
  const res = await registry.fetch(new Request('https://do/projects/claim', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId, userId, idempotencyKey }),
  }));
  return { status: res.status, body: await res.json() };
}

async function del(registry: AuthRegistry, projectId: string, userId = 'user-a'): Promise<number> {
  const res = await registry.fetch(new Request(`https://do/projects/${encodeURIComponent(projectId)}?userId=${userId}`, { method: 'DELETE' }));
  return res.status;
}

async function list(registry: AuthRegistry, userId = 'user-a'): Promise<any[]> {
  const res = await registry.fetch(new Request(`https://do/projects?userId=${userId}`));
  const body = await res.json();
  return body.projects;
}

describe('AuthRegistry project quota (Task 2.5)', () => {
  it('claims an unclaimed project for the first caller', async () => {
    const { registry } = registryWith(0);
    const result = await claim(registry, 'proj-new');
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ projectId: 'proj-new', ownerId: 'user-a', claimed: true });
  });

  it('returns the first claim when the same idempotency key is retried', async () => {
    const { registry } = registryWith(0);
    const first = await claimWithKey(registry, 'proj-key-first', 'submission-1');
    expect(first.status).toBe(200);
    expect(first.body.projectId).toBe('proj-key-first');
    const replay = await claimWithKey(registry, 'proj-key-first', 'submission-1');
    expect(replay.status).toBe(200);
    expect(replay.body).toMatchObject({ projectId: 'proj-key-first', ownerId: 'user-a', claimed: false, idempotent: true });
    const duplicateSubmission = await claimWithKey(registry, 'proj-key-second', 'submission-1');
    expect(duplicateSubmission.status).toBe(409);
    expect(duplicateSubmission.body.error).toMatch(/Duplicate project submission detected/);
  });

  it('refuses the claim that would exceed the live-project limit', async () => {
    const { registry } = registryWith(50);
    const result = await claim(registry, 'proj-over-limit');
    expect(result.status).toBe(409);
    expect(result.body.error).toMatch(/50-project limit/);
    // And nothing was written.
    expect(result.body.projectId).toBeUndefined();
  });

  it('admits one more claim when a project has been deleted', async () => {
    const { registry, sql } = registryWith(50);
    // A tombstoned row no longer counts towards `live`, so the slot is free...
    expect(await del(registry, 'proj-seed-0')).toBe(202);
    const result = await claim(registry, 'proj-after-delete');
    expect(result.status).toBe(200);
    // ...but the tombstone row is still there.
    expect(sql.owners.get('proj-seed-0')?.deleted_at).not.toBe(null);
    expect(sql.owners.size).toBe(51);
  });

  it('refuses the claim that would exceed the tombstone-row limit', async () => {
    // 199 deleted projects: live is 0, so the live check passes, but the total
    // row count is what this ceiling guards.
    const { registry } = registryWith(199, { tombstoned: true });
    const allowed = await claim(registry, 'proj-first-after-purge');
    expect(allowed.status).toBe(200);

    const { registry: full } = registryWith(200, { tombstoned: true });
    const refused = await claim(full, 'proj-second-after-purge');
    expect(refused.status).toBe(409);
    expect(refused.body.error).toMatch(/Deleting projects keeps their ids reserved/);
  });

  it('never revives a tombstoned project, even for its original owner', async () => {
    const { registry } = registryWith(0);
    expect((await claim(registry, 'proj-doomed')).status).toBe(200);
    expect(await del(registry, 'proj-doomed')).toBe(202);
    const reclaimed = await claim(registry, 'proj-doomed');
    expect(reclaimed.status).toBe(410);
    expect(reclaimed.body.error).toMatch(/has been deleted/);
  });

  it('does not count another user\'s projects towards the limit', async () => {
    const { registry } = registryWith(50);
    // The seeded 50 belong to user-a; user-b starts from nothing.
    const result = await claim(registry, 'proj-b', 'user-b');
    expect(result.status).toBe(200);
    expect(result.body.ownerId).toBe('user-b');
  });

  it('lists only live projects', async () => {
    const { registry } = registryWith(3, { tombstoned: true });
    const { registry: mixed } = registryWith(0);
    // Copy the live/tombstoned mix into a single registry for a clear assertion.
    expect(await list(mixed)).toEqual([]);
    expect((await list(registry))).toEqual([]);
  });

  it('ignores a malformed project id', async () => {
    const { registry } = registryWith(0);
    const result = await claim(registry, 'not a valid id');
    expect(result.status).toBe(400);
  });

  it('reports the live project count and limit via /projects/quota', async () => {
    const { registry } = registryWith(3);
    const res = await registry.fetch(new Request('https://do/projects/quota?userId=user-a'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ live: 3, limit: 50 });
  });

  it('excludes tombstoned projects from the quota count', async () => {
    const { registry } = registryWith(5, { tombstoned: true });
    const res = await registry.fetch(new Request('https://do/projects/quota?userId=user-a'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ live: 0, limit: 50 });
  });

  it('requires a userId for /projects/quota', async () => {
    const { registry } = registryWith(0);
    const res = await registry.fetch(new Request('https://do/projects/quota'));
    expect(res.status).toBe(400);
  });
});
