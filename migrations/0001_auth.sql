-- ---------------------------------------------------------------------------
-- 0001_auth: users, sessions, password reset tokens.
--
-- Replaces the previous "auth" model, which was a JSON blob in localStorage
-- that the browser could write freely.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS users (
  id              TEXT PRIMARY KEY,
  -- Stored lowercased and trimmed; uniqueness is enforced on this column.
  email           TEXT NOT NULL UNIQUE,
  -- NULL for accounts that only ever sign in with Google.
  password_hash   TEXT,
  first_name      TEXT NOT NULL DEFAULT '',
  last_name       TEXT NOT NULL DEFAULT '',
  picture_url     TEXT,
  -- Google's stable subject identifier ('sub'), when the account is linked.
  google_sub      TEXT UNIQUE,
  email_verified  INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at   TEXT
);

CREATE INDEX IF NOT EXISTS idx_users_google_sub ON users (google_sub);

-- Sessions. The cookie carries a random token; only its SHA-256 hash is stored,
-- so a database leak does not hand out live sessions.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at  TEXT NOT NULL,
  user_agent  TEXT,
  ip          TEXT
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions (expires_at);

-- Single-use password reset tokens. Same hash-not-the-secret rule as sessions.
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  token_hash  TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at  TEXT NOT NULL,
  used_at     TEXT
);

CREATE INDEX IF NOT EXISTS idx_reset_tokens_user_id ON password_reset_tokens (user_id);
