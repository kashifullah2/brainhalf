import { describe, expect, it } from 'vitest';
import { createTenantRequest } from '../lib/tenant-request';

describe('Tenant request credential boundary', () => {
  it('removes platform credentials from headers and URLs', async () => {
    const request = new Request('https://brainhalf.com/p/app/api/tasks?token=secret&ticket=temporary&_uid=forged&page=2', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer platform-secret',
        Cookie: 'bh_session=platform-secret; other=value',
        'X-Auth-User-Id': 'forged',
        'Proxy-Authorization': 'Basic secret',
        Referer: 'https://brainhalf.com/?token=platform-secret',
        'Content-Type': 'application/json',
        'X-App-Version': '1',
      },
      body: JSON.stringify({ title: 'New task' }),
    });

    const forwarded = createTenantRequest(request, '/api/tasks');

    expect(forwarded.url).toBe('https://brainhalf.com/api/tasks?page=2');
    for (const header of ['authorization', 'cookie', 'x-auth-user-id', 'proxy-authorization', 'referer']) {
      expect(forwarded.headers.has(header)).toBe(false);
    }
    expect(forwarded.method).toBe('POST');
    expect(forwarded.headers.get('content-type')).toBe('application/json');
    expect(forwarded.headers.get('x-app-version')).toBe('1');
    expect(await forwarded.json()).toEqual({ title: 'New task' });
    expect(request.headers.get('authorization')).toBe('Bearer platform-secret');
  });
});
