import { afterEach, describe, expect, it, vi } from 'vitest';
import { prepareProjectExport } from '../lib/project-export';
import { exportToGitHub, importFromGitHub } from '../lib/github-export';
import { isBlockedSecretFile } from '../lib/secret-files';

afterEach(() => vi.unstubAllGlobals());
describe('source export boundary', () => {
  it('replaces local credentials with blank examples and excludes caches and private configuration', () => {
    const result = prepareProjectExport({ '/server/.env': 'DATABASE_URL=secret-db\nCF_API_TOKEN=platform-secret', '/.dev.vars': 'EMAIL_KEY=secret-mail', '/.env.example': 'SESSION_SECRET=unsafe-example', '/.npmrc': '//registry/:_authToken=private', '/.aws/credentials': 'private', '/node_modules/a.js': 'cached', '/src/main.ts': 'console.log(import.meta.env.VITE_PUBLIC_URL, process.env.DATABASE_URL)' });
    expect(Object.keys(result.files)).not.toContain('/server/.env');
    expect(Object.keys(result.files)).not.toContain('/.aws/credentials');
    expect(result.files['/.env.example']).toContain('DATABASE_URL=\n');
    expect(result.files['/.env.example']).toContain('SESSION_SECRET=\n');
    expect(JSON.stringify(result.files)).not.toMatch(/secret-db|platform-secret|unsafe-example|_authToken/);
    expect(result.environmentKeys).not.toContain('CF_API_TOKEN');
    expect(result.files['/.gitignore']).toContain('.dev.vars.*');
  });
  it('refuses AWS access key IDs in exported source', () => {
    expect(() => prepareProjectExport({ '/worker.ts': 'const key = "AKIAIOSFODNN7EXAMPLE";' })).toThrow('contains a credential');
    expect(() => prepareProjectExport({ '/worker.ts': 'const key = "ASIAIOSFODNN7EXAMPLE";' })).toThrow('contains a credential');
    // Ordinary identifiers that merely resemble the shape must not trip the filter.
    expect(prepareProjectExport({ '/worker.ts': 'const AKIA = 1;' }).files['/worker.ts']).toContain('const AKIA = 1;');
  });
  it('refuses inline credentials and conflicting aliases before making network requests', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await expect(exportToGitHub({ '/worker.ts': 'const key = "cfut_' + 'a'.repeat(45) + '";' }, 'app', 'token')).rejects.toThrow('contains a credential');
    expect(fetch).not.toHaveBeenCalled();
    expect(() => prepareProjectExport({ '/app.ts': 'a', 'app.ts': 'b' })).toThrow('duplicate');
  });
  it('omits traversal and platform capability material and keeps ordinary source', () => {
    const result = prepareProjectExport({ '../outside': 'private', '/worker.ts': 'export default {}', '/.env': 'BRAINHALF_SERVICE_TOKEN=private\nSESSION_SECRET=private' });
    expect(result.files['/worker.ts']).toBe('export default {}');
    expect(result.environmentKeys).toEqual(['SESSION_SECRET']);
    for (const path of ['/.dev.vars', '/server/.dev.vars.production', '/.ssh/id_rsa', '/.npmrc', '/.aws/config']) expect(isBlockedSecretFile(path)).toBe(true);
  });
});

function github({ missing = false, conflict = false, failure = 0 } = {}) {
  let refs = 0;
  const calls: Array<{ path: string; method: string; body: any }> = [];
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname; const method = init.method || 'GET'; const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ path, method, body });
    if (path === '/user') return Response.json({ login: 'owner' });
    if (path === '/repos/owner/app' && method === 'GET') return Response.json({ default_branch: 'develop', size: 1 }, { status: failure || (missing ? 404 : 200) });
    if (path === '/user/repos') return Response.json({ default_branch: 'develop', size: 1 });
    if (path.endsWith('/git/ref/heads/develop')) return Response.json({ object: { sha: (++refs > 1 && conflict ? 'b' : 'a').repeat(40) } });
    if (path.endsWith('/git/commits/' + 'a'.repeat(40))) return Response.json({ tree: { sha: 'c'.repeat(40) } });
    if (path.endsWith('/git/trees')) return Response.json({ sha: 'd'.repeat(40) });
    if (path.endsWith('/git/commits')) return Response.json({ sha: 'e'.repeat(40) });
    if (method === 'PATCH') return Response.json({});
    throw new Error('Unexpected request ' + path);
  });
  vi.stubGlobal('fetch', fetch); return calls;
}
describe('GitHub export concurrency and privacy', () => {
  it('uses the default branch, preserves the existing tree and refuses force pushes', async () => {
    const calls = github();
    expect(await exportToGitHub({ '/app.ts': 'hello' }, 'app', 'token')).toBe('https://github.com/owner/app');
    expect(calls.find(call => call.path.endsWith('/git/trees'))?.body.base_tree).toBe('c'.repeat(40));
    expect(calls.find(call => call.method === 'PATCH')).toMatchObject({ path: '/repos/owner/app/git/refs/heads/develop', body: { force: false } });
  });
  it('creates new repositories privately', async () => {
    const calls = github({ missing: true }); await exportToGitHub({}, 'app', 'token');
    expect(calls.find(call => call.path === '/user/repos')?.body.private).toBe(true);
  });
  it('leaves a concurrently advanced branch untouched', async () => {
    const calls = github({ conflict: true });
    await expect(exportToGitHub({}, 'app', 'token')).rejects.toThrow('New commits arrived');
    expect(calls.some(call => call.method === 'PATCH')).toBe(false);
  });
  it.each([401, 403, 500])('does not create a repository after HTTP %s', async failure => {
    const calls = github({ failure }); await expect(exportToGitHub({}, 'app', 'token')).rejects.toThrow();
    expect(calls.some(call => call.method === 'POST')).toBe(false);
  });
});

