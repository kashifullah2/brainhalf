import { describe, expect, it } from 'vitest';

import { onRequestPost as cancelPost } from '../functions/api/batches/[batchId]/cancel';
import { onRequestPost as resultPost } from '../functions/api/batches/[batchId]/documents/[documentId]/result';
import { onRequestPost as failurePost } from '../functions/api/batches/[batchId]/documents/[documentId]/failure';
import { CANCELLABLE_DOCUMENT_STATUSES } from './batches';
import type { AppEnv } from './http';

// ---------------------------------------------------------------------------
// Cancelling a batch.
//
// The product had no way to stop one: a hundred documents started with the wrong
// extraction mode could only be waited out or deleted whole, which discards the
// pages that had already succeeded.
//
// The stub answers by SQL shape and records every statement, because what matters
// here is precisely which rows the cancel touches -- an over-broad UPDATE would
// destroy the results the feature exists to preserve.
// ---------------------------------------------------------------------------

const USER_ROW = {
  id: 'usr_owner',
  email: 'owner@example.com',
  first_name: 'Ada',
  last_name: 'Lovelace',
  picture_url: null,
  email_verified: 1,
  expires_at: '2099-01-01 00:00:00',
};

interface Recorded {
  sql: string;
  args: unknown[];
}

interface StubOptions {
  /** false makes the ownership lookup miss, as it does for another user's batch. */
  ownsBatch?: boolean;
  /** Status the document rows report to findOwnedDocument. */
  documentStatus?: string;
  /** Rows the guarded result UPDATE reports as changed. */
  resultChanges?: number;
  /** Status the batch reports after the recompute. */
  batchStatusAfter?: string;
  /** Documents the cancel UPDATE reports as changed. */
  cancelChanges?: number;
}

function stubEnv(options: StubOptions = {}) {
  const {
    ownsBatch = true,
    documentStatus = 'queued',
    resultChanges = 1,
    batchStatusAfter = 'cancelled',
    cancelChanges = 3,
  } = options;
  const calls: Recorded[] = [];

  const make = (sql: string, args: unknown[]): Record<string, unknown> => ({
    bind: (...next: unknown[]) => make(sql, next),
    first: async () => {
      calls.push({ sql, args });
      if (sql.includes('FROM sessions')) return USER_ROW;
      if (sql.includes('rate_limits')) return { count: 1 };
      if (sql.includes('FROM batches WHERE id = ? AND user_id = ?')) {
        return ownsBatch ? { id: 7 } : null;
      }
      if (sql.includes('SELECT status FROM batches')) return { status: batchStatusAfter };
      if (sql.includes('FROM documents d')) {
        return ownsBatch
          ? { id: 11, batch_id: 7, object_path: 'usr_owner/x.pdf', status: documentStatus }
          : null;
      }
      return null;
    },
    run: async () => {
      calls.push({ sql, args });
      const changes = sql.includes("SET status = 'cancelled'") ? cancelChanges : 1;
      return { success: true, meta: { changes, last_row_id: 11 } };
    },
    all: async () => {
      calls.push({ sql, args });
      return { success: true, results: [] };
    },
  });

  const env = {
    DB: {
      prepare: (sql: string) => make(sql, []),
      batch: async (statements: Array<Record<string, unknown>>) => {
        const out = [];
        for (const [index, statement] of statements.entries()) {
          await (statement.run as () => Promise<unknown>)();
          out.push({
            success: true,
            meta: { changes: index === 0 ? resultChanges : 1, last_row_id: 11 },
          });
        }
        return out;
      },
    },
    DOCUMENTS: { delete: async () => undefined },
  } as unknown as AppEnv;

  return { env, calls };
}

type Handler = (ctx: unknown) => Promise<Response>;

