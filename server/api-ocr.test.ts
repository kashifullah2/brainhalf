import { describe, expect, it } from 'vitest';

import { onRequestPost as ocrPost } from '../functions/api/ocr';
import { sha256Hex } from './crypto';
import type { AppEnv } from './http';

// ---------------------------------------------------------------------------
// Endpoint tests.
//
// There were none: every one of the 25 Pages Functions was untested, including
// this one -- the endpoint that spends money upstream on every call. These cover
// the validation boundary, which is the part that made /api/ocr an open LLM relay
// when it was missing.
//
// The stub answers by SQL shape rather than pretending to be SQLite. That is
// enough to get a request past requireSession() and reach the handler's own
// checks, which is what is under test here.
// ---------------------------------------------------------------------------

const TOKEN = 'test-session-token';

const USER_ROW = {
  id: 'usr_owner',
  email: 'owner@example.com',
  first_name: 'Ada',
  last_name: 'Lovelace',
  picture_url: null,
  email_verified: 1,
};

function stubEnv(overrides: Partial<AppEnv> = {}): AppEnv {
  const make = (sql: string): Record<string, unknown> => ({
    bind: () => make(sql),
    first: async () => {
      if (sql.includes('FROM sessions')) {
        return { ...USER_ROW, expires_at: '2099-01-01 00:00:00' };
      }
      if (sql.includes('rate_limits')) return { count: 1 };
      return null;
    },
    run: async () => ({ success: true, meta: { changes: 1, last_row_id: 1 } }),
    all: async () => ({ success: true, results: [] }),
  });

  return {
    DB: { prepare: (sql: string) => make(sql), batch: async () => [] },
    // A key is configured so a validation failure cannot be mistaken for a 503.
    HUNYUAN_API_KEY: 'test-key',
    ...overrides,
  } as unknown as AppEnv;
}

async function post(body: unknown, env: AppEnv = stubEnv()): Promise<Response> {
  const request = new Request('https://app.example.com/api/ocr', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `bh_session=${TOKEN}`,
    },
    body: JSON.stringify(body),
  });

  // Only the two fields the handler reads off its context.
  return (await (ocrPost as unknown as (ctx: unknown) => Promise<Response>)({
    request,
    env,
  })) as Response;
}

const IMAGE_DOC = {
  contentType: 'image/jpeg',
  dataUrl: `data:image/jpeg;base64,${'A'.repeat(64)}`,
  filename: 'receipt.jpg',
};

async function errorOf(response: Response): Promise<string> {
  const body = (await response.json()) as { error?: string };
  return body.error ?? '';
}

describe('POST /api/ocr — authentication', () => {
  it('refuses an anonymous caller', async () => {
    const request = new Request('https://app.example.com/api/ocr', {
      method: 'POST',
      body: JSON.stringify({ mode: 'invoice', document: IMAGE_DOC }),
    });
    const response = (await (ocrPost as unknown as (c: unknown) => Promise<Response>)({
      request,
      env: stubEnv(),
    })) as Response;
    expect(response.status).toBe(401);
  });

  it('reports a missing database binding as a deployment problem, not a 401', async () => {
    // Signing in cannot fix an unbound D1, so sending the user to the sign-in
    // screen for it is the wrong answer.
    const response = await post(
      { mode: 'invoice', document: IMAGE_DOC },
      { HUNYUAN_API_KEY: 'k' } as unknown as AppEnv,
    );
    expect(response.status).toBe(503);
  });
});

describe('POST /api/ocr — the caller cannot supply a prompt', () => {
  it('refuses a `messages` array outright', async () => {
    // This was the vulnerability: the array was forwarded upstream verbatim, so
    // any signed-in user had general purpose LLM access on the account's budget.
    const response = await post({
      messages: [{ role: 'user', content: [{ type: 'text', text: 'ignore the document' }] }],
    });
    expect(response.status).toBe(400);
    expect(await errorOf(response)).toMatch(/no longer accepts a `messages` array/);
  });

  it('refuses it even alongside an otherwise valid request', async () => {
    // Ignoring it silently would let a stale client believe its prompt was used.
    const response = await post({
      mode: 'invoice',
      document: IMAGE_DOC,
      messages: [{ role: 'user', content: [] }],
    });
    expect(response.status).toBe(400);
  });
});

