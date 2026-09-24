import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthRegistry } from '../registry';
import { handleGoogleAuth } from '../lib/google-auth';
import { sha256Hex } from '../lib/crypto';
import type { DurableObjectState } from '@cloudflare/workers-types';

vi.mock('agents', () => ({ routeAgentRequest: vi.fn(), Agent: class {} }));
vi.mock('../agent', () => ({ ChatAgent: class {} }));
import worker from '../worker';

const base = 'https://brainhalf.com';
const origin = { Origin: base };
let database: DatabaseSync;
let registry: AuthRegistry;
let env: any;
let provider: ReturnType<typeof vi.fn>;
const internal = (path: string, data: unknown) => registry.fetch(new Request(`https://registry${path}`, { method: 'POST', body: JSON.stringify(data) }));
const request = (path: string, init?: RequestInit) => new Request(`${base}/api/auth/google/${path}`, init);

beforeEach(async () => {
  database = new DatabaseSync(':memory:');
  const storage = {
    sql: { exec: (query: string, ...values: any[]) => ({ toArray: () => database.prepare(query).all(...values) }) },
    transactionSync: (fn: () => unknown) => { database.exec('BEGIN'); try { const value = fn(); database.exec('COMMIT'); return value; } catch (error) { database.exec('ROLLBACK'); throw error; } },
  };
  // Execute at exec time, just like Durable Object SQLite.
  storage.sql.exec = (query: string, ...values: any[]) => { const rows = database.prepare(query).all(...values); return { toArray: () => rows }; };
  registry = new AuthRegistry({ storage } as unknown as DurableObjectState, {});
  await registry.fetch(new Request('https://registry/bootstrap'));
  env = { SESSION_SECRET: 'google-oauth-test-secret-at-least-32-characters', GOOGLE_CLIENT_ID: 'test-client.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'test-secret',
    REGISTRY: { idFromName: () => 'auth', get: () => ({ fetch: (input: string | Request, init?: RequestInit) => registry.fetch(new Request(input, init)) }) } };
  provider = vi.fn(async (input: string) => input.includes('/token') ? Response.json({ access_token: 'provider-access-token' }) : Response.json({ sub: 'google-person-1', email: 'person@example.com', email_verified: true }));
  vi.stubGlobal('fetch', provider);
});
afterEach(() => { vi.unstubAllGlobals(); database.close(); });

async function start() {
  const response = await handleGoogleAuth(request('start', { method: 'POST', headers: origin, body: JSON.stringify({ project: 'saved-project' }) }), env);
  expect(response.status).toBe(200);
  const authorization = new URL((await response.json()).url);
  return { authorization, cookie: response.headers.get('Set-Cookie')!.split(';')[0], state: authorization.searchParams.get('state')! };
}
async function callback(flow: Awaited<ReturnType<typeof start>>, suffix = '') {
  return handleGoogleAuth(request(`callback?code=one-use-code&state=${flow.state}${suffix}`, { headers: { Cookie: flow.cookie, 'Sec-Fetch-Site': 'cross-site' } }), env);
}

it('starts with PKCE and a secure HttpOnly browser-bound state, preserving the project', async () => {
  const { authorization, state } = await start();
  expect(authorization.origin).toBe('https://accounts.google.com');
  expect(authorization.searchParams.get('redirect_uri')).toBe(`${base}/api/auth/google/callback`);
  expect(authorization.searchParams.get('code_challenge_method')).toBe('S256');
  expect(authorization.searchParams.get('code_challenge')).toHaveLength(43);
  expect(state).toHaveLength(43);
  expect(authorization.searchParams.has('client_secret')).toBe(false);
  const response = await handleGoogleAuth(request('start', { method: 'POST', headers: origin }), env);
  expect(response.headers.get('set-cookie')).toMatch(/HttpOnly; SameSite=Lax; Max-Age=600; Secure/);
});

it('completes once, keeps credentials out of redirect URLs, and creates a revocable session', async () => {
  const flow = await start();
  const result = await callback(flow);
  expect(result.status).toBe(303);
  expect(result.headers.get('Location')).toBe(`${base}/?project=saved-project&google=complete`);
  expect(provider.mock.calls[0][1].body.get('code_verifier')).toHaveLength(43);
  expect(provider.mock.calls[1][1].headers.Authorization).toBe('Bearer provider-access-token');
  const handoff = result.headers.get('Set-Cookie')!.split(';')[0];
  const response = await handleGoogleAuth(request('complete', { method: 'POST', headers: { ...origin, Cookie: handoff } }), env);
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.user.email).toBe('person@example.com');
  expect(response.headers.getSetCookie()).toHaveLength(2);
  const record = database.prepare('SELECT user_id FROM sessions WHERE token_hash = ?').get(await sha256Hex(body.token));
  expect(record?.user_id).toBe(body.user.id);
  const replay = await handleGoogleAuth(request('complete', { method: 'POST', headers: { ...origin, Cookie: handoff } }), env);
  expect(replay.status).toBe(401);
  expect((await callback(flow)).headers.get('Location')).toContain('google=expired');
  expect(provider).toHaveBeenCalledTimes(2);
});

