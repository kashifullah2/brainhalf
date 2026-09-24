import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertNodeVersion, deploymentTarget, projectRoot, runWrangler } from '../wrangler.mjs';
import { checkSecrets, parseSecretNames, validateDeployment } from '../check-secrets.mjs';
import { deploy } from '../deploy.mjs';

const configFor = providers => ({ vars: { REQUIRED_MODEL_PROVIDERS: providers } });

test('secret listings require the pinned JSON structure, never permissive text scanning', () => {
  assert.deepEqual([...parseSecretNames('[{"name":"SESSION_SECRET"}]')], ['SESSION_SECRET']);
  for (const listing of ['SESSION_SECRET\nATRIA_API_KEY', '{}', 'null', '[null]', '[{"name":3}]', '[{"name":""}]', '{"result":[]}']) {
    assert.throws(() => parseSecretNames(listing));
  }
});

test('provider-specific requirements allow non-Atria deployments', () => {
  const present = new Set(['SESSION_SECRET']);
  assert.deepEqual(validateDeployment({ ...configFor('cloudflare'), ai: { binding: 'AI' } }, present, {}), ['cloudflare']);
  assert.throws(() => validateDeployment(configFor('cloudflare'), present, {}), /AI binding/);
  assert.throws(() => validateDeployment(configFor('atria'), present, {}), /ATRIA_API_KEY/);
  present.add('ATRIA_API_KEY');
  assert.deepEqual(validateDeployment(configFor('atria'), present, {}), ['atria']);
  assert.throws(() => validateDeployment({ vars: { REQUIRED_MODEL_PROVIDERS: 'atria', ATRIA_BASE_URL: 'http://example.test' } }, present, {}), /ATRIA_BASE_URL/);
  present.add('AWS_ACCESS_KEY_ID');
  assert.throws(() => validateDeployment(configFor('aws'), present, {}), /AWS_SECRET_ACCESS_KEY/);
  present.add('AWS_SECRET_ACCESS_KEY');
  assert.deepEqual(validateDeployment(configFor('aws'), present, {}), ['aws']);
  assert.throws(() => validateDeployment(configFor('aws,anthropic'), present, {}), /ANTHROPIC_API_KEY/);
});

test('missing secrets, invalid local values and credentials in vars block deployment', () => {
  const config = { ...configFor('cloudflare'), ai: { binding: 'AI' } };
  assert.throws(() => validateDeployment(config, new Set(), {}), /SESSION_SECRET/);
  const present = new Set(['SESSION_SECRET']);
  for (const value of ['', 'short', ' '.repeat(40), null]) {
    assert.throws(() => validateDeployment(config, present, { SESSION_SECRET: value }), /Local SESSION_SECRET/);
  }
  assert.throws(() => validateDeployment({ ...config, vars: { ...config.vars, SESSION_SECRET: 'do-not-print-this' } }, present, {}), /not vars/);
  assert.throws(() => validateDeployment({}, present, {}), /REQUIRED_MODEL_PROVIDERS/);
});

test('deployment flags resolve one identical target for checking and deploying', () => {
  assert.deepEqual(deploymentTarget(['--env=staging'], {}).flags, ['--config', join(projectRoot, 'wrangler.toml'), '--env', 'staging']);
  assert.equal(deploymentTarget([], { CLOUDFLARE_ENV: 'staging' }).config.env, 'staging');
  assert.equal(deploymentTarget(['-e', 'production'], { CLOUDFLARE_ENV: 'staging' }).config.env, 'production');
  for (const args of [['--env'], ['--env='], ['--name', 'other-worker'], ['--config', '--env'], ['--env', 'one', '-e', 'two'], ['--dry-run'], ['--var', 'SESSION_SECRET:bad']]) {
    assert.throws(() => deploymentTarget(args, {}));
  }
});

test('failed checks prevent deployment and successful checks preserve target flags', async () => {
  const calls = [];
  await assert.rejects(deploy(['--env', 'staging'], {
    verifyRelease: async () => ({ sourceDigest: 'test' }), assertReleaseUnchanged: () => {},
    checkSecrets: async () => { throw new Error('Missing secret'); },
    runWrangler: args => calls.push(args),
    environment: {},
  }), /Missing secret/);
  assert.deepEqual(calls, []);
  let checked;
  await deploy(['--env', 'staging'], {
    verifyRelease: async () => ({ sourceDigest: 'test' }), assertReleaseUnchanged: () => {},
    checkSecrets: async target => { checked = target; },
    runWrangler: args => calls.push(args),
    environment: {},
  });
  assert.deepEqual(calls, [['deploy', ...checked.flags]]);
});

