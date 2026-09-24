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
  const connection = { id: 'socket', state: { userId: 'alice', sessionHash: 'a'.repeat(64) }, send: vi.fn(), close: vi.fn() };
  return { agent, connection, fetch, revoke: () => { active = false; }, transfer: () => { owner = false; } };
}
describe('WebSocket session and ownership revocation', () => {
  it('accepts an authenticated hibernated connection, then refuses commands after logout', async () => {
    const { agent, connection, revoke } = fixture();
    await agent.onMessage(connection, '{"type":"ping"}');
    expect(connection.send).toHaveBeenCalledWith('{"type":"pong"}');
    connection.send.mockClear(); revoke();
    await agent.onMessage(connection, '{"type":"ping"}');
    expect(connection.send).not.toHaveBeenCalled(); expect(connection.close).toHaveBeenCalledWith(4401, expect.any(String));
    expect(agent.connectionUserIds.size).toBe(0);
  });
  it('rejects a revoked owner and fails closed on registry outages', async () => {
    const { agent, connection, transfer, fetch } = fixture(); transfer();
    expect(await agent.authorizeConnection(connection)).toBe(false);
    fetch.mockRejectedValue(new Error('unavailable'));
    expect(await agent.authorizeConnection(connection)).toBe(false);
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