it('rejects missing, mismatched and expired state before contacting Google', async () => {
  const flow = await start();
  const missing = await handleGoogleAuth(request(`callback?code=code&state=${flow.state}`), env);
  expect(missing.headers.get('Location')).toContain('google=expired');
  const mismatch = await handleGoogleAuth(request(`callback?code=code&state=${'a'.repeat(43)}`, { headers: { Cookie: flow.cookie } }), env);
  expect(mismatch.headers.get('Location')).toContain('google=expired');
  database.prepare('UPDATE oauth_flows SET expires_at = 1').run();
  expect((await callback(flow)).headers.get('Location')).toContain('google=expired');
  expect(provider).not.toHaveBeenCalled();
});

it('handles cancellation and consumes the flow', async () => {
  const flow = await start();
  expect((await callback(flow, '&error=access_denied')).headers.get('Location')).toContain('google=cancelled');
  expect((await callback(flow)).headers.get('Location')).toContain('google=expired');
  expect(provider).not.toHaveBeenCalled();
});

it('requires verified email and handles provider failures without leaking provider details', async () => {
  provider.mockImplementation(async (input: string) => input.includes('/token') ? Response.json({ access_token: 'token' }) : Response.json({ sub: 'google-person-1', email: 'person@example.com', email_verified: false }));
  expect((await callback(await start())).headers.get('Location')).toContain('google=unverified');
  expect(database.prepare('SELECT * FROM users').all()).toHaveLength(0);
  provider.mockImplementation(async () => Response.json({ error: 'sensitive-provider-error' }, { status: 400 }));
  expect((await callback(await start())).headers.get('Location')).toContain('google=failed');
});

it('does not link a matching email to an unverified password account', async () => {
  database.prepare('INSERT INTO users VALUES (?, ?, ?, ?)').run('existing', 'person@example.com', 'password-hash', Date.now());
  expect((await callback(await start())).headers.get('Location')).toContain('google=existing_account');
  expect(database.prepare('SELECT * FROM oauth_identities').all()).toHaveLength(0);
});

it('uses the immutable Google subject for returning users and prevents password login for Google-only accounts', async () => {
  const first = await (await internal('/auth/google', { subject: 'immutable-google-sub', email: 'original@example.com' })).json();
  const again = await (await internal('/auth/google', { subject: 'immutable-google-sub', email: 'changed@example.com' })).json();
  expect(again.userId).toBe(first.userId);
  expect(database.prepare('SELECT * FROM users').all()).toHaveLength(1);
  const login = await internal('/auth/login', { email: 'original@example.com', password: '!google-only' });
  expect(login.status).toBe(401);
});

it('rejects expired handoffs, wrong flow kinds, cross-origin POSTs, and wrong methods', async () => {
  const flow = await start();
  const wrongKind = await internal('/oauth/consume', { key: flow.state, kind: 'handoff' });
  expect(await wrongKind.json()).toBeNull();
  const result = await callback(flow);
  database.prepare('UPDATE oauth_flows SET expires_at = 1').run();
  expect((await handleGoogleAuth(request('complete', { method: 'POST', headers: { ...origin, Cookie: result.headers.get('Set-Cookie')! } }), env)).status).toBe(401);
  expect((await handleGoogleAuth(request('start', { method: 'POST', headers: { Origin: 'https://attacker.example' } }), env)).status).toBe(403);
  expect((await handleGoogleAuth(request('start'), env)).status).toBe(405);
});

it('fails honestly when configuration or registry is unavailable', async () => {
  expect((await handleGoogleAuth(request('start', { method: 'POST', headers: origin }), { ...env, GOOGLE_CLIENT_SECRET: '' })).status).toBe(503);
  env.REGISTRY.get = () => ({ fetch: async () => { throw new Error('offline'); } });
  expect((await handleGoogleAuth(request('start', { method: 'POST', headers: origin }), env)).status).toBe(503);
});

it('allows only the Google callback through the Worker cross-site guard', async () => {
  const flow = await start();
  const accepted = await worker.fetch(request(`callback?code=code&state=${flow.state}`, { headers: { Cookie: flow.cookie, 'Sec-Fetch-Site': 'cross-site' } }), env, {} as any);
  expect(accepted.status).toBe(303);
  expect(accepted.headers.get('Location')).toContain('google=complete');
  for (const path of ['start', 'complete']) {
    expect((await worker.fetch(request(path, { method: 'POST', headers: { ...origin, 'Sec-Fetch-Site': 'cross-site' } }), env, {} as any)).status).toBe(403);
  }
});
