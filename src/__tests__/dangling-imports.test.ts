/**
 * Repro for the QA_BUG_NOTES live failure: the builder wrote App.tsx with
 * `import ... from './components/Sidebar'` but never wrote the Sidebar file.
 * The preview then failed with "Cannot resolve module". Syntax validation
 * passes (the import statement is valid); only an import-resolution check
 * catches the dangling reference and queues the missing file for [AUTO-FIX].
 *
 * Failing test first: findDanglingImports must report imports whose target
 * file exists neither in the pending batch nor in the already-saved project.
 */
import { describe, expect, it } from 'vitest';
import { findDanglingImports } from '../lib/preview-module-transform';

describe('findDanglingImports', () => {
  it('reports a component imported but never written', () => {
    const files = new Map([
      ['/src/App.tsx', `import Sidebar from './components/Sidebar';\nexport default function App() { return <Sidebar />; }`],
    ]);
    const dangling = findDanglingImports(files, new Set());
    expect(dangling).toHaveLength(1);
    expect(dangling[0]).toMatchObject({
      importer: '/src/App.tsx',
      specifier: './components/Sidebar',
    });
  });

  it('does not report imports that resolve within the pending batch', () => {
    const files = new Map([
      ['/src/App.tsx', `import Sidebar from './components/Sidebar';`],
      ['/src/components/Sidebar.tsx', `export default function Sidebar() { return null; }`],
    ]);
    expect(findDanglingImports(files, new Set())).toHaveLength(0);
  });

  it('does not report imports that resolve to already-saved project files', () => {
    const files = new Map([
      ['/src/App.tsx', `import { Button } from './components/Button';`],
    ]);
    const existing = new Set(['/src/components/Button.tsx']);
    expect(findDanglingImports(files, existing)).toHaveLength(0);
  });

  it('resolves extensionless and index imports', () => {
    const files = new Map([
      ['/src/App.tsx', `import a from './a';\nimport b from '../shared/b';\nimport c from './dir';`],
      ['/src/a.ts', `export default 1;`],
      ['/shared/b.tsx', `export default 2;`],
      ['/src/dir/index.tsx', `export default 3;`],
    ]);
    expect(findDanglingImports(files, new Set())).toHaveLength(0);
  });

  it('ignores bare package imports and non-JS files', () => {
    const files = new Map([
      ['/src/App.tsx', `import React from 'react';\nimport './styles.css';`],
      ['/src/styles.css', `body { margin: 0; }`],
    ]);
    expect(findDanglingImports(files, new Set())).toHaveLength(0);
  });
});
