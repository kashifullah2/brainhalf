import { ProductOutcomes, type OutcomeEvent } from './lib/product-outcomes';
import { AiLedger, AiBudgetError } from './lib/ai-budget';
import { ProjectCleanup } from './lib/project-cleanup';
import { MAX_PROJECT_ROWS_PER_USER, MAX_PROJECTS_PER_USER } from './lib/limits';
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
import { OAUTH_SCHEMA } from './lib/oauth-schema';
import { EMAIL_SCHEMA, emailRegistry } from './lib/email-registry';
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

/** decodeURIComponent that returns null instead of throwing on malformed input. */
function safeDecode(value: string): string | null {
  try { return decodeURIComponent(value); } catch { return null; }
}

// One minute is generous for a single handshake and short enough that a ticket
// observed in a log or a trace is already, or is soon, worthless.
const WS_TICKET_TTL_MS = 60 * 1000;

// Product limits (live/lifetime project caps) are centralized in src/lib/limits.ts.
const MAX_RATE_WINDOW_MS = 60 * 60 * 1000;
const PROJECT_CLAIM_IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

// NOTE: deliberately *not* declared `implements DurableObject`. This tsconfig
// also pulls in the DOM lib, whose global `Request` is structurally incompatible
// with workers-types' own `Request<unknown, CfProperties<unknown>>`, so the
// interface check rejects a correct `fetch`. The class still satisfies the
// runtime Durable Object contract (stateful class with a `fetch` handler).
export class AuthRegistry {
  private state: DurableObjectState;
  private initialized = false;
  private cleanupRun: Promise<void> | null = null;
  // Cached once per DO instance lifetime for ai-budget:* instances.
  private adminUnlimited: boolean | null = null;
  // Short-TTL cache for the public gallery listing (hottest read path through
  // the singleton DO). Invalidated on any showcase/publish change. 30s TTL.
  private galleryCache: { data: unknown; timestamp: number } | null = null;
  private static readonly GALLERY_CACHE_TTL_MS = 30_000;

  constructor(state: DurableObjectState, private env: any) {
    this.state = state;
  }

  /**
   * Admin accounts are exempt from AI budget limits. The answer is cached for
   * the DO's lifetime only when it is definitive: a registry timeout used to be
   * cached as "not an admin", locking the operator out of their own budget
   * until the Durable Object happened to be evicted.
   */
  private async isAdminUnlimited(): Promise<boolean> {
    if (this.adminUnlimited !== null) return this.adminUnlimited;
    const adminEmails = String(this.env.ADMIN_EMAILS || '').split(',').map((e: string) => e.trim().toLowerCase()).filter(Boolean);
    let unlimited = false;
    let definitive = true;
    if (adminEmails.length) {
      try {
        const doName = (this.state.id as any).name as string | undefined;
        const ownerId = doName?.startsWith('ai-budget:') ? doName.slice('ai-budget:'.length) : '';
        if (ownerId) {
          const authDo = this.env.REGISTRY.get(this.env.REGISTRY.idFromName('auth'));
          const res = await authDo.fetch(`https://registry/admin/managed-owner?ownerId=${encodeURIComponent(ownerId)}`);
          if (res.ok) {
            const data = await res.json() as { email?: string };
            unlimited = adminEmails.includes((data.email || '').toLowerCase());
          } else if (res.status !== 404) {
            definitive = false;
          }
        }
      } catch {
        definitive = false; // fail closed for this request, but retry next time
      }
    }
    if (definitive) this.adminUnlimited = unlimited;
    return unlimited;
  }

  private cleanupDependencies() {
    const checked = async (response: Response) => { if (!response.ok || response.status === 202) throw new Error('Resource cleanup is still pending.'); };
    return {
      removeRuntime: async (projectId: string, ownerId: string) => {
        if (this.env.RUNTIME) await checked(await this.env.RUNTIME.fetch(new Request('https://runtime/delete', { method: 'POST', headers: { 'x-bh-project': projectId, 'x-bh-owner': ownerId } })));
      },
      eraseAgent: async (projectId: string, ownerId: string) => {
        if (!this.env.ChatAgent) throw new Error('Project storage unavailable.');
        await checked(await this.env.ChatAgent.get(this.env.ChatAgent.idFromName(projectId)).fetch(new Request('https://agent/internal/erase', { method: 'POST', headers: { 'x-auth-user-id': ownerId, 'x-bh-project': projectId } })));
      },
      removeBackups: async (projectId: string) => {
        if (!this.env.PROJECT_BACKUPS || !this.env.ChatAgent) throw new Error('Backup storage unavailable.');
        const id = this.env.ChatAgent.idFromName(projectId).toString();
        const results = await Promise.allSettled([`backup-${id}`, `backup-${id}.json`, `backup-${projectId}`, `backup-${projectId}.json`].map(key => this.env.PROJECT_BACKUPS.delete(key)));
        if (results.some(result => result.status === 'rejected')) throw new Error('Backup cleanup failed.');
      },
    };
  }
  private cleanup() {
    return new ProjectCleanup(this.state.storage, this.cleanupDependencies());
  }
  async alarm() {
    this.ensureSchema();
    if (!this.cleanupRun) this.cleanupRun = this.cleanup().run().finally(() => { this.cleanupRun = null; });
    await this.cleanupRun;
  }

  private get sql() {
    return this.state.storage.sql;
  }

