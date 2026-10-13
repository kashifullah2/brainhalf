import { budgetRegistry } from './helpers/storage';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DISCONNECT_GRACE_MS } from '../lib/timeouts';

vi.mock('cloudflare:workers', () => ({ tracing: { enterSpan: async (_name: string, callback: any) => callback({ setAttribute: () => {} }) } }));
vi.mock('agents', () => ({ Agent: class {} }));

import { BUILDER_SCHEMA } from '../lib/builder-service';
import { ChatAgent } from '../agent';
import { BusyLock, IdempotencyStore, WriteEpoch } from '../lib/concurrency';

const databases: DatabaseSync[] = [];
afterEach(() => {
  vi.useRealTimers();
  for (const database of databases.splice(0)) database.close();
});

const VERIFY_JSON = JSON.stringify({
  version: 1, access: 'public',
  steps: [
    { type: 'request', name: 'create item', path: '/api/items', method: 'POST', body: { title: 'test' }, status: 201, capture: { itemId: '/id' } },
    { type: 'database', name: 'item persisted', sql: 'SELECT id FROM items', rows: 1, assertions: [{ pointer: '/id', equals: 1 }] },
    { type: 'request', name: 'list items', path: '/api/items', method: 'GET', status: 200 },
  ],
});
const FULL_STACK_RESPONSE = '<file path="/src/App.tsx">export default () => <h1>App</h1>;</file>\n<file path="/worker/index.ts">export default { async fetch(request: Request) { return Response.json({ ok: true }); } };</file>\n<file path="/package.json">{"name":"app","scripts":{"build":"vite build"},"brainhalf":{"runtime":"workers"}}</file>\n<file path="/brainhalf.verify.json">' + VERIFY_JSON + '</file>';
const FRONTEND_ONLY_RESPONSE = '<file path="/src/App.tsx">export default () => <h1>App</h1>;</file>\n<file path="/package.json">{"name":"app","scripts":{"build":"vite build"}}</file>';
const FULL_STACK_NO_VERIFY = '<file path="/src/App.tsx">export default () => <h1>App</h1>;</file>\n<file path="/worker/index.ts">export default { async fetch(request: Request) { return Response.json({ ok: true }); } };</file>\n<file path="/package.json">{"name":"app","scripts":{"build":"vite build"},"brainhalf":{"runtime":"workers"}}</file>';

function createAgent() {
  const database = new DatabaseSync(':memory:');
  databases.push(database);
  database.exec('CREATE TABLE project_files (path TEXT PRIMARY KEY, content TEXT, updated_at TEXT); CREATE TABLE messages (id INTEGER PRIMARY KEY, role TEXT, content TEXT, branch_id TEXT DEFAULT \'main\')');
  database.exec('CREATE TABLE generation_usage (id TEXT PRIMARY KEY, model TEXT NOT NULL, started_at INTEGER NOT NULL, finished_at INTEGER, status TEXT NOT NULL, input_tokens INTEGER, output_tokens INTEGER)');
  database.exec('ALTER TABLE generation_usage ADD COLUMN first_response_at INTEGER; ALTER TABLE generation_usage ADD COLUMN provider_calls INTEGER');
  for (const statement of BUILDER_SCHEMA) database.exec(statement);
  const agent: any = Object.create(ChatAgent.prototype);
  const runtimeFetch = vi.fn(async () => Response.json({ job: { id: 'job-1' } }, { status: 202 }));
  agent.env = { REGISTRY: budgetRegistry(), REQUIRED_MODEL_PROVIDERS: 'cloudflare', AI: { run: vi.fn() }, RUNTIME: { fetch: runtimeFetch } };
  agent.writeEpoch = new WriteEpoch();
  agent.generationLock = new BusyLock();
  agent.idempotency = new IdempotencyStore();
  agent.connectionUserIds = new Map([['connection', 'owner']]);
  agent.generationBranchId = 'main';
  agent.pendingAuth = new Map();
  agent.authCache = new Map();
  agent.authorizeConnection = vi.fn(async () => true);
  agent.getConnections = () => [];
  agent.ensureSchema = () => {};
  agent.backupToR2 = vi.fn(async () => {});
  agent.broadcast = vi.fn();
  agent.name = 'test-project';
  const waitUntilPromises: Promise<unknown>[] = [];
  const storageMap = new Map<string, unknown>();
  agent.ctx = {
    storage: {
      transactionSync: (callback: () => unknown) => callback(),
      get: async (key: string) => structuredClone(storageMap.get(key)),
      put: async (key: string, value: unknown) => { storageMap.set(key, structuredClone(value)); },
      delete: async (key: string) => storageMap.delete(key),
    },
    waitUntil: (p: Promise<unknown>) => waitUntilPromises.push(p),
  };
  agent.sql = (strings: TemplateStringsArray, ...values: any[]) => database.prepare(strings.join('?')).all(...values);
  const events: any[] = [];
  const connection = { id: 'connection', send: (message: string) => events.push(JSON.parse(message)) };
  const generate = (text: string) => {
    agent.env.AI.run = vi.fn(async () => ({ response: text }));
    // Reset the cached pipeline so it picks up the new env
    agent._pipeline = null;
    return agent.runGeneration(
      connection,
      { model: '@cf/deepseek-ai/deepseek-v4-pro-0813' },
      'system', 'Build an app',
      agent.writeEpoch.begin(), false,
    );
  };
  const flush = () => Promise.allSettled(waitUntilPromises.splice(0));
  return { agent, database, events, connection, generate, runtimeFetch, flush, waitUntilPromises };
}

