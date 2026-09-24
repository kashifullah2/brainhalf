import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { generateProjectZipBlob } from '../lib/zip-export';

async function exportFiles(files: Record<string, string>) {
  const blob = await generateProjectZipBlob(files);
  return JSZip.loadAsync(await blob.arrayBuffer());
}

describe('Generated application exports', () => {
  it('creates a mount importing the generated TSX app without nonexistent styles', async () => {
    const zip = await exportFiles({ '/src/App.tsx': 'export default function App() { return <h1>Typescript</h1>; }' });
    const main = await zip.file('src/main.jsx')!.async('string');
    expect(main).toContain('from "./App.tsx"');
    expect(main).not.toContain('App.jsx');
    expect(main).not.toContain('.css');
  });

  it('preserves an existing TypeScript entry, config, and README', async () => {
    const files = {
      '/src/App.tsx': 'export default () => null;',
      '/src/main.tsx': 'import App from "./App"; console.log(App);',
      '/vite.config.ts': 'export default {};',
      '/README.md': 'Custom setup instructions',
    };
    const zip = await exportFiles(files);
    expect(zip.file('src/main.jsx')).toBeNull();
    expect(zip.file('vite.config.js')).toBeNull();
    expect(await zip.file('src/main.tsx')!.async('string')).toBe(files['/src/main.tsx']);
    expect(await zip.file('index.html')!.async('string')).toContain('/src/main.tsx');
    expect(await zip.file('README.md')!.async('string')).toBe(files['/README.md']);
  });

  it('exports a plain HTML application without injecting a React starter', async () => {
    const html = '<h1>Vanilla app</h1><script src="./script.js"></script>';
    const zip = await exportFiles({ '/index.html': html, '/script.js': 'document.querySelector("h1").textContent = "Loaded";' });
    expect(await zip.file('index.html')!.async('string')).toBe(html);
    expect(zip.file('src/main.jsx')).toBeNull();
    expect(zip.file('vite.config.js')).toBeNull();
    const manifest = JSON.parse(await zip.file('package.json')!.async('string'));
    expect(manifest.dependencies?.react).toBeUndefined();
    expect(manifest.scripts.dev).toBe('vite');
  });
});
