import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  authFetch: vi.fn(),
  scope: { accountId: 'acct-test' as string | null },
}));

vi.mock('../lib/auth-client', () => ({
  authFetch: state.authFetch,
}));

vi.mock('../lib/project-store', () => ({
  getProjectStorageScope: () => state.scope,
  updateProjectDeployment: vi.fn(),
}));

import { parseRetryAfterMs, runtimeRequest, RuntimeRequestError, STATUS_NOT_FOUND_MAX_RETRIES } from '../lib/project-runtime-client';

describe('project runtime client polling guards', () => {
  beforeEach(() => {
    state.authFetch.mockReset();
    state.scope = { accountId: 'acct-test' };
    vi.stubGlobal('window', {
      location: { hostname: 'brainhalf.com', origin: 'https://brainhalf.com' },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as any);
  });

  it('parses Retry-After in both seconds and HTTP-date formats', () => {
    expect(parseRetryAfterMs('9')).toBe(9000);

    const now = Date.now();
    const future = new Date(now + 7000).toUTCString();
    const parsed = parseRetryAfterMs(future, now);
    expect(parsed).toBeGreaterThanOrEqual(6000);
    expect(parsed).toBeLessThanOrEqual(7000);
  });

  it('deduplicates concurrent runtime status requests for the same project/environment', async () => {
    let release!: (response: Response) => void;
    state.authFetch.mockImplementationOnce(() => new Promise<Response>(resolve => {
      release = resolve;
    }));

    const req1 = runtimeRequest<any>('proj-inflight', '/status', 'development');
    const req2 = runtimeRequest<any>('proj-inflight', '/status', 'development');

    expect(state.authFetch).toHaveBeenCalledTimes(1);

    release(Response.json({ enabled: true, jobs: [] }));

    const [first, second] = await Promise.all([req1, req2]);
    expect(first).toEqual({ enabled: true, jobs: [] });
    expect(second).toEqual({ enabled: true, jobs: [] });
  });

  it('honors Retry-After cooldown after a runtime 429 without hammering the endpoint', async () => {
    state.authFetch.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Too many requests' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json', 'Retry-After': '2' },
    }));

    await expect(runtimeRequest('proj-rate-limit', '/status', 'development')).rejects.toMatchObject({
      name: 'RuntimeRequestError',
      status: 429,
      retryAfterMs: 2000,
    } satisfies Partial<RuntimeRequestError>);

    await expect(runtimeRequest('proj-rate-limit', '/status', 'development')).rejects.toMatchObject({
      name: 'RuntimeRequestError',
      status: 429,
    } satisfies Partial<RuntimeRequestError>);

    expect(state.authFetch).toHaveBeenCalledTimes(1);
  });

  it('410 produces a RuntimeRequestError — immediate stop signal', async () => {
    state.authFetch.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Gone' }), {
      status: 410,
      headers: { 'Content-Type': 'application/json' },
    }));

    await expect(runtimeRequest('proj-gone-410', '/status', 'development')).rejects.toMatchObject({
      name: 'RuntimeRequestError',
      status: 410,
    } satisfies Partial<RuntimeRequestError>);
  });

  it('404 is retryable — produces a RuntimeRequestError but is not 410', async () => {
    state.authFetch.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    }));

    await expect(runtimeRequest('proj-not-found', '/status', 'development')).rejects.toMatchObject({
      name: 'RuntimeRequestError',
      status: 404,
    } satisfies Partial<RuntimeRequestError>);
    expect(STATUS_NOT_FOUND_MAX_RETRIES).toBe(3);
  });

  it('isolates cancelled status subscribers from publishing and remounted panels', async () => {
    let release!: (response: Response) => void;
    state.authFetch.mockImplementationOnce(() => new Promise<Response>(resolve => { release = resolve; }));
    const controller = new AbortController();
    const first = runtimeRequest('proj-cancel', '/status', 'production', { signal: controller.signal });
    const cancelled = expect(first).rejects.toMatchObject({ name: 'AbortError' });
    const publisher = runtimeRequest('proj-cancel', '/status', 'production');
    controller.abort();
    await cancelled;
    const remounted = runtimeRequest('proj-cancel', '/status', 'production');
    expect(state.authFetch.mock.calls[0][1].signal.aborted).toBe(false);
    release(Response.json({ enabled: true }));
    await expect(publisher).resolves.toEqual({ enabled: true });
    await expect(remounted).resolves.toEqual({ enabled: true });
    expect(state.authFetch).toHaveBeenCalledTimes(1);
  });
});
