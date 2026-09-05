import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';
export default defineConfig({
    plugins: [react(), tailwindcss()],
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
            '@components': path.resolve(__dirname, './src/components'),
            '@lib': path.resolve(__dirname, './src/lib'),
            '@stores': path.resolve(__dirname, './src/stores'),
        }
    },
    server: {
        port: 5173,
        proxy: {
            '/api': {
                target: 'http://127.0.0.1:8787',
                changeOrigin: true,
            },
        },
        headers: {
            'Cross-Origin-Embedder-Policy': 'require-corp',
            'Cross-Origin-Opener-Policy': 'same-origin'
        }
    },
    optimizeDeps: {
        exclude: ['@webcontainer/api']
    },
    build: {
        target: 'esnext',
        rollupOptions: {
            output: {
                manualChunks: {
                    'monaco': ['@monaco-editor/react'],
                    'xterm': ['@xterm/xterm', '@xterm/addon-fit'],
                    'three': ['three'],
                    'vendor': ['react', 'react-dom', 'zustand'],
                }
            }
        }
    }
});
