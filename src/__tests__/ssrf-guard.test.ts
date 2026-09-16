import { describe, it, expect } from 'vitest';
import {
  FETCH_MAX_BYTES,
  FETCH_MAX_TEXT,
  isPublicIp,
  isPublicRoutableHost,
  safeFetchText,
  validateFetchUrl,
} from '../lib/ssrf';

/**
 * A fetch double that records what the guard asked for and replays a canned
 * response. `redirect` responses return a 3xx with a Location header exactly as a
 * real `redirect: 'manual'` fetch would.
 */
function fakeFetch(responses: Array<{ status: number; body?: string; location?: string }>) {
  const calls: string[] = [];
  const impl = async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push(typeof input === 'string' ? input : new Request(input as RequestInfo, init).url);
    const res = responses.shift() ?? { status: 502, body: 'gone' };
    const headers = new Headers();
    if (res.location) headers.set('location', res.location);
    return new Response(res.body ?? '', { status: res.status, headers });
  };
  return { impl: impl as typeof fetch, calls };
}

describe('P3 SSRF — private and internal addresses are unreachable', () => {
  it('blocks every cloud-metadata and loopback address', () => {
    // The headline case: the cloud metadata endpoint a SSRF caller actually wants.
    expect(validateFetchUrl('http://169.254.169.254/latest/meta-data/iam/')).toMatch(/not a public/);
    expect(validateFetchUrl('http://[fd00:ec2::254]/latest/meta-data/')).toMatch(/not a public/);
    expect(validateFetchUrl('http://127.0.0.1:8788/')).toMatch(/not a public/);
    expect(validateFetchUrl('http://localhost:8788/')).toMatch(/not a public/);
    expect(validateFetchUrl('http://localhost/')).toMatch(/not a public/);
  });

  it('blocks every RFC1918 and special-use range', () => {
    const blocked = [
      'http://10.0.0.1/',
      'http://10.255.255.255/',
      'http://172.16.0.1/',
      'http://172.31.255.255/',
      'http://192.168.1.1/',
      'http://0.0.0.0/',
      'http://100.64.0.1/', // CGNAT
      'http://224.0.0.1/', // multicast
      'http://255.255.255.255/',
      'http://[::1]/',
      'http://[fe80::1]/',
      'http://[fc00::1]/',
      'http://[ff02::1]/',
    ];
    for (const u of blocked) {
      expect(validateFetchUrl(u), `${u} must be refused`).toMatch(/not a public/);
    }
  });

  it('blocks internal hostnames the shape check alone would let through', () => {
    expect(validateFetchUrl('http://metadata.google.internal/computeMetadata/')).toMatch(/not a public/);
    expect(validateFetchUrl('http://kubernetes.default.svc/')).toMatch(/not a public/);
    expect(validateFetchUrl('http://instance-data/')).toMatch(/not a public/);
  });

  it('blocks non-http(s) schemes and credential-bearing URLs', () => {
    expect(validateFetchUrl('file:///etc/passwd')).toMatch(/unsupported protocol/);
    expect(validateFetchUrl('ftp://example.com/pub/')).toMatch(/unsupported protocol/);
    expect(validateFetchUrl('http://user:pass@example.com/')).toMatch(/credentials/);
  });

  it('allows ordinary public URLs', () => {
    expect(validateFetchUrl('https://api.github.com/repos/foo/bar')).toBeNull();
    expect(validateFetchUrl('https://registry.npmjs.org/react')).toBeNull();
    expect(validateFetchUrl('http://example.com/api?x=1')).toBeNull();
  });

  it('refuses malformed URLs rather than guessing', () => {
    expect(validateFetchUrl('')).toMatch(/not a valid URL/);
    expect(validateFetchUrl('not a url')).toMatch(/not a valid URL/);
    expect(validateFetchUrl('http://')).toMatch(/not a valid URL/);
  });
});

