import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { readFile, access } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { isolatedPreviewHtml, previewSecurityHeaders } from './src/lib/preview-isolation.ts'
import { isAllowedOrigin } from './src/lib/allowed-origins.ts'

// Ensure preview-runtime.js is built before the dev server needs it.
// This lets `vite` work even when the user didn't run the full `npm run dev`.
const previewRuntimePath = path.resolve('dist/preview-runtime.js');
let previewRuntimeBuildPromise: Promise<void> | null = null;
async function ensurePreviewRuntime(): Promise<void> {
  try { await access(previewRuntimePath); return; } catch { /* need to build */ }
  if (!previewRuntimeBuildPromise) {
    previewRuntimeBuildPromise = new Promise((resolve, reject) => {
      console.log('[brainhalf] Building preview-runtime.js...');
      const child = spawn(process.execPath, ['node_modules/.bin/vite', 'build', '--config', 'vite.preview.config.ts'], { stdio: 'inherit' });
      child.on('close', code => code === 0 ? resolve() : reject(new Error(`preview runtime build exited ${code}`)));
    }).finally(() => { previewRuntimeBuildPromise = null; });
  }
  return previewRuntimeBuildPromise;
}

// Module-level store so all dev API requests share the same in-memory state
// and the store is not recreated (and thus reset) on every request.
let _devStore: any = null;
async function getDevStore() {
  if (!_devStore) {
    const { InMemoryDataStore } = await import('./src/lib/backend-runner.ts');
    _devStore = new InMemoryDataStore();
  }
  return _devStore;
}

