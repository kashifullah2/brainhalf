import type { DurableObjectStorage } from '@cloudflare/workers-types';
import { hashPassword, isValidEmail, isValidPassword, randomId, sha256Hex } from './crypto';

export const EMAIL_SCHEMA = [
  'CREATE TABLE IF NOT EXISTS email_verification (user_id TEXT PRIMARY KEY, verified_at INTEGER)',
  'CREATE TABLE IF NOT EXISTS email_actions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, kind TEXT NOT NULL, expires_at INTEGER NOT NULL)',
  'CREATE INDEX IF NOT EXISTS idx_email_actions_expiry ON email_actions(expires_at)',
];

/** Only called through the private Registry binding. Raw links never enter SQLite. */
export async function emailRegistry(path: string, body: any, storage: DurableObjectStorage): Promise<Response> {
  const sql = storage.sql;
  const kind = body?.kind;
  if (!['verify', 'reset'].includes(kind)) return Response.json({ error: 'Invalid action' }, { status: 400 });
  if (path === '/email/issue') {
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (!isValidEmail(email)) return Response.json({ error: 'Enter a valid email address.' }, { status: 400 });
    const users = sql.exec('SELECT id, password_hash FROM users WHERE email = ?', email).toArray() as Array<{ id: string; password_hash: string }>;
    const user = users[0];
    if (!user || user.password_hash === '!google-only') return Response.json(null);
    const verified = sql.exec('SELECT verified_at FROM email_verification WHERE user_id = ?', user.id).toArray();
    if (kind === 'verify' && verified[0]?.verified_at) return Response.json(null);
    const token = randomId('', 32);
    const hash = await sha256Hex(token);
    storage.transactionSync(() => {
      sql.exec('DELETE FROM email_actions WHERE expires_at <= ? OR (user_id = ? AND kind = ?)', Date.now(), user.id, kind);
      sql.exec('INSERT INTO email_actions VALUES (?, ?, ?, ?)', hash, user.id, kind, Date.now() + (kind === 'reset' ? 30 * 60_000 : 24 * 60 * 60_000));
    });
    return Response.json({ token, email });
  }
  if (path !== '/email/complete' || typeof body.token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(body.token)) return Response.json({ error: 'This link is invalid or expired. Request a new one.' }, { status: 400 });
  if (kind === 'reset' && (typeof body.password !== 'string' || !isValidPassword(body.password))) return Response.json({ error: 'Use a password with 8–512 printable characters.' }, { status: 400 });
  const tokenHash = await sha256Hex(body.token);
  const row = () => (sql.exec('SELECT user_id FROM email_actions WHERE token_hash = ? AND kind = ? AND expires_at > ?', tokenHash, kind, Date.now()).toArray() as Array<{ user_id: string }>)[0];
  if (!row()) return Response.json({ error: 'This link is invalid or expired. Request a new one.' }, { status: 400 });
  const passwordHash = kind === 'reset' ? await hashPassword(body.password) : null;
  const completed = storage.transactionSync(() => {
    // Recheck after password hashing: concurrent requests must not reuse a link.
    const action = row();
    if (!action) return false;
    sql.exec('INSERT OR REPLACE INTO email_verification VALUES (?, ?)', action.user_id, Date.now());
    if (passwordHash) {
      sql.exec('UPDATE users SET password_hash = ? WHERE id = ?', passwordHash, action.user_id);
      sql.exec('DELETE FROM sessions WHERE user_id = ?', action.user_id);
      sql.exec('DELETE FROM ws_tickets WHERE user_id = ?', action.user_id);
      sql.exec('DELETE FROM email_actions WHERE user_id = ?', action.user_id);
    } else sql.exec('DELETE FROM email_actions WHERE user_id = ? AND kind = ?', action.user_id, kind);
    return true;
  });
  return completed ? Response.json({ ok: true }) : Response.json({ error: 'This link is invalid or expired. Request a new one.' }, { status: 400 });
}
