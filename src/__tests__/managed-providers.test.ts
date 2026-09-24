import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AuthRegistry } from '../registry';
import { ManagedProviders, handleManagedGoogle } from '../lib/managed-providers';
import { sha256Hex } from '../lib/crypto';
import { resendStatus } from '../runtime/mail-provider';
vi.mock('agents', () => ({ routeAgentRequest: vi.fn(), Agent: class {} }));
vi.mock('../agent', () => ({ ChatAgent: class {} }));
import worker from '../worker';
let db: DatabaseSync; let env: any; let broker: ManagedProviders; let provider: ReturnType<typeof vi.fn>;
const scope = { projectId: 'managed-project', ownerId: 'owner', environment: 'development' };
beforeEach(async () => {
  db = new DatabaseSync(':memory:');
  const storage: any = { sql: { exec: (query: string, ...values: any[]) => { const rows = db.prepare(query).all(...values); return { toArray: () => rows }; } }, transactionSync: (fn: () => unknown) => fn() };
  const registry = new AuthRegistry({ storage } as any, {}); await registry.fetch(new Request('https://registry/bootstrap'));
  db.prepare('INSERT INTO users VALUES (?,?,?,?)').run('owner', 'owner@example.com', 'unused-password-hash', Date.now());
  env = { GOOGLE_CLIENT_ID: 'client.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'never-expose-google', RESEND_API_KEY: 'never-expose-resend', RESEND_FROM_EMAIL: 'apps@example.com', REGISTRY: { idFromName: () => 'registry', get: () => ({ fetch: (input: string | Request, init?: RequestInit) => registry.fetch(new Request(input, init)) }) } };
  broker = new ManagedProviders({} as any, env);
  provider = vi.fn(async (url: string) => url.includes('/token') ? Response.json({ access_token: 'secret-provider-token' }) : Response.json({ sub: 'google-user', email: 'user@example.com', email_verified: true, name: 'Test User' })); vi.stubGlobal('fetch', provider);
});
afterEach(() => { vi.unstubAllGlobals(); db.close(); });
const call = (path: string, data: object = {}) => broker.fetch(new Request('https://internal' + path, { method: 'POST', body: JSON.stringify({ ...scope, ...data }) }));
async function start() {
  const proofHash = await sha256Hex('app-browser-state');
  const result = await (await call('/google/start', { proofHash })).json();
  const response = await handleManagedGoogle(new Request(result.url), env);
  const google = new URL(response.headers.get('location')!);
  return { proofHash, result, response, google, state: google.searchParams.get('state')!, cookie: response.headers.get('set-cookie')!.split(';')[0] };
}
async function finish(flow: Awaited<ReturnType<typeof start>>, cookie = flow.cookie) {
  return handleManagedGoogle(new Request('https://brainhalf.com/api/auth/google/callback?code=single-use-google-code&state=' + flow.state, { headers: { Cookie: cookie } }), env);
}
it('uses the existing callback and PKCE; returns only a browser-bound, project-scoped verified identity', async () => {
  const flow = await start(); expect(flow.google.origin).toBe('https://accounts.google.com');
  expect(flow.google.searchParams.get('redirect_uri')).toBe('https://brainhalf.com/api/auth/google/callback');
  expect(flow.state).toMatch(/^mg_[A-Za-z0-9_-]{43}$/); expect(flow.google.searchParams.get('code_challenge_method')).toBe('S256');
  expect(flow.response.headers.get('set-cookie')).toContain('__Host-bh_apps_oauth=');
  const callback = await finish(flow); const target = new URL(callback.headers.get('location')!);
  expect(target.origin).toBe('https://dev-' + (await sha256Hex(scope.projectId)).slice(0, 32) + '.apps.brainhalf.com');
  expect(target.pathname).toBe('/api/auth/google/complete'); expect(target.href).not.toContain('secret-provider-token');
  const code = target.searchParams.get('code');
  expect(await (await call('/google/redeem', { code, proofHash: flow.proofHash })).json()).toEqual({ sub: 'google-user', email: 'user@example.com', name: 'Test User' });
  expect((await call('/google/redeem', { code, proofHash: flow.proofHash })).status).toBe(401);
  expect((await finish(flow)).headers.get('location')).toBe('https://brainhalf.com/'); expect(provider).toHaveBeenCalledTimes(2);
});
it('rejects mismatched browser cookies without consuming valid flow or contacting Google', async () => {
  const flow = await start(); expect((await finish(flow, '')).headers.get('location')).toBe('https://brainhalf.com/'); expect(provider).not.toHaveBeenCalled();
  expect((await finish(flow)).headers.get('location')).toContain('/api/auth/google/complete?code=');
});
it.each([{ projectId: 'another-project' }, { environment: 'production' }, { proofHash: 'wrong-proof' }])('rejects cross-scope handoffs %j', async tamper => {
  const flow = await start(); const response = await finish(flow); const code = new URL(response.headers.get('location')!).searchParams.get('code');
  expect((await call('/google/redeem', { proofHash: flow.proofHash, code, ...tamper })).status).toBe(401);
});
it('rejects expired launch tickets, unverified Google email and attacker-supplied app origins', async () => {
  const proofHash = await sha256Hex('browser'); const launch = await (await call('/google/start', { proofHash, origin: 'https://attacker.example' })).json();
  db.prepare('UPDATE oauth_flows SET expires_at=1').run(); expect((await handleManagedGoogle(new Request(launch.url), env)).headers.get('location')).toBe('https://brainhalf.com/');
  const flow = await start(); provider.mockImplementation(async (url: string) => url.includes('/token') ? Response.json({ access_token: 'token' }) : Response.json({ sub: 'user', email: 'user@example.com', email_verified: false }));
  expect((await finish(flow)).headers.get('location')).toContain('/__brainhalf/auth?mode=login&error=google');
});
it('requires owner verification for shared production email and keeps credentials out of errors', async () => {
  expect(await (await call('/config')).json()).toMatchObject({ ownerVerified: false, emailReady: false, googleReady: true });
  const result = await call('/email', { environment: 'production', payload: { to: 'user@example.com' } }); expect(result.status).toBe(503); expect(await result.text()).not.toMatch(/never-expose/); expect(provider).not.toHaveBeenCalled();
  db.prepare("INSERT INTO oauth_identities VALUES ('google','owner-sub','owner')").run();
  expect(await (await call('/config')).json()).toMatchObject({ ownerVerified: true, emailReady: true });
});
it('does not expose provider or registry admin APIs through the public Worker', async () => {
  const ctx = { waitUntil: vi.fn() };
  for (const path of ['/admin/managed-owner?ownerId=owner', '/email/status', '/google/redeem']) {
    const result = await worker.fetch(new Request('https://brainhalf.com' + path), { ...env, ASSETS: { fetch: async () => new Response('not found', { status: 404 }) } }, ctx as any);
    expect(await result.text()).not.toMatch(/owner@example.com|never-expose|ownerVerified/);
  }
});
it.each([['sent', 'sent'], ['delivered', 'delivered'], ['opened', 'delivered'], ['bounced', 'bounced'], ['failed', 'failed']])('maps provider event %s to %s', async (event, expected) => {
  provider.mockResolvedValue(Response.json({ last_event: event })); expect(await resendStatus('key', '12345678-1234-1234-1234-123456789012')).toEqual({ status: expected });
});
