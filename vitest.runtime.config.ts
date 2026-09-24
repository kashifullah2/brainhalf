import { defineConfig } from 'vitest/config';
import path from 'node:path';
export default defineConfig({
  resolve: { alias: { 'cloudflare:workers': path.resolve('src/lib/cloudflare-mock.ts') } },
  test: { include: ['runtime-tests/**/*.test.ts'], testTimeout: 15_000 },
});
