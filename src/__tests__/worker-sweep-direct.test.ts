/**
 * Repro: the hosted-slot sweep must call the pilot coordinator directly
 * (cross-worker binding), not via the runtime worker's entrypoint — the
 * runtime worker may be an older deployment lacking the sweep route, in
 * which case stale slots linger forever and users see a false
 * "10 app spaces are full".
 *
 * Failing test first: GET /api/projects must invoke
 * PILOT.releaseUnknown(ownerId, keepSet) with the full project id set.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('agents', () => ({
  routeAgentRequest: vi.fn(),
  Agent: class MockAgent {},
}));

vi.mock('../agent', () => ({
  ChatAgent: class MockChatAgent {},
}));

import worker from '../worker';
import { issueToken, sha256Hex } from '../lib/crypto';

const SECRET = 'worker-test-secret-must-be-32-chars-or-more';

function mockRegistryWithProjects(projects: Array<{ id: string }>) {
  const stubId = { name: 'auth', toString: () => 'auth' };
  const fetch = vi.fn(async (input: string | Request) => {
    const url = typeof input === 'string' ? new URL(input) : new URL(input.url);
    if (url.pathname.startsWith('/sessions/')) {
      return new Response(JSON.stringify({ userId: 'user-1' }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.pathname === '/projects') {
      return Response.json({ projects });
    }
    return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
  });
  return { idFromName: vi.fn(() => stubId), get: vi.fn(() => ({ fetch })) };
}

describe('hosted-slot sweep via direct pilot binding', () => {
  it('calls PILOT.releaseUnknown with the full keep-set on project list', async () => {
    const releaseUnknown = vi.fn(async (_ownerId: string, _keep: ReadonlySet<string>) => 3);
    const pilotStub = { releaseUnknown };
    const PILOT = { getByName: vi.fn(() => pilotStub) };
    const registry = mockRegistryWithProjects([{ id: 'proj-a' }, { id: 'proj-b' }]);

    const { token } = await issueToken(SECRET, 'user-1');
    await sha256Hex(token); // tokenId unused; session lookup is by hash in mock
    const headers = new Headers({ authorization: `Bearer ${token}` });
    const request = new Request('https://brainhalf.com/api/projects', { headers });

    const response = await worker.fetch(request, {
      SESSION_SECRET: SECRET,
      REGISTRY: registry,
      PILOT,
    } as unknown as import('../worker').PlatformEnv, {} as any);

    expect(response.status).toBe(200);
    expect(PILOT.getByName).toHaveBeenCalledWith('pilot');
    expect(releaseUnknown).toHaveBeenCalledTimes(1);
    const [ownerId, keep] = releaseUnknown.mock.calls[0];
    expect(ownerId).toBe('user-1');
    expect(keep).toBeInstanceOf(Set);
    expect([...keep].sort()).toEqual(['proj-a', 'proj-b']);
  });

  it('does not break project listing when the pilot binding is absent', async () => {
    const registry = mockRegistryWithProjects([{ id: 'proj-a' }]);
    const { token } = await issueToken(SECRET, 'user-1');
    const headers = new Headers({ authorization: `Bearer ${token}` });
    const request = new Request('https://brainhalf.com/api/projects', { headers });

    const response = await worker.fetch(request, {
      SESSION_SECRET: SECRET,
      REGISTRY: registry,
      // no PILOT binding and no RUNTIME binding
    } as unknown as import('../worker').PlatformEnv, {} as any);

    expect(response.status).toBe(200);
    const body = await response.json() as { projects: Array<{ id: string }> };
    expect(body.projects.map(p => p.id)).toEqual(['proj-a']);
  });
});
