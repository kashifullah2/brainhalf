/**
 * End-to-end gating tests for the real ChatAgent.onRequest:
 * capability tokens, generated-API rate limiting, sandboxed backends,
 * image serving, and bounded WebSocket history — all against a real
 * in-memory SQLite (node:sqlite) standing in for the DO's sql tag.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';

vi.mock('agents', () => ({
  Agent: class MockAgent {
    async onRequest(_request: Request) {
      // Stand-in for the real agent framework's WebSocket upgrade handshake.
      // Undici's Response rejects informational statuses, so the sentinel is
      // a 200 with a recognizable body instead of a real 101.
      return new Response('mock-agent-ws-passthrough', { status: 200 });
    }
  },
}));

import { ChatAgent } from '../agent';

/** Real sqlite behind the same call shapes ChatAgent uses. */
function createSqlStub() {
  const db = new DatabaseSync(':memory:');
  const execText = (text: string, values: any[] = []) => {
    const stmt = db.prepare(text);
    if (/^\s*(select|with|pragma|explain)\b/i.test(text)) {
      const rows = stmt.all(...values) as Record<string, unknown>[];
      return {
        [Symbol.iterator]: function* () { yield* rows; },
        toArray: () => rows,
      };
    }
    const info = stmt.run(...values) as { changes: unknown };
    return {
      [Symbol.iterator]: function* () {},
      toArray: () => [],
      rowsWritten: Number(info.changes ?? 0),
    };
  };
  const tag = (strings: TemplateStringsArray, ...values: any[]) => {
    const text = strings.reduce((acc, s, i) => acc + s + (i < values.length ? '?' : ''), '');
    return execText(text, values);
  };
  (tag as any).exec = execText;
  return tag as any;
}

/** Build a ChatAgent with its constructor bypassed (DurableObject ctor needs env). */
function makeAgent(projectId: string) {
  const agent = Object.create(ChatAgent.prototype);
  agent.sql = createSqlStub();
  agent.name = projectId;
  agent.env = {};
  agent.runSql = agent.sqlTag; // private getter on the prototype
  agent.appliedSchemaHashes = new Map<string, string>();
  return agent as any;
}

const OWNER_HDR = 'x-brainhalf-token';

const ROUTES_FIXTURE = `
export const schema = \`CREATE TABLE IF NOT EXISTS todos (
  id INTEGER PRIMARY KEY,
  title TEXT
);\`;

export const routes = {
  'GET /api/todos': async ({ db }) => Response.json(db.query('SELECT * FROM todos')),
  'GET /api/probe-sandbox': async () => Response.json({
    fetchType: typeof fetch,
    wsType: typeof WebSocket,
    timerType: typeof setInterval,
  }),
  'GET /api/probe-guard': async ({ db }) => Response.json(db.query('SELECT * FROM messages')),
};
`;

const api = (projectId: string, path: string, init?: RequestInit) =>
  new Request(`https://edge.test/preview/${projectId}${path}`, init);

/** Fresh agent + synced backend; returns { agent, tokens }. */
async function bootstrap(projectId = 'p1') {
  const agent = makeAgent(projectId);
  const res = await agent.onRequest(api(projectId, '/api/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ files: { '/server/routes.js': ROUTES_FIXTURE } }),
  }));
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.tokens?.ownerToken).toBeTruthy();
  expect(body.tokens?.previewToken).toBeTruthy();
  return { agent, tokens: body.tokens };
}

