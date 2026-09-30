import { budgetRegistry } from './helpers/storage';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { APICallError, simulateReadableStream } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import type { LanguageModelV4StreamPart, LanguageModelV4StreamResult } from '@ai-sdk/provider';

const providerState = vi.hoisted(() => ({ model: undefined as any }));

vi.mock('cloudflare:workers', () => ({ tracing: { enterSpan: async (_name: string, callback: any) => callback({ setAttribute: () => {} }) } }));
vi.mock('agents', () => ({ Agent: class {} }));
vi.mock('@ai-sdk/amazon-bedrock', () => ({ createAmazonBedrock: () => () => providerState.model }));

import { BUILDER_SCHEMA } from '../lib/builder-service';
import { ChatAgent } from '../agent';
import { BusyLock, IdempotencyStore, WriteEpoch } from '../lib/concurrency';
import { AI_TIMEOUT_MS } from '../lib/models';

const databases: DatabaseSync[] = [];

afterEach(() => {
  vi.useRealTimers();
  for (const database of databases.splice(0)) database.close();
});

function createAgent() {
  const database = new DatabaseSync(':memory:');
  databases.push(database);
  database.exec('CREATE TABLE project_files (path TEXT PRIMARY KEY, content TEXT, updated_at TEXT); CREATE TABLE messages (id INTEGER PRIMARY KEY, role TEXT, content TEXT)');
  database.exec('CREATE TABLE generation_usage (id TEXT PRIMARY KEY, model TEXT NOT NULL, started_at INTEGER NOT NULL, finished_at INTEGER, status TEXT NOT NULL, input_tokens INTEGER, output_tokens INTEGER)');
  database.exec('ALTER TABLE generation_usage ADD COLUMN first_response_at INTEGER; ALTER TABLE generation_usage ADD COLUMN provider_calls INTEGER');
  for (const statement of BUILDER_SCHEMA) database.exec(statement);
  const agent: any = Object.create(ChatAgent.prototype);
  agent.env = { REGISTRY: budgetRegistry(), REQUIRED_MODEL_PROVIDERS: 'aws', AWS_BEARER_TOKEN_BEDROCK: 'test-key' };
  agent.writeEpoch = new WriteEpoch();
  agent.generationLock = new BusyLock();
  agent.idempotency = new IdempotencyStore();
  agent.connectionUserIds = new Map([['connection', 'owner']]);
  agent.pendingAuth = new Map();
  agent.authCache = new Map();
  agent.authorizeConnection = vi.fn(async () => true);
  agent.getConnections = () => [];
  agent.ensureSchema = () => {};
  agent.backupToR2 = vi.fn(async () => {});
  agent.broadcast = vi.fn();
  agent.ctx = { storage: { transactionSync: (callback: () => unknown) => callback() } };
  agent.sql = (strings: TemplateStringsArray, ...values: any[]) => database.prepare(strings.join('?')).all(...values);
  const events: any[] = [];
  const connection = { id: 'connection', send: (message: string) => events.push(JSON.parse(message)) };
  const run = (options: Record<string, unknown> = {}, prompt = 'Build a task app', planner = false) => agent.runGeneration(connection, { model: 'claude-sonnet-6', ...options }, 'system', prompt, agent.writeEpoch.begin(), planner);
  return { agent, database, events, connection, run };
}

function response(text: string, toolCall?: { toolName: string; input: unknown }): LanguageModelV4StreamResult {
  const chunks: LanguageModelV4StreamPart[] = [{ type: 'stream-start', warnings: [] }];
  if (text) chunks.push({ type: 'text-start', id: 'text' }, { type: 'text-delta', id: 'text', delta: text }, { type: 'text-end', id: 'text' });
  if (toolCall) chunks.push({ type: 'tool-call', toolCallId: 'call', toolName: toolCall.toolName, input: JSON.stringify(toolCall.input) });
  chunks.push({ type: 'finish', finishReason: { unified: toolCall ? 'tool-calls' : 'stop', raw: undefined }, usage: { inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 10, text: 10, reasoning: 0 } } });
  return { stream: simulateReadableStream({ chunks, initialDelayInMs: null, chunkDelayInMs: null }) };
}

