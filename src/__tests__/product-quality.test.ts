import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { applyExactEdits } from '../lib/exact-edits';
import { addTypeScriptBackend, createTypeScriptStarter } from '../lib/project-starters';
import { previewFiles } from '../lib/preview-isolation';
import { setSimulatedApi, usesSimulatedApi } from '../lib/preview-mode';
import { buildSystemPrompt } from '../lib/system-prompt';
import { reconcileWorkspaceSnapshot } from '../lib/workspace-reconciliation';

const execute = promisify(execFile);

describe('Exact incremental edits', () => {
  it('preserves surrounding bytes and treats replacement strings literally', () => {
    expect(applyExactEdits('first\r\nconst title = "Old";\r\nlast', [{ search: '"Old"', replace: '"$& New"' }])).toBe('first\r\nconst title = "$& New";\r\nlast');
  });
  it.each(['', 'missing', 'duplicate'])('rejects unsafe search %j', search => {
    expect(() => applyExactEdits('duplicate\nduplicate', [{ search, replace: 'new' }])).toThrow();
  });
  it('rejects a batch with any missing match', () => {
    expect(() => applyExactEdits('first\nlast', [{ search: 'first', replace: 'changed' }, { search: 'missing', replace: 'value' }])).toThrow();
  });
});

describe('Retired preview simulation', () => {
  it('defaults to no fake API, preserves metadata, and filters credentials', () => {
    const original = { '/package.json': JSON.stringify({ scripts: { dev: 'vite' }, dependencies: { react: '^19.2.8' }, privateToken: 'not-for-preview' }), '/server/.env': 'SECRET=never-expose' };
    expect(usesSimulatedApi(original)).toBe(false);
    const enabled = setSimulatedApi(original, true);
    expect(JSON.parse(enabled['/package.json']).scripts).toEqual({ dev: 'vite' });
    expect(usesSimulatedApi(previewFiles(enabled))).toBe(false);
    expect(JSON.stringify(previewFiles(enabled))).not.toContain('not-for-preview');
    expect(JSON.stringify(previewFiles(enabled))).not.toContain('never-expose');
    expect(usesSimulatedApi(setSimulatedApi(enabled, false))).toBe(false);
  });
  it.each(['[]', 'null', '{bad json', '{"brainhalf":"custom"}'])('preserves malformed settings: %s', manifest => {
    expect(() => setSimulatedApi({ '/package.json': manifest }, true)).toThrow();
  });
});

describe('TypeScript project generation', () => {
  it('recognizes the shared starter without confusing it with offline edits', () => {
    expect(reconcileWorkspaceSnapshot(createTypeScriptStarter(), {}).hasLocalChanges).toBe(false);
    expect(createTypeScriptStarter()['/src/App.jsx']).toBeUndefined();
  });
  it('requires inspection, typed contracts and real persistence in agent instructions', () => {
    const prompt = buildSystemPrompt({ filesContext: '', plannerMode: false });
    for (const rule of ['INSPECT BEFORE IMPLEMENTING', 'edit_file', 'strict TypeScript', 'schema/migrations', 'parameterized queries', 'never make fake routes']) expect(prompt).toContain(rule);
    expect(prompt).not.toContain('combine routes and in-memory data');
  });
  it('preserves working frontend code, scripts and framework config', () => {
    const original = { '/src/App.tsx': 'export default () => <h1>Keep me</h1>;', '/vite.config.ts': 'custom config', '/package.json': '{"type":"module","scripts":{"dev":"custom dev"},"dependencies":{"react":"custom-version"}}' };
    const next = addTypeScriptBackend(original);
    expect(next['/src/App.tsx']).toBe(original['/src/App.tsx']);
    expect(next['/vite.config.ts']).toBe(original['/vite.config.ts']);
    expect(JSON.parse(next['/package.json']).scripts.dev).toBe('custom dev');
    expect(JSON.parse(next['/package.json']).dependencies.react).toBe('custom-version');
    expect(next['/server/.env']).toBeUndefined();
  });
  it.each(['/server/custom.ts', '/src/lib/api.ts', '/shared/api.ts'])('refuses existing architecture: %s', path => {
    expect(() => addTypeScriptBackend({ [path]: 'working source' })).toThrow(/already exists/);
  });
  it('typechecks frontend/backend, runs real HTTP/SQLite tests and builds the exported frontend', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'brainhalf-product-'));
    const environment = { ...process.env };
    delete environment.NODE_TEST_CONTEXT;
    try {
      for (const [path, content] of Object.entries(addTypeScriptBackend(createTypeScriptStarter()))) {
        const destination = join(directory, path.slice(1));
        mkdirSync(dirname(destination), { recursive: true });
        writeFileSync(destination, content);
      }
      symlinkSync(resolve('node_modules'), join(directory, 'node_modules'), 'dir');
      for (const config of ['tsconfig.json', 'server/tsconfig.json']) {
        await execute(process.execPath, [resolve('node_modules/typescript/bin/tsc'), '--noEmit', '-p', config], { cwd: directory, timeout: 30000 });
      }
      try {
        await execute(process.execPath, ['--experimental-strip-types', '--test', 'server/app.test.ts'], { cwd: directory, env: environment, timeout: 30000 });
      } catch (error) {
        const failure = error as Error & { stdout?: string; stderr?: string };
        throw new Error([failure.message, failure.stdout, failure.stderr].filter(Boolean).join('\n'));
      }
      await execute(process.execPath, [resolve('node_modules/vite/bin/vite.js'), 'build'], { cwd: directory, timeout: 30000 });
    } finally { rmSync(directory, { recursive: true, force: true }); }
  }, 90000);
});
