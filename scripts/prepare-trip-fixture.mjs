import { build } from 'esbuild';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';

const root = resolve('audit-artifacts/2026-09-23/trip-planner');
await build({ entryPoints: ['src/lib/message-parser.ts'], bundle: true, platform: 'node', format: 'esm', outfile: '/tmp/brainhalf-trip-parser.mjs', logLevel: 'silent' });
await build({ entryPoints: ['src/runtime/source.ts'], bundle: true, platform: 'node', format: 'esm', outfile: '/tmp/brainhalf-trip-source.mjs', logLevel: 'silent' });
const { parseMessageSegments } = await import('/tmp/brainhalf-trip-parser.mjs');
const { assertSafeMigration, sourceSnapshot, projectManifest } = await import('/tmp/brainhalf-trip-source.mjs');
const backendOnly = process.argv.includes('--backend');
if (process.argv.includes('--extract') || backendOnly) {
  const result = backendOnly
    ? { success: true, result: { response: (await readFile(resolve(root, 'generation-partial.txt'), 'utf8')).match(/<file\s+path="[^"]+">[\s\S]*?<\/file>/g)?.join('\n') } }
    : JSON.parse(await readFile(resolve(root, 'generation-response.json'), 'utf8'));
  const response = result.result?.response;
  if (!result.success || typeof response !== 'string') throw new Error('No successful text generation saved');
  const parsed = parseMessageSegments(response, true);
  const snapshot = await sourceSnapshot(parsed.fileMap);
  if (backendOnly && !snapshot.files['worker/index.ts']) throw new Error('Worker is not complete yet');
  for (const dir of backendOnly ? ['backend-original'] : ['original', 'app']) {
    try { await access(resolve(root, dir)); throw new Error(`${dir} already exists; refusing to overwrite`); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    for (const [path, content] of Object.entries(snapshot.files)) {
      const target = resolve(root, dir, path);
      await mkdir(dirname(target), { recursive: true }); await writeFile(target, content);
    }
  }
  if (!backendOnly) await writeFile(resolve(root, 'generation-metadata.json'), JSON.stringify({ model: '@cf/deepseek-ai/deepseek-v4-pro-0813', method: 'Cloudflare API with actual BrainHalf system prompt and file parser; not the hosted ChatAgent workflow', usage: result.result.usage, revision: snapshot.revision, files: Object.keys(snapshot.files) }, null, 2));
  console.log('Extracted generated files:', Object.keys(snapshot.files).join(', '));
}
const appDirectory = resolve(root, backendOnly ? 'backend-original' : process.argv.includes('--original') ? 'original' : 'app');
const manifest = projectManifest({ 'package.json': await readFile(resolve(appDirectory, 'package.json'), 'utf8') });
const report = { managedRuntime: manifest.brainhalf?.runtime, buildScript: manifest.scripts.build, migrationCompatible: true };
try { assertSafeMigration(await readFile(resolve(appDirectory, 'migrations/0001.sql'), 'utf8')); }
catch (error) { report.migrationCompatible = false; report.migrationError = error.message; }
await mkdir(resolve(appDirectory, 'dist-worker'), { recursive: true });
await build({ entryPoints: [resolve(appDirectory, 'worker/index.ts')], bundle: true, platform: 'neutral', format: 'esm', outfile: resolve(appDirectory, 'dist-worker/index.js') });
await writeFile(resolve(root, backendOnly || process.argv.includes('--original') ? 'original-platform-contract.json' : 'platform-contract.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
