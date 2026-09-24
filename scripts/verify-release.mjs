import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { projectRoot, isMain } from './wrangler.mjs';

export const RELEASE_CHECKS = [
  ['npm', ['run', 'verify']],
  ['npx', ['--no-install', 'playwright', 'test']],
  ['npx', ['--no-install', 'playwright', 'test', '--config', 'playwright.seo.config.ts']],
  ['npm', ['run', 'runtime:check']],
  ['npm', ['run', 'runtime:smoke']],
  ['node', ['scripts/wrangler.mjs', 'deploy', '--dry-run', '--outdir', '/tmp/brainhalf-main-build']],
  ['node', ['scripts/check-agent-local.mjs']],
];
const roots = ['.github', 'src', 'public', 'scripts', 'tests', 'runtime-tests'];
export function releaseSources(root = projectRoot) {
  const files = [];
  function visit(directory) {
    for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
      if (['node_modules', 'results', '.auth', '.cache'].includes(entry.name)) continue;
      const name = join(directory, entry.name);
      if (entry.isDirectory()) visit(name);
      else if (entry.isFile()) files.push(name);
      else throw new Error(`Release inputs must be regular files: ${name}`);
    }
  }
  for (const directory of roots) visit(directory);
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isFile() && (/^(?:package(?:-lock)?\.json|index\.html|Dockerfile\.runtime|\.node-version|\.npmrc|\.oxlintrc\.json)$/.test(entry.name) || /^(?:wrangler|vite|vitest|playwright|tsconfig).*\.(?:toml|json|jsonc|ts)$/.test(entry.name))) files.push(entry.name);
  }
  return [...new Set(files)].sort();
}
export function sourceDigest(root = projectRoot) {
  const hash = createHash('sha256');
  for (const file of releaseSources(root)) { hash.update(file); hash.update('\0'); hash.update(readFileSync(join(root, file))); hash.update('\0'); }
  return hash.digest('hex');
}
export function assertReleaseUnchanged(receipt, root = projectRoot) {
  if (!receipt?.sourceDigest || receipt.sourceDigest !== sourceDigest(root)) throw new Error('Source changed after release verification. Run the complete release checks again.');
  if (!receipt.artifactDigest || receipt.artifactDigest !== artifactDigest(root)) throw new Error('Built assets changed after release verification. Run the complete release checks again.');
}
export function artifactDigest(root = projectRoot) {
  const hash = createHash('sha256');
  function visit(directory) {
    for (const entry of readdirSync(join(root, directory), { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      const name = join(directory, entry.name);
      if (entry.isDirectory()) visit(name);
      else if (entry.isFile()) { hash.update(name); hash.update('\0'); hash.update(readFileSync(join(root, name))); hash.update('\0'); }
      else throw new Error(`Built assets must be regular files: ${name}`);
    }
  }
  visit('dist'); return hash.digest('hex');
}
export async function verifyRelease(dependencies = {}) {
  const root = dependencies.root || projectRoot;
  const target = dependencies.target;
  if (target && !releaseSources(root).some(file => resolve(root, file) === target.config.config)) throw new Error('The deployment config must be a release input inside this repository. Use a wrangler*.toml/json/jsonc config in the project root.');
  const checks = RELEASE_CHECKS.map(([command, args]) => [command, target && args[0] === 'scripts/wrangler.mjs' ? [...args, ...target.flags] : [...args]]);
  const digest = (dependencies.sourceDigest || sourceDigest)(root);
  const run = dependencies.run || ((command, args) => {
    const env = { ...process.env, CI: '1' }; delete env.NODE_TEST_CONTEXT;
    execFileSync(command === 'node' ? process.execPath : command, args, { cwd: root, stdio: 'inherit', env });
  });
  for (const [command, args] of checks) await run(command, [...args]);
  if (digest !== (dependencies.sourceDigest || sourceDigest)(root)) throw new Error('Source changed during release verification. Verify again.');
  const receipt = { sourceDigest: digest, verifiedAt: new Date().toISOString(), checks: checks.map(([command, args]) => [command, ...args].join(' ')), ...(target ? { target: target.flags } : {}) };
  if (!dependencies.run) {
    receipt.artifactDigest = artifactDigest(root);
    const directory = join(root, '.release'); mkdirSync(directory, { recursive: true });
    const archive = join(directory, `source-${digest}.tar.gz`);
    const listing = join(directory, 'source-files.txt');
    writeFileSync(listing, releaseSources(root).join('\n') + '\n');
    execFileSync('tar', ['-czf', archive, '-T', listing], { cwd: root });
    receipt.sourceArchive = relative(root, archive);
    writeFileSync(join(directory, 'validation.json'), JSON.stringify(receipt, null, 2) + '\n');
  }
  return receipt;
}
if (isMain(import.meta.url)) {
  try { await verifyRelease(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
