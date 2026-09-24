import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyRelease, RELEASE_CHECKS } from '../verify-release.mjs';
import { deploy } from '../deploy.mjs';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { sourceDigest, artifactDigest, assertReleaseUnchanged } from '../verify-release.mjs';
import { deploymentTarget } from '../wrangler.mjs';

test('release validation requires browsers, container build and real local worker smoke checks', async () => {
  const calls = [];
  await verifyRelease({ sourceDigest: () => 'fixed', run: async (command, args) => calls.push([command, args]) });
  assert.deepEqual(calls, RELEASE_CHECKS);
  for (const failureIndex of RELEASE_CHECKS.keys()) {
    let count = 0;
    await assert.rejects(verifyRelease({ sourceDigest: () => 'fixed', run: async () => { if (count++ === failureIndex) throw new Error('Check failed'); } }), /Check failed/);
    assert.equal(count, failureIndex + 1);
  }
});
test('the deployment receipt covers uncommitted source and the exact built assets', () => {
  const root = mkdtempSync(join(tmpdir(), 'brainhalf-release-'));
  try {
    for (const name of ['.github', 'src', 'public', 'scripts', 'tests', 'runtime-tests', 'dist']) mkdirSync(join(root, name));
    writeFileSync(join(root, 'src/new-untracked.ts'), 'export const value = 1;');
    writeFileSync(join(root, 'dist/index.html'), '<main>verified</main>');
    const receipt = { sourceDigest: sourceDigest(root), artifactDigest: artifactDigest(root) };
    assert.doesNotThrow(() => assertReleaseUnchanged(receipt, root));
    writeFileSync(join(root, 'dist/index.html'), '<main>changed</main>');
    assert.throws(() => assertReleaseUnchanged(receipt, root), /Built assets changed/);
    writeFileSync(join(root, 'src/new-untracked.ts'), 'export const value = 2;');
    assert.throws(() => assertReleaseUnchanged(receipt, root), /Source changed/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test('source changes during verification invalidate the entire result', async () => {
  let hashes = 0;
  await assert.rejects(verifyRelease({ sourceDigest: () => hashes++ ? 'changed' : 'original', run: async () => {} }), /Source changed/);
});
test('the fresh worker build uses the deployment target and refuses untracked external configurations', async () => {
  const target = deploymentTarget(['--env', 'staging'], {});
  const calls = [];
  const receipt = await verifyRelease({ target, sourceDigest: () => 'fixed', run: async (command, args) => calls.push([command, args]) });
  assert.deepEqual(calls.find(([, args]) => args[0] === 'scripts/wrangler.mjs')[1].slice(-4), target.flags);
  assert.deepEqual(receipt.target, target.flags);
  await assert.rejects(verifyRelease({ target: deploymentTarget(['--config', '/tmp/unverified-worker.toml'], {}), run: async () => {} }), /release input/);
});
test('direct deployment cannot bypass failed verification or changed source', async () => {
  let published = false;
  await assert.rejects(deploy([], { verifyRelease: async () => { throw new Error('Browser failed'); }, checkSecrets: async () => {}, runWrangler: () => { published = true; } }), /Browser failed/);
  await assert.rejects(deploy([], { verifyRelease: async () => ({ sourceDigest: 'original' }), checkSecrets: async () => {}, assertReleaseUnchanged: () => { throw new Error('Changed source'); }, runWrangler: () => { published = true; } }), /Changed source/);
  assert.equal(published, false);
});
