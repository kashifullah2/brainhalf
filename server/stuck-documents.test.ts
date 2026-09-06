import { describe, expect, it } from 'vitest';

import {
  MAX_ATTEMPTS,
  STUCK_AFTER_MINUTES,
  findStuckDocuments,
  recoverStuckDocuments,
} from './stuck-documents';
import type { AppEnv } from './http';

// ---------------------------------------------------------------------------
// A D1 stub that answers by SQL shape and records what it was asked to run, so
// the assertions are about the statements the recovery actually issues.
// ---------------------------------------------------------------------------

interface Recorded {
  sql: string;
  args: unknown[];
}

function stubEnv(
  stuck: Array<{ id: number; batch_id: number; user_id: string; attempts: number }>,
  options: { withQueue?: boolean } = {},
) {
  const calls: Recorded[] = [];
  const sent: unknown[][] = [];

  const make = (sql: string, args: unknown[]): Record<string, unknown> => ({
    bind: (...next: unknown[]) => make(sql, next),
    all: async () => {
      calls.push({ sql, args });
      return { success: true, results: sql.includes("status = 'processing'") ? stuck : [] };
    },
    first: async () => {
      calls.push({ sql, args });
      return null;
    },
    run: async () => {
      calls.push({ sql, args });
      return { success: true, meta: { changes: 1 } };
    },
  });

  const env = {
    DB: {
      prepare: (sql: string) => make(sql, []),
      batch: async (statements: Array<Record<string, unknown>>) => {
        for (const statement of statements) {
          await (statement.run as () => Promise<unknown>)();
        }
        return statements.map(() => ({ success: true, meta: { changes: 1 } }));
      },
    },
    ...(options.withQueue
      ? {
          OCR_QUEUE: {
            sendBatch: async (messages: unknown[]) => {
              sent.push(messages);
            },
          },
        }
      : {}),
  } as unknown as AppEnv;

  return { env, calls, sent };
}

const sqlFor = (calls: Recorded[], fragment: string) =>
  calls.filter((call) => call.sql.includes(fragment));

describe('findStuckDocuments', () => {
  it('selects on the threshold and includes rows with no start time', async () => {
    const { env, calls } = stubEnv([]);

    await findStuckDocuments(env);

    const [query] = sqlFor(calls, "status = 'processing'");
    expect(query.sql).toContain('started_at IS NULL');
    // Rows written before migration 0008 have no start time. A document that is
    // 'processing' with no record of when it began is by definition untracked.
    expect(query.args).toContain(`-${STUCK_AFTER_MINUTES} minutes`);
  });
});

describe('recoverStuckDocuments', () => {
  it('does nothing, and issues no writes, when nothing is stuck', async () => {
    const { env, calls } = stubEnv([]);

    expect(await recoverStuckDocuments(env)).toEqual({ requeued: 0, failed: 0 });
    expect(sqlFor(calls, 'UPDATE documents')).toHaveLength(0);
  });

  it('returns a document with attempts left to the queue', async () => {
    const { env, calls, sent } = stubEnv(
      [{ id: 7, batch_id: 3, user_id: 'usr_1', attempts: 1 }],
      { withQueue: true },
    );

    expect(await recoverStuckDocuments(env)).toEqual({ requeued: 1, failed: 0 });

    const [update] = sqlFor(calls, "SET status = 'queued'");
    expect(update.args).toEqual([7]);
    // started_at is cleared, or the row would look stuck again immediately.
    expect(update.sql).toContain('started_at = NULL');
    expect(sent).toEqual([
      [{ body: { batchId: 3, documentId: 7, userId: 'usr_1' } }],
    ]);
  });

  it('fails a document that has used up its attempts instead of cycling for ever', async () => {
    const { env, calls, sent } = stubEnv(
      [{ id: 9, batch_id: 4, user_id: 'usr_1', attempts: MAX_ATTEMPTS }],
      { withQueue: true },
    );

    expect(await recoverStuckDocuments(env)).toEqual({ requeued: 0, failed: 1 });

    const [update] = sqlFor(calls, "SET status = 'failed'");
    expect(update.args).toEqual([9]);
    expect(update.sql).toContain(`after ${MAX_ATTEMPTS} attempts`);
    // Nothing is re-sent: another delivery would repeat the same failure.
    expect(sent).toEqual([]);
  });

  it('recomputes each affected batch exactly once', async () => {
    const { env, calls } = stubEnv([
      { id: 1, batch_id: 3, user_id: 'usr_1', attempts: 0 },
      { id: 2, batch_id: 3, user_id: 'usr_1', attempts: 0 },
      { id: 3, batch_id: 5, user_id: 'usr_1', attempts: 0 },
    ]);

    await recoverStuckDocuments(env);

    // Without this the batch stays 'processing' after its last document became
    // terminal, and the client polls it for ever.
    const refreshes = sqlFor(calls, 'UPDATE batches');
    expect(refreshes).toHaveLength(2);
    expect(refreshes.map((call) => call.args)).toEqual([
      [3, 3],
      [5, 5],
    ]);
  });

  it('leaves the rows alone when the queue refuses the messages', async () => {
    // Reset-then-send would have moved these to 'queued' with nothing behind them,
    // which takes them out of this sweep's own predicate for ever.
    const { env, calls } = stubEnv([{ id: 13, batch_id: 7, user_id: 'usr_1', attempts: 0 }]);
    (env as unknown as { OCR_QUEUE: { sendBatch: () => Promise<void> } }).OCR_QUEUE = {
      sendBatch: async () => {
        throw new Error('queue unavailable');
      },
    };

    expect(await recoverStuckDocuments(env)).toEqual({ requeued: 0, failed: 0 });
    expect(sqlFor(calls, 'UPDATE documents')).toHaveLength(0);
    expect(sqlFor(calls, 'UPDATE batches')).toHaveLength(0);
  });

  it('still resets the row when there is no queue binding', async () => {
    // Deployments without a consumer run extraction in the browser. Resetting to
    // 'queued' is what lets the batch page offer a retry at all.
    const { env, calls } = stubEnv([{ id: 11, batch_id: 6, user_id: 'usr_1', attempts: 0 }]);

    expect(await recoverStuckDocuments(env)).toEqual({ requeued: 1, failed: 0 });
    expect(sqlFor(calls, "SET status = 'queued'")).toHaveLength(1);
  });
});
