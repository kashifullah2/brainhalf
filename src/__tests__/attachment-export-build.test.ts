import { expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { build } from 'vite';
import JSZip from 'jszip';
import { attachmentModules, validateAttachment } from '../lib/builder-attachments';
import { createTypeScriptStarter } from '../lib/project-starters';
import { generateProjectZipBlob } from '../lib/zip-export';
import { createPreviewModuleLoader } from '../lib/preview-runtime';

it('exports uploaded assets that compile in strict TypeScript, build, and retain every byte', async () => {
  // This document crosses the module chunk boundary; the image covers normal UI use.
  const uploads = [
    { name: 'logo.png', mime: 'image/png', bytes: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==', 'base64') },
    { name: 'download.txt', mime: 'text/plain', bytes: Buffer.from('A'.repeat(400_000)) },
  ];
  const files = createTypeScriptStarter();
  const assets = uploads.map(upload => {
    const file = { id: crypto.randomUUID(), ...validateAttachment({ name: upload.name, mime: upload.mime, size: upload.bytes.length, text: '', dataUrl: `data:${upload.mime};base64,${upload.bytes.toString('base64')}` }) };
    const modules = attachmentModules(file);
    Object.assign(files, modules.files);
    return { ...modules, file };
  });
  files['/src/App.tsx'] = `${assets.map((asset, index) => `import asset${index} from '.${asset.path.slice('/src'.length)}';`).join('\n')}
export default function App() { return <main><img src={asset0} alt="Uploaded logo" /><a href={asset1} download="download.txt">Download</a></main>; }`;
  const preview = createPreviewModuleLoader(files, {}, {});
  for (const asset of assets) expect(preview.require('/src/App.tsx', '.' + asset.path.slice('/src'.length)).default).toBe(asset.file.dataUrl);
  const zip = await JSZip.loadAsync(await (await generateProjectZipBlob(files, 'Uploaded assets')).arrayBuffer());
  const directory = mkdtempSync(join(tmpdir(), 'brainhalf-upload-export-'));
  try {
    for (const entry of Object.values(zip.files)) {
      if (entry.dir) continue;
      const target = join(directory, entry.name);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, await entry.async('nodebuffer'));
    }
    symlinkSync(resolve('node_modules'), join(directory, 'node_modules'), 'dir');
    // TS 7 exposes a CLI, not the older compiler API. Reject process errors too.
    await promisify(execFile)(process.execPath, [resolve('node_modules/typescript/bin/tsc'), '--noEmit', '-p', 'tsconfig.json'], { cwd: directory, timeout: 30_000 });
    await build({ root: directory, configFile: false, logLevel: 'silent' });
    expect(existsSync(join(directory, 'dist/index.html'))).toBe(true);
    const require = createRequire(import.meta.url);
    for (const asset of assets) {
      expect(require(join(directory, asset.path.slice(1))).default).toBe(asset.file.dataUrl);
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
}, 90_000);
