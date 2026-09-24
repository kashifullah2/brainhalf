import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

// Loopback-only integration harness. Identities are controlled test fixtures;
// this does not emulate or claim a successful Google consent flow.
export async function startTripPlanner({ appDirectory, stateDirectory, port = 0 }) {
  const runtimeBundle = await readFile('/tmp/brainhalf-runtime-build/worker.js', 'utf8');
  const runtime = new Miniflare(convertV4MiniflareOptions({
    resourcePersistencePath: resolve(stateDirectory),
    cf: false,
    workers: [
      { name: 'gateway', modules: true, compatibilityDate: '2026-09-22',
        script: `export default { fetch(request, env) { const host = new URL(request.url).hostname; return (host === 'control.test' ? env.CONTROL : host === 'unmanaged.test' ? env.UNMANAGED : host.endsWith('.apps.example.test') ? env.RUNTIME : env.APP).fetch(request); } };`,
        serviceBindings: { APP: 'trip-app', UNMANAGED: 'unmanaged-app', RUNTIME: 'runtime', CONTROL: { name: 'runtime', entrypoint: 'RuntimeControl' } } },
      { name: 'trip-app', modules: true, compatibilityDate: '2026-09-22', compatibilityFlags: ['nodejs_compat'],
        script: await readFile(resolve(appDirectory, 'dist-worker/index.js'), 'utf8'),
        bindings: { BRAINHALF_MANAGED: 'true' }, d1Databases: { DB: 'trip-planner-test' },
        outboundService: () => new Response('External calls disabled', { status: 503 }) },
      { name: 'unmanaged-app', modules: true, compatibilityDate: '2026-09-22', compatibilityFlags: ['nodejs_compat'],
        script: await readFile(resolve(appDirectory, 'dist-worker/index.js'), 'utf8'), d1Databases: { DB: 'trip-planner-test' },
        outboundService: () => new Response('External calls disabled', { status: 503 }) },
      { name: 'runtime', modules: true, compatibilityDate: '2026-09-22', compatibilityFlags: ['nodejs_compat'],
        script: runtimeBundle,
        bindings: { RUNTIME_ENABLED: 'true', RUNTIME_DOMAIN: 'apps.example.test', PILOT_OWNER_IDS: 'local-owner', CF_ACCOUNT_ID: '', DISPATCH_NAMESPACE: 'local', PROJECT_SECRETS_KEY: Buffer.alloc(32, 7).toString('base64') },
        durableObjects: { PROJECTS: { className: 'ProjectRuntime', useSQLite: true }, PILOT: { className: 'PilotCoordinator', useSQLite: true } },
        r2Buckets: ['ARTIFACTS'], outboundService: () => new Response('External calls disabled', { status: 503 }) },
    ],
  }));
  let server;
  try {
    const db = await runtime.getD1Database('DB', 'trip-app');
    await db.prepare('CREATE TABLE IF NOT EXISTS harness_migrations (name TEXT PRIMARY KEY)').run();
    if (!await db.prepare('SELECT name FROM harness_migrations WHERE name=?').bind('0001').first()) {
      const sql = await readFile(resolve(appDirectory, 'migrations/0001.sql'), 'utf8');
      // Python's SQLite parser recognizes complete trigger bodies and quoted
      // semicolons; splitting SQL on semicolons would corrupt valid migrations.
      const parsed = spawnSync('python3', ['-c', `import sqlite3,sys,json,re
sql=sys.stdin.read(); statements=[]; part=''
for char in sql:
 part+=char
 if char==';' and sqlite3.complete_statement(part):
  statements.append(part); part=''
if re.sub(r'--[^\\n]*|/\\*[\\s\\S]*?\\*/','',part).strip(): statements.append(part)
print(json.dumps(statements))`], { input: sql, encoding: 'utf8' });
      if (parsed.status !== 0) throw new Error(parsed.stderr);
      const statements = JSON.parse(parsed.stdout);
      await db.batch([...statements.map(statement => db.prepare(statement)), db.prepare('INSERT INTO harness_migrations VALUES (?)').bind('0001')]);
    }
    const control = (path, method = 'GET', body) => runtime.dispatchFetch(`https://control.test${path}`, {
      method, headers: { 'x-bh-owner': 'local-owner', 'x-bh-project': 'trip-planner-audit', 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const registered = await control('/status');
    if (!registered.ok) throw new Error(await registered.text());
    const ticket = await (await control('/preview-ticket', 'POST')).json();
    const opened = await runtime.dispatchFetch(ticket.url, { redirect: 'manual' });
    if (opened.status !== 303) throw new Error('Runtime preview ticket failed');
    const previewCookie = opened.headers.get('set-cookie').split(';')[0];
    const runtimeOrigin = new URL(ticket.url).origin;
    const sessions = new Map();
    let origin;
    const users = { alice: { id: 'alice', name: 'Alice', email: 'alice@example.test' }, bob: { id: 'bob', name: 'Bob', email: 'bob@example.test' }, eve: { id: 'eve', name: 'Eve', email: 'eve@example.test' } };
    server = createServer(async (req, res) => {
      try {
        const url = new URL(req.url, origin);
        if (req.headers.host !== new URL(origin).host) { res.writeHead(403); res.end(); return; }
        const chunks = []; let size = 0;
        for await (const chunk of req) { size += chunk.length; if (size > 65536) { res.writeHead(413); res.end(); return; } chunks.push(chunk); }
        const body = Buffer.concat(chunks);
        const json = (value, status = 200, headers = {}) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers }); res.end(JSON.stringify(value)); };
        const cookie = (req.headers.cookie || '').match(/(?:^|;\s*)waypoint_test_session=([^;]+)/)?.[1];
        const user = sessions.get(cookie);
        if (url.pathname === '/__test/' && req.method === 'GET') {
          res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
          res.end(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Waypoint local test identities</title><style>body{font:18px system-ui;background:#e5f0f4;color:#18354a;max-width:650px;margin:10vh auto;padding:24px}button{padding:14px 22px;margin:8px;border-radius:8px;border:1px solid #18354a;background:white;font:inherit;cursor:pointer}a{color:#18354a}</style><h1>Waypoint test app</h1><p>This local test uses a real Worker and SQLite. Select a controlled identity to explore user permissions. Google consent and outgoing email are not connected.</p><button data-user="alice">Continue as Alice</button><button data-user="bob">Continue as Bob</button><button data-user="eve">Continue as Eve</button><p id="error" role="alert"></p><script>document.querySelectorAll('button').forEach(b=>b.onclick=async()=>{b.disabled=true;try{const r=await fetch('/__test/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({user:b.dataset.user})});if(!r.ok)throw Error('Could not start test session');location.href='/'}catch(e){document.querySelector('#error').textContent=e.message;b.disabled=false}})</script></html>`); return;
        }
        if (url.pathname === '/__test/login' && req.method === 'POST') {
          if (req.headers.origin !== origin) return json({ error: 'Untrusted origin' }, 403);
          const selected = users[JSON.parse(body).user];
          if (!selected) return json({ error: 'Unknown test identity' }, 400);
          const token = randomUUID(); sessions.set(token, selected);
          return json({ user: selected }, 200, { 'Set-Cookie': `waypoint_test_session=${token}; Path=/; HttpOnly; SameSite=Strict` });
        }
        if (url.pathname === '/api/auth/session') return json({ user: user || null });
        if (url.pathname === '/api/auth/logout' && req.method === 'POST') {
          if (req.headers.origin !== origin) return json({ error: 'Untrusted origin' }, 403);
          sessions.delete(cookie); return json({ ok: true }, 200, { 'Set-Cookie': 'waypoint_test_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict' });
        }
        if (url.pathname === '/api/auth/google/start') return json({ error: 'Google consent is not configured in this local test. Use the test runner to select a fixture identity.' }, 503);
        if (url.pathname === '/api/contact') {
          if (!user) return json({ error: 'Sign in' }, 401);
          if (req.headers.origin !== origin) return json({ error: 'Untrusted origin' }, 403);
          const response = await runtime.dispatchFetch(`${runtimeOrigin}/api/contact`, { method: req.method, headers: { Origin: runtimeOrigin, Cookie: previewCookie, 'Content-Type': req.headers['content-type'] || '' }, body });
          res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer())); return;
        }
        if (url.pathname.startsWith('/api/')) {
          const headers = new Headers(req.headers);
          for (const key of [...headers.keys()]) if (key.startsWith('x-bh-') || ['cookie', 'authorization'].includes(key)) headers.delete(key);
          if (user) headers.set('x-bh-user-id', user.id);
          const response = await runtime.dispatchFetch(url, { method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body });
          res.writeHead(response.status, { ...Object.fromEntries(response.headers), 'Cache-Control': 'no-store' });
          res.end(Buffer.from(await response.arrayBuffer())); return;
        }
        const assets = { '/': ['index.html', 'text/html'], '/index.html': ['index.html', 'text/html'], '/app.js': ['app.js', 'application/javascript'], '/styles.css': ['styles.css', 'text/css'] };
        const asset = assets[url.pathname];
        if (!asset || req.method !== 'GET') return json({ error: 'Not found' }, 404);
        res.writeHead(200, { 'Content-Type': asset[1], 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
        res.end(await readFile(resolve(appDirectory, asset[0])));
      } catch (error) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Test harness failure' })); console.error(error.message); }
    });
    await new Promise((ready, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', ready); });
    origin = `http://127.0.0.1:${server.address().port}`;
    return { origin, db, control,
      unmanagedRequest: (path, options) => runtime.dispatchFetch(`https://unmanaged.test${path}`, options),
      async close() { await new Promise(done => server.close(done)); await runtime.dispose(); } };
  } catch (error) { if (server?.listening) server.close(); await runtime.dispose(); throw error; }
}

if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  const appDirectory = resolve(process.argv[2] || 'audit-artifacts/2026-09-23/trip-planner/app');
  const stateDirectory = resolve(process.argv[3] || '/tmp/brainhalf-trip-demo-state');
  await mkdir(stateDirectory, { recursive: true });
  const app = await startTripPlanner({ appDirectory, stateDirectory, port: 8791 });
  console.log(`Waypoint running at ${app.origin}/__test/ with controlled local identities.`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await app.close(); process.exit(0); });
}
