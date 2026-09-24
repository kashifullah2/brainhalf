import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('cloudflare:workers', () => ({ DurableObject: class { constructor(public ctx: any, public env: any) {} }, WorkerEntrypoint: class { constructor(public ctx: any, public env: any) {} } }));
vi.mock('@cloudflare/sandbox', () => ({ getSandbox: () => ({ destroy: async () => {} }) }));
vi.mock('@cloudflare/playwright', () => ({ launch: vi.fn(), connect: vi.fn(), sessions: vi.fn() }));
import { ProjectRuntime } from '../src/runtime/project';
import { ManagedStore } from '../src/runtime/managed-store';
import { ManagedMail } from '../src/runtime/managed-mail';
import { digest } from '../src/runtime/source';
import { serviceCapability, verifyServiceCapability } from '../src/runtime/managed-capability';
import { AppServicesAPI } from '../src/runtime/worker';
import { CloudflareAPI } from '../src/runtime/cloudflare-api';

const databases: DatabaseSync[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function fixture(projectId = 'managed-project') {
  const db = new DatabaseSync(':memory:'); databases.push(db);
  const map = new Map<string, any>(); let ready: Promise<unknown>; let nextAlarm: number | null = null;
  const storage: any = {
    get: async (key: string) => structuredClone(map.get(key)),
    put: async (key: string | object, value?: unknown) => { if (typeof key === 'string') map.set(key, structuredClone(value)); else for (const [k, v] of Object.entries(key)) map.set(k, structuredClone(v)); },
    delete: async (key: string) => map.delete(key), list: async ({ prefix = '' } = {}) => new Map([...map].filter(([key]) => key.startsWith(prefix))),
    setAlarm: vi.fn(async (at: number) => { nextAlarm = at; }), getAlarm: async () => nextAlarm,
    transaction: async (fn: (txn: any) => unknown) => fn(storage),
    sql: { exec: (sql: string, ...params: any[]) => { const stmt = db.prepare(sql); const rows = stmt.columns().length ? stmt.all(...params) : (stmt.run(...params), []); return { toArray: () => rows }; } },
  };
  const ctx: any = { storage, blockConcurrencyWhile: (fn: () => Promise<unknown>) => ready = fn() };
  const scope = { projectId, ownerId: 'pilot-owner' }; const alias = (await digest(projectId)).slice(0, 32);
  const usage = { register: vi.fn(async () => ({ ok: true })), consumeUsage: vi.fn(async () => ({ ok: true })), unregister: vi.fn(async () => {}), lookup: async () => scope };
  const provider = vi.fn(async (request: Request) => {
    const path = new URL(request.url).pathname;
    if (path === '/config') return Response.json({ emailReady: true, googleReady: true, ownerVerified: true, ownerEmail: 'owner@example.com', from: 'apps@example.com', googleCallback: 'https://brainhalf.com/api/auth/google/callback' });
    throw new Error('Unexpected provider operation: ' + path);
  });
  const env: any = { PROJECT_SECRETS_KEY: btoa('m'.repeat(32)), RUNTIME_DOMAIN: 'apps.example.com', RUNTIME_ENABLED: 'true', PILOT_OWNER_IDS: scope.ownerId, PLATFORM: { fetch: provider }, PILOT: { getByName: () => usage }, ARTIFACTS: { list: async () => ({ objects: [] }), delete: async () => {} } };
  const object = new ProjectRuntime(ctx, env); await ready!; await object.initialize(scope, alias);
  await storage.put('active:production', { id: 'managed-app', scriptName: 'managed-app' });
  env.PROJECTS = { getByName: (id: string) => { expect(id).toBe(projectId); return object; } };
  const call = (path: string, method = 'GET', body?: unknown, environment = 'development') => object.control(new Request('https://control' + path + '?environment=' + environment, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
  const ticket = await (await call('/preview-ticket', 'POST')).json() as { url: string };
  const preview = (await object.appRequest(new Request(ticket.url), 'development')).headers.get('set-cookie')!.split(';')[0];
  const app = (path: string, method = 'GET', body?: unknown, cookie = '', environment: 'development' | 'production' = 'development', origin?: string) => {
    const base = `https://${environment === 'development' ? 'dev-' : ''}${alias}.apps.example.com`;
    return object.appRequest(new Request(base + path, { method, headers: { Cookie: `${preview}; ${cookie}`, Origin: origin || base, 'Content-Type': 'application/json', 'CF-Connecting-IP': '192.0.2.1' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), environment);
  };
  const clearRates = () => db.exec('DELETE FROM managed_limits');
  const action = async (kind: string) => {
    const messages = (await (await call('/services/messages')).json() as any).messages;
    const message = messages.find((row: any) => row.kind === kind);
    const detail = await (await call('/services/messages/' + message.id)).json() as any;
    return { token: detail.text.match(/#token=([A-Za-z0-9_-]{43})/)[1] as string, detail };
  };
  const signup = async () => { expect((await app('/api/auth/signup', 'POST', { email: 'user@example.com', password: 'original-password', name: '<Tester>' })).status).toBe(202); const link = await action('verify_email'); expect((await app('/api/auth/verify-email', 'POST', { token: link.token })).status).toBe(200); clearRates(); return (await (await call('/services/users')).json() as any).users[0]; };
  return { object, ctx, env, db, map, call, app, action, signup, clearRates, provider, usage, scope, storage };
}

describe('managed app authentication and mail', () => {
  it('captures signup mail encrypted, requires verification, consumes links once, and logs out', async () => {
    const f = await fixture();
    expect((await f.app('/api/auth/signup', 'POST', { email: 'user@example.com', password: 'original-password' })).status).toBe(202);
    expect((await f.app('/api/auth/login', 'POST', { email: 'user@example.com', password: 'original-password' })).status).toBe(403);
    const { token, detail } = await f.action('verify_email'); expect(detail.status).toBe('captured');
    const stored = f.db.prepare('SELECT sealed FROM managed_emails').get() as any; expect(stored.sealed).not.toContain(token);
    const ticket = await (await f.call('/services/messages/' + detail.id + '/open', 'POST')).json() as any;
    expect(JSON.stringify(f.db.prepare('SELECT * FROM sessions').all())).not.toContain(token);
    const opened = await f.object.appRequest(new Request(ticket.url), 'development'); expect(opened.status).toBe(303); expect(opened.headers.get('location')).toContain('#token=' + token);
    expect((await f.app('/api/auth/verify-email', 'GET')).status).toBe(405);
    const results = await Promise.all([f.app('/api/auth/verify-email', 'POST', { token }), f.app('/api/auth/verify-email', 'POST', { token })]);
    expect(results.map(r => r.status).sort()).toEqual([200, 400]);
    const login = await f.app('/api/auth/login', 'POST', { email: 'user@example.com', password: 'original-password' }); expect(login.status).toBe(200);
    const cookie = login.headers.get('set-cookie')!.split(';')[0]; expect(cookie).toMatch(/^__Host-bh_app=/);
    expect(await (await f.app('/api/auth/session', 'GET', undefined, cookie)).json()).toMatchObject({ user: { email: 'user@example.com', verified: true } });
    expect((await f.app('/api/auth/logout', 'POST', {}, cookie)).status).toBe(200);
    expect(await (await f.app('/api/auth/session', 'GET', undefined, cookie)).json()).toEqual({ user: null });
    expect(f.provider.mock.calls.every(([r]) => new URL(r.url).pathname === '/config')).toBe(true);
  });
  it('resets passwords, revokes prior sessions, expires links and isolates environments/projects', async () => {
    const f = await fixture(); await f.signup(); const other = await fixture('other-managed');
    const login = await f.app('/api/auth/login', 'POST', { email: 'user@example.com', password: 'original-password' }); const cookie = login.headers.get('set-cookie')!.split(';')[0];
    await f.app('/api/auth/forgot-password', 'POST', { email: 'user@example.com' }); const { token } = await f.action('reset_password');
    expect((await other.app('/api/auth/reset-password', 'POST', { token, password: 'replacement-password' })).status).toBe(400);
    expect((await f.app('/api/auth/reset-password', 'POST', { token, password: 'replacement-password' }, '', 'production')).status).toBe(400);
    expect((await f.app('/api/auth/reset-password', 'POST', { token, password: 'replacement-password' })).status).toBe(200);
    expect(await (await f.app('/api/auth/session', 'GET', undefined, cookie)).json()).toEqual({ user: null });
    f.clearRates(); expect((await f.app('/api/auth/login', 'POST', { email: 'user@example.com', password: 'original-password' })).status).toBe(401);
    expect((await f.app('/api/auth/login', 'POST', { email: 'user@example.com', password: 'replacement-password' })).status).toBe(200);
    await f.app('/api/auth/forgot-password', 'POST', { email: 'user@example.com' }); const next = await f.action('reset_password');
    f.db.exec('UPDATE managed_actions SET expires=0'); expect((await f.app('/api/auth/reset-password', 'POST', { token: next.token, password: 'third-password' })).status).toBe(400);
  });
  it('magic-link ownership clears a pre-created unverified password; disabled users cannot sign in', async () => {
    const f = await fixture();
    await f.app('/api/auth/signup', 'POST', { email: 'user@example.com', password: 'attacker-password' });
    await f.app('/api/auth/magic-link', 'POST', { email: 'user@example.com' }); const { token } = await f.action('magic_link');
    const completed = await f.app('/api/auth/magic-link/complete', 'POST', { token }); expect(completed.status).toBe(200);
    const { user } = await completed.json() as any; const cookie = completed.headers.get('set-cookie')!.split(';')[0];
    expect((f.db.prepare('SELECT password_hash FROM managed_users').get() as any).password_hash).toBeNull();
    expect((await f.app('/api/auth/login', 'POST', { email: 'user@example.com', password: 'attacker-password' })).status).toBe(401);
    expect((await f.call('/services/users/' + user.id, 'PATCH', { disabled: true })).status).toBe(200);
    expect(await (await f.app('/api/auth/session', 'GET', undefined, cookie)).json()).toEqual({ user: null });
    expect((await f.app('/api/auth/magic-link/complete', 'POST', { token })).status).toBe(400);
  });
  it('rejects cross-origin writes, private previews and incorrect Google browser proofs', async () => {
    const f = await fixture();
    expect((await f.app('/api/auth/signup', 'POST', { email: 'user@example.com', password: 'password-123' }, '', 'development', 'https://evil.example')).status).toBe(403);
    expect((await f.object.appRequest(new Request('https://dev.app/api/auth/session'), 'development')).status).toBe(401);
    f.provider.mockImplementation(async request => {
      const body = await request.json() as any;
      if (new URL(request.url).pathname === '/config') return Response.json({ googleReady: true });
      expect(body.proofHash).toMatch(/^[a-f0-9]{64}$/); return Response.json({ url: 'https://brainhalf.com/api/apps/google/start?ticket=launch' });
    });
    const start = await f.app('/api/auth/google/start'); expect(start.status).toBe(302); expect(start.headers.get('location')).toContain('https://brainhalf.com/api/apps/google/start');
    expect((await f.app('/api/auth/google/complete?code=stolen')).status).toBe(400);
  });
  it('validates editable templates and escapes HTML instead of executing message content', async () => {
    const f = await fixture();
    expect((await f.call('/services/templates/verify_email', 'PUT', { subject: 'Verify', text: 'Missing link' })).status).toBe(400);
    expect((await f.call('/services/templates/contact', 'PUT', { subject: '{{apiKey}}', text: 'Message' })).status).toBe(400);
    expect((await f.call('/services/templates/contact', 'PUT', { subject: 'Hi {{name}}', text: '{{message}}' })).status).toBe(200);
    const store = (f.object as any).services().store as ManagedStore; const mail = new ManagedMail(store);
    const rendered = mail.render('development', 'contact', { name: '<script>', message: '<img src=x onerror=alert(1)>' });
    expect(rendered.html).not.toContain('<img'); expect(rendered.html).toContain('&lt;img');
  });
  it('accounts for email quota failures and never turns a development retry into live delivery', async () => {
    const f = await fixture(); f.usage.consumeUsage.mockImplementation(async (kind?: string) => kind === 'emails' ? { ok: false, error: 'Limit reached', status: 429 } : { ok: true });
    const response = await f.app('/api/contact', 'POST', { name: 'Tester', email: 'test@example.com', message: 'Hello' }); expect(response.status).toBe(429);
    const row = f.db.prepare('SELECT id,status FROM managed_emails').get() as any; expect(row.status).toBe('failed');
    expect((await f.call('/services/messages/' + row.id + '/retry', 'POST')).status).toBe(400);
    expect((f.db.prepare('SELECT COUNT(*) AS n FROM inbox').get() as any).n).toBe(0);
  });
  it('deduplicates concurrent backend events, refuses arbitrary recipients and verifies capability scope', async () => {
    const f = await fixture(); const user = await f.signup();
    const capability = await serviceCapability(f.scope, 'development', f.env.PROJECT_SECRETS_KEY);
    expect(await verifyServiceCapability(capability, f.env.PROJECT_SECRETS_KEY)).toEqual({ ...f.scope, environment: 'development' });
    await expect(verifyServiceCapability(capability + 'x', f.env.PROJECT_SECRETS_KEY)).rejects.toThrow();
    const api = new AppServicesAPI({} as any, f.env);
    const send = (body: unknown, key = capability) => api.fetch(new Request('https://services/email', { method: 'POST', headers: { Authorization: 'Bearer ' + key }, body: JSON.stringify(body) }));
    const event = { template: 'order_receipt', userId: user.id, variables: { orderId: 'order-1', amount: '$20' }, idempotencyKey: 'order-1' };
    const results = await Promise.all([send(event), send(event)]); expect(results.map(r => r.status)).toEqual([202, 202]);
    const first = await results[0].json(); expect(await results[1].json()).toEqual(first);
    expect((await send({ ...event, variables: { amount: '$100' } })).status).toBe(409);
    expect((await send({ ...event, userId: 'another-user' })).status).toBe(403);
    expect((await send({ ...event, variables: { to: 'stranger@example.com' } })).status).toBe(400);
    expect((await send(event, await serviceCapability({ ...f.scope, ownerId: 'other-owner' }, 'development', f.env.PROJECT_SECRETS_KEY))).status).toBe(403);
    expect((await send(event, await serviceCapability(f.scope, 'production', f.env.PROJECT_SECRETS_KEY))).status).toBe(403);
  });
  it('retries provider failures with one stable event key and tracks acceptance separately from delivery', async () => {
    const f = await fixture(); let failed = false;
    const providerId = '12345678-1234-1234-1234-123456789012'; const sentKeys: string[] = [];
    const defaultProvider = f.provider.getMockImplementation()!;
    f.provider.mockImplementation(async request => {
      const path = new URL(request.url).pathname;
      if (path === '/email') { const body = await request.json() as any; sentKeys.push(body.key); if (!failed) { failed = true; return Response.json({ error: 'Retry', retryable: true }, { status: 503 }); } return Response.json({ id: providerId }); }
      if (path === '/email/status') return Response.json({ status: 'delivered' });
      return defaultProvider(request);
    });
    expect((await f.app('/api/contact', 'POST', { name: 'Person', email: 'person@example.com', message: 'Question' }, '', 'production')).status).toBe(201);
    const tick = async () => { f.db.exec('UPDATE managed_emails SET next_at=0 WHERE next_at IS NOT NULL'); await f.object.alarm(); return f.db.prepare('SELECT * FROM managed_emails').get() as any; };
    expect((await tick()).status).toBe('queued'); expect((await tick()).status).toBe('sent'); expect((await tick()).status).toBe('delivered'); expect(new Set(sentKeys).size).toBe(1);
    expect(f.storage.setAlarm).toHaveBeenCalled();
  });
  it('disabling email cancels queued sending; deleting the project prevents later delivery', async () => {
    const f = await fixture();
    await f.app('/api/contact', 'POST', { name: 'Person', email: 'person@example.com', message: 'Question' }, '', 'production');
    await f.call('/services', 'PUT', { emailEnabled: false }, 'production'); f.db.exec('UPDATE managed_emails SET next_at=0'); await f.object.alarm();
    expect((f.db.prepare('SELECT status FROM managed_emails').get() as any).status).toBe('failed');
    expect(f.provider.mock.calls.every(([r]) => new URL(r.url).pathname === '/config')).toBe(true);
    expect((await f.call('/delete', 'POST')).status).toBe(200); expect((await f.app('/api/auth/signup', 'POST', {})).status).toBe(404);
  });
  it('uploads scoped service bindings without giving generated apps provider credentials', async () => {
    const fetchMock = vi.fn(async (_url: unknown, init: RequestInit) => { const metadata = JSON.parse((init.body as FormData).get('metadata') as string); expect(metadata.bindings).toContainEqual({ name: 'BRAINHALF_SERVICES', type: 'service', service: 'runtime', entrypoint: 'AppServicesAPI' }); expect(metadata.bindings).toContainEqual({ name: 'BRAINHALF_SERVICE_TOKEN', type: 'secret_text', text: 'scoped-capability' }); expect(JSON.stringify(metadata)).not.toContain('provider-key'); return Response.json({ success: true, result: {} }); }); vi.stubGlobal('fetch', fetchMock);
    await new CloudflareAPI('account', 'provider-key').upload('namespace', 'app', 'export default {}', 'db', { service: 'runtime', capability: 'scoped-capability' }); expect(fetchMock).toHaveBeenCalledOnce();
  });
});

it('a password reset during session creation cannot resurrect a revoked session', async () => {
  const f = await fixture(); const user = await f.signup();
  const original = (f.object as any).createSession.bind(f.object);
  let release!: () => void; const paused = new Promise<void>(resolve => { release = resolve; });
  let reached!: () => void; const pending = new Promise<void>(resolve => { reached = resolve; });
  (f.object as any).createSession = async (...args: any[]) => { if (args[0] === 'app') { reached(); await paused; } return original(...args); };
  const login = f.app('/api/auth/login', 'POST', { email: 'user@example.com', password: 'original-password' }); await pending;
  await f.call('/services/users/' + user.id, 'PATCH', { disabled: true }); await f.call('/services/users/' + user.id, 'PATCH', { disabled: false }); release();
  expect((await login).status).toBe(401); expect((f.db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE kind='app'").get() as any).n).toBe(0);
});
