export type ProjectFiles = Record<string, string>;

export function createTypeScriptStarter(): ProjectFiles {
  return {
    '/package.json': JSON.stringify({ name: 'application', private: true, version: '0.1.0', type: 'module', engines: { node: '>=22.18.0' }, scripts: { dev: 'vite', build: 'tsc --noEmit && vite build', typecheck: 'tsc --noEmit', preview: 'vite preview' }, dependencies: { react: '^19.2.8', 'react-dom': '^19.2.8', 'lucide-react': '^1.43.0', 'react-router-dom': '^7.18.4' }, devDependencies: { vite: '^8.2.2', typescript: '^7.0.2', '@types/react': '^19.2.18', '@types/react-dom': '^19.2.3', '@types/node': '^22.18.0' } }, null, 2) + '\n',
    '/index.html': '<!doctype html>\n<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Application</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>\n',
    '/src/main.tsx': 'import { StrictMode } from "react";\nimport { createRoot } from "react-dom/client";\nimport App from "./App";\nimport AppBoundary from "./components/AppBoundary";\nimport "./styles.css";\n\nconst root = document.getElementById("root");\nif (!root) throw new Error("Application root is missing");\ncreateRoot(root).render(<StrictMode><AppBoundary><App /></AppBoundary></StrictMode>);\n',
    '/src/components/AppBoundary.tsx': 'import { Component, type ReactNode } from "react";\n\nexport default class AppBoundary extends Component<{ children: ReactNode }, { error: string | null }> {\n  state: { error: string | null } = { error: null };\n  static getDerivedStateFromError(error: unknown) { return { error: error instanceof Error ? error.message : "The application could not render" }; }\n  render() { return this.state.error ? <main className="welcome" role="alert"><h1>Something went wrong</h1><p>{this.state.error}</p><button onClick={() => this.setState({ error: null })}>Try again</button></main> : this.props.children; }\n}\n',
    '/src/App.tsx': 'export default function App() {\n  return <main className="welcome"><p>YOUR WORKSPACE</p><h1>What do you want to build?</h1><p>Describe your application in chat. Your preview will appear here.</p></main>;\n}\n',
    '/src/styles.css': '* { box-sizing: border-box; }\nbody { margin: 0; background: #101218; color: #e8edf5; font: 16px/1.6 system-ui, sans-serif; }\nbutton, input { font: inherit; }\n.welcome { max-width: 680px; margin: 12vh auto; padding: 32px; }\n.welcome h1 { font-size: clamp(24px, 5vw, 36px); line-height: 1.2; letter-spacing: -0.03em; }\n.welcome p { color: #9eabbd; }\n',
    '/tsconfig.json': JSON.stringify({ compilerOptions: { target: 'ES2022', lib: ['ES2022', 'DOM', 'DOM.Iterable'], types: ['vite/client'], module: 'ESNext', moduleResolution: 'Bundler', jsx: 'react-jsx', strict: true, noEmit: true, skipLibCheck: true, allowImportingTsExtensions: true }, include: ['src', 'shared'] }, null, 2) + '\n',
    '/vite.config.ts': 'import { defineConfig } from "vite";\n\nexport default defineConfig({ server: { proxy: { "/api": "http://127.0.0.1:3001" } } });\n',
  };
}

