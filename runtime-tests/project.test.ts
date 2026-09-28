import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('cloudflare:workers', () => ({ DurableObject: class { constructor(public ctx: any, public env: any) {} } }));
const sandbox = vi.hoisted(() => ({ destroy: vi.fn(async () => {}), getProcess: vi.fn(), exec: vi.fn(), mkdir: vi.fn(), writeFile: vi.fn(), readFile: vi.fn() }));
vi.mock('@cloudflare/sandbox', () => ({ getSandbox: () => sandbox }));
vi.mock('@cloudflare/playwright', () => ({ launch: vi.fn(), connect: vi.fn(), sessions: vi.fn() }));
import { ProjectRuntime } from '../src/runtime/project';
import { PilotCoordinator } from '../src/runtime/pilot';
import { digest } from '../src/runtime/source';
import { readJson, token } from '../src/runtime/integrations';
import { CloudflareAPI } from '../src/runtime/cloudflare-api';
import { STARTER_VERIFICATION } from '../src/runtime/verification';
import { OWNER_RUNTIME_LIMITS } from '../src/runtime/types';
import { ManagedStore } from '../src/runtime/managed-store';
import { launch, connect, sessions } from '@cloudflare/playwright';

const databases: DatabaseSync[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); vi.restoreAllMocks(); vi.clearAllMocks(); vi.unstubAllGlobals(); });
function context() {
  const db = new DatabaseSync(':memory:'); databases.push(db);
  const map = new Map<string, any>(); let ready = Promise.resolve(); let serial = Promise.resolve();
  const storage: any = {
    get: async (key: string) => structuredClone(map.get(key)),
    put: async (key: string | Record<string, any>, value?: any) => { if (typeof key === 'string') map.set(key, structuredClone(value)); else for (const [k, v] of Object.entries(key)) map.set(k, structuredClone(v)); },
    delete: async (key: string) => map.delete(key),
    list: async ({ prefix = '' } = {}) => new Map([...map].filter(([key]) => key.startsWith(prefix)).map(([key, value]) => [key, structuredClone(value)])),
    setAlarm: vi.fn(async () => {}),
    transaction: (callback: (txn: any) => Promise<any>) => { const result = serial.then(() => callback(storage)); serial = result.then(() => {}, () => {}); return result; },
    sql: { exec: (sql: string, ...params: any[]) => { const statement = db.prepare(sql); const rows = statement.columns().length ? statement.all(...params) : (statement.run(...params), []); return { toArray: () => rows }; } },
  };
  const ctx: any = { storage, blockConcurrencyWhile: (callback: () => Promise<void>) => { ready = callback(); return ready; } };
  return { ctx, map, db, ready: () => ready };
}
async function project() {
  const state = context(); const pilot = { register: vi.fn(async () => ({ ok: true })), acquire: vi.fn(async () => ({ ok: true })), release: vi.fn(async () => {}), unregister: vi.fn(async () => {}), consumeUsage: vi.fn(async () => ({ ok: true })), usageStatus: vi.fn(async () => ({ day: '2026-09-23', used: { jobs: 0, requests: 0, emails: 0 }, limits: { jobs: 30, requests: 25000, emails: 50 }, storageBytes: 0, storageLimitBytes: 104857600 })) };
  const env: any = { PROJECT_SECRETS_KEY: btoa('k'.repeat(32)), RUNTIME_DOMAIN: 'apps.example.com', PILOT: { getByName: () => pilot }, Sandbox: {}, ARTIFACTS: { put: vi.fn(async () => {}) }, CF_ACCOUNT_ID: 'account', CF_API_TOKEN: 'platform-only', BROWSER: {} };
  const object = new ProjectRuntime(state.ctx, env); await state.ready(); await object.initialize({ projectId: 'project', ownerId: 'owner' }, 'a'.repeat(32));
  const call = (path: string, method = 'GET', body?: unknown, environment = 'development') => object.control(new Request(`https://control${path}?environment=${environment}`, { method, body: body === undefined ? undefined : JSON.stringify(body) }));
  return { ...state, object, env, pilot, call };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
async function storageProject() {
  const p = await project(); const owner = context(); const usage = new PilotCoordinator(owner.ctx, {} as any);
  await p.ctx.storage.put('active:production', { id: 'storage-app', scriptName: 'storage-app' });
  const objects = new Map<string, Uint8Array>();
  p.env.PILOT.getByName = (name: string) => name.startsWith('usage:') ? usage : p.pilot;
  p.env.ARTIFACTS = {
    put: vi.fn(async (key: string, bytes: Uint8Array) => { objects.set(key, bytes.slice()); return { key, size: bytes.length }; }),
    get: vi.fn(async (key: string) => { const bytes = objects.get(key); return bytes ? { size: bytes.length, body: new Response(bytes).body } : null; }),
    head: vi.fn(async (key: string) => { const bytes = objects.get(key); return bytes ? { size: bytes.length } : null; }),
    delete: vi.fn(async (key: string | string[]) => { for (const item of Array.isArray(key) ? key : [key]) objects.delete(item); }),
    list: vi.fn(async ({ prefix }: { prefix: string }) => ({ objects: [...objects.keys()].filter(key => key.startsWith(prefix)).map(key => ({ key })) })),
  };
  const sessions = new Map<string, string>();
  const callFile = async (path: string, method = 'GET', body?: BodyInit, user = 'alice', environment = 'production', extraHeaders: Record<string, string> = {}) => {
    const key = `${environment}:${user}`;
    if (!sessions.has(key)) sessions.set(key, await (p.object as any).createSession('app', environment, { id: user }, 600));
    let cookie = user ? `__Host-bh_app=${sessions.get(key)}` : '';
    if (environment === 'development') cookie += `; __Host-bh_preview=${await (p.object as any).createSession('preview', environment, {}, 600)}`;
    return p.object.appRequest(new Request('https://app.example' + path, { method, headers: { Origin: 'https://app.example', Cookie: cookie, 'Content-Type': 'text/plain', 'X-File-Name': 'notes.txt', ...extraHeaders }, body }), environment as any);
  };
  return { ...p, usage, objects, callFile };
}
async function builtProject(kind = 'preview') {
  const p = await project();
  const job = { id: 'pending-job', kind, status: 'running', revision: 'revision', environment: 'development', createdAt: Date.now(), leaseUntil: Date.now() + 45_000, artifactKey: 'artifact', sourceKey: 'source', step: 5, sandboxId: 'box', processIds: [] };
  await p.ctx.storage.put('current', job);
  p.env.ARTIFACTS.get = async (key: string) => ({ json: async () => key === 'source' ? { files: {}, revision: 'revision' } : { worker: 'export default {}', assets: { '/index.html': { content: btoa('app'), type: 'text/html' } } } });
  vi.spyOn(CloudflareAPI.prototype, 'query').mockResolvedValue([]);
  const remove = vi.spyOn(CloudflareAPI.prototype, 'remove').mockResolvedValue(undefined);
  const upload = vi.spyOn(CloudflareAPI.prototype, 'upload').mockResolvedValue({});
  return { ...p, job, remove, upload };
}

describe('Hosting slot admission', () => {
  it('releases an unused legacy reservation without deleting project state', async () => {
    const p = await project();
    await p.ctx.storage.put('integration:development:custom', { preserved: true });
    expect((await p.call('/status')).status).toBe(200);
    expect(p.pilot.register).not.toHaveBeenCalled();
    expect(p.pilot.unregister).toHaveBeenCalledOnce();
    expect(p.map.get('integration:development:custom')).toEqual({ preserved: true });
    expect(p.map.has('deleted')).toBe(false);
  });
  it.each(['job:old', 'release:development:old', 'release:production:old', 'db:development', 'db:production', 'current', 'active:production'])('retains reservations with %s', async key => {
    const p = await project();
    await p.ctx.storage.put(key, { id: 'existing', createdAt: 1 });
    expect((await p.call('/status')).status).toBe(200);
    expect(p.pilot.unregister).not.toHaveBeenCalled();
  });
  it('recovers hosting capacity after installation failure while preserving source and diagnostics', async () => {
    const p = await project();
    const job = { id: 'install', kind: 'preview', status: 'failed', step: 1, finishedAt: 2, createdAt: 1, sourceKey: 'saved-source' };
    await p.ctx.storage.put({ current: job, 'job:install': job });
    p.db.prepare('INSERT INTO logs(job,text,created) VALUES (?,?,?)').run('install', 'Installation failed', 1);
    expect((await p.call('/status')).status).toBe(200);
    expect(p.pilot.unregister).toHaveBeenCalledOnce();
    expect(p.map.get('job:install')).toEqual(job);
    expect(p.db.prepare('SELECT text FROM logs').get()?.text).toBe('Installation failed');
  });
  it.each([
    { status: 'stopping' }, { status: 'running' }, { kind: 'publish' },
    { step: 2 }, { artifactKey: 'artifact' }, { previewReady: true }, { finishedAt: undefined },
  ])('retains capacity when an attempted job may still have resources: %j', async override => {
    const p = await project();
    const job = { id: 'attempt', kind: 'preview', status: 'failed', step: 1, finishedAt: 2, createdAt: 1, ...override };
    await p.ctx.storage.put({ current: job, 'job:attempt': job });
    await p.call('/status');
    expect(p.pilot.unregister).not.toHaveBeenCalled();
  });
  it('enforces the project limit before acquiring a sandbox or saving a job', async () => {
    const p = await project();
    p.pilot.register.mockResolvedValue({ ok: false, status: 429, error: 'Hosted project limit' } as any);
    const response = await p.call('/jobs', 'POST', { kind: 'build', files: { 'package.json': JSON.stringify({ brainhalf: { runtime: 'workers' }, scripts: { build: 'build' } }), 'src/App.tsx': 'source' } });
    expect(response.status).toBe(429);
    expect(p.pilot.acquire).not.toHaveBeenCalled();
    expect(p.map.has('current')).toBe(false);
  });
  it('retains an explicitly opened managed preview and its authentication ticket', async () => {
    const p = await project();
    expect((await p.call('/preview-ticket', 'POST')).status).toBe(200);
    expect(p.pilot.register).toHaveBeenCalledOnce();
    expect((await p.call('/status')).status).toBe(200);
    expect(p.pilot.unregister).not.toHaveBeenCalled();
  });
  it('finishes reservation recovery before admitting a concurrent job', async () => {
    const p = await project(); const entered = deferred<void>(); const release = deferred<void>();
    const order: string[] = [];
    p.pilot.unregister.mockImplementationOnce(async () => { entered.resolve(); await release.promise; order.push('released'); });
    p.pilot.register.mockImplementationOnce(async () => { order.push('registered'); return { ok: true }; });
    const reading = p.call('/status'); await entered.promise;
    const starting = p.call('/jobs', 'POST', { kind: 'build', files: { 'package.json': JSON.stringify({ brainhalf: { runtime: 'workers' }, scripts: { build: 'build' } }), 'src/App.tsx': 'source' } });
    release.resolve();
    expect((await reading).status).toBe(200); expect((await starting).status).toBe(202);
    expect(order).toEqual(['released', 'registered']); expect(p.map.has('current')).toBe(true);
  });
});
describe('Project runtime with real SQLite state', () => {
  it('returns logs and verification failures only for the requested publishing job', async () => {
    const p = await project();
    p.db.prepare('INSERT INTO logs(job,text,created) VALUES (?,?,?)').run('failed-job', 'Build failed: missing module', 1);
    for (let index = 0; index < 65; index++) p.db.prepare('INSERT INTO logs(job,text,created) VALUES (?,?,?)').run('other-job', 'Unrelated output', index + 2);
    const report = { jobId: 'failed-job', passed: false, checks: [{ name: 'Persisted record', passed: false, detail: 'Expected one row' }] };
    await p.ctx.storage.put('verification:development', report);
    const read = (id: string) => p.object.control(new Request(`https://control/logs?environment=production&job=${id}`));
    expect(await (await read('failed-job')).json()).toMatchObject({ logs: [{ job: 'failed-job', text: 'Build failed: missing module' }], verification: report });
    const other = await (await read('other-job')).json() as { logs: unknown[]; verification: unknown };
    expect(other.logs).toHaveLength(60); expect(other.verification).toBeNull();
  });
  it('keeps empty request bodies invalid for JSON endpoints by default', async () => {
    for (const body of [undefined, '']) {
      await expect(readJson(new Request('https://control/options', { method: 'POST', body }))).rejects.toMatchObject({ status: 400 });
    }
  });
  it.each(['absent', 'empty', 'stream', 'object'])('stops a job when the optional request body is %s', async kind => {
    const p = await builtProject();
    // Fetch/RPC can expose a bodyless POST as a non-null, zero-byte stream.
    const body = kind === 'absent' ? undefined : kind === 'stream'
      ? new ReadableStream<Uint8Array>({ start(controller) { controller.close(); } })
      : kind === 'object' ? '{}' : '';
    const init = { method: 'POST', body, duplex: 'half' };
    const response = await p.object.control(new Request('https://control/stop', init));
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(p.map.get('current').status).toBe('stopped');
    expect(sandbox.destroy).toHaveBeenCalledOnce();
  });

  it.each(['{', 'null', '[]', 'false', '42', '"text"', '{"expectedJobId":42}', '{"expectedJobId":"' + 'x'.repeat(129) + '"}'])('rejects an invalid stop body without stopping the job: %s', async body => {
    const p = await builtProject();
    const response = await p.object.control(new Request('https://control/stop', { method: 'POST', body }));
    expect(response.status).toBe(400);
    expect(p.map.get('current').status).toBe('running');
    expect(sandbox.destroy).not.toHaveBeenCalled();
  });

  it('enforces the stop body limit even when content-length understates the stream', async () => {
    const p = await builtProject();
    const body = JSON.stringify({ expectedJobId: p.job.id, padding: 'x'.repeat(256) });
    const response = await p.object.control(new Request('https://control/stop', { method: 'POST', headers: { 'Content-Length': '0' }, body }));
    expect(response.status).toBe(413);
    expect(p.map.get('current').status).toBe('running');
    expect(sandbox.destroy).not.toHaveBeenCalled();
  });

  it.each(['script', 'stylesheet', 'api', 'external-script', 'analytics'])('handles failed %s requests during static publication', async resource => {
    const p = await builtProject('publish');
    const job = { ...p.job, static: true, environment: 'production' };
    await p.ctx.storage.put('current', job);
    vi.spyOn(CloudflareAPI.prototype, 'createDatabase').mockResolvedValue({ uuid: 'test-db', name: 'test' });
    const listeners = new Map<string, (request: any) => void>();
    const page = {
      on: (event: string, listener: (request: any) => void) => listeners.set(event, listener),
      goto: async () => {
        listeners.get('requestfailed')!({ resourceType: () => resource === 'api' ? 'fetch' : resource === 'stylesheet' ? 'stylesheet' : 'script', url: () => resource === 'analytics' ? 'https://static.cloudflareinsights.com/beacon.min.js/version' : resource === 'external-script' ? 'https://cdn.example/required.js' : resource === 'api' ? 'https://app.example/api/missing' : 'https://app.example/assets/missing' });
        return { ok: () => true, status: () => 200 };
      },
      screenshot: async () => new Uint8Array([1]),
    };
    const browser = { sessionId: () => 'browser', newContext: async () => ({ addCookies: async () => {}, newPage: async () => page }), close: vi.fn(async () => {}) };
    vi.mocked(launch).mockResolvedValue(browser as any);
    const verification = (p.object as any).verify(job, { files: {}, revision: job.revision });
    if (resource === 'analytics') await verification;
    else await expect(verification).rejects.toThrow('Verification failed');
    expect(p.map.get('verification:development')).toMatchObject({ passed: resource === 'analytics', checks: expect.arrayContaining([expect.objectContaining({ name: 'Frontend resources', passed: resource === 'analytics' })]) });
    expect(browser.close).toHaveBeenCalledOnce();
    expect(p.remove).toHaveBeenCalledWith('/d1/database/test-db');
  });

  it('a development preview refresh cannot stop a different runtime job', async () => {
    const p = await builtProject();
    const result = await p.call('/stop', 'POST', { expectedJobId: 'an-older-preview' });
    expect(result.status).toBe(409);
    expect(p.map.get('current').status).toBe('running');
    expect(sandbox.destroy).not.toHaveBeenCalled();
    const stopped = await p.call('/stop', 'POST', { expectedJobId: p.job.id });
    expect(stopped.status).toBe(200);
    expect(p.map.get('current').status).toBe('stopped');
    expect(p.map.get('current').previewReady).toBe(false);
  });

  it('requires explicit confirmation and matching schema for project-scoped database recovery', async () => {
    const p = await project(); await p.ctx.storage.put('db:development', { id: 'own-database', name: 'app', createdAt: 1 });
    const bookmark = 'a'.repeat(32); const previous = 'b'.repeat(32);
    const api = vi.spyOn(CloudflareAPI.prototype, 'request').mockImplementation(async (path: string) => path.includes('/restore?') ? { bookmark, previous_bookmark: previous } : { bookmark });
    const response = await p.call('/database/recovery', 'POST', { label: 'Before edit' }); expect(response.status).toBe(201);
    const { point } = await response.json() as any;
    expect((await p.call('/database/restore', 'POST', { id: point.id })).status).toBe(400);
    expect(api.mock.calls.filter(([path]) => path.includes('/restore?'))).toHaveLength(0);
    await p.ctx.storage.put('migrations:development', [{ name: 'changed.sql' }]);
    expect((await p.call('/database/restore', 'POST', { id: point.id, confirm: 'RESTORE development' })).status).toBe(409);
    await p.ctx.storage.put('migrations:development', []);
    const restored = await p.call('/database/restore', 'POST', { id: point.id, confirm: 'RESTORE development' }); expect(restored.status).toBe(200);
    const { undoId } = await restored.json() as any; expect((await p.ctx.storage.get('db-recovery:development:' + undoId)).bookmark).toBe(previous);
    expect(api.mock.calls.every(([path]) => path.startsWith('/d1/database/own-database/'))).toBe(true);
    expect((await p.call('/database/recovery', 'GET', undefined, 'production')).status).toBe(404);
  });
  it('blocks app writes during database restoration and releases the maintenance lock on failure', async () => {
    const p = await project(); await p.ctx.storage.put('db:production', { id: 'own-db', name: 'app', createdAt: 1 });
    const deferredBookmark = deferred<any>(); vi.spyOn(CloudflareAPI.prototype, 'request').mockReturnValue(deferredBookmark.promise);
    const saving = p.call('/database/recovery', 'POST', {}, 'production');
    await vi.waitFor(() => expect((p.object as any).databaseOperation).toBeTruthy());
    expect((await p.object.appRequest(new Request('https://app.test/api/items'), 'production')).status).toBe(503);
    deferredBookmark.resolve({ bookmark: 'invalid' }); expect((await saving).status).toBe(502);
    expect((p.object as any).databaseOperation).toBeUndefined();
  });
  it('records sanitized app request outcomes and separates monitoring environments', async () => {
    const p = await project();
    await p.object.appRequest(new Request('https://app.test/api/private/person@example.com?token=private'), 'production');
    const production = await (await p.call('/monitor', 'GET', undefined, 'production')).json() as any;
    expect(production.recent).toHaveLength(1); expect(production.recent[0].route).toBe('/api/*');
    expect(JSON.stringify(production)).not.toContain('person@example.com'); expect(JSON.stringify(production)).not.toContain('token=');
    expect((await (await p.call('/monitor')).json() as any).recent).toHaveLength(0);
  });
  it('runs declared checks through managed identity and the disposable release, independently of page JavaScript', async () => {
    const p = await project();
    const data = new DatabaseSync(':memory:'); databases.push(data);
    data.exec('CREATE TABLE items(id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT NOT NULL)');
    const job = { id: 'declared-checks', kind: 'verify', status: 'running', revision: 'checked-revision', environment: 'development', createdAt: Date.now(), leaseUntil: Date.now() + 45_000, artifactKey: 'artifact' };
    await p.ctx.storage.put('current', job);
    p.env.DISPATCH_NAMESPACE = 'projects';
    const dispatched: string[] = [];
    p.env.DISPATCHER = { get: (name: string) => ({ fetch: async (request: Request) => {
      dispatched.push(name);
      expect(request.headers.get('cookie')).toBeNull(); expect(request.headers.get('authorization')).toBeNull();
      const user = request.headers.get('x-bh-user-id');
      if (!user) return Response.json({ error: 'Sign in' }, { status: 401 });
      const url = new URL(request.url);
      if (request.method === 'POST') {
        const body = await request.json() as { title: string };
        data.prepare('INSERT INTO items VALUES (?,?,?)').run('saved-item', user, body.title);
        return Response.json({ item: { id: 'saved-item' } }, { status: 201 });
      }
      if (request.method === 'DELETE') {
        const result = data.prepare('DELETE FROM items WHERE id=? AND user_id=?').run(url.pathname.split('/').pop()!, user);
        return Response.json({}, { status: result.changes ? 200 : 404 });
      }
      return Response.json({ items: data.prepare('SELECT id,title FROM items WHERE user_id=?').all(user) });
    } }) };
    p.env.ARTIFACTS.get = async () => ({ json: async () => ({ worker: 'export default {}', assets: { '/index.html': { content: btoa('app'), type: 'text/html' } } }) });
    vi.spyOn(CloudflareAPI.prototype, 'createDatabase').mockResolvedValue({ uuid: 'disposable-db', name: 'test' });
    vi.spyOn(CloudflareAPI.prototype, 'upload').mockResolvedValue({});
    const remove = vi.spyOn(CloudflareAPI.prototype, 'remove').mockResolvedValue(undefined);
    vi.spyOn(CloudflareAPI.prototype, 'query').mockImplementation(async (id, sql, params = []) => {
      expect(id).toBe('disposable-db');
      if (sql.includes('_bh_migrations')) return [];
      return data.prepare(sql).all(...params as (string | number | null)[]);
    });
    const page = { on: vi.fn(), goto: async () => ({ ok: () => true, status: () => 200 }), evaluate: vi.fn(() => { throw new Error('Page JavaScript must not decide API assertions'); }), screenshot: async () => new Uint8Array([1]) };
    const browser = { sessionId: () => 'browser', newContext: async () => ({ addCookies: async () => {}, newPage: async () => page }), close: vi.fn(async () => {}) };
    vi.mocked(launch).mockResolvedValue(browser as any);
    await (p.object as any).verify(job, { files: { 'brainhalf.verify.json': JSON.stringify(STARTER_VERIFICATION) }, revision: job.revision });
    const report = p.map.get('verification:development');
    expect(report.passed).toBe(true); expect(report.checks).toHaveLength(STARTER_VERIFICATION.steps.length + 3);
    expect(page.evaluate).not.toHaveBeenCalled();
    expect(new Set(dispatched)).toEqual(new Set(['bh-test-declared-checks']));
    expect(data.prepare('SELECT COUNT(*) AS count FROM items').get()).toMatchObject({ count: 0 });
    expect(remove).toHaveBeenCalledWith('/d1/database/disposable-db');
    expect(p.map.has('db:production')).toBe(false); expect(p.map.has('db:development')).toBe(false);
  });
  it('terminates a reconnected browser explicitly and keeps its slot until the provider confirms closure', async () => {
    const p = await builtProject();
    await p.ctx.storage.put('browser', 'remote-browser');
    const send = vi.fn(async () => {});
    vi.mocked(connect).mockResolvedValue({ newBrowserCDPSession: async () => ({ send }), close: vi.fn(async () => {}) } as any);
    vi.mocked(sessions).mockResolvedValueOnce([{ sessionId: 'remote-browser', startTime: 1 }]).mockResolvedValueOnce([]);
    await expect(p.object.stop()).rejects.toThrow('Browser termination is still pending');
    expect(send).toHaveBeenCalledWith('Browser.close'); expect(p.pilot.release).not.toHaveBeenCalled();
    await p.object.stop();
    expect(p.map.has('browser')).toBe(false); expect(p.map.get('current').status).toBe('stopped');
  });
  it('recovers cleanup when a saved browser session has already expired', async () => {
    const p = await builtProject(); await p.ctx.storage.put('browser', 'expired-browser');
    vi.mocked(connect).mockRejectedValue(new Error('Session not found'));
    vi.mocked(sessions).mockResolvedValue([]);
    await p.object.stop();
    expect(p.map.has('browser')).toBe(false); expect(p.pilot.release).toHaveBeenCalled();
    expect(p.map.get('current').status).toBe('stopped');
  });
  it('rejects rollback after standalone migrations change the database schema', async () => {
    const p = await project();
    const release = { id: 'old', migrations: [{ name: '0001', checksum: 'first', appliedAt: 1 }] };
    await p.ctx.storage.put({ 'release:development:old': release, 'active:development': release, 'migrations:development': [...release.migrations, { name: '0002', checksum: 'second', appliedAt: 2 }] });
    const response = await p.call('/rollback', 'POST', { releaseId: 'old' });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('different database schema') });
  });
  it('waits for pending database provisioning before acknowledging stop and never deploys afterward', async () => {
    const p = await builtProject(); const creation = deferred<{ uuid: string; name: string }>();
    const create = vi.spyOn(CloudflareAPI.prototype, 'createDatabase').mockReturnValue(creation.promise);
    const advance = p.object.alarm();
    await vi.waitFor(() => expect(create).toHaveBeenCalledOnce());
    let stopped = false;
    const stop = p.object.stop().then(() => { stopped = true; });
    await vi.waitFor(() => expect(p.map.get('current').status).toBe('stopping'));
    expect(stopped).toBe(false); expect(p.pilot.release).not.toHaveBeenCalled();
    creation.resolve({ uuid: 'dev-db', name: 'development' });
    await Promise.all([advance, stop]);
    expect(p.map.get('current').status).toBe('stopped');
    expect(p.map.get('db:development').id).toBe('dev-db');
    expect(p.upload).not.toHaveBeenCalled();
    expect(CloudflareAPI.prototype.query).not.toHaveBeenCalled();
  });
  it('cleans a pending upload after stop without activating the release', async () => {
    const p = await builtProject(); const uploading = deferred<unknown>();
    vi.spyOn(CloudflareAPI.prototype, 'createDatabase').mockResolvedValue({ uuid: 'dev-db', name: 'development' });
    p.upload.mockReturnValue(uploading.promise);
    const advance = p.object.alarm();
    await vi.waitFor(() => expect(p.upload).toHaveBeenCalledOnce());
    expect(p.map.has('pending-release:pending-job')).toBe(true);
    const stop = p.object.stop();
    await vi.waitFor(() => expect(p.map.get('current').status).toBe('stopping'));
    expect(p.remove).not.toHaveBeenCalled();
    uploading.resolve({}); await Promise.all([advance, stop]);
    expect(p.remove).toHaveBeenCalledWith(expect.stringContaining('/scripts/bh-'));
    expect(p.map.has('active:development')).toBe(false);
    expect(p.map.has('pending-release:pending-job')).toBe(false);
    expect(p.map.get('current').status).toBe('stopped');
  });
  it('closes a browser whose launch completes after stop was requested', async () => {
    const p = await builtProject('verify'); const launching = deferred<any>();
    vi.spyOn(CloudflareAPI.prototype, 'createDatabase').mockResolvedValue({ uuid: 'test-db', name: 'test' });
    vi.mocked(launch).mockReturnValue(launching.promise);
    const advance = p.object.alarm();
    await vi.waitFor(() => expect(launch).toHaveBeenCalledOnce());
    const stop = p.object.stop();
    await vi.waitFor(() => expect(p.map.get('current').status).toBe('stopping'));
    const browser = { sessionId: () => 'late-browser', close: vi.fn(async () => {}), newContext: vi.fn() };
    launching.resolve(browser); await Promise.all([advance, stop]);
    expect(browser.close).toHaveBeenCalledOnce(); expect(browser.newContext).not.toHaveBeenCalled();
    expect(p.map.has('verification:development')).toBe(false);
    expect(p.map.has('test:pending-job')).toBe(false);
    expect(p.remove).toHaveBeenCalledWith('/d1/database/test-db');
    expect(p.map.get('current').status).toBe('stopped');
  });
  it('preserves fresh heartbeat leases across stale alarm writes and prevents stopped-job resurrection', async () => {
    const p = await builtProject();
    await p.ctx.storage.put('current', { ...p.job, leaseUntil: 1 });
    const stale = structuredClone(p.map.get('current'));
    await p.call('/heartbeat', 'POST');
    const renewed = p.map.get('current').leaseUntil;
    await (p.object as any).saveJob({ ...stale, message: 'New phase', step: 6 });
    expect(p.map.get('current').leaseUntil).toBe(renewed);
    await p.object.stop();
    await expect((p.object as any).saveJob(stale)).rejects.toThrow('Job stopped');
    await p.call('/heartbeat', 'POST');
    expect(p.map.get('current').status).toBe('stopped');
  });
  it.each([true, false])('verifies real database persistence instead of trusting API success (persisted=%s)', async persisted => {
    const p = await project(); const job = { id: 'verify-job', kind: 'verify', status: 'running', revision: 'revision', environment: 'development', createdAt: Date.now(), leaseUntil: Date.now() + 45_000, artifactKey: 'artifact' };
    await p.ctx.storage.put('current', job);
    p.env.ARTIFACTS.get = async () => ({ json: async () => ({ worker: 'export default {}', assets: { '/index.html': { content: btoa('app'), type: 'text/html' } } }) });
    vi.spyOn(CloudflareAPI.prototype, 'createDatabase').mockResolvedValue({ uuid: 'test-db', name: 'test' });
    vi.spyOn(CloudflareAPI.prototype, 'upload').mockResolvedValue({});
    vi.spyOn(CloudflareAPI.prototype, 'remove').mockResolvedValue(undefined);
    let reads = 0;
    vi.spyOn(CloudflareAPI.prototype, 'query').mockImplementation(async (_id, sql) => sql.startsWith('SELECT id FROM items') && ++reads === 1 && persisted ? [{ id: 'item' }] : []);
    const evaluate = vi.fn().mockResolvedValueOnce({ itemId: 'item', checks: [{ name: 'API create and read', passed: true, detail: 'API reports success' }] }).mockResolvedValueOnce(true);
    const page = { on: vi.fn(), goto: async () => ({ ok: () => true, status: () => 200 }), evaluate, screenshot: async () => new Uint8Array([1]) };
    const browser = { sessionId: () => 'browser', newContext: async () => ({ addCookies: async () => {}, newPage: async () => page }), close: vi.fn(async () => {}) };
    vi.mocked(launch).mockResolvedValue(browser as any);
    const result = (p.object as any).verify(job, { revision: 'revision', files: {} });
    if (persisted) await result; else await expect(result).rejects.toThrow('Verification failed');
    const report = p.map.get('verification:development');
    expect(report.passed).toBe(persisted);
    expect(report.checks.find((check: any) => check.name === 'D1 persistence and deletion').passed).toBe(persisted);
    expect(browser.close).toHaveBeenCalledOnce();
    expect(p.map.has('test:verify-job')).toBe(false);
  });
  it('advances durable build phases and stores the artifact against the exact source revision', async () => {
    const p = await project(); const objects = new Map<string, string>();
    p.env.ARTIFACTS = { put: async (key: string, value: string) => objects.set(key, value), get: async (key: string) => objects.has(key) ? { json: async () => JSON.parse(objects.get(key)!) } : null };
    const process = { id: 'process', status: async () => ({ state: 'exited' }), output: async () => ({ exitCode: 0, stdout: 'Build passed', stderr: '' }), kill: vi.fn() };
    sandbox.exec.mockResolvedValue(process); sandbox.getProcess.mockResolvedValue(process);
    sandbox.readFile.mockImplementation(async () => ({ content: new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(JSON.stringify({ worker: 'export default {}', assets: { '/index.html': { content: btoa('<h1>App</h1>'), type: 'text/html' } } }))); controller.close(); } }) }));
    const response = await p.call('/jobs', 'POST', { kind: 'build', files: { 'package.json': JSON.stringify({ brainhalf: { runtime: 'workers' }, scripts: { build: 'build', test: 'test' } }), 'src/App.tsx': 'source' } });
    expect(response.status).toBe(202);
    const { job } = await response.json() as { job: { revision: string } };
    for (let i = 0; i < 6; i++) await p.object.alarm();
    expect(p.map.get('current')).toMatchObject({ status: 'passed', revision: job.revision });
    expect(sandbox.exec.mock.calls.map(call => call[0].slice(0, 2))).toEqual([['npm', 'install'], ['npm', 'run'], ['npm', 'test'], ['node', '-e']]);
    expect([...objects.keys()].some(key => key.includes('/artifacts/'))).toBe(true);
    expect(sandbox.exec.mock.calls.every(call => !JSON.stringify(call).includes('platform-only'))).toBe(true);
  });
  it('encrypts per-environment credentials and returns only public connection fields', async () => {
    const p = await project();
    const saved = await p.call('/integrations/resend', 'PUT', { apiKey: 're_private_key', from: 'sender@example.com', contactTo: 'owner@example.com' });
    expect(saved.status).toBe(200); expect(await saved.text()).not.toContain('re_private_key');
    expect(JSON.stringify([...p.map])).not.toContain('re_private_key');
    expect((await p.object.status('development')).integrations[0].configured).toBe(true);
    expect((await p.object.status('production')).integrations[0].configured).toBe(false);
    await p.call('/integrations/resend', 'DELETE');
    expect((await p.object.status('development')).integrations[0].configured).toBe(false);
    await expect(p.object.initialize({ projectId: 'project', ownerId: 'intruder' }, 'a'.repeat(32))).rejects.toThrow('ownership');
  });
  it('uses single-use preview tickets and host cookies, captures contact requests, and rejects cross-origin writes', async () => {
    const p = await project(); const ticket = await (await p.call('/preview-ticket', 'POST')).json() as { url: string };
    const response = await p.object.appRequest(new Request(ticket.url), 'development');
    expect(response.status).toBe(303); const cookie = response.headers.get('Set-Cookie')!.split(';')[0];
    expect(response.headers.get('Set-Cookie')).toContain('HttpOnly');
    expect((await p.object.appRequest(new Request(ticket.url), 'development')).status).toBe(401);
    const request = (origin: string) => new Request('https://dev-' + 'a'.repeat(32) + '.apps.example.com/api/contact', { method: 'POST', headers: { cookie, Origin: origin }, body: JSON.stringify({ name: 'Alice', email: 'alice@example.com', message: 'A real test form submission' }) });
    expect((await p.object.appRequest(request('https://evil.example'), 'development')).status).toBe(403);
    const captured = await p.object.appRequest(request('https://dev-' + 'a'.repeat(32) + '.apps.example.com'), 'development');
    expect(captured.status).toBe(201); expect(await captured.json()).toMatchObject({ status: 'captured' });
    expect(await (await p.call('/inbox')).json()).toMatchObject({ messages: [{ email: 'alice@example.com', status: 'captured' }] });
    expect(await (await p.call('/inbox', 'GET', undefined, 'production')).json()).toEqual({ messages: [] });
  });
  it('terminates a disconnected job before releasing the pilot slot', async () => {
    const p = await project();
    await p.ctx.storage.put('current', { id: 'job', kind: 'build', status: 'running', leaseUntil: Date.now() - 1, sandboxId: 'box', createdAt: Date.now() });
    await p.object.alarm();
    expect(sandbox.destroy).toHaveBeenCalledOnce(); expect(p.pilot.release).toHaveBeenCalledWith('job');
    expect(p.map.get('current').status).toBe('stopped');
    expect(sandbox.destroy.mock.invocationCallOrder[0]).toBeLessThan(p.pilot.release.mock.invocationCallOrder[0]);
  });
  it('retains the stopping state and slot when container termination fails', async () => {
    const p = await project(); sandbox.destroy.mockRejectedValueOnce(new Error('temporary failure'));
    await p.ctx.storage.put('current', { id: 'job', kind: 'build', status: 'running', leaseUntil: Date.now() - 1, sandboxId: 'box', createdAt: Date.now() });
    await p.object.alarm();
    expect(p.map.get('current').status).toBe('stopping'); expect(p.pilot.release).not.toHaveBeenCalled();
    await p.object.alarm(); expect(p.map.get('current').status).toBe('stopped');
  });
  it('checks OAuth state against a browser cookie before making provider requests', async () => {
    const p = await project();
    await p.ctx.storage.put('active:production', { id: 'oauth-app', scriptName: 'oauth-app' });
    await p.call('/integrations/google', 'PUT', { clientId: 'test.apps.googleusercontent.com', clientSecret: 'GOCSPX_private' }, 'production');
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    const start = await p.object.appRequest(new Request('https://' + 'a'.repeat(32) + '.apps.example.com/api/auth/google/start'), 'production');
    const target = new URL(start.headers.get('Location')!);
    expect(target.origin).toBe('https://accounts.google.com'); expect(target.searchParams.get('code_challenge_method')).toBe('S256');
    const response = await p.object.appRequest(new Request('https://' + 'a'.repeat(32) + '.apps.example.com/api/auth/google/callback?state=' + target.searchParams.get('state') + '&code=test'), 'production');
    expect(response.status).toBe(400); expect(fetchMock).not.toHaveBeenCalled();
  });
  it('completes provider OAuth with a one-use state and stores only a hashed app session token', async () => {
    const p = await project();
    await p.ctx.storage.put('active:production', { id: 'oauth-app', scriptName: 'oauth-app' });
    await p.call('/integrations/google', 'PUT', { clientId: 'test.apps.googleusercontent.com', clientSecret: 'GOCSPX_private' }, 'production');
    const fetchMock = vi.fn(async (url: string) => url.includes('/token') ? Response.json({ access_token: 'google-access-token' }) : Response.json({ sub: 'subject', email: 'user@example.com', email_verified: true, name: 'User' })); vi.stubGlobal('fetch', fetchMock);
    const origin = 'https://' + 'a'.repeat(32) + '.apps.example.com';
    const start = await p.object.appRequest(new Request(origin + '/api/auth/google/start'), 'production');
    const state = new URL(start.headers.get('Location')!).searchParams.get('state');
    const callback = () => new Request(origin + '/api/auth/google/callback?state=' + state + '&code=test', { headers: { cookie: start.headers.get('Set-Cookie')!.split(';')[0] } });
    const response = await p.object.appRequest(callback(), 'production'); expect(response.status).toBe(303);
    const appCookie = response.headers.getSetCookie().find(value => value.startsWith('__Host-bh_app='))!.split(';')[0];
    const session = await p.object.appRequest(new Request(origin + '/api/auth/session', { headers: { cookie: appCookie } }), 'production');
    expect(await session.json()).toMatchObject({ user: { id: 'google:subject', email: 'user@example.com' } });
    expect(JSON.stringify(p.db.prepare('SELECT * FROM sessions').all())).not.toContain('google-access-token');
    expect((await p.object.appRequest(callback(), 'production')).status).toBe(400);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('deletion revokes app access and removes stored credentials', async () => {
    const p = await project();
    p.env.ARTIFACTS.list = async () => ({ objects: [] });
    await p.call('/integrations/resend', 'PUT', { apiKey: 're_private', from: 'from@example.com', contactTo: 'to@example.com' });
    expect((await p.call('/delete', 'POST')).status).toBe(200);
    expect(p.pilot.unregister).toHaveBeenCalledOnce(); expect(p.map.has('integration:development')).toBe(false);
    expect((await p.object.appRequest(new Request('https://app.example/api/health'), 'production')).status).toBe(404);
  });
  it('does not forward platform cookies or forged identity headers to generated code', async () => {
    const p = await project(); const raw = token();
    p.db.prepare('INSERT INTO sessions(token,kind,environment,data,expires) VALUES (?,?,?,?,?)').run(await digest(raw), 'app', 'production', JSON.stringify({ id: 'verified-user' }), Date.now() + 60000);
    await p.ctx.storage.put('active:production', { scriptName: 'release' });
    const dispatched = vi.fn(async () => Response.json({ ok: true }, { headers: { 'Set-Cookie': 'forged=1' } }));
    p.env.DISPATCHER = { get: () => ({ fetch: dispatched }) };
    const result = await p.object.appRequest(new Request('https://app.example/api/items', { headers: { Cookie: `__Host-bh_app=${raw}; bh_session=platform`, Authorization: 'Bearer platform', 'x-bh-user-id': 'forged' } }), 'production');
    const forwarded = dispatched.mock.calls[0][0] as Request;
    expect(forwarded.headers.get('cookie')).toBeNull(); expect(forwarded.headers.get('authorization')).toBeNull(); expect(forwarded.headers.get('x-bh-user-id')).toBe('verified-user'); expect(result.headers.get('Set-Cookie')).toBeNull();
  });
});
describe('Managed file storage', () => {
  it('persists files, isolates uploaders and environments, and releases account storage after deletion', async () => {
    const p = await storageProject();
    const response = await p.callFile('/api/storage', 'POST', 'private contents');
    expect(response.status, await response.clone().text()).toBe(201);
    const { file } = await response.json() as any;
    expect(p.objects.size).toBe(1); expect((await p.usage.usageStatus()).storageBytes).toBe(16);
    expect((await (await p.callFile('/api/storage')).json() as any).files).toHaveLength(1);
    expect((await (await p.callFile('/api/storage', 'GET', undefined, 'bob')).json() as any).files).toHaveLength(0);
    expect((await p.callFile(file.url, 'GET', undefined, 'bob')).status).toBe(404);
    expect((await p.callFile(file.url, 'GET', undefined, 'alice', 'development')).status).toBe(404);
    expect((await p.callFile(file.url, 'DELETE', undefined, 'bob')).status).toBe(404);
    const downloaded = await p.callFile(file.url);
    expect(await downloaded.text()).toBe('private contents');
    expect(downloaded.headers.get('Content-Disposition')).toContain('attachment');
    expect(downloaded.headers.get('Cache-Control')).toBe('private, no-store');
    expect((await p.callFile(file.url, 'DELETE')).status).toBe(200);
    expect(p.objects.size).toBe(0); expect((await p.usage.usageStatus()).storageBytes).toBe(0);
  });
  it('rejects anonymous uploads, empty bodies, oversized streams, and invalid names', async () => {
    const p = await storageProject();
    expect((await p.callFile('/api/storage', 'POST', 'data', '')).status).toBe(401);
    expect((await p.callFile('/api/storage', 'POST', '')).status).toBe(400);
    expect((await p.callFile('/api/storage', 'POST', 'data', 'alice', 'production', { 'X-File-Name': '..%2Fprivate.txt' })).status).toBe(400);
    expect((await p.callFile('/api/storage', 'POST', new Uint8Array(5_242_881))).status).toBe(413);
    expect(p.objects.size).toBe(0); expect((await p.usage.usageStatus()).storageBytes).toBe(0);
  });
  it('does not report successful storage if the object store fails', async () => {
    const p = await storageProject(); p.env.ARTIFACTS.put.mockRejectedValue(new Error('Store unavailable'));
    expect((await p.callFile('/api/storage', 'POST', 'data')).status).toBe(503);
    expect((await p.usage.usageStatus()).storageBytes).toBe(0);
    expect(p.db.prepare('SELECT COUNT(*) AS count FROM uploads').get()).toMatchObject({ count: 0 });
  });
  it('keeps quota reserved until failed deletion is retried successfully', async () => {
    const p = await storageProject();
    const { file } = await (await p.callFile('/api/storage', 'POST', 'data')).json() as any;
    p.env.ARTIFACTS.delete.mockRejectedValueOnce(new Error('Retry later'));
    expect((await p.callFile(file.url, 'DELETE')).status).toBe(503);
    expect((await p.usage.usageStatus()).storageBytes).toBe(4);
    expect((await p.callFile(file.url, 'DELETE')).status).toBe(200);
    expect((await p.usage.usageStatus()).storageBytes).toBe(0);
  });
  it('waits for an in-flight upload before acknowledging project deletion and leaves no object or quota behind', async () => {
    const p = await storageProject(); const put = deferred<unknown>();
    p.env.ARTIFACTS.put.mockImplementation(async (key: string, bytes: Uint8Array) => { await put.promise; p.objects.set(key, bytes); return { key }; });
    const upload = p.callFile('/api/storage', 'POST', 'data');
    await vi.waitFor(() => expect(p.env.ARTIFACTS.put).toHaveBeenCalledOnce());
    let acknowledged = false;
    const deleting = p.call('/delete', 'POST').then(response => { acknowledged = true; return response; });
    await vi.waitFor(() => expect(p.map.get('deleted')).toBe(true)); expect(acknowledged).toBe(false);
    put.resolve({});
    expect((await upload).status).toBe(410); expect((await deleting).status).toBe(200);
    expect(p.objects.size).toBe(0); expect((await p.usage.usageStatus()).storageBytes).toBe(0);
  });
  it('allows project owners to manage files without opening the app user session', async () => {
    const p = await storageProject();
    const { file } = await (await p.callFile('/api/storage', 'POST', 'data')).json() as any;
    expect((await (await p.call('/uploads', 'GET', undefined, 'production')).json() as any).files).toHaveLength(1);
    expect((await p.call('/uploads/' + file.id, 'DELETE', undefined, 'development')).status).toBe(404);
    expect((await p.call('/uploads/' + file.id, 'DELETE', undefined, 'production')).status).toBe(200);
  });
});

