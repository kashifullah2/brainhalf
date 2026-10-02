import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

// Run runtime:check first. Exercise the actual bundled Worker, RPC and SQLite
// objects in workerd without provisioning cloud resources or calling providers.
const runtime = new Miniflare(convertV4MiniflareOptions({
  workers: [
    {
      name: 'test-gateway', modules: true, compatibilityDate: '2026-09-22',
      script: `export default { fetch(request, env) { return new URL(request.url).hostname === 'control.test' ? env.CONTROL.fetch(request) : new URL(request.url).hostname === 'services.test' ? env.SERVICES.fetch(request) : env.RUNTIME.fetch(request); } };`,
      serviceBindings: { CONTROL: { name: 'runtime', entrypoint: 'RuntimeControl' }, SERVICES: { name: 'runtime', entrypoint: 'AppServicesAPI' }, RUNTIME: 'runtime' },
    },
    {
      name: 'runtime', modules: true,
      script: readFileSync(process.argv[2] || '/tmp/brainhalf-runtime-build/worker.js', 'utf8'),
      compatibilityDate: '2026-09-22', compatibilityFlags: ['nodejs_compat'],
      bindings: { RUNTIME_ENABLED: 'true', RUNTIME_DOMAIN: 'apps.example.test', PILOT_OWNER_IDS: 'local-owner', CF_ACCOUNT_ID: '', DISPATCH_NAMESPACE: 'local', PROJECT_SECRETS_KEY: Buffer.alloc(32, 7).toString('base64') },
      durableObjects: { PROJECTS: { className: 'ProjectRuntime', useSQLite: true }, PILOT: { className: 'PilotCoordinator', useSQLite: true } },
      r2Buckets: ['ARTIFACTS'],
      outboundService: () => new Response('External network disabled for this test', { status: 503 }),
    },
  ],
}));

