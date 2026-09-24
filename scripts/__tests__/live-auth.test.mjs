import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readPlatformSession, waitForPlatformSignIn } from '../live-auth.mjs';

const origin = 'https://brainhalf.com';
function harness(status, body, pages = []) {
  const context = new EventEmitter();
  let disposed = 0;
  context.pages = () => pages;
  context.request = { get: async (url, options) => {
    assert.equal(url, `${origin}/api/auth/session`);
    assert.equal(options.maxRedirects, 0);
    return { status: () => status, ok: () => status === 200, json: async () => body, dispose: async () => { disposed++; } };
  } };
  return { context, disposed: () => disposed };
}
function page(url, button) {
  return {
    isClosed: () => false, url: () => url,
    getByRole: (role, { name }) => ({ first: () => ({ isVisible: async () => role === 'button' && name.test(button) }) }),
    locator: () => ({}), screenshot: async () => {},
  };
}

test('sign-in requires a real successful session response with an identity', async () => {
  for (const [status, body, authenticated] of [[200, { userId: 'owner' }, true], [200, { user: { id: 'owner' } }, true], [401, { userId: 'owner' }, false], [200, { ok: true }, false], [302, { userId: 'owner' }, false]]) {
    const state = harness(status, body);
    assert.deepEqual(await readPlatformSession(state.context, origin), { status, authenticated });
    assert.equal(state.disposed(), 1);
  }
});

test('sign-in recognizes the dashboard or workspace in another tab after Google navigation', async () => {
  for (const [path, button] of [['/dashboard', 'User profile'], ['/?project=existing', 'User profile and menu'], ['/', 'Dashboard']]) {
    const target = page(origin + path, button);
    const { context } = harness(200, { userId: 'owner' }, [page('https://accounts.google.com/?code=private', 'Dashboard'), target]);
    assert.equal(await waitForPlatformSignIn(context, { origin, timeoutMs: 100 }), target);
    assert.equal(context.listenerCount('close'), 0);
  }
});

test('a stale signed-in control or a server session without signed-in UI cannot start generation', async () => {
  for (const [status, button] of [[401, 'Dashboard'], [200, 'Sign in']]) {
    const { context } = harness(status, { userId: 'owner' }, [page(origin, button)]);
    await assert.rejects(waitForPlatformSignIn(context, { origin, timeoutMs: 5, intervalMs: 1 }), /No app generation was started/);
    assert.equal(context.listenerCount('close'), 0);
  }
});

test('failed sign-in evidence omits OAuth codes, session bodies and credential-bearing URLs', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'brainhalf-sign-in-'));
  try {
    const { context } = harness(401, { token: 'private-token', email: 'private@example.test' }, [page(`${origin}/?google=complete&token=private-token`, 'Sign in'), page('https://accounts.google.com/?code=private-code', '')]);
    await assert.rejects(waitForPlatformSignIn(context, { origin, directory, timeoutMs: 5, intervalMs: 1 }));
    const diagnostic = readFileSync(join(directory, 'sign-in-diagnostic.json'), 'utf8');
    assert.doesNotMatch(diagnostic, /private|token|email|code=/);
    assert.equal(JSON.parse(diagnostic).sessionStatus, 401);
    assert.deepEqual(JSON.parse(diagnostic).pages, ['/', 'external-sign-in']);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
