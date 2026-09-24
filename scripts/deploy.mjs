import { checkSecrets } from './check-secrets.mjs';
import { deploymentTarget, isMain, runWrangler } from './wrangler.mjs';
import { verifyRelease, assertReleaseUnchanged } from './verify-release.mjs';

export async function deploy(args, dependencies = {}) {
  const target = deploymentTarget(args, dependencies.environment ?? process.env);
  const receipt = await (dependencies.verifyRelease || verifyRelease)({ target });
  await (dependencies.checkSecrets || checkSecrets)(target);
  (dependencies.assertReleaseUnchanged || assertReleaseUnchanged)(receipt);
  (dependencies.runWrangler || runWrangler)(['deploy', ...target.flags]);
}

if (isMain(import.meta.url)) {
  try { await deploy(process.argv.slice(2)); } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
