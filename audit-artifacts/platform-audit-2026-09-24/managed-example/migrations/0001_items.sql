CREATE TABLE IF NOT EXISTS items (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 200), created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS items_owner ON items(user_id,created_at);
