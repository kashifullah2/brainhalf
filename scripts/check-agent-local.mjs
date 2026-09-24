import assert from 'node:assert/strict';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

// Build first: wrangler deploy --dry-run --outdir /tmp/brainhalf-main-build.
// No real account, provider, email or cloud resource is involved.
const secret = randomBytes(32).toString('hex');
const main = new Miniflare(convertV4MiniflareOptions({
  modules: true, script: readFileSync('/tmp/brainhalf-main-build/worker.js', 'utf8'),
  compatibilityDate: '2024-09-23', compatibilityFlags: ['nodejs_compat'],
  bindings: { SESSION_SECRET: secret, REQUIRED_MODEL_PROVIDERS: 'cloudflare' },
  durableObjects: { ChatAgent: { className: 'ChatAgent', useSQLite: true }, REGISTRY: { className: 'AuthRegistry', useSQLite: true } },
  r2Buckets: ['PROJECT_BACKUPS'], outboundService: () => new Response('External requests disabled', { status: 503 }),
}));
const sockets = [];
try {
  const registryNamespace = await main.getDurableObjectNamespace('REGISTRY');
  const registry = registryNamespace.get(registryNamespace.idFromName('auth'));
  const register = (path, body) => registry.fetch('https://registry' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const now = Math.floor(Date.now() / 1000); const payload = Buffer.from(JSON.stringify({ uid: 'local-owner', iat: now, exp: now + 600 })).toString('base64url');
  const token = `bh_${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`;
  assert.equal((await register('/sessions', { userId: 'local-owner', tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: now + 600 })).status, 201);
  const request = (path, method = 'GET', body) => main.dispatchFetch('https://brainhalf.com' + path, { method, headers: { Origin: 'https://brainhalf.com', Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const ticketResponse = await request('/api/auth/ws-ticket', 'POST'); assert.equal(ticketResponse.status, 200); const { ticket } = await ticketResponse.json();
  const upgrade = await main.dispatchFetch(`https://brainhalf.com/agents/chat-agent/local-project?ticket=${ticket}&_sid=forged&_uid=outsider`, { headers: { Upgrade: 'websocket', Origin: 'https://brainhalf.com' } });
  assert.equal(upgrade.status, 101);
  const socket = upgrade.webSocket; assert.ok(socket); sockets.push(socket); socket.accept();
  const inbox = []; socket.addEventListener('message', event => inbox.push(JSON.parse(event.data)));
  async function waitFor(predicate, label) { const deadline = Date.now() + 10000; while (Date.now() < deadline) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 25)); } throw new Error('Timed out: ' + label); }
  socket.send(JSON.stringify({ type: 'ping' })); await waitFor(() => inbox.some(item => item.type === 'pong'), 'authenticated ping');
  // Browser uploads can be larger than a Durable Object SQLite row. Exercise
  // the real endpoint and storage engine, not just desktop SQLite fixtures.
  const image = Buffer.alloc(5 * 1024 * 1024);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(image);
  const uploaded = await request('/agents/chat-agent/local-project/builder/attachments', 'POST', {
    name: 'large-image.png', mime: 'image/png', size: image.length, text: '', dataUrl: `data:image/png;base64,${image.toString('base64')}`,
  });
  const uploadedBody = await uploaded.json();
  assert.equal(uploaded.status, 201, `5 MB image upload: ${JSON.stringify(uploadedBody)}`);
  const listed = await (await request('/agents/chat-agent/local-project/builder/attachments')).json();
  assert.equal(listed.attachments.find(file => file.id === uploadedBody.attachment.id)?.size, image.length);
  assert.equal((await request(`/agents/chat-agent/local-project/builder/attachments/${uploadedBody.attachment.id}`, 'DELETE')).status, 200);
  const initial = await (await request('/agents/chat-agent/local-project/checkpoints')).json(); assert.ok(Array.isArray(initial.checkpoints));
  const save = await request('/agents/chat-agent/local-project/checkpoints', 'POST', { revision: initial.revision, label: 'Local recovery' }); assert.equal(save.status, 201); const { checkpoint } = await save.json();
  socket.send(JSON.stringify({ type: 'sync_files', files: { '/src/example.ts': 'export const value = 42;' } }));
  await waitFor(() => inbox.some(item => item.type === 'files_synced'), 'source synchronization');
  const review = await (await request('/agents/chat-agent/local-project/checkpoints?id=' + checkpoint.id)).json(); assert.ok(review.changes.some(item => item.path === '/src/example.ts'));
  assert.equal((await request('/agents/chat-agent/local-project/checkpoints/restore', 'POST', { id: checkpoint.id, revision: initial.revision })).status, 409);
  assert.equal((await request('/agents/chat-agent/local-project/checkpoints/restore', 'POST', { id: checkpoint.id, revision: review.revision })).status, 200);
  let closed = false; socket.addEventListener('close', () => { closed = true; });
  assert.equal((await request('/api/auth/logout', 'POST')).status, 200);
  inbox.length = 0; socket.send(JSON.stringify({ type: 'ping' }));
  await waitFor(() => closed, 'logout revokes open socket'); assert.equal(inbox.some(item => item.type === 'pong'), false);
  assert.equal((await request('/agents/chat-agent/local-project/checkpoints')).status, 401);
  console.log('Local agent checks passed: real ticket redemption, forged identity replacement, authenticated socket, 5 MB image upload/list/delete, checkpoint save/review, stale restore rejection, restore, logout revocation on the open socket, and HTTP revocation. No providers were called.');
} finally { for (const socket of sockets) try { socket.close(); } catch {} await main.dispose(); }
