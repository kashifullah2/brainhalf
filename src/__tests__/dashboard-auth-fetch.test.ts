import { afterEach, describe, expect, it, vi, beforeAll } from 'vitest';

// authFetch touches localStorage and window at call time; stub before importing.
const dispatchSpy = vi.fn();
beforeAll(() => {
  vi.stubGlobal('localStorage', {
    getItem: () => null,
    setItem: vi.fn(),
    removeItem: vi.fn(),
  });
  vi.stubGlobal('window', { dispatchEvent: dispatchSpy });
});

afterEach(() => {
  dispatchSpy.mockReset();
  vi.unstubAllGlobals();
  // Restore the stubs so subsequent tests in this file still have them.
  vi.stubGlobal('localStorage', {
    getItem: () => null,
    setItem: vi.fn(),
    removeItem: vi.fn(),
  });
  vi.stubGlobal('window', { dispatchEvent: dispatchSpy });
});

function stubFetch(status: number) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(null, { status })),
  );
}

describe('authFetch: 401 triggers session-expiry path', () => {
  it('dispatches bh-session-expired when the server returns 401', async () => {
    stubFetch(401);
    const { authFetch } = await import('../lib/auth-client');
    await authFetch('https://example.com/api/anything');
    const dispatched = dispatchSpy.mock.calls.map((args: any[]) => (args[0] as Event).type);
    expect(dispatched).toContain('bh-session-expired');
  });

  it('does NOT dispatch bh-session-expired on a successful response', async () => {
    stubFetch(200);
    const { authFetch } = await import('../lib/auth-client');
    await authFetch('https://example.com/api/anything');
    const dispatched = dispatchSpy.mock.calls.map((args: any[]) => (args[0] as Event).type);
    expect(dispatched).not.toContain('bh-session-expired');
  });

  it('does NOT dispatch bh-session-expired when clearOnUnauthorized is false', async () => {
    stubFetch(401);
    const { authFetch } = await import('../lib/auth-client');
    await authFetch('https://example.com/api/anything', {}, { clearOnUnauthorized: false });
    const dispatched = dispatchSpy.mock.calls.map((args: any[]) => (args[0] as Event).type);
    expect(dispatched).not.toContain('bh-session-expired');
  });
});
