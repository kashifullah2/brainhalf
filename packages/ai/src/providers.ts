export type ProviderType = 'Cerebras' | 'AgentRouter' | 'OpenProvider' | 'FreeModel' | 'Groq' | 'Gemini' | 'Cloudflare';

export const FREEMODEL_DEFAULT_BASE_URL = 'https://cc.freemodel.dev/v1';
/** @deprecated FreeModel no longer serves gpt-5.5 — kept for migration shims */
export const FREEMODEL_LEGACY_MODEL = 'gpt-5.5';
export const FREEMODEL_DEFAULT_MODEL = 'claude-sonnet-4-6';

export const FREEMODEL_MODELS = {
  fast: 'claude-haiku-4-5-20251001',
  standard: 'claude-sonnet-4-6',
  powerful: 'claude-opus-4-7',
} as const;

export const GROQ_DEFAULT_BASE_URL = 'https://api.groq.com/openai/v1';
export const GROQ_DEFAULT_MODEL = 'openai/gpt-oss-120b';

/** Google Gemini OpenAI-compatible endpoint */
export const GEMINI_DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai';
export const GEMINI_DEFAULT_MODEL = 'gemini-2.0-flash';

/**
 * Cloudflare Workers AI OpenAI-compatible endpoint.
 * Set CLOUDFLARE_AI_BASE_URL to:
 * https://api.cloudflare.com/client/v4/accounts/<account_id>/ai/v1
 */
export const CLOUDFLARE_DEFAULT_BASE_URL = 'https://api.cloudflare.com/client/v4/accounts';
export const CLOUDFLARE_DEFAULT_MODEL = '@cf/qwen/qwen2.5-coder-32b-instruct';

export type ProviderConfig = {
  provider: ProviderType;
  apiKey: string;
  baseUrl?: string;
  modelOverride?: string;
};

export type TaskComplexity = 'simple_2d' | 'standard_3d' | 'complex_physics';

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCost: number;
}

export class ProviderManager {
  private config: ProviderConfig;

  constructor(userConfig: ProviderConfig) {
    this.config = userConfig;
  }

  public selectBestModel(complexity: TaskComplexity): string {
    if (this.config.modelOverride) return this.config.modelOverride;

    switch (this.config.provider) {
      case 'Cerebras':
        if (complexity === 'simple_2d') return 'zai-glm-4.7';
        return 'gpt-oss-120b';

      case 'AgentRouter':
        if (complexity === 'simple_2d') return 'glm-5.1';
        return 'deepseek-v4-pro';

      case 'OpenProvider':
        return 'openprovider/auto-free';

      case 'FreeModel':
        if (complexity === 'simple_2d') return FREEMODEL_MODELS.fast;
        if (complexity === 'complex_physics') return FREEMODEL_MODELS.powerful;
        return FREEMODEL_MODELS.standard;

      case 'Groq':
        return GROQ_DEFAULT_MODEL;

      case 'Gemini':
        return GEMINI_DEFAULT_MODEL;

      case 'Cloudflare':
        return CLOUDFLARE_DEFAULT_MODEL;

      default:
        return 'gpt-oss-120b'; // Absolute fallback
    }
  }

  public calculateCost(model: string, promptTokens: number, completionTokens: number): number {
    const rates: Record<string, { prompt: number, completion: number }> = {
      'gpt-oss-120b': { prompt: 0.00014, completion: 0.00028 },
      'openai/gpt-oss-120b': { prompt: 0.00014, completion: 0.00028 },
      'zai-glm-4.7': { prompt: 0.0001, completion: 0.0002 },
      'glm-5.1': { prompt: 0.00015, completion: 0.0003 },
      'deepseek-v4-pro': { prompt: 0.00025, completion: 0.0005 },
      'claude-sonnet-4-6': { prompt: 0.0, completion: 0.0 },
      'claude-haiku-4-5-20251001': { prompt: 0.0, completion: 0.0 },
      'claude-opus-4-7': { prompt: 0.0, completion: 0.0 },
      'gemini-2.0-flash': { prompt: 0.0, completion: 0.0 },
      'gemini-2.5-pro-preview-05-06': { prompt: 0.0, completion: 0.0 },
      '@cf/qwen/qwen2.5-coder-32b-instruct': { prompt: 0.0, completion: 0.0 },
    };

    const rate = rates[model] || { prompt: 0.0, completion: 0.0 };
    return (promptTokens / 1000) * rate.prompt + (completionTokens / 1000) * rate.completion;
  }

  public getConfig() {
    return this.config;
  }
}
