/**
 * Versioned schema migrations for a Durable Object's SQLite storage.
 *
 * Migrations apply in order, each inside its own transaction and each recorded
 * in `schema_version`, so a restarted object never re-runs one. Version 1 uses
 * IF NOT EXISTS so objects that predate this framework — whose tables were
 * created by the old ad-hoc ensureSchema() — adopt v1 without a data copy.
 */

export interface Migration {
  version: number;
  name: string;
  /** Plain-text statements, run in order inside one transaction. */
  statements: string[];
}

/**
 * The agent object's tables. DDL is kept byte-compatible with the pre-Phase-5
 * schema so an existing workspace is migrated rather than rebuilt.
 */
export const AGENT_MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'messages_and_project_files',
    statements: [
      `CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS project_files (
        path TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
    ],
  },
  {
    version: 2,
    name: 'indexes_for_history_and_files',
    statements: [
      // project_files.path is the PRIMARY KEY and so already indexed; this
      // covering index lets the file-listing path read path+content from the
      // index without touching table pages.
      `CREATE INDEX IF NOT EXISTS idx_project_files_listing
         ON project_files(path, updated_at)`,
      // History is read in id order; this index lets the LIMIT-window reads
      // (pagination, recent-context trimming) stop early instead of scanning
      // the whole table.
      `CREATE INDEX IF NOT EXISTS idx_messages_recent
         ON messages(id DESC, role, content)`,
    ],
  },
];

/**
 * The auth registry's tables, including the TTL sweep support added in Phase 5.
 */
export const REGISTRY_MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'users_sessions_project_owners',
    statements: [
      `CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`,
      `CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)`,
      `CREATE TABLE IF NOT EXISTS project_owners (
        project_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL DEFAULT 'Untitled Project',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_project_owners_user
         ON project_owners(user_id, updated_at DESC)`,
    ],
  },
  {
    version: 2,
    name: 'session_ttl_sweep',
    statements: [
      // The TTL sweep deletes by expiry; without this every sweep is a full
      // table scan on a table that grows one row per login.
      `CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at)`,
    ],
  },
];

/**
 * Runs every migration the storage has not yet recorded.
 *
 * `query` returns rows for a SELECT and must tolerate DDL returning none.
 * `inTransaction` wraps a batch so a migration that fails partway rolls back and
 * leaves its version unrecorded — the next run retries it rather than silently
 * skipping the half that failed.
 *
 * Returns the number of migrations it applied.
 */
export function runMigrations(
  migrations: Migration[],
  query: (statement: string) => Array<Record<string, unknown>>,
  inTransaction: <R>(closure: () => R) => R
): number {
  query(`CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    applied_at INTEGER NOT NULL
  )`);

  const appliedVersion = new Set(
    query(`SELECT version FROM schema_version`).map(r => Number(r.version))
  );

  let applied = 0;
  for (const migration of migrations) {
    if (appliedVersion.has(migration.version)) continue;
    inTransaction(() => {
      for (const statement of migration.statements) query(statement);
      query(
        `INSERT INTO schema_version (version, applied_at) VALUES (${migration.version}, ${Date.now()})`
      );
      applied++;
      return undefined;
    });
  }
  return applied;
}
