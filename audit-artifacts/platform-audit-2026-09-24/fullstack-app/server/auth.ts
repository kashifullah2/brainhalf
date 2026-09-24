import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
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
