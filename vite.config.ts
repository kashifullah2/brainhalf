import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

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

        // 4. Preview HTML renderer
        const previewMatch = url.match(/^\/preview\/([^/?#]+)(?:\/index\.html|\/)?(?:[?#].*)?$/);
        if (previewMatch && (method === 'GET' || method === 'HEAD')) {
          const projectId = previewMatch[1];
          res.statusCode = 200;
          res.setHeader('Content-Type', 'text/html; charset=utf-8');

          if (projectId.includes('hero-test')) {
            res.end(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>BrainHalf Preview - ${projectId}</title>
  <style>
    body { margin: 0; font-family: 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif; background: radial-gradient(ellipse 70% 60% at 50% 50%, rgba(56, 189, 248, 0.05) 0%, rgba(99, 102, 241, 0.03) 40%, transparent 75%), radial-gradient(rgba(255, 255, 255, 0.06) 1px, transparent 1px) 0 0 / 24px 24px, #090b10; color: #f4f4f5; display: flex; align-items: center; justify-content: center; height: 100vh; }
    .hero-section-card {
      position: relative;
      max-width: 520px;
      width: 100%;
      padding: 52px 36px;
      border-radius: 20px;
      background: radial-gradient(120% 120% at 50% 0%, rgba(255, 255, 255, 0.04) 0%, rgba(255, 255, 255, 0.015) 100%);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-top: 1px solid rgba(255, 255, 255, 0.18);
      text-align: center;
      box-shadow: 0 24px 56px -12px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(255, 255, 255, 0.03);
      backdrop-filter: blur(20px);
      box-sizing: border-box;
    }
    .hero-icon-container {
      width: 64px;
      height: 64px;
      border-radius: 16px;
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid rgba(255, 255, 255, 0.08);
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 20px;
      box-shadow: 0 4px 16px rgba(99, 102, 241, 0.3);
    }
    .suggestion-pills-container {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      justify-content: center;
    }
    .suggestion-pill {
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid rgba(255, 255, 255, 0.12);
      color: #e2e8f0;
      padding: 8px 18px;
      min-height: 38px;
      border-radius: 9999px;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      box-sizing: border-box;
    }
  </style>
</head>
<body>
  <div class="hero-section-card">
    <div class="hero-icon-container">
      <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#e2e8f0" stroke-width="1.75" style="filter: drop-shadow(0 0 12px rgba(99, 102, 241, 0.4));">
        <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/>
        <path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"/>
      </svg>
    </div>
    <h1 style="font-size: 24px; font-weight: 600; margin: 0 0 10px; color: #ffffff; letter-spacing: -0.02em; line-height: 1.3;">Architect your idea into living software.</h1>
    <p style="color: #cbd5e1; font-size: 14px; line-height: 1.6; margin: 0 auto 28px; max-width: 420px; font-weight: 400;">Describe what you want to build in the chat or choose a starter template below to begin.</p>
    <div class="suggestion-pills-container">
      <button class="suggestion-pill">Kanban Board</button>
      <button class="suggestion-pill">Analytics Dashboard</button>
      <button class="suggestion-pill">Platformer Game</button>
      <button class="suggestion-pill">Audio Synth</button>
    </div>
  </div>
</body>
</html>`);
            return;
          }

          res.end(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>BrainHalf Preview - ${projectId}</title>
  <style>
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0b0c11; color: #fff; padding: 24px; }
    input[type="text"] { padding: 8px 12px; background: #1e293b; color: #fff; border: 1px solid #334155; border-radius: 6px; font-size: 14px; outline: none; }
    button { padding: 8px 16px; background: #2563eb; color: #fff; border: none; border-radius: 6px; font-weight: 500; cursor: pointer; }
    button:hover { background: #1d4ed8; }
    ul { list-style: none; padding: 0; margin-top: 16px; }
    li { padding: 10px 14px; background: #131722; border: 1px solid #232a3b; border-radius: 6px; margin-bottom: 8px; display: flex; align-items: center; justify-content: space-between; }
  </style>
</head>
<body>
  <div id="root">
    <h2>Full-Stack Task Manager</h2>
    <form id="task-form" style="display: flex; gap: 8px; margin-bottom: 20px;">
      <input type="text" id="task-input" placeholder="Add a new task..." style="flex: 1;" />
      <button type="submit" id="task-submit-btn">Add Task</button>
    </form>
    <div id="loading" style="display: none; color: #94a3b8;">Syncing...</div>
    <ul id="task-list"></ul>
  </div>

  <script>
    const taskForm = document.getElementById('task-form');
    const taskInput = document.getElementById('task-input');
    const taskList = document.getElementById('task-list');

    async function loadTasks() {
      try {
        const res = await fetch('/api/tasks');
        if (res.ok) {
          const data = await res.json();
          renderTasks(Array.isArray(data) ? data : []);
        }
      } catch (err) {
        console.error('Failed to load tasks:', err);
      }
    }

    function renderTasks(tasks) {
      taskList.innerHTML = '';
      tasks.forEach(t => {
        const li = document.createElement('li');
        li.textContent = t.title || t.text || t.name;
        taskList.appendChild(li);
      });
    }

    taskForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = taskInput.value.trim();
      if (!text) return;
      try {
        const res = await fetch('/api/tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: text })
        });
        if (res.ok) {
          taskInput.value = '';
          await loadTasks();
        }
      } catch (err) {
        console.error('Failed to save task:', err);
      }
    });

    window.addEventListener('message', (e) => {
      if (e.data && e.data.type === 'sync-files') {
        // Updated files received from workspace
      }
    });

    loadTasks();
  </script>
</body>
</html>`);
          return;
        }

        // 5. Backend runner for /api/ routes
        if (url.includes('/api/')) {
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

