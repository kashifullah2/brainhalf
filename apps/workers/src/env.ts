export interface Env {
  DB: D1Database;
  KV: KVNamespace;
  ASSETS_BUCKET: R2Bucket;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL?: string;
  CEREBRAS_API_KEY?: string;
  AGENT_ROUTER_API_KEY?: string;
  OPENPROVIDER_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  /** FreeModel API key (local dev: apps/workers/.dev.vars) */
  FREEMODEL_API_KEY?: string;
  /** @deprecated use FREEMODEL_API_KEY — kept for older .dev.vars files */
  FREEMODEL_API?: string;
  /** Default: https://cc.freemodel.dev/v1 */
  FREEMODEL_BASE_URL?: string;
  /** Default: claude-sonnet-4-6 */
  FREEMODEL_DEFAULT_MODEL?: string;
  GROQ_API_KEY?: string;
  /** Default: https://api.groq.com/openai/v1 */
  GROQ_BASE_URL?: string;
  /** Default: openai/gpt-oss-120b */
  GROQ_DEFAULT_MODEL?: string;
  GOOGLE_API_KEY?: string;
  /** Default: https://generativelanguage.googleapis.com/v1beta/openai */
  GOOGLE_BASE_URL?: string;
  /** Default: gemini-2.0-flash */
  GOOGLE_DEFAULT_MODEL?: string;
  /** Cloudflare API token with Workers AI permissions */
  CLOUDFLARE_AI_API_TOKEN?: string;
  /**
   * Cloudflare OpenAI-compatible Workers AI base URL:
   * https://api.cloudflare.com/client/v4/accounts/<account_id>/ai/v1
   */
  CLOUDFLARE_AI_BASE_URL?: string;
  /** Default: @cf/qwen/qwen2.5-coder-32b-instruct */
  CLOUDFLARE_AI_DEFAULT_MODEL?: string;
  /** Optional override: Cerebras | FreeModel | Groq | Gemini | … */
  DEFAULT_AI_PROVIDER?: string;
  /** Fallback when primary fails (default: FreeModel if Cerebras is primary, and vice versa) */
  DEFAULT_AI_PROVIDER_FALLBACK?: string;
  POLY_PIZZA_API_KEY?: string;
  HUGGINGFACE_API_KEY?: string;
}
