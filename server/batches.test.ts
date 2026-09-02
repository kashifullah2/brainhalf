import { describe, expect, it } from 'vitest';
import { invalidObjectPath, refreshBatchStatus } from './batches';

describe('invalidObjectPath', () => {
  it('returns null if all object paths match the user prefix', () => {
    const docs = [
      { filename: 'a', contentType: 'pdf', objectPath: 'user123/a.pdf', sizeBytes: 10, contentHash: 'a' },
      { filename: 'b', contentType: 'pdf', objectPath: 'user123/b.pdf', sizeBytes: 10, contentHash: 'b' },
    ];
    expect(invalidObjectPath(docs, 'user123')).toBeNull();
  });

  it('returns the offending path if it does not match the user prefix', () => {
    const docs = [
      { filename: 'a', contentType: 'pdf', objectPath: 'user123/a.pdf', sizeBytes: 10, contentHash: 'a' },
      { filename: 'b', contentType: 'pdf', objectPath: 'otheruser/b.pdf', sizeBytes: 10, contentHash: 'b' },
    ];
    expect(invalidObjectPath(docs, 'user123')).toBe('otheruser/b.pdf');
  });

  it('rejects paths containing directory traversal (..)', () => {
    const docs = [
      { filename: 'a', contentType: 'pdf', objectPath: 'user123/../otheruser/b.pdf', sizeBytes: 10, contentHash: 'a' },
    ];
    expect(invalidObjectPath(docs, 'user123')).toBe('user123/../otheruser/b.pdf');
  });

  it('ignores null objectPaths', () => {
    const docs = [
      { filename: 'a', contentType: 'pdf', objectPath: null, sizeBytes: 10, contentHash: 'a' },
    ];
    expect(invalidObjectPath(docs, 'user123')).toBeNull();
  });
});

describe('refreshBatchStatus', () => {
  it('runs the UPDATE query to recalculate batch status from documents', async () => {
    const calls: { sql: string; args: unknown[] }[] = [];
    const env: any = {
      DB: {
        prepare: (sql: string) => ({
          bind: (...args: unknown[]) => ({
            run: async () => {
              calls.push({ sql, args });
            }
          })
        })
      }
    };

    await refreshBatchStatus(env, 42);

    expect(calls.length).toBe(1);
    expect(calls[0].sql).toContain('UPDATE batches');
    // Ensure the zero-document case is handled first as specified in H-28
    expect(calls[0].sql).toContain("WHEN COUNT(*) = 0 THEN 'queued'");
    expect(calls[0].args).toEqual([42, 42]);
  });
});

describe('getBatchSummary', () => {
  it('calls SUMMARY_SELECT and returns mapped DTO', async () => {
    const { getBatchSummary } = await import('./batches');
    const calls: { sql: string; args: unknown[] }[] = [];
    const env: any = {
      DB: {
        prepare: (sql: string) => ({
          bind: (...args: unknown[]) => ({
            first: async () => {
              calls.push({ sql, args });
              return {
                id: 42,
                status: 'completed',
                created_at: '2023-01-01',
                updated_at: '2023-01-01',
                total_documents: 2,
                completed_documents: 2,
                failed_documents: 0,
                engine_type: 'invoice'
              };
            }
          })
        })
      }
    };

    const summary = await getBatchSummary(env, 'user123', 42);
    expect(calls.length).toBe(1);
    expect(calls[0].sql).toContain('SELECT');
    expect(calls[0].args).toEqual([42, 'user123']);
    expect(summary?.id).toBe(42);
    expect(summary?.totalDocuments).toBe(2);
  });
});
