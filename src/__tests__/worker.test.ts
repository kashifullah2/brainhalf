import { describe, it, expect, vi } from 'vitest';

vi.mock('agents', () => ({
  routeAgentRequest: vi.fn(),
  Agent: class MockAgent {},
}));

vi.mock('../agent', () => ({
  ChatAgent: class MockChatAgent {},
}));

import worker from '../worker';
import { routeAgentRequest } from 'agents';
import { issueToken, sha256Hex } from '../lib/crypto';

/**
 * The Worker gate is real in these tests (it is the security boundary), so the
 * env needs a SESSION_SECRET plus a stubbed REGISTRY Durable Object that can
 * answer session revocation lookups and ownership checks.
 */
const SECRET = 'worker-test-secret-must-be-32-chars-or-more';

function mockRegistry(opts: { userId?: string; ownerId?: string } = {}) {
  const userId = opts.userId ?? 'user-1';
  const ownerId = opts.ownerId ?? userId;
  const stubId = { name: 'auth', toString: () => 'auth' };
  const fetch = vi.fn(async (input: string | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? new URL(input) : new URL(input.url);
    if (url.pathname.startsWith('/sessions/')) {
      // Revocation lookup keyed by the token hash.
      return new Response(JSON.stringify({ userId }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.pathname === '/projects/owner-check') {
      return new Response(JSON.stringify({ ownerId }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.pathname === '/projects/claim') {
      return new Response(JSON.stringify({ ownerId }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({ error: 'not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  });
  return { idFromName: vi.fn(() => stubId), get: vi.fn(() => ({ fetch })), _fetch: fetch };
}

async function authenticatedRequest(url: string, init: RequestInit = {}) {
  const { token } = await issueToken(SECRET, 'user-1');
  const tokenId = await sha256Hex(token);
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${token}`);
  return { request: new Request(url, { ...init, headers }), tokenId };
}

function envWith(registry: any, extra: Record<string, any> = {}) {
  return { SESSION_SECRET: SECRET, REGISTRY: registry, ...extra };
}

describe('Cloudflare Worker Gateway & Routing', () => {
  it('routes /preview/:id requests to the designated ChatAgent Durable Object', async () => {
    const mockDoFetch = vi.fn().mockResolvedValue(new Response('Preview Content', { status: 200 }));
    const mockDoObj = { fetch: mockDoFetch };
    const mockIdFromName = vi.fn().mockReturnValue('mock-id-123');
    const mockGet = vi.fn().mockReturnValue(mockDoObj);
    const registry = mockRegistry();

    const env = envWith(registry, {
      ChatAgent: { idFromName: mockIdFromName, get: mockGet },
    });

    const { request } = await authenticatedRequest('https://brainhalf.com/preview/proj-alpha/index.html');
    const res = await worker.fetch(request, env, {} as any);

    expect(mockIdFromName).toHaveBeenCalledWith('proj-alpha');
    expect(mockGet).toHaveBeenCalledWith('mock-id-123');
    expect(mockDoFetch).toHaveBeenCalled();
    // The verified user id is forwarded to the Durable Object.
    const forwarded = mockDoFetch.mock.calls[0][0];
    expect(forwarded.headers.get('x-auth-user-id')).toBe('user-1');
    expect(await res.text()).toBe('Preview Content');
  });

  it('routes agent API and websocket requests via routeAgentRequest', async () => {
    const mockAgentResponse = new Response('Agent Routed', { status: 200 });
    vi.mocked(routeAgentRequest).mockResolvedValue(mockAgentResponse as any);
    const registry = mockRegistry();

    const env = envWith(registry, { ChatAgent: { idFromName: vi.fn(), get: vi.fn() } });

    const { request } = await authenticatedRequest('https://brainhalf.com/agents/chat-agent/proj-alpha');
    const res = await worker.fetch(request, env, {} as any);

    // The hooks are passed through so the SDK applies the gate before the
    // request reaches the Durable Object.
    expect(routeAgentRequest).toHaveBeenCalledWith(
      request,
      env,
      expect.objectContaining({ onBeforeConnect: expect.any(Function), onBeforeRequest: expect.any(Function) })
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('Agent Routed');
  });

  it('serves static assets from env.ASSETS when request is not an agent or preview route', async () => {
    vi.mocked(routeAgentRequest).mockResolvedValue(undefined as any);

    const mockAssetResponse = new Response('<html>BrainHalf App</html>', { status: 200 });
    const mockAssetsFetch = vi.fn().mockResolvedValue(mockAssetResponse);

    const env = envWith(mockRegistry(), {
      ChatAgent: { idFromName: vi.fn(), get: vi.fn() },
      ASSETS: { fetch: mockAssetsFetch },
    });

    const req = new Request('https://brainhalf.com/assets/index.js');
    const res = await worker.fetch(req, env, {} as any);

    expect(mockAssetsFetch).toHaveBeenCalledWith(req);
    // The asset is re-issued rather than passed through so the shell security
    // headers can be attached; the body and status must survive the wrap.
    expect(res.status).toBe(mockAssetResponse.status);
    await expect(res.text()).resolves.toBe('<html>BrainHalf App</html>');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Content-Security-Policy')).toContain('script-src');
  });

  it('returns 404 when no assets binding is provided and routeAgentRequest yields undefined', async () => {
    vi.mocked(routeAgentRequest).mockResolvedValue(undefined as any);

    const env = envWith(mockRegistry(), { ChatAgent: { idFromName: vi.fn(), get: vi.fn() } });

    const req = new Request('https://brainhalf.com/unknown');
    const res = await worker.fetch(req, env, {} as any);

    expect(res.status).toBe(404);
    expect(await res.text()).toBe('Not found');
  });

  it('falls back to ChatAgent preview redirect when worker is not in DISPATCHER namespace', async () => {
    const registry = mockRegistry();
    const env = envWith(registry, {
      DISPATCHER: {
        get: vi.fn().mockImplementation(() => {
          throw new Error('Worker not found.');
        }),
      },
      ChatAgent: { idFromName: vi.fn(), get: vi.fn() },
    });

    const { request } = await authenticatedRequest('https://brainhalf.com/p/proj-xpjpet-mu0tk7tr');
    const res = await worker.fetch(request, env, {} as any);

    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('https://brainhalf.com/preview/proj-xpjpet-mu0tk7tr/index.html');
  });

  it('forwards subpath requests to ChatAgent when falling back from DISPATCHER', async () => {
    const mockDoFetch = vi.fn().mockResolvedValue(new Response('/* css */', { status: 200 }));
    const mockDoObj = { fetch: mockDoFetch };
    const mockIdFromName = vi.fn().mockReturnValue('mock-id-456');
    const mockGet = vi.fn().mockReturnValue(mockDoObj);

    const env = envWith(mockRegistry(), {
      DISPATCHER: {
        get: vi.fn().mockImplementation(() => {
          throw new Error('Worker not found.');
        }),
      },
      ChatAgent: {
        idFromName: mockIdFromName,
        get: mockGet,
      },
    });

    const { request } = await authenticatedRequest('https://brainhalf.com/p/proj-xpjpet-mu0tk7tr/src/styles.css');
    const res = await worker.fetch(request, env, {} as any);

    expect(mockIdFromName).toHaveBeenCalledWith('proj-xpjpet-mu0tk7tr');
    expect(mockGet).toHaveBeenCalledWith('mock-id-456');
    expect(mockDoFetch).toHaveBeenCalled();
    const forwardedReq = mockDoFetch.mock.calls[0][0];
    expect(new URL(forwardedReq.url).pathname).toBe('/preview/proj-xpjpet-mu0tk7tr/src/styles.css');
    expect(res.status).toBe(200);
  });
});

describe('P1 Worker auth gate (fail-closed)', () => {
  it('denies an unauthenticated preview request with 401', async () => {
    const env = envWith(mockRegistry(), {
      ChatAgent: { idFromName: vi.fn(), get: vi.fn() },
    });
    const req = new Request('https://brainhalf.com/preview/proj-alpha/index.html');
    const res = await worker.fetch(req, env, {} as any);
    expect(res.status).toBe(401);
  });

  it('denies an unauthenticated agent route by invoking the SDK hooks', async () => {
    // routeAgentRequest is mocked in this suite, so the real hook bodies never
    // run through worker.fetch. Exercise them directly instead: they are the
    // security boundary for WS and HTTP agent traffic.
    vi.mocked(routeAgentRequest).mockResolvedValue(new Response('should not reach', { status: 200 }) as any);
    const registry = mockRegistry();
    const env = envWith(registry, { ChatAgent: { idFromName: vi.fn(), get: vi.fn() } });
    const req = new Request('https://brainhalf.com/agents/chat-agent/proj-alpha');

    await worker.fetch(req, env, {} as any);
    const opts = vi.mocked(routeAgentRequest).mock.calls[0][2] as any;
    expect(typeof opts.onBeforeRequest).toBe('function');

    const denied = await opts.onBeforeRequest(req, { name: 'proj-alpha' });
    expect(denied instanceof Response).toBe(true);
    expect((denied as Response).status).toBe(401);

    // And an authenticated request is rewritten to carry the user id.
    const { request } = await authenticatedRequest('https://brainhalf.com/agents/chat-agent/proj-alpha');
    const rewritten = await opts.onBeforeRequest(request, { name: 'proj-alpha' });
    expect(rewritten instanceof Request).toBe(true);
    expect((rewritten as Request).headers.get('x-auth-user-id')).toBe('user-1');
  });

  it('denies a preview request for a project owned by someone else', async () => {
    const registry = mockRegistry({ ownerId: 'someone-else' });
    const env = envWith(registry, { ChatAgent: { idFromName: vi.fn(), get: vi.fn() } });
    const { request } = await authenticatedRequest('https://brainhalf.com/preview/proj-alpha/index.html');
    const res = await worker.fetch(request, env, {} as any);
    expect(res.status).toBe(403);
  });

  it('denies a token whose session the Registry has revoked', async () => {
    const revoked = vi.fn(async () =>
      new Response(JSON.stringify({ error: 'no session' }), { status: 401, headers: { 'Content-Type': 'application/json' } })
    );
    const registry = { idFromName: vi.fn(() => ({})), get: vi.fn(() => ({ fetch: revoked })) };
    const env = envWith(registry, { ChatAgent: { idFromName: vi.fn(), get: vi.fn() } });
    const { request } = await authenticatedRequest('https://brainhalf.com/preview/proj-alpha/index.html');
    const res = await worker.fetch(request, env, {} as any);
    expect(res.status).toBe(401);
  });

  it('denies a token signed by a different secret', async () => {
    const env = envWith(mockRegistry(), { ChatAgent: { idFromName: vi.fn(), get: vi.fn() } });
    const { token } = await issueToken('a-different-secret-that-is-32-characters-long', 'user-1');
    const req = new Request('https://brainhalf.com/preview/proj-alpha/index.html', {
      headers: { authorization: `Bearer ${token}` },
    });
    const res = await worker.fetch(req, env, {} as any);
    expect(res.status).toBe(401);
  });

  it('never reflects a wildcard CORS origin', async () => {
    const env = envWith(mockRegistry(), { ChatAgent: { idFromName: vi.fn(), get: vi.fn() } });
    const req = new Request('https://brainhalf.com/api/auth/session', {
      headers: { origin: 'https://evil.example' },
    });
    const res = await worker.fetch(req, env, {} as any);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://brainhalf.com');
  });

  it('answers a preflight OPTIONS request without authentication', async () => {
    const env = envWith(mockRegistry(), { ChatAgent: { idFromName: vi.fn(), get: vi.fn() } });
    const req = new Request('https://brainhalf.com/api/auth/login', {
      method: 'OPTIONS',
      headers: { origin: 'http://localhost:5173' },
    });
    const res = await worker.fetch(req, env, {} as any);
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
  });
});
