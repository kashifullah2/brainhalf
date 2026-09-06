import type { OcrProviderEnv } from './ocr-provider';

export interface SystemSettings {
  AWS_BEDROCK_MODEL?: string;
  DEFAULT_TIER_PROVIDER?: 'hunyuan' | 'bedrock' | 'openai';
  HUNYUAN_MODEL?: string;
  HIGH_ACCURACY_PROVIDER?: 'bedrock' | 'openai';
  OPENAI_MODEL?: string;
  OPENAI_API_KEY?: string;
  [key: string]: string | undefined;
}

export const KNOWN_BEDROCK_MODELS = [
  // Amazon Nova — fast multimodal vision & multilingual
  'amazon.nova-lite-v1:0',
  'amazon.nova-pro-v1:0',
  // Anthropic Claude 3 family (deep comprehension & handwriting)
  'anthropic.claude-3-haiku-20240307-v1:0',
  'anthropic.claude-3-sonnet-20240229-v1:0',
  'anthropic.claude-3-opus-20240229-v1:0',
  // Anthropic Claude 3.5 family (high precision vision & document OCR)
  'anthropic.claude-3-5-haiku-20241022-v1:0',
  'anthropic.claude-3-5-sonnet-20240620-v1:0',
  'anthropic.claude-3-5-sonnet-20241022-v2:0',
  // Anthropic Claude 3.7 family (state-of-the-art vision reasoning, handwriting & multilingual)
  'anthropic.claude-3-7-sonnet-20250219-v1:0',
  // Anthropic Claude 4 family (next-gen)
  'anthropic.claude-sonnet-4-20250514-v1:0',
  'anthropic.claude-opus-4-20250514-v1:0',
  // Meta Llama 3.2 Vision
  'meta.llama3-2-11b-instruct-v1:0',
  'meta.llama3-2-90b-instruct-v1:0',
  // Mistral Pixtral Vision
  'mistral.pixtral-12b-2409-v1:0',
] as const;

export const KNOWN_HUNYUAN_MODELS = [
  'hunyuan-ocr',
  'hunyuan-standard',
  'hunyuan-turbo',
] as const;

export const KNOWN_OPENAI_MODELS = [
  'gpt-4o-mini',
  'gpt-4o',
  'o3-mini',
] as const;

/**
 * Loads all key-value overrides from the system_settings table.
 * Returns an empty record if the table does not exist or database is unavailable.
 */
export async function getSystemSettings(db?: D1Database): Promise<SystemSettings> {
  if (!db) return {};
  try {
    const { results } = await db
      .prepare('SELECT key, value FROM system_settings')
      .all<{ key: string; value: string }>();
    if (!results || !Array.isArray(results)) return {};

    const settings: SystemSettings = {};
    for (const row of results) {
      if (row?.key && typeof row.value === 'string') {
        settings[row.key] = row.value;
      }
    }
    return settings;
  } catch {
    // If migration has not run yet or DB query fails, fall back to empty settings
    return {};
  }
}

/**
 * Persists updates to the system_settings table.
 */
export async function setSystemSettings(
  db: D1Database,
  entries: Record<string, string | null | undefined>,
): Promise<void> {
  const statements: D1PreparedStatement[] = [];

  for (const [key, value] of Object.entries(entries)) {
    if (!key) continue;
    if (value === null || value === undefined || value === '') {
      statements.push(db.prepare('DELETE FROM system_settings WHERE key = ?').bind(key));
    } else {
      statements.push(
        db
          .prepare(
            `INSERT INTO system_settings (key, value, updated_at)
             VALUES (?, ?, datetime('now'))
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
          )
          .bind(key, value.trim()),
      );
    }
  }

  if (statements.length > 0) {
    await db.batch(statements);
  }
}

/**
 * Merges system settings overrides onto an AppEnv / OcrProviderEnv.
 */
export async function getMergedOcrEnv<T extends OcrProviderEnv & { DB?: D1Database }>(
  env: T,
  settingsOverride?: SystemSettings,
): Promise<T> {
  const settings = settingsOverride ?? (await getSystemSettings(env.DB));

  const bedrockModel =
    settings.AWS_BEDROCK_MODEL || env.AWS_BEDROCK_MODEL || 'amazon.nova-lite-v1:0';
  const hunyuanModel = settings.HUNYUAN_MODEL || env.HUNYUAN_MODEL;
  const openaiModel = settings.OPENAI_MODEL || env.OPENAI_MODEL;
  const openaiKey = settings.OPENAI_API_KEY || env.OPENAI_API_KEY || env.OCR_API_KEY;

  return {
    ...env,
    AWS_BEDROCK_MODEL: bedrockModel,
    HUNYUAN_MODEL: hunyuanModel,
    OPENAI_MODEL: openaiModel,
    OPENAI_API_KEY: openaiKey,
    DEFAULT_TIER_PROVIDER: settings.DEFAULT_TIER_PROVIDER ?? env.DEFAULT_TIER_PROVIDER,
    HIGH_ACCURACY_PROVIDER: settings.HIGH_ACCURACY_PROVIDER ?? env.HIGH_ACCURACY_PROVIDER,
  };
}

/**
 * Mask an API key so it can be safely displayed in the admin UI without leaking.
 */
export function maskApiKey(key: string | undefined | null): string | null {
  if (!key) return null;
  const trimmed = key.trim();
  if (trimmed.length <= 8) return '••••••••';
  return `${trimmed.slice(0, 4)}••••••••${trimmed.slice(-4)}`;
}