const control = (path, method = 'GET', body, project = 'local-project', owner = 'local-owner') => runtime.dispatchFetch(`https://control.test${path}`, {
  method, headers: { 'x-bh-project': project, 'x-bh-owner': owner, 'Content-Type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual',
});

try {
  const status = await control('/status'); assert.equal(status.status, 200, await status.clone().text());
  assert.equal((await status.json()).capabilities.database, false);
  const unavailable = await control('/status', 'GET', undefined, 'local-project', 'outsider');
  assert.equal(unavailable.status, 200);
  assert.equal((await unavailable.json()).availability.state, 'pilot_only');
  assert.equal((await control('/jobs', 'POST', {}, 'local-project', 'outsider')).status, 503);
  assert.equal((await control('/provisioning-check', 'GET', undefined, 'local-project', 'outsider')).status, 403);
  const preflight = await control('/provisioning-check');
  assert.equal(preflight.status, 200);
  assert.equal((await preflight.json()).credential, 'missing');
  assert.equal((await control('/jobs', 'POST', {})).status, 503, 'Incomplete infrastructure must reject paid jobs before admission');
  assert.equal((await control('/integrations/resend', 'PUT', { apiKey: 're_local_test', from: 'from@example.test', contactTo: 'to@example.test' })).status, 200);
  const publicStatus = await (await control('/status')).text();
  assert.ok(publicStatus.includes('from@example.test')); assert.ok(!publicStatus.includes('re_local_test'));
  const { url } = await (await control('/preview-ticket', 'POST')).json();
  const alias = createHash('sha256').update('local-project').digest('hex').slice(0, 32);
  const origin = `https://dev-${alias}.apps.example.test`;
  assert.equal(new URL(url).origin, origin);
  assert.equal((await runtime.dispatchFetch(`${origin}/api/auth/session`)).status, 401);
  const opened = await runtime.dispatchFetch(url, { redirect: 'manual' });
  assert.equal(opened.status, 303);
  assert.equal((await runtime.dispatchFetch(url, { redirect: 'manual' })).status, 401);
  const cookie = opened.headers.get('Set-Cookie').split(';')[0];
  const contact = await runtime.dispatchFetch(`${origin}/api/contact`, { method: 'POST', headers: { Cookie: cookie, Origin: origin }, body: JSON.stringify({ name: 'Local test', email: 'test@example.test', message: 'Captured in real Durable Object SQLite.' }) });
  assert.equal(contact.status, 201, await contact.clone().text());
  assert.equal((await contact.json()).status, 'captured');
  const inbox = await (await control('/inbox')).json();
  assert.equal(inbox.messages[0].email, 'test@example.test');
  assert.deepEqual((await (await control('/inbox?environment=production')).json()).messages, []);
  const app = (path, method = 'GET', body, session = '') => runtime.dispatchFetch(origin + path, { method, headers: { Cookie: cookie + '; ' + session, Origin: origin }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: 'manual' });
  assert.equal((await app('/__brainhalf/auth')).status, 200);
  assert.equal((await app('/api/auth/signup', 'POST', { name: 'Test person', email: 'person@example.test', password: 'smoke-password' })).status, 202);
  const messages = await (await control('/services/messages')).json();
  const verification = messages.messages.find(message => message.kind === 'verify_email');
  assert.equal(verification.status, 'captured');
  const link = await (await control('/services/messages/' + verification.id + '/open', 'POST')).json();
  const navigation = await runtime.dispatchFetch(link.url, { redirect: 'manual' });
  assert.equal(navigation.status, 303);
  const token = new URL(navigation.headers.get('location'), origin).hash.slice('#token='.length);
  assert.equal(token.length, 43);
  assert.equal((await app('/api/auth/verify-email', 'POST', { token })).status, 200);
  assert.equal((await app('/api/auth/verify-email', 'POST', { token })).status, 400);
  const signedIn = await app('/api/auth/login', 'POST', { email: 'person@example.test', password: 'smoke-password' });
  assert.equal(signedIn.status, 200, await signedIn.clone().text());
  const session = signedIn.headers.get('set-cookie').split(';')[0];
  const { user } = await signedIn.json();
  const payload = Buffer.from(JSON.stringify({ projectId: 'local-project', ownerId: 'local-owner', environment: 'development' })).toString('base64url');
  const signature = createHmac('sha256', Buffer.alloc(32, 7).toString('base64')).update('app-services:v1:' + payload).digest('base64url');
  const email = await runtime.dispatchFetch('https://services.test/email', { method: 'POST', headers: { Authorization: 'Bearer bhsvc_' + payload + '.' + signature }, body: JSON.stringify({ userId: user.id, template: 'order_receipt', variables: { orderId: 'smoke-order', amount: '$5' }, idempotencyKey: 'smoke-order' }) });
  assert.equal(email.status, 202, await email.clone().text()); assert.equal((await email.json()).status, 'captured');
  assert.equal((await app('/api/auth/forgot-password', 'POST', { email: 'person@example.test' })).status, 202);
  const reset = (await (await control('/services/messages')).json()).messages.find(message => message.kind === 'reset_password');
  const resetText = (await (await control('/services/messages/' + reset.id)).json()).text;
  const resetToken = resetText.match(/#token=([A-Za-z0-9_-]{43})/)[1];
  assert.equal((await app('/api/auth/reset-password', 'POST', { token: resetToken, password: 'replacement-password' })).status, 200);
  assert.equal((await (await app('/api/auth/session', 'GET', undefined, session)).json()).user, null);
  const stopped = await control('/stop', 'POST');
  assert.equal(stopped.status, 200, `Bodyless runtime shutdown failed: ${await stopped.clone().text()}`);
  assert.deepEqual(await stopped.json(), { ok: true });
  const deleted = await control('/delete', 'POST');
  assert.equal(deleted.status, 200, `Runtime deletion failed: ${await deleted.clone().text()}`);
  assert.equal((await runtime.dispatchFetch(`${origin}/api/auth/session`, { headers: { Cookie: cookie } })).status, 404);
  assert.equal((await control('/status')).status, 410);
  // The hosted app limit is 10 (MAX_HOSTED_APP_SPACES): fill every slot.
  for (const project of Array.from({ length: 10 }, (_, index) => `replacement-${index + 1}`)) {
    const response = await control('/status', 'GET', undefined, project);
    assert.equal(response.status, 200, `Deleted project must not consume pilot quota: ${await response.text()}`);
    assert.equal((await control('/preview-ticket', 'POST', {}, project)).status, 200);
  }
  assert.equal((await control('/status', 'GET', undefined, 'over-quota')).status, 200, 'Read-only status never reserves a hosted slot');
  assert.equal((await control('/preview-ticket', 'POST', {}, 'over-quota')).status, 429, 'Explicit preview admission still enforces the hosted limit');
  console.log('Local workerd checks passed: service entrypoint, pilot gate, encrypted settings, private preview, single-use tickets, SQLite contact inbox, signup/verification, password reset and session revocation, scoped backend email capture, environment isolation, stop and deletion. No cloud providers were called.');
} finally {
  await runtime.dispose();
}