describe('Agent generation against the installed AI SDK', () => {
  it.each([true, false])('honors fast mode %s during Workers AI tool turns', async fastMode => {
    const { agent, run } = createAgent();
    const binding = vi.fn(async (_model: string, _input: Record<string, unknown>) => ({ response: '<file path="/src/App.tsx">export default () => <h1>Hello</h1>;</file>' }));
    agent.env = { REGISTRY: budgetRegistry(), REQUIRED_MODEL_PROVIDERS: 'cloudflare', AI: { run: binding } };
    await run({ model: '@cf/deepseek-ai/deepseek-v4-pro-0813', fast_mode: fastMode });
    expect(binding).toHaveBeenCalledOnce();
    expect(binding.mock.calls[0][1]).toMatchObject({ tools: expect.any(Array), chat_template_kwargs: { enable_thinking: !fastMode } });
  });
  it.each(['native', 'cloudflare'] as const)('limits %s tool rounds and streams one final answer with latency measurements', async provider => {
    const { agent, database, run, events } = createAgent();
    const source = 'export default () => <h1>Complete app</h1>;';
    const finalText = `<file path="/src/App.tsx">${source}</file>`;
    const binding = vi.fn()
      .mockResolvedValueOnce({ choices: [{ message: { tool_calls: [{ id: 'files', function: { name: 'list_files', arguments: '{}' } }] } }] })
      .mockImplementationOnce(async () => new ReadableStream({ start(controller) {
        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ response: finalText })}\n\ndata: [DONE]\n\n`)); controller.close();
      } }));
    if (provider === 'cloudflare') agent.env = { REGISTRY: budgetRegistry(), REQUIRED_MODEL_PROVIDERS: 'cloudflare', AI: { run: binding } };
    else {
      let step = 0;
      providerState.model = new MockLanguageModelV4({ doStream: async () => step++ === 0 ? response('', { toolName: 'list_files', input: {} }) : response(finalText) });
    }
    await run({ model: provider === 'cloudflare' ? undefined : 'claude-sonnet-6', max_steps: 1, max_tokens: 8192 });
    expect(database.prepare("SELECT content FROM project_files WHERE path='/src/App.tsx'").get()?.content).toBe(source);
    expect(database.prepare('SELECT provider_calls, first_response_at, started_at, status FROM generation_usage').get()).toMatchObject({ provider_calls: 2, first_response_at: expect.any(Number), status: 'completed' });
    expect(events.filter(event => event.chunk?.done)).toHaveLength(1);
    expect(events.filter(event => event.type === 'error' || event.type === 'trigger-auto-reply')).toEqual([]);
    if (provider === 'cloudflare') {
      expect(binding).toHaveBeenCalledTimes(2);
      expect(binding.mock.calls[1][1].tools).toBeUndefined();
      expect(binding.mock.calls[1][1].messages).toEqual(expect.arrayContaining([
        expect.objectContaining({ role: 'tool', tool_call_id: 'files' }),
        expect.objectContaining({ role: 'user', content: expect.stringContaining('The tool phase is complete.') }),
      ]));
    } else {
      expect(providerState.model.doStreamCalls).toHaveLength(2);
      expect(providerState.model.doStreamCalls[1].tools || []).toHaveLength(0);
      expect(providerState.model.doStreamCalls[1].toolChoice).toEqual({ type: 'none' });
    }
  });

  it('retries a transient native failure with announced attempts, then reports a classified provider-busy error', async () => {
    const { run, events, database } = createAgent();
    providerState.model = new MockLanguageModelV4({ doStream: async () => { throw new APICallError({ message: 'Provider unavailable', url: 'https://provider.example', requestBodyValues: {}, statusCode: 503, isRetryable: true }); } });
    await run();
    // 1 initial attempt + 2 automatic retries. The SDK stays at maxRetries: 0,
    // so every attempt is explicit and announced via generation_notice.
    expect(providerState.model.doStreamCalls).toHaveLength(3);
    const failure = events.find(event => event.type === 'error');
    expect(failure?.error).toBe('The AI model provider is temporarily overloaded.');
    expect(failure?.code).toBe('provider_busy');
    expect(events.filter(event => event.type === 'generation_notice' && /Retrying…/.test(String(event.message ?? '')))).toHaveLength(2);
    expect(database.prepare('SELECT provider_calls, first_response_at, status FROM generation_usage').get()).toEqual({ provider_calls: 3, first_response_at: null, status: 'failed' });
  });

  it('reports a non-transient native failure promptly without retry calls', async () => {
    const { run, events, database } = createAgent();
    providerState.model = new MockLanguageModelV4({ doStream: async () => { throw new APICallError({ message: 'invalid x-api-key', url: 'https://provider.example', requestBodyValues: {}, statusCode: 401, isRetryable: false }); } });
    await run();
    expect(providerState.model.doStreamCalls).toHaveLength(1);
    const failure = events.find(event => event.type === 'error');
    expect(failure?.error).toBe('The AI model provider rejected the request credentials. Please contact support.');
    expect(failure?.code).toBe('provider_auth');
    expect(database.prepare('SELECT provider_calls, status FROM generation_usage').get()).toEqual({ provider_calls: 1, status: 'failed' });
  });

  it('shows Workers AI text before the tool-enabled response finishes and persists it only once', async () => {
    const { agent, database, events, run } = createAgent();
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const binding = vi.fn(async () => new ReadableStream<Uint8Array>({ start(value) { controller = value; } }));
    agent.env = { REGISTRY: budgetRegistry(), REQUIRED_MODEL_PROVIDERS: 'cloudflare', AI: { run: binding } };
    const pending = run({ model: '@cf/deepseek-ai/deepseek-v4-pro-0813' });
    await vi.waitFor(() => expect(controller).toBeDefined());
    const frame = (content: string) => new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`);
    controller.enqueue(frame('Building your task app now.\n'));
    await vi.waitFor(() => expect(events.some(event => event.chunk?.response?.includes('Building your task app now.'))).toBe(true));
    expect(events.some(event => event.chunk?.done)).toBe(false);
    const source = 'export default function App() { return <h1>Task app</h1> }';
    controller.enqueue(frame(`<file path="/src/App.jsx">${source}</file>`));
    controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
    await pending;
    expect(database.prepare("SELECT content FROM project_files WHERE path='/src/App.jsx'").get()?.content).toBe(source);
    expect(String(database.prepare("SELECT content FROM messages WHERE role='assistant'").get()?.content).match(/Building your task app now\./g)).toHaveLength(1);
    expect(events.filter(event => event.chunk?.done)).toHaveLength(1);
    expect(binding).toHaveBeenCalledOnce();
  });
  it('prepares a publishable backend for a signed-in owner before asking the model to customize it', async () => {
    const { agent, database, connection, events } = createAgent();
    agent.connectionUserIds.set(connection.id, 'new-fullstack-owner');
    agent.env.RUNTIME = { fetch: vi.fn(async () => Response.json({ enabled: true, availability: { state: 'ready', message: 'Ready' } })) };
    agent.runGeneration = vi.fn();
    await agent.onMessage(connection, JSON.stringify({ prompt: 'Build a full stack inventory app', idempotencyKey: 'fullstack-start' }));
    expect(agent.runGeneration).toHaveBeenCalledOnce();
    expect(database.prepare('SELECT content FROM project_files WHERE path=?').get('/worker/index.ts')?.content).toContain('env.DB');
    expect(database.prepare('SELECT content FROM project_files WHERE path=?').get('/brainhalf.verify.json')?.content).toContain('Prove database persistence');
    const systemPrompt = agent.runGeneration.mock.calls[0][2];
    expect(systemPrompt).toContain('/worker/index.ts');
    expect(systemPrompt).toContain('every signed-in user');
    expect(events.some(event => event.type === 'file_updated' && event.path === '/worker/index.ts')).toBe(true);
  });
  it('does not prepare backend files or call a model when managed hosting is unavailable', async () => {
    const { agent, database, connection } = createAgent();
    agent.connectionUserIds.set(connection.id, 'unavailable-fullstack-owner');
    agent.env.RUNTIME = { fetch: async () => Response.json({ enabled: false, availability: { state: 'disabled', message: 'Unavailable' } }) };
    agent.runGeneration = vi.fn();
    await agent.onMessage(connection, JSON.stringify({ prompt: 'Build a full stack inventory app' }));
    expect(agent.runGeneration).not.toHaveBeenCalled();
    expect(database.prepare('SELECT path FROM project_files').all()).toEqual([]);
  });
  it('routes GLM 5.3 Flash to its exact Workers AI binding and persists streamed app files', async () => {
    const { agent, database, events, run } = createAgent();
    const model = '@cf/zai-org/glm-5.3-flash';
    const source = 'export default function App() { return <h1>GLM task app</h1>; }';
    const binding = vi.fn(async () => new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { content: `<file path="/src/App.jsx">${source}</file>` } }] })}\n\ndata: [DONE]\n\n`));
      controller.close();
    } }));
    agent.env = { REGISTRY: budgetRegistry(), REQUIRED_MODEL_PROVIDERS: 'cloudflare', AI: { run: binding } };
    await run({ model, max_tokens: 1_000_000 });
    expect(binding).toHaveBeenCalledOnce();
    // Tool-enabled turns stream immediately, using the exact selected binding.
    expect(binding).toHaveBeenCalledWith(model, expect.objectContaining({ stream: true, max_tokens: 8192 }), expect.anything());
    expect(database.prepare("SELECT content FROM project_files WHERE path='/src/App.jsx'").get()?.content).toBe(source);
    expect(events.filter(event => event.type === 'error' || event.type === 'trigger-auto-reply')).toEqual([]);
    expect(database.prepare('SELECT model,status FROM generation_usage').get()).toMatchObject({ model, status: 'completed' });
  });

  it.each(['native', 'cloudflare'] as const)('preserves a %s greeting without creating a hidden app retry', async provider => {
    const { agent, events, database, run } = createAgent();
    const greeting = "Hi! I'm ready to build something for you. What application would you like to create?";
    const binding = vi.fn(async () => ({ response: greeting }));
    if (provider === 'cloudflare') agent.env = { REGISTRY: budgetRegistry(), REQUIRED_MODEL_PROVIDERS: 'cloudflare', AI: { run: binding } };
    else providerState.model = new MockLanguageModelV4({ doStream: response(greeting) });
    await run(provider === 'cloudflare' ? { model: undefined } : {}, 'Hello');
    expect(events.filter(event => event.type === 'trigger-auto-reply' || event.type === 'error')).toEqual([]);
    expect(events.filter(event => event.type === 'stream' && event.chunk.done)).toHaveLength(1);
    expect(database.prepare("SELECT content FROM messages WHERE role='assistant'").get()?.content).toBe(greeting);
    expect(database.prepare('SELECT status FROM generation_usage').get()?.status).toBe('completed');
    if (provider === 'cloudflare') expect(binding).toHaveBeenCalledOnce();
    else expect(providerState.model.doStreamCalls).toHaveLength(1);
  });

  it.each(['native', 'cloudflare'] as const)('reports an empty %s greeting as a failure without a hidden app retry', async provider => {
    const { agent, events, database, run } = createAgent();
    if (provider === 'cloudflare') agent.env = { REGISTRY: budgetRegistry(), REQUIRED_MODEL_PROVIDERS: 'cloudflare', AI: { run: async () => ({ response: '' }) } };
    else providerState.model = new MockLanguageModelV4({ doStream: response('') });
    await run(provider === 'cloudflare' ? { model: undefined } : {}, 'Hello');
    expect(events.filter(event => event.type === 'error')).toEqual([{ type: 'error', error: 'The model returned no response. Please retry.' }]);
    expect(events.some(event => event.type === 'trigger-auto-reply' || event.type === 'stream' && event.chunk.done)).toBe(false);
    expect(database.prepare('SELECT status FROM generation_usage').get()?.status).toBe('failed');
  });

  for (const stop of [false, true]) it.each(['native', 'cloudflare'] as const)(`${stop ? 'honors stop during' : 'finishes'} %s cleanup before exposing completion or a retry to the client`, async provider => {
    const { agent, events, run, connection, database } = createAgent();
    let finish!: () => void;
    const registry = budgetRegistry();
    const delayed = { idFromName: registry.idFromName, get: (id: string) => {
      const stub = registry.get(id);
      return { fetch: async (request: Request) => {
        if (new URL(request.url).pathname === '/ai/end') await new Promise<void>(resolve => { finish = resolve; });
        return stub.fetch(request);
      } };
    } };
    if (provider === 'cloudflare') agent.env = { REGISTRY: delayed, REQUIRED_MODEL_PROVIDERS: 'cloudflare', AI: { run: async () => ({ response: 'I will build your app.' }) } };
    else { agent.env.REGISTRY = delayed; providerState.model = new MockLanguageModelV4({ doStream: response('I will build your app.') }); }
    const pending = run(provider === 'cloudflare' ? { model: undefined } : {}, 'Build a calendar app');
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    expect(events.some(event => event.type === 'trigger-auto-reply' || event.type === 'stream' && event.chunk.done)).toBe(false);
    if (stop) await agent.onMessage(connection, JSON.stringify({ type: 'stop' }));
    finish(); await pending;
    if (stop) {
      expect(events.some(event => event.type === 'trigger-auto-reply' || event.type === 'stream' && event.chunk.done)).toBe(false);
      expect(database.prepare('SELECT status FROM generation_usage').get()?.status).toBe('stopped');
    } else {
      expect(events.filter(event => event.type === 'trigger-auto-reply')).toHaveLength(1);
      expect(events[events.length - 1]).toEqual({ type: 'stream', chunk: { response: '', done: true } });
    }
  });

  it.each(['stop', 'revoke'] as const)('does not start inference after %s during the hosting check', async action => {
    const { agent, connection } = createAgent();
    let resolveHosting!: (response: Response) => void;
    agent.env.RUNTIME = { fetch: vi.fn(() => new Promise<Response>(resolve => { resolveHosting = resolve; })) };
    agent.runGeneration = vi.fn();
    const pending = agent.onMessage(connection, JSON.stringify({ prompt: 'Build a persistent database app' }));
    await vi.waitFor(() => expect(agent.env.RUNTIME.fetch).toHaveBeenCalledOnce());
    if (action === 'stop') await agent.onMessage(connection, JSON.stringify({ type: 'stop' }));
    else agent.authorizeConnection.mockResolvedValue(false);
    resolveHosting(Response.json({ enabled: true, availability: { state: 'ready', message: 'Ready' } }));
    await pending;
    expect(agent.runGeneration).not.toHaveBeenCalled();
    expect(agent.generationLock.isHeld).toBe(false);
  });

  it('aborts generation after the last workspace connection stays closed', async () => {
    vi.useFakeTimers();
    const { agent, connection } = createAgent();
    const controller = new AbortController(); agent.currentAbortController = controller;
    const epoch = agent.writeEpoch.begin();
    await agent.onClose(connection);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(controller.signal.aborted).toBe(true);
    expect(agent.writeEpoch.accepts(epoch)).toBe(false);
  });
  it('lets a reconnect within the grace period retain the active generation', async () => {
    vi.useFakeTimers();
    const { agent, connection } = createAgent();
    const controller = new AbortController(); agent.currentAbortController = controller;
    await agent.onClose(connection);
    agent.connectionUserIds.set('reconnected', 'owner');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(controller.signal.aborted).toBe(false);
  });
  it('executes validated tools across steps and persists the entire visible answer before completion', async () => {
    const { database, events, run, agent } = createAgent();
    const firstText = '<file path="/src/App.jsx">export default function App() { return <h1>Tasks</h1>; }</file>\n';
    const secondText = '<file path="/src/utils.ts">export const title = "Tasks";</file>';
    providerState.model = new MockLanguageModelV4({ doStream: [response(firstText, { toolName: 'write_file', input: { path: '/src/styles.css', content: 'body { margin: 0; }' } }), response(secondText)] });

    await run();

    expect(providerState.model.doStreamCalls).toHaveLength(2);
    const schema = providerState.model.doStreamCalls[0].tools.find((entry: any) => entry.name === 'write_file');
    expect(schema.inputSchema.properties).toHaveProperty('path');
    expect(database.prepare('SELECT path FROM project_files ORDER BY path').all().map(row => row.path)).toEqual(['/src/App.jsx', '/src/styles.css', '/src/utils.ts']);
    const visible = firstText + '<agent-tools>write_file</agent-tools>' + secondText;
    expect(database.prepare("SELECT content FROM messages WHERE role = 'assistant'").get()?.content).toBe(visible);
    expect(events.filter(event => event.type === 'stream' && !event.chunk.done).map(event => event.chunk.response).join('')).toBe(visible);
    expect(events.find(event => event.type === 'tool_call')).not.toHaveProperty('args');
    expect(events[events.length - 1]).toEqual({ type: 'stream', chunk: { response: '', done: true } });
    expect(events.filter(event => event.type === 'error' || event.type === 'trigger-auto-reply')).toEqual([]);
    expect(agent.backupToR2).toHaveBeenCalled();
  });

  it('counts tool-written TSX files as successful application output', async () => {
    const { run, events, database } = createAgent();
    providerState.model = new MockLanguageModelV4({ doStream: [response('', { toolName: 'write_file', input: { path: '/src/App.tsx', content: 'export default function App() { return <h1>Ready</h1>; }' } }), response('Ready.')] });
    await run();
    expect(database.prepare('SELECT path FROM project_files').get()?.path).toBe('/src/App.tsx');
    expect(events.some(event => event.type === 'trigger-auto-reply')).toBe(false);
  });

  it('parses raw tool blocks on the server before sending or saving the transcript', async () => {
    const { database, events, run } = createAgent();
    const raw = 'Checking. <tool_call>{"name":"read_file","arguments":{"secret":"hidden-argument"}}</tool_call> Done.';
    providerState.model = new MockLanguageModelV4({ doStream: response(raw) });
    await run({}, 'Explain the existing app', true);
    const visible = events.filter(event => event.type === 'stream').map(event => event.chunk.response).join('');
    expect(visible).toBe('Checking. <agent-tools>read_file</agent-tools> Done.');
    expect(database.prepare("SELECT content FROM messages WHERE role = 'assistant'").get()?.content).toBe(visible);
    expect(visible).not.toContain('hidden-argument');
  });

  it('reads and edits only the requested lines through the real SDK', async () => {
    const { run, database } = createAgent();
    const original = 'export const title = "Old";\nexport const keep = 1;\n';
    database.prepare('INSERT INTO project_files (path, content) VALUES (?, ?)').run('/src/value.ts', original);
    providerState.model = new MockLanguageModelV4({ doStream: [
      response('', { toolName: 'read_file', input: { path: '/src/value.ts' } }),
      response('', { toolName: 'edit_file', input: { path: '/src/value.ts', edits: [{ search: '"Old"', replace: '"New"' }] } }),
      response('Updated the title.'),
    ] });
    await run();
    expect(database.prepare('SELECT content FROM project_files WHERE path = ?').get('/src/value.ts')?.content).toBe(original.replace('"Old"', '"New"'));
  });

  it('rejects whole-file tool overwrites without inspecting current source', async () => {
    const { run, database } = createAgent();
    database.prepare('INSERT INTO project_files (path, content) VALUES (?, ?)').run('/src/value.ts', 'export const keep = 1;');
    providerState.model = new MockLanguageModelV4({ doStream: [response('', { toolName: 'write_file', input: { path: '/src/value.ts', content: 'export const replaced = true;' } }), response('Cannot replace unread source.')] });
    await run();
    expect(database.prepare('SELECT content FROM project_files').get()?.content).toBe('export const keep = 1;');
  });

  it('rejects an edit if a collaborator changed the file after inspection', async () => {
    const { run, database } = createAgent();
    database.prepare('INSERT INTO project_files (path, content) VALUES (?, ?)').run('/src/value.ts', 'export const title = "Old";');
    let step = 0;
    providerState.model = new MockLanguageModelV4({ doStream: async () => {
      step += 1;
      if (step === 1) return response('', { toolName: 'read_file', input: { path: '/src/value.ts' } });
      if (step === 2) {
        database.prepare('UPDATE project_files SET content = ?').run('export const title = "Collaborator";');
        return response('', { toolName: 'edit_file', input: { path: '/src/value.ts', edits: [{ search: '"Old"', replace: '"New"' }] } });
      }
      return response('The file changed; inspect it again.');
    } });
    await run();
    expect(database.prepare('SELECT content FROM project_files').get()?.content).toBe('export const title = "Collaborator";');
  });

  it('rejects a syntactically invalid tool edit without replacing the working file', async () => {
    const { run, database } = createAgent();
    const source = 'export const title = "Old";';
    database.prepare('INSERT INTO project_files (path, content) VALUES (?, ?)').run('/src/value.ts', source);
    providerState.model = new MockLanguageModelV4({ doStream: [response('', { toolName: 'read_file', input: { path: '/src/value.ts' } }), response('', { toolName: 'edit_file', input: { path: '/src/value.ts', edits: [{ search: '"Old"', replace: ';' }] } }), response('The edit failed syntax validation.')] });
    await run();
    expect(database.prepare('SELECT content FROM project_files').get()?.content).toBe(source);
  });

  it('keeps write tools out of planning requests', async () => {
    const { run } = createAgent();
    providerState.model = new MockLanguageModelV4({ doStream: response('Plan the application.') });
    await run({}, 'Plan the application', true);
    expect(providerState.model.doStreamCalls[0].tools ?? []).toEqual([]);
  });

  it('releases the request key after a provider failure so the same request can retry', async () => {
    const { agent, events, run } = createAgent();
    agent.idempotency.claim('request');
    providerState.model = new MockLanguageModelV4({ doStream: async () => { throw new Error('Upstream unavailable'); } });
    await run({ idempotencyKey: 'request' });
    expect(events.find(event => event.type === 'error')?.error).toContain('Upstream unavailable');
    expect(events.some(event => event.type === 'stream' && event.chunk.done)).toBe(false);
    expect(agent.idempotency.claim('request')).toBe(true);
  });

  it('stops a stalled SDK request promptly and lets another generation run', async () => {
    const { agent, connection, events, run } = createAgent();
    providerState.model = new MockLanguageModelV4({ doStream: () => new Promise(() => {}) });
    const pending = agent.onMessage(connection, JSON.stringify({ prompt: 'Build a calendar', model: 'claude-sonnet-6' }));
    await vi.waitFor(() => expect(agent.currentAbortController).toBeTruthy());
    await agent.onMessage(connection, JSON.stringify({ type: 'stop' }));
    await pending;
    expect(agent.generationLock.isHeld).toBe(false);
    providerState.model = new MockLanguageModelV4({ doStream: response('A useful explanation.') });
    await run({}, 'Explain the design', true);
    expect(events[events.length - 1]?.chunk?.done).toBe(true);
  });

  it('reports the generation timeout instead of leaving chat in a running state', async () => {
    vi.useFakeTimers();
    const { run, events, agent } = createAgent();
    providerState.model = new MockLanguageModelV4({ doStream: () => new Promise(() => {}) });
    const pending = run();
    await vi.advanceTimersByTimeAsync(AI_TIMEOUT_MS);
    await pending;
    expect(events.find(event => event.type === 'error')?.error).toMatch(/exceeded.*retry/i);
    expect(agent.currentAbortController).toBeNull();
  });
});

describe('Workers AI stream completion and cancellation', () => {
  it('includes tool calls and final-stream token usage without counting repeated totals twice', async () => {
    const { agent, run, database } = createAgent();
    const binding = vi.fn()
      .mockResolvedValueOnce({ usage: { prompt_tokens: 10, completion_tokens: 4 }, tool_calls: [{ name: 'list_files', arguments: {} }] })
      .mockResolvedValueOnce(new ReadableStream({ start(controller) {
        const frame = JSON.stringify({ response: '<file path="/src/App.jsx">export default () => <h1>Ready</h1>;</file>', usage: { prompt_tokens: 20, completion_tokens: 6 } });
        controller.enqueue(new TextEncoder().encode(`data: ${frame}\n\ndata: {"usage":{"prompt_tokens":20,"completion_tokens":6}}\n\ndata: [DONE]\n\n`));
        controller.close();
      } }));
    agent.env = { REGISTRY: budgetRegistry(), REQUIRED_MODEL_PROVIDERS: 'cloudflare', AI: { run: binding } };
    await run({ model: undefined });
    expect(binding).toHaveBeenCalledTimes(2);
    expect(database.prepare('SELECT input_tokens,output_tokens FROM generation_usage').get()).toEqual({ input_tokens: 30, output_tokens: 10 });
  });

  it('replays the active response to an authorized reconnect and clears it after completion', async () => {
    const { agent, run, database } = createAgent();
    let controller!: ReadableStreamDefaultController;
    agent.env = { REGISTRY: budgetRegistry(), REQUIRED_MODEL_PROVIDERS: 'cloudflare', AI: { run: async () => new ReadableStream({ start(value) { controller = value; } }) } };
    agent.restoreFromR2 = vi.fn(async () => {});
    agent.getFilesRevision = () => 0;
    const pending = run({ model: '@cf/deepseek-ai/deepseek-v4-pro-0813', idempotencyKey: 'resume-test' });
    await vi.waitFor(() => expect(controller).toBeDefined());
    const first = 'I am implementing your app. ';
    controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ response: first })}\n\n`));
    await vi.waitFor(() => expect(agent.generationSnapshot()?.response).toBe(first));
    const rejected = { id: 'anonymous', send: vi.fn(), close: vi.fn() };
    await agent.onConnect(rejected, { request: new Request('https://brainhalf.com/agents/chat-agent/project') });
    expect(rejected.close).toHaveBeenCalled();
    expect(rejected.send).not.toHaveBeenCalled();
    const send = vi.fn();
    await agent.onConnect({ id: 'reconnected', send, setState: vi.fn() }, { request: new Request('https://brainhalf.com/agents/chat-agent/project?_sid=' + 'a'.repeat(64), { headers: { 'x-auth-user-id': 'owner' } }) });
    const history = send.mock.calls.map(([message]) => JSON.parse(message)).find(message => message.type === 'history');
    expect(history.generation).toMatchObject({ id: 'resume-test', model: '@cf/deepseek-ai/deepseek-v4-pro-0813', prompt: 'Build a task app', response: first });
    expect(history.generation).not.toHaveProperty('epoch');
    const rest = '<file path="/src/App.tsx">export default function App() { return <h1>Resumed app</h1>; }</file>';
    controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ response: rest })}\n\ndata: [DONE]\n\n`));
    await pending;
    expect(agent.generationSnapshot()).toBeUndefined();
    expect(database.prepare("SELECT content FROM messages WHERE role = 'assistant'").get()?.content).toBe(first + rest);
  });

  it('uses DeepSeek V4 Pro when no model is supplied and persists its streamed application', async () => {
    const { agent, run, database, events } = createAgent();
    const content = '<file path="/src/App.jsx">export default function App() { return <h1>DeepSeek app</h1>; }</file>';
    const binding = vi.fn(async (_model: string) => new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n`));
      controller.close();
    } }));
    agent.env = { REGISTRY: budgetRegistry(), REQUIRED_MODEL_PROVIDERS: 'cloudflare', AI: { run: binding } };
    await run({ model: undefined });
    expect(binding.mock.calls[0]?.[0]).toBe('@cf/deepseek-ai/deepseek-v4-pro-0813');
    expect(database.prepare('SELECT content FROM project_files WHERE path = ?').get('/src/App.jsx')?.content).toContain('DeepSeek app');
    expect(events.some(event => event.type === 'error')).toBe(false);
    expect(events[events.length - 1]).toEqual({ type: 'stream', chunk: { response: '', done: true } });
  });
  it('filters raw function-call tokens across SSE frames before sending the visible reply', async () => {
    const { agent, events, database, run } = createAgent();
    const tokens = ['I will inspect it. <tool_', 'call>{"name":"read_file","arguments":{"path":"private"}}', '</tool_call> Done.'];
    const bytes = new TextEncoder().encode(tokens.map(response => `data: ${JSON.stringify({ response })}\n\n`).join('') + 'data: [DONE]\n\n');
    agent.env = { REGISTRY: budgetRegistry(), REQUIRED_MODEL_PROVIDERS: 'cloudflare', AI: { run: async () => new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } }) } };
    await run({ model: '@cf/qwen/qwen3.8-27b' }, 'Explain the architecture', true);
    const visible = events.filter(event => event.type === 'stream').map(event => event.chunk.response).join('');
    expect(visible).toBe('I will inspect it. <agent-tools>read_file</agent-tools> Done.');
    expect(database.prepare("SELECT content FROM messages WHERE role = 'assistant'").get()?.content).toBe(visible);
  });
  it('finishes and releases the stream on an SSE DONE frame without waiting for socket closure', async () => {
    const { agent, events, run } = createAgent();
    const cancel = vi.fn();
    agent.env = { REGISTRY: budgetRegistry(), REQUIRED_MODEL_PROVIDERS: 'cloudflare', AI: { run: async () => new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('data: {"response":"A useful explanation."}\n\ndata: [DONE]\n\n')); }, cancel }) } };
    await run({ model: '@cf/qwen/qwen3.8-27b' }, 'Explain the architecture', true);
    expect(events[events.length - 1]?.chunk?.done).toBe(true);
    expect(cancel).toHaveBeenCalledOnce();
  });
  it('persists split UTF-8 SSE files before emitting completion', async () => {
    const { agent, events, database, run } = createAgent();
    const content = '<file path="/src/App.tsx">export default function App() { return <h1>سلام</h1>; }</file>';
    const bytes = new TextEncoder().encode(`data: ${JSON.stringify({ response: content })}\n\ndata: [DONE]`);
    agent.env = { REGISTRY: budgetRegistry(), REQUIRED_MODEL_PROVIDERS: 'cloudflare', AI: { run: async () => new ReadableStream({ start(controller) { for (const byte of bytes) controller.enqueue(new Uint8Array([byte])); controller.close(); } }) } };
    await run({ model: '@cf/qwen/qwen3.8-27b' });
    expect(database.prepare('SELECT content FROM project_files').get()?.content).toContain('سلام');
    expect(events[events.length - 1]?.chunk?.done).toBe(true);
    expect(events.some(event => event.type === 'trigger-auto-reply')).toBe(false);
  });

  it('cancels a stalled Workers AI stream and unlocks the project after stop', async () => {
    const { agent, connection } = createAgent();
    const cancel = vi.fn();
    const binding = vi.fn(async () => new ReadableStream({ cancel }));
    agent.env = { REGISTRY: budgetRegistry(), REQUIRED_MODEL_PROVIDERS: 'cloudflare', AI: { run: binding } };
    const pending = agent.onMessage(connection, JSON.stringify({ prompt: 'Build a calendar', model: '@cf/qwen/qwen3.8-27b' }));
    await vi.waitFor(() => expect(binding).toHaveBeenCalledOnce());
    await agent.onMessage(connection, JSON.stringify({ type: 'stop' }));
    await pending;
    expect(cancel).toHaveBeenCalledOnce();
    expect(agent.generationLock.isHeld).toBe(false);
  });

  it('reports SSE provider errors without successful completion', async () => {
    const { agent, events, run } = createAgent();
    agent.env = { REGISTRY: budgetRegistry(), REQUIRED_MODEL_PROVIDERS: 'cloudflare', AI: { run: async () => new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('data: {"error":{"message":"Quota exceeded"}}\n\n')); controller.close(); } }) } };
    await run({ model: '@cf/qwen/qwen3.8-27b' });
    expect(events.find(event => event.type === 'error')?.error).toContain('Quota exceeded');
    expect(events.some(event => event.chunk?.done)).toBe(false);
  });

  it('does not retry a non-token provider failure across the token ladder', async () => {
    const { agent, run, events } = createAgent();
    const binding = vi.fn(async () => { throw new Error('Authentication failed'); });
    agent.env = { REGISTRY: budgetRegistry(), REQUIRED_MODEL_PROVIDERS: 'cloudflare', AI: { run: binding } };
    await run({ model: '@cf/qwen/qwen3.8-27b' });
    expect(binding).toHaveBeenCalledOnce();
    expect(events.find(event => event.type === 'error')?.error).toBe('Authentication failed');
  });
});