describe('Durable pilot quotas', () => {
  it('counts a retried job once and preserves account usage across object recreation', async () => {
    const c = context(); const first = new PilotCoordinator(c.ctx, {} as any);
    await Promise.all(Array.from({ length: 5 }, () => first.consumeUsage('jobs', 'same-job')));
    const restarted = new PilotCoordinator(c.ctx, {} as any);
    expect((await restarted.usageStatus()).used.jobs).toBe(1);
    const another = context();
    expect((await new PilotCoordinator(another.ctx, {} as any).usageStatus()).used.jobs).toBe(0);
  });
  it('enforces account limits under concurrent requests and resets the next UTC day', async () => {
    const c = context(); const usage = new PilotCoordinator(c.ctx, {} as any);
    const day = new Date().toISOString().slice(0, 10);
    c.map.set('owner:daily', { day, used: { jobs: 0, requests: OWNER_RUNTIME_LIMITS.requests - 1, emails: 0 }, jobs: [] });
    const admitted = await Promise.all([usage.consumeUsage('requests'), usage.consumeUsage('requests')]);
    expect(admitted.filter(result => result.ok)).toHaveLength(1);
    expect(admitted.find(result => !result.ok)).toMatchObject({ status: 429 });
    c.map.set('owner:daily', { day: '2000-01-01', used: { jobs: 30, requests: 25000, emails: 50 }, jobs: [] });
    expect(await usage.consumeUsage('requests')).toEqual({ ok: true });
    expect((await usage.usageStatus()).used.requests).toBe(1);
  });
  it('reserves storage atomically, rejects changed retries, and releases it idempotently', async () => {
    const c = context(); const usage = new PilotCoordinator(c.ctx, {} as any);
    const admitted = await Promise.all([usage.reserveStorage('project-a:file', OWNER_RUNTIME_LIMITS.storageBytes), usage.reserveStorage('project-b:file', 1)]);
    expect(admitted.filter(result => result.ok)).toHaveLength(1);
    expect(await usage.reserveStorage('project-a:file', OWNER_RUNTIME_LIMITS.storageBytes)).toEqual({ ok: true });
    expect(await usage.reserveStorage('project-a:file', 1)).toMatchObject({ status: 409 });
    await usage.releaseStorage('project-a:file'); await usage.releaseStorage('project-a:file');
    expect((await usage.usageStatus()).storageBytes).toBe(0);
    expect(await usage.reserveStorage('project-b:file', 10)).toEqual({ ok: true });
  });
  it('blocks exhausted account requests before dispatching generated code', async () => {
    const p = await project();
    await p.ctx.storage.put('active:production', { id: 'quota-app', scriptName: 'quota-app' });
    p.pilot.consumeUsage.mockResolvedValue({ ok: false, status: 429, error: 'Account request limit reached.' } as any);
    const dispatch = vi.fn(); p.env.DISPATCHER = { get: dispatch };
    const response = await p.object.appRequest(new Request('https://app.example/api/items'), 'production');
    expect(response.status).toBe(429); expect(dispatch).not.toHaveBeenCalled();
  });
  it('enforces concurrent limits across projects', async () => {
    const c = context(); const pilot = new PilotCoordinator(c.ctx, {} as any);
    const results = await Promise.all(Array.from({ length: 5 }, (_, i) => pilot.acquire(String(i), 'sandbox', 'project')));
    expect(results.filter(result => result.ok)).toHaveLength(2);
    expect(results.filter(result => !result.ok)).toEqual(Array(3).fill({ ok: false, status: 429, error: 'All pilot sandbox slots are busy. Try again shortly.' }));
    await pilot.release('0'); await expect(pilot.acquire('next', 'sandbox', 'project')).resolves.toEqual({ ok: true });
  });
});


