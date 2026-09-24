import { describe, expect, it } from 'vitest';
import { atriaConfiguration, bedrockBearer, credential, dahlConfiguration, PROVIDER_CREDENTIALS, providerAvailable, requiredProviders, validSessionSecret, validateRuntimeProviders } from '../lib/runtime-config';

describe('Runtime configuration', () => {
  it('requires a durable signing secret with at least 32 non-padding characters', () => {
    expect(validSessionSecret('a'.repeat(32))).toBe(true);
    expect(validSessionSecret('a'.repeat(31))).toBe(false);
    expect(validSessionSecret(' '.repeat(40))).toBe(false);
    expect(validSessionSecret(' short '.padEnd(40))).toBe(false);
  });

  it('accepts a deduplicated explicit provider policy and rejects malformed policies', () => {
    expect(requiredProviders('cloudflare, aws,aws')).toEqual(['cloudflare', 'aws']);
    for (const invalid of [undefined, '', 'aws,', 'unknown', ['aws'], 'toString']) {
      expect(() => requiredProviders(invalid)).toThrow('REQUIRED_MODEL_PROVIDERS');
    }
  });

  it.each(PROVIDER_CREDENTIALS.aws.filter(group => group.length === 1))('shares the %s Bedrock alias across checks and runtime', alias => {
    const env = { [alias]: 'test-credential', REQUIRED_MODEL_PROVIDERS: 'aws' };
    expect(bedrockBearer(env)).toBe('test-credential');
    expect(providerAvailable('aws', name => name === alias, false)).toBe(true);
    expect(() => validateRuntimeProviders(env)).not.toThrow();
  });

  it('requires both AWS keys when there is no bearer token', () => {
    const env = { REQUIRED_MODEL_PROVIDERS: 'aws', AWS_ACCESS_KEY_ID: 'access' };
    expect(() => validateRuntimeProviders(env)).toThrow('aws');
    expect(() => validateRuntimeProviders({ ...env, AWS_SECRET_ACCESS_KEY: 'secret' })).not.toThrow();
    expect(credential({ KEY: '  ' }, 'KEY')).toBeUndefined();
    expect(credential({ KEY: 123 }, 'KEY')).toBeUndefined();
  });

  it('validates all required providers, without requiring unused ones', () => {
    expect(() => validateRuntimeProviders({ REQUIRED_MODEL_PROVIDERS: 'cloudflare', AI: { run() {} } })).not.toThrow();
    expect(() => validateRuntimeProviders({ REQUIRED_MODEL_PROVIDERS: 'cloudflare', AI: {} })).toThrow('cloudflare');
    expect(() => validateRuntimeProviders({ REQUIRED_MODEL_PROVIDERS: 'anthropic,atria', ANTHROPIC_API_KEY: 'key' })).toThrow('atria');
    expect(() => validateRuntimeProviders({ REQUIRED_MODEL_PROVIDERS: 'atria', ATRIA_API_KEY: 'key' })).not.toThrow();
  });

  it('does not treat an Atria URL as a credential or allow insecure URLs', () => {
    expect(atriaConfiguration({ ATRIA_API_KEY: 'key' })).toEqual({ apiKey: 'key', baseURL: 'https://api.atria-asi.ai/v1' });
    expect(atriaConfiguration({ ATRIA_BASE_URL: 'https://example.test/v1' }).apiKey).toBeUndefined();
    expect(atriaConfiguration({ ATRIA_BASE_URL: 'api.atria-asi.ai/v1' }).baseURL).toBe('https://api.atria-asi.ai/v1');
    for (const baseURL of ['legacy-secret', 'http://example.test', 'https://user:pass@example.test', 'https://example.test?key=secret', 'https://example.test#fragment']) {
      expect(() => atriaConfiguration({ ATRIA_BASE_URL: baseURL })).toThrow('ATRIA_BASE_URL');
    }
  });

  it('validates Dahl endpoint and key wiring', () => {
    expect(dahlConfiguration({ DAHL_API_KEY: 'key' })).toEqual({ apiKey: 'key', baseURL: 'https://inference.dahl.global/v1' });
    expect(dahlConfiguration({ DAHL_BASE_URL: 'inference.dahl.global/v1' }).baseURL).toBe('https://inference.dahl.global/v1');
    for (const baseURL of ['legacy-secret', 'http://example.test', 'https://user:pass@example.test', 'https://example.test?key=secret', 'https://example.test#fragment']) {
      expect(() => dahlConfiguration({ DAHL_BASE_URL: baseURL })).toThrow('DAHL_BASE_URL');
    }
  });
});