test('secret checking uses the same target, rejects malformed output and propagates failures', async () => {
  const target = deploymentTarget(['-e', 'staging'], {});
  const dependencies = {
    readConfig: args => {
      assert.deepEqual(args, target.config);
      return configFor('anthropic');
    },
    runWrangler: (args, capture) => {
      assert.deepEqual(args, ['secret', 'list', ...target.flags]);
      assert.equal(capture, true);
      return JSON.stringify([{ name: 'SESSION_SECRET' }, { name: 'ANTHROPIC_API_KEY' }]);
    },
    environment: {},
  };
  assert.deepEqual(await checkSecrets(target, dependencies), ['anthropic']);
  await assert.rejects(checkSecrets(target, { ...dependencies, runWrangler: () => 'bad-output' }), /valid JSON/);
  await assert.rejects(checkSecrets(target, { ...dependencies, runWrangler: () => { throw new Error('Offline'); } }), /Offline/);
});

test('the pinned Wrangler parser reads actual environment-specific provider policy locally', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'brainhalf-config-'));
  try {
    const configPath = join(directory, 'wrangler.toml');
    writeFileSync(configPath, 'name = "local-test"\ncompatibility_date = "2024-09-23"\n[vars]\nREQUIRED_MODEL_PROVIDERS = "cloudflare"\n[ai]\nbinding = "AI"\n[env.staging.vars]\nREQUIRED_MODEL_PROVIDERS = "anthropic"\n');
    const target = deploymentTarget(['--config', configPath, '--env', 'staging'], {});
    assert.deepEqual(await checkSecrets(target, {
      runWrangler: () => '[{"name":"SESSION_SECRET"},{"name":"ANTHROPIC_API_KEY"}]',
      environment: {},
    }), ['anthropic']);
    await assert.rejects(checkSecrets(target, {
      runWrangler: () => '[{"name":"SESSION_SECRET"}]', environment: {},
    }), /ANTHROPIC_API_KEY/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('local Wrangler runs from its exact installed version without npx resolution', () => {
  const output = runWrangler(['--version'], true);
  assert.match(output, /4\.135\.0/);
});

test('the Node floor supports native TypeScript imports and is enforced', () => {
  assert.throws(() => assertNodeVersion('20.19.0'), /Node.js/);
  assert.throws(() => assertNodeVersion('22.17.0'), /Node.js/);
  assert.doesNotThrow(() => assertNodeVersion('22.18.0'));
  assert.doesNotThrow(() => assertNodeVersion('24.0.0'));
});

test('required public services block deployment when contact or sign-in configuration is incomplete', async () => {
  const config = { ...configFor('cloudflare'), ai: { binding: 'AI' }, vars: { REQUIRED_MODEL_PROVIDERS: 'cloudflare', REQUIRED_PUBLIC_SERVICES: 'email,google' } };
  const names = ['SESSION_SECRET', 'RESEND_API_KEY', 'RESEND_FROM_EMAIL', 'CONTACT_EMAIL', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'];
  assert.deepEqual(validateDeployment(config, new Set(names), {}), ['cloudflare']);
  for (const missing of names.slice(1)) {
    const present = new Set(names.filter(name => name !== missing));
    assert.throws(() => validateDeployment(config, present, { [missing]: 'only-in-local-shell' }), error => error.message.includes(missing));
  }
  const calls = [];
  await assert.rejects(deploy([], {
    verifyRelease: async () => ({ sourceDigest: 'test' }), assertReleaseUnchanged: () => {},
    environment: {},
    checkSecrets: target => checkSecrets(target, { readConfig: () => config, runWrangler: () => '[{"name":"SESSION_SECRET"}]', environment: {} }),
    runWrangler: args => calls.push(args),
  }), /RESEND_API_KEY/);
  assert.deepEqual(calls, []);
});

test('public-service settings accept safe vars while credentials and malformed settings are rejected', () => {
  const vars = { REQUIRED_MODEL_PROVIDERS: 'cloudflare', REQUIRED_PUBLIC_SERVICES: 'email,google', RESEND_FROM_EMAIL: 'sender@example.com', CONTACT_EMAIL: 'owner@example.com', GOOGLE_CLIENT_ID: 'example.apps.googleusercontent.com' };
  const present = new Set(['SESSION_SECRET', 'RESEND_API_KEY', 'GOOGLE_CLIENT_SECRET']);
  const config = { vars, ai: { binding: 'AI' } };
  assert.deepEqual(validateDeployment(config, present, {}), ['cloudflare']);
  for (const name of ['RESEND_API_KEY', 'GOOGLE_CLIENT_SECRET']) {
    assert.throws(() => validateDeployment({ ...config, vars: { ...vars, [name]: 'do-not-print-this' } }, present, {}), error => /not vars/.test(error.message) && !error.message.includes('do-not-print-this'));
  }
  for (const [name, value] of [['RESEND_FROM_EMAIL', 'BrainHalf <sender@example.com>'], ['CONTACT_EMAIL', 'invalid'], ['GOOGLE_CLIENT_ID', '   ']]) {
    assert.throws(() => validateDeployment({ ...config, vars: { ...vars, [name]: value } }, present, {}), error => error.message.includes(name));
  }
  for (const policy of ['', 'email,unknown', null, ['email']]) {
    assert.throws(() => validateDeployment({ ...config, vars: { ...vars, REQUIRED_PUBLIC_SERVICES: policy } }, present, {}), /REQUIRED_PUBLIC_SERVICES/);
  }
});
