/**
 * Repro for QA Phase 3 bug B11: /src/main.tsx was missing from the workspace
 * (preview owns it, model blocked from writing it), causing the production
 * build to fail with "error during build:".
 */
import { describe, expect, it } from 'vitest';
import { ensureEntryPoint, createTypeScriptStarter } from '../lib/project-starters';

describe('ensureEntryPoint (QA B11)', () => {
  it('creates /src/main.tsx when no entry point exists', () => {
    const files = ensureEntryPoint({ '/src/App.tsx': 'export default () => null;' });
    expect(files['/src/main.tsx']).toBeDefined();
    expect(files['/src/main.tsx']).toContain('createRoot');
  });

  it('does not overwrite an existing /src/main.tsx', () => {
    const custom = 'import App from "./App"; // custom';
    const files = ensureEntryPoint({ '/src/main.tsx': custom });
    expect(files['/src/main.tsx']).toBe(custom);
  });

  it('does not create .tsx if .jsx entry exists', () => {
    const files = ensureEntryPoint({ '/src/main.jsx': 'console.log("hi");' });
    expect(files['/src/main.tsx']).toBeUndefined();
  });

  it('matches the TypeScript starter entry', () => {
    const starter = createTypeScriptStarter();
    const files = ensureEntryPoint({});
    expect(files['/src/main.tsx']).toBe(starter['/src/main.tsx']);
  });
});
