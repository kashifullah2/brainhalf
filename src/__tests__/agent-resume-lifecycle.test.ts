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
  database.exec(`CREATE TABLE generation_jobs (
    id TEXT PRIMARY KEY, prompt TEXT NOT NULL, model TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'running',
    completed_files TEXT NOT NULL DEFAULT '[]', error TEXT, resume_count INTEGER NOT NULL DEFAULT 0,
    parent_job_id TEXT, started_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`);
  database.exec('CREATE INDEX idx_generation_jobs_status ON generation_jobs(status, updated_at DESC)');
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

const auth401 = () => { throw new APICallError({ message: 'invalid x-api-key', url: 'https://provider.example', requestBodyValues: {}, statusCode: 401, isRetryable: false }); };

describe('resumable generations', () => {
  it('checkpoints tool-written files and marks a provider interruption resumable', async () => {
    const { database, events, run } = createAgent();
    let step = 0;
    providerState.model = new MockLanguageModelV4({
      doStream: async () => {
        if (step++ === 0) return response('', { toolName: 'write_file', input: { path: '/src/App.tsx', content: 'export default function App() { return <h1>Hi</h1>; }' } });
        throw new APICallError({ message: 'Provider unavailable', url: 'https://provider.example', requestBodyValues: {}, statusCode: 503, isRetryable: true });
      },
    });
    await run({ max_steps: 2 });
    // The file itself is durable.
    expect(database.prepare("SELECT content FROM project_files WHERE path='/src/App.tsx'").get()?.content).toContain('<h1>Hi</h1>');
    // The job row records the interruption and the completed file.
    const job = database.prepare('SELECT status, completed_files, error FROM generation_jobs').get() as any;
    expect(job.status).toBe('interrupted');
    expect(JSON.parse(job.completed_files)).toEqual(['/src/App.tsx']);
    // The stored error is the classified provider message — the banner pairs
    // it with its own "nothing was lost" reassurance.
    expect(String(job.error)).toMatch(/temporarily overloaded/i);
    // The client gets a resumable interruption, not a dead end.
    const interrupted = events.find(event => event.type === 'generation_interrupted');
    expect(interrupted).toMatchObject({ resumable: true, job: { completedFiles: 1, resumesLeft: 3 } });
    expect(String(interrupted.job.error)).toMatch(/temporarily overloaded/i);
  });

  it('marks an authentication failure terminal and never resumable', async () => {
    const { database, events, run } = createAgent();
    providerState.model = new MockLanguageModelV4({ doStream: auth401 });
    await run();
    const job = database.prepare('SELECT status FROM generation_jobs').get() as any;
    expect(job.status).toBe('failed');
    const interrupted = events.find(event => event.type === 'generation_interrupted');
    expect(interrupted).toMatchObject({ resumable: false });
    expect(interrupted.job).toBeNull();
  });

  it('marks a completed generation complete so it can never be resumed', async () => {
    const { database, events, run } = createAgent();
    providerState.model = new MockLanguageModelV4({
      doStream: [response('<file path="/src/App.tsx">export default function App() { return <h1>Done</h1>; }</file>')],
    });
    await run({ max_steps: 1 });
    const job = database.prepare('SELECT status, completed_files FROM generation_jobs').get() as any;
    expect(job.status).toBe('complete');
    expect(JSON.parse(job.completed_files)).toEqual(['/src/App.tsx']);
    expect(events.some(event => event.type === 'generation_interrupted')).toBe(false);
  });

  it('does not checkpoint files written outside a generation', async () => {
    const { agent, database } = createAgent();
    agent.upsertFile('/src/manual.ts', 'export const x = 1;', 'connection', 1);
    expect(database.prepare('SELECT COUNT(*) AS n FROM generation_jobs').get()).toEqual({ n: 0 });
    expect(database.prepare("SELECT content FROM project_files WHERE path='/src/manual.ts'").get()?.content).toBe('export const x = 1;');
  });
});
