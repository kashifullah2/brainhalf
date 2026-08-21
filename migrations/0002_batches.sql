-- ---------------------------------------------------------------------------
-- 0002_batches: the data the app previously kept only in the browser.
--
-- Everything is scoped to user_id. Before this migration all batches lived in
-- one IndexedDB store with no owner, so "multi-user" was not enforceable.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS batches (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- queued | processing | completed | partial | failed
  status      TEXT NOT NULL DEFAULT 'queued',
  -- Extraction preset: invoice | receipt | fulltext | keyvalue | table
  engine_type TEXT NOT NULL DEFAULT 'invoice',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_batches_user_created
  ON batches (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS documents (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id      INTEGER NOT NULL REFERENCES batches (id) ON DELETE CASCADE,
  -- Denormalised so document-level queries can filter by owner without a join.
  user_id       TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- Position within the batch, 0-based. Drives display order.
  position      INTEGER NOT NULL DEFAULT 0,
  filename      TEXT NOT NULL,
  content_type  TEXT NOT NULL DEFAULT 'application/octet-stream',
  -- R2 object key. NULL when the file could not be stored.
  object_path   TEXT,
  size_bytes    INTEGER,
  -- SHA-256 of the file bytes, for duplicate detection.
  content_hash  TEXT,
  -- queued | processing | completed | failed
  status        TEXT NOT NULL DEFAULT 'queued',
  error         TEXT,
  ocr_text      TEXT,
  overall_confidence REAL,
  is_duplicate  INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at  TEXT
);

CREATE INDEX IF NOT EXISTS idx_documents_batch ON documents (batch_id, position);
CREATE INDEX IF NOT EXISTS idx_documents_user_hash ON documents (user_id, content_hash);

-- One row per extracted field. Kept relational rather than as a JSON blob so
-- the review queue can filter on confidence in SQL.
CREATE TABLE IF NOT EXISTS document_fields (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id       INTEGER NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  user_id           TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  position          INTEGER NOT NULL DEFAULT 0,
  normalized_field  TEXT NOT NULL,
  original_label    TEXT NOT NULL DEFAULT '',
  value             TEXT NOT NULL DEFAULT '',
  -- NULL until a human edits the value; the original is never overwritten.
  edited_value      TEXT,
  confidence        REAL NOT NULL DEFAULT 0,
  -- approved | corrected | rejected, set from the review queue.
  review_status     TEXT,
  reviewed_at       TEXT,
  UNIQUE (document_id, normalized_field)
);

CREATE INDEX IF NOT EXISTS idx_fields_document ON document_fields (document_id, position);
CREATE INDEX IF NOT EXISTS idx_fields_review
  ON document_fields (user_id, confidence, review_status);

-- Per-user preferences that were previously in localforage, so they follow the
-- account across devices.
CREATE TABLE IF NOT EXISTS user_settings (
  user_id              TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  confidence_threshold REAL NOT NULL DEFAULT 0.80,
  updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
);