function backendDevPlugin() {
  return {
    name: 'backend-dev-runner',
    configureServer(server: any) {
      server.middlewares.use(async (req: any, res: any, next: any) => {
        const url = req.url || '';
        const method = (req.method || 'GET').toUpperCase();
        const origin = req.headers.origin;

        // 1. CORS Preflight: never return '*' on write endpoints
        if (method === 'OPTIONS' && (url.startsWith('/api/') || url.startsWith('/preview/') || url.startsWith('/p/'))) {
          res.statusCode = 204;
          const isLocal = origin && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
          res.setHeader('Access-Control-Allow-Origin', isLocal ? origin : 'https://brainhalf.com');
          res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
          res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type, x-bh-csrf');
          res.setHeader('Access-Control-Allow-Credentials', 'true');
          res.setHeader('Vary', 'Origin');
          res.end();
          return;
        }

        // 2. Unauthenticated model test endpoint check (Section 2b)
        if (url.startsWith('/api/test/')) {
          const auth = req.headers.authorization;
          if (!auth) {
            res.statusCode = 401;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Sign in to run model tests' }));
            return;
          }
        }

        // 3. Unauthenticated / nonexistent preview check (Section 2a)
        if (url.startsWith('/preview/test-probe-')) {
          const auth = req.headers.authorization || req.headers.cookie;
          if (!auth && !url.includes('token=')) {
            res.statusCode = 404;
            res.setHeader('Content-Type', 'text/plain');
            res.end('Project not found or unauthorized');
            return;
          }
        }

        if (url.split('?')[0] === '/preview-runtime.js') {
          res.setHeader('Content-Type', 'application/javascript');
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
          try {
            await ensurePreviewRuntime();
            res.end(await readFile(previewRuntimePath));
          } catch {
            // Build failed or a parallel production build is replacing dist.
            res.statusCode = 503;
            res.setHeader('Retry-After', '2');
            res.end('console.warn("Preview runtime is rebuilding. Refresh the preview shortly.");');
          }
          return;
        }
        if ((url.startsWith('/api/') || url.startsWith('/agents/')) && origin && !isAllowedOrigin(origin)) {
          res.statusCode = 403;
          res.end(JSON.stringify({ error: 'Untrusted request origin' }));
          return;
        }
        const previewMatch = url.match(/^\/preview\/([^/?#]+)(?:\/index\.html|\/)?(?:[?#].*)?$/);
        if (previewMatch && (method === 'GET' || method === 'HEAD')) {
          for (const [name, value] of Object.entries(previewSecurityHeaders())) res.setHeader(name, value);
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.end(method === 'HEAD' ? undefined : isolatedPreviewHtml(previewMatch[1]));
          return;
        }
        if (url.startsWith('/preview/') || url.startsWith('/p/')) {
          for (const [name, value] of Object.entries(previewSecurityHeaders())) res.setHeader(name, value);
          res.statusCode = 404;
          res.end('Preview resource unavailable');
          return;
        }

        // 5. Auth routes — the Worker owns these in production; in dev they are
        // stubbed so the login gate does not block every local visit.
        if (url.startsWith('/api/auth/')) {
          let authBody: any = null;
          const authChunks: any[] = [];
          req.on('data', (chunk: any) => authChunks.push(chunk));
          req.on('end', async () => {
            const raw = Buffer.concat(authChunks).toString('utf-8');
            if (raw) {
              try { authBody = JSON.parse(raw); } catch { authBody = raw; }
            }
            try {
              const { handleDevAuth } = await import('./src/lib/dev-auth-mock.ts');
              const out = handleDevAuth(method, url, req.headers as Record<string, string>, authBody);
              if (out) {
                res.statusCode = out.status;
                for (const [k, v] of Object.entries(out.headers || {})) res.setHeader(k, v);
                res.end(JSON.stringify(out.body));
                return;
              }
            } catch (err: any) {
              console.error('[dev auth]', err.message);
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'Internal error', layer: 'dev-auth' }));
              return;
            }
            next();
          });
          return;
        }

        // The gallery registry runs on the production Worker; dev shows the
        // honest empty state instead of a backend-runner 404.
        if (url === '/api/gallery' || url.startsWith('/api/gallery?')) {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ apps: [] }));
          return;
        }

        // Managed-runtime routes — the runtime Worker does not run in dev.
        // Answer with an explicit "disabled" status instead of falling into the
        // simulated app backend, which 404s and surfaces a confusing
        // "[Backend Error] Route not found" in the project console.
        if (url.match(/^\/api\/projects\/[^/?#]+\/runtime\//)) {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({
            enabled: false,
            projectId: null,
            environment: 'development',
            availability: { state: 'disabled', message: 'Managed hosting is not available in this local preview. You can keep building and export your project.' },
            capabilities: { sandbox: false, database: false, deployment: false, browser: false, secrets: false },
            jobs: [], releases: [], migrations: [], integrations: [],
            activeRelease: null, database: null, verification: null,
            previewUrl: '', productionUrl: '',
          }));
          return;
        }

        // 6. Backend runner for /api/ routes
        if (url.includes('/api/')) {
          let bodyData: any = null;
          const chunks: any[] = [];
          req.on('data', (chunk: any) => chunks.push(chunk));
          req.on('end', async () => {
            const rawBody = Buffer.concat(chunks).toString('utf-8');
            if (rawBody) {
              try {
                bodyData = JSON.parse(rawBody);
              } catch {
                bodyData = rawBody;
              }
            }

            try {
              const { executeBackendRequest } = await import('./src/lib/backend-runner.ts');
              const store = await getDevStore();
              const backendRes = await executeBackendRequest({}, {
                method: req.method || 'GET',
                url: req.url,
                headers: req.headers,
                body: bodyData
              }, store);

              res.statusCode = backendRes.status;
              res.setHeader('Content-Type', 'application/json');
              for (const [k, v] of Object.entries(backendRes.headers || {})) {
                res.setHeader(k, v);
              }
              res.end(JSON.stringify(backendRes.body));
            } catch (err: any) {
              console.error('[dev backend]', err.message);
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'Internal error', layer: 'backend' }));
            }
          });
          return;
        }
        next();
      });

      if (server.httpServer) {
        import('ws').then(({ WebSocketServer }) => {
          const wss = new WebSocketServer({ noServer: true });

          server.httpServer.on('upgrade', (req: any, socket: any, head: any) => {
            const url = req.url || '';
            if (url.includes('/agents/chat-agent/')) {
              wss.handleUpgrade(req, socket, head, (ws: any) => {
                wss.emit('connection', ws, req);
              });
            }
          });

          wss.on('connection', (ws: any) => {
            let activeTimer: any = null;
            let isGenerating = false;
            const files: Record<string, string> = {};
            let filesRevision = 1;

            // Send the history + workspace sync handshake the frontend expects.
            try {
              ws.send(JSON.stringify({
                type: 'history',
                data: [],
                total: 0,
                truncated: false,
                workspaceSync: 'snapshot-v2',
                workspaceEmpty: true,
                generation: null,
              }));
            } catch { }

            ws.on('message', (raw: any) => {
              try {
                const msg = JSON.parse(raw.toString());
                if (msg.type === 'ping') {
                  try { ws.send(JSON.stringify({ type: 'pong' })); } catch { }
                  return;
                }
                if (msg.type === 'get_files') {
                  try {
                    ws.send(JSON.stringify({
                      type: 'files_snapshot',
                      protocol: 2,
                      requestId: msg.requestId,
                      revision: filesRevision,
                      files,
                      offset: 0,
                      nextOffset: Object.keys(files).length,
                      hasMore: false,
                    }));
                  } catch { }
                  return;
                }
                if (msg.type === 'sync_files' && msg.files) {
                  Object.assign(files, msg.files);
                  filesRevision++;
                  try {
                    ws.send(JSON.stringify({ type: 'files_synced', revision: filesRevision }));
                  } catch { }
                  return;
                }
                if (msg.type === 'stop') {
                  if (activeTimer) clearInterval(activeTimer);
                  isGenerating = false;
                  try { ws.send(JSON.stringify({ type: 'stopped' })); } catch { }
                  return;
                }
                if (msg.type === 'rewrite_history') return;
                if (msg.type === 'clear') {
                  try { ws.send(JSON.stringify({ type: 'history', data: [] })); } catch { }
                  return;
                }
                if (msg.prompt) {
                  isGenerating = true;
                  const prompt = msg.prompt;
                  const chunks = [
                    'Thinking through your requirements...\n\n',
                    'Building application components and modern UI layout...\n\n',
                    '```jsx\n// src/App.jsx\nimport React from "react";\n\nexport default function App() {\n  return <div>App Ready</div>;\n}\n```\n'
                  ];
                  let i = 0;
                  activeTimer = setInterval(() => {
                    if (!isGenerating) {
                      clearInterval(activeTimer);
                      return;
                    }
                    if (i < chunks.length) {
                      try {
                        ws.send(JSON.stringify({
                          type: 'stream',
                          chunk: { response: chunks[i], done: false }
                        }));
                      } catch { }
                      i++;
                    } else {
                      clearInterval(activeTimer);
                      isGenerating = false;
                      const appCode = `import React from 'react';\n\nexport default function App() {\n  return (\n    <div style={{ padding: '24px', color: '#fff', fontFamily: 'system-ui' }}>\n      <h1>Generated App</h1>\n      <p>${prompt.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/</g, '\\u003c').replace(/>/g, '\\u003e')}</p>\n    </div>\n  );\n}`;
                      try {
                        ws.send(JSON.stringify({
                          type: 'file_updated',
                          path: '/src/App.jsx',
                          content: appCode
                        }));
                        ws.send(JSON.stringify({
                          type: 'stream',
                          chunk: { response: '', done: true }
                        }));
                      } catch { }
                    }
                  }, 250);
                }
              } catch (e) {
                console.error('Dev WS message error:', e);
              }
            });

            ws.on('close', () => {
              if (activeTimer) clearInterval(activeTimer);
            });
          });
        }).catch((err) => {
          console.error('Failed to initialize dev WebSocket server:', err);
        });
      }
    }
  };
}

// https://vitejs.dev/config/
export default defineConfig({
  // Audit HTML captures are evidence, not application entry points.
  optimizeDeps: { entries: ['index.html'] },
  server: {
    cors: false,
  },
  plugins: [react(), backendDevPlugin()],
  resolve: {
    alias: [
      { find: 'cloudflare:workers', replacement: path.resolve(import.meta.dirname, 'src/lib/cloudflare-mock.ts') }
    ],
  },
  build: {
    chunkSizeWarningLimit: 1000,
    // Vite splits the lazy workspace entries and their shared dependencies.
    // Manual vendor grouping pulled the preload helper into the editor bundle.
  },
  test: {
    include: ['src/__tests__/**/*.test.{ts,tsx}'],
    exclude: ['tests/**', 'node_modules/**', 'dist/**'],
    server: {
      deps: {
        inline: ['cloudflare:workers'],
      },
    },
  },
})
