import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
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
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || body.password.length < 12 || body.password.length > 128) throw new HttpError(400, 'Use a valid email and a password with 12–128 characters');
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
  const id = path.match(/^\/api\/items\/([a-zA-Z0-9-]+)$/)?.[1];
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
