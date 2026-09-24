import { assertNodeVersion, deploymentTarget, isMain, runWrangler } from './wrangler.mjs';
import { atriaConfiguration, dahlConfiguration, MIN_SESSION_SECRET_LENGTH, PROVIDER_CREDENTIALS, providerAvailable, requiredProviders, validSessionSecret } from '../src/lib/runtime-config.ts';
import { isValidEmail } from '../src/lib/crypto.ts';

const PUBLIC_SERVICES = {
  email: { secrets: ['RESEND_API_KEY'], settings: ['RESEND_FROM_EMAIL', 'CONTACT_EMAIL'] },
  google: { secrets: ['GOOGLE_CLIENT_SECRET'], settings: ['GOOGLE_CLIENT_ID'] },
};

function validatePublicServices(config, present) {
  const policy = config.vars?.REQUIRED_PUBLIC_SERVICES;
  if (policy === undefined) return;
  if (typeof policy !== 'string' || !policy.trim()) throw new Error('REQUIRED_PUBLIC_SERVICES must list the required public services');
  const services = [...new Set(policy.split(',').map(name => name.trim()))];
  if (services.some(name => !Object.hasOwn(PUBLIC_SERVICES, name))) throw new Error('REQUIRED_PUBLIC_SERVICES contains an unsupported service');
  for (const service of services) {
    const { secrets, settings } = PUBLIC_SERVICES[service];
    for (const name of secrets) if (!present.has(name)) throw new Error(`Required ${service} secret missing: ${name}`);
    for (const name of settings) {
      if (Object.hasOwn(config.vars || {}, name)) {
        const value = config.vars[name];
        if (typeof value !== 'string' || !value.trim() || (service === 'email' && !isValidEmail(value))) {
          throw new Error(`Invalid ${service} setting: ${name}`);
        }
      } else if (!present.has(name)) {
        throw new Error(`Required ${service} setting missing: ${name}`);
      }
    }
  }
}

export function parseSecretNames(listing) {
  let parsed;
  try { parsed = JSON.parse(listing); } catch { throw new Error('Wrangler secret list did not return valid JSON'); }
  if (!Array.isArray(parsed) || parsed.some(row => !row || typeof row.name !== 'string' || !row.name.trim())) {
    throw new Error('Wrangler secret list returned an unexpected structure');
  }
  return new Set(parsed.map(row => row.name));
}

export function validateDeployment(config, present, environment = process.env) {
  if (!present.has('SESSION_SECRET')) throw new Error('Required secret missing: SESSION_SECRET');
  if (Object.hasOwn(environment, 'SESSION_SECRET') && !validSessionSecret(environment.SESSION_SECRET)) {
    throw new Error(`Local SESSION_SECRET must contain at least ${MIN_SESSION_SECRET_LENGTH} non-padding characters`);
  }
  const secretNames = new Set(['SESSION_SECRET', ...Object.values(PROVIDER_CREDENTIALS).flat(2), ...Object.values(PUBLIC_SERVICES).flatMap(service => service.secrets)]);
  if (Object.keys(config.vars || {}).some(name => secretNames.has(name))) {
    throw new Error('Credential values must be stored as Wrangler secrets, not vars');
  }
  const providers = requiredProviders(config.vars?.REQUIRED_MODEL_PROVIDERS);
  for (const provider of providers) {
    if (!providerAvailable(provider, name => present.has(name), config.ai?.binding === 'AI')) {
      const requirement = provider === 'cloudflare' ? 'AI binding' : PROVIDER_CREDENTIALS[provider].map(group => group.join(' + ')).join(' or ');
      throw new Error(`Required provider ${provider} is not configured: ${requirement}`);
    }
    if (provider === 'atria' && config.vars?.ATRIA_BASE_URL !== undefined) atriaConfiguration(config.vars);
    if (provider === 'dahl' && config.vars?.DAHL_BASE_URL !== undefined) dahlConfiguration(config.vars);
  }
  validatePublicServices(config, present);
  return providers;
}

export async function checkSecrets(target, dependencies = {}) {
  assertNodeVersion();
  const readConfig = dependencies.readConfig || (await import('wrangler')).unstable_readConfig;
  const run = dependencies.runWrangler || runWrangler;
  const config = readConfig(target.config, { hideWarnings: true });
  const present = parseSecretNames(run(['secret', 'list', ...target.flags], true));
  return validateDeployment(config, present, dependencies.environment ?? process.env);
}

if (isMain(import.meta.url)) {
  try {
    const providers = await checkSecrets(deploymentTarget(process.argv.slice(2)));
    console.log(`Required secret names, public-service configuration and provider bindings present (${providers.join(', ')}). Remote secret values cannot be checked; runtime validation remains mandatory.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
