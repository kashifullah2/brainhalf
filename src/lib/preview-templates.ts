/**
 * Source text for the edge preview runtime and the fresh-workspace starter.
 *
 * These are strings, not code that runs here. They are either transpiled and
 * served to the preview iframe, or seeded into a new project's files. Every one
 * of them is a pure function of its arguments, which is the only reason they can
 * live outside ChatAgent -- anything that needed `this` stayed in agent.ts.
 *
 * \${...} sequences inside these templates are evaluated in the BROWSER, not
 * here. Do not "fix" the escaping; src/__tests__/p6-preview-source.test.ts
 * asserts that the interpolation reaches the client as literal text.
 */

export const PREVIEW_ERROR_CARD_SRC = `<div style={{ padding: '24px', fontFamily: 'system-ui, sans-serif', color: '#f87171', background: '#0f1015', minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
              <div style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: '12px', padding: '24px', maxWidth: '450px' }}>
                <h3 style={{ fontSize: '16px', fontWeight: 600, color: '#f87171', marginBottom: '8px' }}>Preview Error</h3>
                <p style={{ color: '#9ca3af', fontSize: '13px', lineHeight: 1.5, marginBottom: '16px' }}>\${this.state.error?.message || 'A render error occurred.'}</p>
                <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                  <button onClick={() => {
                    try {
                      if (window.parent && window.parent !== window) {
                        window.parent.postMessage({
                          type: 'preview-auto-fix',
                          file: 'src/App.jsx',
                          error: this.state.error?.message || 'A render error occurred.'
                        }, window.location.origin);
                      }
                    } catch (_) {}
                  }} style={{ padding: '8px 16px', background: '#6366f1', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: 500 }}>
                    Auto-Fix with AI
                  </button>
                  <button onClick={() => window.location.reload()} style={{ padding: '8px 16px', background: '#27272a', color: '#d4d4d8', border: '1px solid #3f3f46', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: 500 }}>
                    Reload Preview
                  </button>
                </div>
              </div>
            </div>`;

export const STARTER_APP_JSX = `import React from 'react';
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
      background: 'radial-gradient(ellipse 70% 60% at 50% 50%, rgba(56, 189, 248, 0.05) 0%, rgba(99, 102, 241, 0.03) 40%, transparent 75%), radial-gradient(rgba(255, 255, 255, 0.06) 1px, transparent 1px) 0 0 / 24px 24px, #090b10',
      color: '#f4f4f5',
      padding: '32px 20px',
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
        background: 'radial-gradient(120% 120% at 50% 0%, rgba(255, 255, 255, 0.04) 0%, rgba(255, 255, 255, 0.015) 100%)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        borderTop: '1px solid rgba(255, 255, 255, 0.18)',
        textAlign: 'center',
        boxShadow: '0 24px 56px -12px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(255, 255, 255, 0.03)',
        backdropFilter: 'blur(20px)',
        overflow: 'hidden'
      }}>
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
            size={36} 
            strokeWidth={1.75} 
            color="#e2e8f0" 
            style={{ filter: 'drop-shadow(0 0 12px rgba(99, 102, 241, 0.4))' }}
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
          color: '#cbd5e1',
          fontSize: '14px',
          lineHeight: '1.6',
          margin: '0 auto 28px',
          maxWidth: '420px',
          fontWeight: 400,
          position: 'relative',
          zIndex: 1
        }}>
          Describe what you want to build in the chat or choose a starter template below to begin.
        </p>

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
                background: 'rgba(255, 255, 255, 0.04)',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                color: '#e2e8f0',
                padding: '8px 18px',
                minHeight: '44px',
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
}`;

