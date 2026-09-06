import { json, fail, readJson, type AppEnv } from '../../../server/http';
import { authHeaders } from '../../../server/guard';
import { requireAdmin } from '../../../server/admin';
import {
  getSystemSettings,
  setSystemSettings,
  KNOWN_BEDROCK_MODELS,
  KNOWN_HUNYUAN_MODELS,
  KNOWN_OPENAI_MODELS,
  maskApiKey,
} from '../../../server/system-settings';

export const onRequestGet: PagesFunction<AppEnv> = async ({ request, env }) => {
  const auth = await requireAdmin(request, env);
  if (auth instanceof Response) return auth;

  const settings = await getSystemSettings(env.DB);
  const awsConfigured = Boolean(env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY);
  const hunyuanConfigured = Boolean(env.HUNYUAN_API_KEY);
  const openaiConfigured = Boolean(
    settings.OPENAI_API_KEY || env.OPENAI_API_KEY || env.OCR_API_KEY,
  );

  const currentSettings = {
    defaultTierProvider:
      settings.DEFAULT_TIER_PROVIDER ||
      (hunyuanConfigured ? 'hunyuan' : awsConfigured ? 'bedrock' : 'openai'),
    hunyuanModel: settings.HUNYUAN_MODEL || env.HUNYUAN_MODEL || 'hunyuan-ocr',
    highAccuracyProvider:
      settings.HIGH_ACCURACY_PROVIDER || (awsConfigured ? 'bedrock' : 'openai'),
    bedrockModel:
      settings.AWS_BEDROCK_MODEL || env.AWS_BEDROCK_MODEL || 'amazon.nova-lite-v1:0',
    openaiModel: settings.OPENAI_MODEL || env.OPENAI_MODEL || 'gpt-4o-mini',
    openaiApiKeyMasked: maskApiKey(
      settings.OPENAI_API_KEY || env.OPENAI_API_KEY || env.OCR_API_KEY,
    ),
    providersStatus: {
      hunyuan: hunyuanConfigured,
      bedrock: awsConfigured,
      openai: openaiConfigured,
    },
  };

  return json(
    {
      settings: currentSettings,
      availableModels: {
        hunyuan: KNOWN_HUNYUAN_MODELS,
        bedrock: KNOWN_BEDROCK_MODELS,
        openai: KNOWN_OPENAI_MODELS,
      },
    },
    200,
    authHeaders(auth),
  );
};

export const onRequestPatch: PagesFunction<AppEnv> = async ({ request, env }) => {
  const auth = await requireAdmin(request, env);
  if (auth instanceof Response) return auth;

  const body = await readJson<Record<string, unknown>>(request);
  if (!body || typeof body !== 'object') {
    return fail('A JSON body is required.', 400);
  }

  const updates: Record<string, string | null> = {};

  if ('defaultTierProvider' in body) {
    const val = String(body.defaultTierProvider).trim().toLowerCase();
    if (['hunyuan', 'bedrock', 'openai'].includes(val)) {
      updates.DEFAULT_TIER_PROVIDER = val;
    }
  }

  if ('hunyuanModel' in body) {
    const val = String(body.hunyuanModel).trim();
    if (val) updates.HUNYUAN_MODEL = val;
  }

  if ('highAccuracyProvider' in body) {
    const val = String(body.highAccuracyProvider).trim().toLowerCase();
    if (['bedrock', 'openai'].includes(val)) {
      updates.HIGH_ACCURACY_PROVIDER = val;
    }
  }

  if ('bedrockModel' in body) {
    const val = String(body.bedrockModel).trim();
    if (val) updates.AWS_BEDROCK_MODEL = val;
  }

  if ('openaiModel' in body) {
    const val = String(body.openaiModel).trim();
    if (val) updates.OPENAI_MODEL = val;
  }

  if ('openaiApiKey' in body) {
    const val = String(body.openaiApiKey).trim();
    if (val === '') {
      updates.OPENAI_API_KEY = null; // unset
    } else if (val && !val.includes('••••')) {
      updates.OPENAI_API_KEY = val;
    }
  }

  await setSystemSettings(env.DB, updates);

  const updatedSettings = await getSystemSettings(env.DB);
  const awsConfigured = Boolean(env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY);
  const hunyuanConfigured = Boolean(env.HUNYUAN_API_KEY);
  const openaiConfigured = Boolean(
    updatedSettings.OPENAI_API_KEY || env.OPENAI_API_KEY || env.OCR_API_KEY,
  );

  return json(
    {
      success: true,
      settings: {
        defaultTierProvider:
          updatedSettings.DEFAULT_TIER_PROVIDER ||
          (hunyuanConfigured ? 'hunyuan' : awsConfigured ? 'bedrock' : 'openai'),
        hunyuanModel:
          updatedSettings.HUNYUAN_MODEL || env.HUNYUAN_MODEL || 'hunyuan-ocr',
        highAccuracyProvider:
          updatedSettings.HIGH_ACCURACY_PROVIDER ||
          (awsConfigured ? 'bedrock' : 'openai'),
        bedrockModel:
          updatedSettings.AWS_BEDROCK_MODEL ||
          env.AWS_BEDROCK_MODEL ||
          'amazon.nova-lite-v1:0',
        openaiModel: updatedSettings.OPENAI_MODEL || env.OPENAI_MODEL || 'gpt-4o-mini',
        openaiApiKeyMasked: maskApiKey(
          updatedSettings.OPENAI_API_KEY || env.OPENAI_API_KEY || env.OCR_API_KEY,
        ),
        providersStatus: {
          hunyuan: hunyuanConfigured,
          bedrock: awsConfigured,
          openai: openaiConfigured,
        },
      },
    },
    200,
    authHeaders(auth),
  );
};
