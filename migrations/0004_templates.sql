-- ---------------------------------------------------------------------------
-- 0004_templates: user-saved extraction templates / presets.
--
-- Users create reusable extraction schemas (e.g. "Utility Bill", "Medical
-- Form") with a base mode and optional custom prompt, so they can start a
-- batch with a single click instead of re-typing instructions.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS extraction_templates (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- Display name chosen by the user, e.g. "Monthly Utility Bill"
  name        TEXT NOT NULL,
  -- Base extraction mode: invoice, receipt, fulltext, keyvalue, table, custom, etc.
  base_mode   TEXT NOT NULL DEFAULT 'custom',
  -- Optional free-form extraction instructions (used when base_mode is 'custom'
  -- or to augment a built-in preset).
  prompt      TEXT,
  -- Informational: what this template is meant to extract.
  description TEXT,
  -- Comma-separated expected field names, for UI display.
  expected_fields TEXT,
  -- How many times this template has been used to create a batch.
  use_count   INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_templates_user
  ON extraction_templates (user_id, updated_at DESC);