describe('preview endpoint gating (Fix 1)', () => {
  let agent: any;
  let tokens: any;
  beforeEach(async () => {
    ({ agent, tokens } = await bootstrap());
  });

  it('mints capability tokens on first sync (bootstrap)', () => {
    expect(tokens.ownerToken).not.toBe(tokens.previewToken);
  });

  it('rejects sync without a token once claimed', async () => {
    const res = await agent.onRequest(api('p1', '/api/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files: { '/a.txt': 'x' } }),
    }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('forbidden');
  });

  it('accepts sync with the owner token', async () => {
    const res = await agent.onRequest(api('p1', '/api/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', [OWNER_HDR]: tokens.ownerToken },
      body: JSON.stringify({ files: { '/a.txt': 'x' } }),
    }));
    expect(res.status).toBe(200);
    // already-claimed sync does not re-mint
    expect((await res.json()).tokens).toBeUndefined();
  });

  it('gates /api/files on the owner token', async () => {
    expect((await agent.onRequest(api('p1', '/api/files'))).status).toBe(403);
    const res = await agent.onRequest(api('p1', '/api/files', { headers: { [OWNER_HDR]: tokens.ownerToken } }));
    expect(res.status).toBe(200);
    const body = await res.json();
    // /api/files returns a { path: content } map
    expect(Object.keys(body)).toContain('/server/routes.js');
  });

  it('injects the preview token into served HTML', async () => {
    const res = await agent.onRequest(api('p1', '/index.html', { headers: { [OWNER_HDR]: tokens.ownerToken } }));
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('__bhApiToken');
    expect(html).toContain(tokens.previewToken);
  });

  it('gates generated backend APIs on the preview token', async () => {
    expect((await agent.onRequest(api('p1', '/api/todos'))).status).toBe(403);
    expect((await agent.onRequest(api('p1', '/api/todos', { headers: { [OWNER_HDR]: tokens.ownerToken } }))).status).toBe(403);
    const res = await agent.onRequest(api('p1', `/api/todos?token=${tokens.previewToken}`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it('rejects wrong tokens', async () => {
    const res = await agent.onRequest(api('p1', `/api/todos?token=nope`));
    expect(res.status).toBe(403);
  });

  it('serves OPTIONS preflight without auth', async () => {
    const res = await agent.onRequest(api('p1', '/api/todos', { method: 'OPTIONS' }));
    expect(res.status).toBe(200);
  });

  it('returns a standard error shape for malformed sync JSON', async () => {
    const res = await agent.onRequest(api('p1', '/api/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', [OWNER_HDR]: tokens.ownerToken },
      body: 'not-json{',
    }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid-json');
    expect(typeof body.message).toBe('string');
  });

  it('rejects oversized files in sync', async () => {
    const res = await agent.onRequest(api('p1', '/api/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', [OWNER_HDR]: tokens.ownerToken },
      body: JSON.stringify({ files: { '/big.bin': 'x'.repeat(6 * 1024 * 1024) } }),
    }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('file-too-large');
  });
});

describe('generated backend hardening (Fix 2)', () => {
  let agent: any;
  let tokens: any;
  beforeEach(async () => {
    ({ agent, tokens } = await bootstrap('p2'));
  });

  it('denies generated SQL access to system tables', async () => {
    const res = await agent.onRequest(api('p2', `/api/probe-guard?token=${tokens.previewToken}`));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('api-error');
  });

  it('runs generated handlers with network globals shadowed', async () => {
    const res = await agent.onRequest(api('p2', `/api/probe-sandbox?token=${tokens.previewToken}`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ fetchType: 'undefined', wsType: 'undefined', timerType: 'undefined' });
  });

  it('rate-limits generated APIs per client IP', async () => {
    let lastStatus = 0;
    for (let i = 0; i < 241; i++) {
      const res = await agent.onRequest(api('p2', `/api/todos?token=${tokens.previewToken}`));
      lastStatus = res.status;
      await res.text(); // drain
    }
    expect(lastStatus).toBe(429);
  }, 60_000);

  it('rejects destructive statements in generated schemas', async () => {
    const { agent, tokens } = await bootstrap('p5');
    const evil = "export const schema = `DROP TABLE project_files;`;\nexport const routes = { 'GET /api/x': async () => Response.json({ ok: true }) };";
    const syncRes = await agent.onRequest(api('p5', '/api/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', [OWNER_HDR]: tokens.ownerToken },
      body: JSON.stringify({ files: { '/server/routes.js': evil } }),
    }));
    expect(syncRes.status).toBe(200);
    // Trigger schema application via a generated API call.
    const apiRes = await agent.onRequest(api('p5', `/api/x?token=${tokens.previewToken}`));
    expect(apiRes.status).toBe(200);
    // The IDE's own tables must survive the hostile schema.
    const files = await agent.onRequest(api('p5', '/api/files', { headers: { [OWNER_HDR]: tokens.ownerToken } }));
    expect(files.status).toBe(200);
    expect(Object.keys(await files.json()).length).toBeGreaterThan(0);
  });
});

describe('generated image assets (Fix 6)', () => {
  it('saves Flux output and serves it as a real PNG', async () => {
    const { agent, tokens } = await bootstrap('p3');
    // 1x1 transparent PNG
    const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const savedPath = agent.saveGeneratedImage({ image: b64 });
    expect(savedPath).toMatch(/^\/src\/assets\/ai-.*\.png$/);

    const res = await agent.onRequest(api('p3', savedPath, { headers: { [OWNER_HDR]: tokens.ownerToken } }));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([bytes[0], bytes[1], bytes[2], bytes[3]]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it('returns null for empty/unrecognized generator output', async () => {
    const { agent } = await bootstrap('p4');
    expect(agent.saveGeneratedImage({})).toBeNull();
    expect(agent.saveGeneratedImage({ image: '' })).toBeNull();
  });
});

describe('WebSocket gating + history bounds (Fixes 1 & 5)', () => {
  const wsReq = (projectId: string, token?: string) =>
    new Request(`https://edge.test/agents/chat-agent/${projectId}${token ? `?token=${encodeURIComponent(token)}` : ''}`, {
      headers: { upgrade: 'websocket' },
    });

  it('allows first contact (bootstrap) but gates claimed projects', async () => {
    const agent = makeAgent('ws1');
    const passthrough = async (req: Request) => {
      const res = await agent.onRequest(req);
      return { status: res.status, body: await res.text() };
    };
    // first contact: no tokens yet -> passes through to the agent framework.
    // The upgrade handshake completes in onConnect, which mints the tokens
    // (first-writer-wins), mirroring the real Cloudflare flow.
    expect(await passthrough(wsReq('ws1'))).toEqual({ status: 200, body: 'mock-agent-ws-passthrough' });
    await agent.onConnect({ id: 'c1', send: vi.fn() } as any);
    // claimed now: anonymous and wrong-token connections are refused
    expect((await agent.onRequest(wsReq('ws1'))).status).toBe(401);
    expect((await agent.onRequest(wsReq('ws1', 'wrong'))).status).toBe(401);
    // owner token passes through
    const { agent: a2 } = await bootstrap('ws2');
    const denied = (await a2.onRequest(api('ws2', '/api/files'))).status; // 403, proves claimed
    expect(denied).toBe(403);
    const rows = [...a2.runSql`SELECT key, value FROM project_meta`] as { key: string; value: string }[];
    const ownerToken = rows.find((r) => r.key === 'owner_token')!.value;
    // NOTE: the request must go to a2 (ws2's agent), not the ws1 agent above.
    const okRes = await a2.onRequest(wsReq('ws2', ownerToken));
    expect(okRes.status).toBe(200);
    expect(await okRes.text()).toBe('mock-agent-ws-passthrough');
  });

  it('sends project_tokens and bounded history on connect', async () => {
    const { agent, tokens } = await bootstrap('ws3');
    // seed 1200 conversation rows directly (the messages table is per-project:
    // each Durable Object instance serves exactly one project)
    for (let i = 0; i < 1200; i++) {
      agent.sql`INSERT INTO messages (role, content) VALUES ('user', ${'m' + i})`;
    }
    const conn = { id: 'c1', send: vi.fn() };
    await agent.onConnect(conn as any);
    const sent = conn.send.mock.calls.map((c: any[]) => JSON.parse(c[0]));
    const tokenMsg = sent.find((m: any) => m.type === 'project_tokens');
    expect(tokenMsg.ownerToken).toBe(tokens.ownerToken);
    expect(tokenMsg.previewToken).toBe(tokens.previewToken);
    const history = sent.find((m: any) => m.type === 'history');
    expect(history.data).toHaveLength(500);
    expect(history.data[0].content).toBe('m700');
    expect(history.data[499].content).toBe('m1199');
  });
});
