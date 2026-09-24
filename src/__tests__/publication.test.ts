import { describe, expect, it } from 'vitest';
import { publicationTarget, assertProductionServices, productionHealthPath } from '../runtime/publication';
import { MANAGED_DEFAULTS } from '../runtime/managed-types';
import { COLLECT_STATIC_ARTIFACT } from '../runtime/artifact';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const files = { 'package.json': '{"scripts":{"build":"vite build"}}' };
const ready = { emailReady: true, googleReady: true, ownerVerified: true, ownerEmail: 'owner@example.com', from: 'sender@example.com', googleCallback: 'https://example.com/callback' };

describe('Publication readiness', () => {
  it('recognizes static builds and complete Workers apps', () => {
    expect(publicationTarget(files)).toBe('static');
    expect(publicationTarget({ '/package.json': '{"brainhalf":{"runtime":"workers"}}', '/worker/index.ts': 'worker' })).toBe('workers');
  });
  it.each(['server/index.ts', 'server.mjs', 'src/server.ts', 'backend/app.py', 'requirements.txt', 'worker/index.ts', 'pages/api/items.ts', 'app/api/items/route.ts'])('never drops the backend at %s to publish a partial app', path => {
    expect(() => publicationTarget({ ...files, [path]: 'backend' })).toThrow('Workers deployment entry');
  });
  it('rejects a server framework without a supported deployment entry', () => {
    expect(() => publicationTarget({ 'package.json': '{"dependencies":{"next":"16"}}' })).toThrow('backend');
  });
  it('detects servers launched by start scripts while allowing Vite frontends', () => {
    expect(() => publicationTarget({ 'package.json': JSON.stringify({ scripts: { build: 'vite build', start: 'NODE_ENV=production node index.js' } }) })).toThrow('Workers deployment entry');
    expect(publicationTarget({ 'package.json': JSON.stringify({ scripts: { build: 'vite build', start: 'vite --host 0.0.0.0' } }) })).toBe('static');
  });
  it('requires production providers for enabled features, including account recovery', () => {
    expect(() => assertProductionServices(MANAGED_DEFAULTS, ready)).not.toThrow();
    expect(() => assertProductionServices(MANAGED_DEFAULTS, { ...ready, ownerVerified: false })).toThrow('Verify your BrainHalf');
    expect(() => assertProductionServices(MANAGED_DEFAULTS, { ...ready, googleReady: false })).toThrow('Google sign-in');
    expect(() => assertProductionServices({ ...MANAGED_DEFAULTS, emailEnabled: false }, { ...ready, emailReady: false })).toThrow('Password signup');
    expect(() => assertProductionServices({ ...MANAGED_DEFAULTS, emailEnabled: false, googleEnabled: false, magicLinkEnabled: false, passwordEnabled: false, welcomeEnabled: false }, { ...ready, emailReady: false, googleReady: false, ownerVerified: false })).not.toThrow();
  });
  it('keeps production health checks under the app API', () => {
    expect(productionHealthPath(files)).toBe('/api/health');
    expect(productionHealthPath({ 'package.json': '{"brainhalf":{"healthPath":"/api/status"}}' })).toBe('/api/status');
    for (const healthPath of ['https://external.example/health', '/api/auth/logout', '/api/../delete', '/api/status?delete=1']) {
      expect(() => productionHealthPath({ 'package.json': JSON.stringify({ brainhalf: { healthPath } }) })).toThrow('health endpoint');
    }
  });
  it('collects real static assets and returns an honest 404 for missing APIs', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'brainhalf-static-publish-'));
    try {
      await mkdir(join(dir, 'dist'));
      await writeFile(join(dir, 'dist/index.html'), '<h1>My app</h1>');
      const output = join(dir, 'artifact.json');
      await promisify(execFile)(process.execPath, ['-e', COLLECT_STATIC_ARTIFACT.replace('/workspace/artifact.json', output)], { cwd: dir });
      const artifact = JSON.parse(await readFile(output, 'utf8'));
      expect(Buffer.from(artifact.assets['/index.html'].content, 'base64').toString()).toBe('<h1>My app</h1>');
      const module = await import('data:text/javascript,' + encodeURIComponent(artifact.worker));
      expect(module.default.fetch().status).toBe(404);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
