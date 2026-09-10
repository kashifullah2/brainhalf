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

describe('Cloudflare Worker Gateway & Routing', () => {
  it('routes /preview/:id requests to the designated ChatAgent Durable Object', async () => {
    const mockDoFetch = vi.fn().mockResolvedValue(new Response('Preview Content', { status: 200 }));
    const mockDoObj = { fetch: mockDoFetch };
    const mockIdFromName = vi.fn().mockReturnValue('mock-id-123');
    const mockGet = vi.fn().mockReturnValue(mockDoObj);

    const env = {
      ChatAgent: {
        idFromName: mockIdFromName,
        get: mockGet,
      },
    };

    const req = new Request('https://brainhalf.com/preview/proj-alpha/index.html');
    const res = await worker.fetch(req, env, {} as any);

    expect(mockIdFromName).toHaveBeenCalledWith('proj-alpha');
    expect(mockGet).toHaveBeenCalledWith('mock-id-123');
    expect(mockDoFetch).toHaveBeenCalledWith(req);
    expect(await res.text()).toBe('Preview Content');
  });

  it('routes agent API and websocket requests via routeAgentRequest', async () => {
    const mockAgentResponse = new Response('Agent Routed', { status: 200 });
    vi.mocked(routeAgentRequest).mockResolvedValue(mockAgentResponse as any);

    const env = {
      ChatAgent: { idFromName: vi.fn(), get: vi.fn() },
    };

    const req = new Request('https://brainhalf.com/agents/chat-agent/proj-alpha');
    const res = await worker.fetch(req, env, {} as any);

    expect(routeAgentRequest).toHaveBeenCalledWith(req, env);
    expect(res).toBe(mockAgentResponse);
  });

  it('serves static assets from env.ASSETS when request is not an agent or preview route', async () => {
    vi.mocked(routeAgentRequest).mockResolvedValue(undefined as any);

    const mockAssetResponse = new Response('<html>BrainHalf App</html>', { status: 200 });
    const mockAssetsFetch = vi.fn().mockResolvedValue(mockAssetResponse);

    const env = {
      ChatAgent: { idFromName: vi.fn(), get: vi.fn() },
      ASSETS: { fetch: mockAssetsFetch },
    };

    const req = new Request('https://brainhalf.com/assets/index.js');
    const res = await worker.fetch(req, env, {} as any);

    expect(mockAssetsFetch).toHaveBeenCalledWith(req);
    expect(res).toBe(mockAssetResponse);
  });

  it('returns 404 when no assets binding is provided and routeAgentRequest yields undefined', async () => {
    vi.mocked(routeAgentRequest).mockResolvedValue(undefined as any);

    const env = {
      ChatAgent: { idFromName: vi.fn(), get: vi.fn() },
    };

    const req = new Request('https://brainhalf.com/unknown');
    const res = await worker.fetch(req, env, {} as any);

    expect(res.status).toBe(404);
    expect(await res.text()).toBe('Not found');
  });
});