export const STARTER_MAIN_JSX = `import React from 'react';
import ReactDOM from 'react-dom/client';
import * as AppModule from './App.jsx';

if (typeof window !== 'undefined' && window.fetch) {
  const origFetch = window.fetch;
  window.fetch = function(input, init) {
    try {
      let url = typeof input === 'string' ? input : (input instanceof URL ? input.toString() : (input?.url || ''));
      if (url.startsWith('/api/')) {
        const base = window.location.pathname.replace(/(\\/index\\.html.*|\\/src\\/.*|\\/)?$/, '');
        const newUrl = base + url;
        if (typeof input === 'string') {
          input = newUrl;
        } else if (input instanceof URL) {
          input = new URL(newUrl, window.location.origin);
        } else if (input instanceof Request) {
          input = new Request(newUrl, init || input);
        }
      }
    } catch (_) {}
    return origFetch.call(this, input, init);
  };
}

const App = AppModule.default || AppModule.App || Object.values(AppModule).find(v => typeof v === 'function') || (() => React.createElement('div', { style: { padding: '24px', color: '#f87171' } }, 'No component found in App.jsx'));

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, errorInfo) {
    console.error('Edge Preview Error:', error, errorInfo);
  }
  render() {
    if (this.state.hasError) {
      return (
        ${PREVIEW_ERROR_CARD_SRC}
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
  </React.StrictMode>
);`;

export const STARTER_STYLES_CSS = `* { box-sizing: border-box; }
body {
  margin: 0;
  padding: 0;
  background: #0b0c10;
  color: #f8fafc;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  -webkit-font-smoothing: antialiased;
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}`;

