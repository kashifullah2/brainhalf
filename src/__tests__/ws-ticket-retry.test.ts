/**
 * RC-3 regression: fetchWsTicket must use a 15s timeout and retry once
 * with 1s backoff before surfacing "timed out" to the caller.
 *
 * Tested through withWsAuthQuery (exported), which calls getWsTicket →
 * fetchWsTicket → authFetch → globalThis.fetch.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { withWsAuthQuery } from '../lib/auth-client';

const WS_URL = 'wss://example.com/ws';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('fetchWsTicket (RC-3a) — timeout and retry', () => {
  it('succeeds on a response that arrives within 15 seconds (no longer fails at 5s)', async () => {
    vi.useFakeTimers();
    let resolveFetch!: (r: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(r => { resolveFetch = r; })));
    const urlPromise = withWsAuthQuery(WS_URL);
    // Advance 6 seconds — old 5s timeout would have aborted by now.
    await vi.advanceTimersByTimeAsync(6_000);
    resolveFetch(new Response(JSON.stringify({ ticket: 'bhwt_ok' }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const url = await urlPromise;
    expect(url).toContain('ticket=bhwt_ok');
  });

  it('retries once after a timeout and succeeds on the second attempt', async () => {
    vi.useFakeTimers();
    let attemptCount = 0;
    vi.stubGlobal('fetch', vi.fn((_url: string, opts: RequestInit) => {
      attemptCount++;
      if (attemptCount === 1) {
        return new Promise<Response>((_resolve, reject) => {
          opts.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        });
      }
      return Promise.resolve(new Response(JSON.stringify({ ticket: 'bhwt_retry' }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    }));
    const urlPromise = withWsAuthQuery(WS_URL);
    // Exhaust first attempt timeout (15s) + inter-attempt backoff (1s).
    await vi.advanceTimersByTimeAsync(16_001);
    const url = await urlPromise;
    expect(url).toContain('ticket=bhwt_retry');
    expect(attemptCount).toBe(2);
  });

  it('throws the timed-out error only after both attempts are exhausted', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_url: string, opts: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        opts.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      })
    ));
    const urlPromise = withWsAuthQuery(WS_URL);
    // Attach rejection handler before advancing so the rejection is never unhandled.
    const expectation = expect(urlPromise).rejects.toThrow('timed out');
    // Advance past both timeouts: 15s + 1s backoff + 15s = 31s.
    await vi.advanceTimersByTimeAsync(32_000);
    await expectation;
  });

  it('does not retry on a definitive non-ok response (503)', async () => {
    let callCount = 0;
    // Use 503 (not 401) — authFetch clears the session on 401, which would
    // cause withWsAuthQuery to throw "Session changed while connecting".
    vi.stubGlobal('fetch', vi.fn(async () => {
      callCount++;
      return new Response('', { status: 503 });
    }));
    const url = await withWsAuthQuery(WS_URL);
    // null ticket → URL returned unchanged
    expect(url).toBe(WS_URL);
    expect(callCount).toBe(1);
  });
});
