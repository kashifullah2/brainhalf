import { describe, expect, it } from 'vitest';
import { onRequestGet as reviewQueueGet } from '../functions/api/review-queue';
import type { AppEnv } from './http';

const USER_ROW = {
  id: 'usr_owner',
  email: 'owner@example.com',
  first_name: 'Ada',
  last_name: 'Lovelace',
  picture_url: null,
  email_verified: 1,
};

/** The shape of the endpoint's reply, as far as these tests read it. */
interface ReviewQueueBody {
  threshold: number;
  items: Array<{
    batchId: number;
    document: { id: number; filename: string };
    flaggedFields: Array<{ normalizedField: string; confidence: number }>;
    totalFlaggedCount: number;
    reviewedCount: number;
  }>;
  page?: { limit: number; offset: number; hasMore: boolean };
  awaiting?: number;
  flaggedDocuments?: number;
  flaggedFields?: number;
  pendingFields?: number;
}

function stubEnv(
  dbResults: Record<string, Array<Record<string, unknown>>> = {},
): { env: AppEnv; calls: { sql: string; args: unknown[] }[] } {
  const calls: { sql: string; args: unknown[] }[] = [];

  const make = (sql: string, args: unknown[]): Record<string, unknown> => ({
    bind: (...next: unknown[]) => make(sql, next),
    first: async () => {
      calls.push({ sql, args });
      if (sql.includes('FROM sessions')) return { ...USER_ROW, expires_at: '2099-01-01 00:00:00' };
      
      // Settings query
      if (sql.includes('SELECT confidence_threshold')) {
        return { confidence_threshold: 0.8 };
      }
      
      // Totals query
      if (sql.includes('SELECT COUNT(*)')) {
        return dbResults.totals ? dbResults.totals[0] : {
          flagged_fields: 5,
          pending_fields: 2,
          flagged_documents: 3,
          awaiting_documents: 2, // The badge count!
        };
      }
      
      return null;
    },
    run: async () => {
      calls.push({ sql, args });
      return { success: true, meta: { changes: 1, last_row_id: 1 } };
    },
    all: async () => {
      calls.push({ sql, args });
      
      // Paging EXISTS query
      if (sql.includes('SELECT d.id AS document_id')) {
        return { success: true, results: dbResults.pageRows || [] };
      }
      
      // Full rows query
      if (sql.includes('SELECT d.batch_id          AS batch_id,')) {
        return { success: true, results: dbResults.fullRows || [] };
      }
      
      return { success: true, results: [] };
    },
  });

  const env = {
    DB: {
      prepare: (sql: string) => make(sql, []),
    },
  } as unknown as AppEnv;

  return { env, calls };
}

async function call(
  url: string,
  env: AppEnv,
): Promise<Response> {
  const request = new Request(url, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      Cookie: 'bh_session=test-session-token',
    },
  });
  // The handler only reads `request` and `env`; the rest of a Pages context is
  // not needed and is not worth constructing.
  return await reviewQueueGet({ request, env } as unknown as Parameters<typeof reviewQueueGet>[0]);
}

describe('GET /api/review-queue', () => {
  it('uses the correct query predicates for the default unreviewed queue', async () => {
    const { env, calls } = stubEnv({
      pageRows: [{ document_id: 10 }, { document_id: 20 }],
      fullRows: [
        {
          batch_id: 1,
          document_id: 10,
          filename: 'unreviewed.pdf',
          status: 'completed',
          overall_confidence: 0.5,
          normalized_field: 'Total',
          original_label: 'Total',
          value: '100',
          edited_value: null,
          confidence: 0.5,
          review_status: null, // Unreviewed!
        },
        {
          batch_id: 1,
          document_id: 20,
          filename: 'mixed.pdf',
          status: 'completed',
          overall_confidence: 0.5,
          normalized_field: 'Tax',
          original_label: 'Tax',
          value: '10',
          edited_value: null,
          confidence: 0.5,
          review_status: null, // Still has one unreviewed field
        }
      ]
    });

    const response = await call('https://app.example.com/api/review-queue', env);
    expect(response.status).toBe(200);
    const body = (await response.json()) as ReviewQueueBody;

    expect(body.items).toHaveLength(2);

    const pagingQuery = calls.find(c => c.sql.includes('SELECT d.id AS document_id'));
    expect(pagingQuery).toBeDefined();
    // Verify it includes the IS NULL check to align with the badge count
    expect(pagingQuery?.sql).toContain('AND f.review_status IS NULL');
  });

  it('uses the correct query predicates for the verified queue', async () => {
    const { env, calls } = stubEnv({
      pageRows: [{ document_id: 30 }],
      fullRows: [
        {
          batch_id: 2,
          document_id: 30,
          filename: 'verified.pdf',
          status: 'completed',
          overall_confidence: 0.5,
          normalized_field: 'Total',
          original_label: 'Total',
          value: '100',
          edited_value: '200',
          confidence: 0.5,
          review_status: 'corrected', // Verified!
        }
      ]
    });

    const response = await call('https://app.example.com/api/review-queue?verified=1', env);
    expect(response.status).toBe(200);
    
    const body = (await response.json()) as ReviewQueueBody;
    expect(body.items).toHaveLength(1);

    const pagingQuery = calls.find(c => c.sql.includes('SELECT d.id AS document_id'));
    expect(pagingQuery).toBeDefined();
    // Verify it includes the NOT EXISTS IS NULL check to ensure it's fully verified
    expect(pagingQuery?.sql).toContain('AND NOT EXISTS (');
    expect(pagingQuery?.sql).toContain('AND f.review_status IS NULL');
  });
});
