import { defineConfig } from 'vite';

export default defineConfig({
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    emptyOutDir: false,
    lib: { entry: 'src/preview-main.tsx', name: 'BrainHalfPreview', formats: ['iife'], fileName: () => 'preview-runtime.js' },
  },
});
