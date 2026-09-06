-- ---------------------------------------------------------------------------
-- 0009_system_settings: platform configuration editable by administrators.
--
-- Stores system-wide configuration overrides (active models, tier preferences,
-- fallback providers) so administrators can switch engines and models from
-- the admin console without needing to redeploy or edit environment variables.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS system_settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Seed defaults so Bedrock vision and High-accuracy tiers are immediately configured
INSERT OR IGNORE INTO system_settings (key, value) VALUES ('AWS_BEDROCK_MODEL', 'amazon.nova-lite-v1:0');
INSERT OR IGNORE INTO system_settings (key, value) VALUES ('DEFAULT_TIER_PROVIDER', 'bedrock');
INSERT OR IGNORE INTO system_settings (key, value) VALUES ('DEFAULT_HUNYUAN_MODEL', 'hunyuan-ocr');
INSERT OR IGNORE INTO system_settings (key, value) VALUES ('HIGH_ACCURACY_PROVIDER', 'bedrock');
INSERT OR IGNORE INTO system_settings (key, value) VALUES ('DEFAULT_OPENAI_MODEL', 'gpt-4o-mini');