const backendFiles: ProjectFiles = {
  '/shared/api.ts': `export interface User { id: string; email: string }
export interface Item { id: string; title: string; createdAt: number }
export interface ApiError { error: string }
`,
  '/server/config.ts': `import { resolve } from 'node:path';

const production = process.env.NODE_ENV === 'production';
if (production && !process.env.APP_ORIGIN) throw new Error('APP_ORIGIN is required in production');
const origin = new URL(process.env.APP_ORIGIN || 'http://localhost:5173');
if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('APP_ORIGIN must be an HTTP(S) origin');
if (production && origin.protocol !== 'https:') throw new Error('Production APP_ORIGIN must use HTTPS');
const port = Number(process.env.PORT || 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer from 1 to 65535');
export const config = { production, port, origin: origin.origin, databasePath: resolve(process.env.DATABASE_PATH || './data/app.sqlite') };
`,
  '/server/db/migrations/001_initial.sql': `CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, salt TEXT NOT NULL);
CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE TABLE items (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 200), created_at INTEGER NOT NULL);
CREATE INDEX items_owner ON items(user_id, created_at);
CREATE TABLE rate_limits (key TEXT PRIMARY KEY, attempts INTEGER NOT NULL, reset_at INTEGER NOT NULL);
`,
  '/server/db/index.ts': `import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from '../config.ts';

mkdirSync(dirname(config.databasePath), { recursive: true });
export const database = new DatabaseSync(config.databasePath);
database.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
export function migrate() {
  database.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY)');
  const directory = new URL('./migrations/', import.meta.url);
  for (const name of readdirSync(directory).filter(name => /^\\d+_[\\w-]+\\.sql$/.test(name)).sort()) {
    database.exec('BEGIN IMMEDIATE');
    try {
      if (!database.prepare('SELECT name FROM schema_migrations WHERE name = ?').get(name)) {
        database.exec(readFileSync(new URL(name, directory), 'utf8'));
        database.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run(name);
      }
      database.exec('COMMIT');
    } catch (error) { database.exec('ROLLBACK'); throw error; }
  }
}
`,
  '/server/db/migrate.ts': `import { database, migrate } from './index.ts';
try { migrate(); console.log('Database migrations applied'); } finally { database.close(); }
`,
  '/server/auth.ts': `import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { IncomingMessage } from 'node:http';
import { database } from './db/index.ts';
import type { User } from '../shared/api.ts';

const deriveKey = promisify(scrypt);
export const sessionHash = (token: string) => createHash('sha256').update(token).digest('hex');
export const sessionToken = (request: IncomingMessage) => (request.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith('app_session='))?.slice('app_session='.length) || '';
export async function hashPassword(password: string, salt: string): Promise<string> {
  const derived = await deriveKey(password, salt, 64);
  if (!Buffer.isBuffer(derived)) throw new Error('Password derivation failed');
  return derived.toString('hex');
}
export async function verifyPassword(password: string, hash: string, salt: string): Promise<boolean> {
  const candidate = Buffer.from(await hashPassword(password, salt), 'hex');
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}
export function createUser(email: string, passwordHash: string, salt: string): User {
  const id = randomUUID();
  database.prepare('INSERT INTO users (id, email, password_hash, salt) VALUES (?, ?, ?, ?)').run(id, email, passwordHash, salt);
  return { id, email };
}
export function createSession(userId: string): string {
  const token = randomBytes(32).toString('base64url');
  database.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
  database.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(sessionHash(token), userId, Date.now() + 604800000);
  return token;
}
export function currentUser(request: IncomingMessage): User | null {
  const row = database.prepare('SELECT users.id, users.email FROM sessions JOIN users ON users.id = sessions.user_id WHERE token_hash = ? AND expires_at > ?').get(sessionHash(sessionToken(request)), Date.now());
  return row && typeof row.id === 'string' && typeof row.email === 'string' ? { id: row.id, email: row.email } : null;
}
export function allowAuthAttempt(key: string): boolean {
  const now = Date.now();
  database.prepare('DELETE FROM rate_limits WHERE reset_at <= ?').run(now);
  database.prepare('INSERT INTO rate_limits (key, attempts, reset_at) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET attempts = attempts + 1').run(key, now + 900000);
  const attempts = database.prepare('SELECT attempts FROM rate_limits WHERE key = ?').get(key)?.attempts;
  return typeof attempts === 'number' && attempts <= 20;
}
`,
  '/server/app.ts': `import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { config } from './config.ts';
import { database } from './db/index.ts';
import { allowAuthAttempt, createSession, createUser, currentUser, hashPassword, sessionHash, sessionToken, verifyPassword } from './auth.ts';

class HttpError extends Error { status: number; constructor(status: number, message: string) { super(message); this.status = status; } }
function json(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  response.end(JSON.stringify(body));
}
async function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  if (!request.headers['content-type']?.startsWith('application/json')) throw new HttpError(415, 'Use application/json');
  let length = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.length;
    if (length > 65536) { request.resume(); throw new HttpError(413, 'Request body is too large'); }
    chunks.push(buffer);
  }
  let body: unknown;
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new HttpError(400, 'Invalid JSON'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Expected a JSON object');
  return Object.fromEntries(Object.entries(body));
}
const cookie = (token: string, age: number) => 'app_session=' + token + '; HttpOnly; SameSite=Strict; Path=/; Max-Age=' + age + (config.production ? '; Secure' : '');
async function handle(request: IncomingMessage, response: ServerResponse) {
  const path = new URL(request.url || '/', 'http://localhost').pathname;
  const method = request.method || 'GET';
  if (request.headers.origin === config.origin) {
    response.setHeader('Access-Control-Allow-Origin', config.origin);
    response.setHeader('Access-Control-Allow-Credentials', 'true');
    response.setHeader('Vary', 'Origin');
  }
  if (!['GET', 'HEAD'].includes(method) && request.headers.origin !== config.origin) throw new HttpError(403, 'Request origin is not allowed');
  if (method === 'OPTIONS') {
    response.writeHead(204, { 'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
    response.end(); return;
  }
  if (path === '/api/health' && method === 'GET') { database.prepare('SELECT 1').get(); json(response, 200, { status: 'ok' }); return; }
  if (['/api/auth/register', '/api/auth/login'].includes(path) && method === 'POST') {
    if (!allowAuthAttempt(request.socket.remoteAddress || 'unknown')) throw new HttpError(429, 'Too many attempts. Try again in 15 minutes.');
    const body = await readBody(request);
    if (typeof body.email !== 'string' || typeof body.password !== 'string') throw new HttpError(400, 'Email and password are required');
    const email = body.email.trim().toLowerCase();
    if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email) || email.length > 254 || body.password.length < 12 || body.password.length > 128) throw new HttpError(400, 'Use a valid email and a password with 12–128 characters');
    let user: { id: string; email: string };
    if (path.endsWith('/register')) {
      const salt = randomBytes(16).toString('hex');
      const hash = await hashPassword(body.password, salt);
      try { user = createUser(email, hash, salt); }
      catch (error) {
        if (database.prepare('SELECT id FROM users WHERE email = ?').get(email)) throw new HttpError(409, 'An account already exists for this email');
        throw error;
      }
    } else {
      const row = database.prepare('SELECT id, email, password_hash, salt FROM users WHERE email = ?').get(email);
      const valid = await verifyPassword(body.password, typeof row?.password_hash === 'string' ? row.password_hash : '00'.repeat(64), typeof row?.salt === 'string' ? row.salt : '00'.repeat(16));
      if (!valid || typeof row?.id !== 'string' || typeof row.email !== 'string') throw new HttpError(401, 'Invalid email or password');
      user = { id: row.id, email: row.email };
    }
    response.setHeader('Set-Cookie', cookie(createSession(user.id), 604800));
    json(response, path.endsWith('/register') ? 201 : 200, { user }); return;
  }
  const user = currentUser(request);
  if (!user) throw new HttpError(401, 'Sign in to continue');
  if (path === '/api/auth/me' && method === 'GET') { json(response, 200, { user }); return; }
  if (path === '/api/auth/logout' && method === 'POST') {
    database.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sessionHash(sessionToken(request)));
    response.setHeader('Set-Cookie', cookie('', 0)); json(response, 200, { success: true }); return;
  }
  if (path === '/api/items' && method === 'GET') {
    json(response, 200, { items: database.prepare('SELECT id, title, created_at AS createdAt FROM items WHERE user_id = ? ORDER BY created_at, id').all(user.id) }); return;
  }
  const id = path.match(/^\\/api\\/items\\/([a-zA-Z0-9-]+)$/)?.[1];
  if ((path === '/api/items' && method === 'POST') || (id && method === 'PATCH')) {
    const body = await readBody(request);
    if (typeof body.title !== 'string' || !body.title.trim() || body.title.trim().length > 200) throw new HttpError(400, 'Title must contain 1–200 characters');
    const title = body.title.trim();
    const itemId = id || randomUUID();
    if (id) {
      const result = database.prepare('UPDATE items SET title = ? WHERE id = ? AND user_id = ?').run(title, id, user.id);
      if (!result.changes) throw new HttpError(404, 'Item not found');
    } else database.prepare('INSERT INTO items (id, user_id, title, created_at) VALUES (?, ?, ?, ?)').run(itemId, user.id, title, Date.now());
    json(response, id ? 200 : 201, database.prepare('SELECT id, title, created_at AS createdAt FROM items WHERE id = ? AND user_id = ?').get(itemId, user.id)); return;
  }
  if (id && method === 'GET') {
    const item = database.prepare('SELECT id, title, created_at AS createdAt FROM items WHERE id = ? AND user_id = ?').get(id, user.id);
    if (!item) throw new HttpError(404, 'Item not found');
    json(response, 200, item); return;
  }
  if (id && method === 'DELETE') {
    const result = database.prepare('DELETE FROM items WHERE id = ? AND user_id = ?').run(id, user.id);
    if (!result.changes) throw new HttpError(404, 'Item not found');
    response.writeHead(204); response.end(); return;
  }
  throw new HttpError(404, 'API route not found');
}
export const createApp = () => createServer((request, response) => {
  void handle(request, response).catch(error => {
    if (response.headersSent || response.destroyed) { response.destroy(); return; }
    if (!(error instanceof HttpError)) console.error('API request failed');
    json(response, error instanceof HttpError ? error.status : 500, { error: error instanceof HttpError ? error.message : 'The request failed. Please retry.' });
  });
});
`,
  '/server/index.ts': `import { createApp } from './app.ts';
import { config } from './config.ts';
import { database } from './db/index.ts';

database.prepare('SELECT name FROM schema_migrations LIMIT 1').all();
const server = createApp();
server.requestTimeout = 30000;
server.headersTimeout = 15000;
server.listen(config.port, '127.0.0.1', () => console.log('API listening on http://127.0.0.1:' + config.port));
const close = () => server.close(() => { database.close(); process.exit(0); });
process.once('SIGTERM', close);
process.once('SIGINT', close);
`,
  '/server/tsconfig.json': JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, noEmit: true, allowImportingTsExtensions: true, skipLibCheck: true, types: ['node'] }, include: ['./**/*.ts', '../shared/**/*.ts'] }, null, 2) + '\n',
  '/server/.env.example': 'PORT=3001\nAPP_ORIGIN=http://localhost:5173\nDATABASE_PATH=./data/app.sqlite\nNODE_ENV=development\n',
  '/server/README.md': `# TypeScript API with SQLite

Requires Node.js 22.18+ (built-in SQLite is experimental on Node 22) and npm. No database credentials or authentication secrets are generated. Passwords use scrypt, sessions use random opaque HttpOnly cookies, and every item query is scoped to its owner.

## Local development

1. Run \`npm install\` at the project root.
2. Copy \`server/.env.example\` to \`server/.env\` and set APP_ORIGIN to your frontend origin.
3. Run \`npm run db:migrate\`, then \`npm run dev:api\`.
4. Run the existing frontend development command in another terminal.
5. Configure the frontend development proxy to forward /api to http://127.0.0.1:3001. The default BrainHalf TypeScript starter already includes this proxy. Existing framework configuration is never overwritten.
6. Use the typed \`src/lib/api.ts\` client from your components. Existing components are preserved; connect their forms and loading/error states to the matching methods.

## Validation

Run \`npm run typecheck:api\`, \`npm run test:api\`, and your frontend typecheck/build. These are real local checks, not claims made by the hosted browser preview. Migrations are transactional and idempotent. Empty databases remain empty; tests create their own temporary records.

## Routes

- POST /api/auth/register and /api/auth/login accept email and password (12–128 characters).
- GET /api/auth/me and POST /api/auth/logout manage the current session.
- GET/POST /api/items and GET/PATCH/DELETE /api/items/:id are owner-scoped CRUD.
- GET /api/health checks database connectivity.

## Deployment

Run migrations before \`npm run start:api\`. Host the frontend build and reverse-proxy /api to the API on loopback. Set NODE_ENV=production and an HTTPS APP_ORIGIN; terminate TLS at the trusted proxy. Keep the SQLite file on a persistent local disk and back it up. Do not share SQLite WAL files over a network filesystem. For multiple API hosts, migrate the data layer to a server database.

Requests that mutate data require the configured Origin header, including CLI requests. Rate limits use the direct peer address, not untrusted forwarded headers; configure trusted upstream rate limiting if requests share a reverse proxy. Email verification, password recovery, monitoring and deployment-specific security review are not included. Never deploy the browser demo API as production functionality.
`,
  '/src/lib/api.ts': `import type { Item, User } from '../../shared/api';

export class ApiRequestError extends Error { status: number; constructor(status: number, message: string) { super(message); this.status = status; } }

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('The API returned an invalid response');
  return Object.fromEntries(Object.entries(value));
}
function item(value: unknown): Item {
  const data = record(value);
  if (typeof data.id !== 'string' || typeof data.title !== 'string' || typeof data.createdAt !== 'number') throw new Error('The API returned an invalid item');
  return { id: data.id, title: data.title, createdAt: data.createdAt };
}
function user(value: unknown): User {
  const data = record(record(value).user);
  if (typeof data.id !== 'string' || typeof data.email !== 'string') throw new Error('The API returned an invalid account');
  return { id: data.id, email: data.email };
}
async function request(path: string, method = 'GET', body?: unknown): Promise<unknown> {
  const response = await fetch('/api' + path, { method, credentials: 'same-origin', headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (response.status === 204) return undefined;
  const data: unknown = await response.json();
  if (!response.ok) throw new ApiRequestError(response.status, typeof record(data).error === 'string' ? String(record(data).error) : 'Request failed. Please retry.');
  return data;
}
export const api = {
  register: async (email: string, password: string) => user(await request('/auth/register', 'POST', { email, password })),
  login: async (email: string, password: string) => user(await request('/auth/login', 'POST', { email, password })),
  me: async () => user(await request('/auth/me')),
  logout: async () => { await request('/auth/logout', 'POST'); },
  items: async (): Promise<Item[]> => { const data = record(await request('/items')); if (!Array.isArray(data.items)) throw new Error('The API returned an invalid list'); return data.items.map(item); },
  createItem: async (title: string) => item(await request('/items', 'POST', { title })),
  updateItem: async (id: string, title: string) => item(await request('/items/' + encodeURIComponent(id), 'PATCH', { title })),
  deleteItem: async (id: string) => { await request('/items/' + encodeURIComponent(id), 'DELETE'); },
};
`,
  '/server/app.test.ts': `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('real authentication, SQLite persistence, validation and ownership', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'application-api-'));
  process.env.DATABASE_PATH = join(directory, 'test.sqlite');
  process.env.APP_ORIGIN = 'http://localhost:5173';
  process.env.NODE_ENV = 'test';
  const { database, migrate } = await import('./db/index.ts');
  const { createApp } = await import('./app.ts');
  migrate(); migrate();
  const server = createApp();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = 'http://127.0.0.1:' + address.port;
  const request = (path: string, method = 'GET', body?: unknown, cookie = '') => fetch(base + path, { method, headers: { Origin: 'http://localhost:5173', 'Content-Type': 'application/json', Cookie: cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  try {
    assert.equal((await request('/api/items')).status, 401);
    assert.equal((await request('/api/auth/login', 'POST', { email: 'nobody@example.test', password: 'long-enough-password' })).status, 401);
    const signup = await request('/api/auth/register', 'POST', { email: 'owner@example.test', password: 'long-enough-password' });
    assert.equal(signup.status, 201);
    const cookie = signup.headers.get('set-cookie')?.split(';')[0];
    assert.ok(cookie);
    assert.match(signup.headers.get('set-cookie') || '', /HttpOnly; SameSite=Strict/);
    assert.equal((await request('/api/auth/register', 'POST', { email: 'owner@example.test', password: 'long-enough-password' })).status, 409);
    assert.deepEqual(await (await request('/api/items', 'GET', undefined, cookie)).json(), { items: [] });
    assert.equal((await request('/api/items', 'POST', { title: '' }, cookie)).status, 400);
    const created = await request('/api/items', 'POST', { title: 'Persisted record' }, cookie);
    assert.equal(created.status, 201);
    const item = await created.json();
    assert.equal(database.prepare('SELECT title FROM items WHERE id = ?').get(item.id)?.title, 'Persisted record');
    const reopened = new DatabaseSync(process.env.DATABASE_PATH);
    try { assert.equal(reopened.prepare('SELECT title FROM items WHERE id = ?').get(item.id)?.title, 'Persisted record'); } finally { reopened.close(); }
    assert.equal((await request('/api/items', 'POST', { title: 'x'.repeat(70000) }, cookie)).status, 413);
    const other = await request('/api/auth/register', 'POST', { email: 'other@example.test', password: 'long-enough-password' });
    const otherCookie = other.headers.get('set-cookie')?.split(';')[0];
    assert.ok(otherCookie);
    assert.equal((await request('/api/items/' + item.id, 'PATCH', { title: 'stolen' }, otherCookie)).status, 404);
    assert.equal((await request('/api/items/' + item.id, 'DELETE', undefined, otherCookie)).status, 404);
    assert.equal((await fetch(base + '/api/items', { method: 'POST', headers: { Cookie: cookie, Origin: 'https://attacker.invalid' } })).status, 403);
    assert.equal((await request('/api/items/' + item.id, 'PATCH', { title: 'Updated' }, cookie)).status, 200);
    assert.equal((await request('/api/auth/logout', 'POST', undefined, cookie)).status, 200);
    assert.equal((await request('/api/items', 'GET', undefined, cookie)).status, 401);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
`,
};

