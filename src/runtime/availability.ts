import type { ProjectEnvironment, RuntimeAvailability, RuntimeStatus } from './types';

/** Only presence is inspected here; binding implementations stay in the Worker. */
export interface HostingConfiguration {
  RUNTIME_ENABLED?: string; RUNTIME_ACCESS?: string; PILOT_OWNER_IDS?: string; CF_API_TOKEN?: string;
  CF_ACCOUNT_ID?: string; PROJECT_SECRETS_KEY?: string;
  Sandbox?: unknown; BROWSER?: unknown; ARTIFACTS?: unknown; DISPATCHER?: unknown;
}

export function runtimeOwnerAllowed(env: Pick<HostingConfiguration, 'RUNTIME_ACCESS' | 'PILOT_OWNER_IDS'>, ownerId: string): boolean {
  return Boolean(ownerId.trim()) && (env.RUNTIME_ACCESS === 'all' || (env.PILOT_OWNER_IDS || '').split(',').map(value => value.trim()).includes(ownerId));
}

/** Owner-facing availability. Never return infrastructure credentials or secret values. */
export function runtimeAvailability(env: HostingConfiguration, ownerId: string): RuntimeAvailability {
  if (env.RUNTIME_ENABLED !== 'true') return { state: 'disabled', message: 'Managed hosting is not available yet. You can keep building and export your project.' };
  if (!runtimeOwnerAllowed(env, ownerId)) {
    return { state: 'pilot_only', message: 'Managed hosting is currently available to pilot accounts.' };
  }
  let validKey = false;
  try { validKey = atob(env.PROJECT_SECRETS_KEY || '').length === 32; } catch { /* Invalid configuration stays unavailable. */ }
  if (!env.CF_API_TOKEN || !env.CF_ACCOUNT_ID || !validKey || !env.Sandbox || !env.BROWSER || !env.ARTIFACTS || !env.DISPATCHER) {
    return { state: 'setup_required', message: 'Managed hosting setup is incomplete. The platform administrator needs to finish connecting the service.' };
  }
  return { state: 'ready', message: 'Managed hosting is available. Each project uses separate development and production databases.' };
}

export function unavailableRuntimeStatus(projectId: string, environment: ProjectEnvironment, availability: RuntimeAvailability): RuntimeStatus {
  return {
    projectId, environment, enabled: false, availability,
    capabilities: { sandbox: false, database: false, deployment: false, browser: false, secrets: false },
    database: null, migrations: [], jobs: [], releases: [], activeRelease: null, verification: null,
    integrations: [], previewUrl: '', productionUrl: '',
  };
}
