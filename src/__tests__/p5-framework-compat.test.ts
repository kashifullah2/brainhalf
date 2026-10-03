/**
 * P5: Framework compatibility — verify the preview import map versions
 * match package.json, so generated apps don't get version mismatches.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('P5 framework version consistency', () => {
  it('preview import map React version matches package.json', () => {
    const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
    const pkgReact = pkg.dependencies.react.replace(/^\^/, '');

    const importMapSrc = readFileSync(resolve(root, 'src/lib/preview-import-map.ts'), 'utf8');
    const match = importMapSrc.match(/'react': 'https:\/\/esm\.sh\/react@([\d.]+)'/);
    expect(match).not.toBeNull();
    expect(match![1]).toBe(pkgReact);
  });

  it('preview import map react-dom version matches package.json', () => {
    const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
    const pkgDom = pkg.dependencies['react-dom'].replace(/^\^/, '');

    const importMapSrc = readFileSync(resolve(root, 'src/lib/preview-import-map.ts'), 'utf8');
    const match = importMapSrc.match(/'react-dom': 'https:\/\/esm\.sh\/react-dom@([\d.]+)/);
    expect(match).not.toBeNull();
    expect(match![1]).toBe(pkgDom);
  });

  it('TypeScript starter uses React 19 createRoot (not deprecated ReactDOM.render)', () => {
    const starters = readFileSync(resolve(root, 'src/lib/project-starters.ts'), 'utf8');
    expect(starters).toContain('createRoot');
    expect(starters).not.toContain('ReactDOM.render');
  });
});
