/**
 * F2 repro (NOW-02): gallery remix must enforce the 50-live-project cap.
 *
 * Invariant: ordinary users are limited to 50 live projects
 * (MAX_PROJECTS_PER_USER). The remix handler compared the caller's live
 * count against MAX_PROJECT_ROWS_PER_USER (200), so a user at the 50-live
 * cap could keep remixing gallery apps up to 200 live projects.
 */
import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import { AuthRegistry } from '../registry';
import type { DurableObjectState } from '@cloudflare/workers-types';

const SOURCE_ID = 'proj-f2-source';

let database: DatabaseSync;
let registry: AuthRegistry;

beforeEach(async () => {
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
  await registry.fetch(new Request('https://registry/bootstrap')); // runs ensureSchema
  database
    .prepare(
      `INSERT INTO project_owners (project_id, user_id, name, showcase, created_at, updated_at)
       VALUES (?, 'user-owner', 'Source App', 1, 1, 1)`,
    )
    .run(SOURCE_ID);
});

function seedLiveProjects(userId: string, n: number) {
  const stmt = database.prepare(
    `INSERT INTO project_owners (project_id, user_id, name, created_at, updated_at)
     VALUES (?, ?, 'Seeded', 1, 1)`,
  );
  for (let i = 0; i < n; i++) stmt.run(`proj-f2-p${i}`, userId);
}

const liveCount = (userId: string) =>
  (database.prepare('SELECT COUNT(*) AS c FROM project_owners WHERE user_id = ? AND deleted_at IS NULL').get(userId) as { c: number }).c;

const remix = (userId: string) =>
  registry.fetch(
    new Request('https://registry/projects/remix', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, sourceProjectId: SOURCE_ID }),
    }),
  );

describe('F2: remix enforces the 50-live-project cap', () => {
  it('rejects remix with 409 when the caller already has 50 live projects', async () => {
    seedLiveProjects('user-remixer', 50);
    expect(liveCount('user-remixer')).toBe(50);

    const res = await remix('user-remixer');

    expect(res.status).toBe(409);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toMatch(/project limit/i);
    expect(liveCount('user-remixer')).toBe(50); // nothing created
  });

  it('rejects remix with 409 when the caller has 51 live projects', async () => {
    seedLiveProjects('user-remixer', 51);

    const res = await remix('user-remixer');

    expect(res.status).toBe(409);
    expect(liveCount('user-remixer')).toBe(51);
  });

  it('succeeds with 201 at 49 live projects', async () => {
    seedLiveProjects('user-remixer', 49);

    const res = await remix('user-remixer');

    expect(res.status).toBe(201);
    expect(liveCount('user-remixer')).toBe(50);
  });

  it('sanity: remix succeeds well under the cap', async () => {
    seedLiveProjects('user-remixer', 3);

    const res = await remix('user-remixer');

    expect(res.status).toBe(201);
    expect(liveCount('user-remixer')).toBe(4);
  });
});
