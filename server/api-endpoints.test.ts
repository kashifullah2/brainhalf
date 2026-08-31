import { describe, expect, it } from 'vitest';

import {
  onRequestGet as settingsGet,
  onRequestPatch as settingsPatch,
} from '../functions/api/settings';
import { onRequestPost as batchesPost } from '../functions/api/batches/index';
import { MAX_DOCUMENTS_PER_BATCH } from './batches';
import type { AppEnv } from './http';

// ---------------------------------------------------------------------------
// More endpoint coverage. Same approach as server/api-ocr.test.ts: a stub that
// answers by SQL shape, which is enough to get past requireSession() and reach
// the validation each handler actually owns.
//
// The stub RECORDS bind arguments, because that is where the interesting
// assertions live -- whether a prompt was truncated before it was stored, and
// whether the owner's id is the one written to the row.
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
    bind: (...next: unknown[]) => make(sql, next),
    first: async () => {
      calls.push({ sql, args });
      if (sql.includes('FROM sessions')) {
        return { ...USER_ROW, expires_at: '2099-01-01 00:00:00' };
      }
      if (sql.includes('rate_limits')) return { count: 1 };
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
      batch: async (statements: Array<{ bind?: unknown }>) =>
        statements.map(() => ({ success: true, meta: { changes: 1, last_row_id: 41 } })),
    },
    DOCUMENTS: { put: async () => undefined, delete: async () => undefined },
  } as unknown as AppEnv;

  return { env, calls };
}

type Handler = (ctx: unknown) => Promise<Response>;

function call(
  handler: unknown,
  method: string,
  url: string,
  env: AppEnv,
  body?: unknown,
): Promise<Response> {
  const request = new Request(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Cookie: 'bh_session=test-session-token',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return (handler as Handler)({ request, env }) as Promise<Response>;
}

const SETTINGS_URL = 'https://app.example.com/api/settings';
const BATCHES_URL = 'https://app.example.com/api/batches';

function oneDocument() {
  return [
    {
      filename: 'invoice.pdf',
      contentType: 'application/pdf',
      objectPath: 'usr_owner/abc-invoice.pdf',
      sizeBytes: 1024,
      contentHash: 'a'.repeat(64),
    },
  ];
}

describe('PATCH /api/settings — confidence threshold bounds', () => {
  it('rejects values outside the allowed range', async () => {
    const { env } = stubEnv();
    for (const value of [0, 0.1, 0.49, 0.96, 1, 2]) {
      const response = await call(settingsPatch, 'PATCH', SETTINGS_URL, env, {
        confidenceThreshold: value,
      });
      expect(response.status).toBe(400);
    }
  });

  it('rejects anything that is not a finite number', async () => {
    const { env } = stubEnv();
    for (const value of ['0.8', null, undefined, NaN, Infinity, {}, []]) {
      const response = await call(settingsPatch, 'PATCH', SETTINGS_URL, env, {
        confidenceThreshold: value,
      });
      expect(response.status).toBe(400);
    }
  });

  it('accepts a value inside the range and stores it against the caller', async () => {
    const { env, calls } = stubEnv();
    const response = await call(settingsPatch, 'PATCH', SETTINGS_URL, env, {
      confidenceThreshold: 0.9,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ confidenceThreshold: 0.9 });

    const write = calls.find((c) => c.sql.includes('INSERT INTO user_settings'));
    // The owner is the session's user, never a value from the request body.
    expect(write?.args).toEqual(['usr_owner', 0.9]);
  });

  it('falls back to the documented default when no row exists', async () => {
    const { env } = stubEnv();
    const response = await call(settingsGet, 'GET', SETTINGS_URL, env);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ confidenceThreshold: 0.8 });
  });
});

describe('POST /api/batches — mode validation', () => {
  it('rejects a mode outside the allowlist', async () => {
    const { env } = stubEnv();
    const response = await call(batchesPost, 'POST', BATCHES_URL, env, {
      mode: 'definitely-not-a-mode',
      documents: oneDocument(),
    });
    expect(response.status).toBe(400);
  });

  it('accepts every preset the upload UI offers', async () => {
    const { env } = stubEnv();
    for (const mode of [
      'invoice',
      'receipt',
      'fulltext',
      'keyvalue',
      'table',
      'handwriting',
      'multilingual',
      'custom',
      'vqa',
    ]) {
      const response = await call(batchesPost, 'POST', BATCHES_URL, env, {
        mode,
        documents: oneDocument(),
      });
      expect(response.status, `mode ${mode}`).toBe(201);
    }
  });
});

describe('POST /api/batches — document count', () => {
  it('requires at least one document', async () => {
    const { env } = stubEnv();
    for (const documents of [[], undefined, 'nope', {}]) {
      const response = await call(batchesPost, 'POST', BATCHES_URL, env, {
        mode: 'invoice',
        documents,
      });
      expect(response.status).toBe(400);
    }
  });

  it('enforces the per-batch cap', async () => {
    const { env } = stubEnv();
    const documents = Array.from({ length: MAX_DOCUMENTS_PER_BATCH + 1 }, () => oneDocument()[0]);
    const response = await call(batchesPost, 'POST', BATCHES_URL, env, {
      mode: 'invoice',
      documents,
    });
    expect(response.status).toBe(400);
  });
});

describe('POST /api/batches — custom prompt', () => {
  it('persists the prompt on the batch', async () => {
    // It was never sent by the client, so batches.prompt was always NULL and
    // appending to a custom batch silently used a different prompt.
    const { env, calls } = stubEnv();
    await call(batchesPost, 'POST', BATCHES_URL, env, {
      mode: 'custom',
      customPrompt: 'Extract the roll number and marks',
      documents: oneDocument(),
    });

    const insert = calls.find((c) => c.sql.includes('INSERT INTO batches'));
    expect(insert?.args).toEqual([
      'usr_owner',
      'custom',
      'Extract the roll number and marks',
    ]);
  });

  it('truncates a prompt rather than storing it unbounded', async () => {
    const { env, calls } = stubEnv();
    await call(batchesPost, 'POST', BATCHES_URL, env, {
      mode: 'custom',
      customPrompt: 'x'.repeat(10_000),
      documents: oneDocument(),
    });

    const insert = calls.find((c) => c.sql.includes('INSERT INTO batches'));
    expect((insert?.args[2] as string).length).toBe(4000);
  });

  it('stores NULL when no prompt was given', async () => {
    const { env, calls } = stubEnv();
    await call(batchesPost, 'POST', BATCHES_URL, env, {
      mode: 'invoice',
      documents: oneDocument(),
    });

    const insert = calls.find((c) => c.sql.includes('INSERT INTO batches'));
    expect(insert?.args[2]).toBeNull();
  });
});
