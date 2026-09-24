import { describe, expect, it, vi } from 'vitest';
vi.mock('agents', () => ({ Agent: class {} }));
vi.mock('cloudflare:workers', () => ({ tracing: {} }));
import { ChatAgent } from '../agent';
import { BusyLock, WriteEpoch } from '../lib/concurrency';
import { sqliteStorage } from './helpers/storage';

function fixture(owner = 'owner') {
  const storage = sqliteStorage(); storage.database.exec('CREATE TABLE private_data(secret TEXT); INSERT INTO private_data VALUES (\'private\')');
  const deleteAll = vi.fn(async () => { storage.database.exec('DROP TABLE private_data'); });
  const close = vi.fn(); const agent: any = Object.create(ChatAgent.prototype);
  agent.name = 'project'; agent.ctx = { storage: { ...storage, deleteAll, deleteAlarm: vi.fn(async () => {}) } };
  agent.env = { REGISTRY: { idFromName: () => 'auth', get: () => ({ fetch: async () => Response.json({ ownerId: owner }) }) } };
  agent.generationLock = new BusyLock(); agent.writeEpoch = new WriteEpoch(); agent.connectionUserIds = new Map([['socket', owner]]); agent.authCache = new Map();
  agent.getConnections = () => [{ close }]; agent.pendingBackups = new Set();
  const request = new Request('https://agent/internal/erase', { method: 'POST', headers: { 'x-auth-user-id': 'owner', 'x-bh-project': 'project' } });
  return { agent, request, deleteAll, close };
}
describe('agent erasure boundary', () => {
  it('requires a matching deletion tombstone owner before touching stored data', async () => {
    const { agent, request, deleteAll } = fixture('other');
    expect((await agent.onRequest(request)).status).toBe(403); expect(deleteAll).not.toHaveBeenCalled();
  });
  it('waits for in-flight backups, closes sockets, erases all storage and refuses later writes', async () => {
    const { agent, request, deleteAll, close } = fixture();
    let finish!: () => void; agent.pendingBackups.add(new Promise<void>(resolve => { finish = resolve; }));
    const result = agent.onRequest(request);
    await vi.waitFor(() => expect(close).toHaveBeenCalled()); expect(deleteAll).not.toHaveBeenCalled();
    finish(); expect((await result).status).toBe(200); expect(deleteAll).toHaveBeenCalledOnce();
    agent.sql = vi.fn();
    expect(() => agent.runSql('CREATE TABLE restored(secret TEXT)')).toThrow('Project deleted');
    expect(agent.sql).not.toHaveBeenCalled();
    expect((await agent.onRequest(new Request('https://agent/api/sync', { method: 'POST', headers: { 'x-auth-user-id': 'owner' } }))).status).toBe(410);
  });
});