describe('P3 IP classification', () => {
  it('recognises public IPv4 addresses', () => {
    expect(isPublicIp('8.8.8.8')).toBe(true);
    expect(isPublicIp('1.1.1.1')).toBe(true);
    expect(isPublicIp('172.32.0.1')).toBe(true); // just outside the private range
    expect(isPublicIp('172.15.0.1')).toBe(true);
  });

  it('recognises a public IPv6 address', () => {
    expect(isPublicIp('2606:4700:4700:1111:2222:3333:4444:5555')).toBe(true);
  });

  it('rejects compressed IPv6 forms conservatively', () => {
    expect(isPublicIp('::1')).toBe(false);
    expect(isPublicIp('2001:4860:4860::8888')).toBe(false);
  });
});

describe('P3 Hostname classification', () => {
  it('accepts bare and scoped names', () => {
    expect(isPublicRoutableHost('example.com')).toBe(true);
    expect(isPublicRoutableHost('api.github.com')).toBe(true);
    expect(isPublicRoutableHost('sub.domain.example.co.uk')).toBe(true);
  });

  it('rejects non-Dns shapes', () => {
    expect(isPublicRoutableHost('')).toBe(false);
    expect(isPublicRoutableHost('-bad.example.com')).toBe(false);
    expect(isPublicRoutableHost('has space.example.com')).toBe(false);
  });
});

describe('P3 Redirect re-validation', () => {
  it('follows a safe redirect and returns the final body', async () => {
    const { impl, calls } = fakeFetch([
      { status: 302, location: 'https://good.example.com/real' },
      { status: 200, body: 'final body' },
    ]);
    const res = await safeFetchText('https://good.example.com/start', impl);
    expect(res.status).toBe(200);
    expect(res.data).toBe('final body');
    expect(calls).toEqual(['https://good.example.com/start', 'https://good.example.com/real']);
  });

  it('refuses a redirect to a private address even when the first hop was public', async () => {
    const { impl } = fakeFetch([
      { status: 302, location: 'http://169.254.169.254/latest/meta-data/' },
    ]);
    const res = await safeFetchText('https://good.example.com/redirect', impl);
    expect(res.error).toMatch(/Refused redirect/);
    expect(res.data).toBe('');
  });

  it('stops a redirect chain at the hop limit', async () => {
    const { impl, calls } = fakeFetch([
      { status: 302, location: 'https://a.example.com/1' },
      { status: 302, location: 'https://a.example.com/2' },
      { status: 302, location: 'https://a.example.com/3' },
      { status: 302, location: 'https://a.example.com/4' },
    ]);
    const res = await safeFetchText('https://a.example.com/start', impl);
    expect(res.error).toMatch(/too many redirects|redirect loop/);
    expect(calls.length).toBeLessThanOrEqual(5);
  });

  it('truncates an oversized body instead of buffering it', async () => {
    const huge = 'x'.repeat(FETCH_MAX_BYTES * 4);
    const { impl } = fakeFetch([{ status: 200, body: huge }]);
    const res = await safeFetchText('https://big.example.com/', impl);
    expect(res.data.length).toBeLessThanOrEqual(FETCH_MAX_TEXT);
  });

  it('reports an aborted fetch rather than hanging', async () => {
    // The double honours the guard's AbortSignal the way the real fetch does, so
    // the deadline is exercised rather than the test simply outwaiting it.
    const impl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 5000);
        init?.signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new Error('The operation was aborted'));
        });
      });
      return new Response('never', { status: 200 });
    }) as typeof fetch;
    const res = await safeFetchText('https://slow.example.com/', impl, { timeoutMs: 400 });
    expect(res.error).toMatch(/timeout/);
  }, 10000);

  it('never calls fetch for a refused URL', async () => {
    let called = false;
    const impl = async () => {
      called = true;
      return new Response('x', { status: 200 });
    };
    const res = await safeFetchText('http://169.254.169.254/', impl);
    expect(res.error).toMatch(/Refused/);
    expect(called).toBe(false);
  });
});
