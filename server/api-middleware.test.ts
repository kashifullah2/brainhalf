import { describe, expect, it } from 'vitest';

import { onRequest as middleware } from '../functions/api/_middleware';
import type { AppEnv } from './http';

// The middleware is the only thing every /api request passes through, and it was
// untested. It carries three separate protections.

type Handler = (ctx: unknown) => Promise<Response>;

function run(
  request: Request,
  next: () => Promise<Response> = async () => new Response('{"ok":true}', {
    headers: { 'Content-Type': 'application/json' },
  }),
): Promise<Response> {
  return (middleware as unknown as Handler)({
    request,
    next,
    env: {} as AppEnv,
  }) as Promise<Response>;
}

const URL_BATCHES = 'https://app.example.com/api/batches';

function post(headers: Record<string, string>): Request {
  return new Request(URL_BATCHES, { method: 'POST', headers });
}

describe('cross-site rejection', () => {
  it('allows a same-origin mutating request', async () => {
    const response = await run(
      post({ Origin: 'https://app.example.com', 'Sec-Fetch-Site': 'same-origin' }),
    );
    expect(response.status).toBe(200);
  });

  it('refuses a cross-site request by Sec-Fetch-Site', async () => {
    for (const site of ['cross-site', 'same-site']) {
      const response = await run(post({ 'Sec-Fetch-Site': site }));
      expect(response.status).toBe(403);
    }
  });

  it('refuses a mismatched Origin even when Sec-Fetch-Site is absent', async () => {
    const response = await run(post({ Origin: 'https://evil.example.com' }));
    expect(response.status).toBe(403);
  });

  it('allows Sec-Fetch-Site: none, which is a user-initiated navigation', async () => {
    const response = await run(post({ 'Sec-Fetch-Site': 'none' }));
    expect(response.status).toBe(200);
  });

  it('leaves a request with neither header alone', async () => {
    // That shape is a non-browser client. CSRF needs a browser to make the
    // request, so refusing this would break tooling to stop nothing.
    const response = await run(post({}));
    expect(response.status).toBe(200);
  });

  it('never blocks a read, whatever its origin says', async () => {
    for (const method of ['GET', 'HEAD']) {
      const request = new Request(URL_BATCHES, {
        method,
        headers: { Origin: 'https://evil.example.com' },
      });
      expect((await run(request)).status).toBe(200);
    }
  });
});

describe('unhandled errors', () => {
  it('turns a thrown handler into our JSON error shape, not a Pages HTML page', async () => {
    const response = await run(new Request(URL_BATCHES), async () => {
      throw new Error('D1 exploded: table batches has no column named prompt');
    });
    expect(response.status).toBe(500);
    const body = (await response.json()) as { error?: string };
    // The real reason goes to the logs. A thrown exception names tables, columns
    // and bindings, so it must not reach the user.
    expect(body.error).not.toContain('batches');
    expect(body.error).toBeTruthy();
  });
});

describe('HTML falling through to the SPA shell', () => {
  it('turns an unclaimed /api path into a 404 instead of a page of HTML', async () => {
    // `/* /index.html 200` in public/_redirects means a retired endpoint answered
    // 200 with the app shell, and the client blamed the wrong thing entirely.
    const response = await run(new Request('https://app.example.com/api/typo'), async () =>
      new Response('<!DOCTYPE html><html></html>', {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      }),
    );
    expect(response.status).toBe(404);
  });

  it('exempts /api/storage, which legitimately serves uploaded HTML', async () => {
    const response = await run(
      new Request('https://app.example.com/api/storage/usr_1/page.html'),
      async () =>
        new Response('<!DOCTYPE html><html></html>', {
          headers: { 'Content-Type': 'text/html' },
        }),
    );
    expect(response.status).toBe(200);
  });
});
