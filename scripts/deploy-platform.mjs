import { checkSecrets, parseSecretNames } from './check-secrets.mjs';
import { assertReleaseUnchanged, verifyRelease } from './verify-release.mjs';
import { deploymentTarget, isMain, runWrangler } from './wrangler.mjs';

export function validateRuntimeDeployment(config, present) {
  for (const name of ['CF_API_TOKEN', 'PROJECT_SECRETS_KEY']) {
    if (!present.has(name)) throw new Error(`Required runtime secret missing: ${name}`);
    if (Object.hasOwn(config.vars || {}, name)) throw new Error('Runtime credentials must be Wrangler secrets, not public vars');
  }
  if (config.vars?.RUNTIME_ENABLED !== 'true' || config.vars?.RUNTIME_ACCESS !== 'all') throw new Error('This release requires hosting enabled for all signed-in accounts');
  if (!config.services?.some(service => service.binding === 'PLATFORM' && service.service === 'brainhalf' && service.entrypoint === 'ManagedProviders')) throw new Error('The runtime must bind to the BrainHalf managed-provider service');
  if (!config.containers?.some(container => container.class_name === 'Sandbox')) throw new Error('The runtime Sandbox container configuration is missing');
}

/** Full production rollout; keeps all existing release checks and usage limits. */
export async function deployPlatform(args = [], dependencies = {}) {
  if (args.length) throw new Error('deploy:platform deploys the configured production pair and does not accept overrides');
  if ((dependencies.environment || process.env).CLOUDFLARE_ENV?.trim()) throw new Error('Unset CLOUDFLARE_ENV before deploying the production pair');
  const main = deploymentTarget([], {});
  const runtime = deploymentTarget(['--config', 'wrangler.runtime.jsonc'], {});
  const verify = dependencies.verifyRelease || verifyRelease;
  const run = dependencies.runWrangler || runWrangler;
  const unchanged = dependencies.assertReleaseUnchanged || assertReleaseUnchanged;
  const log = dependencies.log || console.log;
  const receipt = await verify({ target: main });
  await (dependencies.checkSecrets || checkSecrets)(main);
  const readConfig = dependencies.readConfig || (await import('wrangler')).unstable_readConfig;
  const config = readConfig(runtime.config, { hideWarnings: true });
  validateRuntimeDeployment(config, parseSecretNames(run(['secret', 'list', ...runtime.flags], true)));
  unchanged(receipt);
  log('Deploying BrainHalf hosting runtime with existing account limits.');
  run(['deploy', ...runtime.flags]);
  unchanged(receipt);
  log('Runtime deployed. Deploying the BrainHalf application and assets.');
  try { run(['deploy', ...main.flags]); }
  catch (error) { throw new Error(`The runtime deployed, but the main application did not. Keep the command output and retry after resolving the failure. ${error.message}`); }
  log('Both BrainHalf services deployed. Check https://brainhalf.com and a signed-in app publication.');
}

if (isMain(import.meta.url)) {
  try { await deployPlatform(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
