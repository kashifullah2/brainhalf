import { describe, expect, it } from 'vitest';
import { runtimeAvailability, runtimeOwnerAllowed, unavailableRuntimeStatus, type HostingConfiguration } from '../runtime/availability';

function configuration(overrides: HostingConfiguration = {}): HostingConfiguration {
  return { RUNTIME_ENABLED: 'true', PILOT_OWNER_IDS: 'owner, another-owner', CF_API_TOKEN: 'private-token', CF_ACCOUNT_ID: 'account', PROJECT_SECRETS_KEY: btoa('k'.repeat(32)), Sandbox: {}, BROWSER: {}, ARTIFACTS: {}, DISPATCHER: {}, ...overrides };
}
describe('Managed hosting availability', () => {
  it('admits every authenticated owner in public mode without skipping setup or the kill switch', () => {
    expect(runtimeAvailability(configuration({ RUNTIME_ACCESS: 'all' }), 'new-owner').state).toBe('ready');
    expect(runtimeAvailability(configuration({ RUNTIME_ACCESS: 'all', RUNTIME_ENABLED: 'false' }), 'new-owner').state).toBe('disabled');
    expect(runtimeAvailability(configuration({ RUNTIME_ACCESS: 'all', CF_API_TOKEN: undefined }), 'new-owner').state).toBe('setup_required');
    expect(runtimeOwnerAllowed({ RUNTIME_ACCESS: 'all' }, '')).toBe(false);
    expect(runtimeOwnerAllowed({ RUNTIME_ACCESS: 'all' }, '   ')).toBe(false);
    expect(runtimeOwnerAllowed({ RUNTIME_ACCESS: 'anything-else' }, 'new-owner')).toBe(false);
  });
  it('keeps the kill switch and pilot boundary ahead of provisioning', () => {
    expect(runtimeAvailability(configuration({ RUNTIME_ENABLED: 'false' }), 'owner').state).toBe('disabled');
    expect(runtimeAvailability(configuration(), 'other-account').state).toBe('pilot_only');
    expect(runtimeAvailability(configuration(), 'another-owner').state).toBe('ready');
  });
  it.each(['CF_API_TOKEN', 'CF_ACCOUNT_ID', 'PROJECT_SECRETS_KEY', 'Sandbox', 'BROWSER', 'ARTIFACTS', 'DISPATCHER'] as const)('rejects missing %s before admitting a paid job', field => {
    expect(runtimeAvailability(configuration({ [field]: undefined }), 'owner').state).toBe('setup_required');
  });
  it('does not expose credentials and disables every unavailable action', () => {
    const availability = runtimeAvailability(configuration({ PROJECT_SECRETS_KEY: 'invalid' }), 'owner');
    const status = unavailableRuntimeStatus('project', 'production', availability);
    expect(status.enabled).toBe(false);
    expect(Object.values(status.capabilities).every(value => !value)).toBe(true);
    expect(status.jobs).toEqual([]);
    expect(JSON.stringify(status)).not.toMatch(/private-token|CF_API_TOKEN|PROJECT_SECRETS_KEY/);
  });
});
