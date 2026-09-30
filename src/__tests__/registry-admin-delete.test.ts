/**
 * F1 repro (NOW-01): admin hard-delete must not delete the registry row when
 * storage cleanup fails. See src/registry.ts admin DELETE /admin/projects/:id.
 *
 * Invariant: the row is removed only AFTER the runtime slot, the agent's
 * Durable Object storage, and the R2 backups are erased. Deleting the row
 * first (or despite failures) orphans that data while freeing the project id
 * for reclaim by another user.
 */
import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthRegistry } from '../registry';
import type { DurableObjectState } from '@cloudflare/workers-types';

let database: DatabaseSync;
let registry: AuthRegistry;
let eraseCalls: string[];
let eraseBehavior: 'ok' | 'fail-status' | 'throw';

function makeEnv() {
  return {
    // PROJECT_BACKUPS is always bound in production; the mock deletes succeed.
    PROJECT_BACKUPS: { delete: async (_key: string) => {} },
    ChatAgent: {
      idFromName: (name: string) => ({ toString: () => name }),
      get: () => ({
        fetch: async () => {
          eraseCalls.push('erase');
          if (eraseBehavior === 'throw') throw new Error('simulated agent outage');
          if (eraseBehavior === 'fail-status') return new Response('erase rejected', { status: 500 });
          return Response.json({ ok: true });
        },
      }),
    },
  };
}

beforeEach(async () => {
  eraseCalls = [];
  eraseBehavior = 'ok';
  vi.spyOn(console, 'error').mockImplementation(() => {});
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
  registry = new AuthRegistry({ storage } as unknown as DurableObjectState, makeEnv());
  await registry.fetch(new Request('https://registry/bootstrap')); // runs ensureSchema
  database.prepare(
    `INSERT INTO project_owners (project_id, user_id, name, created_at, updated_at)
     VALUES ('proj-victim', 'user-victim', 'Doomed App', 1, 1)`,
  ).run();
});

const rowCount = () =>
  (database.prepare('SELECT COUNT(*) AS c FROM project_owners WHERE project_id = ?').get('proj-victim') as { c: number }).c;

const adminDelete = () =>
  registry.fetch(new Request('https://registry/admin/projects/proj-victim', { method: 'DELETE' }));

describe('admin hard delete (F1)', () => {
  it('keeps the registry row when the agent erase returns a 500', async () => {
    eraseBehavior = 'fail-status';

    const res = await adminDelete();
    const body = (await res.json()) as { failedSteps?: string[] };

    expect(eraseCalls).toHaveLength(1);
    expect(res.status).toBe(500);
    expect(JSON.stringify(body.failedSteps)).toContain('agent');
    expect(rowCount()).toBe(1);
  });

  it('keeps the registry row when the agent erase throws', async () => {
    eraseBehavior = 'throw';

    const res = await adminDelete();

    expect(eraseCalls).toHaveLength(1);
    expect(res.status).toBe(500);
    expect(rowCount()).toBe(1);
  });

  it('deletes the row and is retryable: a later successful attempt completes the delete', async () => {
    eraseBehavior = 'fail-status';
    const first = await adminDelete();
    expect(first.status).toBe(500);
    expect(rowCount()).toBe(1);

    eraseBehavior = 'ok';
    const retry = await adminDelete();
    expect(retry.status).toBe(200);
    expect(rowCount()).toBe(0);
  });
});
