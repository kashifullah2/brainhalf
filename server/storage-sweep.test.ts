import { describe, expect, it } from 'vitest';

import type { AppEnv } from './http';
import { sweepAbandonedUploads } from './storage-sweep';

// This function deletes files. The tests below are mostly about what it must NOT
// delete, and about the ordering that stops an object being leaked forever.

interface Harness {
  env: AppEnv;
  deleted: string[][];
  sql: string[];
  binds: unknown[][];
}

function harness(options: {
  pending?: string[];
  r2Fails?: boolean;
  listFails?: boolean;
  deleteRowsFail?: boolean;
} = {}): Harness {
  const deleted: string[][] = [];
  const sql: string[] = [];
  const binds: unknown[][] = [];

  const make = (statement: string, args: unknown[]): Record<string, unknown> => ({
    bind: (...next: unknown[]) => make(statement, next),
    all: async () => {
      sql.push(statement);
      binds.push(args);
      if (options.listFails) throw new Error('D1 unavailable');
      return {
        success: true,
        results: (options.pending ?? []).map((object_path) => ({ object_path })),
      };
    },
    run: async () => {
      sql.push(statement);
      binds.push(args);
      if (options.deleteRowsFail) throw new Error('D1 unavailable');
      return { success: true, meta: { changes: 1 } };
    },
    first: async () => null,
  });

  const env = {
    DB: { prepare: (statement: string) => make(statement, []) },
    DOCUMENTS: {
      delete: async (keys: string | string[]) => {
        if (options.r2Fails) throw new Error('R2 unavailable');
        deleted.push(Array.isArray(keys) ? keys : [keys]);
      },
    },
  } as unknown as AppEnv;

  return { env, deleted, sql, binds };
}

describe('sweepAbandonedUploads — what it refuses to touch', () => {
  it('deletes nothing when there is nothing abandoned', async () => {
    const h = harness({ pending: [] });
    expect(await sweepAbandonedUploads(h.env)).toBe(0);
    expect(h.deleted).toEqual([]);
  });

  it('only ever considers rows past the grace period', async () => {
    // The window between storing bytes and creating the row that references them
    // is normally seconds, but a user can legitimately leave the tab open.
    const h = harness({ pending: ['usr_1/a.pdf'] });
    await sweepAbandonedUploads(h.env);
    expect(h.sql[0]).toContain("created_at < datetime('now', ?)");
    expect(h.binds[0][0]).toBe('-24 hours');
  });

  it('requires the documents table to agree that nothing points at the object', async () => {
    // Belt and braces: the pending row alone is not enough to justify a delete.
    const h = harness({ pending: ['usr_1/a.pdf'] });
    await sweepAbandonedUploads(h.env);
    expect(h.sql[0]).toContain('NOT EXISTS');
    expect(h.sql[0]).toContain('FROM documents d WHERE d.object_path = p.object_path');
  });

  it('bounds how much one request pays for', async () => {
    const h = harness({ pending: ['usr_1/a.pdf'] });
    await sweepAbandonedUploads(h.env);
    expect(h.sql[0]).toContain('LIMIT ?');
    expect(h.binds[0][1]).toBe(50);
  });

  it('does nothing at all without both bindings', async () => {
    expect(await sweepAbandonedUploads({} as AppEnv)).toBe(0);
    expect(await sweepAbandonedUploads({ DB: {} } as unknown as AppEnv)).toBe(0);
  });
});

describe('sweepAbandonedUploads — ordering and failure', () => {
  it('removes the objects and then their rows', async () => {
    const h = harness({ pending: ['usr_1/a.pdf', 'usr_2/b.png'] });
    expect(await sweepAbandonedUploads(h.env)).toBe(2);
    expect(h.deleted).toEqual([['usr_1/a.pdf', 'usr_2/b.png']]);
    // One batched R2 call, then one DELETE.
    expect(h.sql.at(-1)).toContain('DELETE FROM pending_uploads');
  });

  it('keeps the rows when the object delete fails, so the next sweep retries', async () => {
    // Clearing rows first would lose track of the objects permanently.
    const h = harness({ pending: ['usr_1/a.pdf'], r2Fails: true });
    expect(await sweepAbandonedUploads(h.env)).toBe(0);
    expect(h.sql.some((s) => s.includes('DELETE FROM pending_uploads'))).toBe(false);
  });

  it('still reports success when only the row cleanup fails', async () => {
    // The bytes are gone, which is the part that mattered; deleting an absent key
    // on the next sweep is harmless.
    const h = harness({ pending: ['usr_1/a.pdf'], deleteRowsFail: true });
    expect(await sweepAbandonedUploads(h.env)).toBe(1);
    expect(h.deleted).toEqual([['usr_1/a.pdf']]);
  });

  it('never throws when the database is unreachable', async () => {
    const h = harness({ listFails: true });
    await expect(sweepAbandonedUploads(h.env)).resolves.toBe(0);
    expect(h.deleted).toEqual([]);
  });
});
