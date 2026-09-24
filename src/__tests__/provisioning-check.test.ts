import { afterEach, describe, expect, it, vi } from 'vitest';
import { provisioningCheck } from '../runtime/provisioning';

afterEach(() => vi.unstubAllGlobals());

describe('Read-only provisioning diagnostics', () => {
  it('reports malformed credentials without exposing them or sending requests', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    expect((await provisioningCheck('account', undefined, 'projects')).credential).toBe('missing');
    for (const token of ['Bearer private-value', 'private-value\n', '"private-value"']) {
      const result = await provisioningCheck('account', token, 'projects');
      expect(result.credential).toBe('format_issue');
      expect(JSON.stringify(result)).not.toContain('private-value');
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('distinguishes an active token from missing D1 access, returning only safe metadata', async () => {
    const fetcher = vi.fn(async (url: string, _init: RequestInit) => url.endsWith('/tokens/verify')
      ? Response.json({ success: true, result: { status: 'active', id: 'private-token-id' } })
      : url.includes('/d1/')
        ? Response.json({ success: false, errors: [{ code: 10000, message: 'Do not expose private-token-value' }] }, { status: 401 })
        : Response.json({ success: true, result: [{ name: 'private-project-name' }] }));
    vi.stubGlobal('fetch', fetcher);
    const result = await provisioningCheck('account', 'private-token-value', 'projects');
    expect(result.readAccess).toBe(false);
    expect(result.checks).toContainEqual({ service: 'database', ok: false, httpStatus: 401, codes: [10000] });
    expect(result.checks).toContainEqual({ service: 'user_token', ok: true, httpStatus: 200, codes: [], tokenStatus: 'active' });
    expect(JSON.stringify(result)).not.toContain('private-');
    expect(fetcher.mock.calls.every(([, init]) => !init.method || init.method === 'GET')).toBe(true);
  });

  it('supports account-owned tokens and does not claim writes were verified', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.includes('/user/tokens/')
      ? Response.json({ success: false, errors: [{ code: 1000 }] }, { status: 401 })
      : Response.json({ success: true, result: url.endsWith('/tokens/verify') ? { status: 'active' } : [] })));
    const result = await provisioningCheck('account', 'token-value', 'projects');
    expect(result.readAccess).toBe(true);
    expect(result.checks).toContainEqual({ service: 'account_token', ok: true, httpStatus: 200, codes: [], tokenStatus: 'active' });
    expect(result).not.toHaveProperty('writeAccess');
  });
});
