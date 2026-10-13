import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  define: { 'process.env.NODE_ENV': '"test"' },
  resolve: {
    alias: [{ find: /^cloudflare:workers$/, replacement: new URL('../../src/lib/cloudflare-mock.ts', import.meta.url).pathname }],
  },
  test: {
    root: new URL('../..', import.meta.url).pathname,
    include: ['docs/audits/**/*.test.ts'],
    exclude: ['node_modules/**', 'dist/**', 'tests/**'],
    server: { deps: { inline: ['cloudflare:workers'] } },
  },
});
