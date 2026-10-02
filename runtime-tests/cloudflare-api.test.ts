import { afterEach, describe, expect, it, vi } from 'vitest';
import { CloudflareAPI } from '../src/runtime/cloudflare-api';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('CloudflareAPI error diagnostics', () => {
  it("surfaces Cloudflare's own error message and code on a failed request", async () => {
    // Regression: a bare "(403)" told users nothing about WHICH token
    // permission or account limit actually failed.
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: false, errors: [{ code: 10003, message: 'Authentication error' }], result: null }), { status: 403 })));
    const api = new CloudflareAPI('account', 'token', 'zone');
    await expect(api.addCustomHostname('app.example.com', 'origin.example.com')).rejects.toThrow('Cloudflare POST failed (403): Authentication error (code 10003)');
  });
  it('falls back to the status-only message when the error body is not Cloudflare JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>Forbidden</html>', { status: 403 })));
    const api = new CloudflareAPI('account', 'token');
    await expect(api.query('db', 'SELECT 1')).rejects.toThrow('Cloudflare POST failed (403). Check the runtime token permissions and account limits.');
  });
  it('surfaces structured errors on an HTTP 200 with success:false', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: false, errors: [{ code: 1234, message: 'Quota exceeded' }], result: null }), { status: 200 })));
    const api = new CloudflareAPI('account', 'token');
    await expect(api.query('db', 'SELECT 1')).rejects.toThrow('Quota exceeded (code 1234)');
  });
  it('never includes the API token in thrown error messages', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: false, errors: [{ code: 10003, message: 'Authentication error' }], result: null }), { status: 403 })));
    const api = new CloudflareAPI('account', 'super-secret-token');
    const error = await api.query('db', 'SELECT 1').catch((caught: unknown) => caught);
    expect(String(error)).not.toContain('super-secret-token');
  });
});