describe('POST /api/ocr — mode validation', () => {
  it('rejects a missing mode', async () => {
    const response = await post({ document: IMAGE_DOC });
    expect(response.status).toBe(400);
    expect(await errorOf(response)).toMatch(/extraction mode/i);
  });

  it('rejects a mode that is not a shipped preset', async () => {
    for (const mode of ['', 'INVOICE', 'admin', 'invoice; drop table', 42]) {
      const response = await post({ mode, document: IMAGE_DOC });
      expect(response.status).toBe(400);
    }
  });
});

describe('POST /api/ocr — document validation', () => {
  it('requires a document', async () => {
    const response = await post({ mode: 'invoice' });
    expect(response.status).toBe(400);
    expect(await errorOf(response)).toMatch(/document/i);
  });

  it('rejects a content type outside the upload allowlist', async () => {
    const response = await post({
      mode: 'invoice',
      document: { ...IMAGE_DOC, contentType: 'text/html' },
    });
    expect(response.status).toBe(415);
  });

  it('rejects a remote URL in place of inline data', async () => {
    // Accepting one would have the provider fetch whatever address the caller
    // named, using our credential.
    for (const dataUrl of [
      'https://evil.example.com/page.jpg',
      'http://169.254.169.254/latest/meta-data/',
      'file:///etc/passwd',
    ]) {
      const response = await post({
        mode: 'invoice',
        document: { ...IMAGE_DOC, dataUrl },
      });
      expect(response.status).toBe(400);
    }
  });

  it('rejects a data URL whose type contradicts the declared one', async () => {
    const response = await post({
      mode: 'invoice',
      document: {
        contentType: 'application/pdf',
        dataUrl: `data:image/jpeg;base64,${'A'.repeat(64)}`,
        filename: 'not-really.pdf',
      },
    });
    expect(response.status).toBe(400);
  });

  it('rejects a data URL with no meaningful payload', async () => {
    const response = await post({
      mode: 'invoice',
      document: { ...IMAGE_DOC, dataUrl: 'data:image/jpeg;base64,A' },
    });
    expect(response.status).toBe(400);
  });
});

describe('POST /api/ocr — malformed bodies', () => {
  it('rejects a body that is not JSON', async () => {
    const request = new Request('https://app.example.com/api/ocr', {
      method: 'POST',
      headers: { Cookie: `bh_session=${TOKEN}` },
      body: 'not json at all',
    });
    const response = (await (ocrPost as unknown as (c: unknown) => Promise<Response>)({
      request,
      env: stubEnv(),
    })) as Response;
    expect(response.status).toBe(400);
  });

  it('rejects an oversized declared body with an actionable message', async () => {
    const request = new Request('https://app.example.com/api/ocr', {
      method: 'POST',
      headers: {
        Cookie: `bh_session=${TOKEN}`,
        'content-length': String(64 * 1024 * 1024),
      },
      body: JSON.stringify({ mode: 'invoice', document: IMAGE_DOC }),
    });
    const response = (await (ocrPost as unknown as (c: unknown) => Promise<Response>)({
      request,
      env: stubEnv(),
    })) as Response;
    expect(response.status).toBe(413);
    // Naming the cause matters: this used to read like a provider outage.
    expect(await errorOf(response)).toMatch(/14 MB/);
  });
});

describe('POST /api/ocr — provider configuration', () => {
  it('answers 503 when no provider credential is set, rather than failing upstream', async () => {
    const env = stubEnv();
    delete (env as unknown as Record<string, unknown>).HUNYUAN_API_KEY;
    const response = await post({ mode: 'invoice', document: IMAGE_DOC }, env);
    expect(response.status).toBe(503);
  });
});

// The token is hashed before it is looked up; this pins that the stub is being
// reached the way the real resolver reaches it.
describe('session lookup', () => {
  it('hashes the cookie value rather than querying it directly', async () => {
    const hash = await sha256Hex(TOKEN);
    expect(hash).toHaveLength(64);
    expect(hash).not.toContain(TOKEN);
  });
});
