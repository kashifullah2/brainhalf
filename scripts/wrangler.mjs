import { execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
export const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function assertNodeVersion(version = process.versions.node) {
  const [major, minor] = version.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 18)) {
    throw new Error('BrainHalf deployment tooling requires Node.js >=22.18.0. Use .node-version.');
  }
}

export function isMain(url) {
  return Boolean(process.argv[1]) && pathToFileURL(resolve(process.argv[1])).href === url;
}

export function runWrangler(args, capture = false) {
  assertNodeVersion();
  let executable;
  let installedVersion = '';
  try {
    const packagePath = require.resolve('wrangler/package.json');
    const installed = require(packagePath);
    installedVersion = String(installed.version || '');
    const expected = require('../package.json').devDependencies.wrangler;
    if (installed.version !== expected) throw new Error('Version mismatch');
    executable = resolve(dirname(packagePath), installed.bin.wrangler);
  } catch {
    throw new Error('Pinned local Wrangler is missing or mismatched. Run npm ci.');
  }
  try {
    const environment = { ...process.env };
    delete environment.NODE_TEST_CONTEXT;
    if (capture) {
      const result = spawnSync(process.execPath, [executable, ...args], {
        cwd: projectRoot,
        env: environment,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 60_000,
      });
      if (result.error || result.status !== 0) throw new Error('failed');
      const combined = `${result.stdout || ''}${result.stderr || ''}`;
      if (combined.trim().length > 0) return combined;
      if (args.includes('--version') && installedVersion) return `${installedVersion}\n`;
      return combined;
    }
    return execFileSync(process.execPath, [executable, ...args], {
      cwd: projectRoot,
      env: environment,
      encoding: 'utf8',
      stdio: 'inherit',
    });
  } catch {
    throw new Error('Local Wrangler command failed. Check Cloudflare authentication and target configuration.');
  }
}

export function deploymentTarget(args, environment = process.env) {
  const target = { config: resolve(projectRoot, 'wrangler.toml') };
  const seen = new Set();
  for (let index = 0; index < args.length; index += 1) {
    const [flag, inlineValue] = args[index].split(/=(.*)/s);
    const name = { '--env': 'env', '-e': 'env', '--config': 'config', '-c': 'config' }[flag];
    if (!name || seen.has(name)) throw new Error('Only one --env and one --config are supported by the guarded deployment command.');
    const value = inlineValue ?? args[++index];
    if (!value?.trim() || value.startsWith('-')) throw new Error(`${flag} requires a value`);
    seen.add(name);
    target[name] = name === 'config' ? resolve(process.cwd(), value) : value;
  }
  if (!target.env && environment.CLOUDFLARE_ENV) target.env = environment.CLOUDFLARE_ENV;
  const flags = ['--config', target.config];
  if (target.env) flags.push('--env', target.env);
  return { config: target, flags };
}

if (isMain(import.meta.url)) {
  try { runWrangler(process.argv.slice(2)); } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
