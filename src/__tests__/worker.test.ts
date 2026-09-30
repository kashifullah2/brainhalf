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

describe('Worker runtime configuration gate', () => {
  it('serves only an empty public prefetch ruleset to opaque previews without authentication', async () => {
    const response = await worker.fetch(new Request('https://brainhalf.com/preview-rules.json', { headers: { Origin: 'null' } }), {} as unknown as import('../worker').PlatformEnv, {} as any);
    expect(response.status).toBe(200);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(response.headers.get('Content-Type')).toBe('application/speculationrules+json');
    expect(await response.json()).toEqual({});
  });
  it.each(['/api/auth/signup', '/api/auth/login', '/api/auth/session', '/api/projects', '/agents/chat-agent/project', '/preview/project/index.html', '/p/project/'])('returns an explicit uncached 503 before accessing bindings: %s', async path => {
    const response = await worker.fetch(new Request(`https://brainhalf.com${path}`, {
      headers: { origin: 'https://brainhalf.com' },
    }), { SESSION_SECRET: 'do-not-echo-this-value' } as unknown as import('../worker').PlatformEnv, {} as any);
    expect(response.status).toBe(503);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://brainhalf.com');
    expect(await response.json()).toEqual({ error: 'Authentication service unavailable' });
  });

  it('keeps preflight and the static shell available without valid auth configuration', async () => {
    const preflight = await worker.fetch(new Request('https://brainhalf.com/api/projects', { method: 'OPTIONS' }), {} as unknown as import('../worker').PlatformEnv, {} as any);
    expect(preflight.status).toBe(204);
    const shell = await worker.fetch(new Request('https://brainhalf.com/'), {
      ASSETS: { fetch: async () => new Response('shell') },
    } as unknown as import('../worker').PlatformEnv, {} as any);
    expect(shell.status).toBe(200);
    expect(await shell.text()).toBe('shell');
  });
});