describe('Server-triggered dev build', () => {
  it('triggers a preview build on successful full-stack generation', async () => {
    const { generate, runtimeFetch, flush, events, database } = createAgent();
    await generate(FULL_STACK_RESPONSE);
    await flush();

    expect(runtimeFetch).toHaveBeenCalledOnce();
    const req: Request = (runtimeFetch.mock.calls as any)[0][0];
    expect(req.method).toBe('POST');
    expect(new URL(req.url).pathname).toBe('/jobs');
    expect(new URL(req.url).searchParams.get('environment')).toBe('development');
    expect(req.headers.get('x-bh-project')).toBe('test-project');
    expect(req.headers.get('x-bh-owner')).toBe('owner');
    const body = await req.clone().json();
    expect(body).toMatchObject({ kind: 'preview', serverTriggered: true });
    expect(body.files).toHaveProperty('/worker/index.ts');

    const statusEvent = events.find(e => e.type === 'runtime_build_status');
    expect(statusEvent).toMatchObject({ status: 'triggered', jobId: 'job-1' });
  });

  it('never triggers for frontend-only projects', async () => {
    const { generate, runtimeFetch, flush } = createAgent();
    await generate(FRONTEND_ONLY_RESPONSE);
    await flush();
    expect(runtimeFetch).not.toHaveBeenCalled();
  });

  it('never triggers on failed generation', async () => {
    const { agent, connection, runtimeFetch, flush } = createAgent();
    agent.env.AI.run = vi.fn(async () => { throw new Error('Model unavailable'); });
    agent._pipeline = null;
    await agent.runGeneration(
      connection,
      { model: '@cf/deepseek-ai/deepseek-v4-pro-0813' },
      'system', 'Build an app',
      agent.writeEpoch.begin(), false,
    );
    await flush();
    expect(runtimeFetch).not.toHaveBeenCalled();
  });

  it('never triggers on aborted generation', async () => {
    const { agent, connection, runtimeFetch, flush } = createAgent();
    agent.env.AI.run = vi.fn(async () => {
      agent.writeEpoch.begin();
      return { response: FULL_STACK_RESPONSE };
    });
    agent._pipeline = null;
    await agent.runGeneration(
      connection,
      { model: '@cf/deepseek-ai/deepseek-v4-pro-0813' },
      'system', 'Build an app',
      agent.writeEpoch.begin(), false,
    );
    await flush();
    expect(runtimeFetch).not.toHaveBeenCalled();
  });

  it('never triggers when RUNTIME binding is missing', async () => {
    const { agent, connection, flush, events } = createAgent();
    delete agent.env.RUNTIME;
    agent.env.AI.run = vi.fn(async () => ({ response: FULL_STACK_RESPONSE }));
    agent._pipeline = null;
    await agent.runGeneration(
      connection,
      { model: '@cf/deepseek-ai/deepseek-v4-pro-0813' },
      'system', 'Build an app',
      agent.writeEpoch.begin(), false,
    );
    await flush();
    expect(events.find(e => e.type === 'runtime_build_status')).toBeUndefined();
  });

  it('trigger failure does not affect generation completion', async () => {
    const failingFetch = vi.fn(async () => { throw new Error('Runtime service unavailable'); });
    const { agent, database, connection, flush, events } = createAgent();
    agent.env.RUNTIME = { fetch: failingFetch };
    agent.env.AI.run = vi.fn(async () => ({ response: FULL_STACK_RESPONSE }));
    agent._pipeline = null;
    await agent.runGeneration(
      connection,
      { model: '@cf/deepseek-ai/deepseek-v4-pro-0813' },
      'system', 'Build an app',
      agent.writeEpoch.begin(), false,
    );
    await flush();

    const usage = database.prepare('SELECT status FROM generation_usage').get() as { status: string };
    expect(usage.status).toBe('completed');
    expect(failingFetch).toHaveBeenCalledOnce();
    const statusEvent = events.find(e => e.type === 'runtime_build_status');
    expect(statusEvent).toMatchObject({ status: 'failed' });
    const chatNotice = events.find(e => e.type === 'generation_notice' && typeof e.message === 'string' && e.message.includes('failed to build'));
    expect(chatNotice).toBeTruthy();
  });

  it('trigger fires exactly once per generation', async () => {
    const { generate, runtimeFetch, flush } = createAgent();
    await generate(FULL_STACK_RESPONSE);
    await flush();
    expect(runtimeFetch).toHaveBeenCalledTimes(1);
  });

  it('sends runtime_build_status with deduplicated flag when runtime returns dedup', async () => {
    const dedupFetch = vi.fn(async () => Response.json({ job: { id: 'existing-job' }, deduplicated: true }, { status: 200 }));
    const { agent, connection, flush, events } = createAgent();
    agent.env.RUNTIME = { fetch: dedupFetch };
    agent.env.AI.run = vi.fn(async () => ({ response: FULL_STACK_RESPONSE }));
    agent._pipeline = null;
    await agent.runGeneration(
      connection,
      { model: '@cf/deepseek-ai/deepseek-v4-pro-0813' },
      'system', 'Build an app',
      agent.writeEpoch.begin(), false,
    );
    await flush();

    const statusEvent = events.find(e => e.type === 'runtime_build_status');
    expect(statusEvent).toMatchObject({ status: 'triggered', deduplicated: true, jobId: 'existing-job' });
  });

  it('queues and retries when sandbox slots are unavailable (429)', async () => {
    const errorFetch = vi.fn(async () => Response.json({ error: 'All sandbox slots are in use' }, { status: 429 }));
    const { agent, connection, flush, events } = createAgent();
    agent.env.RUNTIME = { fetch: errorFetch };
    agent.env.AI.run = vi.fn(async () => ({ response: FULL_STACK_RESPONSE }));
    agent._pipeline = null;
    await agent.runGeneration(
      connection,
      { model: '@cf/deepseek-ai/deepseek-v4-pro-0813' },
      'system', 'Build an app',
      agent.writeEpoch.begin(), false,
    );
    await flush();

    const statusEvent = events.find(e => e.type === 'runtime_build_status');
    expect(statusEvent).toMatchObject({ status: 'queued' });
    const chatNotice = events.find(e => e.type === 'generation_notice' && typeof e.message === 'string' && e.message.includes('waiting for a free build slot'));
    expect(chatNotice).toBeTruthy();
    const retryEntry = await agent.ctx.storage.get('server_build_check');
    expect(retryEntry).toMatchObject({ retry: true, attempt: 0 });
  });

  it('never triggers when kill-switch disables the model before generation', async () => {
    const { agent, connection, runtimeFetch, flush } = createAgent();
    const disabledStub = {
      fetch: async (req: Request) => {
        if (new URL(req.url).pathname === '/public/model-status') {
          return Response.json({ integratedModelsEnabled: false, disabledModels: [] });
        }
        return new Response('{}', { status: 404 });
      },
    };
    agent.env.REGISTRY = { idFromName: () => 'auth', get: () => disabledStub };
    agent.env.AI.run = vi.fn(async () => ({ response: FULL_STACK_RESPONSE }));
    agent._pipeline = null;
    await agent.runGeneration(
      connection,
      { model: '@cf/deepseek-ai/deepseek-v4-pro-0813' },
      'system', 'Build an app',
      agent.writeEpoch.begin(), false,
    );
    await flush();
    expect(runtimeFetch).not.toHaveBeenCalled();
    expect(agent.env.AI.run).not.toHaveBeenCalled();
  });

  it('never triggers when a completeness repair is pending', async () => {
    const { agent, connection, runtimeFetch, flush } = createAgent();
    agent.env.AI.run = vi.fn(async () => ({ response: FULL_STACK_NO_VERIFY }));
    agent._pipeline = null;
    await agent.runGeneration(
      connection,
      { model: '@cf/deepseek-ai/deepseek-v4-pro-0813' },
      'system', 'Build an app',
      agent.writeEpoch.begin(), false,
    );
    await flush();
    expect(runtimeFetch).not.toHaveBeenCalled();
  });

  it('survives with a connection that is dead from the start', async () => {
    const { agent, runtimeFetch, flush, database } = createAgent();
    const deadConnection = {
      id: 'connection',
      send: () => { throw new Error('WebSocket is closed'); },
    };
    agent.env.AI.run = vi.fn(async () => ({ response: FULL_STACK_RESPONSE }));
    agent._pipeline = null;
    await agent.runGeneration(
      deadConnection,
      { model: '@cf/deepseek-ai/deepseek-v4-pro-0813' },
      'system', 'Build an app',
      agent.writeEpoch.begin(), false,
    );
    await flush();

    const usage = database.prepare('SELECT status FROM generation_usage').get() as { status: string };
    expect(usage.status).toBe('completed');
    expect(runtimeFetch).toHaveBeenCalledOnce();
  });

  it('shows build failure in chat on reconnect by reading runtime /status', async () => {
    const { agent, generate, flush } = createAgent();
    await generate(FULL_STACK_RESPONSE);
    await flush();

    const stored = await agent.ctx.storage.get('server_build_check');
    expect(stored).toMatchObject({ jobId: 'job-1' });

    const statusFetch = vi.fn(async (req: Request) => {
      if (new URL(req.url).pathname === '/status') {
        return Response.json({ jobs: [{ id: 'job-1', status: 'failed', message: 'Build error: missing export' }] });
      }
      return new Response('Not found', { status: 404 });
    });
    agent.env.RUNTIME = { fetch: statusFetch };
    const reconnectEvents: any[] = [];
    const newConn = { id: 'reconnect', send: (msg: string) => reconnectEvents.push(JSON.parse(msg)) };

    const reconnectPromises: Promise<unknown>[] = [];
    agent.ctx.waitUntil = (p: Promise<unknown>) => reconnectPromises.push(p);
    (agent as any).checkServerBuildFailure(newConn);
    await Promise.allSettled(reconnectPromises);

    const notice = reconnectEvents.find(e => e.type === 'generation_notice' && typeof e.message === 'string' && e.message.includes('failed to build'));
    expect(notice).toBeTruthy();
    expect(notice.message).toContain('missing export');

    const cleared = await agent.ctx.storage.get('server_build_check');
    expect(cleared).toBeUndefined();
  });

  it('keeps server_build_check key when job is still running at reconnect', async () => {
    const { agent, generate, flush } = createAgent();
    await generate(FULL_STACK_RESPONSE);
    await flush();

    const statusFetch = vi.fn(async (req: Request) => {
      if (new URL(req.url).pathname === '/status') {
        return Response.json({ jobs: [{ id: 'job-1', status: 'running', message: 'Building…' }] });
      }
      return new Response('Not found', { status: 404 });
    });
    agent.env.RUNTIME = { fetch: statusFetch };
    const reconnectEvents: any[] = [];
    const newConn = { id: 'reconnect', send: (msg: string) => reconnectEvents.push(JSON.parse(msg)) };

    const reconnectPromises: Promise<unknown>[] = [];
    agent.ctx.waitUntil = (p: Promise<unknown>) => reconnectPromises.push(p);
    (agent as any).checkServerBuildFailure(newConn);
    await Promise.allSettled(reconnectPromises);

    expect(reconnectEvents.find(e => e.type === 'generation_notice')).toBeUndefined();
    const kept = await agent.ctx.storage.get('server_build_check');
    expect(kept).toMatchObject({ jobId: 'job-1' });
  });

  it('reconnect schedules follow-up check when job is still active', async () => {
    const { agent, generate, flush } = createAgent();
    await generate(FULL_STACK_RESPONSE);
    await flush();

    let pollCount = 0;
    const statusFetch = vi.fn(async (req: Request) => {
      if (new URL(req.url).pathname === '/status') {
        pollCount++;
        if (pollCount === 1) return Response.json({ jobs: [{ id: 'job-1', status: 'running', message: 'Building…' }] });
        return Response.json({ jobs: [{ id: 'job-1', status: 'failed', message: 'OOM killed' }] });
      }
      return new Response('Not found', { status: 404 });
    });
    agent.env.RUNTIME = { fetch: statusFetch };
    const reconnectEvents: any[] = [];
    const newConn = { id: 'reconnect', send: (msg: string) => reconnectEvents.push(JSON.parse(msg)) };

    const reconnectPromises: Promise<unknown>[] = [];
    agent.ctx.waitUntil = (p: Promise<unknown>) => reconnectPromises.push(p);

    (agent as any).checkServerBuildFailure(newConn);
    await Promise.allSettled(reconnectPromises.splice(0));

    expect(pollCount).toBe(1);
    const kept = await agent.ctx.storage.get('server_build_check');
    expect(kept).toMatchObject({ jobId: 'job-1' });
    expect(reconnectEvents.find(e => e.type === 'generation_notice')).toBeUndefined();
    expect(reconnectPromises).toHaveLength(1);
    reconnectPromises.splice(0);

    (agent as any).checkServerBuildFailure(newConn, 1);
    await Promise.allSettled(reconnectPromises.splice(0));

    expect(pollCount).toBe(2);
    const notice = reconnectEvents.find(e => e.type === 'generation_notice' && typeof e.message === 'string' && e.message.includes('OOM killed'));
    expect(notice).toBeTruthy();
    const cleared = await agent.ctx.storage.get('server_build_check');
    expect(cleared).toBeUndefined();
  });

  it('trigger registers a scheduled follow-up check via waitUntil', async () => {
    const { generate, flush, waitUntilPromises, agent } = createAgent();
    await generate(FULL_STACK_RESPONSE);
    const preFlush = waitUntilPromises.length;
    expect(preFlush).toBeGreaterThan(0);
    await flush();
    const stored = await agent.ctx.storage.get('server_build_check');
    expect(stored).toMatchObject({ jobId: 'job-1' });
  });

  it('scheduled build status check delivers failure to connected user', async () => {
    vi.useFakeTimers();
    const { agent, generate, flush, events } = createAgent();
    await generate(FULL_STACK_RESPONSE);
    await flush();

    expect(await agent.ctx.storage.get('server_build_check')).toMatchObject({ jobId: 'job-1' });

    let pollCount = 0;
    agent.env.RUNTIME = { fetch: vi.fn(async (req: Request) => {
      if (new URL(req.url).pathname === '/status') {
        pollCount++;
        if (pollCount === 1) return Response.json({ jobs: [{ id: 'job-1', status: 'running' }] });
        return Response.json({ jobs: [{ id: 'job-1', status: 'failed', message: 'Syntax error in worker' }] });
      }
      return new Response('Not found', { status: 404 });
    }) };

    await vi.advanceTimersByTimeAsync(30_000);
    expect(pollCount).toBe(1);
    expect(await agent.ctx.storage.get('server_build_check')).toMatchObject({ jobId: 'job-1' });

    await vi.advanceTimersByTimeAsync(30_000);
    expect(pollCount).toBe(2);
    const notice = events.find(e => e.type === 'generation_notice' && typeof e.message === 'string' && e.message.includes('Syntax error'));
    expect(notice).toBeTruthy();
    expect(await agent.ctx.storage.get('server_build_check')).toBeUndefined();
  });

  it('capacity retry succeeds on second attempt after initial 429', async () => {
    vi.useFakeTimers();
    let callCount = 0;
    const events: any[] = [];
    const storageMap = new Map<string, unknown>();
    const waitUntilPromises: Promise<unknown>[] = [];
    const { GenerationPipeline } = await import('../lib/generation-pipeline');
    const pipeline = new GenerationPipeline({
      runSql: (() => []) as any,
      env: { RUNTIME: { fetch: vi.fn(async (req: Request) => {
        if (new URL(req.url).pathname === '/jobs') {
          callCount++;
          if (callCount === 1) return Response.json({ error: 'busy' }, { status: 429 });
          return Response.json({ job: { id: 'retry-job-1' } }, { status: 202 });
        }
        return new Response('Not found', { status: 404 });
      }) } },
      storage: {
        put: async (k: string, v: unknown) => { storageMap.set(k, structuredClone(v)); },
        get: async <T>(k: string) => structuredClone(storageMap.get(k)) as T | undefined,
        delete: async (k: string) => storageMap.delete(k),
      },
      waitUntil: (p: Promise<unknown>) => waitUntilPromises.push(p),
      name: 'test-project',
      readAllProjectFiles: () => ({}),
      broadcast: vi.fn(),
    } as any);
    (pipeline as any).scheduleBuildStatusCheck = vi.fn();
    const connection = { id: 'c1', send: (msg: string) => events.push(JSON.parse(msg)) };

    pipeline.scheduleCapacityRetry('rev-1', 'owner', connection, 0);
    expect(storageMap.get('server_build_check')).toMatchObject({ retry: true, attempt: 0 });

    // Advance past both backoffs (30s + 60s) before flushing — each retry
    // callback registers the next setTimeout which only fires when we advance
    // past its delay. Flushing between would block on the pending next retry.
    await vi.advanceTimersByTimeAsync(30_000 + 60_000);
    await Promise.allSettled(waitUntilPromises.splice(0));

    expect(callCount).toBe(2);
    expect(storageMap.get('server_build_check')).toMatchObject({ jobId: 'retry-job-1' });
    expect(events.find(e => e.type === 'runtime_build_status' && e.status === 'triggered')).toBeTruthy();
  });

  it('capacity retry gives up after max attempts with clear message', async () => {
    vi.useFakeTimers();
    const events: any[] = [];
    const storageMap = new Map<string, unknown>();
    const waitUntilPromises: Promise<unknown>[] = [];
    const { GenerationPipeline } = await import('../lib/generation-pipeline');
    const pipeline = new GenerationPipeline({
      runSql: (() => []) as any,
      env: { RUNTIME: { fetch: vi.fn(async () => Response.json({ error: 'busy' }, { status: 429 })) } },
      storage: {
        put: async (k: string, v: unknown) => { storageMap.set(k, structuredClone(v)); },
        get: async <T>(k: string) => structuredClone(storageMap.get(k)) as T | undefined,
        delete: async (k: string) => storageMap.delete(k),
      },
      waitUntil: (p: Promise<unknown>) => waitUntilPromises.push(p),
      name: 'test-project',
      readAllProjectFiles: () => ({}),
      broadcast: vi.fn(),
    } as any);
    const connection = { id: 'c1', send: (msg: string) => events.push(JSON.parse(msg)) };

    pipeline.scheduleCapacityRetry('rev-1', 'owner', connection, 0);

    // Advance past all 5 backoffs in one shot: 30+60+120+240+480 = 930s.
    // Each 429 retry registers the next setTimeout, which fires when the
    // clock passes its scheduled time. The 6th call (attempt 5) exceeds
    // max attempts and sends the give-up message synchronously.
    await vi.advanceTimersByTimeAsync(30_000 + 60_000 + 120_000 + 240_000 + 480_000);
    await Promise.allSettled(waitUntilPromises.splice(0));

    const giveUp = events.find(e => e.type === 'generation_notice' && typeof e.message === 'string' && e.message.includes('retry from the preview panel'));
    expect(giveUp).toBeTruthy();
    expect(storageMap.has('server_build_check')).toBe(false);
    expect(events.find(e => e.type === 'runtime_build_status' && e.status === 'failed')).toBeTruthy();
  });

  it('reconnect resumes capacity retry from persisted state', async () => {
    vi.useFakeTimers();
    const { agent } = createAgent();
    await agent.ctx.storage.put('server_build_check', { retry: true, attempt: 0, revision: 'rev-1', ownerId: 'owner' });

    let retryCallCount = 0;
    agent.env.RUNTIME = { fetch: vi.fn(async (req: Request) => {
      if (new URL(req.url).pathname === '/jobs') { retryCallCount++; return Response.json({ job: { id: 'reconnect-job' } }, { status: 202 }); }
      return new Response('Not found', { status: 404 });
    }) };
    agent._pipeline = null;

    const reconnectPromises: Promise<unknown>[] = [];
    agent.ctx.waitUntil = (p: Promise<unknown>) => reconnectPromises.push(p);
    const newConn = { id: 'reconnect', send: () => {} };
    (agent as any).checkServerBuildFailure(newConn);
    await Promise.allSettled(reconnectPromises.splice(0));

    // checkServerBuildFailure calls scheduleCapacityRetry which uses waitUntil+setTimeout
    // Stub scheduleBuildStatusCheck on the pipeline to avoid AbortSignal.timeout
    const pipeline = (agent as any)._pipeline;
    if (pipeline) (pipeline as any).scheduleBuildStatusCheck = vi.fn();

    await vi.advanceTimersByTimeAsync(30_000);
    await Promise.allSettled(reconnectPromises.splice(0));

    expect(retryCallCount).toBe(1);
    const updated = await agent.ctx.storage.get('server_build_check');
    expect(updated).toMatchObject({ jobId: 'reconnect-job' });
  });
});

