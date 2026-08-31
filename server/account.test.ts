import { describe, expect, it } from 'vitest';

import type { AppEnv } from './http';
import { deleteAccount, exportUserData } from './account';

// deleteAccount is the most destructive code in the product. The ordering it
// depends on is not obvious, so it is asserted rather than assumed.

interface Harness {
  env: AppEnv;
  deleted: string[][];
  ran: { sql: string; args: unknown[] }[];
}

function harness(options: { documentPaths?: string[]; pendingPaths?: string[] } = {}): Harness {
  const deleted: string[][] = [];
  const ran: { sql: string; args: unknown[] }[] = [];

  const make = (sql: string, args: unknown[]): Record<string, unknown> => ({
    bind: (...next: unknown[]) => make(sql, next),
    all: async () => {
      ran.push({ sql, args });
      if (sql.includes('FROM documents')) {
        return {
          success: true,
          results: (options.documentPaths ?? []).map((object_path) => ({ object_path })),
        };
      }
      if (sql.includes('FROM pending_uploads')) {
        return {
          success: true,
          results: (options.pendingPaths ?? []).map((object_path) => ({ object_path })),
        };
      }
      return { success: true, results: [] };
    },
    run: async () => {
      ran.push({ sql, args });
      return { success: true, meta: { changes: 1 } };
    },
    first: async () => null,
  });

  const env = {
    DB: {
      prepare: (sql: string) => make(sql, []),
      batch: async (statements: unknown[]) => statements.map(() => ({ success: true, results: [] })),
    },
    DOCUMENTS: {
      delete: async (keys: string | string[]) => {
        deleted.push(Array.isArray(keys) ? keys : [keys]);
      },
    },
  } as unknown as AppEnv;

  return { env, deleted, ran };
}

describe('deleteAccount — ordering', () => {
  it('removes the stored files before the row that records where they are', async () => {
    // documents.object_path is the ONLY record of the R2 keys, and it cascades away
    // with the user. Deleting the user first would leave every file the account
    // uploaded in the bucket, unreferenced and unfindable.
    const h = harness({ documentPaths: ['usr_1/a.pdf', 'usr_1/b.png'] });
    const outcome = await deleteAccount(h.env, 'usr_1');

    expect(outcome).toEqual({ complete: true, objectsDeleted: 2 });
    expect(h.deleted[0]).toEqual(['usr_1/a.pdf', 'usr_1/b.png']);

    const userDelete = h.ran.findIndex((c) => c.sql.includes('DELETE FROM users'));
    const listPaths = h.ran.findIndex((c) => c.sql.includes('FROM documents'));
    expect(listPaths).toBeGreaterThanOrEqual(0);
    expect(userDelete).toBeGreaterThan(listPaths);
  });

  it('also removes uploads that never became documents', async () => {
    const h = harness({ documentPaths: [], pendingPaths: ['usr_1/orphan.pdf'] });
    const outcome = await deleteAccount(h.env, 'usr_1');
    expect(h.deleted).toEqual([['usr_1/orphan.pdf']]);
    expect(outcome.objectsDeleted).toBe(1);
  });

  it('scopes every query to the account being deleted', async () => {
    const h = harness({ documentPaths: ['usr_1/a.pdf'] });
    await deleteAccount(h.env, 'usr_1');
    for (const call of h.ran) {
      expect(call.args).toContain('usr_1');
    }
  });

  it('deletes an account with nothing stored', async () => {
    const h = harness({ documentPaths: [] });
    expect(await deleteAccount(h.env, 'usr_1')).toEqual({
      complete: true,
      objectsDeleted: 0,
    });
    expect(h.ran.some((c) => c.sql.includes('DELETE FROM users'))).toBe(true);
  });
});

describe('deleteAccount — large accounts', () => {
  it('keeps the account alive while files remain, and says it is not finished', async () => {
    // A Worker has a CPU budget and an account can hold 50,000 objects. Reporting
    // completion here would strand the remainder forever.
    const many = Array.from({ length: 10_001 }, (_, i) => `usr_1/file-${i}.pdf`);
    const h = harness({ documentPaths: many });

    const outcome = await deleteAccount(h.env, 'usr_1');
    expect(outcome.complete).toBe(false);
    expect(outcome.objectsDeleted).toBe(10_000);
    expect(h.ran.some((c) => c.sql.includes('DELETE FROM users'))).toBe(false);
  });

  it('chunks R2 deletes to the 1000-key limit', async () => {
    const many = Array.from({ length: 2_500 }, (_, i) => `usr_1/file-${i}.pdf`);
    const h = harness({ documentPaths: many });
    await deleteAccount(h.env, 'usr_1');
    expect(h.deleted.map((chunk) => chunk.length)).toEqual([1000, 1000, 500]);
  });

  it('clears the paths it handled so the next call makes progress', async () => {
    const many = Array.from({ length: 10_001 }, (_, i) => `usr_1/file-${i}.pdf`);
    const h = harness({ documentPaths: many });
    await deleteAccount(h.env, 'usr_1');
    expect(h.ran.some((c) => c.sql.includes('SET object_path = NULL'))).toBe(true);
  });
});

describe('exportUserData', () => {
  it('always reports when it was taken, and is not silently empty', async () => {
    const h = harness();
    const data = await exportUserData(h.env, 'usr_1');
    expect(Date.parse(data.exportedAt)).toBeGreaterThan(0);
    expect(data.batches).toEqual([]);
    expect(data.templates).toEqual([]);
    // A truncated export must say so rather than look complete.
    expect(data.truncated).toBe(false);
  });
});
