import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deployPlatform, validateRuntimeDeployment } from '../deploy-platform.mjs';

const runtime = { vars: { RUNTIME_ENABLED: 'true', RUNTIME_ACCESS: 'all' }, services: [{ binding: 'PLATFORM', service: 'brainhalf', entrypoint: 'ManagedProviders' }], containers: [{ class_name: 'Sandbox' }] };
const names = ['CF_API_TOKEN', 'PROJECT_SECRETS_KEY'];
function harness(overrides = {}) {
  const calls = [];
  const logs = [];
  return { calls, logs, deps: {
    log: message => logs.push(message),
    environment: {},
    verifyRelease: async () => { calls.push('verify'); return { sourceDigest: 'checked' }; },
    checkSecrets: async () => { calls.push('main-secrets'); },
    readConfig: () => runtime,
    assertReleaseUnchanged: () => calls.push('unchanged'),
    runWrangler: (args, capture) => { calls.push(args); if (capture) return JSON.stringify(names.map(name => ({ name }))); },
    ...overrides,
  } };
}
test('the complete rollout verifies first, checks both secret sets and deploys runtime before app', async () => {
  const { calls, logs, deps } = harness(); await deployPlatform([], deps);
  assert.deepEqual(calls.slice(0, 2), ['verify', 'main-secrets']);
  assert.equal(calls[2][0], 'secret'); assert.equal(calls[3], 'unchanged');
  assert.equal(calls[4][0], 'deploy'); assert.match(calls[4][2], /wrangler.runtime.jsonc$/);
  assert.equal(calls[5], 'unchanged'); assert.match(calls[6][2], /wrangler.toml$/);
  assert.match(logs.at(-1), /^Both BrainHalf services deployed/);
});
test('production deployment refuses command-line and inherited environment overrides', async () => {
  const { deps } = harness();
  await assert.rejects(deployPlatform(['--config', 'other.jsonc'], deps), /does not accept overrides/);
  await assert.rejects(deployPlatform([], { ...deps, environment: { CLOUDFLARE_ENV: 'staging' } }), /Unset CLOUDFLARE_ENV/);
});
test('failed checks, missing runtime secrets and a changed release prevent all uploads', async () => {
  for (const overrides of [
    { verifyRelease: async () => { throw new Error('Browser failed'); } },
    { checkSecrets: async () => { throw new Error('Email configuration missing'); } },
    { readConfig: () => ({ ...runtime, vars: { RUNTIME_ENABLED: 'true', RUNTIME_ACCESS: 'pilot' } }) },
    { assertReleaseUnchanged: () => { throw new Error('Source changed'); } },
  ]) {
    const { calls, deps } = harness(overrides);
    await assert.rejects(deployPlatform([], deps));
    assert.equal(calls.some(call => Array.isArray(call) && call[0] === 'deploy'), false);
  }
  assert.throws(() => validateRuntimeDeployment(runtime, new Set(['CF_API_TOKEN'])), /PROJECT_SECRETS_KEY/);
  assert.throws(() => validateRuntimeDeployment({ ...runtime, vars: { ...runtime.vars, CF_API_TOKEN: 'public' } }, new Set(names)), /not public vars/);
});
test('runtime upload failure stops the rollout and main upload failure reports the partial state', async () => {
  for (const failAt of [1, 2]) {
    let uploads = 0;
    const { deps } = harness({ runWrangler: (args, capture) => {
      if (capture) return JSON.stringify(names.map(name => ({ name })));
      if (args[0] === 'deploy' && ++uploads === failAt) throw new Error('Upload failed');
    } });
    await assert.rejects(deployPlatform([], deps), failAt === 1 ? /Upload failed/ : /runtime deployed, but the main application did not/);
    assert.equal(uploads, failAt);
  }
});