describe('Disconnect grace period', () => {
  it('reconnect within the grace period does not abort', () => {
    vi.useFakeTimers();
    const connectionUserIds = new Map([['conn', 'owner']]);
    const abortGeneration = vi.fn();
    let disconnectedSince: number | null = null;
    const accessTimer = setInterval(() => {
      if (!connectionUserIds.size) {
        if (!disconnectedSince) disconnectedSince = Date.now();
        if (Date.now() - disconnectedSince >= DISCONNECT_GRACE_MS) abortGeneration();
      } else {
        disconnectedSince = null;
      }
    }, 10_000);

    connectionUserIds.clear();
    vi.advanceTimersByTime(60_000);
    expect(abortGeneration).not.toHaveBeenCalled();

    connectionUserIds.set('conn', 'owner');
    vi.advanceTimersByTime(10_000);
    expect(disconnectedSince).toBeNull();

    vi.advanceTimersByTime(130_000);
    expect(abortGeneration).not.toHaveBeenCalled();
    clearInterval(accessTimer);
  });

  it('second disconnect after reconnect restarts the grace timer independently', () => {
    vi.useFakeTimers();
    const connectionUserIds = new Map([['conn', 'owner']]);
    const abortGeneration = vi.fn();
    let disconnectedSince: number | null = null;
    const accessTimer = setInterval(() => {
      if (!connectionUserIds.size) {
        if (!disconnectedSince) disconnectedSince = Date.now();
        if (Date.now() - disconnectedSince >= DISCONNECT_GRACE_MS) abortGeneration();
      } else {
        disconnectedSince = null;
      }
    }, 10_000);

    connectionUserIds.clear();
    vi.advanceTimersByTime(60_000);
    expect(abortGeneration).not.toHaveBeenCalled();

    connectionUserIds.set('conn', 'owner');
    vi.advanceTimersByTime(10_000);

    connectionUserIds.clear();
    vi.advanceTimersByTime(110_000);
    expect(abortGeneration).not.toHaveBeenCalled();

    vi.advanceTimersByTime(20_000);
    expect(abortGeneration).toHaveBeenCalledOnce();
    clearInterval(accessTimer);
  });

  it('aborts after the grace period with no reconnect', () => {
    vi.useFakeTimers();
    const connectionUserIds = new Map([['conn', 'owner']]);
    const abortGeneration = vi.fn();
    let disconnectedSince: number | null = null;
    const accessTimer = setInterval(() => {
      if (!connectionUserIds.size) {
        if (!disconnectedSince) disconnectedSince = Date.now();
        if (Date.now() - disconnectedSince >= DISCONNECT_GRACE_MS) abortGeneration();
      } else {
        disconnectedSince = null;
      }
    }, 10_000);

    connectionUserIds.clear();
    vi.advanceTimersByTime(110_000);
    expect(abortGeneration).not.toHaveBeenCalled();

    vi.advanceTimersByTime(20_000);
    expect(abortGeneration).toHaveBeenCalledOnce();
    clearInterval(accessTimer);
  });
});
