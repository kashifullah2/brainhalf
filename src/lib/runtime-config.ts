export const MIN_SESSION_SECRET_LENGTH = 32;

export function validSessionSecret(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length >= MIN_SESSION_SECRET_LENGTH;
}

export const PROVIDER_CREDENTIALS = {
  anthropic: [['ANTHROPIC_API_KEY']],
  aws: [
    ['BEDROCK_API_KEY'], ['AWS_BEARER_TOKEN_BEDROCK'], ['AWS_API_KEY'],
    ['AWS_BEDROCK_API_KEY'], ['BEDROCK_TOKEN'], ['AWS_BEDROCK_KEY'],
    ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'],
  ],
  atria: [['ATRIA_API_KEY']],
} as const;

export type ConfiguredProvider = 'cloudflare' | keyof typeof PROVIDER_CREDENTIALS;

export function requiredProviders(value: unknown): ConfiguredProvider[] {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('REQUIRED_MODEL_PROVIDERS must list at least one provider');
  }
  const providers = value.split(',').map(provider => provider.trim());
  if (providers.some(provider => !['cloudflare', ...Object.keys(PROVIDER_CREDENTIALS)].includes(provider))) {
    throw new Error('REQUIRED_MODEL_PROVIDERS contains an unsupported provider');
  }
  return [...new Set(providers)] as ConfiguredProvider[];
}

export function providerAvailable(provider: ConfiguredProvider, hasSecret: (name: string) => boolean, hasAI: boolean): boolean {
  return provider === 'cloudflare' ? hasAI : PROVIDER_CREDENTIALS[provider].some(group => group.every(hasSecret));
}

export function credential(env: Record<string, unknown>, name: string): string | undefined {
  const value = env[name];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

export function validateRuntimeProviders(env: Record<string, unknown>): void {
  const providers = requiredProviders(env.REQUIRED_MODEL_PROVIDERS);
  for (const provider of providers) {
    const binding = env.AI as { run?: unknown } | undefined;
    if (!providerAvailable(provider, name => Boolean(credential(env, name)), typeof binding?.run === 'function')) {
      throw new Error(`Required provider ${provider} is not configured`);
    }
    if (provider === 'atria') atriaConfiguration(env);
  }
}

export function bedrockBearer(env: Record<string, unknown>): string | undefined {
  return PROVIDER_CREDENTIALS.aws.filter(group => group.length === 1)
    .map(group => credential(env, group[0])).find(Boolean);
}

export function atriaConfiguration(env: Record<string, unknown>): { apiKey: string | undefined; baseURL: string } {
  const apiKey = credential(env, 'ATRIA_API_KEY');
  const rawBaseURL = credential(env, 'ATRIA_BASE_URL');
  const hasScheme = Boolean(rawBaseURL && /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(rawBaseURL));
  const normalizedBaseURL = rawBaseURL && !hasScheme
    ? `https://${rawBaseURL}`
    : rawBaseURL;
  const baseURL = normalizedBaseURL || 'https://api.atria-asi.ai/v1';
  let endpoint: URL;
  try {
    endpoint = new URL(baseURL);
  } catch {
    throw new Error('ATRIA_BASE_URL must be an HTTPS URL');
  }
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new Error('ATRIA_BASE_URL must be an HTTPS URL without credentials, query or fragment');
  }
  const host = endpoint.hostname.toLowerCase();
  const hostLooksPublic = host.includes('.') || host === 'localhost' || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host.includes(':');
  if (!hostLooksPublic) {
    throw new Error('ATRIA_BASE_URL must be an HTTPS URL');
  }
  return { apiKey, baseURL };
}