  /** Idempotent schema bootstrap with an explicit version row (Phase 5). */
  private ensureSchema(): void {
    if (this.initialized) return;
    const sql = this.sql;
    for (const statement of OAUTH_SCHEMA) sql.exec(statement);
    for (const statement of EMAIL_SCHEMA) sql.exec(statement);
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
    // Custom LLM models added via the admin UI. The api_key is AES-GCM
    // encrypted; the key is derived from the MODEL_KEY_SECRET env secret.
    sql.exec(
      `CREATE TABLE IF NOT EXISTS custom_models (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        base_url TEXT NOT NULL,
        model_id TEXT NOT NULL,
        api_key_encrypted TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`
    );
    // Admin-controlled feature flags, e.g. whether the built-in BrainHalf
    // models are enabled for generation.
    sql.exec(
      `CREATE TABLE IF NOT EXISTS model_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )`
    );
    // A deleted project keeps its row as a tombstone. Removing the row entirely
    // left the id unowned, and /projects/claim — which runs on first access to a
    // project — would hand the orphaned Durable Object (and its R2 backup,
    // still full of the previous owner's files) to whoever hit the id next.
    // ALTER has no IF NOT EXISTS, so the column is added only where missing.
    const columns = sql.exec('PRAGMA table_info(project_owners)').toArray() as Array<{ name: string }>;
    if (!columns.some((c) => c.name === 'deleted_at')) {
      sql.exec('ALTER TABLE project_owners ADD COLUMN deleted_at INTEGER');
    }
    if (!columns.some(column => column.name === 'published')) {
      sql.exec('ALTER TABLE project_owners ADD COLUMN published INTEGER NOT NULL DEFAULT 0');
    }
    // Each column is checked on its own: the old all-or-nothing block threw
    // "duplicate column" on retry if a previous run died after the first ALTER.
    const showcaseColumns: Array<[string, string]> = [
      ['showcase', 'INTEGER NOT NULL DEFAULT 0'],
      ['showcase_description', "TEXT NOT NULL DEFAULT ''"],
      ['remix_count', 'INTEGER NOT NULL DEFAULT 0'],
      ['showcased_at', 'INTEGER'],
    ];
    for (const [name, ddl] of showcaseColumns) {
      if (!columns.some(column => column.name === name)) sql.exec(`ALTER TABLE project_owners ADD COLUMN ${name} ${ddl}`);
    }
    sql.exec(
      `CREATE TABLE IF NOT EXISTS project_claim_idempotency (
        user_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        project_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, idempotency_key)
      )`
    );
    sql.exec(`CREATE INDEX IF NOT EXISTS idx_project_claim_idempotency_created_at ON project_claim_idempotency(created_at)`);
    sql.exec(
      `CREATE TABLE IF NOT EXISTS ws_tickets (
        ticket_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      )`
    );
    sql.exec(`CREATE INDEX IF NOT EXISTS idx_ws_tickets_expires ON ws_tickets(expires_at)`);
    const ticketColumns = sql.exec('PRAGMA table_info(ws_tickets)').toArray() as Array<{ name: string }>;
    if (!ticketColumns.some(column => column.name === 'session_hash')) sql.exec('ALTER TABLE ws_tickets ADD COLUMN session_hash TEXT');
    sql.exec(
      `CREATE TABLE IF NOT EXISTS rate_limits (
        bucket TEXT NOT NULL,
        rate_key TEXT NOT NULL,
        count INTEGER NOT NULL,
        reset_at INTEGER NOT NULL,
        PRIMARY KEY (bucket, rate_key)
      )`
    );
    sql.exec(`CREATE INDEX IF NOT EXISTS idx_rate_limits_reset_at ON rate_limits(reset_at)`);
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

  private consumeRateLimit(bucket: string, rateKey: string, limit: number, windowMs: number): { ok: boolean; retryAfter: number } {
    const now = Date.now();
    try {
      this.sql.exec('DELETE FROM rate_limits WHERE reset_at <= ?', now);
    } catch (e) {
      console.warn('Rate-limit sweep failed:', e);
    }
    const rows = this.sql.exec(
      'SELECT count, reset_at FROM rate_limits WHERE bucket = ? AND rate_key = ?',
      bucket,
      rateKey
    ).toArray() as Array<{ count: number; reset_at: number }>;
    if (!rows.length) {
      this.sql.exec(
        'INSERT INTO rate_limits (bucket, rate_key, count, reset_at) VALUES (?, ?, ?, ?)',
        bucket,
        rateKey,
        1,
        now + windowMs
      );
      return { ok: true, retryAfter: 0 };
    }
    const nextCount = Number(rows[0].count) + 1;
    if (nextCount > limit) {
      return { ok: false, retryAfter: Math.ceil((Number(rows[0].reset_at) - now) / 1000) };
    }
    this.sql.exec(
      'UPDATE rate_limits SET count = ? WHERE bucket = ? AND rate_key = ?',
      nextCount,
      bucket,
      rateKey
    );
    return { ok: true, retryAfter: 0 };
  }

  async fetch(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      const path = url.pathname;
      const method = request.method.toUpperCase();
      if (path.startsWith('/ai/')) {
        const ledger = new AiLedger(this.state.storage);
        if (path === '/ai/usage' && method === 'GET') return Response.json(ledger.usage());
        if (method !== 'POST') return this.json(405, { error: 'Method not allowed' });
        const body = await request.json() as { id?: unknown; lease?: unknown; maxTokens?: unknown };
        if (!body || typeof body.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(body.id)) return this.json(400, { error: 'Invalid AI reservation' });
        if (await this.isAdminUnlimited()) return this.json(200, { ok: true });
        if (path === '/ai/start') ledger.start(body.id);
        else if (path === '/ai/end') ledger.end(body.id);
        else if (path === '/ai/reserve' && typeof body.lease === 'string' && typeof body.maxTokens === 'number') ledger.reserve(body.lease, body.id, body.maxTokens);
        else return this.json(400, { error: 'Invalid AI reservation' });
        return this.json(200, { ok: true });
      }
      this.ensureSchema();
      if (path === '/outcomes' && method === 'POST') {
        let event: OutcomeEvent;
        try { event = await request.json() as OutcomeEvent; }
        catch { return this.json(400, { error: 'Invalid JSON body' }); }
        if (!event || typeof event !== 'object') return this.json(400, { error: 'Invalid outcome event' });
        const owner = this.sql.exec('SELECT user_id FROM project_owners WHERE project_id=? AND deleted_at IS NULL', event.projectId || '').toArray()[0];
        if (!owner || owner.user_id !== event.ownerId) return this.json(403, { error: 'Invalid outcome scope' });
        new ProductOutcomes(this.state.storage).record(event);
        return this.json(200, { ok: true });
      }
      if (path === '/outcomes' && method === 'GET') return this.json(200, new ProductOutcomes(this.state.storage).report(url.searchParams.get('userId') || undefined));
      if (path === '/projects/deletions' && method === 'GET') {
        const userId = url.searchParams.get('userId');
        if (!userId) return this.json(400, { error: 'Missing owner' });
        return Response.json({ deletions: this.cleanup().list(userId).map(({ user_id: _owner, ...job }) => job) });
      }
      if (path === '/projects/quota' && method === 'GET') {
        const userId = url.searchParams.get('userId');
        if (!userId) return this.json(400, { error: 'Missing owner' });
        const rows = this.sql
          .exec('SELECT COUNT(*) AS live FROM project_owners WHERE user_id = ? AND deleted_at IS NULL', userId)
          .toArray() as Array<{ live: number }>;
        return Response.json({ live: Number(rows[0]?.live ?? 0), limit: (await this.isAdminUnlimited()) ? 999999 : MAX_PROJECTS_PER_USER });
      }
      if (path === '/projects/deletion-owner' && method === 'GET') {
        const row = this.sql.exec('SELECT user_id,deleted_at FROM project_owners WHERE project_id=?', url.searchParams.get('projectId') || '').toArray()[0];
        return row?.deleted_at != null ? Response.json({ ownerId: row.user_id }) : this.json(404, { error: 'No deletion was requested' });
      }

      const json = async <T = any>(): Promise<T | null> => {
        try {
          return (await request.json()) as T;
        } catch {
          return null;
        }
      };

      // These routes are internal to the Worker binding, never public API.
      // Operator tooling resolves pilot emails here without reading credentials,
      // creating sessions, or adding an account-enumeration route to the app.
      if (path === '/admin/account' && method === 'GET') {
        const email = (url.searchParams.get('email') || '').trim().toLowerCase();
        if (!isValidEmail(email)) return this.json(400, { error: 'A valid email is required' });
        const rows = this.sql.exec('SELECT id, email FROM users WHERE email = ?', email).toArray();
        return rows[0] ? this.json(200, rows[0]) : this.json(404, { error: 'Account not found' });
      }
      if (path === '/admin/managed-owner' && method === 'GET') {
        const id = url.searchParams.get('ownerId') || '';
        if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) return this.json(400, { error: 'Invalid owner' });
        const owner = this.sql.exec('SELECT email FROM users WHERE id=?', id).toArray()[0];
        if (!owner) return this.json(404, { error: 'Account not found' });
        const email = this.sql.exec('SELECT verified_at FROM email_verification WHERE user_id=?', id).toArray()[0];
        const google = this.sql.exec("SELECT subject FROM oauth_identities WHERE user_id=? AND provider='google'", id).toArray()[0];
        return this.json(200, { email: owner.email, verified: !!email?.verified_at || !!google });
      }
      // Operator account list for support and growth review. Compact rows only —
      // password hashes and OAuth subjects never leave the registry. The last
      // session row approximates last sign-in; sessions expire after 30 days.
      if (path === '/admin/users' && method === 'GET') {
        const rows = this.sql.exec(`SELECT u.id, u.email, u.created_at,
          (SELECT MAX(s.created_at) FROM sessions s WHERE s.user_id = u.id) AS last_login,
          (SELECT COUNT(*) FROM project_owners p WHERE p.user_id = u.id) AS projects,
          (SELECT v.verified_at FROM email_verification v WHERE v.user_id = u.id) AS verified_at,
          (SELECT o.subject FROM oauth_identities o WHERE o.user_id = u.id AND o.provider = 'google') AS google_subject
          FROM users u ORDER BY u.created_at DESC LIMIT 500`).toArray();
        return this.json(200, {
          users: rows.map(row => ({
            id: row.id, email: row.email, createdAt: row.created_at, lastLoginAt: row.last_login ?? null,
            projects: row.projects, verified: Boolean(row.verified_at || row.google_subject),
          })),
        });
      }
      // Operator project list: every project with its owner, for moderation.
      // Includes soft-deleted (tombstoned) projects so the operator can see
      // what is awaiting cleanup versus fully gone.
      if (path === '/admin/projects' && method === 'GET') {
        const rows = this.sql.exec(`SELECT p.project_id, p.user_id, p.name, p.created_at, p.updated_at,
          p.deleted_at, p.published, p.showcase, u.email AS owner_email
          FROM project_owners p LEFT JOIN users u ON u.id = p.user_id
          ORDER BY p.updated_at DESC LIMIT 500`).toArray();
        return this.json(200, {
          projects: rows.map(row => ({
            id: row.project_id, ownerId: row.user_id, ownerEmail: row.owner_email ?? '(deleted user)',
            name: row.name, createdAt: row.created_at, updatedAt: row.updated_at,
            deleted: row.deleted_at != null, published: row.published === 1, showcase: row.showcase === 1,
          })),
        });
      }
      // Operator hard delete: fully erase a project from scratch. Unlike the
      // user-facing DELETE (which tombstones and cleans up async), this runs
      // the storage cleanup SYNCHRONOUSLY first — runtime slot, agent DO,
      // R2 backups — and only then removes the registry row. The order
      // matters: removing the row first would leave the id unowned and
      // claimable, handing the orphaned Durable Object to the next claimant.
      if (path.startsWith('/admin/projects/') && method === 'DELETE') {
        const projectId = safeDecode(path.slice('/admin/projects/'.length)) ?? '';
        if (!isValidProjectId(projectId)) return this.json(400, { error: 'Invalid request' });
        const rows = this.sql.exec('SELECT user_id FROM project_owners WHERE project_id = ?', projectId).toArray() as Array<{ user_id: string }>;
        if (!rows.length) return this.json(404, { error: 'Project not found' });
        const ownerId = rows[0].user_id;
        const deps = this.cleanupDependencies();
        // Storage must be erased BEFORE the registry row is removed. If any
        // cleanup step fails the row is kept (and a 5xx returned) so the id
        // stays owned and the delete can be retried — deleting the row anyway
        // would orphan the Durable Object storage/R2 backups and free the id
        // for reclaim by another user.
        const failedSteps: string[] = [];
        try {
          await deps.removeRuntime(projectId, ownerId);
        } catch (err) { failedSteps.push(`runtime: ${(err as Error)?.message}`); }
        try {
          await deps.eraseAgent(projectId, ownerId);
        } catch (err) { failedSteps.push(`agent: ${(err as Error)?.message}`); }
        try {
          await deps.removeBackups(projectId);
        } catch (err) { failedSteps.push(`backups: ${(err as Error)?.message}`); }
        if (failedSteps.length > 0) {
          console.error(`Admin hard delete failed for project ${projectId} (owner ${ownerId}); registry row kept. Failures: ${failedSteps.join('; ')}`);
          return this.json(500, { error: 'Project cleanup failed; the project was not deleted.', failedSteps });
        }
        this.state.storage.transactionSync(() => {
          this.sql.exec('DELETE FROM project_owners WHERE project_id = ?', projectId);
          // The cleanup queue table is created by ProjectCleanup's constructor;
          // ensure it exists before deleting (it may never have been created).
          this.sql.exec('CREATE TABLE IF NOT EXISTS project_cleanup (project_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, step INTEGER NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0, next_at INTEGER NOT NULL, completed_at INTEGER)');
          this.sql.exec('DELETE FROM project_cleanup WHERE project_id = ?', projectId);
          this.sql.exec('DELETE FROM project_claim_idempotency WHERE project_id = ?', projectId);
        });
        this.galleryCache = null;
        return this.json(200, { ok: true, deleted: projectId });
      }
      // Operator user delete: remove the account and everything it owns.
      // Each project is hard-deleted (storage erased before the registry row
      // is removed), then sessions, verification rows, OAuth links, and the
      // user row itself are removed.
      if (path.startsWith('/admin/users/') && method === 'DELETE') {
        const userId = safeDecode(path.slice('/admin/users/'.length)) ?? '';
        if (!userId || userId.length > 128) return this.json(400, { error: 'Invalid request' });
        const exists = this.sql.exec('SELECT id, email FROM users WHERE id = ?', userId).toArray() as Array<{ id: string; email: string }>;
        if (!exists.length) return this.json(404, { error: 'User not found' });
        const projectRows = this.sql.exec('SELECT project_id FROM project_owners WHERE user_id = ?', userId).toArray() as Array<{ project_id: string }>;
        const deps = this.cleanupDependencies();
        const deletedProjects: string[] = [];
        const failedSteps: string[] = [];
        for (const { project_id: projectId } of projectRows) {
          let projectOk = true;
          try { await deps.removeRuntime(projectId, userId); } catch (err) { projectOk = false; failedSteps.push(`${projectId} runtime: ${(err as Error)?.message}`); }
          try { await deps.eraseAgent(projectId, userId); } catch (err) { projectOk = false; failedSteps.push(`${projectId} agent: ${(err as Error)?.message}`); }
          try { await deps.removeBackups(projectId); } catch (err) { projectOk = false; failedSteps.push(`${projectId} backups: ${(err as Error)?.message}`); }
          if (projectOk) deletedProjects.push(projectId);
        }
        // Same rule as the single-project hard delete: ownership rows are the only
        // thing keeping an id from being claimed by someone else. If any storage
        // step failed, keep the account and its rows so the delete can be retried;
        // removing them anyway orphaned the project data under a claimable id.
        if (failedSteps.length > 0) {
          console.error(`Admin user delete failed for ${userId}; account kept. Failures: ${failedSteps.join('; ')}`);
          return this.json(500, { error: 'Project cleanup failed; the account was not deleted.', failedSteps });
        }
        const email = exists[0].email;
        this.state.storage.transactionSync(() => {
          this.sql.exec('CREATE TABLE IF NOT EXISTS project_cleanup (project_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, step INTEGER NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0, next_at INTEGER NOT NULL, completed_at INTEGER)');
          for (const projectId of deletedProjects) {
            this.sql.exec('DELETE FROM project_owners WHERE project_id = ?', projectId);
            this.sql.exec('DELETE FROM project_cleanup WHERE project_id = ?', projectId);
            this.sql.exec('DELETE FROM project_claim_idempotency WHERE project_id = ?', projectId);
          }
          this.sql.exec('DELETE FROM sessions WHERE user_id = ?', userId);
          this.sql.exec('DELETE FROM email_verification WHERE user_id = ?', userId);
          this.sql.exec('DELETE FROM email_actions WHERE user_id = ?', userId);
          this.sql.exec('DELETE FROM oauth_identities WHERE user_id = ?', userId);
          this.sql.exec('DELETE FROM users WHERE id = ?', userId);
        });
        this.galleryCache = null;
        return this.json(200, { ok: true, deletedUser: email, deletedProjects: deletedProjects.length });
      }
      // Admin custom models: list, add, delete, and test.
      // Models are OpenAI-compatible (base_url + api_key + model_id).
      if (path === '/admin/models' && method === 'GET') {
        const rows = this.sql.exec(
          'SELECT id, name, base_url, model_id, created_at, updated_at FROM custom_models ORDER BY created_at DESC'
        ).toArray() as Array<{ id: string; name: string; base_url: string; model_id: string; created_at: number; updated_at: number }>;
        return this.json(200, { models: rows.map(r => ({
          id: r.id, name: r.name, baseUrl: r.base_url, modelId: r.model_id,
          createdAt: r.created_at, updatedAt: r.updated_at,
        })) });
      }
      if (path === '/admin/models' && method === 'POST') {
        const body = await json<{ name?: string; baseUrl?: string; modelId?: string; apiKey?: string }>();
        if (!body || !body.name?.trim() || !body.baseUrl?.trim() || !body.modelId?.trim() || !body.apiKey?.trim()) {
          return this.json(400, { error: 'Name, base URL, model ID, and API key are required.' });
        }
        let baseUrl: string;
        try {
          baseUrl = new URL(body.baseUrl.trim()).toString().replace(/\/$/, '');
        } catch {
          return this.json(400, { error: 'Base URL must be a valid URL.' });
        }
        // MODEL_KEY_SECRET must be a separate secret dedicated to encrypting
        // custom model API keys; reusing SESSION_SECRET would let a single
        // compromised value expose both session forgery and key decryption.
        const secret = (this.env as Record<string, unknown>).MODEL_KEY_SECRET as string | undefined;
        if (!secret) return this.json(500, { error: 'MODEL_KEY_SECRET is not configured. Set it as a Worker secret to enable custom model storage.' });
        const { encryptValue } = await import('./lib/crypto');
        const id = `cm_${randomId('', 12)}`;
        const now = Date.now();
        const encrypted = await encryptValue(secret, body.apiKey.trim());
        this.sql.exec(
          'INSERT INTO custom_models (id, name, base_url, model_id, api_key_encrypted, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          id, body.name.trim(), baseUrl, body.modelId.trim(), encrypted, now, now
        );
        return this.json(201, { id, name: body.name.trim(), baseUrl, modelId: body.modelId.trim() });
      }
      if (path.startsWith('/admin/models/') && method === 'DELETE') {
        const id = safeDecode(path.slice('/admin/models/'.length).split('/')[0]) ?? '';
        if (!id.startsWith('cm_')) return this.json(400, { error: 'Invalid request' });
        this.sql.exec('DELETE FROM custom_models WHERE id = ?', id);
        return this.json(200, { ok: true, deleted: id });
      }
      if (path.startsWith('/admin/models/') && path.endsWith('/test') && method === 'POST') {
        const id = safeDecode(path.slice('/admin/models/'.length, -'/test'.length)) ?? '';
        const body = await json<{ prompt?: string }>();
        if (!body?.prompt?.trim()) return this.json(400, { error: 'A prompt is required.' });
        const rows = this.sql.exec(
          'SELECT base_url, model_id, api_key_encrypted FROM custom_models WHERE id = ?', id
        ).toArray() as Array<{ base_url: string; model_id: string; api_key_encrypted: string }>;
        if (!rows.length) return this.json(404, { error: 'Model not found' });
        const secret = (this.env as Record<string, unknown>).MODEL_KEY_SECRET as string | undefined;
        if (!secret) return this.json(500, { error: 'MODEL_KEY_SECRET is not configured. Set it as a Worker secret to enable custom model storage.' });
        const { decryptValue } = await import('./lib/crypto');
        const apiKey = await decryptValue(secret, rows[0].api_key_encrypted);
        if (!apiKey) return this.json(500, { error: 'Could not decrypt the API key.' });
        // Unlimited: no max_tokens cap — the model generates until it stops.
        const upstream = await fetch(`${rows[0].base_url}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
          body: JSON.stringify({
            model: rows[0].model_id,
            messages: [{ role: 'user', content: body.prompt.trim() }],
            stream: true,
          }),
        });
        if (!upstream.ok || !upstream.body) {
          const text = await upstream.text().catch(() => '');
          return this.json(502, { error: `Model API error (${upstream.status}): ${text.slice(0, 200)}` });
        }
        // Stream the upstream SSE through to the client.
        return new Response(upstream.body, {
          headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
        });
      }
      if (path.startsWith('/email/') && method === 'POST') return emailRegistry(path, await json(), this.state.storage);
      // Admin model settings: on/off toggle for the built-in BrainHalf models.
      if (path === '/admin/settings' && method === 'GET') {
        const enabledRows = this.sql.exec("SELECT value FROM model_settings WHERE key = 'integrated_models_enabled'").toArray() as Array<{ value: string }>;
        const disabledRows = this.sql.exec("SELECT value FROM model_settings WHERE key = 'disabled_models'").toArray() as Array<{ value: string }>;
        let disabledModels: string[] = [];
        try { disabledModels = disabledRows.length ? JSON.parse(disabledRows[0].value) : []; } catch { disabledModels = []; }
        return this.json(200, {
          integratedModelsEnabled: enabledRows.length === 0 ? true : enabledRows[0].value === '1',
          disabledModels: Array.isArray(disabledModels) ? disabledModels : [],
        });
      }
      if (path === '/admin/settings' && method === 'POST') {
        const body = await json<{ integratedModelsEnabled?: boolean; disabledModels?: string[] }>();
        if (body?.integratedModelsEnabled !== undefined && typeof body.integratedModelsEnabled !== 'boolean') {
          return this.json(400, { error: 'integratedModelsEnabled must be a boolean.' });
        }
        if (body?.disabledModels !== undefined && !Array.isArray(body.disabledModels)) {
          return this.json(400, { error: 'disabledModels must be an array.' });
        }
        const now = Date.now();
        if (body?.integratedModelsEnabled !== undefined) {
          this.sql.exec(
            "INSERT INTO model_settings (key, value, updated_at) VALUES ('integrated_models_enabled', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
            body.integratedModelsEnabled ? '1' : '0', now
          );
        }
        if (body?.disabledModels !== undefined) {
          const clean = body.disabledModels.filter(id => typeof id === 'string' && id.length <= 200);
          this.sql.exec(
            "INSERT INTO model_settings (key, value, updated_at) VALUES ('disabled_models', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
            JSON.stringify(clean), now
          );
        }
        return this.json(200, { ok: true });
      }
      // Public (authenticated) status check so the UI can hide the model
      // picker when the built-in models are disabled.
      if (path === '/public/model-status' && method === 'GET') {
        const enabledRows = this.sql.exec("SELECT value FROM model_settings WHERE key = 'integrated_models_enabled'").toArray() as Array<{ value: string }>;
        const disabledRows = this.sql.exec("SELECT value FROM model_settings WHERE key = 'disabled_models'").toArray() as Array<{ value: string }>;
        const customRows = this.sql.exec('SELECT id, name, base_url, model_id FROM custom_models ORDER BY created_at DESC').toArray() as Array<{ id: string; name: string; base_url: string; model_id: string }>;
        let disabledModels: string[] = [];
        try { disabledModels = disabledRows.length ? JSON.parse(disabledRows[0].value) : []; } catch { disabledModels = []; }
        return this.json(200, {
          integratedModelsEnabled: enabledRows.length === 0 ? true : enabledRows[0].value === '1',
          disabledModels: Array.isArray(disabledModels) ? disabledModels : [],
          customModels: customRows.map(r => ({ id: r.id, name: r.name, baseUrl: r.base_url, modelId: r.model_id })),
        });
      }
      // Internal: full custom model config (including decrypted API key) for
      // the agent's generation path. Only callable within the worker network.
      if (path.startsWith('/internal/custom-model/') && method === 'GET') {
        const id = safeDecode(path.slice('/internal/custom-model/'.length)) ?? '';
        if (!id.startsWith('cm_')) return this.json(400, { error: 'Invalid request' });
        const rows = this.sql.exec(
          'SELECT base_url, model_id, api_key_encrypted FROM custom_models WHERE id = ?', id
        ).toArray() as Array<{ base_url: string; model_id: string; api_key_encrypted: string }>;
        if (!rows.length) return this.json(404, { error: 'Model not found' });
        const secret = (this.env as Record<string, unknown>).MODEL_KEY_SECRET as string | undefined;
        if (!secret) return this.json(500, { error: 'MODEL_KEY_SECRET is not configured. Set it as a Worker secret to enable custom model storage.' });
        const { decryptValue } = await import('./lib/crypto');
        const apiKey = await decryptValue(secret, rows[0].api_key_encrypted);
        if (!apiKey) return this.json(500, { error: 'Could not decrypt the API key.' });
        return this.json(200, { id, baseUrl: rows[0].base_url, modelId: rows[0].model_id, apiKey });
      }
      if (path === '/oauth/store' && method === 'POST') {
        const body = await json<{ key?: string; kind?: string; data?: unknown; ttl?: number }>();
        if (!body || !/^[A-Za-z0-9_-]{43}$/.test(body.key || '') || !['state', 'handoff'].includes(body.kind || '')) return this.json(400, { error: 'Invalid flow' });
        const ttl = body.kind === 'handoff' ? 60 : 600;
        const data = JSON.stringify(body.data);
        if (!data || data.length > 8192) return this.json(400, { error: 'Invalid flow' });
        const hash = await sha256Hex(body.key!);
        this.sql.exec('DELETE FROM oauth_flows WHERE expires_at <= ?', Date.now());
        this.sql.exec('INSERT INTO oauth_flows (key_hash, kind, data, expires_at) VALUES (?, ?, ?, ?)', hash, body.kind!, data, Date.now() + ttl * 1000);
        return this.json(201, { ok: true });
      }
      if (path === '/oauth/consume' && method === 'POST') {
        const body = await json<{ key?: string; kind?: string }>();
        if (!body || !/^[A-Za-z0-9_-]{43}$/.test(body.key || '')) return this.json(200, null);
        const hash = await sha256Hex(body.key!);
        // No await between lookup and deletion: DO requests cannot interleave.
        const rows = this.sql.exec('SELECT data, expires_at FROM oauth_flows WHERE key_hash = ? AND kind = ?', hash, body.kind || '').toArray() as Array<{ data: string; expires_at: number }>;
        this.sql.exec('DELETE FROM oauth_flows WHERE key_hash = ? AND kind = ?', hash, body.kind || '');
        return this.json(200, rows[0] && rows[0].expires_at > Date.now() ? JSON.parse(rows[0].data) : null);
      }
      if (path === '/auth/google' && method === 'POST') {
        const body = await json<{ subject?: string; email?: string }>();
        if (typeof body?.subject !== 'string' || !body.subject || body.subject.length > 255 || typeof body.email !== 'string' || !isValidEmail(body.email)) return this.json(400, { error: 'Invalid Google identity' });
        const subject = body.subject;
        const email = body.email.trim().toLowerCase();
        const result = this.state.storage.transactionSync(() => {
          const linked = this.sql.exec("SELECT users.id, users.email FROM oauth_identities JOIN users ON users.id = oauth_identities.user_id WHERE provider = 'google' AND subject = ?", subject).toArray() as Array<{ id: string; email: string }>;
          if (linked[0]) return { userId: linked[0].id, email: linked[0].email };
          // Password signup has no verified email. Matching addresses alone
          // cannot safely establish that these two accounts are the same person.
          if (this.sql.exec('SELECT id FROM users WHERE email = ?', email).toArray().length) return { conflict: true };
          const id = randomId('usr_');
          this.sql.exec('INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)', id, email, '!google-only', Date.now());
          this.sql.exec("INSERT INTO oauth_identities (provider, subject, user_id) VALUES ('google', ?, ?)", subject, id);
          return { userId: id, email };
        });
        return this.json(200, result);
      }

      /* ---------------------------- signup ---------------------------- */
      if (path === '/auth/signup' && method === 'POST') {
        const body = await json<{ email?: string; password?: string; requireVerification?: boolean }>();
        if (!body) return this.json(400, { error: 'Invalid request body' });
        const email = (body.email || '').trim().toLowerCase();
        const password = body.password || '';
        if (!isValidEmail(email)) return this.json(400, { error: 'A valid email is required' });
        if (!isValidPassword(password))
          return this.json(400, { error: 'Password must be 8-512 printable characters' });

        const existing = this.sql
          .exec('SELECT id FROM users WHERE email = ?', email)
          .toArray() as Array<{ id: string }>;
        if (existing.length > 0) {
          await hashPassword(password); // equalise timing with the new-account path
          // Enumeration-safe: indistinguishable from a fresh signup. The
          // caller (email.ts) skips the verification email for existing
          // accounts but returns the identical 202 to the browser.
          return this.json(200, { userId: existing[0].id, email, alreadyExists: true });
        }

        const id = randomId('usr_');
        const passwordHash = await hashPassword(password);
        const now = Date.now();
        try {
          this.state.storage.transactionSync(() => {
          this.sql.exec(
            'INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)',
            id,
            email,
            passwordHash,
            now
          );
          if (body.requireVerification) this.sql.exec('INSERT INTO email_verification (user_id, verified_at) VALUES (?, NULL)', id);
          });
        } catch (err) {
          // Lost a signup race: another request registered this email between
          // our SELECT and INSERT. Respond exactly like the alreadyExists
          // branch above — a 500 here would both 500 a legit user and leak
          // the address via timing/status.
          const msg = err instanceof Error ? err.message : String(err);
          if (/UNIQUE constraint failed|SQLITE_CONSTRAINT/i.test(msg)) {
            const winner = this.sql.exec('SELECT id FROM users WHERE email = ?', email).toArray() as Array<{ id: string }>;
            return this.json(200, { userId: winner[0]?.id ?? id, email, alreadyExists: true });
          }
          throw err;
        }
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
        if (rows.length === 0) {
          // Spend the same PBKDF2 time as a real check; returning instantly
          // let anyone enumerate registered emails by response time.
          await hashPassword(password);
          return this.json(401, { error: 'Invalid email or password' });
        }

        // Same message for unknown user and wrong password — no user enumeration.
        const ok = await verifyPassword(password, rows[0].password_hash);
        if (!ok) return this.json(401, { error: 'Invalid email or password' });

        const verification = this.sql.exec('SELECT verified_at FROM email_verification WHERE user_id = ?', rows[0].id).toArray();
        if (verification.length && verification[0].verified_at === null) return this.json(403, { error: 'Verify your email before signing in. You can request a new link below.', code: 'EMAIL_VERIFICATION_REQUIRED' });

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
          Math.floor(body.expiresAt * 1000) // body.expiresAt is Unix seconds; DB stores milliseconds for Date.now() comparisons
        );
        return this.json(201, { ok: true });
      }

      // Revocation check: is this token still alive?
      if (path.startsWith('/sessions/') && method === 'GET') {
        const tokenHash = safeDecode(path.slice('/sessions/'.length)) ?? '';
        if (!tokenHash) return this.json(404, { error: 'Session not found' });
        const rows = this.sql
          .exec('SELECT user_id, expires_at FROM sessions WHERE token_hash = ?', tokenHash)
          .toArray() as Array<{ user_id: string; expires_at: number }>;
        if (rows.length === 0) return this.json(404, { error: 'Session not found' });
        if (rows[0].expires_at <= Date.now()) return this.json(401, { error: 'Session expired' });
        // Email rides along so operator gates can fall back to the ADMIN_EMAILS
        // allowlist: the userId-based PRODUCT_METRICS_OWNER_IDS strand access
        // forever when the owner deletes and re-creates their account (the new
        // account gets a new userId).
        const userRows = this.sql.exec('SELECT email FROM users WHERE id = ?', rows[0].user_id).toArray() as Array<{ email: string }>;
        return this.json(200, { userId: rows[0].user_id, email: userRows[0]?.email });
      }

      /* -------- WebSocket tickets: short-lived, single-use -------- */
      // Browsers cannot set headers on a WebSocket upgrade, so the session token
      // used to ride in the query string — where it landed in access logs and,
      // with traces enabled, in sampled observability data. A ticket is a
      // one-time stand-in: the Worker mints it for a verified user, it lives for
      // a minute, and consuming it deletes it, so anything that captured the
      // value holds a secret that no longer works.
      if (path === '/ws-tickets' && method === 'POST') {
        const body = await json<{ userId?: string; sessionHash?: string }>();
        if (!body?.userId || !/^[a-f0-9]{64}$/.test(body.sessionHash || '')) return this.json(400, { error: 'Missing session identity' });
        const session = this.sql.exec('SELECT user_id, expires_at FROM sessions WHERE token_hash = ?', body.sessionHash!).toArray();
        if (!session.length || session[0].user_id !== body.userId || Number(session[0].expires_at) <= Date.now()) return this.json(401, { error: 'Session expired' });
        const ticket = randomId('bhwt_', 24);
        const now = Date.now();
        this.sweepExpiredTickets(now);
        this.sql.exec(
          'INSERT INTO ws_tickets (ticket_hash, user_id, expires_at, session_hash) VALUES (?, ?, ?, ?)',
          await sha256Hex(ticket),
          body.userId,
          now + WS_TICKET_TTL_MS,
          body.sessionHash!
        );
        return this.json(201, { ticket });
      }

      if (path === '/ws-tickets/verify' && method === 'POST') {
        const body = await json<{ ticket?: string }>();
        const ticket = body?.ticket;
        if (!ticket || !ticket.startsWith('bhwt_')) return this.json(401, { error: 'Invalid ticket' });
        const ticketHash = await sha256Hex(ticket);
        const rows = this.sql
          .exec('SELECT user_id, expires_at, session_hash FROM ws_tickets WHERE ticket_hash = ?', ticketHash)
          .toArray() as Array<{ user_id: string; expires_at: number; session_hash: string | null }>;
        // Delete before deciding: a valid ticket is single-use regardless of
        // outcome, and an expired one is reclaimed either way.
        this.sql.exec('DELETE FROM ws_tickets WHERE ticket_hash = ?', ticketHash);
        if (rows.length === 0) return this.json(401, { error: 'Ticket not found' });
        if (rows[0].expires_at <= Date.now()) return this.json(401, { error: 'Ticket expired' });
        const session = rows[0].session_hash ? this.sql.exec('SELECT user_id, expires_at FROM sessions WHERE token_hash = ?', rows[0].session_hash).toArray() : [];
        if (!session.length || session[0].user_id !== rows[0].user_id || Number(session[0].expires_at) <= Date.now()) return this.json(401, { error: 'Session expired' });
        return this.json(200, { userId: rows[0].user_id, sessionHash: rows[0].session_hash });
      }

      /* ---------------------------- logout ---------------------------- */
      if (path === '/sessions' && method === 'DELETE') {
        const body = await json<{ tokenHash?: string }>();
        if (!body?.tokenHash) return this.json(400, { error: 'Missing token hash' });
        this.sql.exec('DELETE FROM sessions WHERE token_hash = ?', body.tokenHash);
        return this.json(200, { ok: true });
      }

      if (path === '/rate-limit/check' && method === 'POST') {
        const body = await json<{ bucket?: string; key?: string; limit?: number; windowMs?: number }>();
        const bucket = typeof body?.bucket === 'string' ? body.bucket.trim() : '';
        const rateKey = typeof body?.key === 'string' ? body.key.trim() : '';
        const limit = Number.isInteger(body?.limit) ? Number(body?.limit) : 0;
        const windowMs = Number.isInteger(body?.windowMs) ? Number(body?.windowMs) : 0;
        if (!bucket || !rateKey || limit < 1 || windowMs < 1 || windowMs > MAX_RATE_WINDOW_MS) {
          return this.json(400, { error: 'Invalid rate limit request' });
        }
        const result = this.consumeRateLimit(bucket, rateKey, limit, windowMs);
        return this.json(200, result);
      }

      /* -------------------- project ownership (ACL) ------------------- */
      // Atomic claim: INSERT if unclaimed, then re-read the authoritative owner.
      if (path === '/projects/claim' && method === 'POST') {
        const body = await json<{ projectId?: string; userId?: string; name?: string; idempotencyKey?: string }>();
        if (!body || !isValidProjectId(body.projectId) || !body.userId)
          return this.json(400, { error: 'Invalid project or user' });
        const now = Date.now();
        const name = typeof body.name === 'string' && body.name.trim() ? body.name.slice(0, 120) : 'Untitled Project';
        const idempotencyKey = typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim() : '';
        if (idempotencyKey && !/^[A-Za-z0-9:_-]{1,200}$/.test(idempotencyKey)) {
          return this.json(400, { error: 'Invalid idempotency key' });
        }

        if (idempotencyKey) {
          this.sql.exec('DELETE FROM project_claim_idempotency WHERE created_at <= ?', now - PROJECT_CLAIM_IDEMPOTENCY_TTL_MS);
          const cached = this.sql.exec(
            'SELECT project_id FROM project_claim_idempotency WHERE user_id = ? AND idempotency_key = ?',
            body.userId,
            idempotencyKey
          ).toArray() as Array<{ project_id: string }>;
          if (cached.length > 0) {
            if (cached[0].project_id !== body.projectId) {
              return this.json(409, {
                error: 'Duplicate project submission detected. Reopen the original project instead of creating a second copy.',
                projectId: cached[0].project_id,
              });
            }
            const rows = this.sql
              .exec('SELECT user_id, deleted_at FROM project_owners WHERE project_id = ?', cached[0].project_id)
              .toArray() as Array<{ user_id: string; deleted_at: number | null }>;
            if (rows.length > 0) {
              if (rows[0].deleted_at != null) return this.json(410, { error: 'This project has been deleted' });
              if (rows[0].user_id !== body.userId) return this.json(403, { error: 'Project is owned by another account' });
              return this.json(200, { projectId: cached[0].project_id, ownerId: rows[0].user_id, claimed: false, idempotent: true });
            }
          }
        }

        // If the project was already claimed, verify ownership immediately without
        // charging against or blocking on the new-project creation quota.
        const existing = this.sql
          .exec('SELECT user_id, deleted_at FROM project_owners WHERE project_id = ?', body.projectId as string)
          .toArray() as Array<{ user_id: string; deleted_at: number | null }>;
        if (existing.length > 0) {
          if (existing[0].deleted_at != null) return this.json(410, { error: 'This project has been deleted' });
          const ownerId = existing[0].user_id;
          if (ownerId !== body.userId) return this.json(403, { error: 'Project is owned by another account' });
          if (idempotencyKey) {
            this.sql.exec(
              'INSERT OR IGNORE INTO project_claim_idempotency (user_id, idempotency_key, project_id, created_at) VALUES (?, ?, ?, ?)',
              body.userId,
              idempotencyKey,
              body.projectId as string,
              now
            );
          }
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
        const adminEmails = String(this.env.ADMIN_EMAILS || '').split(',').map((e: string) => e.trim().toLowerCase()).filter(Boolean);
        const isAdminUser = adminEmails.length > 0 && (() => {
          const rows = this.sql.exec('SELECT email FROM users WHERE id = ?', body.userId as string).toArray();
          return rows.length > 0 && adminEmails.includes(String(rows[0].email).toLowerCase());
        })();
        if (!isAdminUser) {
          if (live >= MAX_PROJECTS_PER_USER && !(await this.isAdminUnlimited())) {
            return this.json(409, {
              error: `You have reached the ${MAX_PROJECTS_PER_USER}-project limit. Delete a project to create another.`,
            });
          }
          if (total >= MAX_PROJECT_ROWS_PER_USER) {
            return this.json(409, {
              error: `You have reached the project limit. Deleting projects keeps their ids reserved; contact support to reclaim them.`,
            });
          }
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
        if (idempotencyKey) {
          this.sql.exec(
            'INSERT OR IGNORE INTO project_claim_idempotency (user_id, idempotency_key, project_id, created_at) VALUES (?, ?, ?, ?)',
            body.userId,
            idempotencyKey,
            body.projectId as string,
            now
          );
        }
        return this.json(200, { projectId: body.projectId, ownerId, claimed: true });
      }

      if (path === '/projects/access' && method === 'GET') {
        const projectId = url.searchParams.get('projectId');
        const userId = url.searchParams.get('userId');
        if (!isValidProjectId(projectId)) return this.json(400, { error: 'Invalid project id' });
        const rows = this.sql.exec(
          'SELECT user_id, deleted_at, published FROM project_owners WHERE project_id = ?', projectId as string
        ).toArray() as Array<{ user_id: string; deleted_at: number | null; published: number }>;
        if (!rows.length || rows[0].deleted_at != null) return this.json(404, { error: 'Project not found' });
        return this.json(200, { owner: rows[0].user_id === userId, published: rows[0].published === 1 });
      }

      if (path === '/projects/publication' && (method === 'GET' || method === 'PUT')) {
        const body = method === 'PUT' ? await json<{ published?: boolean }>() : null;
        const projectId = url.searchParams.get('projectId');
        const userId = url.searchParams.get('userId');
        if (!isValidProjectId(projectId) || !userId) return this.json(400, { error: 'Invalid request' });
        if (method === 'PUT' && typeof body?.published !== 'boolean') return this.json(400, { error: 'Expected a published boolean' });
        const rows = this.sql.exec(
          'SELECT user_id, deleted_at, published FROM project_owners WHERE project_id = ?', projectId as string
        ).toArray() as Array<{ user_id: string; deleted_at: number | null; published: number }>;
        if (!rows.length || rows[0].deleted_at != null) return this.json(404, { error: 'Project not found' });
        if (rows[0].user_id !== userId) return this.json(403, { error: 'Not the project owner' });
        if (method === 'PUT') {
          // Gallery listings link to the live app, so only a published app can
          // stay listed. Taking an app offline removes it from the gallery; the
          // owner can list it again after republishing.
          this.sql.exec('UPDATE project_owners SET published = ?, showcase = CASE WHEN ? = 1 THEN showcase ELSE 0 END, updated_at = ? WHERE project_id = ?', body!.published ? 1 : 0, body!.published ? 1 : 0, Date.now(), projectId as string);
          this.galleryCache = null;
        }
        return this.json(200, { published: method === 'PUT' ? body!.published : rows[0].published === 1 });
      }

      // Public showcase gallery. No session: listings contain only what an owner
      // explicitly published to the gallery — never private project data.
      // Cached for 30s: the listing changes rarely, but this is the hottest
      // read path through the singleton registry DO.
      if (path === '/gallery' && method === 'GET') {
        const now = Date.now();
        if (this.galleryCache && now - this.galleryCache.timestamp < AuthRegistry.GALLERY_CACHE_TTL_MS) {
          return this.json(200, this.galleryCache.data);
        }
        const rows = this.sql.exec(
          'SELECT project_id, name, showcase_description, remix_count, showcased_at FROM project_owners WHERE showcase = 1 AND deleted_at IS NULL ORDER BY showcased_at DESC LIMIT 60'
        ).toArray() as Array<{ project_id: string; name: string; showcase_description: string; remix_count: number; showcased_at: number | null }>;
        const data = {
          apps: rows.map((row) => ({
            id: row.project_id,
            name: row.name,
            description: row.showcase_description,
            remixCount: row.remix_count,
            showcasedAt: row.showcased_at,
          })),
        };
        this.galleryCache = { data, timestamp: now };
        return this.json(200, data);
      }

      if (path === '/projects/showcase' && (method === 'GET' || method === 'PUT')) {
        const body = method === 'PUT' ? await json<{ showcase?: boolean; description?: string }>() : null;
        const projectId = url.searchParams.get('projectId');
        const userId = url.searchParams.get('userId');
        if (!isValidProjectId(projectId) || !userId) return this.json(400, { error: 'Invalid request' });
        const rows = this.sql.exec(
          'SELECT user_id, deleted_at, published, showcase, showcase_description, remix_count FROM project_owners WHERE project_id = ?', projectId as string
        ).toArray() as Array<{ user_id: string; deleted_at: number | null; published: number; showcase: number; showcase_description: string; remix_count: number }>;
        if (!rows.length || rows[0].deleted_at != null) return this.json(404, { error: 'Project not found' });
        if (rows[0].user_id !== userId) return this.json(403, { error: 'Not the project owner' });
        if (method === 'PUT') {
          if (typeof body?.showcase !== 'boolean') return this.json(400, { error: 'Expected a showcase boolean' });
          const description = typeof body.description === 'string' ? body.description.trim().slice(0, 280) : rows[0].showcase_description;
          if (body.showcase && rows[0].published !== 1) return this.json(409, { error: 'Publish your app first — the gallery links to the live app.' });
          this.sql.exec(
            'UPDATE project_owners SET showcase = ?, showcase_description = ?, showcased_at = CASE WHEN ? = 1 AND showcased_at IS NULL THEN ? ELSE showcased_at END, updated_at = ? WHERE project_id = ?',
            body.showcase ? 1 : 0, description, body.showcase ? 1 : 0, Date.now(), Date.now(), projectId as string
          );
          this.galleryCache = null;
        }
        const current = this.sql.exec('SELECT showcase, showcase_description, remix_count FROM project_owners WHERE project_id = ?', projectId as string).toArray() as Array<{ showcase: number; showcase_description: string; remix_count: number }>;
        return this.json(200, { showcase: current[0].showcase === 1, description: current[0].showcase_description, remixCount: current[0].remix_count });
      }

      // Read-only public-listing flag. The agent export endpoint authorizes remixes
      // against this instead of trusting the caller.
      if (path === '/projects/showcase-status' && method === 'GET') {
        const projectId = url.searchParams.get('projectId');
        if (!isValidProjectId(projectId)) return this.json(400, { error: 'Invalid request' });
        const rows = this.sql.exec('SELECT showcase FROM project_owners WHERE project_id = ? AND deleted_at IS NULL', projectId as string).toArray() as Array<{ showcase: number }>;
        return this.json(200, { showcase: rows.length > 0 && rows[0].showcase === 1 });
      }

      // Remix: atomically create the caller's copy and count it on the source.
      // Files are copied by the Worker between the two project agents afterwards.
      if (path === '/projects/remix' && method === 'POST') {
        const body = await json<{ userId?: string; sourceProjectId?: string }>();
        if (!body || !body.userId || !isValidProjectId(body.sourceProjectId)) return this.json(400, { error: 'Invalid request' });
        const source = this.sql.exec(
          'SELECT user_id, name, showcase FROM project_owners WHERE project_id = ? AND deleted_at IS NULL', body.sourceProjectId as string
        ).toArray() as Array<{ user_id: string; name: string; showcase: number }>;
        if (!source.length || source[0].showcase !== 1) return this.json(404, { error: 'This app is not listed in the gallery' });
        const live = Number(this.sql.exec('SELECT COUNT(*) AS total FROM project_owners WHERE user_id = ? AND deleted_at IS NULL', body.userId).toArray()[0]?.total || 0);
        if (live >= MAX_PROJECTS_PER_USER && !(await this.isAdminUnlimited())) return this.json(409, { error: 'You have reached the project limit. Delete a project to make room.' });
        const total = Number(this.sql.exec('SELECT COUNT(*) AS total FROM project_owners WHERE user_id = ?', body.userId).toArray()[0]?.total || 0);
        if (total >= MAX_PROJECT_ROWS_PER_USER) {
          return this.json(409, {
            error: 'You have reached the project limit. Deleting projects keeps their ids reserved; contact support to reclaim them.',
          });
        }
        const projectId = crypto.randomUUID();
        const name = `${source[0].name.replace(/ \(remix\)$/u, '').slice(0, 112)} (remix)`;
        const now = Date.now();
        this.sql.exec(
          'INSERT INTO project_owners (project_id, user_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
          projectId, body.userId, name, now, now
        );
        this.sql.exec('UPDATE project_owners SET remix_count = remix_count + 1 WHERE project_id = ?', body.sourceProjectId as string);
        this.galleryCache = null;
        return this.json(201, { projectId, name });
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
        if (userId) { try { new ProductOutcomes(this.state.storage).activity(userId); } catch { console.warn('Workspace activity measurement unavailable'); } }
        if (!userId) return this.json(400, { error: 'Missing userId' });
        // The hosted-slot sweep builds its keep-set from this endpoint and
        // must see every live project (up to MAX_PROJECT_ROWS_PER_USER=200
        // lifetime rows). Clamping at 100 would silently drop the oldest
        // projects from `keep` and their slots would be swept while live.
        const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit') || 100)));
        const rows = this.sql
          .exec(
            'SELECT project_id, user_id, name, created_at, updated_at, published FROM project_owners WHERE user_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT ?',
            userId,
            limit
          )
          .toArray() as Array<{
            project_id: string;
            user_id: string;
            name: string;
            created_at: number;
            updated_at: number;
            published: number;
          }>;
        return this.json(200, {
          projects: rows.map((r) => ({
            id: r.project_id,
            name: r.name,
            createdAt: r.created_at,
            updatedAt: r.updated_at,
            published: r.published === 1,
          })),
        });
      }

      if (path.startsWith('/projects/') && method === 'PATCH') {
        const projectId = safeDecode(path.slice('/projects/'.length)) ?? '';
        const body = await json<{ userId?: string; name?: string }>();
        if (!isValidProjectId(projectId) || !body?.userId) return this.json(400, { error: 'Invalid request' });
        if (typeof body.name !== 'string' || !body.name.trim()) return this.json(400, { error: 'Invalid name' });
        const name = body.name.trim().slice(0, 120);
        const rows = this.sql
          .exec('SELECT user_id FROM project_owners WHERE project_id = ? AND deleted_at IS NULL', projectId as string)
          .toArray() as Array<{ user_id: string }>;
        if (rows.length === 0 || rows[0].user_id !== body.userId)
          return this.json(403, { error: 'Not the project owner' });
        this.sql.exec(
          'UPDATE project_owners SET name = ?, updated_at = ? WHERE project_id = ?',
          name,
          Date.now(),
          projectId as string
        );
        this.galleryCache = null; // a renamed showcase app must not show its old name
        return this.json(200, { ok: true });
      }

      if (path.startsWith('/projects/') && method === 'DELETE') {
        const projectId = safeDecode(path.slice('/projects/'.length)) ?? '';
        const userId = url.searchParams.get('userId');
        if (!isValidProjectId(projectId) || !userId) return this.json(400, { error: 'Invalid request' });
        const rows = this.sql
          .exec('SELECT user_id, deleted_at FROM project_owners WHERE project_id = ?', projectId as string)
          .toArray() as Array<{ user_id: string; deleted_at: number | null }>;
        if (rows.length && rows[0].user_id !== userId) return this.json(403, { error: 'Not the project owner' });
        // L11: a never-claimed id has no owner — nothing to delete on the server.
        // Return 200 (no tombstone created) so the client can clean up localStorage
        // without a console error. Idempotent: deleting a ghost project is a no-op.
        if (!rows.length) return this.json(200, { ok: true });
        const cleanup = this.cleanup();
        await this.state.storage.setAlarm(Date.now() + 100);
        // Persist the retry intent and the access tombstone as one transaction.
        this.state.storage.transactionSync(() => {
          this.sql.exec("UPDATE project_owners SET deleted_at = ?, published = 0, name = 'Deleted project' WHERE project_id = ?", Date.now(), projectId as string);
          cleanup.enqueue(projectId, userId);
        });
        this.galleryCache = null;
        await cleanup.schedule();
        // Free the hosted-project slot right away, not when the async cleanup
        // queue gets to it. Without this, the pilot keeps counting the deleted
        // project until the queue runs — and a slow or stuck queue leaves the
        // user blocked by the hosted-project limit with an empty dashboard.
        // Best-effort: the queued cleanup unregisters again (a no-op) if this fails.
        try {
          if (this.env.RUNTIME) {
            const slot = await this.env.RUNTIME.fetch(new Request('https://runtime/unregister', {
              method: 'POST',
              headers: { 'x-bh-project': projectId, 'x-bh-owner': userId },
            }));
            if (!slot.ok) console.error('Pilot slot release failed:', slot.status);
          }
        } catch (err) {
          console.error('Pilot slot release failed:', err);
        }
        return this.json(202, { ok: true, cleanup: 'pending', message: 'Access revoked. Storage cleanup is queued and retried automatically.' });
      }

      return this.json(404, { error: 'Not found' });
    } catch (err: any) {
      if (err instanceof AiBudgetError) return this.json(err.status, { error: err.message, kind: err.kind });
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
