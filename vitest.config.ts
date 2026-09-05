import path from 'path';
import { defineConfig } from 'vitest/config';

// Separate from vite.config.ts so the dev-server plugins (and the OCR dev proxy)
// are not loaded during tests.
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
    },
  },
  test: {
    // server/ and functions/ are included as well as src/. Without them a test
    // file next to the code it covers would silently never run: the auth
    // primitives had no coverage at all, and nothing would have said so.
    //
    // The globs are anchored to this project's own directories. A bare
    // `**/*.test.ts` picked up an unrelated, untracked monorepo that had been
    // scaffolded alongside it and ran none of the tests below.
    include: [
      'src/**/*.test.ts',
      'src/**/*.test.tsx',
      'server/**/*.test.ts',
      'functions/**/*.test.ts',
      'queue-worker/**/*.test.ts',
    ],
    exclude: ['**/node_modules/**', '**/dist/**', 'apps/**', 'packages/**'],
    environment: 'node',
  },
});
