-- ---------------------------------------------------------------------------
-- 0005_batch_prompt: store custom prompts on the batch.
--
-- When a user selects the "custom" preset or a Saved Template, the custom
-- extraction instructions must be saved on the batch so that later document
-- additions (via "Upload More") can use the exact same extraction schema.
-- ---------------------------------------------------------------------------

ALTER TABLE batches ADD COLUMN prompt TEXT;
