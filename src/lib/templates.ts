export const basicReactTemplate = {
  'package.json': {
    file: {
      contents: `
{
  "name": "preview-app",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "lucide-react": "^1.43.0"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.2.1",
    "vite": "^5.1.4"
  }
}
      `,
    },
  },
  'vite.config.js': {
    file: {
      contents: `
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
})
      `,
    },
  },
  'index.html': {
    file: {
      contents: `
<!doctype html>
<html lang="en" style="color-scheme: dark;">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Live Preview</title>
    <style>
      * { box-sizing: border-box; }
      ::-webkit-scrollbar { width: 6px; height: 6px; }
      ::-webkit-scrollbar-track { background: transparent; }
      ::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.2); border-radius: 3px; }
      ::-webkit-scrollbar-thumb:hover { background: rgba(255, 255, 255, 0.4); }
      html, body {
        margin: 0;
        padding: 0;
        height: 100%;
        min-height: 100%;
        width: 100%;
        background: #0f111a;
        color: #f3f4f6;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        overflow: hidden;
      }
      #root {
        height: 100%;
        min-height: 100%;
        width: 100%;
        display: flex;
        flex-direction: column;
      }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
      `,
    },
  },
  'src': {
    directory: {
      'main.jsx': {
        file: {
          contents: `
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './styles.css'

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, errorInfo) {
    console.error('App Preview Error:', error, errorInfo);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '24px', fontFamily: 'system-ui, sans-serif', color: '#f87171', background: '#0f1015', minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
          <div style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: '12px', padding: '24px', maxWidth: '450px' }}>
            <h3 style={{ fontSize: '16px', fontWeight: 600, color: '#f87171', marginBottom: '8px' }}>Preview Error</h3>
            <p style={{ color: '#9ca3af', fontSize: '13px', lineHeight: 1.5, marginBottom: '16px' }}>{this.state.error?.message || 'A render error occurred in the preview.'}</p>
            <button onClick={() => window.location.reload()} style={{ padding: '8px 16px', background: '#6366f1', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: 500 }}>
              Reload Preview
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)
          `,
        },
      },
      'styles.css': {
        file: {
          contents: `
body {
  font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: #0f111a;
  color: #f8fafc;
  margin: 0;
  height: 100%;
  min-height: 100%;
  width: 100%;
}

@keyframes heroGradientPulse {
  0% {
    transform: translateX(-50%) scale(0.95);
    opacity: 0.7;
  }
  50% {
    transform: translateX(-50%) scale(1.08) translateY(8px);
    opacity: 1;
  }
  100% {
    transform: translateX(-50%) scale(0.98) translateY(-6px);
    opacity: 0.8;
  }
}

@keyframes iconGlowPulse {
  0%, 100% {
    box-shadow: 0 0 24px rgba(99, 102, 241, 0.35), 0 0 48px rgba(139, 92, 246, 0.15);
  }
  50% {
    box-shadow: 0 0 32px rgba(99, 102, 241, 0.55), 0 0 60px rgba(139, 92, 246, 0.25);
  }
}
          `
        }
      },
      'App.jsx': {
        file: {
          contents: `
import React from 'react';
import { BrainCircuit } from 'lucide-react';

export default function App() {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100%',
      minHeight: '100%',
      fontFamily: "'Plus Jakarta Sans', system-ui, -apple-system, sans-serif",
      background: '#090b10',
      color: '#f4f4f5',
      padding: '24px 20px',
      boxSizing: 'border-box',
      textAlign: 'center',
      position: 'relative',
      overflow: 'hidden'
    }}>
      <div className="hero-section-card" style={{
        position: 'relative',
        zIndex: 1,
        maxWidth: '520px',
        width: '100%',
        padding: '52px 36px',
        borderRadius: '20px',
        background: 'radial-gradient(120% 120% at 50% 0%, rgba(255, 255, 255, 0.03) 0%, rgba(255, 255, 255, 0.01) 100%)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        borderTop: '1px solid rgba(255, 255, 255, 0.14)',
        textAlign: 'center',
        boxShadow: '0 20px 48px -12px rgba(0, 0, 0, 0.6)',
        backdropFilter: 'blur(16px)',
        overflow: 'hidden'
      }}>
        {/* Subtle Status Pill */}
        <div style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '8px',
          padding: '5px 12px',
          borderRadius: '9999px',
          background: 'rgba(255, 255, 255, 0.04)',
          border: '1px solid rgba(255, 255, 255, 0.07)',
          marginBottom: '20px',
          fontSize: '12px',
          fontWeight: 500,
          color: '#a1a1aa',
          letterSpacing: '0.01em',
          position: 'relative',
          zIndex: 1
        }}>
          <span style={{
            width: '6px',
            height: '6px',
            borderRadius: '50%',
            background: '#10b981',
            display: 'inline-block'
          }} />
          <span>Ready to build</span>
        </div>

        {/* Minimalist Icon */}
        <div className="hero-icon-container" style={{
          width: '64px',
          height: '64px',
          borderRadius: '16px',
          background: 'rgba(255, 255, 255, 0.03)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          margin: '0 auto 20px',
          boxShadow: '0 4px 16px rgba(0, 0, 0, 0.3)',
          position: 'relative',
          zIndex: 1
        }}>
          <BrainCircuit 
            size={30} 
            strokeWidth={1.5} 
            color="#e2e8f0" 
          />
        </div>

        <h1 style={{
          fontSize: '24px',
          fontWeight: 600,
          margin: '0 0 10px',
          color: '#ffffff',
          letterSpacing: '-0.02em',
          lineHeight: '1.3',
          fontFamily: "'Plus Jakarta Sans', system-ui, -apple-system, sans-serif",
          position: 'relative',
          zIndex: 1
        }}>
          Architect your idea into living software.
        </h1>

        <p style={{
          color: '#a1a1aa',
          fontSize: '14px',
          lineHeight: '1.6',
          margin: '0 auto 28px',
          maxWidth: '420px',
          fontWeight: 400,
          position: 'relative',
          zIndex: 1
        }}>
          Describe what you want to build in the chat. BrainHalf generates reactive components, manages state, and previews live code instantly.
        </p>

        {/* Suggestion pills with increased spacing and larger touch target */}
        <div className="suggestion-pills-container" style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '12px',
          justifyContent: 'center',
          position: 'relative',
          zIndex: 1
        }}>
          {['Kanban Board', 'Analytics Dashboard', 'Platformer Game', 'Audio Synth'].map((example) => (
            <button
              key={example}
              className="suggestion-pill"
              style={{
                background: 'rgba(255, 255, 255, 0.03)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                color: '#a1a1aa',
                padding: '8px 18px',
                minHeight: '38px',
                borderRadius: '9999px',
                fontSize: '13px',
                fontWeight: 500,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 0.15s ease'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
                e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.18)';
                e.currentTarget.style.color = '#ffffff';
                e.currentTarget.style.transform = 'translateY(-1px)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)';
                e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.08)';
                e.currentTarget.style.color = '#a1a1aa';
                e.currentTarget.style.transform = 'translateY(0)';
              }}
            >
              {example}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
          `,
        },
      },
    },
  },
};

