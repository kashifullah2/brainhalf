/**
 * Repro for QA Phase 3 bug B1: the generated worker/backend.test.mjs imported
 * '../dist-worker/index.js' — a build artifact that only exists if the build
 * script (which the builder can overwrite) ran esbuild. When the build script
 * lost its esbuild step, tests failed with a confusing module-not-found error
 * instead of testing anything.
 *
 * The template test must be self-contained: bundle the worker from source
 * on-the-fly rather than depending on a pre-built artifact.
 */
import { describe, expect, it } from 'vitest';
import { addWorkersBackend } from '../lib/workers-starter';

describe('workers-starter backend test template', () => {
  it('does not import from dist-worker (build artifact)', () => {
    const files = addWorkersBackend({
      'package.json': JSON.stringify({ name: 'test', scripts: { build: 'vite build' } }),
    });
    const testContent = files['/worker/backend.test.mjs'] as string;
    expect(testContent).toBeDefined();
    // Must not depend on a pre-built artifact that may not exist.
    expect(testContent).not.toContain('dist-worker/index.js');
  });

  it('bundles the worker from source for testing', () => {
    const files = addWorkersBackend({
      'package.json': JSON.stringify({ name: 'test', scripts: { build: 'vite build' } }),
    });
    const testContent = files['/worker/backend.test.mjs'] as string;
    // Should use esbuild (a devDependency) to bundle worker/index.ts on the fly.
    expect(testContent).toContain('esbuild');
    expect(testContent).toContain('index.ts');
  });
});
