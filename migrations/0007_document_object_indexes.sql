-- ---------------------------------------------------------------------------
-- 0007_document_object_indexes: add missing indexes on documents(object_path)
-- 
-- Resolves an N+1 query issue where fetching dashboard thumbnails scans
-- the entire documents table because there is no index covering object_path.
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_documents_object_path 
  ON documents (object_path);

CREATE INDEX IF NOT EXISTS idx_documents_user_object 
  ON documents (user_id, object_path);
