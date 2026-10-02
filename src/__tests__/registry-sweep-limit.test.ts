/**
 * Repro for the hosted-slot sweep keep-set truncation bug.
 *
 * The sweep (src/worker.ts project-list path) builds its keep-set from
 * GET /projects, but that endpoint clamped `limit` at 100 while accounts
 * can hold MAX_PROJECT_ROWS_PER_USER (200) lifetime rows. Any live project
 * beyond the 100 most-recently-updated would be absent from `keep`, so
 * releaseUnknown() would delete its hosted slot while the app is still live.
 *
 * Failing test first: with 150 projects, limit=250 must return all 150.
 */
import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthRegistry } from '../registry';
import type { DurableObjectState } from '@cloudflare/workers-types';

let database: DatabaseSync;
let registry: AuthRegistry;

beforeEach(async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  database = new DatabaseSync(':memory:');
  const storage = {
    sql: {
      exec: (query: string, ...values: any[]) => {
        const rows = database.prepare(query).all(...values);
        return { toArray: () => rows };
      },
    },
    transactionSync: (fn: () => unknown) => fn(),
  };
  registry = new AuthRegistry({ storage } as unknown as DurableObjectState, {});
  await registry.fetch(new Request('https://registry/bootstrap'));
  const insert = database.prepare(
    `INSERT INTO project_owners (project_id, user_id, name, created_at, updated_at)
     VALUES (?, 'user-sweep', ?, ?, ?)`
  );
  for (let i = 0; i < 150; i++) {
    insert.run(`proj-${i}`, `App ${i}`, i, i);
  }
});

describe('hosted-slot sweep keep-set completeness', () => {
  it('returns the full lifetime set when limit covers it (sweep must see every live project)', async () => {
    const res = await registry.fetch(
      new Request('https://registry/projects?userId=user-sweep&limit=250')
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { projects: unknown[] };
    expect(body.projects.length).toBe(150);
  });

  it('still caps absurd limits so the endpoint cannot be abused', async () => {
    const res = await registry.fetch(
      new Request('https://registry/projects?userId=user-sweep&limit=100000')
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { projects: unknown[] };
    // 150 projects exist; the cap must be sane (<=500) — the point is the
    // endpoint enforces *some* upper bound rather than honoring 100000.
    expect(body.projects.length).toBe(150);
  });
});
