export const OAUTH_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS oauth_identities (provider TEXT NOT NULL, subject TEXT NOT NULL, user_id TEXT NOT NULL, PRIMARY KEY (provider, subject))`,
  `CREATE TABLE IF NOT EXISTS oauth_flows (key_hash TEXT PRIMARY KEY, kind TEXT NOT NULL, data TEXT NOT NULL, expires_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_oauth_flows_expires ON oauth_flows(expires_at)`,
];
