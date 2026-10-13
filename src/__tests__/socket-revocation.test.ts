import { describe, expect, it, vi } from 'vitest';
vi.mock('cloudflare:workers', () => ({ tracing: {} }));
vi.mock('agents', () => ({ Agent: class {} }));
import { ChatAgent } from '../agent';
import { injectUserId } from '../lib/auth';
import { WriteEpoch } from '../lib/concurrency';

function fixture() {
  let active = true; let owner = true;
  const fetch = vi.fn(async (url: string) => url.includes('/sessions/')
    ? Response.json({ userId: 'alice' }, { status: active ? 200 : 401 })
    : Response.json({ ownerId: owner ? 'alice' : 'someone-else' }));
  const agent: any = Object.create(ChatAgent.prototype);
  agent.writeEpoch = new WriteEpoch();
  agent.name = 'project'; agent.env = { REGISTRY: { idFromName: () => 'auth', get: () => ({ fetch }) } };
  agent.connectionUserIds = new Map(); agent.pendingAuth = new Map(); agent.authCache = new Map(); agent.backendReadyCache = null; agent.ensureSchema = vi.fn();
  const connection = { id: 'socket', state: { userId: 'alice', sessionHash: 'a'.repeat(64) } as { userId: string; sessionHash: string; transientAuthFailures?: number }, send: vi.fn(), close: vi.fn(), setState: vi.fn((s: unknown) => { connection.state = s as typeof connection.state; }) };
  return { agent, connection, fetch, revoke: () => { active = false; }, transfer: () => { owner = false; } };
}
describe('WebSocket session and ownership revocation', () => {
  it('accepts an authenticated hibernated connection, then refuses commands after logout', async () => {
    const { agent, connection, revoke } = fixture();
    await agent.onMessage(connection, '{"type":"ping"}');
    expect(connection.send).toHaveBeenCalledWith('{"type":"pong"}');
    connection.send.mockClear(); revoke();
    agent.authCache.clear();
    await agent.onMessage(connection, '{"type":"ping"}');
    expect(connection.send).not.toHaveBeenCalled(); expect(connection.close).toHaveBeenCalledWith(4401, expect.any(String));
    expect(agent.connectionUserIds.size).toBe(0);
  });
  it('rejects a revoked owner immediately without a transient-failure counter', async () => {
    const { agent, connection, transfer } = fixture(); transfer();
    expect(await agent.authorizeConnection(connection)).toBe(false);
    expect(connection.close).toHaveBeenCalledWith(4401, expect.any(String));
  });
  it('tolerates a single transient Registry failure — connection stays open, counter increments', async () => {
    const { agent, connection, fetch } = fixture();
    // Simulate a connection that was already authenticated via onConnect.
    agent.connectionUserIds.set(connection.id, 'alice');
    fetch.mockRejectedValueOnce(new Error('Registry cold start'));
    const ok = await agent.authorizeConnection(connection, true);
    expect(ok).toBe(true);
    expect(connection.close).not.toHaveBeenCalled();
    // Existing auth entry preserved.
    expect(agent.connectionUserIds.has(connection.id)).toBe(true);
    expect((connection.state as any).transientAuthFailures).toBe(1);
  });
  it('tolerates two consecutive transient failures before the third closes with 4401', async () => {
    const { agent, connection, fetch } = fixture();
    // Prime the connectionUserIds map so the connection looks authenticated.
    agent.connectionUserIds.set(connection.id, 'alice');
    fetch.mockRejectedValue(new Error('timeout'));
    expect(await agent.authorizeConnection(connection, true)).toBe(true);
    expect((connection.state as any).transientAuthFailures).toBe(1);
    agent.authCache.clear();
    expect(await agent.authorizeConnection(connection, true)).toBe(true);
    expect((connection.state as any).transientAuthFailures).toBe(2);
    agent.authCache.clear();
    expect(await agent.authorizeConnection(connection, true)).toBe(false);
    expect(connection.close).toHaveBeenCalledWith(4401, expect.any(String));
    expect(agent.connectionUserIds.has(connection.id)).toBe(false);
  });
  it('resets the transient failure counter after a successful auth', async () => {
    const { agent, connection, fetch } = fixture();
    agent.connectionUserIds.set(connection.id, 'alice');
    // Seed a failure count via connection.state.
    connection.state = { ...connection.state, transientAuthFailures: 2 };
    // Next call succeeds.
    fetch.mockResolvedValueOnce(Response.json({ userId: 'alice' }));
    expect(await agent.authorizeConnection(connection, true)).toBe(true);
    expect((connection.state as any).transientAuthFailures).toBe(0);
    expect(connection.close).not.toHaveBeenCalled();
  });
  it('does not trust a legacy cached user ID without the originating session', async () => {
    const { agent, connection, fetch } = fixture(); agent.connectionUserIds.set(connection.id, 'alice');
    expect(await agent.authorizeConnection({ ...connection, state: 'alice', uri: 'https://internal/agent?_uid=alice' })).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('replaces client-supplied session digests at the edge', () => {
    const request = new Request('https://brainhalf.com/agents/chat/p?_sid=forged&_uid=evil');
    expect(new URL(injectUserId(request, 'alice').url).searchParams.has('_sid')).toBe(false);
    expect(new URL(injectUserId(request, 'alice', 'a'.repeat(64)).url).searchParams.get('_sid')).toBe('a'.repeat(64));
  });
});