function mockRegistry(opts: {
  userId?: string;
  ownerId?: string;
  published?: boolean;
  onRateLimitCheck?: (bucket: string, key: string) => { ok: boolean; retryAfter: number };
} = {}) {
  const userId = opts.userId ?? 'user-1';
  const ownerId = opts.ownerId ?? userId;
  const stubId = { name: 'auth', toString: () => 'auth' };
  const fetch = vi.fn(async (input: string | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? new URL(input) : new URL(input.url);
    if (url.pathname === '/rate-limit/check') {
      const body = input instanceof Request
        ? await input.clone().json() as { bucket?: string; key?: string }
        : (typeof init?.body === 'string' ? JSON.parse(init.body) as { bucket?: string; key?: string } : {});
      const result = opts.onRateLimitCheck?.(String(body.bucket || ''), String(body.key || '')) ?? { ok: true, retryAfter: 0 };
      return Response.json(result);
    }
    if (url.pathname.startsWith('/sessions/')) {
      // Revocation lookup keyed by the token hash.
      return new Response(JSON.stringify({ userId }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.pathname === '/projects/owner-check') {
      return new Response(JSON.stringify({ ownerId }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.pathname === '/projects/access') {
      return Response.json({ owner: url.searchParams.get('userId') === ownerId, published: opts.published === true });
    }
    if (url.pathname === '/projects/claim') {
      if (ownerId !== userId) {
        return new Response(JSON.stringify({ error: 'Project is owned by another account' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
      }
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
  // Tests stub only the bindings each route touches.
  return { SESSION_SECRET: SECRET, REGISTRY: registry, ...extra } as unknown as import('../worker').PlatformEnv;
}

describe('Canonical host and navigational redirects', () => {
  it('permanently redirects www.brainhalf.com to the apex, preserving path and query', async () => {
    const response = await worker.fetch(new Request('https://www.brainhalf.com/guides/build-an-app-with-ai?ref=email'), {} as unknown as import('../worker').PlatformEnv, {} as any);
    expect(response.status).toBe(301);
    expect(response.headers.get('location')).toBe('https://brainhalf.com/guides/build-an-app-with-ai?ref=email');
  });
  it.each(['/sign-in', '/login'])('redirects the modal-only auth URL to the homepage: %s', async path => {
    const response = await worker.fetch(new Request(`https://brainhalf.com${path}`), {} as unknown as import('../worker').PlatformEnv, {} as any);
    expect(response.status).toBe(301);
    expect(response.headers.get('location')).toBe('https://brainhalf.com/');
  });
});

describe('Cloudflare Worker Gateway & Routing', () => {
  it('fails closed when the inference rate-limit store is unavailable', async () => {
    const registry = mockRegistry();
    const original = registry._fetch.getMockImplementation()!;
    registry._fetch.mockImplementation(async (input: string | Request, init?: RequestInit) => {
      const url = new URL(typeof input === 'string' ? input : input.url);
      if (url.pathname === '/rate-limit/check') return new Response('unavailable', { status: 503 });
      return original(input, init);
    });
    const inference = vi.fn();
    const { request } = await authenticatedRequest('https://brainhalf.com/api/test/simple?model=@cf/openai/gpt-oss-120b');
    const response = await worker.fetch(request, envWith(registry, { AI: { run: inference } }), {} as any);
    expect(response.status).toBe(503); expect(inference).not.toHaveBeenCalled();
  });
  it('still requests runtime shutdown when the agent stop request fails', async () => {
    const runtime = vi.fn(async () => Response.json({ ok: true }));
    const agent = vi.fn(async () => { throw new Error('Agent temporarily unavailable'); });
    const { request } = await authenticatedRequest('https://brainhalf.com/api/projects/proj-alpha/stop', { method: 'POST' });
    const response = await worker.fetch(request, envWith(mockRegistry(), { ChatAgent: { idFromName: () => 'project', get: () => ({ fetch: agent }) }, RUNTIME: { fetch: runtime } }), {} as any);
    expect(response.status).toBe(503);
    expect(agent).toHaveBeenCalledOnce(); expect(runtime).toHaveBeenCalledOnce();
  });
  it('does not acknowledge shutdown when runtime termination fails', async () => {
    const runtime = vi.fn(async () => Response.json({ error: 'Still stopping' }, { status: 503 }));
    const agent = vi.fn(async () => Response.json({ ok: true }));
    const { request } = await authenticatedRequest('https://brainhalf.com/api/projects/proj-alpha/stop', { method: 'POST' });
    const response = await worker.fetch(request, envWith(mockRegistry(), { ChatAgent: { idFromName: () => 'project', get: () => ({ fetch: agent }) }, RUNTIME: { fetch: runtime } }), {} as any);
    expect(response.status).toBe(502); expect(agent).toHaveBeenCalledOnce();
  });
  it('serves dashboard navigation with the app shell and private indexing headers', async () => {
    const assets = vi.fn(async (request: Request) => new URL(request.url).pathname === '/index.html' ? Response.redirect('https://brainhalf.com/', 307) : new Response(new URL(request.url).pathname));
    const response = await worker.fetch(new Request('https://brainhalf.com/dashboard?project=abc'), { ASSETS: { fetch: assets } } as unknown as import('../worker').PlatformEnv, {} as any);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('/');
    expect(response.headers.get('X-Robots-Tag')).toContain('noindex');
  });
  it('checks runtime ownership and constructs the trusted service identity itself', async () => {
    const runtime = vi.fn(async (request: Request) => {
      expect(request.headers.get('x-bh-project')).toBe('proj-alpha');
      expect(request.headers.get('x-bh-owner')).toBe('user-1');
      expect(request.headers.get('authorization')).toBeNull();
      return Response.json({ ok: true });
    });
    const { request } = await authenticatedRequest('https://brainhalf.com/api/projects/proj-alpha/runtime/status', { headers: { 'x-bh-owner': 'forged' } });
    expect((await worker.fetch(request, envWith(mockRegistry(), { RUNTIME: { fetch: runtime } }), {} as any)).status).toBe(200);
    const { request: denied } = await authenticatedRequest('https://brainhalf.com/api/projects/proj-alpha/runtime/status');
    expect((await worker.fetch(denied, envWith(mockRegistry({ ownerId: 'other-user' }), { RUNTIME: { fetch: runtime } }), {} as any)).status).toBe(403);
    expect(runtime).toHaveBeenCalledOnce();
  });
  it('authenticates the platform cookie without replacing an app bearer or consuming its request body', async () => {
    const { token } = await issueToken(SECRET, 'user-1');
    const doFetch = vi.fn(async (request: Request) => {
      expect(request.headers.get('authorization')).toBe('Bearer bh_token_application_session');
      expect(request.headers.get('x-auth-user-id')).toBe('user-1');
      expect(await request.json()).toEqual({ action: 'application action' });
      return new Response('app response');
    });
    const env = envWith(mockRegistry(), { ChatAgent: { idFromName: vi.fn(), get: () => ({ fetch: doFetch }) } });
    const request = new Request('https://brainhalf.com/preview/proj-alpha/api/tasks', {
      method: 'POST',
      headers: { cookie: `bh_session=${token}`, authorization: 'Bearer bh_token_application_session', 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'application action' }),
    });
    expect((await worker.fetch(request, env, {} as any)).status).toBe(200);
    expect(doFetch).toHaveBeenCalledOnce();
  });

  it('does not treat an application token as a platform session', async () => {
    const doFetch = vi.fn();
    const env = envWith(mockRegistry(), { ChatAgent: { idFromName: vi.fn(), get: () => ({ fetch: doFetch }) } });
    const response = await worker.fetch(new Request('https://brainhalf.com/preview/proj-alpha/api/auth/me', { headers: { authorization: 'Bearer bh_token_application_session' } }), env, {} as any);
    expect(response.status).toBe(401);
    expect(doFetch).not.toHaveBeenCalled();
  });

  it('never forwards platform identity or credentials to a dispatched tenant', async () => {
    const tenantFetch = vi.fn().mockResolvedValue(new Response('tenant response'));
    const env = envWith(mockRegistry(), {
      DISPATCHER: { get: vi.fn().mockReturnValue({ fetch: tenantFetch }) },
    });
    const { request } = await authenticatedRequest('https://brainhalf.com/p/proj-alpha/api/tasks?ticket=temporary&_uid=forged&page=2', {
      headers: { cookie: 'bh_session=platform-secret', 'x-auth-user-id': 'forged' },
    });

    const response = await worker.fetch(request, env, {} as any);

    expect(response.status).toBe(200);
    const forwarded = tenantFetch.mock.calls[0][0] as Request;
    expect(forwarded.url).toBe('https://brainhalf.com/api/tasks?page=2');
    for (const header of ['authorization', 'cookie', 'x-auth-user-id']) {
      expect(forwarded.headers.has(header)).toBe(false);
    }
  });

  it('routes /preview/:id requests to the designated ChatAgent Durable Object', async () => {
    const mockDoFetch = vi.fn().mockResolvedValue(Response.json({ '/src/App.jsx': 'Preview Content' }));
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
    expect(await res.text()).toContain('Preview Content');
    expect(res.headers.get('Content-Security-Policy')).toContain('sandbox allow-scripts allow-forms;');
  });

  it('rate-limits preview traffic and returns 429 with Retry-After', async () => {
    const mockDoFetch = vi.fn().mockResolvedValue(Response.json({ ok: true }));
    const registry = mockRegistry({
      onRateLimitCheck: bucket => bucket.startsWith('preview') ? { ok: false, retryAfter: 42 } : { ok: true, retryAfter: 0 },
    });
    const env = envWith(registry, {
      ChatAgent: { idFromName: vi.fn().mockReturnValue('id'), get: vi.fn().mockReturnValue({ fetch: mockDoFetch }) },
    });
    const { request } = await authenticatedRequest('https://brainhalf.com/preview/proj-alpha/src/App.jsx');
    const res = await worker.fetch(request, env, {} as any);
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('42');
    expect(mockDoFetch).not.toHaveBeenCalled();
  });

  it('fails open for previews when the rate-limit service is unavailable', async () => {
    const mockDoFetch = vi.fn().mockResolvedValue(Response.json({ ok: true }));
    const registry = mockRegistry();
    const original = registry._fetch.getMockImplementation()!;
    registry._fetch.mockImplementation(async (input: string | Request, init?: RequestInit) => {
      const url = new URL(typeof input === 'string' ? input : input.url);
      if (url.pathname === '/rate-limit/check') return new Response('down', { status: 503 });
      return original(input, init);
    });
    const env = envWith(registry, {
      ChatAgent: { idFromName: vi.fn().mockReturnValue('id'), get: vi.fn().mockReturnValue({ fetch: mockDoFetch }) },
    });
    const { request } = await authenticatedRequest('https://brainhalf.com/preview/proj-alpha/src/App.jsx');
    const res = await worker.fetch(request, env, {} as any);
    expect(res.status).toBe(200);
    expect(mockDoFetch).toHaveBeenCalled();
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

  it('denies private preview reads and mutations without ownership', async () => {
    const mockDoObj = { fetch: vi.fn().mockResolvedValue(new Response('Preview HTML', { status: 200 })) };
    const registry = mockRegistry({ ownerId: 'someone-else' });
    const env = envWith(registry, {
      ChatAgent: { idFromName: vi.fn().mockReturnValue('mock-id'), get: vi.fn().mockReturnValue(mockDoObj) },
    });
    const { request } = await authenticatedRequest('https://brainhalf.com/preview/proj-alpha/index.html');
    const res = await worker.fetch(request, env, {} as any);
    expect(res.status).toBe(403);

    // Mutating write operation without ownership is strictly forbidden (403)
    const { request: syncReq } = await authenticatedRequest('https://brainhalf.com/preview/proj-alpha/api/sync', {
      method: 'POST',
      body: JSON.stringify({ files: { '/src/App.jsx': 'malicious write' } }),
    });
    const syncRes = await worker.fetch(syncReq, env, {} as any);
    expect(syncRes.status).toBe(403);
  });

  it('allows an explicitly published showcase preview for other users', async () => {
    const mockDoObj = { fetch: vi.fn().mockResolvedValue(Response.json({ '/src/App.jsx': 'Studio App' })) };
    const registry = mockRegistry({ ownerId: 'different-owner', published: true });
    const env = envWith(registry, {
      ChatAgent: { idFromName: vi.fn().mockReturnValue('mock-id'), get: vi.fn().mockReturnValue(mockDoObj) },
    });
    const { request } = await authenticatedRequest('https://brainhalf.com/preview/all-models-studio/index.html');
    const res = await worker.fetch(request, env, {} as any);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Studio App');
  });

  it('allows unauthenticated visitors to preview public showcase projects', async () => {
    const mockDoObj = { fetch: vi.fn().mockResolvedValue(Response.json({ '/src/App.jsx': 'Studio App' })) };
    const registry = mockRegistry({ published: true });
    const env = envWith(registry, {
      ChatAgent: { idFromName: vi.fn().mockReturnValue('mock-id'), get: vi.fn().mockReturnValue(mockDoObj) },
    });
    const req = new Request('https://brainhalf.com/preview/all-models-studio/index.html');
    const res = await worker.fetch(req, env, {} as any);
    expect(res.status).toBe(200);
  });

  it('denies mutating public showcase projects without ownership', async () => {
    const registry = mockRegistry({ ownerId: 'someone-else' });
    const env = envWith(registry, { ChatAgent: { idFromName: vi.fn(), get: vi.fn() } });
    const { request } = await authenticatedRequest('https://brainhalf.com/preview/all-models-studio/api/sync', {
      method: 'POST',
      body: JSON.stringify({ files: { '/test.js': 'content' } }),
    });
    const res = await worker.fetch(request, env, {} as any);
    expect(res.status).toBe(403);
  });

  it('denies a token whose session the Registry has revoked', async () => {
    const revoked = vi.fn(async (input: string) => new URL(input).pathname === '/projects/access'
      ? Response.json({ owner: false, published: false })
      : Response.json({ error: 'no session' }, { status: 401 }));
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

  it('enforces auth rate limits through the registry', async () => {
    const registry = mockRegistry({
      onRateLimitCheck: (bucket) => bucket === 'auth'
        ? { ok: false, retryAfter: 12 }
        : { ok: true, retryAfter: 0 },
    });
    const env = envWith(registry, { ChatAgent: { idFromName: vi.fn(), get: vi.fn() } });
    const response = await worker.fetch(new Request('https://brainhalf.com/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'user@example.com', password: 'not-the-real-pass' }),
    }), env, {} as any);
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('12');
  });

  it('enforces model-test rate limits through the registry', async () => {
    const registry = mockRegistry({
      onRateLimitCheck: (bucket) => bucket === 'modelTest'
        ? { ok: false, retryAfter: 9 }
        : { ok: true, retryAfter: 0 },
    });
    const env = envWith(registry, { ChatAgent: { idFromName: vi.fn(), get: vi.fn() } });
    const { request } = await authenticatedRequest('https://brainhalf.com/api/test/simple', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: '@cf/meta/llama-3.1-8b-instruct' }),
    });
    const response = await worker.fetch(request, env, {} as any);
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('9');
  });
});

describe('product outcome access', () => {
  it('scopes reports to the signed-in account and ignores caller-supplied account IDs', async () => {
    const registry = mockRegistry(); const original = registry._fetch.getMockImplementation()!;
    registry._fetch.mockImplementation(async (input: string | Request, init?: RequestInit) => {
      const url = new URL(typeof input === 'string' ? input : input.url);
      if (url.pathname === '/outcomes') return Response.json({ owner: url.searchParams.get('userId'), generations: 3 });
      return original(input, init);
    });
    const { request } = await authenticatedRequest('https://brainhalf.com/api/account/outcomes?userId=someone-else');
    const response = await worker.fetch(request, envWith(registry), {} as any);
    expect(await response.json()).toEqual({ owner: 'user-1', generations: 3 });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });
  it('requires authentication and an explicit operator allowlist for aggregate reports', async () => {
    const registry = mockRegistry();
    expect((await worker.fetch(new Request('https://brainhalf.com/api/account/outcomes'), envWith(registry), {} as any)).status).toBe(401);
    const { request } = await authenticatedRequest('https://brainhalf.com/api/admin/outcomes');
    expect((await worker.fetch(request, envWith(registry), {} as any)).status).toBe(403);
    const original = registry._fetch.getMockImplementation()!;
    registry._fetch.mockImplementation(async (input: string | Request, init?: RequestInit) => {
      const url = new URL(typeof input === 'string' ? input : input.url);
      if (url.pathname === '/outcomes') { expect(url.search).toBe(''); return Response.json({ generations: 5 }); }
      return original(input, init);
    });
    expect((await worker.fetch(request, envWith(registry, { PRODUCT_METRICS_OWNER_IDS: 'user-1' }), {} as any)).status).toBe(200);
  });

  it('restricts the account list to authenticated operator allowlist members', async () => {
    const registry = mockRegistry();
    const original = registry._fetch.getMockImplementation()!;
    registry._fetch.mockImplementation(async (input: string | Request, init?: RequestInit) => {
      const url = new URL(typeof input === 'string' ? input : input.url);
      if (url.pathname === '/admin/users') return Response.json({ users: [{ email: 'pilot@example.com', verified: true }] });
      return original(input, init);
    });
    expect((await worker.fetch(new Request('https://brainhalf.com/api/admin/users'), envWith(registry), {} as any)).status).toBe(401);
    const { request } = await authenticatedRequest('https://brainhalf.com/api/admin/users');
    expect((await worker.fetch(request, envWith(registry), {} as any)).status).toBe(403);
    const allowed = await worker.fetch(request, envWith(registry, { PRODUCT_METRICS_OWNER_IDS: 'user-1' }), {} as any);
    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toEqual({ users: [{ email: 'pilot@example.com', verified: true }] });
    expect(allowed.headers.get('Cache-Control')).toBe('no-store');
  });

  it('lets operators inspect another user’s project files', async () => {
    const agentFetch = vi.fn(async (request: Request) => {
      const url = new URL(request.url);
      if (url.pathname === '/internal/admin-files') {
        expect(request.headers.get('x-bh-project')).toBe('proj-1');
        return Response.json({ files: { '/src/App.tsx': 'export default function App() {}' } });
      }
      return new Response('unexpected', { status: 500 });
    });
    const binding = { idFromName: (id: string) => id, get: () => ({ fetch: agentFetch }) };
    // Not signed in → 401.
    expect((await worker.fetch(new Request('https://brainhalf.com/api/admin/projects/proj-1/files'), envWith(mockRegistry(), { ChatAgent: binding }), {} as any)).status).toBe(401);
    // Signed in but not an operator → 403, agent never called.
    const { request } = await authenticatedRequest('https://brainhalf.com/api/admin/projects/proj-1/files');
    expect((await worker.fetch(request, envWith(mockRegistry(), { ChatAgent: binding }), {} as any)).status).toBe(403);
    expect(agentFetch).not.toHaveBeenCalled();
    // Operator → 200 with the project files.
    const allowed = await worker.fetch(request, envWith(mockRegistry(), { ChatAgent: binding, PRODUCT_METRICS_OWNER_IDS: 'user-1' }), {} as any);
    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toEqual({ files: { '/src/App.tsx': 'export default function App() {}' } });
    expect(allowed.headers.get('Cache-Control')).toBe('no-store');
  });

  it('proxies the operator preview to the project agent', async () => {
    const agentFetch = vi.fn(async (request: Request) => {
      const url = new URL(request.url);
      expect(url.pathname).toBe('/preview/proj-1/index.html');
      return new Response('<html>preview</html>', { status: 200, headers: { 'Content-Type': 'text/html' } });
    });
    const binding = { idFromName: (id: string) => id, get: () => ({ fetch: agentFetch }) };
    const { request } = await authenticatedRequest('https://brainhalf.com/api/admin/projects/proj-1/preview/index.html');
    // Not an operator → 403.
    expect((await worker.fetch(request, envWith(mockRegistry(), { ChatAgent: binding }), {} as any)).status).toBe(403);
    // Operator → proxied preview HTML.
    const allowed = await worker.fetch(request, envWith(mockRegistry(), { ChatAgent: binding, PRODUCT_METRICS_OWNER_IDS: 'user-1' }), {} as any);
    expect(allowed.status).toBe(200);
    expect(await allowed.text()).toBe('<html>preview</html>');
  });
});

describe('Gallery remix orchestration', () => {
  const remixRegistry = (deleted: string[]) => {
    const registry = mockRegistry();
    const original = registry._fetch.getMockImplementation()!;
    registry._fetch.mockImplementation(async (input: string | Request, init?: RequestInit) => {
      const url = new URL(typeof input === 'string' ? input : input.url);
      if (url.pathname === '/projects/remix') return Response.json({ projectId: 'copy-1', name: 'Inventory Tracker (remix)' }, { status: 201 });
      if (url.pathname === '/projects/copy-1' && (init?.method === 'DELETE' || (input instanceof Request && input.method === 'DELETE'))) { deleted.push('copy-1'); return Response.json({ ok: true }); }
      return original(input, init);
    });
    return registry;
  };
  const remixAgents = (options: { exportOk?: boolean; importOk?: boolean } = {}) => {
    const importedBodies: string[] = [];
    const fetch = vi.fn(async (request: Request) => {
      if (new URL(request.url).pathname === '/internal/remix-export') {
        return options.exportOk === false ? new Response('denied', { status: 403 }) : Response.json({ files: { '/src/App.tsx': 'export default function App() {}' } });
      }
      if (new URL(request.url).pathname === '/internal/remix-import') {
        importedBodies.push(await request.text());
        return options.importOk === false ? Response.json({ error: 'too large' }, { status: 413 }) : Response.json({ ok: true, revision: 3 });
      }
      return new Response('unexpected', { status: 500 });
    });
    return { binding: { idFromName: (id: string) => id, get: () => ({ fetch }) }, fetch, importedBodies };
  };

  it('copies the showcased source into the caller’s new project', async () => {
    const deleted: string[] = [];
    const agents = remixAgents();
    const { request } = await authenticatedRequest('https://brainhalf.com/api/projects/source-app/remix', { method: 'POST' });
    const response = await worker.fetch(request, envWith(remixRegistry(deleted), { ChatAgent: agents.binding }), {} as any);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ projectId: 'copy-1', name: 'Inventory Tracker (remix)' });
    expect(agents.importedBodies).toHaveLength(1);
    expect(JSON.parse(agents.importedBodies[0])).toEqual({ files: { '/src/App.tsx': 'export default function App() {}' } });
    expect(deleted).toHaveLength(0);
  });

  it('cleans up the new project when the file copy fails', async () => {
    const deleted: string[] = [];
    const agents = remixAgents({ importOk: false });
    const { request } = await authenticatedRequest('https://brainhalf.com/api/projects/source-app/remix', { method: 'POST' });
    const response = await worker.fetch(request, envWith(remixRegistry(deleted), { ChatAgent: agents.binding }), {} as any);
    // The agent's 413 passes through (not collapsed to 502) so the client
    // sees the real failure; the message is whitelisted to avoid leaking internals.
    expect(response.status).toBe(413);
    expect((await response.json() as { error: string }).error).toBe('Remix could not be completed.');
    expect(deleted).toEqual(['copy-1']);
  });

  it('cleans up the new project when the source export fails', async () => {
    const deleted: string[] = [];
    const agents = remixAgents({ exportOk: false });
    const { request } = await authenticatedRequest('https://brainhalf.com/api/projects/source-app/remix', { method: 'POST' });
    const response = await worker.fetch(request, envWith(remixRegistry(deleted), { ChatAgent: agents.binding }), {} as any);
    // Export returned 403 with a non-JSON body; the orphaned registry project
    // must be deleted and the client gets a specific, non-technical message.
    expect(response.status).toBe(403);
    expect(deleted).toEqual(['copy-1']);
  });

  it('translates agent export errors into plain messages', async () => {
    const deleted: string[] = [];
    const agents = remixAgents();
    // Override the export to return a whitelisted agent error.
    agents.fetch.mockImplementation(async (request: Request) => {
      if (new URL(request.url).pathname === '/internal/remix-export') {
        return Response.json({ error: 'This app is not listed in the gallery' }, { status: 403 });
      }
      return new Response('unexpected', { status: 500 });
    });
    const { request } = await authenticatedRequest('https://brainhalf.com/api/projects/source-app/remix', { method: 'POST' });
    const response = await worker.fetch(request, envWith(remixRegistry(deleted), { ChatAgent: agents.binding }), {} as any);
    expect(response.status).toBe(403);
    expect((await response.json() as { error: string }).error).toBe('This app is no longer listed in the gallery, so it cannot be remixed.');
    expect(deleted).toEqual(['copy-1']);
  });

  it('requires a session and refuses when the registry rejects the remix', async () => {
    const agents = remixAgents();
    const anonymous = await worker.fetch(new Request('https://brainhalf.com/api/projects/source-app/remix', { method: 'POST' }), envWith(mockRegistry(), { ChatAgent: agents.binding }), {} as any);
    expect(anonymous.status).toBe(401);
    const registry = mockRegistry();
    const original = registry._fetch.getMockImplementation()!;
    registry._fetch.mockImplementation(async (input: string | Request, init?: RequestInit) => {
      const url = new URL(typeof input === 'string' ? input : input.url);
      if (url.pathname === '/projects/remix') return Response.json({ error: 'This app is not listed in the gallery' }, { status: 404 });
      return original(input, init);
    });
    const { request } = await authenticatedRequest('https://brainhalf.com/api/projects/source-app/remix', { method: 'POST' });
    const denied = await worker.fetch(request, envWith(registry, { ChatAgent: agents.binding }), {} as any);
    expect(denied.status).toBe(404);
    expect(agents.fetch).not.toHaveBeenCalled();
  });
});

describe('project quota endpoint', () => {
  it('proxies the registry quota for the signed-in account', async () => {
    const registry = mockRegistry(); const original = registry._fetch.getMockImplementation()!;
    registry._fetch.mockImplementation(async (input: string | Request, init?: RequestInit) => {
      const url = new URL(typeof input === 'string' ? input : input.url);
      if (url.pathname === '/projects/quota') {
        expect(url.searchParams.get('userId')).toBe('user-1');
        return Response.json({ live: 7, limit: 50 });
      }
      return original(input, init);
    });
    const { request } = await authenticatedRequest('https://brainhalf.com/api/account/project-quota');
    const response = await worker.fetch(request, envWith(registry), {} as any);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ live: 7, limit: 50 });
  });
  it('requires authentication', async () => {
    const registry = mockRegistry();
    expect((await worker.fetch(new Request('https://brainhalf.com/api/account/project-quota'), envWith(registry), {} as any)).status).toBe(401);
  });
});