it('counts stable email event IDs once per account day across delivery retries', async () => {
  const state = context(); const usage = new PilotCoordinator(state.ctx, {} as any);
  expect(await usage.consumeUsage('emails', 'mail-1')).toEqual({ ok: true });
  expect(await usage.consumeUsage('emails', 'mail-1')).toEqual({ ok: true });
  expect((await usage.usageStatus()).used.emails).toBe(1);
  expect(await usage.consumeUsage('emails', 'mail-2')).toEqual({ ok: true });
  expect((await usage.usageStatus()).used.emails).toBe(2);
});

async function publishingProject() {
  const p = await builtProject('publish');
  p.job.environment = 'production';
  await p.ctx.storage.put('current', p.job);
  const old = { id: 'previous', revision: 'previous-revision', scriptName: 'previous-worker', artifactKey: 'previous-assets' };
  await p.ctx.storage.put('active:production', old);
  const verify = vi.spyOn(p.object as any, 'verify').mockResolvedValue(undefined);
  vi.spyOn(ManagedStore.prototype, 'readiness').mockResolvedValue({ emailReady: true, googleReady: true, ownerVerified: true, ownerEmail: 'owner@example.com', from: 'app@example.com', googleCallback: 'https://example.com/callback' });
  vi.spyOn(CloudflareAPI.prototype, 'createDatabase').mockResolvedValue({ uuid: 'production-db', name: 'production' });
  const health = vi.fn(async () => Response.json({ ok: true }));
  p.env.DISPATCHER = { get: vi.fn(() => ({ fetch: health })) };
  return { ...p, old, verify, health };
}

