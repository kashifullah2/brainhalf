import { describe, it, expect } from 'vitest';
import { buildDynamicImportMap, isHarnessEntry } from '../lib/preview-import-map';

/**
 * The import map is built from generated, prompt-controlled code and embedded
 * inline in the preview's <script type="importmap"> tag. This pins both the
 * resolution a generated app relies on and the escaping that keeps a crafted
 * package name from breaking out of that tag. It was previously untested,
 * buried inside ChatAgent.
 */
describe('7.3 buildDynamicImportMap', () => {
  it('pins the pre-installed packages to their esm.sh URLs', () => {
    const map = JSON.parse(buildDynamicImportMap([]));
    expect(map.imports['react']).toBe('https://esm.sh/react@18.2.0');
    expect(map.imports['react-dom/client']).toBe('https://esm.sh/react-dom@18.2.0/client?external=react');
    expect(map.imports['lucide-react']).toBe('https://esm.sh/lucide-react@0.344.0?external=react');
  });

  it('resolves an import found in the generated source', () => {
    const map = JSON.parse(buildDynamicImportMap([
      { path: '/src/App.jsx', content: "import { motion } from 'framer-motion';" },
    ]));
    expect(map.imports['framer-motion']).toBe('https://esm.sh/framer-motion@10.16.4?external=react,react-dom');
  });

  it('honours the version the generated package.json pins', () => {
    const map = JSON.parse(buildDynamicImportMap([
      { path: '/package.json', content: JSON.stringify({ dependencies: { zustand: '^4.4.0' } }) },
      { path: '/src/App.jsx', content: "import { create } from 'zustand';" },
    ]));
    // The caret is stripped; the resolved URL carries the pinned version. The
    // ?external suffix is only added to packages whose name implies a React
    // peer dependency, and zustand is not one of them.
    expect(map.imports['zustand']).toBe('https://esm.sh/zustand@4.4.0');
  });

  it('never emits the characters that would terminate the enclosing script tag', () => {
    // The serialized map is embedded inline in <script type="importmap">. A
    // package name carrying `</script>` would close that tag early and let
    // generated markup execute as script. Two guards keep it out: the bare
    // specifier validator rejects < > " ' ` and whitespace, and the serializer
    // escapes < > & regardless. This asserts the observable end-to-end
    // guarantee rather than either guard on its own.
    const hostile = [
      "import a from '</script><img src=x onerror=alert(1)>';",
      "import b from 'pkg</script>';",
      "import c from '-->%3cscript%3e';",
    ];
    for (const line of hostile) {
      const raw = buildDynamicImportMap([
        { path: '/src/App.jsx', content: line },
      ]);
      expect(raw).not.toContain('</script>');
      expect(raw).not.toContain('<script');
      expect(() => JSON.parse(raw)).not.toThrow();
    }
  });

  it('skips relative imports and already-mapped packages', () => {
    const map = JSON.parse(buildDynamicImportMap([
      { path: '/src/App.jsx', content: "import Header from './Header';\nimport React from 'react';" },
    ]));
    expect(map.imports['./Header']).toBeUndefined();
    expect(Object.values(map.imports).filter(u => String(u).includes('/Header')).length).toBe(0);
  });

  it('ignores imports in non-source files', () => {
    const map = JSON.parse(buildDynamicImportMap([
      { path: '/README.md', content: "import x from 'totally-fake-pkg';" },
    ]));
    expect(map.imports['totally-fake-pkg']).toBeUndefined();
  });
});

describe('7.3 isHarnessEntry', () => {
  it('recognises the main entry the preview harness serves', () => {
    expect(isHarnessEntry('/src/main.jsx')).toBe(true);
    expect(isHarnessEntry('src/main.jsx')).toBe(true);
    expect(isHarnessEntry('/src/main.tsx')).toBe(true);
  });

  it('does not treat App as the harness entry', () => {
    expect(isHarnessEntry('/src/App.jsx')).toBe(false);
  });
});
