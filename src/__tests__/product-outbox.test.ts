import { expect, it, vi } from 'vitest';
import { sqliteStorage } from './helpers/storage';
vi.mock('agents', () => ({ Agent: class {} }));
vi.mock('cloudflare:workers', () => ({ tracing: {} }));
import { ChatAgent } from '../agent';

it('retains undelivered generation evidence and retries it after reconstruction', async () => {
  const storage = sqliteStorage(); storage.sql.exec('CREATE TABLE product_outbox(id TEXT PRIMARY KEY,event TEXT NOT NULL)');
  const fetch = vi.fn(async () => new Response(null, { status: 503 }));
  const scheduled = new Map();
  const deliveries: Promise<unknown>[] = [];
  const create = () => {
    const agent: any = Object.create(ChatAgent.prototype);
    agent.ctx = { waitUntil: (pending: Promise<unknown>) => deliveries.push(pending) };
    agent.env = { REGISTRY: { idFromName: (name: string) => name, get: () => ({ fetch }) } };
    agent.runSql = (parts: TemplateStringsArray, ...args: any[]) => storage.sql.exec(parts.join('?'), ...args).toArray();
    agent.scheduleEvery = vi.fn(async () => { scheduled.set('retry', { id: 'retry', callback: 'flushProductOutcomes' }); });
    agent.listSchedules = async () => [...scheduled.values()];
    agent.cancelSchedule = async (id: string) => scheduled.delete(id);
    return agent;
  };
  const event = { id: 'generation', ownerId: 'owner', projectId: 'project', kind: 'generation_started', at: Date.now() };
  await create().queueProductOutcome(event);
  await Promise.all(deliveries);
  expect(storage.sql.exec('SELECT * FROM product_outbox').toArray()).toHaveLength(1);
  expect(scheduled.size).toBe(1);
  fetch.mockResolvedValue(new Response(null, { status: 200 }));
  await create().flushProductOutcomes();
  expect(storage.sql.exec('SELECT * FROM product_outbox').toArray()).toHaveLength(0);
  expect(scheduled.size).toBe(0);
  expect(fetch).toHaveBeenCalledTimes(2);
});

it('does not wait for remote analytics delivery before allowing generation to proceed', async () => {
  const storage = sqliteStorage(); storage.sql.exec('CREATE TABLE product_outbox(id TEXT PRIMARY KEY,event TEXT NOT NULL)');
  const pending: Promise<unknown>[] = [];
  let finish!: (response: Response) => void;
  const agent: any = Object.create(ChatAgent.prototype);
  agent.runSql = (parts: TemplateStringsArray, ...args: any[]) => storage.sql.exec(parts.join('?'), ...args).toArray();
  agent.env = { REGISTRY: { idFromName: (name: string) => name, get: () => ({ fetch: () => new Promise<Response>(resolve => { finish = resolve; }) }) } };
  agent.scheduleEvery = vi.fn(async () => {});
  agent.listSchedules = async () => [];
  agent.ctx = { waitUntil: (delivery: Promise<unknown>) => pending.push(delivery) };
  await agent.queueProductOutcome({ id: 'generation', ownerId: 'owner', projectId: 'project', kind: 'generation_started', at: Date.now() });
  expect(pending).toHaveLength(1);
  expect(storage.sql.exec('SELECT * FROM product_outbox').toArray()).toHaveLength(1);
  finish(new Response(null, { status: 200 }));
  await Promise.all(pending);
  expect(storage.sql.exec('SELECT * FROM product_outbox').toArray()).toHaveLength(0);
});
