import { describe, expect, it } from 'vitest';
import { lucideCompatibleSource, LUCIDE_BRAND_SOURCE } from '../lib/lucide-compat';
import { sourceSnapshot } from '../runtime/source';
import { PILOT_LIMITS } from '../runtime/types';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { build } from 'vite';
import { createTypeScriptStarter } from '../lib/project-starters';

describe('legacy brand icons in publishing snapshots', () => {
  it('redirects missing brands and aliases while retaining other icons and nested relative paths', () => {
    const source = `import { Github as GitHubIcon, Mail, Linkedin, Twitter } from "lucide-react";
export const icons = [GitHubIcon, Mail, Linkedin, Twitter];`;
    const files = { 'src/components/profile/Social.tsx': source };
    const fixed = lucideCompatibleSource(files);
    expect(fixed['src/components/profile/Social.tsx']).toContain("import { Mail } from 'lucide-react';");
    expect(fixed['src/components/profile/Social.tsx']).toContain("import { Github as GitHubIcon, Linkedin, Twitter } from '../../brainhalf-brand-icons';");
    expect(fixed['src/brainhalf-brand-icons.tsx']).toBe(LUCIDE_BRAND_SOURCE);
    expect(files['src/components/profile/Social.tsx']).toBe(source);
    expect(lucideCompatibleSource(fixed)).toEqual(fixed);
  });

  it('does not rewrite comments, text examples or unrelated modules, or overwrite user files', () => {
    const examples = '// import { Github } from "lucide-react";\n'
      + '/* import { Twitter } from "lucide-react"; */\n'
      + 'const sample = `import { Linkedin } from "lucide-react";`;\n'
      + 'const text = \'import { Github } from "lucide-react";\';\n'
      + 'import { Github } from "another-library";\n';
    expect(lucideCompatibleSource({ 'src/Example.tsx': examples })).toEqual({ 'src/Example.tsx': examples });
    const fixed = lucideCompatibleSource({
      'App.tsx': 'import { Github } from "lucide-react"; export default Github;',
      'src/brainhalf-brand-icons.tsx': 'user content',
    });
    expect(fixed['src/brainhalf-brand-icons.tsx']).toBe('user content');
    expect(fixed['src/brainhalf-brand-icons-1.tsx']).toBe(LUCIDE_BRAND_SOURCE);
    expect(fixed['App.tsx']).toContain("from './src/brainhalf-brand-icons-1'");
    expect(lucideCompatibleSource(fixed)).toEqual(fixed);
  });

  it('pins the same repaired revision in the browser and runtime and still enforces source limits', async () => {
    const input = { '/package.json': '{}', '/src/App.tsx': 'import { Github, Linkedin, Twitter } from "lucide-react";' };
    const pinned = await sourceSnapshot(input);
    expect(pinned.files['src/brainhalf-brand-icons.tsx']).toBe(LUCIDE_BRAND_SOURCE);
    expect(await sourceSnapshot(pinned.files)).toEqual(pinned);
    expect((await sourceSnapshot({ ...input, '/src/App.tsx': input['/src/App.tsx'] + '\n// edit' })).revision).not.toBe(pinned.revision);
    const full = Object.fromEntries(Array.from({ length: PILOT_LIMITS.sourceFiles - 2 }, (_, i) => [`src/file${i}.txt`, '']));
    await expect(sourceSnapshot({ ...input, ...full })).rejects.toThrow('source limit');
    await expect(sourceSnapshot({ ...input, '/large.txt': 'a'.repeat(PILOT_LIMITS.sourceBytes - 500) })).rejects.toThrow('source limit');
  });

  it('builds a strict TypeScript app with the removed icons against modern Lucide', async () => {
    const files = createTypeScriptStarter();
    files['/src/App.tsx'] = `import { Github, Linkedin, Twitter, Mail } from 'lucide-react';
export default function App() { return <main><Github size={24} /><Linkedin aria-label="LinkedIn" /><Twitter /><Mail /></main>; }`;
    const snapshot = await sourceSnapshot(files);
    const directory = mkdtempSync(join(tmpdir(), 'brainhalf-icon-build-'));
    try {
      for (const [path, content] of Object.entries(snapshot.files)) {
        const target = join(directory, path);
        mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, content);
      }
      symlinkSync(resolve('node_modules'), join(directory, 'node_modules'), 'dir');
      await promisify(execFile)(process.execPath, [resolve('node_modules/typescript/bin/tsc'), '--noEmit', '-p', 'tsconfig.json'], { cwd: directory, timeout: 30_000 });
      await build({ root: directory, configFile: false, logLevel: 'silent' });
    } finally { rmSync(directory, { recursive: true, force: true }); }
  }, 60_000);
});
