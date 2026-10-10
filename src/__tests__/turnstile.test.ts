import { describe, it, expect, vi, afterEach } from 'vitest';
import { verifyTurnstileToken } from '../lib/turnstile';

function okFetch(body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
}

afterEach(() => vi.restoreAllMocks());

describe('verifyTurnstileToken', () => {
  it('returns true when Cloudflare reports success', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(okFetch({ success: true }));
    expect(await verifyTurnstileToken('valid-token', 'secret')).toBe(true);
  });

  it('returns false when Cloudflare reports failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(okFetch({ success: false }));
    expect(await verifyTurnstileToken('bad-token', 'secret')).toBe(false);
  });

  it('returns false on a non-200 HTTP status', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('{}', { status: 500 }));
    expect(await verifyTurnstileToken('token', 'secret')).toBe(false);
  });

  it('returns false when token is empty — skips fetch', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(okFetch({ success: true }));
    expect(await verifyTurnstileToken('', 'secret')).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it('returns false when secretKey is empty — skips fetch', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(okFetch({ success: true }));
    expect(await verifyTurnstileToken('token', '')).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it('includes remoteip in the body when ip is provided', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(okFetch({ success: true }));
    await verifyTurnstileToken('token', 'secret', '1.2.3.4');
    const body = (spy.mock.calls[0][1] as RequestInit).body as URLSearchParams;
    expect(body.get('remoteip')).toBe('1.2.3.4');
  });

  it('omits remoteip when ip is not provided', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(okFetch({ success: true }));
    await verifyTurnstileToken('token', 'secret');
    const body = (spy.mock.calls[0][1] as RequestInit).body as URLSearchParams;
    expect(body.has('remoteip')).toBe(false);
  });

  it('swallows network errors and returns false', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => { throw new Error('network error'); });
    await expect(verifyTurnstileToken('token', 'secret')).resolves.toBe(false);
  });

  it('sends secret and response to the siteverify URL', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(okFetch({ success: true }));
    await verifyTurnstileToken('my-token', 'my-secret');
    const url = spy.mock.calls[0][0] as string;
    expect(url).toContain('siteverify');
    const body = (spy.mock.calls[0][1] as RequestInit).body as URLSearchParams;
    expect(body.get('secret')).toBe('my-secret');
    expect(body.get('response')).toBe('my-token');
  });
});
