-- ---------------------------------------------------------------------------
-- 0008_document_lifecycle: make a stuck document findable and recoverable.
--
-- A document moved to 'processing' and then nothing else. If the queue consumer
-- was evicted mid-flight, or the browser tab driving the synchronous path was
-- closed, the row stayed 'processing' for ever: refreshBatchStatus() reads
-- 'processing' as "still working", so the batch never reached a terminal state,
-- the UI polled indefinitely, and the redelivery guard in the worker returned
-- early on the very status it needed to reclaim.
--
-- Nothing recorded WHEN processing started, so "has this been running too long?"
-- was not a question the schema could answer. `started_at` answers it and
-- `attempts` bounds the recovery, so a document that fails the same way every
-- time ends up 'failed' with a reason instead of cycling for ever.
-- ---------------------------------------------------------------------------

ALTER TABLE documents ADD COLUMN started_at TEXT;
ALTER TABLE documents ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;

-- Drives the stuck-document sweep in server/stuck-documents.ts, which selects on
-- exactly this pair.
CREATE INDEX IF NOT EXISTS idx_documents_status_started
  ON documents (status, started_at);
