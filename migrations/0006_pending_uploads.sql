-- ---------------------------------------------------------------------------
-- 0006_pending_uploads: make an uploaded-but-unclaimed file findable.
--
-- /api/storage/upload writes the bytes to R2 and hands the key back to the
-- browser, and the row that references that key is only created later, when the
-- batch is. Anything that happens in between -- the user closes the tab, the
-- batch request fails, they change their mind on the review step -- leaves an
-- object in the bucket that nothing points at and nothing will ever look for. It
-- is billed forever and cannot be found again, because the only record of the key
-- was the HTTP response.
--
-- One row per upload, deleted the moment a document claims the key. Whatever is
-- still here after the grace period is genuinely unreferenced, and the sweep in
-- server/storage-sweep.ts collects it.
--
-- Rows cascade with the user, so deleting an account cannot leave entries behind
-- pointing at objects that were removed with it.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS pending_uploads (
  object_path TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- The sweep selects by age, so that is what the index covers.
CREATE INDEX IF NOT EXISTS idx_pending_uploads_created
  ON pending_uploads (created_at);
