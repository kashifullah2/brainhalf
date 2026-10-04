import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// worker.ts imports the agents SDK and the agent DO at module scope; without
// these stubs the real modules pull in the `cloudflare:` protocol and the node
// ESM loader rejects them. worker.test.ts uses the same guard.
vi.mock('agents', () => ({
  routeAgentRequest: vi.fn(),
  Agent: class MockAgent {},
}));
vi.mock('../agent', () => ({
  ChatAgent: class MockChatAgent {},
}));

import { shellSecurityHeaders } from '../worker';
import { previewSecurityHeaders } from '../lib/preview-isolation';

/**
 * Cloudflare serves the static shell from [assets] without invoking the Worker
 * (unless run_worker_first is set), so `public/_headers` -- not
 * shellSecurityHeaders() -- is what actually hardens the app surface in
 * production. The two are easy to drift apart: edit one, forget the other, and
 * production silently runs a looser CSP than every local test asserts.
 *
 * This test makes the divergence fail the build instead.
 */
describe('deploy config drift (public/_headers vs worker)', () => {
  const headersPath = resolve(__dirname, '../../public/_headers');
  const raw = readFileSync(headersPath, 'utf8');

  /** Parses a `_headers` file into { urlPattern: { Header: value } }. */
  function parseHeaders(text: string): Record<string, Record<string, string>> {
    const out: Record<string, Record<string, string>> = {};
    let pattern: string | null = null;
    for (const line of text.split('\n')) {
      if (!line.trim() || line.trim().startsWith('#')) continue;
      // A header row is indented; a pattern row is not.
      if (/^\s/.test(line)) {
        if (!pattern) continue;
        const sep = line.trim().indexOf(':');
        if (sep === -1) continue;
        const k = line.trim().slice(0, sep).trim();
        const v = line.trim().slice(sep + 1).trim();
        out[pattern][k] = v;
      } else {
        pattern = line.trim();
        out[pattern] = {};
      }
    }
    return out;
  }

  it('ships a CSP for the catch-all /* pattern', () => {
    const parsed = parseHeaders(raw);
    expect(parsed['/*']).toBeDefined();
    expect(parsed['/*']['Content-Security-Policy']).toBeDefined();
  });

  it('allows the GitHub export API without allowing arbitrary HTTPS connections', () => {
    const policy = parseHeaders(raw)['/*']['Content-Security-Policy'];
    const connect = policy.split(';').find(directive => directive.trim().startsWith('connect-src'))!;
    expect(connect.trim().split(/\s+/)).toEqual(['connect-src', "'self'", 'https://cloudflareinsights.com', 'https://api.github.com', 'https://cdn.jsdelivr.net', 'https://esm.sh', 'https://registry.npmjs.org', 'https://*.webcontainer.io', 'https://*.stackblitz.io', 'https://www.googletagmanager.com', 'https://*.google-analytics.com', 'https://*.google.com', 'https://pagead2.googlesyndication.com', 'https://googleads.g.doubleclick.net', 'https://*.googlesyndication.com', 'https://*.adtrafficquality.google', 'https://csi.gstatic.com']);
  });

  it('matches shellSecurityHeaders() directive-for-directive', () => {
    const workerCsp = shellSecurityHeaders()['Content-Security-Policy'];
    const fileCsp = parseHeaders(raw)['/*']['Content-Security-Policy'];

    // Compare as a set of directives so whitespace/ordering between the array
    // join and the flat file line does not matter.
    const normalize = (csp: string) =>
      csp.split(';').map(d => d.trim()).filter(Boolean).sort();

    expect(normalize(fileCsp)).toEqual(normalize(workerCsp));
  });

  it('carries the same non-CSP hardening headers as the worker', () => {
    const worker = shellSecurityHeaders();
    const file = parseHeaders(raw)['/*'];
    // _headers spells X-Frame-Options and Cache-Control differently (the file
    // pins no-cache on /index.html separately), so only the shared subset is
    // asserted here.
    for (const key of [
      'X-Content-Type-Options',
      'Referrer-Policy',
      'Cross-Origin-Resource-Policy',
      'Cross-Origin-Embedder-Policy',
      'Cross-Origin-Opener-Policy',
      'Permissions-Policy',
    ]) {
      expect(file[key], `${key} must match between _headers and the worker`).toBe(worker[key]);
    }
  });

  it('overrides the shell CSP for preview routes with the preview CSP', () => {
    const parsed = parseHeaders(raw);
    const previewCsp = previewSecurityHeaders()['Content-Security-Policy'];
    const normalize = (csp: string) =>
      csp.split(';').map(d => d.trim()).filter(Boolean).sort();

    for (const pattern of ['/preview/*', '/p/*']) {
      expect(parsed[pattern], `${pattern} must be defined in _headers`).toBeDefined();
      expect(parsed[pattern]['Content-Security-Policy'], `${pattern} must have a CSP`).toBeDefined();
      expect(normalize(parsed[pattern]['Content-Security-Policy'])).toEqual(normalize(previewCsp));
    }
  });
});
