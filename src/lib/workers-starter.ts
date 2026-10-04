import STARTER_VERIFICATION from './starter-verification.json';

/** Managed Workers/D1 backend. No user credentials are written into project files. */
export function addWorkersBackend(files: Record<string, string>): Record<string, string> {
  if (Object.keys(files).some(path => /^\/?(?:server|backend)\//.test(path))) throw new Error('This project already has a backend. Ask the agent to adapt it to Workers before enabling managed connections.');
  const packagePath = files['package.json'] ? 'package.json' : '/package.json';
  const pkg = JSON.parse(files[packagePath] || '{}');
  if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)) throw new Error('Fix package.json before adding a backend.');
  for (const field of ['scripts', 'devDependencies', 'brainhalf']) {
    if (pkg[field] !== undefined && (!pkg[field] || typeof pkg[field] !== 'object' || Array.isArray(pkg[field]))) throw new Error(`Fix package.json ${field} before adding a backend.`);
  }
  if (pkg.type !== undefined && pkg.type !== 'module') throw new Error('This backend uses ES modules. Ask the agent to adapt your existing module system.');
  const build = pkg.scripts?.build || 'vite build';
  const backendTest = 'node --test worker/backend.test.mjs';
  const existingTest = pkg.scripts?.test;
  const test = !existingTest ? backendTest : existingTest.includes(backendTest) ? existingTest : `${existingTest} && ${backendTest}`;
  const next = { ...files };
  const additions: Record<string, string> = {
    '/brainhalf.verify.json': JSON.stringify(STARTER_VERIFICATION, null, 2) + '\n',
    '/worker/index.ts': `import type { BrainHalfServices } from './brainhalf';
interface Env extends BrainHalfServices { DB: D1Database; BRAINHALF_MANAGED?: string }
const json = (body: unknown, status = 200) => Response.json(body, { status });
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/api/health') return json({ ok: true, runtime: 'workers', database: !!env.DB });
    // The BrainHalf dispatcher removes client identity headers and injects a verified app session.
    // Standalone exports must supply their own authentication before enabling private routes.
    const userId = env.BRAINHALF_MANAGED === 'true' ? request.headers.get('x-bh-user-id') : null;
    if (!userId) return json({ error: 'Sign in to use this feature.' }, 401);
    if (request.method !== 'GET' && request.headers.get('Origin') !== url.origin) return json({ error: 'Untrusted origin' }, 403);
    if (url.pathname === '/api/items' && request.method === 'GET') {
      const result = await env.DB.prepare('SELECT id,title,created_at AS createdAt FROM items WHERE user_id=? ORDER BY created_at DESC LIMIT 100').bind(userId).all();
      return json({ items: result.results });
    }
    if (url.pathname === '/api/items' && request.method === 'POST') {
      const reader = request.body?.getReader(); let text = ''; const decoder = new TextDecoder();
      if (!reader) return json({ error: 'Body required' }, 400);
      let size = 0;
      while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > 4096) { await reader.cancel(); return json({ error: 'Request too large' }, 413); } text += decoder.decode(part.value, { stream: true }); }
      let body: { title?: unknown }; try { body = JSON.parse(text + decoder.decode()); } catch { return json({ error: 'Invalid JSON' }, 400); }
      if (!body || typeof body.title !== 'string' || !body.title.trim() || body.title.length > 200) return json({ error: 'Title must have 1 to 200 characters.' }, 400);
      const item = { id: crypto.randomUUID(), title: body.title.trim(), createdAt: Date.now() };
      await env.DB.prepare('INSERT INTO items(id,user_id,title,created_at) VALUES (?,?,?,?)').bind(item.id, userId, item.title, item.createdAt).run();
      return json({ item }, 201);
    }
    const match = url.pathname.match(/^\\/api\\/items\\/([a-zA-Z0-9-]+)$/);
    if (match && request.method === 'DELETE') {
      const result = await env.DB.prepare('DELETE FROM items WHERE id=? AND user_id=?').bind(match[1], userId).run();
      return result.meta.changes ? json({ ok: true }) : json({ error: 'Item not found' }, 404);
    }
    return json({ error: 'Route not found' }, 404);
  }
};
`,
    '/worker/brainhalf.ts': `/** Server-only managed email. Never expose these bindings through an API response. */
export interface BrainHalfServices { BRAINHALF_SERVICES?: Fetcher; BRAINHALF_SERVICE_TOKEN?: string }
export async function sendAppEmail(env: BrainHalfServices, event: { userId: string; template: 'welcome' | 'order_receipt'; idempotencyKey: string; variables?: { orderId?: string; amount?: string; details?: string } }): Promise<{ id: string; status: string }> {
  if (!env.BRAINHALF_SERVICES || !env.BRAINHALF_SERVICE_TOKEN) throw new Error('Managed email is unavailable. Create a new managed release or configure email for your standalone deployment.');
  const response = await env.BRAINHALF_SERVICES.fetch(new Request('https://services/email', { method: 'POST', headers: { Authorization: 'Bearer ' + env.BRAINHALF_SERVICE_TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify(event) }));
  const data = await response.json() as { id: string; status: string; error?: string };
  if (!response.ok) throw new Error(data.error || 'Email could not be queued.');
  return { id: data.id, status: data.status };
}
`,
    '/migrations/0001_items.sql': 'CREATE TABLE IF NOT EXISTS items (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 200), created_at INTEGER NOT NULL);\nCREATE INDEX IF NOT EXISTS items_owner ON items(user_id,created_at);\n',
    '/worker/tsconfig.json': JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', strict: true, noEmit: true, skipLibCheck: true, types: ['@cloudflare/workers-types'] }, include: ['*.ts'] }, null, 2),
    '/worker/backend.test.mjs': `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { buildSync } from 'esbuild';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// Bundle the worker from source on-the-fly. Do NOT import from dist-worker:
// that build artifact may not exist if the build script was overwritten
// during generation (QA B1). esbuild is a devDependency of every backend.
const cacheDir = join(root, 'node_modules', '.cache');
mkdirSync(cacheDir, { recursive: true });
const outFile = join(cacheDir, 'test-worker-bundle.mjs');
buildSync({
  entryPoints: [join(root, 'worker', 'index.ts')],
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  outfile: outFile,
  logLevel: 'silent',
});
const worker = (await import(pathToFileURL(outFile).href)).default;

test('private CRUD validates input, persists data, and isolates users', async () => {
  const db = new DatabaseSync(':memory:');
  // Apply all migrations in order — never hardcode a filename (QA B2/B9:
  // the builder renames tables per domain; the test must follow).
  const migDir = join(root, 'migrations');
  const migrations = existsSync(migDir) ? readdirSync(migDir).filter(f => f.endsWith('.sql')).sort() : [];
  for (const m of migrations) db.exec(readFileSync(join(migDir, m), 'utf8'));
  const env = { BRAINHALF_MANAGED: 'true', DB: { prepare(sql) { return { bind(...params) { return { async all() { return {results:db.prepare(sql).all(...params)}; }, async run() { return {meta:db.prepare(sql).run(...params)}; }, async first() { return db.prepare(sql).get(...params); } }; } }; } } };
  const call = (path, method='GET', body, user='alice') => worker.fetch(new Request('https://app.example'+path, {method,headers:{Origin:'https://app.example',...(user ? {'x-bh-user-id':user}:{}),'Content-Type':'application/json'},body:body === undefined ? undefined : JSON.stringify(body)}),env);
  try {
    assert.equal((await call('/api/items','GET',undefined,'')).status,401);
    assert.equal((await call('/api/items','POST',{title:''})).status,400);
    const response = await call('/api/items','POST',{title:'Saved destination'}); assert.equal(response.status,201); const {item}=await response.json();
    assert.equal((await (await call('/api/items')).json()).items[0].title,'Saved destination');
    assert.equal((await (await call('/api/items','GET',undefined,'bob')).json()).items.length,0);
    assert.equal((await call('/api/items/'+item.id,'DELETE',undefined,'bob')).status,404);
    assert.equal((await call('/api/items/'+item.id,'DELETE')).status,200);
    assert.equal((await (await call('/api/items')).json()).items.length,0);
  } finally { db.close(); }
});
`,
    '/FULLSTACK.md': `# Running this application\n\nThe agent creates and connects backend code as your app needs it. After generation, signed-in accounts with available usage automatically start a development build. A development release creates an isolated D1 database and applies migrations. Use Open running app in the workspace preview to exercise real APIs. Managed hosting is available to every signed-in user within the existing project and usage limits. Click Publish to build this saved revision, run its tests and brainhalf.verify.json checks against a disposable database, prepare the production database and integrations, and activate the same artifact only after production health checks pass. The frontend, backend and database are published together. You can close the workspace while publishing continues. Later edits require publishing again.\n\nContact forms POST JSON {name,email,message} to /api/contact. Development captures messages in the private runtime inbox. Production uses BrainHalf managed email by default after the project owner verifies their BrainHalf account email; contact messages go to that owner. Custom Resend credentials are optional. Use the managed runtime APIs for configuration, templates, user administration, quotas and delivery records. Provider acceptance is not a delivery receipt.\n\nGoogle sign-in links to /api/auth/google/start; GET /api/auth/session returns {user}; POST /api/auth/logout clears the session. BrainHalf shared Google credentials work without per-project keys. Custom Google credentials are optional; register the callback shown for the selected environment. Open /__brainhalf/auth for the hosted login/signup/forgot-password page. POST /api/auth/signup {email,password,name}, /api/auth/login {email,password}, /api/auth/resend-verification {email}, /api/auth/forgot-password {email}, or /api/auth/magic-link {email}. Verification and reset links are single-use POST actions through the hosted page. Development email links are available in the private project inbox; open the private sign-in page first to authorize preview access. Users and sessions are isolated between projects and environments. Never put credentials in source or chat.\n\nUse sendAppEmail from worker/brainhalf.ts in your backend after saving a confirmed business event. Pass the verified x-bh-user-id, template welcome or order_receipt, variables {orderId,amount,details}, and a stable idempotencyKey derived from the saved event. The recipient must be a verified app user. Never accept a free-form recipient or event key from an unauthenticated browser. The runtime injects BRAINHALF_SERVICES and BRAINHALF_SERVICE_TOKEN at deployment; keep them server-side. Receipt emails do not integrate a payment provider. The managed runtime supplies these integration routes and verified identity. A standalone export must implement its own authentication and integration routes before deployment; the backend fails closed without BRAINHALF_MANAGED.\n\nProduction creates a separate database. Migrations are additive. Rollback switches code only when schema receipts match.\n`,
  };
  for (const [path, content] of Object.entries(additions)) if (!(path in next) && !(path.slice(1) in next)) next[path] = content;
  next[packagePath] = JSON.stringify({ ...pkg, type: 'module', brainhalf: { ...pkg.brainhalf, runtime: 'workers' }, scripts: { ...pkg.scripts, build: build.includes('dist-worker/index.js') ? build : `${build} && tsc -p worker/tsconfig.json && esbuild worker/index.ts --bundle --format=esm --platform=neutral --outfile=dist-worker/index.js`, test }, devDependencies: { typescript: '^7.0.2', ...pkg.devDependencies, esbuild: '^0.28.0', '@cloudflare/workers-types': '^5.20260908.1' } }, null, 2) + '\n';
  // Dependencies changed; npm ci rejects the old lock instead of refreshing it.
  if (next[packagePath] !== files[packagePath]) {
    for (const path of ['package-lock.json', '/package-lock.json', 'npm-shrinkwrap.json', '/npm-shrinkwrap.json']) delete next[path];
  }
  return next;
}
