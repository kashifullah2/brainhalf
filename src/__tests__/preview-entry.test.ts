import { describe, expect, it } from 'vitest';
import { relativeProjectImport, selectAppEntry, selectHtmlEntry } from '../lib/preview-entry';
import { buildHarnessModuleSrc, buildPreviewIndexHtml, STARTER_APP_JSX } from '../lib/preview-templates';
import { basicReactTemplate } from '../lib/templates';

describe('Shared preview entry selection', () => {
  it('selects HTML applications instead of a seeded React starter', () => {
    expect(selectHtmlEntry({ '/src/App.jsx': STARTER_APP_JSX, '/index.html': '<h1>HTML application</h1>' })).toBe('/index.html');
    expect(selectHtmlEntry({ 'public/index.html': '<h1>HTML application</h1>' })).toBe('public/index.html');
    expect(selectHtmlEntry({ '/src/App.tsx': 'export default () => null;', '/index.html': '<div id="root"></div>' })).toBeNull();
  });
  it.each([STARTER_APP_JSX, basicReactTemplate.src.directory['App.jsx'].file.contents])('prefers generated TSX over a seeded JSX app and main', starter => {
    const files = {
      '/src/App.jsx': starter,
      '/src/main.jsx': "import App from './App.jsx';",
      '/src/App.tsx': 'export default function App() { return <h1>Generated</h1>; }',
    };
    expect(selectAppEntry(files)).toBe('/src/App.tsx');
    expect(selectAppEntry(Object.fromEntries(Object.entries(files).reverse()))).toBe('/src/App.tsx');
  });

  it('honors an explicit non-starter main import when both apps are generated', () => {
    expect(selectAppEntry({
      '/src/App.jsx': 'export default () => null;',
      '/src/App.tsx': 'export default () => null;',
      '/src/main.jsx': "import App from './App.jsx';",
    })).toBe('/src/App.jsx');
  });

  it('resolves extensionless imports and bare storage paths', () => {
    expect(selectAppEntry({ 'src/main.tsx': "import App from './App';", 'src/App.tsx': 'export default () => null;' })).toBe('src/App.tsx');
  });

  it('keeps a starter when no generated App exists and handles missing entries', () => {
    expect(selectAppEntry({ '/src/App.jsx': STARTER_APP_JSX })).toBe('/src/App.jsx');
    expect(selectAppEntry({ '/src/Other.tsx': 'export default () => null;' })).toBeNull();
  });

  it('builds correct module paths for nested and root apps', () => {
    expect(relativeProjectImport('/src/main.jsx', '/src/App.tsx')).toBe('./App.tsx');
    expect(relativeProjectImport('/src/main.jsx', '/App.tsx')).toBe('../App.tsx');
    expect(relativeProjectImport('/nested/main.tsx', '/src/App.tsx')).toBe('../src/App.tsx');
  });

  it('uses the selected entry in both edge mounting paths', () => {
    expect(buildHarnessModuleSrc('./App.tsx')).toContain('import * as AppModule from "./App.tsx";');
    const html = buildPreviewIndexHtml('{}', '/src/App.tsx');
    expect(html).toContain('const mod = await import("./src/App.tsx")');
    expect(html).not.toContain("import('./src/App.jsx')");
  });

  it('escapes a path before inserting it in the HTML script', () => {
    expect(buildPreviewIndexHtml('{}', '/src/</script>/App.tsx')).toContain('\\u003c/script>');
  });
});
