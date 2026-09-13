import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: 'cloudflare:workers', replacement: path.resolve(import.meta.dirname, 'src/lib/cloudflare-mock.ts') }
    ],
  },
  build: {
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) {
            return 'vendor-react';
          }
          if (id.includes('node_modules/lucide-react')) {
            return 'vendor-icons';
          }
          if (id.includes('node_modules/@monaco-editor') || id.includes('node_modules/monaco-editor')) {
            return 'vendor-monaco';
          }
          if (id.includes('node_modules/jszip')) {
            return 'vendor-jszip';
          }
          if (id.includes('node_modules/sucrase')) {
            return 'vendor-sucrase';
          }
          if (id.includes('node_modules/@aws-sdk') || id.includes('node_modules/@anthropic-ai') || id.includes('node_modules/@ai-sdk')) {
            return 'vendor-ai-sdks';
          }
          if (id.includes('node_modules/@codesandbox')) {
            return 'vendor-sandpack';
          }
        },
      },
    },
  },
  test: {
    include: ['src/__tests__/**/*.test.ts'],
    exclude: ['tests/**', 'node_modules/**', 'dist/**'],
    server: {
      deps: {
        inline: ['cloudflare:workers'],
      },
    },
  },
})