function call(
  handler: unknown,
  url: string,
  env: AppEnv,
  params: Record<string, string>,
  body?: unknown,
): Promise<Response> {
  const request = new Request(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: 'bh_session=test-session-token',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return (handler as Handler)({ request, env, params }) as Promise<Response>;
}

const CANCEL_URL = 'https://app.example.com/api/batches/7/cancel';
const RESULT_URL = 'https://app.example.com/api/batches/7/documents/11/result';
const FAILURE_URL = 'https://app.example.com/api/batches/7/documents/11/failure';

const sqlFor = (calls: Recorded[], fragment: string) =>
  calls.filter((call) => call.sql.includes(fragment));

describe('POST /api/batches/:id/cancel', () => {
  it('cancels only the documents that have not finished', async () => {
    const { env, calls } = stubEnv();

    const response = await call(cancelPost, CANCEL_URL, env, { batchId: '7' });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ cancelled: 3, status: 'cancelled' });

    const [update] = sqlFor(calls, "SET status = 'cancelled'");
    // The whole point of the feature: a completed document keeps its extracted
    // fields. An UPDATE without this IN clause would silently discard them.
    expect(update.sql).toContain("status IN (?, ?)");
    expect(update.args).toEqual([7, ...CANCELLABLE_DOCUMENT_STATUSES]);
    expect(CANCELLABLE_DOCUMENT_STATUSES).toEqual(['queued', 'processing']);
  });

  it('recomputes the batch status rather than assuming it', async () => {
    const { env, calls } = stubEnv();

    await call(cancelPost, CANCEL_URL, env, { batchId: '7' });

    // A batch of half-completed, half-cancelled documents is 'partial', not
    // 'cancelled', and only the recompute knows which.
    expect(sqlFor(calls, 'UPDATE batches')).toHaveLength(1);
  });

  it('answers 404 for a batch that is not the caller’s, and touches nothing', async () => {
    const { env, calls } = stubEnv({ ownsBatch: false });

    const response = await call(cancelPost, CANCEL_URL, env, { batchId: '7' });

    expect(response.status).toBe(404);
    expect(sqlFor(calls, 'UPDATE documents')).toHaveLength(0);
    expect(sqlFor(calls, 'UPDATE batches')).toHaveLength(0);
  });

  it('is idempotent: a second call cancels nothing and is not an error', async () => {
    const { env } = stubEnv({ cancelChanges: 0, batchStatusAfter: 'completed' });

    const response = await call(cancelPost, CANCEL_URL, env, { batchId: '7' });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ cancelled: 0, status: 'completed' });
  });

  it('rejects a malformed batch id before doing any work', async () => {
    const { env, calls } = stubEnv();

    const response = await call(cancelPost, CANCEL_URL, env, { batchId: 'not-a-number' });

    expect(response.status).toBe(400);
    expect(sqlFor(calls, 'UPDATE documents')).toHaveLength(0);
  });
});

describe('a cancelled document stays cancelled', () => {
  it('POST .../result discards the extraction instead of completing it', async () => {
    const { env, calls } = stubEnv({ documentStatus: 'cancelled' });

    const response = await call(resultPost, RESULT_URL, env, { batchId: '7', documentId: '11' }, {
      ocrText: 'Total 41.00',
      fields: [{ normalizedField: 'Total', value: '41.00', confidence: 0.9 }],
    });

    expect(response.status).toBe(200);
    // `cancelled: true` is what stops the client's upload loop spending another
    // upstream call on every remaining document in a batch the user has stopped.
    expect(await response.json()).toEqual({ ok: true, cancelled: true, fieldCount: 0 });
    expect(sqlFor(calls, "SET status = 'completed'")).toHaveLength(0);
    expect(sqlFor(calls, 'INSERT INTO document_fields')).toHaveLength(0);
  });

  it('POST .../failure does not relabel it as failed', async () => {
    const { env, calls } = stubEnv({ documentStatus: 'cancelled' });

    const response = await call(failurePost, FAILURE_URL, env, { batchId: '7', documentId: '11' }, {
      error: 'upstream refused',
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, cancelled: true });
    expect(sqlFor(calls, "SET status = 'failed'")).toHaveLength(0);
  });

  it('cleans up the fields when a cancel lands mid-write', async () => {
    // The document read as 'queued', so the handler proceeded -- and the guarded
    // UPDATE then matched no rows because a cancel arrived in between. Without the
    // cleanup those fields would sit on a cancelled document and show up in the
    // review queue, which filters on document_fields alone.
    const { env, calls } = stubEnv({ documentStatus: 'queued', resultChanges: 0 });

    const response = await call(resultPost, RESULT_URL, env, { batchId: '7', documentId: '11' }, {
      ocrText: 'Total 41.00',
      fields: [{ normalizedField: 'Total', value: '41.00', confidence: 0.9 }],
    });

    expect(await response.json()).toEqual({ ok: true, cancelled: true, fieldCount: 0 });
    expect(sqlFor(calls, 'DELETE FROM document_fields').length).toBeGreaterThan(0);
  });

  it('writes the result normally when the document is still live', async () => {
    const { env, calls } = stubEnv({ documentStatus: 'queued', resultChanges: 1 });

    const response = await call(resultPost, RESULT_URL, env, { batchId: '7', documentId: '11' }, {
      ocrText: 'Total 41.00',
      fields: [{ normalizedField: 'Total', value: '41.00', confidence: 0.9 }],
    });

    expect(await response.json()).toEqual({ ok: true, fieldCount: 1 });
    // The guard is on the statement as well as in the handler, so a cancel that
    // lands after the status read still wins.
    expect(sqlFor(calls, "SET status = 'completed'")[0].sql).toContain(
      "status != 'cancelled'",
    );
  });
});