describe('Complete application publication', () => {
  it('verifies once, deploys that artifact, and commits the live URL only after production checks and cleanup', async () => {
    const p = await publishingProject();
    await (p.object as any).advance(p.job);
    expect(p.verify).toHaveBeenCalledOnce();
    expect(p.upload).not.toHaveBeenCalled();
    expect(p.map.get('current')).toMatchObject({ step: 6, status: 'running', publishStage: 'services' });
    expect(p.map.get('active:production')).toEqual(p.old);
    const check = deferred<Response>(); p.health.mockReturnValue(check.promise);
    const deploying = (p.object as any).advance(p.map.get('current'));
    await vi.waitFor(() => expect(p.health).toHaveBeenCalledOnce());
    expect(p.map.get('active:production')).toEqual(p.old);
    expect(p.map.get('current').status).toBe('running');
    expect(p.upload).toHaveBeenCalledWith(undefined, expect.any(String), 'export default {}', 'production-db', undefined);
    expect(p.map.has(`outcome:${p.job.id}:publish_passed`)).toBe(false);
    check.resolve(Response.json({ ok: true })); await deploying;
    expect(p.map.get(`outcome:${p.job.id}:publish_passed`)).toMatchObject({ id: p.job.id, kind: 'publish_passed', ownerId: 'owner', projectId: 'project', revision: p.job.revision });
    expect(p.map.get('active:production')).toMatchObject({ id: p.job.id, revision: p.job.revision, artifactKey: p.job.artifactKey, databaseId: 'production-db' });
    expect(p.map.get('current')).toMatchObject({ status: 'passed', publishStage: 'live', releaseId: p.job.id });
    expect(p.map.has('pending-release:' + p.job.id)).toBe(false);
    expect(sandbox.exec).not.toHaveBeenCalled();
    expect(sandbox.destroy).toHaveBeenCalledOnce();
    expect(p.verify).toHaveBeenCalledOnce();
  });

  it('never deploys when frontend/backend verification fails', async () => {
    const p = await publishingProject(); p.verify.mockRejectedValue(new Error('API persistence check failed'));
    await (p.object as any).runAdvance(p.job);
    expect(p.upload).not.toHaveBeenCalled();
    expect(p.map.get('active:production')).toEqual(p.old);
    expect(p.map.get('current').status).toBe('failed');
  });

  it('removes a failed production candidate while preserving the previous release', async () => {
    const p = await publishingProject();
    await (p.object as any).advance(p.job);
    p.health.mockResolvedValue(new Response('unhealthy', { status: 503 }));
    await (p.object as any).runAdvance(p.map.get('current'));
    expect(p.map.get('active:production')).toEqual(p.old);
    expect(p.map.get('current')).toMatchObject({ status: 'failed', publishStage: 'check' });
    expect(p.map.get('current').message).toContain('health check');
    expect(p.remove).toHaveBeenCalledWith(expect.stringContaining('/scripts/bh-'));
    expect(p.map.has('pending-release:' + p.job.id)).toBe(false);
  });

  it('cannot activate a candidate cancelled during its production health check', async () => {
    const p = await publishingProject();
    await (p.object as any).advance(p.job);
    const check = deferred<Response>(); p.health.mockReturnValue(check.promise);
    const alarm = p.object.alarm();
    await vi.waitFor(() => expect(p.health).toHaveBeenCalledOnce());
    const stopping = p.object.stop(p.job.id);
    await vi.waitFor(() => expect(p.map.get('current').status).toBe('stopping'));
    check.resolve(Response.json({ ok: true }));
    await Promise.all([alarm, stopping]);
    expect(p.map.get('active:production')).toEqual(p.old);
    expect(p.map.get('current').status).toBe('stopped');
    expect(p.map.has('pending-release:' + p.job.id)).toBe(false);
  });

  it('continues publishing after the workspace lease ends, but still enforces a job deadline', async () => {
    const p = await publishingProject(); p.job.leaseUntil = Date.now() - 1;
    await p.ctx.storage.put('current', p.job);
    await p.object.alarm();
    expect(p.verify).toHaveBeenCalledOnce();
    expect(p.map.get('current').status).toBe('running');
    await p.ctx.storage.put('current', { ...p.map.get('current'), createdAt: Date.now() - 600_001 });
    await p.object.alarm();
    expect(p.map.get('current').status).toBe('failed');
    expect(p.map.get('active:production')).toEqual(p.old);
  });

  it('blocks production service changes until publishing finishes', async () => {
    const p = await publishingProject();
    expect((await p.call('/services', 'PUT', { googleEnabled: false }, 'production')).status).toBe(409);
    expect((await p.call('/integrations/google', 'DELETE', undefined, 'production')).status).toBe(409);
    expect((await p.call('/services', 'PUT', { googleEnabled: false }, 'development')).status).toBe(200);
    const users = vi.spyOn(p.object as any, 'servicesControl').mockResolvedValue(Response.json({ ok: true }));
    expect((await p.call('/services/users/existing-user', 'PATCH', { disabled: true }, 'production')).status).toBe(200);
    expect(users).toHaveBeenCalledOnce();
  });

  it('takes all production routes offline without deleting the database or saved release', async () => {
    const p = await publishingProject();
    await p.ctx.storage.put('db:production', { id: 'production-db' });
    await p.ctx.storage.put('release:production:old', p.old);
    expect((await p.call('/unpublish', 'POST', {}, 'production')).status).toBe(409);
    await p.ctx.storage.put('current', { ...p.job, status: 'passed' });
    expect((await p.call('/unpublish', 'POST', {}, 'production')).status).toBe(200);
    expect(p.map.has('active:production')).toBe(false);
    expect(p.map.get('release:production:old')).toEqual(p.old);
    expect(p.map.get('db:production')).toEqual({ id: 'production-db' });
    for (const path of ['/', '/api/health', '/api/auth/session', '/api/contact', '/api/storage', '/__brainhalf/auth']) {
      expect((await p.object.appRequest(new Request('https://app.example' + path), 'production')).status).toBe(404);
    }
    expect(p.remove).not.toHaveBeenCalled();
  });

  it('rejects unavailable production integrations before consuming a build slot', async () => {
    const p = await project();
    vi.spyOn(ManagedStore.prototype, 'readiness').mockResolvedValue({ emailReady: false, googleReady: false, ownerVerified: false, ownerEmail: '', from: '', googleCallback: '' });
    const files = { 'package.json': JSON.stringify({ brainhalf: { runtime: 'workers' }, scripts: { build: 'build', test: 'test' } }) };
    const response = await p.call('/jobs', 'POST', { kind: 'publish', files }, 'production');
    expect(response.status).toBe(409); expect(await response.text()).toContain('Production email');
    expect(p.pilot.acquire).not.toHaveBeenCalled(); expect(p.map.has('current')).toBe(false);
  });

  it('admits static publication without inventing a backend, and rejects unsupported Node servers', async () => {
    const p = await project();
    const files = { 'package.json': JSON.stringify({ scripts: { build: 'vite build' } }), 'index.html': '<div id="root"></div>' };
    const response = await p.call('/jobs', 'POST', { kind: 'publish', files }, 'production');
    expect(response.status).toBe(202); expect(p.map.get('current')).toMatchObject({ kind: 'publish', environment: 'production', static: true, node: false });
    const another = await project();
    const rejected = await another.call('/jobs', 'POST', { kind: 'publish', files: { ...files, 'server/index.ts': 'existing Node API' } }, 'production');
    expect(rejected.status).toBe(422); expect(another.pilot.acquire).not.toHaveBeenCalled();
  });
});

