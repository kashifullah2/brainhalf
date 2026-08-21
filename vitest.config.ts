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
    include: [
      'src/**/*.test.ts',
      'src/**/*.test.tsx',
      'server/**/*.test.ts',
      'functions/**/*.test.ts',
    ],
    environment: 'node',
  },
});
