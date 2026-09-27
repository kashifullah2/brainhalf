export interface RuntimeEnv extends Omit<RuntimeBindings, 'RUNTIME_ENABLED' | 'RUNTIME_ACCESS' | 'RUNTIME_DOMAIN' | 'CF_ACCOUNT_ID' | 'DISPATCH_NAMESPACE' | 'PILOT_OWNER_IDS' | 'PLATFORM' | 'RUNTIME_SERVICE_NAME'> {
  RUNTIME_ENABLED: string;
  RUNTIME_ACCESS?: string;
  RUNTIME_DOMAIN: string;
  CF_ACCOUNT_ID: string;
  DISPATCH_NAMESPACE: string;
  PILOT_OWNER_IDS: string;
  CF_API_TOKEN?: string;
  CF_ZONE_ID?: string;
  PROJECT_SECRETS_KEY?: string;
  PLATFORM?: Fetcher;
  RUNTIME_SERVICE_NAME?: string;
}
