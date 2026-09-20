/**
 * AuthRegistry — the single server-side source of truth for identity and
 * project ownership in BrainHalf.
 *
 * One Durable Object instance ("auth") holds every account, session and
 * project-ownership record in its own SQLite storage. It is reached only
 * through the Worker binding, which has already verified the caller's HMAC
 * session token before issuing any ownership question.
 *
 * Data model
 * ----------
 * users(id, email, password_hash, created_at)        email is UNIQUE
 * sessions(token_hash, user_id, created_at, expires_at)  supports real revocation
 * project_owners(project_id, user_id, name, created_at, updated_at, deleted_at)
 * ws_tickets(ticket_hash, user_id, expires_at)
 *
 * The password hash is PBKDF2-SHA256 (see lib/crypto.ts); the plaintext is
 * never stored and never logged. Token *signing* happens in the Worker —
 * this object only ever sees hashes of tokens, so a DB leak cannot forge a
 * session. WebSocket tickets are the same idea at shorter range: a random
 * secret is handed out once, stored only as a hash, and deleted on use, so a
 * ticket captured from a URL or a trace is already dead.
 */
import type { DurableObjectState } from '@cloudflare/workers-types';
import {
  hashPassword,
  isValidEmail,
  isValidPassword,
  isValidProjectId,
  randomId,
  sha256Hex,
  verifyPassword,
} from './lib/crypto';

const SCHEMA_VERSION = 1;

// One minute is generous for a single handshake and short enough that a ticket
// observed in a log or a trace is already, or is soon, worthless.
const WS_TICKET_TTL_MS = 60 * 1000;

// Per-user ceiling on live projects. Claim-on-first-access means a project row
// appears the moment a user opens an id, so the registry needs a bound or a
// single client can fill its SQLite database with ids it never intends to use.
const MAX_PROJECTS_PER_USER = 50;
// Including tombstones: a deleted project's row is kept forever as the marker
// that stops its id being reclaimed, so the total row count needs its own
// ceiling or a create-delete cycle could write to this table without limit.
const MAX_PROJECT_ROWS_PER_USER = 200;

// NOTE: deliberately *not* declared `implements DurableObject`. This tsconfig
// also pulls in the DOM lib, whose global `Request` is structurally incompatible
// with workers-types' own `Request<unknown, CfProperties<unknown>>`, so the
// interface check rejects a correct `fetch`. The class still satisfies the
// runtime Durable Object contract (stateful class with a `fetch` handler).
export class AuthRegistry {
  private state: DurableObjectState;
  private initialized = false;

  constructor(state: DurableObjectState, _env: any) {
    this.state = state;
  }

  private get sql() {
    return this.state.storage.sql;
  }

