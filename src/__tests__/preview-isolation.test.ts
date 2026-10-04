import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { isolatedPreviewHtml, previewFiles, previewSecurityHeaders } from '../lib/preview-isolation';
import { previewDependencyMap, resolvePreviewImport } from '../lib/preview-modules';
import { createPreviewStorage } from '../lib/preview-storage';

describe('Untrusted preview execution boundary', () => {
  it('opts out of injected same-origin prefetch rules while retaining the opaque sandbox', () => {
    expect(previewSecurityHeaders()['Speculation-Rules']).toBe('"/preview-rules.json"');
    expect(previewSecurityHeaders()['Content-Security-Policy']).toContain('sandbox allow-scripts allow-forms;');
    expect(previewSecurityHeaders()['Content-Security-Policy']).not.toContain('allow-same-origin');
    const routes = JSON.parse(readFileSync('wrangler.toml', 'utf8').match(/run_worker_first\s*=\s*(\[[^\n]+\])/)![1]);
    expect(routes).toContain('/preview-rules.json');
  });
  it('provides per-document application storage without sharing platform or other preview values', () => {
    const first = createPreviewStorage();
    const second = createPreviewStorage();
    first.setItem('app-token', 'preview-one');
    expect(first.getItem('app-token')).toBe('preview-one');
    expect(second.getItem('app-token')).toBeNull();
    expect(first.getItem('bh_session_token')).toBeNull();
    expect(first.length).toBe(1);
    first.clear();
    expect(first.length).toBe(0);
  });
  it('preserves relative, alias, directory and JSON module resolution without server cookies', () => {
    const files = { '/src/components/Card.tsx': 'card', '/src/data/title.json': '{}', 'src/widgets/index.jsx': 'widget' };
    expect(resolvePreviewImport(files, '/src/pages/Dashboard.jsx', '../components/Card')).toBe('/src/components/Card.tsx');
    expect(resolvePreviewImport(files, '/src/pages/Dashboard.jsx', '@/data/title.json')).toBe('/src/data/title.json');
    expect(resolvePreviewImport(files, '/src/App.jsx', './widgets')).toBe('src/widgets/index.jsx');
    expect(previewDependencyMap({ '/src/App.jsx': "import clsx from 'clsx';", '/server/index.js': "import express from 'express';" })).toEqual({ clsx: 'https://esm.sh/clsx@2.1.0' });
  });
  it('escapes bootstrap source so project text cannot close the JSON script element', () => {
    const source = '</script><script>document.cookie="injected"</script>';
    const html = isolatedPreviewHtml('project', { '/src/App.jsx': source });
    expect(html).not.toContain(source);
    const serialized = html.match(/id="preview-data">(.*?)<\/script>/)![1];
    expect(JSON.parse(serialized).files['/src/App.jsx']).toBe(source);
  });

  it('never passes secret files into the browser renderer', () => {
    const files = { '/src/App.jsx': 'app', '/server/index.js': 'backend', '/server/.env': 'private', '/server/credentials.json': 'private', '/src/secrets.json': 'private', '/src/key.pem': 'private' };
    expect(previewFiles(files)).toEqual({ '/src/App.jsx': 'app' });
    expect(previewFiles(files, true)).toEqual({ '/src/App.jsx': 'app', '/server/index.js': 'backend' });
  });

  it('includes only dependency declarations from the project manifest', () => {
    const files = previewFiles({ '/package.json': JSON.stringify({ dependencies: { clsx: '^2.1.1' }, privateToken: 'secret-value', scripts: { deploy: 'private-command' } }) });
    expect(JSON.parse(files['/package.json'])).toEqual({ dependencies: { clsx: '^2.1.1' } });
    expect(JSON.stringify(files)).not.toContain('secret-value');
  });

  it('includes reachable HTML scripts and styles without exposing private root files', () => {
    const files = previewFiles({
      '/index.html': '<link href="./site.css" rel="stylesheet"><script type="module" src="./script.js"></script>',
      '/site.css': 'body { color: red; }',
      '/script.js': "import './counter.js'; import './server.js'; import './secrets.js';",
      '/counter.js': 'export const count = 0;',
      '/server.js': 'private backend',
      '/secrets.js': 'private secret',
      '/unreferenced.js': 'private helper',
    });
    expect(Object.keys(files).sort()).toEqual(['/counter.js', '/index.html', '/script.js', '/site.css']);
  });

  it('enforces unique origins with response CSP and disables active escape mechanisms', () => {
    const policy = previewSecurityHeaders()['Content-Security-Policy'];
    expect(policy).toContain('sandbox allow-scripts allow-forms;');
    for (const permission of ['allow-same-origin', 'allow-top-navigation', 'allow-popups']) expect(policy).not.toContain(permission);
    for (const directive of ["frame-src 'none'", "worker-src 'none'", "form-action 'self'", "base-uri 'none'"]) expect(policy).toContain(directive);
  });

  it('keeps the runtime independent of platform identity and caches and routes preview assets through the Worker', () => {
    const runner = readFileSync('src/components/PreviewRunner.tsx', 'utf8');
    const filesHook = readFileSync('src/lib/use-preview-files.ts', 'utf8');
    expect(runner).not.toContain('project-store');
    expect(runner).not.toContain('auth-client');
    expect(filesHook).not.toContain('project-store');
    expect(filesHook).not.toContain('auth-client');
    expect(readFileSync('src/main.tsx', 'utf8')).not.toContain('PreviewRunner');
    expect(filesHook).toContain("sync-files-delta");
    expect(filesHook).toContain('new Map<string, { source: string; code: string }>()');
    expect(readFileSync('src/components/Workspace.tsx', 'utf8')).toContain('sync-files-delta');
    expect(readFileSync('src/preview-main.tsx', 'utf8')).toContain("window.origin === 'null'");
    const routes = JSON.parse(readFileSync('wrangler.toml', 'utf8').match(/run_worker_first\s*=\s*(\[[^\n]+\])/)![1]);
    expect(routes).toEqual(expect.arrayContaining(['/api/*', '/agents/*', '/preview/*', '/p/*', '/preview-runtime.js']));
  });
});