export function buildPreviewIndexHtml(dynamicImportMapJson: string): string {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>BrainHalf Edge Preview</title>
    <link rel="icon" type="image/x-icon" href="/favicon.ico" />
    <script>
      (function() {
        var _w = console.warn;
        console.warn = function() {
          if (arguments[0] && typeof arguments[0] === 'string' && arguments[0].includes('cdn.tailwindcss.com should not be used in production')) return;
          _w.apply(console, arguments);
        };
      })();
    </script>
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="preconnect" href="https://esm.sh" crossorigin />
    <link rel="modulepreload" href="https://esm.sh/react@18.2.0" />
    <link rel="modulepreload" href="https://esm.sh/react-dom@18.2.0/client" />
    <link rel="modulepreload" href="https://esm.sh/lucide-react@0.344.0?external=react" />
    <link rel="stylesheet" href="./src/styles.css" />
    <script>
      window.process = window.process || { env: { NODE_ENV: 'development' } };
      window.__BH_ENV__ = { MODE: 'development', DEV: true, PROD: false, BASE_URL: '/' };
    </script>
    <script type="importmap">
      ${dynamicImportMapJson}
    </script>
    <script type="module">
      const originalFetch = window.fetch;
      window.fetch = async (...args) => {
        let urlObj;
        try {
          urlObj = new URL(typeof args[0] === 'string' ? args[0] : (args[0]?.url || ''), window.location.origin);
        } catch (_) {
          return originalFetch(...args);
        }
        if (urlObj.pathname.startsWith('/api/')) {
          try {
            let apiModule;
            try { apiModule = await import('./src/api.mock.js'); } catch (_) {}
            if (apiModule && (apiModule.default || apiModule.mockApi)) {
              const handler = apiModule.default || apiModule.mockApi;
              const req = new Request(...args);
              const res = await handler(req);
              if (res instanceof Response) return res;
            }

            const res = await originalFetch(...args);
            if (!res.ok) {
              try {
                const clone = res.clone();
                const data = await clone.json();
                if (data && (data.layer === 'backend' || data.error)) {
                  if (window.parent !== window) {
                    window.parent.postMessage({
                      type: 'preview-error',
                      layer: 'backend',
                      error: data.error || ('Backend ' + res.status + ': ' + res.statusText),
                      file: data.file || 'server/index.js'
                    }, window.location.origin);
                  }
                }
              } catch (_) {}
            }
            return res;
          } catch (e) {
            console.error('Backend API Fetch Error:', e);
            if (window.parent !== window) {
              window.parent.postMessage({
                type: 'preview-error',
                layer: 'backend',
                error: '[Backend Error] Failed to connect to API server: ' + (e.message || String(e)),
                file: 'server/index.js'
              }, window.location.origin);
            }
            throw e;
          }
        }
        return originalFetch(...args);
      };
    </script>
    <style>
      html, body, #root { height: 100%; min-height: 100%; width: 100%; margin: 0; padding: 0; }
      body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #090a0f; color: #fff; overflow: hidden; }
      @keyframes bh-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      @keyframes bh-pulse { 0%, 100% { opacity: 0.7; } 50% { opacity: 1; } }
      .bh-preview-loader {
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        height: 100%; min-height: 100%; gap: 14px; color: #94a3b8; font-size: 13px; font-weight: 500;
        animation: bh-pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
      }
      .bh-spinner {
        width: 24px; height: 24px; border: 2.5px solid rgba(99, 102, 241, 0.2);
        border-top-color: #5558e4; border-radius: 50%; animation: bh-spin 0.8s linear infinite;
      }
      @media (prefers-reduced-motion: reduce) {
        .bh-preview-loader, .bh-spinner { animation: none; }
      }
    </style>
  </head>
  <body>
    <div id="root">
      <div class="bh-preview-loader" role="status" aria-live="polite">
        <div class="bh-spinner"></div>
        <span>Connecting Cloudflare Edge Preview...</span>
      </div>
    </div>
    <script type="module">
      import { createRoot } from 'react-dom/client';
      import React from 'react';

      const post = (payload) => {
        try {
          if (window.parent !== window) window.parent.postMessage(payload, window.location.origin);
        } catch (_) {}
      };

      window.addEventListener('error', (event) => {
        post({
          type: 'preview-error',
          file: event.filename || 'preview',
          error: event.message || 'Unknown runtime error',
          lineno: event.lineno,
          colno: event.colno
        });
      });

      window.addEventListener('unhandledrejection', (event) => {
        post({
          type: 'preview-error',
          file: 'async',
          error: String(event.reason?.message || event.reason || 'Unhandled Promise Rejection')
        });
      });

      function renderFatal(message) {
        const rootEl = document.getElementById('root');
        if (!rootEl) return;
        const root = createRoot(rootEl);
        root.render(
          React.createElement('div', {
            style: {
              padding: '24px', fontFamily: 'system-ui, -apple-system, sans-serif',
              color: '#f87171', background: '#0f1015', minHeight: '100vh',
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              justifyContent: 'center', textAlign: 'center'
            }
          }, React.createElement('div', {
            style: {
              background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)',
              borderRadius: '12px', padding: '24px', maxWidth: '450px'
            }
          }, [
            React.createElement('h3', { key: 'h', style: { fontSize: '16px', fontWeight: 600, color: '#f87171', marginBottom: '8px' } }, 'Preview Mount Error'),
            React.createElement('p', { key: 'p', style: { color: '#9ca3af', fontSize: '13px', lineHeight: 1.5, marginBottom: '16px' } }, message),
            React.createElement('button', { key: 'b', onClick: () => window.location.reload(), style: { padding: '8px 16px', background: '#5558e4', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: 500 } }, 'Reload Preview')
          ]))
        );
      }

      async function mountApp() {
        try {
          // The harness entry is served by this object for every project, so it
          // always resolves. Import it and let it own rendering.
          try {
            await import('./src/main.jsx');
            post({ type: 'preview-success' });
            return;
          } catch (harnessErr) {
            console.warn('Harness entry failed, falling back to direct App mount:', harnessErr);
          }

          let mod = null;
          try {
            mod = await import('./src/App.jsx');
          } catch (e1) {
            try {
              mod = await import('./src/App.tsx');
            } catch (e2) {
              throw new Error('Could not load App.jsx or App.tsx: ' + (e1?.message || e2?.message));
            }
          }

          const AppComp = mod.default || mod.App || Object.values(mod).find(v => typeof v === 'function');
          if (!AppComp) throw new Error('No default or named React component found in App.jsx');

          const rootEl = document.getElementById('root');
          if (!rootEl) throw new Error('Preview root element is missing');

          let Router = null;
          try {
            const rrd = await import('react-router-dom');
            Router = rrd.HashRouter || rrd.MemoryRouter || rrd.BrowserRouter;
          } catch (_) {}

          const appNode = Router
            ? React.createElement(Router, null, React.createElement(AppComp))
            : React.createElement(AppComp);
          createRoot(rootEl).render(appNode);
          post({ type: 'preview-success' });
        } catch (err) {
          console.error('Edge Preview Mount Error:', err);
          post({ type: 'preview-error', file: 'src/App.jsx', error: err?.message || String(err) });
          try { renderFatal(err?.message || String(err)); } catch (_) {}
        }
      }

      mountApp();
    </script>
  </body>
</html>`;
}

export function buildHarnessModuleSrc(): string {
  return `import React from 'react';
import ReactDOM from 'react-dom/client';
import * as RouterDom from 'react-router-dom';
import * as AppModule from './App.jsx';

