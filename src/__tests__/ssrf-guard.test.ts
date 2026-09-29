import { describe, it, expect, vi, afterEach } from 'vitest';
import { assertSafeFetchUrl, safeFetchText } from '../lib/ssrf-guard';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ssrf-guard URL validation', () => {
  it('allows ordinary public https URLs', () => {
    const url = assertSafeFetchUrl('https://api.example.com/data?q=1');
    expect(url.hostname).toBe('api.example.com');
  });

  it.each([
    'http://127.0.0.1/',
    'http://127.0.0.1:8080/admin',
    'http://10.0.0.5/',
    'http://10.255.255.1/x',
    'http://172.16.4.4/',
    'http://172.31.255.255/',
    'http://192.168.1.1/',
    'http://169.254.169.254/latest/meta-data/',
    'http://0.0.0.0/',
    'http://100.64.0.1/',
  ])('blocks private/link-local IPv4: %s', (url) => {
    expect(() => assertSafeFetchUrl(url)).toThrow(/private|blocked/i);
  });

  it.each([
    'http://[::1]/',
    'http://[fe80::1]/',
    'http://[fc00::1]/',
    'http://[fd00::1]/',
    'http://[::ffff:127.0.0.1]/', // IPv4-mapped loopback
    'http://[::ffff:10.1.2.3]/',
  ])('blocks dangerous IPv6: %s', (url) => {
    expect(() => assertSafeFetchUrl(url)).toThrow(/private|blocked/i);
  });

  it.each([
    'http://0x7f.0.0.1/', // hex-obfuscated loopback
    'http://2130706433/', // single-integer loopback
    'http://0177.0.0.1/', // octal-obfuscated loopback
  ])('blocks obfuscated loopback IPs: %s', (url) => {
    expect(() => assertSafeFetchUrl(url)).toThrow(/private|blocked/i);
  });

  it('blocks localhost names and metadata hosts', () => {
    expect(() => assertSafeFetchUrl('http://localhost:3000/')).toThrow(/blocked/i);
    expect(() => assertSafeFetchUrl('http://foo.localhost/')).toThrow(/blocked/i);
    expect(() => assertSafeFetchUrl('http://metadata.google.internal/')).toThrow(/blocked/i);
  });

  it('blocks non-http schemes and embedded credentials', () => {
    expect(() => assertSafeFetchUrl('file:///etc/passwd')).toThrow(/only http/i);
    expect(() => assertSafeFetchUrl('ftp://example.com/x')).toThrow(/only http/i);
    expect(() => assertSafeFetchUrl('data:text/plain,hi')).toThrow(/only http/i);
    expect(() => assertSafeFetchUrl('https://user:pass@example.com/')).toThrow(/credentials/i);
  });

  it('rejects empty and malformed URLs', () => {
    expect(() => assertSafeFetchUrl('')).toThrow();
    expect(() => assertSafeFetchUrl('not a url')).toThrow();
    expect(() => assertSafeFetchUrl('http://')).toThrow();
  });

  it('does not block public lookalikes', () => {
    // 172.32.x.x is public (only 172.16-31 is private)
    expect(assertSafeFetchUrl('http://172.32.0.1/').hostname).toBe('172.32.0.1');
    // 100.128.x.x is public (only 100.64-127 is CGNAT)
    expect(assertSafeFetchUrl('http://100.128.0.1/').hostname).toBe('100.128.0.1');
    // public IPv4-mapped IPv6 (::ffff:808:808 == 8.8.8.8) is allowed
    expect(() => assertSafeFetchUrl('http://[::ffff:808:808]/')).not.toThrow();
  });
});

describe('safeFetchText redirect handling', () => {
  it('validates every redirect hop and refuses a hop to a private IP', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/secret' } }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(safeFetchText('https://example.com/start')).rejects.toThrow(/private|blocked/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('follows a safe redirect and returns the final body', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'https://cdn.example.com/asset' } }))
      .mockResolvedValueOnce(new Response('hello', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await safeFetchText('https://example.com/start');
    expect(res.status).toBe(200);
    expect(res.text).toBe('hello');
    expect(res.finalUrl).toBe('https://cdn.example.com/asset');
  });

  it('stops after too many redirects', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { location: 'https://example.com/loop' } }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(safeFetchText('https://example.com/start')).rejects.toThrow(/too many redirects/i);
  });

  it('rejects oversized responses', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('x'.repeat(100), {
      status: 200,
      headers: { 'content-length': String(10 * 1024 * 1024) },
    }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(safeFetchText('https://example.com/big', { maxBytes: 1024 })).rejects.toThrow(/too large/i);
  });

  it('rejects the initial URL before any fetch happens', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(safeFetchText('http://169.254.169.254/')).rejects.toThrow(/private|blocked/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
