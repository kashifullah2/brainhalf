-- ---------------------------------------------------------------------------
-- 0003_rate_limits: fixed-window request counters.
--
-- The counter lives in the database rather than in memory because Pages
-- Functions are stateless and consecutive requests may land on different
-- isolates: an in-process counter would reset constantly and enforce nothing.
--
-- One row per (bucket, window). `bucket` is "<route>:<identity>", so limits are
-- independent per endpoint -- hammering /api/ocr cannot lock anyone out of
-- signing in.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS rate_limits (
  bucket       TEXT NOT NULL,
  -- Unix epoch seconds of the window start, so a window is identified by
  -- arithmetic instead of by parsing a timestamp.
  window_start INTEGER NOT NULL,
  count        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, window_start)
);

-- Lets the opportunistic prune in server/rate-limit.ts drop rolled-past windows
-- without scanning the table.
CREATE INDEX IF NOT EXISTS idx_rate_limits_window ON rate_limits (window_start);