describe('Uploaded assets reach both agent provider paths', () => {
  function insertUpload(database: DatabaseSync) {
    const id = crypto.randomUUID(); const file = { id, name: 'note.txt', mime: 'text/plain', text: 'Use a readable heading', size: 21, dataUrl: 'data:text/plain;base64,VXNlIGEgcmVhZGFibGUgaGVhZGluZw==' };
    database.prepare('INSERT INTO builder_attachments VALUES (?,?,?,?)').run(id, JSON.stringify(file), file.size, Date.now()); return file;
  }
  it('native SDK tool calls copy uploaded bytes into exported project source', async () => {
    const { database, run, events } = createAgent(); const file = insertUpload(database); let step = 0;
    providerState.model = new MockLanguageModelV4({ doStream: async options => {
      expect(JSON.stringify(options.prompt)).toContain('Use a readable heading');
      return step++ === 0 ? response('', { toolName: 'use_attachment', input: { id: file.id } }) : response('The uploaded file is available in your app.');
    } });
    await run({ attachmentIds: [file.id] }, 'Add my uploaded file as a download');
    expect(database.prepare('SELECT content FROM project_files WHERE path=?').get(`/src/assets/uploads/${file.id}.0.js`)?.content).toContain(file.dataUrl);
    expect(events.filter(event => event.type === 'error')).toEqual([]);
  });
  it('default Workers AI executes attachment tools and saves the returned application', async () => {
    const { agent, database, run, events } = createAgent(); const file = insertUpload(database);
    const binding = vi.fn().mockResolvedValueOnce({ choices: [{ message: { tool_calls: [{ id: 'asset', type: 'function', function: { name: 'use_attachment', arguments: JSON.stringify({ id: file.id }) } }] } }] }).mockResolvedValueOnce({ choices: [{ message: { content: '<file path="/src/App.jsx">export default () => <h1>Uploaded file app</h1>;</file>' } }] });
    agent.env = { REGISTRY: budgetRegistry(), REQUIRED_MODEL_PROVIDERS: 'cloudflare', AI: { run: binding } };
    await run({ model: undefined, attachmentIds: [file.id] }, 'Add my uploaded file');
    expect(binding.mock.calls.every(call => call[0] === '@cf/deepseek-ai/deepseek-v4-pro-0813')).toBe(true);
    expect(database.prepare('SELECT content FROM project_files WHERE path=?').get(`/src/assets/uploads/${file.id}.0.js`)?.content).toContain(file.dataUrl);
    expect(database.prepare('SELECT content FROM project_files WHERE path=?').get('/src/App.jsx')?.content).toContain('Uploaded file app');
    expect(events.filter(event => event.type === 'error')).toEqual([]);
  });
});

