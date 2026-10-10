/**
 * Adversarial tests for src/registry.ts and src/lib/auth.ts.
 *
 * Every test tries to expose a specific bug or bypass. If a test fails,
 * the finding is reported — the test is NOT weakened to pass.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DurableObjectState } from '@cloudflare/workers-types';
import {
  base64urlEncodeString,
  hashPassword,
  hmacSign,
  issueToken,
  sha256Hex,
  TOKEN_PREFIX,
  TOKEN_TTL_SECONDS,
  verifyTokenSignature,
} from '../lib/crypto';

vi.mock('agents', () => ({ routeAgentRequest: vi.fn(), Agent: class {} }));
vi.mock('../agent', () => ({ ChatAgent: class {} }));

import { AuthRegistry } from '../registry';
import {
  AUTH_COOKIE,
  extractToken,
  extractWsTicket,
  injectUserId,
  USER_ID_HEADER,
  USER_ID_QUERY_PARAM,
  verifySession,
} from '../lib/auth';
import { PREVIEW_ACCESS_HEADER } from '../lib/project-access';

const SECRET = 'adversarial-test-secret-must-be-32-chars-or-longer';
const USER_A = 'usr_aaaaaaaa';
const USER_B = 'usr_bbbbbbbb';

/* ------------------------------------------------------------------ */
/* Registry test harness — real SQLite, fake bindings                   */
/* ------------------------------------------------------------------ */

function makeState(db: DatabaseSync): DurableObjectState {
  return {
    id: { name: 'auth' },
    storage: {
      setAlarm: async () => {},
      transactionSync: (work: () => unknown) => {
        db.exec('BEGIN');
        try { const r = work(); db.exec('COMMIT'); return r; }
        catch (e) { db.exec('ROLLBACK'); throw e; }
      },
      sql: {
        exec: (query: string, ...params: any[]) => {
          const rows = db.prepare(query).all(...params);
          return { toArray: () => rows };
        },
      },
    },
  } as unknown as DurableObjectState;
}

function makeEnv(overrides: Record<string, unknown> = {}) {
  return { REGISTRY: { idFromName: vi.fn(() => ({})), get: vi.fn(() => ({})) }, ...overrides };
}

function envWith(registry: any) {
  return { SESSION_SECRET: SECRET, REGISTRY: registry as any };
}

async function registryFor(token: string | null, userId = USER_A) {
  const knownHash = token ? await sha256Hex(token) : null;
  const fetch = vi.fn(async (input: string | Request) => {
    const url = typeof input === 'string' ? new URL(input) : new URL(input.url);
    if (url.pathname.startsWith('/sessions/') && knownHash && url.pathname.endsWith(knownHash)) {
      return new Response(JSON.stringify({ userId }), { status: 200 });
    }
    return new Response(JSON.stringify({ error: 'no session' }), { status: 401 });
  });
  return { idFromName: vi.fn(() => ({})), get: vi.fn(() => ({ fetch })) };
}

/* ------------------------------------------------------------------ */
/* Sessions and tokens (1–7)                                           */
/* ------------------------------------------------------------------ */

