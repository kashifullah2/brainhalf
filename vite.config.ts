import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

function backendDevPlugin() {
  return {
    name: 'backend-dev-runner',
    configureServer(server: any) {
      server.middlewares.use(async (req: any, res: any, next: any) => {
        const url = req.url || '';
        if (url.includes('/api/') && !url.includes('/api/test/')) {
          let bodyData: any = null;
          const chunks: any[] = [];
          req.on('data', (chunk: any) => chunks.push(chunk));
          req.on('end', async () => {
            const rawBody = Buffer.concat(chunks).toString('utf-8');
            if (rawBody) {
              try {
                bodyData = JSON.parse(rawBody);
              } catch (_) {
                bodyData = rawBody;
              }
            }

            try {
              const { executeBackendRequest } = await import('./src/lib/backend-runner.ts');
              const backendRes = await executeBackendRequest({}, {
                method: req.method || 'GET',
                url: req.url,
                headers: req.headers,
                body: bodyData
              });

              res.statusCode = backendRes.status;
              res.setHeader('Content-Type', 'application/json');
              for (const [k, v] of Object.entries(backendRes.headers || {})) {
                res.setHeader(k, v);
              }
              res.end(JSON.stringify(backendRes.body));
            } catch (err: any) {
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: err.message, layer: 'backend' }));
            }
          });
          return;
        }
        next();
      });
    }
  };
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), backendDevPlugin()],
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