export function addTypeScriptBackend(files: ProjectFiles): ProjectFiles {
  const conflicts = Object.keys(backendFiles).filter(path => path in files);
  if (Object.keys(files).some(path => /^\/?(?:server|backend)\//.test(path)) || conflicts.length) throw new Error('An API or shared integration already exists. Ask the agent to extend it instead of replacing files.');
  const manifestPath = 'package.json' in files ? 'package.json' : '/package.json';
  const manifest = JSON.parse(files[manifestPath] ?? createTypeScriptStarter()['/package.json']);
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('Fix package.json before adding an API.');
  for (const field of ['scripts', 'devDependencies']) {
    if (manifest[field] !== undefined && (!manifest[field] || typeof manifest[field] !== 'object' || Array.isArray(manifest[field]))) throw new Error('Invalid package.json ' + field + '. Existing files were preserved.');
  }
  const commands = { 'dev:api': 'node --env-file-if-exists=server/.env --experimental-strip-types --watch server/index.ts', 'start:api': 'node --env-file-if-exists=server/.env --experimental-strip-types server/index.ts', 'db:migrate': 'node --env-file-if-exists=server/.env --experimental-strip-types server/db/migrate.ts', 'typecheck:api': 'tsc --noEmit -p server/tsconfig.json', 'test:api': 'node --experimental-strip-types --test server/app.test.ts' };
  if (Object.keys(commands).some(name => manifest.scripts?.[name] !== undefined)) throw new Error('API script names already exist. Ask the agent to integrate the backend with your existing scripts.');
  if (manifest.type !== undefined && manifest.type !== 'module') throw new Error('This starter uses ES modules. Ask the agent to adapt it to your existing module system.');
  const gitignore = files['/.gitignore'] ?? '';
  const starter = createTypeScriptStarter();
  const untouchedStarter = Object.keys(files).every(path => files[path] === starter[path]) && files['/src/App.tsx'] === starter['/src/App.tsx'];
  return {
    ...files, ...backendFiles,
    ...(untouchedStarter ? { '/src/App.tsx': fullStackApp, '/src/styles.css': fullStackStyles } : {}),
    [manifestPath]: JSON.stringify({ ...manifest, type: 'module', scripts: { ...manifest.scripts, ...commands }, devDependencies: { typescript: '^7.0.2', '@types/node': '^22.18.0', ...manifest.devDependencies } }, null, 2) + '\n',
    '/.gitignore': gitignore + (gitignore && !gitignore.endsWith('\n') ? '\n' : '') + ['node_modules/', 'dist/', '.env', '.env.*', '!.env.example', 'data/', '*.sqlite', '*.sqlite-shm', '*.sqlite-wal'].filter(line => !gitignore.split('\n').includes(line)).join('\n') + '\n',
  };
}

const fullStackApp = `import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiRequestError } from './lib/api';
import type { Item, User } from '../shared/api';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [title, setTitle] = useState('');
  const [registering, setRegistering] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void api.me().then(async account => {
      const records = await api.items();
      if (active) { setUser(account); setItems(records); }
    }).catch(cause => {
      if (active && !(cause instanceof ApiRequestError && cause.status === 401)) setError(cause instanceof Error ? cause.message : 'Could not load your account');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  async function perform(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError('');
    try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Request failed. Please retry.'); }
    finally { setBusy(false); }
  }
  function authenticate(event: FormEvent) {
    event.preventDefault();
    void perform(async () => {
      const account = await (registering ? api.register(email, password) : api.login(email, password));
      const records = await api.items();
      setUser(account); setItems(records); setPassword('');
    });
  }
  if (loading) return <main className="app"><p role="status">Loading your workspace…</p></main>;
  return <main className="app">
    <header><div><p className="eyebrow">YOUR WORKSPACE</p><h1>{user ? 'Your items' : 'Welcome'}</h1></div>{user && <button disabled={busy} onClick={() => void perform(async () => { await api.logout(); setUser(null); setItems([]); })}>Sign out</button>}</header>
    {error && <p role="alert" className="error">{error}</p>}
    {user ? <>
      <p>Signed in as {user.email}</p>
      <form onSubmit={event => { event.preventDefault(); void perform(async () => { const created = await api.createItem(title); setItems(previous => [...previous, created]); setTitle(''); }); }}>
        <label htmlFor="title">New item</label><div className="row"><input id="title" required maxLength={200} value={title} onChange={event => setTitle(event.target.value)} /><button disabled={busy || !title.trim()}>Add item</button></div>
      </form>
      {items.length === 0 ? <p>No items yet. Add your first one above.</p> : <ul>{items.map(item => <li key={item.id}><span>{item.title}</span>{deleting === item.id ? <div className="row"><button disabled={busy} onClick={() => void perform(async () => { await api.deleteItem(item.id); setItems(previous => previous.filter(record => record.id !== item.id)); setDeleting(null); })}>Confirm delete</button><button disabled={busy} onClick={() => setDeleting(null)}>Cancel</button></div> : <button disabled={busy} onClick={() => setDeleting(item.id)}>Delete</button>}</li>)}</ul>}
    </> : <form onSubmit={authenticate}>
      <h2>{registering ? 'Create an account' : 'Sign in'}</h2>
      <label htmlFor="email">Email</label><input id="email" type="email" autoComplete="email" required value={email} onChange={event => setEmail(event.target.value)} />
      <label htmlFor="password">Password</label><input id="password" type="password" autoComplete={registering ? 'new-password' : 'current-password'} required minLength={12} maxLength={128} value={password} onChange={event => setPassword(event.target.value)} />
      <p>Use 12–128 characters.</p><button disabled={busy}>{busy ? 'Please wait…' : registering ? 'Create account' : 'Sign in'}</button>
      <button type="button" disabled={busy} onClick={() => { setRegistering(!registering); setError(''); }}>{registering ? 'Already have an account? Sign in' : 'Need an account? Register'}</button>
    </form>}
    {busy && <p role="status">Saving your changes…</p>}
  </main>;
}
`;

const fullStackStyles = `* { box-sizing: border-box; }
body { margin: 0; background: #f6f8fb; color: #182333; font: 16px/1.6 system-ui, sans-serif; }
.app { max-width: 720px; margin: 48px auto; padding: 24px; }
header, .row, li { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
h1 { margin: 0; font-size: 32px; letter-spacing: -.03em; } h2 { font-size: 20px; }
.eyebrow { font-size: 12px; font-weight: 600; color: #536174; letter-spacing: .08em; }
form { display: flex; flex-direction: column; gap: 12px; margin: 24px 0; padding: 24px; border-radius: 12px; background: white; }
label { font-weight: 600; font-size: 14px; } input, button { font: inherit; border: 1px solid #b7c1cf; border-radius: 6px; min-height: 44px; padding: 8px 12px; }
input { width: 100%; min-width: 0; } button { cursor: pointer; color: #182333; background: white; } button:hover { background: #edf3f6; } button:disabled { opacity: .55; cursor: wait; }
button:focus-visible, input:focus-visible { outline: 3px solid #087f73; outline-offset: 2px; }
.error { padding: 16px; color: #912222; background: #ffeded; border-radius: 8px; }
ul { list-style: none; padding: 0; } li { padding: 16px 0; border-bottom: 1px solid #dce2e9; } li span { overflow-wrap: anywhere; min-width: 0; }
@media (max-width: 480px) { .app { margin: 12px auto; padding: 16px; } form { padding: 16px; } li { flex-wrap: wrap; } }
`;

/**
 * Ensures the React entry point exists. QA B11: the preview owns /src/main.tsx
 * (the model is blocked from writing it), but the production build needs the
 * real file. If neither /src/main.tsx nor /src/main.jsx exists, create the
 * TypeScript entry from the starter.
 */
export function ensureEntryPoint(files: Record<string, string>): Record<string, string> {
  const hasTsx = files['/src/main.tsx'] !== undefined || files['src/main.tsx'] !== undefined;
  const hasJsx = files['/src/main.jsx'] !== undefined || files['src/main.jsx'] !== undefined;
  if (hasTsx || hasJsx) return files;
  // No entry point — create the TypeScript one from the starter.
  const starter = createTypeScriptStarter();
  const entry = starter['/src/main.tsx'];
  if (entry) {
    return { ...files, '/src/main.tsx': entry };
  }
  return files;
}

/**
 * Bolt-style deterministic scaffold: pure boilerplate files the model must
 * never spend tokens writing. The platform injects these after generation.
 * Only files with zero app-specific content are included — package.json
 * (needs per-app deps), App.tsx and styles.css (the model's job) are excluded.
 */
const SCAFFOLD_PATHS = [
  '/src/main.tsx',
  '/index.html',
  '/tsconfig.json',
  '/vite.config.ts',
  '/src/components/AppBoundary.tsx',
] as const;

export function ensureScaffold(files: Record<string, string>): Record<string, string> {
  const starter = createTypeScriptStarter();
  const next = { ...files };
  for (const path of SCAFFOLD_PATHS) {
    if (next[path] === undefined && next[path.slice(1)] === undefined) {
      const content = starter[path];
      if (content !== undefined) next[path] = content;
    }
  }
  return next;
}