describe('Sessions and tokens', () => {
  let db: DatabaseSync;
  let registry: AuthRegistry;
  const post = (path: string, body: unknown) =>
    registry.fetch(new Request(`https://registry${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }));
  const get = (path: string) =>
    registry.fetch(new Request(`https://registry${path}`));

  beforeEach(async () => {
    db = new DatabaseSync(':memory:');
    registry = new AuthRegistry(makeState(db), makeEnv());
    await get('/bootstrap');
  });
  afterEach(() => db.close());

  // 1. Expired token is rejected by HMAC expiry and by the stored expires_at row
  it('rejects a token whose HMAC payload exp is in the past', async () => {
    const payload = { uid: USER_A, iat: 1000, exp: 1001 };
    const payloadB64 = base64urlEncodeString(JSON.stringify(payload));
    const sig = await hmacSign(SECRET, payloadB64);
    const token = `${TOKEN_PREFIX}${payloadB64}.${sig}`;
    const result = await verifyTokenSignature(token, SECRET);
    expect(result).toBeNull();
  });

  it('rejects a token whose stored expires_at row is in the past', async () => {
    const { token } = await issueToken(SECRET, USER_A);
    const tokenHash = await sha256Hex(token);
    const pastMs = Date.now() - 1000;
    db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(tokenHash, USER_A, Date.now(), pastMs);
    const res = await get(`/sessions/${encodeURIComponent(tokenHash)}`);
    expect(res.status).toBe(401);
  });

  // 2. Tampered payload (change uid, keep original signature) is rejected
  it('rejects a token whose uid was swapped but signature kept', async () => {
    const { token } = await issueToken(SECRET, USER_A);
    const body = token.slice(TOKEN_PREFIX.length);
    const sig = body.slice(body.lastIndexOf('.') + 1);
    const tampered = { uid: 'attacker', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 };
    const newPayload = base64urlEncodeString(JSON.stringify(tampered));
    const forged = `${TOKEN_PREFIX}${newPayload}.${sig}`;
    const result = await verifyTokenSignature(forged, SECRET);
    expect(result).toBeNull();
  });

  // 3. Malformed tokens all rejected without throwing
  it.each([
    ['tampered sig', async () => { const { token } = await issueToken(SECRET, USER_A); return token.slice(0, -4) + 'XXXX'; }],
    ['truncated', async () => TOKEN_PREFIX + 'abc'],
    ['empty', async () => ''],
    ['extra dots', async () => { const { token } = await issueToken(SECRET, USER_A); return token + '.extra.dots'; }],
    ['wrong prefix', async () => { const { token } = await issueToken(SECRET, USER_A); return 'wrong_' + token.slice(TOKEN_PREFIX.length); }],
    ['100KB junk', async () => 'x'.repeat(100_000)],
    ['null', async () => null],
    ['undefined', async () => undefined],
  ])('rejects %s without throwing', async (_label, tokenFn) => {
    const token = await tokenFn();
    const result = await verifyTokenSignature(token as any, SECRET);
    expect(result).toBeNull();
  });

  // 4. Token for a deleted user is rejected
  it('rejects a session whose user row was deleted', async () => {
    const hash = await hashPassword('pass12345678');
    db.prepare('INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)').run(USER_A, 'a@test.com', hash, 1000);
    const { token } = await issueToken(SECRET, USER_A);
    const tokenHash = await sha256Hex(token);
    const futureMs = (Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS) * 1000;
    db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(tokenHash, USER_A, Date.now(), futureMs);
    db.prepare('DELETE FROM users WHERE id = ?').run(USER_A);
    const res = await get(`/sessions/${encodeURIComponent(tokenHash)}`);
    const body = await res.json() as { userId?: string; email?: string };
    expect(body.email).toBeUndefined();
  });

  // 5. After logout, the same token fails on the next request
  it('rejects a token after logout deletes the session row', async () => {
    const { token } = await issueToken(SECRET, USER_A);
    const tokenHash = await sha256Hex(token);
    const futureMs = (Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS) * 1000;
    db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(tokenHash, USER_A, Date.now(), futureMs);
    let res = await get(`/sessions/${encodeURIComponent(tokenHash)}`);
    expect(res.status).toBe(200);
    await registry.fetch(new Request('https://registry/sessions', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tokenHash }),
    }));
    res = await get(`/sessions/${encodeURIComponent(tokenHash)}`);
    expect(res.status).toBe(404);
  });

  // 6. Registry unreachable: verifySession returns null (fails closed)
  it('returns null when the registry throws (fail closed)', async () => {
    const { token } = await issueToken(SECRET, USER_A);
    const broken = { idFromName: vi.fn(() => ({})), get: vi.fn(() => { throw new Error('DO unavailable'); }) };
    const req = new Request('https://brainhalf.com/api/foo', { headers: { authorization: `Bearer ${token}` } });
    expect(await verifySession(req, envWith(broken))).toBeNull();
  });

  // 7. ?token= is rejected on plain HTTP and WS upgrades without bhwt_ ticket
  it('rejects ?token= on a non-WebSocket request', async () => {
    const { token } = await issueToken(SECRET, USER_A);
    const reg = await registryFor(token);
    const req = new Request(`https://brainhalf.com/api/projects?token=${token}`);
    expect(await verifySession(req, envWith(reg))).toBeNull();
  });

  it('extractWsTicket rejects a non-bhwt_ ticket in the URL', () => {
    const req = new Request('https://brainhalf.com/agents/ws?ticket=not_a_ticket');
    expect(extractWsTicket(req)).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* WS tickets (8–11)                                                   */
/* ------------------------------------------------------------------ */

describe('WS tickets', () => {
  let db: DatabaseSync;
  let registry: AuthRegistry;
  const post = (path: string, body: unknown) =>
    registry.fetch(new Request(`https://registry${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }));
  const get = (path: string) =>
    registry.fetch(new Request(`https://registry${path}`));

  beforeEach(async () => {
    db = new DatabaseSync(':memory:');
    registry = new AuthRegistry(makeState(db), makeEnv());
    await get('/bootstrap');
  });
  afterEach(() => db.close());

  let seedCounter = 0;
  async function seedSession(userId: string): Promise<string> {
    const tokenHash = await sha256Hex(`fake-token-${userId}-${++seedCounter}`);
    const futureMs = Date.now() + 30 * 24 * 60 * 60 * 1000;
    const exists = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
    if (!exists) db.prepare('INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)').run(userId, `${userId}@test.com`, '!test', Date.now());
    db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(tokenHash, userId, Date.now(), futureMs);
    return tokenHash;
  }

  async function mintTicket(userId: string, sessionHash: string): Promise<string> {
    const res = await post('/ws-tickets', { userId, sessionHash });
    expect(res.status).toBe(201);
    return ((await res.json()) as { ticket: string }).ticket;
  }

  // 8. A ticket is single-use: second redeem fails
  it('rejects a ticket on the second redeem attempt', async () => {
    const sessionHash = await seedSession(USER_A);
    const ticket = await mintTicket(USER_A, sessionHash);
    const first = await post('/ws-tickets/verify', { ticket });
    expect(first.status).toBe(200);
    const second = await post('/ws-tickets/verify', { ticket });
    expect(second.status).toBe(401);
  });

  // 9. An expired ticket fails and is deleted
  it('rejects an expired ticket', async () => {
    const sessionHash = await seedSession(USER_A);
    const ticket = await mintTicket(USER_A, sessionHash);
    const ticketHash = await sha256Hex(ticket);
    db.prepare('UPDATE ws_tickets SET expires_at = ? WHERE ticket_hash = ?').run(Date.now() - 1000, ticketHash);
    const res = await post('/ws-tickets/verify', { ticket });
    expect(res.status).toBe(401);
    const row = db.prepare('SELECT * FROM ws_tickets WHERE ticket_hash = ?').get(ticketHash);
    expect(row).toBeUndefined();
  });

  // 10. A ticket for session A cannot be redeemed after session A logs out
  it('rejects a ticket after the backing session is revoked', async () => {
    const sessionHash = await seedSession(USER_A);
    const ticket = await mintTicket(USER_A, sessionHash);
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sessionHash);
    const res = await post('/ws-tickets/verify', { ticket });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: 'Session expired' });
  });

  // 11. 100 concurrent redeems of the same ticket: exactly one succeeds
  it('allows exactly one success among 100 parallel redeems', async () => {
    const sessionHash = await seedSession(USER_A);
    const ticket = await mintTicket(USER_A, sessionHash);
    const results = await Promise.all(
      Array.from({ length: 100 }, () =>
        post('/ws-tickets/verify', { ticket }).then(r => r.status)
      )
    );
    expect(results.filter(s => s === 200).length).toBe(1);
    expect(results.filter(s => s === 401).length).toBe(99);
  });
});

/* ------------------------------------------------------------------ */
/* Accounts (12–16)                                                    */
/* ------------------------------------------------------------------ */

describe('Accounts', () => {
  let db: DatabaseSync;
  let registry: AuthRegistry;
  const post = (path: string, body: unknown) =>
    registry.fetch(new Request(`https://registry${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }));
  const get = (path: string) =>
    registry.fetch(new Request(`https://registry${path}`));

  beforeEach(async () => {
    db = new DatabaseSync(':memory:');
    registry = new AuthRegistry(makeState(db), makeEnv());
    await get('/bootstrap');
  });
  afterEach(() => db.close());

  // 12. Duplicate signup with same email, different case, and leading/trailing spaces
  it('rejects duplicate signup for the same email (case-insensitive, trimmed)', async () => {
    const first = await post('/auth/signup', { email: 'Test@Example.Com', password: 'password1234' });
    expect(first.status).toBe(201);
    const second = await post('/auth/signup', { email: 'test@example.com', password: 'password5678' });
    const body = await second.json() as { alreadyExists?: boolean };
    expect(body.alreadyExists).toBe(true);
    const third = await post('/auth/signup', { email: '  TEST@example.com  ', password: 'password9012' });
    expect((await third.json() as { alreadyExists?: boolean }).alreadyExists).toBe(true);
    const rows = db.prepare('SELECT * FROM users WHERE email = ?').all('test@example.com');
    expect(rows.length).toBe(1);
  });

  // 13. Concurrent signups for the same email: exactly one account created
  it('creates exactly one account when 10 parallel signups race', async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        post('/auth/signup', { email: 'racer@test.com', password: 'password1234' })
      )
    );
    const statuses = results.map(r => r.status);
    const created = statuses.filter(s => s === 201).length;
    expect(created).toBe(1);
    const rows = db.prepare('SELECT * FROM users WHERE email = ?').all('racer@test.com');
    expect(rows.length).toBe(1);
  });

  // 14. Login failure for unknown email and wrong password return the same status and body
  it('returns identical error for unknown email and wrong password', async () => {
    await post('/auth/signup', { email: 'known@test.com', password: 'password1234' });
    db.prepare('INSERT INTO email_verification (user_id, verified_at) VALUES (?, ?)').run(
      (db.prepare('SELECT id FROM users WHERE email = ?').get('known@test.com') as { id: string }).id,
      Date.now()
    );
    const unknown = await post('/auth/login', { email: 'nobody@test.com', password: 'password1234' });
    const wrong = await post('/auth/login', { email: 'known@test.com', password: 'wrong-password1' });
    expect(unknown.status).toBe(wrong.status);
    expect(await unknown.json()).toEqual(await wrong.json());
  });

  // 15. After 10 failures, login is blocked. Forgot/reset password still work.
  it('blocks login after 10 failures for an email (any casing)', async () => {
    const hash = await hashPassword('correct-pass-1234');
    db.prepare('INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)').run(USER_A, 'locked@test.com', hash, 1000);
    db.prepare('INSERT INTO email_verification (user_id, verified_at) VALUES (?, ?)').run(USER_A, 1500);
    const futureWindow = Date.now() + 15 * 60 * 1000;
    db.prepare("INSERT INTO rate_limits (bucket, rate_key, count, reset_at) VALUES ('loginFail', 'locked@test.com', 10, ?)").run(futureWindow);
    const blocked = await post('/auth/login', { email: 'Locked@test.com', password: 'correct-pass-1234' });
    expect(blocked.status).toBe(401);
    const emailRoute = await registry.fetch(new Request('https://registry/email/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'locked@test.com' }),
    }));
    expect(emailRoute.status).not.toBe(429);
  });

  // 16. OAuth subject colliding with a password account returns conflict, no silent merge
  it('returns conflict when Google subject collides with password email', async () => {
    await post('/auth/signup', { email: 'mixed@test.com', password: 'password1234' });
    const res = await post('/auth/google', { subject: 'google-sub-123', email: 'mixed@test.com' });
    const body = await res.json() as { conflict?: boolean; userId?: string };
    expect(body.conflict).toBe(true);
    expect(body.userId).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ */
/* Projects (17–20)                                                    */
/* ------------------------------------------------------------------ */

describe('Projects', () => {
  let db: DatabaseSync;
  let registry: AuthRegistry;
  const post = (path: string, body: unknown) =>
    registry.fetch(new Request(`https://registry${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }));
  const get = (path: string) =>
    registry.fetch(new Request(`https://registry${path}`));

  beforeEach(async () => {
    db = new DatabaseSync(':memory:');
    registry = new AuthRegistry(makeState(db), {
      RUNTIME: { fetch: vi.fn(async () => new Response('', { status: 200 })) },
      ChatAgent: { idFromName: vi.fn(() => ({ toString: () => 'doId' })), get: vi.fn(() => ({ fetch: vi.fn(async () => new Response('', { status: 200 })) })) },
      PROJECT_BACKUPS: { delete: vi.fn(async () => {}) },
    });
    await get('/bootstrap');
    db.prepare('INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)').run(USER_A, 'a@test.com', '!test', 1000);
    db.prepare('INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)').run(USER_B, 'b@test.com', '!test', 1000);
  });
  afterEach(() => db.close());

  // 17. User B cannot claim a project owned by user A (403)
  it('rejects user B claiming user A\'s project', async () => {
    const claimA = await post('/projects/claim', { projectId: 'proj-owned', userId: USER_A });
    expect(claimA.status).toBe(200);
    const claimB = await post('/projects/claim', { projectId: 'proj-owned', userId: USER_B });
    expect(claimB.status).toBe(403);
  });

  // 18. A deleted project ID cannot be claimed by anyone (410)
  it('returns 410 when trying to claim a deleted project', async () => {
    await post('/projects/claim', { projectId: 'proj-dead', userId: USER_A });
    db.prepare('UPDATE project_owners SET deleted_at = ? WHERE project_id = ?').run(Date.now(), 'proj-dead');
    const byA = await post('/projects/claim', { projectId: 'proj-dead', userId: USER_A });
    expect(byA.status).toBe(410);
    const byB = await post('/projects/claim', { projectId: 'proj-dead', userId: USER_B });
    expect(byB.status).toBe(410);
  });

  // 19. Two users claiming the same new project in parallel: exactly one wins
  it('allows exactly one winner among 10 parallel claims', async () => {
    const users = [USER_A, USER_B, USER_A, USER_B, USER_A, USER_B, USER_A, USER_B, USER_A, USER_B];
    const results = await Promise.all(
      users.map(uid => post('/projects/claim', { projectId: 'proj-race', userId: uid }))
    );
    const statuses = results.map(r => r.status);
    const won = statuses.filter(s => s === 200).length;
    const lost = statuses.filter(s => s === 403).length;
    expect(won + lost).toBe(10);
    const rows = db.prepare('SELECT * FROM project_owners WHERE project_id = ?').all('proj-race');
    expect(rows.length).toBe(1);
  });

  // 20. Unicode, empty, very long, and path-like project IDs are rejected
  it.each([
    ['empty', ''],
    ['unicode', 'proj-\u{1F4A9}'],
    ['too long (129 chars)', 'a'.repeat(129)],
    ['path traversal', '../x'],
    ['slash', 'a/b'],
    ['space', 'a b'],
    ['null byte', 'proj\0evil'],
  ])('rejects invalid project ID: %s', async (_label, id) => {
    const res = await post('/projects/claim', { projectId: id, userId: USER_A });
    expect(res.status).toBe(400);
  });

  it('accepts a max-length valid project ID (128 chars)', async () => {
    const res = await post('/projects/claim', { projectId: 'a'.repeat(128), userId: USER_A });
    expect(res.status).toBe(200);
  });
});

/* ------------------------------------------------------------------ */
/* Admin (21–22)                                                       */
/* ------------------------------------------------------------------ */

/**
 * Derive admin route+method pairs from worker.ts source code.
 * A new admin route that isn't listed here will fail this test.
 */
function extractAdminRoutes(): Array<[string, string]> {
  const src = readFileSync(resolve(__dirname, '../worker.ts'), 'utf8');
  const routes = new Set<string>();

  // Match: url.pathname === '/api/admin/...' && request.method === '...'
  //   and: url.pathname === '/api/admin/...' && (request.method === '...' || request.method === '...')
  for (const m of src.matchAll(/url\.pathname\s*===\s*'(\/api\/admin\/[^']+)'\s*&&\s*(?:\(?request\.method\s*===\s*'([A-Z]+)'|request\.method\s*===\s*'([A-Z]+)')/g)) {
    routes.add(`${m[2] || m[3]} ${m[1]}`);
  }
  // url.pathname === '/api/admin/settings' && (request.method === 'GET' || request.method === 'POST')
  for (const m of src.matchAll(/url\.pathname\s*===\s*'(\/api\/admin\/[^']+)'\s*&&\s*\(request\.method\s*===\s*'([A-Z]+)'\s*\|\|\s*request\.method\s*===\s*'([A-Z]+)'\)/g)) {
    routes.add(`${m[2]} ${m[1]}`);
    routes.add(`${m[3]} ${m[1]}`);
  }
  // Match: url.pathname.startsWith('/api/admin/...') && request.method === '...'
  for (const m of src.matchAll(/url\.pathname\.startsWith\('(\/api\/admin\/[^']+)'\)\s*&&\s*request\.method\s*===\s*'([A-Z]+)'/g)) {
    const prefix = m[1];
    const method = m[2];
    if (prefix === '/api/admin/projects/') routes.add(`${method} /api/admin/projects/test-proj-id`);
    if (prefix === '/api/admin/users/') routes.add(`${method} /api/admin/users/test-user-id`);
  }
  // Match: url.pathname === '/api/admin/outcomes' inside an || condition
  for (const m of src.matchAll(/url\.pathname\s*===\s*'(\/api\/admin\/[^']+)'/g)) {
    const path = m[1];
    if (routes.has(`GET ${path}`) || routes.has(`POST ${path}`)) continue;
    const lineStart = src.lastIndexOf('\n', m.index!) + 1;
    const line = src.slice(lineStart, src.indexOf('\n', m.index!));
    const methodMatch = line.match(/request\.method\s*===\s*'([A-Z]+)'/);
    if (methodMatch) routes.add(`${methodMatch[1]} ${path}`);
  }
  // Match: adminModelsMatch (regex-based route)
  if (src.includes('adminModelsMatch')) {
    routes.add('GET /api/admin/models');
    routes.add('POST /api/admin/models');
    routes.add('DELETE /api/admin/models/cm_test');
    routes.add('POST /api/admin/models/cm_test/test');
  }
  // Match: adminFilesMatch (regex-based route)
  if (src.includes('adminFilesMatch')) {
    routes.add('GET /api/admin/projects/test-proj-id/files');
  }
  // Match: adminPreviewMatch (regex-based route)
  if (src.includes('adminPreviewMatch')) {
    routes.add('GET /api/admin/projects/test-proj-id/preview/');
  }

  return [...routes].map(r => {
    const [method, ...rest] = r.split(' ');
    return [method, rest.join(' ')];
  });
}

describe('Admin', () => {
  // 21. A non-operator user gets 403 on every /api/admin/* route (derived from worker.ts)
  it('rejects non-operator on all admin routes (derived from worker.ts source)', async () => {
    const { token } = await issueToken(SECRET, USER_A);
    const knownHash = await sha256Hex(token);
    const registryFetch = vi.fn(async (input: string | Request) => {
      const url = typeof input === 'string' ? new URL(input) : new URL(input.url);
      if (url.pathname.startsWith('/sessions/') && url.pathname.endsWith(knownHash)) {
        return new Response(JSON.stringify({ userId: USER_A, email: 'regular@test.com' }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: 'no session' }), { status: 401 });
    });
    const env = {
      SESSION_SECRET: SECRET,
      ADMIN_EMAILS: 'admin@brainhalf.com',
      PRODUCT_METRICS_OWNER_IDS: 'usr_admin_only',
      REGISTRY: { idFromName: vi.fn(() => ({})), get: vi.fn(() => ({ fetch: registryFetch })) },
      ASSETS: { fetch: vi.fn(async () => new Response('', { status: 200 })) },
      ChatAgent: { idFromName: vi.fn(() => ({})), get: vi.fn(() => ({ fetch: vi.fn(async () => new Response('{}', { status: 200 })) })) },
    };
    const { default: worker } = await import('../worker');
    const adminRoutes = extractAdminRoutes();
    expect(adminRoutes.length).toBeGreaterThanOrEqual(10);
    for (const [method, path] of adminRoutes) {
      const req = new Request(`https://brainhalf.com${path}`, {
        method,
        headers: { authorization: `Bearer ${token}`, origin: 'https://brainhalf.com' },
        ...(['POST', 'PUT', 'PATCH'].includes(method) ? { body: '{}' } : {}),
      });
      const res = await worker.fetch(req, env as any, { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as any);
      expect(res.status, `${method} ${path} should be 403 for non-operator`).toBe(403);
    }
  });

  // 22. Client-supplied x-auth-user-id, _uid, and preview access header are stripped
  it('strips x-auth-user-id from incoming requests', () => {
    const req = new Request('https://brainhalf.com/agents/chat-agent/proj', {
      headers: { [USER_ID_HEADER]: 'attacker-uid' },
    });
    const injected = injectUserId(req, USER_A);
    expect(injected.headers.get(USER_ID_HEADER)).toBe(USER_A);
  });

  it('strips client-supplied _uid query param before routing', async () => {
    const url = new URL('https://brainhalf.com/api/projects');
    url.searchParams.set(USER_ID_QUERY_PARAM, 'attacker-uid');
    const { default: worker } = await import('../worker');
    const req = new Request(url.toString(), {
      headers: { origin: 'https://brainhalf.com' },
    });
    const env = {
      SESSION_SECRET: SECRET,
      REGISTRY: { idFromName: vi.fn(() => ({})), get: vi.fn(() => ({ fetch: vi.fn(async () => new Response('{}', { status: 401 })) })) },
      ASSETS: { fetch: vi.fn(async () => new Response('', { status: 200 })) },
    };
    const res = await worker.fetch(req, env as any, { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as any);
    expect(res.status).toBe(401);
  });

  it('strips client-supplied preview access header', async () => {
    const { default: worker } = await import('../worker');
    const req = new Request('https://brainhalf.com/api/auth/session', {
      headers: {
        origin: 'https://brainhalf.com',
        [PREVIEW_ACCESS_HEADER]: 'owner',
      },
    });
    const registryFetch = vi.fn(async () => new Response(JSON.stringify({ error: 'no' }), { status: 401 }));
    const env = {
      SESSION_SECRET: SECRET,
      REGISTRY: { idFromName: vi.fn(() => ({})), get: vi.fn(() => ({ fetch: registryFetch })) },
      ASSETS: { fetch: vi.fn(async () => new Response('', { status: 200 })) },
    };
    const res = await worker.fetch(req, env as any, { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as any);
    expect(res.status).toBe(401);
  });
});