function githubImportMock({ missing = false, truncated = false } = {}) {
  const blobs: Record<string, unknown> = {
    ['1'.repeat(40)]: 'export default function App() { return <h1>Hi</h1>; }',
    ['2'.repeat(40)]: 'DATABASE_URL=should-not-be-imported',
    ['3'.repeat(40)]: 'body { margin: 0; }',
  };
  const fetch = vi.fn(async (url: string) => {
    const path = new URL(url).pathname;
    if (path === '/user') return Response.json({ login: 'owner' });
    if (path === '/repos/owner/app') return missing
      ? Response.json({ message: 'Not Found' }, { status: 404 })
      : Response.json({ default_branch: 'main', size: 10 });
    if (path === '/repos/owner/app/git/trees/main' || path === '/repos/owner/app/git/trees/main?recursive=1') {
      return Response.json({
        truncated,
        tree: [
          { path: 'src/App.tsx', type: 'blob', sha: '1'.repeat(40), size: 48 },
          { path: '.env', type: 'blob', sha: '2'.repeat(40), size: 32 },
          { path: 'styles.css', type: 'blob', sha: '3'.repeat(40), size: 18 },
          { path: 'node_modules/pkg/index.js', type: 'blob', sha: '4'.repeat(40), size: 10 },
          { path: 'assets', type: 'tree', sha: '5'.repeat(40) },
        ],
      });
    }
    const blob = path.match(/\/git\/blobs\/([a-f0-9]{40})$/)?.[1];
    if (blob && blobs[blob] !== undefined) {
      return Response.json({ encoding: 'base64', content: btoa(String(blobs[blob])) });
    }
    throw new Error('Unexpected request ' + path);
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

describe('GitHub import', () => {
  it('pulls default-branch source while skipping secret and vendored files', async () => {
    githubImportMock();
    const result = await importFromGitHub('app', 'token');
    expect(result.repoUrl).toBe('https://github.com/owner/app');
    expect(result.branch).toBe('main');
    expect(result.files['/src/App.tsx']).toContain('<h1>Hi</h1>');
    expect(result.files['/styles.css']).toBe('body { margin: 0; }');
    expect(Object.keys(result.files)).toHaveLength(2);
    expect(result.skipped).toContain('/.env');
    expect(result.skipped.some(path => path.includes('node_modules'))).toBe(true);
    expect(JSON.stringify(result.files)).not.toContain('should-not-be-imported');
  });
  it('reports a missing repository without reading any blobs', async () => {
    const fetch = githubImportMock({ missing: true });
    await expect(importFromGitHub('app', 'token')).rejects.toThrow('not found');
    expect(fetch.mock.calls.some(([url]) => String(url).includes('/git/blobs/'))).toBe(false);
  });
  it('refuses repositories whose listing GitHub truncated', async () => {
    githubImportMock({ truncated: true });
    await expect(importFromGitHub('app', 'token')).rejects.toThrow('too large');
  });
  it('validates repo, owner and token before any network request', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await expect(importFromGitHub('../evil', 'token')).rejects.toThrow('repository name');
    await expect(importFromGitHub('app', 'bad\ntoken')).rejects.toThrow('token');
    await expect(importFromGitHub('app', 'token', 'not valid!')).rejects.toThrow('owner');
    expect(fetch).not.toHaveBeenCalled();
  });
});