if (typeof window !== 'undefined' && window.fetch) {
  const origFetch = window.fetch;
  window.fetch = function(input, init) {
    try {
      let url = typeof input === 'string' ? input : (input instanceof URL ? input.toString() : (input?.url || ''));
      if (url.startsWith('/api/')) {
        const base = window.location.pathname.replace(/(\\/index\\.html.*|\\/src\\/.*|\\/)?$/, '');
        const newUrl = base + url;
        if (typeof input === 'string') {
          input = newUrl;
        } else if (input instanceof URL) {
          input = new URL(newUrl, window.location.origin);
        } else if (input instanceof Request) {
          input = new Request(newUrl, init || input);
        }
      }
    } catch (_) {}
    return origFetch.call(this, input, init);
  };
}

const App = AppModule.default || AppModule.App || Object.values(AppModule).find(v => typeof v === 'function') || (() => React.createElement('div', { style: { padding: '24px', color: '#f87171' } }, 'No component found in App.jsx'));

function isRouterConflict(error) {
  if (!error) return false;
  const msg = error.message || String(error) || '';
  const stack = error.stack || '';
  return (
    msg.includes('cannot render a <Router> inside another <Router>') ||
    msg.includes('You cannot render a <Router> inside another <Router>') ||
    ((stack.includes('@remix-run/router') || stack.includes('react-router')) &&
     (stack.includes('router.mjs') || stack.includes('react-router.mjs')))
  );
}

class SafeRouterApp extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasRouterConflict: false };
  }
  static getDerivedStateFromError(error) {
    if (isRouterConflict(error)) return { hasRouterConflict: true };
    return null;
  }
  componentDidCatch(error) {
    if (isRouterConflict(error)) this.setState({ hasRouterConflict: true });
  }
  render() {
    if (this.state.hasRouterConflict) return React.createElement(App);
    const Router = RouterDom?.HashRouter || RouterDom?.MemoryRouter || RouterDom?.BrowserRouter;
    if (Router) return React.createElement(Router, null, React.createElement(App));
    return React.createElement(App);
  }
}

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    if (isRouterConflict(error)) return { hasError: false, error: null };
    return { hasError: true, error };
  }
  componentDidCatch(error, errorInfo) {
    if (isRouterConflict(error)) return;
    console.error('Edge Preview Error:', error, errorInfo);
    try {
      if (window.parent !== window) {
        window.parent.postMessage({
          type: 'preview-error',
          file: 'src/App.jsx',
          error: error?.message || String(error)
        }, window.location.origin);
      }
    } catch (_) {}
  }
  render() {
    if (this.state.hasError) {
      return (
        ${PREVIEW_ERROR_CARD_SRC}
      );
    }
    return this.props.children;
  }
}

const rootEl = document.getElementById('root');
if (rootEl) {
  ReactDOM.createRoot(rootEl).render(
    <React.StrictMode>
      <ErrorBoundary>
        <SafeRouterApp />
      </ErrorBoundary>
    </React.StrictMode>
  );
}`;
}

export function buildCssJsModule(cleanPath: string, content: string): string {
  return `
                (function() {
                  const id = 'bh-style-' + ${JSON.stringify(cleanPath)}.replace(/[^a-zA-Z0-9]/g, '-');
                  let el = document.getElementById(id);
                  if (!el) {
                    el = document.createElement('style');
                    el.id = id;
                    document.head.appendChild(el);
                  }
                  el.textContent = ${JSON.stringify(content)};
                })();
                export default ${JSON.stringify(content)};
              `;
}

export function buildMissingComponentStub(cleanPath: string): string {
  const compName = cleanPath.split('/').pop()?.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_]/g, '') || 'FallbackComponent';
  return `import React from 'react';
export default function ${compName}(props) {
  return React.createElement('div', {
    style: {
      padding: '16px 20px',
      margin: '12px 0',
      border: '1px dashed rgba(245, 158, 11, 0.4)',
      borderRadius: '8px',
      background: 'rgba(245, 158, 11, 0.06)',
      color: '#f59e0b',
      fontSize: '13px',
      fontFamily: 'sans-serif',
      display: 'flex',
      alignItems: 'center',
      gap: '8px'
    }
  }, 'Component [' + ${JSON.stringify(cleanPath)} + '] not found');
}
`;
}
