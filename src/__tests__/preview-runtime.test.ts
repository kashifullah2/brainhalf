import { describe, expect, it } from 'vitest';
import { createPreviewModuleLoader, previewAssetUrl, previewCss } from '../lib/preview-runtime';
import { previewDependencyMap } from '../lib/preview-modules';

describe('Generated application module execution', () => {
  it('executes local dynamic imports, re-exports, JSON and TypeScript through one cache', async () => {
    const files = {
      '/src/App.tsx': "export { title } from './shared'; export const load = () => import('./shared');",
      '/src/shared/index.ts': "import data from '../data.json'; export const title: string = data.title;",
      '/src/data.json': '{"title":"Working preview"}',
    };
    const loader = createPreviewModuleLoader(files, {}, {});
    const result = loader.execute('/src/App.tsx');
    expect(result.title).toBe('Working preview');
    expect((await result.load()).title).toBe('Working preview');
    expect(loader.require('/src/App.tsx', './data.json')).toBe(loader.require('/src/shared/index.ts', '../data.json'));
  });

  it('resolves imported assets and raw source while retaining CSS URL paths', () => {
    const files = { '/public/logo.svg': '<svg />', '/src/content.txt': 'Plain text', '/src/styles.css': '.hero { background: url(/logo.svg); }' };
    const loader = createPreviewModuleLoader(files, {}, {});
    expect(loader.require('/src/App.jsx', './content.txt?raw')).toBe('Plain text');
    expect(loader.require('/src/App.jsx', '/logo.svg?url')).toContain('data:image/svg+xml');
    expect(previewCss(files, '/src/styles.css', files['/src/styles.css'])).toContain('data:image/svg+xml');
    expect(previewAssetUrl(files, '/index.html', 'https://example.com/logo.svg')).toBe('https://example.com/logo.svg');
    expect(previewCss(files, '/src/styles.css', '.icon { filter: url(#filter); }')).toBe('.icon { filter: url("#filter"); }');
  });

  it('collects dynamic, side-effect, CommonJS and HTML module dependencies', () => {
    const dependencies = previewDependencyMap({
      '/src/App.jsx': "const load = () => import('nanoid'); const dates = require('date-fns'); import 'clsx'; import './schema';",
      '/src/schema.ts': 'export { z } from "zod";',
      '/server/index.js': "import express from 'express';",
    });
    expect(Object.keys(dependencies).sort()).toEqual(['clsx', 'date-fns', 'nanoid', 'zod']);
    expect(Object.keys(previewDependencyMap({ '/index.html': '<script type="module">import { z } from "zod";</script>' }))).toEqual(['zod']);
  });

  it('does not load dependencies from unused components or test files', () => {
    expect(previewDependencyMap({
      '/src/App.jsx': 'export default () => null;',
      '/src/Unused.jsx': "import missing from 'nonexistent-package';",
      '/src/App.test.ts': "import { it } from 'vitest';",
    })).toEqual({});
  });

  it('retains a single exports object through circular dependencies', () => {
    const loader = createPreviewModuleLoader({
      '/src/first.js': "exports.name = 'first'; exports.second = require('./second').name;",
      '/src/second.js': "exports.name = require('./first').name + '-second';",
    }, {}, {});
    expect(loader.execute('/src/first.js')).toEqual({ name: 'first', second: 'first-second' });
  });
});