it('applies the hosted project limit per account, including old registrations and released slots', async () => {
  const c = context();
  c.map.set('project:legacy', { projectId: 'legacy', ownerId: 'alice' });
  const coordinator = new PilotCoordinator(c.ctx, {} as any);
  for (let slot = 2; slot <= 10; slot++) {
    expect(await coordinator.register(`alice-${slot}`, { projectId: `a${slot}`, ownerId: 'alice' })).toEqual({ ok: true });
  }
  expect(await coordinator.register('alice-11', { projectId: 'a11', ownerId: 'alice' })).toMatchObject({ status: 429 });
  expect(await coordinator.register('bob-1', { projectId: 'b1', ownerId: 'bob' })).toEqual({ ok: true });
  await expect(coordinator.unregister('legacy', { projectId: 'legacy', ownerId: 'bob' })).rejects.toThrow('scope mismatch');
  await coordinator.unregister('legacy', { projectId: 'legacy', ownerId: 'alice' });
  expect(await coordinator.register('alice-11', { projectId: 'a11', ownerId: 'alice' })).toEqual({ ok: true });
  expect(await coordinator.lookup('bob-1')).toMatchObject({ ownerId: 'bob' });
});

it('retries durable publication outcome delivery without counting a failed delivery twice', async () => {
  const p = await project();
  const event = { id: 'job', ownerId: 'owner', projectId: 'project', kind: 'publish_passed', at: Date.now(), revision: 'a'.repeat(64) };
  p.map.set('outcome:job:publish_passed', event);
  p.env.PLATFORM = { fetch: vi.fn(async () => new Response(null, { status: 503 })) };
  await (p.object as any).drainOutcomes();
  expect(p.map.get('outcome:job:publish_passed')).toEqual(event);
  expect(p.ctx.storage.setAlarm).toHaveBeenCalled();
  p.env.PLATFORM.fetch.mockResolvedValue(Response.json({ ok: true }));
  await (p.object as any).drainOutcomes();
  expect(p.map.has('outcome:job:publish_passed')).toBe(false);
  await (p.object as any).drainOutcomes();
  expect(p.env.PLATFORM.fetch).toHaveBeenCalledTimes(2);
});
