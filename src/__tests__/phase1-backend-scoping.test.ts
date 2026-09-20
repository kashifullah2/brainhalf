import { describe, it, expect, vi } from 'vitest';

/**
 * Task 1.4 regression cover: the `/api/*` hand-off to the simulated backend used
 * to receive the full workspace plus every request header, including
 * `authorization` and `cookie` — headers that carry the 30-day platform session
 * token. The generated code running on the other end had no use for it.
 *
 * Two things were tightened: the file reader is scoped to `/server/*`, and the
 * forwarded headers go through an allowlist. Both are tested against the real
 * `ChatAgent` code, not a reimplementation.
 */
vi.mock('cloudflare:workers', () => ({
  tracing: { enterSpan: async (_name: string, fn: () => any) => fn() },
}));
vi.mock('agents', () => ({ Agent: class Agent {} }));

import { ChatAgent, selectForwardableHeaders } from '../agent';
import { USER_ID_HEADER } from '../lib/auth';

describe('P1 — only allowlisted headers reach the generated backend', () => {
  it('drops authorization and cookie', () => {
    const headers = new Headers({
      authorization: 'Bearer bh_real_session_token',
      cookie: 'bh_session=bh_real_session_token',
      'content-type': 'application/json',
    });
    const out = selectForwardableHeaders(headers);
    expect(out).not.toHaveProperty('authorization');
    expect(out).not.toHaveProperty('cookie');
    expect(out['content-type']).toBe('application/json');
  });

  it('passes the verified user id through', () => {
    // Identity travels on this header, set by the Worker after it verifies the
    // session — not on a forwarded bearer token.
    const out = selectForwardableHeaders(new Headers({ [USER_ID_HEADER]: 'user-1' }));
    expect(out[USER_ID_HEADER]).toBe('user-1');
  });

  it('keeps content-length and drops hop-by-hop and ad-hoc headers', () => {
    const out = selectForwardableHeaders(
      new Headers({
        'content-length': '42',
        'accept-encoding': 'gzip',
        host: 'brainhalf.com',
        'x-forwarded-for': '203.0.113.1',
        'x-bh-csrf': 'anything',
      })
    );
    expect(out['content-length']).toBe('42');
    expect(out).not.toHaveProperty('host');
    expect(out).not.toHaveProperty('x-forwarded-for');
    expect(out).not.toHaveProperty('x-bh-csrf');
  });

  it('is case-insensitive', () => {
    const out = selectForwardableHeaders(new Headers({ 'Content-Type': 'text/plain' }));
    expect(out['content-type']).toBe('text/plain');
  });

  it('never forwards a raw session token under any name', () => {
    const out = selectForwardableHeaders(
      new Headers({ Authorization: 'bh_payload.signature', Cookie: 'bh_session=x' })
    );
    expect(JSON.stringify(out)).not.toContain('bh_payload');
    expect(JSON.stringify(out)).not.toContain('bh_session');
  });
});

describe('P1 — the backend hand-off sees only /server/* files', () => {
  /** Minimal `ChatAgent` double: only the backup reader is exercised. */
  function agentWithFiles(files: Record<string, string>) {
    const agent: any = Object.create(ChatAgent.prototype);
    agent.readAllProjectFilesForBackup = () => files;
    return agent;
  }

  it('includes server sources under both leading-slash and bare forms', () => {
    const agent = agentWithFiles({
      '/server/index.ts': 'export {}',
      'server/db.ts': 'export {}',
      '/src/App.tsx': 'client',
      '/README.md': 'docs',
    });
    expect(agent.readServerFilesForBackend()).toEqual({
      '/server/index.ts': 'export {}',
      'server/db.ts': 'export {}',
    });
  });

  it('never hands the client sources or other workspace files to the backend', () => {
    const agent = agentWithFiles({
      '/src/App.tsx': 'client',
      '/src/secret.txt': 'client',
      '/server/index.ts': 'server',
    });
    const out = agent.readServerFilesForBackend();
    expect(Object.keys(out)).toEqual(['/server/index.ts']);
  });

  it('returns nothing when the project has no server directory', () => {
    const agent = agentWithFiles({ '/src/App.tsx': 'client' });
    expect(agent.readServerFilesForBackend()).toEqual({});
  });
});

describe('P1 — the raw-token export is gone from auth-client', () => {
  it('does not export a token-appending URL helper', async () => {
    const mod = await import('../lib/auth-client');
    expect(mod).not.toHaveProperty('withTokenQuery');
    expect(mod).not.toHaveProperty('withWsTokenQuery');
  });
});
