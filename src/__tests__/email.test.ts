import { DatabaseSync } from 'node:sqlite';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { AuthRegistry } from '../registry';
import { handleEmailRequest } from '../lib/email';
import { hashPassword, sha256Hex } from '../lib/crypto';
vi.mock('agents', () => ({ routeAgentRequest: vi.fn(), Agent: class {} }));
vi.mock('../agent', () => ({ ChatAgent: class {} }));
import worker from '../worker';

let db: DatabaseSync;
let registry: AuthRegistry;
let env: any;
let delivery: ReturnType<typeof vi.fn>;
const internal = (path: string, body: unknown) => registry.fetch(new Request(`https://registry${path}`, { method: 'POST', body: JSON.stringify(body) }));
const post = (path: string, body: unknown, origin = 'https://brainhalf.com') => handleEmailRequest(new Request(`https://brainhalf.com/api/${path}`, { method: 'POST', headers: { Origin: origin }, body: JSON.stringify(body) }), env);
const deliveredToken = () => JSON.parse(delivery.mock.calls[delivery.mock.calls.length - 1][1].body).text.match(/#token=([A-Za-z0-9_-]+)/)[1];

beforeEach(async () => {
  db = new DatabaseSync(':memory:');
  const storage = {
    sql: { exec: (query: string, ...args: any[]) => ({ toArray: () => db.prepare(query).all(...args) }) },
    transactionSync: (fn: () => unknown) => { db.exec('BEGIN'); try { const result = fn(); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; } },
  };
  // Execute on exec, including statements whose results aren't read.
  storage.sql.exec = (query: string, ...args: any[]) => { const rows = db.prepare(query).all(...args); return { toArray: () => rows }; };
  registry = new AuthRegistry({ storage } as any, {});
  await registry.fetch(new Request('https://registry/bootstrap'));
  env = { SESSION_SECRET: 'worker-email-session-secret-at-least-32-characters', RESEND_API_KEY: 'test-resend-key', RESEND_FROM_EMAIL: 'accounts@brainhalf.com', CONTACT_EMAIL: 'owner@example.com', REGISTRY: {
    idFromName: () => 'auth', get: () => ({ fetch: (url: string, init: RequestInit) => registry.fetch(new Request(url, init)) }),
  } };
  delivery = vi.fn(async () => Response.json({ id: 'mock-message' }));
  vi.stubGlobal('fetch', delivery);
});
afterEach(() => { vi.unstubAllGlobals(); db.close(); });

it('requires new accounts to verify, sends a branded link, and consumes it once', async () => {
  const response = await post('auth/signup', { email: 'person@example.com', password: 'strong-password', requireVerification: false });
  expect(response.status).toBe(202);
  expect(response.headers.get('set-cookie')).toBeNull();
  expect(await response.json()).toMatchObject({ verificationRequired: true });
  expect(db.prepare('SELECT * FROM sessions').all()).toHaveLength(0);
  expect((await internal('/auth/login', { email: 'person@example.com', password: 'strong-password' })).status).toBe(403);
  const email = JSON.parse(delivery.mock.calls[0][1].body);
  expect(email.html).toContain('cid:brainhalf-logo');
  expect(email.attachments[0]).toMatchObject({ filename: 'brainhalf.png', content_id: 'brainhalf-logo' });
  const token = deliveredToken();
  expect(email.text).toContain('https://brainhalf.com/verify-email#token=');
  expect(JSON.stringify(db.prepare('SELECT * FROM email_actions').all())).not.toContain(token);
  expect((await post('auth/verify-email', { token })).status).toBe(200);
  expect((await post('auth/verify-email', { token })).status).toBe(400);
  expect((await internal('/auth/login', { email: 'person@example.com', password: 'strong-password' })).status).toBe(200);
});

it('routes public signup through verification and protects the email API at the Worker boundary', async () => {
  env.SESSION_SECRET = 'worker-email-session-secret-at-least-32-characters';
  const request = new Request('https://brainhalf.com/api/auth/signup', { method: 'POST', headers: { Origin: 'https://brainhalf.com' }, body: JSON.stringify({ email: 'person@example.com', password: 'strong-password', requireVerification: false }) });
  const response = await worker.fetch(request, env, {} as any);
  expect(response.status).toBe(202);
  expect(response.headers.get('set-cookie')).toBeNull();
  expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
  expect(await response.json()).toMatchObject({ verificationRequired: true });
  const rejected = await worker.fetch(new Request('https://brainhalf.com/api/contact', { method: 'POST', headers: { Origin: 'https://evil.example' }, body: '{}' }), env, {} as any);
  expect(rejected.status).toBe(403);
});

it('resets legacy accounts, revokes sessions and tickets, and keeps project ownership', async () => {
  await internal('/auth/signup', { email: 'old@example.com', password: 'old-password' });
  const id = (db.prepare('SELECT id FROM users').get() as any).id;
  await internal('/sessions', { tokenHash: await sha256Hex('old-session'), userId: id, expiresAt: Math.floor(Date.now() / 1000) + 500 });
  expect((await internal('/ws-tickets', { userId: id, sessionHash: await sha256Hex('old-session') })).status).toBe(201);
  expect(db.prepare('SELECT * FROM ws_tickets').all()).toHaveLength(1);
  await internal('/projects/claim', { projectId: 'project-stays', userId: id });
  expect((await post('auth/forgot-password', { email: 'old@example.com' })).status).toBe(202);
  const token = deliveredToken();
  expect((await post('auth/reset-password', { token, password: 'new-password' })).status).toBe(200);
  expect((await post('auth/reset-password', { token, password: 'other-password' })).status).toBe(400);
  expect((await internal('/auth/login', { email: 'old@example.com', password: 'old-password' })).status).toBe(401);
  expect((await internal('/auth/login', { email: 'old@example.com', password: 'new-password' })).status).toBe(200);
  expect(db.prepare('SELECT * FROM sessions').all()).toHaveLength(0);
  expect(db.prepare('SELECT * FROM ws_tickets').all()).toHaveLength(0);
  expect(db.prepare('SELECT * FROM project_owners').all()).toHaveLength(1);
});

it('ties single-use WebSocket tickets to their originating session', async () => {
  const sessionHash = await sha256Hex('ticket-test-session');
  expect((await internal('/ws-tickets', { userId: 'owner' })).status).toBe(400);
  await internal('/sessions', { tokenHash: sessionHash, userId: 'owner', expiresAt: Math.floor(Date.now() / 1000) + 500 });
  const issued = await internal('/ws-tickets', { userId: 'owner', sessionHash });
  expect(issued.status).toBe(201); const { ticket } = await issued.json() as any;
  db.prepare('DELETE FROM sessions WHERE token_hash=?').run(sessionHash);
  expect((await internal('/ws-tickets/verify', { ticket })).status).toBe(401);
  expect(db.prepare('SELECT * FROM ws_tickets').all()).toHaveLength(0);
});

it('rejects expired links, wrong purpose, weak passwords, and concurrent replay', async () => {
  await internal('/auth/signup', { email: 'person@example.com', password: 'old-password' });
  await post('auth/forgot-password', { email: 'person@example.com' });
  const token = deliveredToken();
  expect((await post('auth/verify-email', { token })).status).toBe(400);
  expect((await post('auth/reset-password', { token, password: 'short' })).status).toBe(400);
  const results = await Promise.all([post('auth/reset-password', { token, password: 'new-password' }), post('auth/reset-password', { token, password: 'new-password' })]);
  expect(results.map(r => r.status).sort()).toEqual([200, 400]);
  await post('auth/forgot-password', { email: 'person@example.com' });
  db.prepare('UPDATE email_actions SET expires_at = 1').run();
  expect((await post('auth/reset-password', { token: deliveredToken(), password: 'new-password' })).status).toBe(400);
});

it('does not expose account existence or turn Google-only accounts into password accounts', async () => {
  const unknown = await post('auth/forgot-password', { email: 'missing@example.com' });
  await internal('/auth/google', { email: 'google@example.com', subject: 'google-subject' });
  const google = await post('auth/forgot-password', { email: 'google@example.com' });
  expect(await unknown.json()).toEqual(await google.json());
  expect(delivery).not.toHaveBeenCalled();
});

it('rate limits repeated emails and replaces older verification links', async () => {
  await post('auth/signup', { email: 'person@example.com', password: 'strong-password' });
  const first = deliveredToken();
  for (let i = 0; i < 5; i++) await post('auth/resend-verification', { email: 'person@example.com' });
  expect(delivery).toHaveBeenCalledTimes(4);
  expect((await post('auth/verify-email', { token: first })).status).toBe(400);
  expect((await post('auth/verify-email', { token: deliveredToken() })).status).toBe(200);
});

it('escapes contact content, fixes the destination, and rejects cross-site or oversized requests', async () => {
  const body = { name: '<script>x</script>', email: 'sender@example.com', message: '<script>alert(1)</script>', to: 'attacker@example.com' };
  expect((await post('contact', body)).status).toBe(200);
  const message = JSON.parse(delivery.mock.calls[0][1].body);
  expect(message.to).toEqual(['owner@example.com']);
  expect(message.reply_to).toBe('sender@example.com');
  expect(message.html).not.toContain('<script>');
  expect(message.html).toContain('&lt;script&gt;');
  expect((await post('contact', body, 'https://attacker.example')).status).toBe(403);
  expect((await post('contact', { ...body, message: 'x'.repeat(25_000) })).status).toBe(400);
  expect((await handleEmailRequest(new Request('https://brainhalf.com/api/auth/verify-email'), env)).status).toBe(405);
});

it('reports missing configuration and rejected delivery without exposing secrets', async () => {
  env.RESEND_API_KEY = '';
  expect((await post('auth/signup', { email: 'person@example.com', password: 'strong-password' })).status).toBe(503);
  expect(db.prepare('SELECT * FROM users').all()).toHaveLength(0);
  env.RESEND_API_KEY = 'secret-test';
  delivery.mockResolvedValue(Response.json({ error: 'private-provider-details' }, { status: 403 }));
  const response = await post('contact', { name: 'Person', email: 'person@example.com', message: 'Please help with my project.' });
  expect(response.status).toBe(503);
  expect(await response.text()).not.toMatch(/secret-test|private-provider-details/);
});

function publicRequest(path: string, method = 'POST', body?: unknown, token?: string) {
  return worker.fetch(new Request(`https://brainhalf.com/api/${path}`, {
    method,
    headers: { Origin: 'https://brainhalf.com', 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }), env, {} as any);
}

it('completes signup, verification, sign-in, session, ticket and logout through public endpoints', async () => {
  const credentials = { email: 'roundtrip@example.com', password: 'roundtrip-password' };
  expect((await publicRequest('auth/signup', 'POST', credentials)).status).toBe(202);
  expect((await publicRequest('auth/login', 'POST', credentials)).status).toBe(403);
  expect((await publicRequest('auth/verify-email', 'POST', { token: deliveredToken() })).status).toBe(200);
  expect((await publicRequest('auth/login', 'POST', { ...credentials, password: 'wrong-password' })).status).toBe(401);
  const login = await publicRequest('auth/login', 'POST', credentials);
  expect(login.status).toBe(200);
  expect(login.headers.get('set-cookie')).toMatch(/HttpOnly; Secure; SameSite=Lax/);
  const { token, user } = await login.json() as any;
  const session = await publicRequest('auth/session', 'GET', undefined, token);
  expect(session.status).toBe(200);
  expect(await session.json()).toEqual({ userId: user.id });
  const cookieSession = await worker.fetch(new Request('https://brainhalf.com/api/auth/session', { headers: { Cookie: login.headers.get('set-cookie')!.split(';')[0] } }), env, {} as any);
  expect(cookieSession.status).toBe(200);
  const ticket = await publicRequest('auth/ws-ticket', 'POST', undefined, token);
  expect(ticket.status).toBe(200);
  const ticketValue = (await ticket.json() as any).ticket;
  expect((await internal('/ws-tickets/verify', { ticket: ticketValue })).status).toBe(200);
  expect((await internal('/ws-tickets/verify', { ticket: ticketValue })).status).toBe(401);
  const logout = await publicRequest('auth/logout', 'POST', undefined, token);
  expect(logout.status).toBe(200);
  expect(logout.headers.get('set-cookie')).toContain('Max-Age=0');
  expect((await publicRequest('auth/session', 'GET', undefined, token)).status).toBe(401);
  expect((await publicRequest('auth/ws-ticket', 'POST', undefined, token)).status).toBe(401);
});

it('resends verification and resets a password through the public endpoints', async () => {
  const credentials = { email: 'reset@example.com', password: 'original-password' };
  await publicRequest('auth/signup', 'POST', credentials);
  const previous = deliveredToken();
  expect((await publicRequest('auth/resend-verification', 'POST', { email: credentials.email })).status).toBe(202);
  expect((await publicRequest('auth/verify-email', 'POST', { token: previous })).status).toBe(400);
  expect((await publicRequest('auth/verify-email', 'POST', { token: deliveredToken() })).status).toBe(200);
  const login = await publicRequest('auth/login', 'POST', credentials);
  const token = (await login.json() as any).token;
  expect((await publicRequest('auth/forgot-password', 'POST', { email: credentials.email })).status).toBe(202);
  expect((await publicRequest('auth/reset-password', 'POST', { token: deliveredToken(), password: 'updated-password' })).status).toBe(200);
  expect((await publicRequest('auth/session', 'GET', undefined, token)).status).toBe(401);
  expect((await publicRequest('auth/login', 'POST', credentials)).status).toBe(401);
  expect((await publicRequest('auth/login', 'POST', { ...credentials, password: 'updated-password' })).status).toBe(200);
});

it.each(['auth/signup', 'auth/login', 'auth/logout', 'auth/ws-ticket', 'auth/google/start', 'auth/google/complete', 'auth/forgot-password', 'auth/reset-password', 'auth/resend-verification', 'auth/verify-email', 'contact'])('rejects GET on %s without mutating state', async path => {
  const response = await publicRequest(path, 'GET');
  expect(response.status).toBe(405);
  expect(response.headers.get('Allow')).toBe('POST');
  expect(db.prepare('SELECT * FROM sessions').all()).toHaveLength(0);
  expect(delivery).not.toHaveBeenCalled();
});

it.each(['auth/session', 'auth/google/callback'])('rejects POST on %s', async path => {
  const response = await publicRequest(path, 'POST', {});
  expect(response.status).toBe(405);
  expect(response.headers.get('Allow')).toBe('GET');
});

it('routes contact success, validation and provider failure without sending any real email', async () => {
  const body = { name: 'Test Person', email: 'person@example.com', message: 'Please help with my project.' };
  expect((await publicRequest('contact', 'POST', { ...body, email: 'invalid' })).status).toBe(400);
  expect(delivery).not.toHaveBeenCalled();
  expect((await publicRequest('contact', 'POST', body)).status).toBe(200);
  delivery.mockRejectedValue(new Error('private-delivery-detail'));
  const response = await publicRequest('contact', 'POST', body);
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain('private-delivery-detail');
});

it.each(['reject', 'unavailable'])('never returns a sign-in token when session persistence is %s', async failure => {
  const credentials = { email: 'outage@example.com', password: 'strong-password' };
  await internal('/auth/signup', credentials);
  env.REGISTRY.get = () => ({ fetch: (url: string, init: RequestInit) => {
    if (new URL(url).pathname === '/sessions') {
      if (failure === 'reject') throw new Error('private-registry-detail');
      return Response.json({ error: 'private-registry-detail' }, { status: 503 });
    }
    return registry.fetch(new Request(url, init));
  } });
  const response = await publicRequest('auth/login', 'POST', credentials);
  expect(response.status).toBe(503);
  expect(response.headers.get('set-cookie')).toBeNull();
  expect(await response.json()).toEqual({ error: 'Authentication service unavailable' });
  expect(db.prepare('SELECT * FROM sessions').all()).toHaveLength(0);
});

it('reports a registry outage during login and unconfirmed revocation during logout', async () => {
  env.REGISTRY.get = () => ({ fetch: (url: string, init: RequestInit) => {
    if (['/sessions', '/auth/login'].includes(new URL(url).pathname)) throw new Error('private-registry-detail');
    return registry.fetch(new Request(url, init));
  } });
  expect((await publicRequest('auth/login', 'POST', { email: 'outage@example.com', password: 'strong-password' })).status).toBe(503);
  const logout = await publicRequest('auth/logout', 'POST', undefined, 'test-token');
  expect(logout.status).toBe(503);
  expect(logout.headers.get('set-cookie')).toContain('Max-Age=0');
  expect(await logout.text()).not.toContain('private-registry-detail');
});