  /** Idempotent schema bootstrap with an explicit version row (Phase 5). */
  private ensureSchema(): void {
    if (this.initialized) return;
    const sql = this.sql;
    sql.exec(
      `CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)`
    );
    sql.exec(
      `CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )`
    );
    sql.exec(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`);
    sql.exec(
      `CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      )`
    );
    sql.exec(`CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)`);
    // The TTL sweep deletes by expiry. Without this index every sweep is a full
    // scan of a table that grows one row per login; with it the delete seeks
    // straight to the expired prefix.
    sql.exec(`CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at)`);
    sql.exec(
      `CREATE TABLE IF NOT EXISTS project_owners (
        project_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL DEFAULT 'Untitled Project',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`
    );
    sql.exec(`CREATE INDEX IF NOT EXISTS idx_project_owners_user ON project_owners(user_id, updated_at DESC)`);
    // A deleted project keeps its row as a tombstone. Removing the row entirely
    // left the id unowned, and /projects/claim — which runs on first access to a
    // project — would hand the orphaned Durable Object (and its R2 backup,
    // still full of the previous owner's files) to whoever hit the id next.
    // ALTER has no IF NOT EXISTS, so the column is added only where missing.
    const columns = sql.exec('PRAGMA table_info(project_owners)').toArray() as Array<{ name: string }>;
    if (!columns.some((c) => c.name === 'deleted_at')) {
      sql.exec('ALTER TABLE project_owners ADD COLUMN deleted_at INTEGER');
    }
    sql.exec(
      `CREATE TABLE IF NOT EXISTS ws_tickets (
        ticket_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      )`
    );
    sql.exec(`CREATE INDEX IF NOT EXISTS idx_ws_tickets_expires ON ws_tickets(expires_at)`);
    sql.exec(
      `INSERT OR IGNORE INTO schema_version (version, applied_at) VALUES (${SCHEMA_VERSION}, ${Date.now()})`
    );
    this.initialized = true;
  }

  /**
   * Deletes sessions whose expiry has passed.
   *
   * They are already inert — a lookup compares `expires_at <= Date.now()` and
   * refuses them — so this reclaims storage rather than changing behaviour. It
   * runs opportunistically on a minority of logins rather than on a timer:
   * Durable Object alarms would need a second code path, and the expired-prefix
   * delete is a single indexed statement, so it is cheap enough to run inline.
   *
   * Non-destructive by construction: only rows past their own recorded TTL are
   * ever removed, never a live session.
   */
  private sweepExpiredSessions(): void {
    try {
      this.sql.exec('DELETE FROM sessions WHERE expires_at <= ?', Date.now());
    } catch (e) {
      // A failed sweep must never break the login it was called from.
      console.warn('Session TTL sweep failed:', e);
    }
  }

  /**
   * Same treatment for spent WebSocket tickets. Verification already deletes the
   * row it finds, so this only reclaims the ones whose handshake never arrived —
   * a browser tab closed between minting a ticket and opening the socket.
   */
  private sweepExpiredTickets(now: number): void {
    try {
      this.sql.exec('DELETE FROM ws_tickets WHERE expires_at <= ?', now);
    } catch (e) {
      console.warn('WS ticket sweep failed:', e);
    }
  }

  async fetch(request: Request): Promise<Response> {
    try {
      this.ensureSchema();
      const url = new URL(request.url);
      const path = url.pathname;
      const method = request.method.toUpperCase();

      const json = async <T = any>(): Promise<T | null> => {
        try {
          return (await request.json()) as T;
        } catch {
          return null;
        }
      };

      /* ---------------------------- signup ---------------------------- */
      if (path === '/auth/signup' && method === 'POST') {
        const body = await json<{ email?: string; password?: string }>();
        if (!body) return this.json(400, { error: 'Invalid request body' });
        const email = (body.email || '').trim().toLowerCase();
        const password = body.password || '';
        if (!isValidEmail(email)) return this.json(400, { error: 'A valid email is required' });
        if (!isValidPassword(password))
          return this.json(400, { error: 'Password must be 8-512 printable characters' });

        const existing = this.sql
          .exec('SELECT id FROM users WHERE email = ?', email)
          .toArray() as Array<{ id: string }>;
        if (existing.length > 0) return this.json(409, { error: 'An account with this email already exists' });

        const id = randomId('usr_');
        const passwordHash = await hashPassword(password);
        const now = Date.now();
        this.sql.exec(
          'INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)',
          id,
          email,
          passwordHash,
          now
        );
        return this.json(201, { userId: id, email });
      }

      /* ---------------------------- login ----------------------------- */
      if (path === '/auth/login' && method === 'POST') {
        const body = await json<{ email?: string; password?: string }>();
        if (!body) return this.json(400, { error: 'Invalid request body' });
        const email = (body.email || '').trim().toLowerCase();
        const password = body.password || '';
        if (!isValidEmail(email) || !isValidPassword(password))
          return this.json(401, { error: 'Invalid email or password' });

        const rows = this.sql
          .exec('SELECT id, password_hash FROM users WHERE email = ?', email)
          .toArray() as Array<{ id: string; password_hash: string }>;
        if (rows.length === 0) return this.json(401, { error: 'Invalid email or password' });

        // Same message for unknown user and wrong password — no user enumeration.
        const ok = await verifyPassword(password, rows[0].password_hash);
        if (!ok) return this.json(401, { error: 'Invalid email or password' });

        return this.json(200, { userId: rows[0].id, email });
      }

      /* ----------------------- session registry ----------------------- */
      // Worker registers an issued token so it can be revoked before expiry.
      if (path === '/sessions' && method === 'POST') {
        const body = await json<{ tokenHash?: string; userId?: string; expiresAt?: number }>();
        if (!body || !body.tokenHash || !body.userId || typeof body.expiresAt !== 'number')
          return this.json(400, { error: 'Invalid session record' });
        const now = Date.now();
        // Every login grows this table, so this is where the TTL sweep runs.
        this.sweepExpiredSessions();
        this.sql.exec(
          'INSERT OR REPLACE INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
          body.tokenHash,
          body.userId,
          now,
          Math.floor(body.expiresAt * 1000)
        );
        return this.json(201, { ok: true });
      }

      // Revocation check: is this token still alive?
      if (path.startsWith('/sessions/') && method === 'GET') {
        const tokenHash = decodeURIComponent(path.slice('/sessions/'.length));
        if (!tokenHash) return this.json(404, { error: 'Session not found' });
        const rows = this.sql
          .exec('SELECT user_id, expires_at FROM sessions WHERE token_hash = ?', tokenHash)
          .toArray() as Array<{ user_id: string; expires_at: number }>;
        if (rows.length === 0) return this.json(404, { error: 'Session not found' });
        if (rows[0].expires_at <= Date.now()) return this.json(401, { error: 'Session expired' });
        return this.json(200, { userId: rows[0].user_id });
      }

      /* -------- WebSocket tickets: short-lived, single-use -------- */
      // Browsers cannot set headers on a WebSocket upgrade, so the session token
      // used to ride in the query string — where it landed in access logs and,
      // with traces enabled, in sampled observability data. A ticket is a
      // one-time stand-in: the Worker mints it for a verified user, it lives for
      // a minute, and consuming it deletes it, so anything that captured the
      // value holds a secret that no longer works.
      if (path === '/ws-tickets' && method === 'POST') {
        const body = await json<{ userId?: string }>();
        if (!body?.userId) return this.json(400, { error: 'Missing userId' });
        const ticket = randomId('bhwt_', 24);
        const now = Date.now();
        this.sweepExpiredTickets(now);
        this.sql.exec(
          'INSERT INTO ws_tickets (ticket_hash, user_id, expires_at) VALUES (?, ?, ?)',
          await sha256Hex(ticket),
          body.userId,
          now + WS_TICKET_TTL_MS
        );
        return this.json(201, { ticket });
      }

      if (path === '/ws-tickets/verify' && method === 'POST') {
        const body = await json<{ ticket?: string }>();
        const ticket = body?.ticket;
        if (!ticket || !ticket.startsWith('bhwt_')) return this.json(401, { error: 'Invalid ticket' });
        const ticketHash = await sha256Hex(ticket);
        const rows = this.sql
          .exec('SELECT user_id, expires_at FROM ws_tickets WHERE ticket_hash = ?', ticketHash)
          .toArray() as Array<{ user_id: string; expires_at: number }>;
        // Delete before deciding: a valid ticket is single-use regardless of
        // outcome, and an expired one is reclaimed either way.
        this.sql.exec('DELETE FROM ws_tickets WHERE ticket_hash = ?', ticketHash);
        if (rows.length === 0) return this.json(401, { error: 'Ticket not found' });
        if (rows[0].expires_at <= Date.now()) return this.json(401, { error: 'Ticket expired' });
        return this.json(200, { userId: rows[0].user_id });
      }

      /* ---------------------------- logout ---------------------------- */
      if (path === '/sessions' && method === 'DELETE') {
        const body = await json<{ tokenHash?: string }>();
        if (!body?.tokenHash) return this.json(400, { error: 'Missing token hash' });
        this.sql.exec('DELETE FROM sessions WHERE token_hash = ?', body.tokenHash);
        return this.json(200, { ok: true });
      }

      /* -------------------- project ownership (ACL) ------------------- */
      // Atomic claim: INSERT if unclaimed, then re-read the authoritative owner.
      if (path === '/projects/claim' && method === 'POST') {
        const body = await json<{ projectId?: string; userId?: string; name?: string }>();
        if (!body || !isValidProjectId(body.projectId) || !body.userId)
          return this.json(400, { error: 'Invalid project or user' });
        const now = Date.now();
        const name = typeof body.name === 'string' && body.name.trim() ? body.name.slice(0, 120) : 'Untitled Project';

        // If the project was already claimed, verify ownership immediately without
        // charging against or blocking on the new-project creation quota.
        const existing = this.sql
          .exec('SELECT user_id, deleted_at FROM project_owners WHERE project_id = ?', body.projectId as string)
          .toArray() as Array<{ user_id: string; deleted_at: number | null }>;
        if (existing.length > 0) {
          if (existing[0].deleted_at != null) return this.json(410, { error: 'This project has been deleted' });
          const ownerId = existing[0].user_id;
          if (ownerId !== body.userId) return this.json(403, { error: 'Project is owned by another account' });
          return this.json(200, { projectId: body.projectId, ownerId, claimed: false });
        }

        // A quota is what makes claim-on-first-access safe as an ownership model:
        // without one, a client could mint unbounded rows — one per request — and
        // fill the registry's SQLite database with ids it never intends to use.
        const counts = this.sql
          .exec(
            `SELECT
               SUM(CASE WHEN deleted_at IS NULL THEN 1 ELSE 0 END) AS live,
               COUNT(*) AS total
             FROM project_owners WHERE user_id = ?`,
            body.userId
          )
          .toArray() as Array<{ live: number; total: number }>;
        const live = Number(counts[0]?.live ?? 0);
        const total = Number(counts[0]?.total ?? 0);
        if (live >= MAX_PROJECTS_PER_USER) {
          return this.json(409, {
            error: `You have reached the ${MAX_PROJECTS_PER_USER}-project limit. Delete a project to create another.`,
          });
        }
        if (total >= MAX_PROJECT_ROWS_PER_USER) {
          return this.json(409, {
            error: `You have reached the project limit. Deleting projects keeps their ids reserved; contact support to reclaim them.`,
          });
        }

        this.sql.exec(
          'INSERT OR IGNORE INTO project_owners (project_id, user_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
          body.projectId as string,
          body.userId,
          name,
          now,
          now
        );
        const rows = this.sql
          .exec('SELECT user_id, deleted_at FROM project_owners WHERE project_id = ?', body.projectId as string)
          .toArray() as Array<{ user_id: string; deleted_at: number | null }>;
        if (rows.length === 0) return this.json(500, { error: 'Claim failed' });
        if (rows[0].deleted_at != null) return this.json(410, { error: 'This project has been deleted' });
        const ownerId = rows[0].user_id;
        if (ownerId !== body.userId) return this.json(403, { error: 'Project is owned by another account' });
        return this.json(200, { projectId: body.projectId, ownerId, claimed: true });
      }

      // Read-only ownership check (no claim). Used by preview/static-asset paths
      // where silently claiming a project would be wrong.
      if (path === '/projects/owner-check' && method === 'GET') {
        const projectId = url.searchParams.get('projectId');
        const userId = url.searchParams.get('userId');
        if (!isValidProjectId(projectId) || !userId)
          return this.json(400, { error: 'Invalid request' });
        const rows = this.sql
          .exec('SELECT user_id, deleted_at FROM project_owners WHERE project_id = ?', projectId as string)
          .toArray() as Array<{ user_id: string; deleted_at: number | null }>;
        if (rows.length === 0 || rows[0].deleted_at != null) return this.json(404, { error: 'Project not found' });
        if (rows[0].user_id !== userId) return this.json(403, { error: 'Not the owner' });
        return this.json(200, { ownerId: rows[0].user_id });
      }

      if (path === '/projects' && method === 'GET') {
        const userId = url.searchParams.get('userId');
        if (!userId) return this.json(400, { error: 'Missing userId' });
        const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') || 100)));
        const rows = this.sql
          .exec(
            'SELECT project_id, user_id, name, created_at, updated_at FROM project_owners WHERE user_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT ?',
            userId,
            limit
          )
          .toArray() as Array<{
            project_id: string;
            user_id: string;
            name: string;
            created_at: number;
            updated_at: number;
          }>;
        return this.json(200, {
          projects: rows.map((r) => ({
            id: r.project_id,
            name: r.name,
            createdAt: r.created_at,
            updatedAt: r.updated_at,
          })),
        });
      }

      if (path.startsWith('/projects/') && method === 'PATCH') {
        const projectId = decodeURIComponent(path.slice('/projects/'.length));
        const body = await json<{ userId?: string; name?: string }>();
        if (!isValidProjectId(projectId) || !body?.userId) return this.json(400, { error: 'Invalid request' });
        if (typeof body.name !== 'string' || !body.name.trim()) return this.json(400, { error: 'Invalid name' });
        const name = body.name.slice(0, 120);
        const rows = this.sql
          .exec('SELECT user_id FROM project_owners WHERE project_id = ?', projectId as string)
          .toArray() as Array<{ user_id: string }>;
        if (rows.length === 0 || rows[0].user_id !== body.userId)
          return this.json(403, { error: 'Not the project owner' });
        this.sql.exec(
          'UPDATE project_owners SET name = ?, updated_at = ? WHERE project_id = ?',
          name,
          Date.now(),
          projectId as string
        );
        return this.json(200, { ok: true });
      }

      if (path.startsWith('/projects/') && method === 'DELETE') {
        const projectId = decodeURIComponent(path.slice('/projects/'.length));
        const userId = url.searchParams.get('userId');
        if (!isValidProjectId(projectId) || !userId) return this.json(400, { error: 'Invalid request' });
        const rows = this.sql
          .exec('SELECT user_id, deleted_at FROM project_owners WHERE project_id = ?', projectId as string)
          .toArray() as Array<{ user_id: string; deleted_at: number | null }>;
        if (rows.length === 0 || rows[0].deleted_at != null) return this.json(404, { error: 'Project not found' });
        if (rows[0].user_id !== userId) return this.json(403, { error: 'Not the project owner' });
        // Tombstone instead of a hard delete: an absent row means "unclaimed",
        // which the claim path treats as free to take — and the Durable Object
        // and R2 backup still hold the previous owner's files. Repeated deletes
        // are idempotent; the row stays so the id can never be reclaimed.
        this.sql.exec('UPDATE project_owners SET deleted_at = ? WHERE project_id = ?', Date.now(), projectId as string);
        return this.json(200, { ok: true });
      }

      return this.json(404, { error: 'Not found' });
    } catch (err: any) {
      // Never leak stack traces to clients.
      console.error('AuthRegistry error:', err?.message);
      return this.json(500, { error: 'Internal error' });
    }
  }

  private json(status: number, body: any): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
