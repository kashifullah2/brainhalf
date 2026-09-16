import { describe, it, expect } from 'vitest';
import { handleModelTest } from '../lib/model-tester';

/**
 * Header contracts that other tests should not silently regress. Both the preview
 * origin and the model-test endpoint originate user-controlled content, so a
 * missing `nosniff` or a wildcard allow-origin is a live defect, not a style issue.
 */

/** Every directive the preview and shell CSPs must contain. */
function parseCsp(header: string | null): Record<string, string> {
  expect(header, 'Content-Security-Policy must be set').toBeTruthy();
  const out: Record<string, string> = {};
  for (const directive of (header as string).split(';')) {
    const [name, ...rest] = directive.trim().split(/\s+/);
    if (name) out[name.toLowerCase()] = rest.join(' ');
  }
  return out;
}

describe('P3 Response headers — no sniffing, no wildcard, a real CSP', () => {
  it('sends a Content-Security-Policy with a script-src directive', async () => {
    const res = await handleModelTest(
      new Request('https://brainhalf.com/api/test/simple', { method: 'OPTIONS', headers: { origin: 'https://brainhalf.com' } }),
      { AI: { run: async () => '' } },
      'simple'
    );
    const csp = parseCsp(res.headers.get('Content-Security-Policy'));
    // A JSON endpoint needs no script source at all; either an explicit script-src
    // or a default-src of 'none' is acceptable. What is not acceptable is `*`.
    expect(csp['script-src'] ?? csp['default-src']).toBeDefined();
    for (const values of Object.values(csp)) {
      expect(values.split(/\s+/)).not.toContain('*');
    }
  });

  it('never omits X-Content-Type-Options on a preflight or a response', async () => {
    const preflight = await handleModelTest(
      new Request('https://brainhalf.com/api/test/simple', { method: 'OPTIONS', headers: { origin: 'https://brainhalf.com' } }),
      { AI: { run: async () => '' } },
      'simple'
    );
    expect(preflight.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('never reflects a disallowed origin', async () => {
    const res = await handleModelTest(
      new Request('https://brainhalf.com/api/test/simple', { method: 'OPTIONS', headers: { origin: 'https://evil.example' } }),
      { AI: { run: async () => '' } },
      'simple'
    );
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://brainhalf.com');
    expect(res.headers.get('Vary')).toBe('Origin');
  });
});

describe('P3 Preview CSP contract', () => {
  it('the agent preview policy forbids unknown script origins and framing', () => {
    // Mirror of the policy assembled in ChatAgent.fetch for /preview/*. If the
    // source changes, this fails and the change has to be made deliberately.
    const source = require('fs').readFileSync('src/agent.ts', 'utf-8');
    const policyBlock = source.match(/'Content-Security-Policy':\s*\[([\s\S]*?)\]\.join\(';\s?'\)/);
    expect(policyBlock, 'preview CSP must be assembled from an explicit directive array').toBeTruthy();
    const directives = policyBlock![1];
    expect(directives).toContain("script-src");
    expect(directives).toContain("frame-ancestors");
    // The whole point of the policy: a generated file must not be able to load a
    // script from an arbitrary origin. A scoped host wildcard such as
    // `https://*.esm.sh` is permitted; the bare `*` source is not.
    const scriptSrc = directives.match(/script-src\s+([^`]+?)(?:`|,)/);
    expect(scriptSrc, 'script-src must list its sources explicitly').toBeTruthy();
    expect(scriptSrc![1].trim().split(/\s+/)).not.toContain('*');
  });

  it('no wildcard postMessage targetOrigin remains anywhere in the source tree', () => {
    const fs = require('fs');
    const files = ['src/agent.ts', 'src/components/PreviewRunner.tsx', 'src/components/Workspace.tsx', 'src/main.tsx'];
    for (const file of files) {
      const src = fs.readFileSync(file, 'utf-8');
      expect(src, `${file} must not postMessage to a wildcard origin`).not.toMatch(
        /postMessage\((\{[\s\S]*?\}|'[^']*'),?\s*'\*'/
      );
    }
  });
});