/**
 * Full-stack starter: a polished todo app proving the real backend contract.
 * - /server/routes.js  -> real API handlers + SQLite schema, executed in the
 *   project's Durable Object (serveProjectApi in src/agent.ts)
 * - /src/App.jsx       -> React frontend calling fetch('/api/...'), with
 *   loading / empty / error states per the DESIGN EXCELLENCE mandate
 */
export const fullStackStarterTemplate = {
  'server': {
    directory: {
      'routes.js': {
        file: {
          contents: `
export const schema = \`
  CREATE TABLE IF NOT EXISTS todos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    done INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
\`;

export const routes = {
  'GET /api/todos': async ({ db }) => {
    const rows = db.query('SELECT * FROM todos ORDER BY id DESC');
    // Seed starter content once, when the table is empty.
    if (rows.length === 0) {
      const seeds = ['Design the landing page', 'Wire up the real API', 'Ship v1'];
      for (const title of seeds) db.exec('INSERT INTO todos (title, done) VALUES (?, ?)', title, 0);
      return Response.json(db.query('SELECT * FROM todos ORDER BY id DESC'));
    }
    return Response.json(rows);
  },

  'POST /api/todos': async ({ db, req }) => {
    const { title } = await req.json();
    if (!title || !String(title).trim()) {
      return Response.json({ error: 'Title is required' }, { status: 400 });
    }
    const r = db.exec('INSERT INTO todos (title) VALUES (?)', String(title).trim());
    return Response.json({ id: r.lastRowId, title: String(title).trim(), done: 0 });
  },

  'PATCH /api/todos/:id': async ({ db, req, params }) => {
    const { done } = await req.json();
    db.exec('UPDATE todos SET done = ? WHERE id = ?', done ? 1 : 0, params.id);
    return Response.json({ ok: true });
  },

  'DELETE /api/todos/:id': async ({ db, params }) => {
    db.exec('DELETE FROM todos WHERE id = ?', params.id);
    return Response.json({ ok: true });
  },
};
          `,
        },
      },
    },
  },
  'src': {
    directory: {
      'App.jsx': {
        file: {
          contents: `
import React, { useState, useEffect } from 'react';
import { Check, Plus, Trash2, Loader2, ListTodo, AlertTriangle } from 'lucide-react';

export default function App() {
  const [todos, setTodos] = useState([]);
  const [input, setInput] = useState('');
  const [status, setStatus] = useState('loading'); // loading | ready | error
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setStatus('loading');
    try {
      const res = await fetch('/api/todos');
      if (!res.ok) throw new Error('API returned ' + res.status);
      setTodos(await res.json());
      setStatus('ready');
    } catch (e) {
      console.error(e);
      setStatus('error');
    }
  };

  useEffect(() => { load(); }, []);

  const addTodo = async (e) => {
    e.preventDefault();
    if (!input.trim() || saving) return;
    setSaving(true);
    try {
      const res = await fetch('/api/todos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: input.trim() }),
      });
      if (!res.ok) throw new Error('create failed');
      const created = await res.json();
      setTodos([created, ...todos]);
      setInput('');
    } catch (e) { console.error(e); }
    finally { setSaving(false); }
  };

  const toggleTodo = async (todo) => {
    setTodos(todos.map(t => t.id === todo.id ? { ...t, done: t.done ? 0 : 1 } : t));
    try {
      await fetch('/api/todos/' + todo.id, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ done: !todo.done }),
      });
    } catch (e) { console.error(e); load(); }
  };

  const deleteTodo = async (id) => {
    setTodos(todos.filter(t => t.id !== id));
    try { await fetch('/api/todos/' + id, { method: 'DELETE' }); }
    catch (e) { console.error(e); load(); }
  };

  const doneCount = todos.filter(t => t.done).length;

  return (
    <div className="min-h-full w-full flex items-start justify-center px-4 py-10"
      style={{ background: '#090b10', fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>
      <div className="w-full max-w-xl">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.3)' }}>
            <ListTodo size={20} color="#a5b4fc" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-white" style={{ letterSpacing: '-0.02em' }}>Tasks</h1>
            <p className="text-xs" style={{ color: '#71717a' }}>
              {status === 'ready' ? doneCount + ' of ' + todos.length + ' complete · backed by a real database' : 'Full-stack starter · real API + SQLite'}
            </p>
          </div>
        </div>

        <form onSubmit={addTodo} className="flex gap-2 mt-6 mb-6">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="What needs doing?"
            className="flex-1 rounded-xl px-4 py-3 text-sm text-white outline-none"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)' }}
          />
          <button type="submit" disabled={saving || !input.trim()}
            className="rounded-xl px-4 py-3 text-sm font-medium text-white flex items-center gap-2 disabled:opacity-40"
            style={{ background: '#6366f1' }}>
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
            Add
          </button>
        </form>

        {status === 'loading' && (
          <div className="space-y-2">
            {[0, 1, 2].map(i => (
              <div key={i} className="rounded-xl h-14 animate-pulse" style={{ background: 'rgba(255,255,255,0.04)' }} />
            ))}
          </div>
        )}

        {status === 'error' && (
          <div className="rounded-xl p-6 text-center" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)' }}>
            <AlertTriangle size={22} color="#f87171" className="mx-auto mb-2" />
            <p className="text-sm font-medium" style={{ color: '#fca5a5' }}>Couldn't reach the API</p>
            <p className="text-xs mt-1 mb-4" style={{ color: '#71717a' }}>The backend may still be starting. Try again.</p>
            <button onClick={load} className="text-xs font-medium px-4 py-2 rounded-lg text-white" style={{ background: '#6366f1' }}>Retry</button>
          </div>
        )}

        {status === 'ready' && todos.length === 0 && (
          <div className="rounded-xl p-10 text-center" style={{ border: '1px dashed rgba(255,255,255,0.12)' }}>
            <ListTodo size={28} color="#52525b" className="mx-auto mb-3" />
            <p className="text-sm font-medium text-white">All clear</p>
            <p className="text-xs mt-1" style={{ color: '#71717a' }}>Add your first task above to get started.</p>
          </div>
        )}

        {status === 'ready' && todos.length > 0 && (
          <div className="space-y-2">
            {todos.map(todo => (
              <div key={todo.id}
                className="rounded-xl px-4 py-3 flex items-center gap-3 transition-colors"
                style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
                <button onClick={() => toggleTodo(todo)}
                  className="w-5 h-5 rounded-md flex items-center justify-center shrink-0"
                  style={{
                    background: todo.done ? '#10b981' : 'transparent',
                    border: todo.done ? '1px solid #10b981' : '1px solid rgba(255,255,255,0.25)',
                  }}>
                  {todo.done ? <Check size={13} color="#fff" /> : null}
                </button>
                <span className="flex-1 text-sm text-white" style={{ textDecoration: todo.done ? 'line-through' : 'none', opacity: todo.done ? 0.45 : 1 }}>
                  {todo.title}
                </span>
                <button onClick={() => deleteTodo(todo.id)} className="p-1.5 rounded-lg hover:bg-white/10" style={{ color: '#71717a' }}>
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
          `,
        },
      },
      'styles.css': {
        file: {
          contents: `
* { box-sizing: border-box; }
html, body, #root { height: 100%; margin: 0; }
body { background: #090b10; color: #f4f4f5; }
input:focus { border-color: rgba(99,102,241,0.6) !important; }
          `,
        },
      },
    },
  },
};
