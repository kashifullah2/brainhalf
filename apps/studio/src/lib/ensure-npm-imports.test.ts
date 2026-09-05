import { describe, it, expect } from 'vitest';
import { extractNpmPackageNames, npmPackageFromImport } from './ensure-npm-imports';

describe('npmPackageFromImport', () => {
  it('resolves bare package names', () => {
    expect(npmPackageFromImport('phaser')).toBe('phaser');
    expect(npmPackageFromImport('three/addons/loaders/GLTFLoader.js')).toBe('three');
  });

  it('resolves scoped packages', () => {
    expect(npmPackageFromImport('@react-three/fiber')).toBe('@react-three/fiber');
  });

  it('ignores relative and virtual paths', () => {
    expect(npmPackageFromImport('./game.js')).toBeNull();
    expect(npmPackageFromImport('@/components/foo')).toBeNull();
    expect(npmPackageFromImport('node:fs')).toBeNull();
  });
});

describe('extractNpmPackageNames', () => {
  it('finds imports in ES module syntax', () => {
    const source = `import Phaser from 'phaser';\nimport { x } from './local.js';`;
    expect(extractNpmPackageNames(source)).toEqual(['phaser']);
  });

  it('finds dynamic imports and require', () => {
    const source = `
      const p = import('three');
      const q = require('cannon-es');
    `;
    expect(extractNpmPackageNames(source)).toEqual(['three', 'cannon-es']);
  });
});
