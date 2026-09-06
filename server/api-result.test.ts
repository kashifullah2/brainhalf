import { describe, expect, it } from 'vitest';
import { onRequestPost as resultPost } from '../functions/api/batches/[batchId]/documents/[documentId]/result';
import type { AppEnv } from './http';

// ---------------------------------------------------------------------------
// H-27 Coverage: Test the DB insertion logic for the result endpoint.
// ---------------------------------------------------------------------------

const USER_ROW = {
  id: 'usr_owner',
  email: 'owner@example.com',
  first_name: 'Ada',
  last_name: 'Lovelace',
  picture_url: null,
  email_verified: 1,
};

interface Recorded {
  sql: string;
  args: unknown[];
}

function stubEnv(): { env: AppEnv; calls: Recorded[] } {
  const calls: Recorded[] = [];

  const make = (sql: string, args: unknown[]): Record<string, unknown> => ({
    _sql: sql,
    _args: args,
    bind: (...next: unknown[]) => make(sql, next),
    first: async () => {
      calls.push({ sql, args });
      if (sql.includes('FROM sessions')) {
        return { ...USER_ROW, expires_at: '2099-01-01 00:00:00' };
      }
      if (sql.includes('SELECT d.id, d.batch_id, d.object_path')) {
        return { id: 20, batch_id: 10, object_path: 'usr_owner/doc.pdf' };
      }
      return null;
    },
    run: async () => {
      calls.push({ sql, args });
      return { success: true, meta: { changes: 1, last_row_id: 41 } };
    },
    all: async () => {
      calls.push({ sql, args });
      return { success: true, results: [] };
    },
  });

  const env = {
    DB: {
      prepare: (sql: string) => make(sql, []),
      batch: async (statements: Array<{ _sql: string; _args: unknown[] }>) => {
        for (const stmt of statements) {
          calls.push({ sql: stmt._sql, args: stmt._args });
        }
        return statements.map(() => ({ success: true, meta: { changes: 1, last_row_id: 41 } }));
      },
    },
  } as unknown as AppEnv;

  return { env, calls };
}

function call(env: AppEnv, body: unknown) {
  const request = new Request('https://app.example.com/api/batches/10/documents/20/result', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: 'bh_session=test-session-token' },
    body: JSON.stringify(body),
  });
  // Simulate the Cloudflare Pages context
  return resultPost({
    request,
    env,
    params: { batchId: '10', documentId: '20' },
    // Only these three are read; constructing the rest of a Pages context adds
    // nothing the assertions depend on.
  } as unknown as Parameters<typeof resultPost>[0]);
}

describe('POST /api/batches/:batchId/documents/:documentId/result', () => {
  it('deduplicates fields and issues a DELETE before INSERT to prevent accumulation', async () => {
    const { env, calls } = stubEnv();
    const response = await call(env, {
      ocrText: 'Extracted text',
      overallConfidence: 0.95,
      fields: [
        { normalizedField: 'Total', originalLabel: 'Total', value: '100', confidence: 0.9 },
        // This is a duplicate and should be dropped by the sanitizer
        { normalizedField: 'Total', originalLabel: 'Total', value: '200', confidence: 0.5 },
        { normalizedField: 'Date', originalLabel: 'Date', value: '2024-01-01', confidence: 0.8 },
      ],
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; fieldCount: number; cancelled?: boolean };
    expect(body.ok).toBe(true);
    expect(body.fieldCount).toBe(2);

    // Verify database operations
    const deletes = calls.filter((c) => c.sql.includes('DELETE FROM document_fields'));
    expect(deletes.length).toBe(1);
    expect(deletes[0].args).toEqual([20]);

    const inserts = calls.filter((c) => c.sql.includes('INSERT INTO document_fields'));
    expect(inserts.length).toBe(2);

    // Assert the first inserted field is the first occurrence of "Total"
    expect(inserts[0].args[3]).toBe('Total');
    expect(inserts[0].args[5]).toBe('100');
    // Assert the second inserted field is "Date"
    expect(inserts[1].args[3]).toBe('Date');
    expect(inserts[1].args[5]).toBe('2024-01-01');

    // Assert atomicity / ordering: DELETE happens before INSERT
    const deleteIdx = calls.findIndex((c) => c.sql === deletes[0].sql);
    const firstInsertIdx = calls.findIndex((c) => c.sql === inserts[0].sql);
    expect(deleteIdx).toBeLessThan(firstInsertIdx);
  });
});