describe('Project tool parity and recovery from prose-only builds', () => {
  const prompt = 'Build an app: Real-time Chat App - React UI with a WebSocket backend and user presence';
  const protocol = 'I will inspect the project. <｜DSML｜><tool_call>{"name":"read_file","arguments":{"path":"/src/App.tsx"}}</tool_call></｜DSML｜>';
  const frontend = "import { useEffect, useState } from 'react'; export default function App() { const [online, setOnline] = useState(0); useEffect(() => { const socket = new WebSocket('ws://localhost:3001'); socket.onmessage = event => { const data = JSON.parse(event.data); if (data.type === 'presence') setOnline(data.online); }; return () => socket.close(); }, []); return <main><h1>Team chat</h1><p>{online} online</p></main>; }";
  const backend = "import { WebSocketServer, WebSocket } from 'ws'; const server = new WebSocketServer({ port: 3001 }); const presence = () => { const message = JSON.stringify({ type: 'presence', online: server.clients.size }); for (const client of server.clients) if (client.readyState === WebSocket.OPEN) client.send(message); }; server.on('connection', socket => { presence(); socket.on('close', presence); });";
  const call = (name: string, args: unknown) => ({ choices: [{ message: { tool_calls: [{ id: crypto.randomUUID(), type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }] });
  const files = `<file path="/src/App.tsx">${frontend}</file><file path="/server/index.ts">${backend}</file>`;
  const stream = (content: string) => new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ response: content })}\n\ndata: [DONE]\n\n`)); controller.close(); } });

  it('lets the default model inspect and write React and WebSocket files without uploaded attachments', async () => {
    const { agent, database, events, run } = createAgent();
    database.prepare('INSERT INTO project_files (path, content) VALUES (?, ?)').run('/src/App.tsx', 'export default () => null;');
    const binding = vi.fn()
      .mockResolvedValueOnce(call('list_files', {}))
      .mockResolvedValueOnce(call('read_file', { path: '/src/App.tsx' }))
      .mockResolvedValueOnce(call('write_file', { path: '/src/App.tsx', content: frontend }))
      .mockResolvedValueOnce(call('write_file', { path: '/server/index.ts', content: backend }))
      .mockResolvedValueOnce({ response: 'Added the React UI, WebSocket backend and presence events.' });
    agent.env = { REGISTRY: budgetRegistry(), REQUIRED_MODEL_PROVIDERS: 'cloudflare', AI: { run: binding } };
    await run({ model: undefined }, prompt);
    expect(binding.mock.calls[0][1].tools.map((entry: any) => entry.function.name)).toEqual(expect.arrayContaining(['list_files', 'read_file', 'write_file', 'edit_file', 'check_syntax']));
    expect(database.prepare('SELECT content FROM project_files WHERE path=?').get('/src/App.tsx')?.content).toBe(frontend);
    expect(database.prepare('SELECT content FROM project_files WHERE path=?').get('/server/index.ts')?.content).toBe(backend);
    expect(binding.mock.calls.every(([model]) => model === '@cf/deepseek-ai/deepseek-v4-pro-0813')).toBe(true);
    expect(events.filter(event => event.type === 'error' || event.type === 'trigger-auto-reply')).toEqual([]);
  });

  it('retries a DSML-only build on the same Workers AI model with tools disabled', async () => {
    const { agent, database, events, run } = createAgent();
    const binding = vi.fn().mockResolvedValueOnce({ response: protocol }).mockResolvedValueOnce(stream(files));
    agent.env = { REGISTRY: budgetRegistry(), REQUIRED_MODEL_PROVIDERS: 'cloudflare', AI: { run: binding } };
    await run({ model: undefined }, prompt);
    const retry = events.find(event => event.type === 'trigger-auto-reply');
    expect(retry?.message).toContain('[AUTO-RETRY-FULL-APP]');
    expect(JSON.stringify(events)).not.toContain('DSML｜');
    await run({ model: undefined }, retry.message);
    expect(binding).toHaveBeenCalledTimes(2);
    expect(binding.mock.calls[1][1].tools).toBeUndefined();
    expect(binding.mock.calls[1][1].messages[0].content).toContain('FILE-OUTPUT RECOVERY');
    expect(database.prepare('SELECT content FROM project_files WHERE path=?').get('/server/index.ts')?.content).toBe(backend);
    expect(events.filter(event => event.type === 'error')).toEqual([]);
  });

  it('also disables native SDK tools on the bounded file-output retry', async () => {
    const { events, run, database } = createAgent();
    providerState.model = new MockLanguageModelV4({ doStream: [response(protocol), response(files)] });
    await run({}, prompt);
    const retry = events.find(event => event.type === 'trigger-auto-reply');
    await run({}, retry.message);
    expect(providerState.model.doStreamCalls[1].tools).toBeUndefined();
    expect(providerState.model.doStreamCalls[1].toolChoice).toEqual({ type: 'none' });
    expect(database.prepare('SELECT content FROM project_files WHERE path=?').get('/src/App.tsx')?.content).toBe(frontend);
    expect(events.filter(event => event.type === 'error')).toEqual([]);
  });

  it('validates Workers AI project-tool arguments before touching files', async () => {
    const { agent, database, run } = createAgent();
    const binding = vi.fn().mockResolvedValueOnce(call('write_file', { path: '/src/broken.ts', content: { bad: true } })).mockResolvedValueOnce({ response: 'Invalid arguments.' });
    agent.env = { REGISTRY: budgetRegistry(), REQUIRED_MODEL_PROVIDERS: 'cloudflare', AI: { run: binding } };
    await run({ model: undefined }, prompt);
    expect(database.prepare('SELECT path FROM project_files').all()).toEqual([]);
    const result = binding.mock.calls[1][1].messages.find((message: any) => message.role === 'tool');
    expect(JSON.parse(result.content).error).toContain('Invalid tool arguments');
  });

  it.each(['cloudflare', 'native'])('ends a failed %s recovery without another retry or a successful completion', async provider => {
    const { agent, database, events, run } = createAgent();
    if (provider === 'cloudflare') agent.env = { REGISTRY: budgetRegistry(), REQUIRED_MODEL_PROVIDERS: 'cloudflare', AI: { run: vi.fn().mockResolvedValue(stream(protocol)) } };
    else providerState.model = new MockLanguageModelV4({ doStream: response(protocol) });
    await run(provider === 'cloudflare' ? { model: undefined } : {}, '[AUTO-RETRY-FULL-APP] ' + prompt);
    expect(events.filter(event => event.type === 'error')).toHaveLength(1);
    expect(events.some(event => event.type === 'trigger-auto-reply' || (event.type === 'stream' && event.chunk.done))).toBe(false);
    expect(database.prepare('SELECT status FROM generation_usage').get()?.status).toBe('failed');
    expect(database.prepare('SELECT path FROM project_files').all()).toEqual([]);
    expect(JSON.stringify(events)).not.toContain('DSML｜');
  });
});

// ---------------------------------------------------------------------------
// Advanced agent tracking: timing, edit guards, file limits, extraction counts
// ---------------------------------------------------------------------------

describe('Advanced agent tracking: 5 precision tests', () => {
  it('records first_response_at only after the first non-empty text chunk, not at generation start', async () => {
    const { database, run } = createAgent();
    const started_before = Date.now();
    providerState.model = new MockLanguageModelV4({ doStream: response('Here is your app.\n<file path="/src/App.tsx">export default () => <h1>Done</h1>;</file>') });
    await run();
    const row = database.prepare('SELECT started_at, first_response_at, finished_at, status, provider_calls FROM generation_usage').get() as any;
    expect(row.status).toBe('completed');
    expect(row.first_response_at).toBeGreaterThanOrEqual(started_before);
    expect(row.first_response_at).toBeGreaterThan(row.started_at);
    expect(row.first_response_at).toBeLessThanOrEqual(row.finished_at);
    expect(row.provider_calls).toBeGreaterThanOrEqual(1);
  });

  it('rejects edit_file when the search text is not found in the inspected file', async () => {
    const { database, run, events } = createAgent();
    const original = 'export const greeting = "hello";\n';
    database.prepare('INSERT INTO project_files (path, content) VALUES (?, ?)').run('/src/App.tsx', original);
    let capturedError: string | undefined;
    providerState.model = new MockLanguageModelV4({ doStream: async (options: any) => {
      if (options.prompt?.some?.((m: any) => m.role === 'tool' && typeof m.content === 'string' && m.content.includes('search text'))) {
        capturedError = options.prompt.find((m: any) => m.role === 'tool')?.content;
        return response('Could not apply the edit. The search text was not found.');
      }
      return response('', { toolName: 'edit_file', input: { path: '/src/App.tsx', edits: [{ search: 'const NOT_PRESENT = true', replace: 'const REPLACED = true' }] } });
    } });
    await run({}, 'Fix the greeting');
    // File must not be modified if edit search failed
    expect(database.prepare('SELECT content FROM project_files WHERE path=?').get('/src/App.tsx')?.content).toBe(original);
    // Error must have been communicated back to the model
    expect(events.filter(event => event.type === 'error')).toEqual([]);
  });

  it('rejects edit_file when the search text is ambiguous (matches more than once)', async () => {
    const { database, run } = createAgent();
    const original = 'const x = 1;\nconst x = 1;\n';
    database.prepare('INSERT INTO project_files (path, content) VALUES (?, ?)').run('/src/utils.ts', original);
    // Step 1: read_file; Step 2: ambiguous edit_file; Step 3: finish
    providerState.model = new MockLanguageModelV4({ doStream: [
      response('', { toolName: 'read_file', input: { path: '/src/utils.ts' } }),
      response('', { toolName: 'edit_file', input: { path: '/src/utils.ts', edits: [{ search: 'const x = 1;', replace: 'const x = 2;' }] } }),
      response('The edit failed due to ambiguous search text. I will use a more specific search.'),
    ] });
    await run({}, 'Fix duplicate constants');
    // Verify the error reached the model in the third call
    const thirdCallPrompt = providerState.model.doStreamCalls[2]?.prompt || [];
    const editToolResult = thirdCallPrompt.find((m: any) => {
      if (m.role !== 'tool') return false;
      const content = Array.isArray(m.content) ? JSON.stringify(m.content) : String(m.content);
      return content.includes('ambiguous') || content.includes('search text');
    });
    expect(editToolResult).toBeDefined();
    // Original file must be preserved when the ambiguous match is detected
    expect(database.prepare('SELECT content FROM project_files WHERE path=?').get('/src/utils.ts')?.content).toBe(original);
    expect(providerState.model.doStreamCalls).toHaveLength(3);
  });

  it('does not persist an oversized file and returns a size-limit error to the model', async () => {
    const { database, run, events } = createAgent();
    const largeContent = 'x'.repeat(2 * 1024 * 1024 + 1);
    let toolResponse: string | null = null;
    providerState.model = new MockLanguageModelV4({ doStream: async (options: any) => {
      const toolMsg = options.prompt?.find?.((m: any) => m.role === 'tool');
      if (toolMsg) {
        toolResponse = typeof toolMsg.content === 'string' ? toolMsg.content : JSON.stringify(toolMsg.content);
        return response('The file was too large; I will reduce it.');
      }
      return response('', { toolName: 'write_file', input: { path: '/src/huge.ts', content: largeContent } });
    } });
    await run({}, 'Write a huge file');
    expect(database.prepare("SELECT content FROM project_files WHERE path='/src/huge.ts'").get()).toBeUndefined();
    expect(toolResponse).not.toBeNull();
    expect(toolResponse).toMatch(/byte limit|too large|exceeds/i);
    expect(events.filter(event => event.type === 'error')).toEqual([]);
  });

  it('counts provider_calls equal to the number of model round trips in a multi-step generation', async () => {
    const { database, run } = createAgent();
    const src1 = 'export default function App() { return <h1>Step1</h1>; }';
    const src2 = 'export default function App() { return <h1>Step2</h1>; }';
    let step = 0;
    providerState.model = new MockLanguageModelV4({ doStream: async () => {
      if (step++ === 0) return response(`<file path="/src/App.tsx">${src1}</file>`, { toolName: 'write_file', input: { path: '/src/styles.css', content: 'body {}' } });
      return response(`<file path="/src/App.tsx">${src2}</file>`);
    } });
    await run({}, 'Build a two-step app');
    const row = database.prepare('SELECT provider_calls, status FROM generation_usage').get() as any;
    expect(row.status).toBe('completed');
    expect(row.provider_calls).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Most important correctness: scaffold, extraction, truncation, file guards
// ---------------------------------------------------------------------------

describe('Most important correctness: 5 critical path tests', () => {
  it('full-stack scaffold includes worker, D1 migration, request and database verification steps', async () => {
    const { agent, database, connection } = createAgent();
    agent.connectionUserIds.set(connection.id, 'scaffold-owner');
    agent.env.RUNTIME = { fetch: vi.fn(async () => Response.json({ enabled: true, availability: { state: 'ready', message: 'Ready' } })) };
    agent.runGeneration = vi.fn();
    await agent.onMessage(connection, JSON.stringify({ prompt: 'Build a full stack task manager with auth', idempotencyKey: 'scaffold-test' }));
    const verifyRaw = database.prepare('SELECT content FROM project_files WHERE path=?').get('/brainhalf.verify.json')?.content as string | undefined;
    expect(verifyRaw).toBeTruthy();
    const verify = JSON.parse(verifyRaw!);
    expect(verify.version).toBe(1);
    const types = (verify.steps as Array<{ type: string }>).map(s => s.type);
    // Scaffold always includes at minimum request and database verification steps
    expect(types).toContain('request');
    expect(types).toContain('database');
    // Worker and migration files must be scaffolded
    expect(database.prepare('SELECT path FROM project_files WHERE path=?').get('/worker/index.ts')).toBeTruthy();
  });

  it('extractAndSaveFiles correctly counts multiple <file> blocks in one response', async () => {
    const { database, events, run } = createAgent();
    const files = [
      ['src/App.tsx', 'export default function App() { return <h1>App</h1>; }'],
      ['src/Header.tsx', 'export default function Header() { return <header>H</header>; }'],
      ['src/Footer.tsx', 'export default function Footer() { return <footer>F</footer>; }'],
    ];
    const combined = files.map(([path, content]) => `<file path="/${path}">${content}</file>`).join('\n');
    providerState.model = new MockLanguageModelV4({ doStream: response(combined) });
    await run({}, 'Build a three-file app');
    for (const [path, content] of files) {
      expect(database.prepare('SELECT content FROM project_files WHERE path=?').get(`/${path}`)?.content).toBe(content);
    }
    expect(events.filter(event => event.type === 'file_updated').length).toBeGreaterThanOrEqual(0);
    expect(events.filter(event => event.type === 'error')).toEqual([]);
  });

  it('triggers auto-reply when response ends with an unclosed <file> tag', async () => {
    const { events, run } = createAgent();
    const truncated = 'Here is your app.\n<file path="/src/App.tsx">export default function App() {';
    providerState.model = new MockLanguageModelV4({ doStream: response(truncated) });
    await run({}, 'Build an app');
    const autoReply = events.find(event => event.type === 'trigger-auto-reply');
    expect(autoReply).toBeDefined();
    expect(autoReply?.message).toMatch(/unfinished file|regenerate/i);
  });

  it('edit_file guard: returns error when file was not read before editing', async () => {
    const { database, run } = createAgent();
    database.prepare('INSERT INTO project_files (path, content) VALUES (?, ?)').run('/src/config.ts', 'export const HOST = "localhost";\n');
    let toolError: string | null = null;
    providerState.model = new MockLanguageModelV4({ doStream: async (options: any) => {
      const toolMsg = options.prompt?.find?.((m: any) => m.role === 'tool');
      if (toolMsg) {
        toolError = typeof toolMsg.content === 'string' ? toolMsg.content : JSON.stringify(toolMsg.content);
        return response('Could not edit without reading first.');
      }
      // Try to edit without reading
      return response('', { toolName: 'edit_file', input: { path: '/src/config.ts', edits: [{ search: 'localhost', replace: 'production.example.com' }] } });
    } });
    await run({}, 'Update config host');
    expect(toolError).not.toBeNull();
    expect(toolError).toMatch(/read.*file|before editing/i);
    // File must remain unchanged
    expect(database.prepare('SELECT content FROM project_files WHERE path=?').get('/src/config.ts')?.content).toBe('export const HOST = "localhost";\n');
  });

  it('does not start a new generation while a generation lock is already held', async () => {
    const { agent, connection } = createAgent();
    let releaseFirst!: () => void;
    agent.runGeneration = vi.fn(() => new Promise<void>(resolve => { releaseFirst = resolve; }));
    // Start first generation
    const first = agent.onMessage(connection, JSON.stringify({ prompt: 'Build app A', idempotencyKey: 'gen-a' }));
    await vi.waitFor(() => expect(agent.runGeneration).toHaveBeenCalledTimes(1));
    // Attempt second concurrent generation on same project
    const second = agent.onMessage(connection, JSON.stringify({ prompt: 'Build app B', idempotencyKey: 'gen-b' }));
    await second;
    expect(agent.runGeneration).toHaveBeenCalledTimes(1);
    releaseFirst();
    await first;
  });
});

describe('Failed first prompts are preserved in server history', () => {
  const failingModel = () => new MockLanguageModelV4({ doStream: async () => { throw new APICallError({ message: 'boom', url: 'https://provider.example', requestBodyValues: {}, statusCode: 500, isRetryable: false }); } });

  it('preserves the user prompt when a non-429 provider failure kills the first generation', async () => {
    const { run, events, database } = createAgent();
    providerState.model = failingModel();
    await run({}, 'Build a rocket tracker');
    const failure = events.find(event => event.type === 'error');
    expect(failure).toBeDefined();
    // Regression: only the 429 branch used to save the prompt, so any other
    // failure before the first completed stage left server history empty.
    const rows = database.prepare('SELECT role, content FROM messages ORDER BY id').all();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ role: 'user', content: 'Build a rocket tracker' });
    expect(rows[1]).toMatchObject({ role: 'assistant' });
    expect(String(rows[1].content)).not.toHaveLength(0);
  });

  it('does not duplicate the prompt when a turn was already saved for the epoch', async () => {
    const { agent, connection, database } = createAgent();
    providerState.model = failingModel();
    const epoch = agent.writeEpoch.begin();
    agent.turnSavedForEpoch = epoch; // simulate a completed stage-1 save
    await agent.runGeneration(connection, { model: 'claude-sonnet-6' }, 'system', 'Build a rocket tracker', epoch, false);
    expect(database.prepare('SELECT COUNT(*) AS n FROM messages').get()?.n).toBe(0);
  });

  it('resets the truncation-retry streak when a new user prompt starts', async () => {
    const { agent, run } = createAgent();
    agent.truncationRetries = 2;
    providerState.model = new MockLanguageModelV4({ doStream: async () => response('<file path="/src/App.tsx">export default () => <h1>Hi</h1>;</file>') });
    await run();
    expect(agent.truncationRetries).toBe(0);
  });

  it('keeps the truncation-retry streak across the server\u2019s own continuation prompt', async () => {
    const { agent, connection } = createAgent();
    agent.truncationRetries = 1;
    providerState.model = failingModel();
    await agent.runGeneration(
      connection,
      { model: 'claude-sonnet-6' },
      'system',
      'The previous response ended with an unfinished file. Regenerate the rest.',
      agent.writeEpoch.begin(),
      false,
    );
    expect(agent.truncationRetries).toBe(1);
  });
});
