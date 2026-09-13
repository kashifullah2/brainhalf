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
        min-height: 100vh;
        width: 100%;
        background: #0f111a;
        color: #f3f4f6;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        overflow-x: hidden;
      }
      #root {
        min-height: 100vh;
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
  min-height: 100vh;
  width: 100%;
}
          `
        }
      },
      'App.jsx': {
        file: {
          contents: `
import React from 'react';

export default function App() {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif',
      background: 'radial-gradient(ellipse at 50% 15%, rgba(99, 102, 241, 0.12) 0%, rgba(10, 15, 30, 0.98) 70%, #07090e 100%)',
      color: '#f8fafc',
      padding: '32px 20px',
      boxSizing: 'border-box',
      textAlign: 'center',
      position: 'relative',
      overflow: 'hidden'
    }}>
      <div style={{
        position: 'absolute',
        top: '20%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        width: '480px',
        height: '240px',
        background: 'radial-gradient(circle, rgba(139, 92, 246, 0.15) 0%, rgba(59, 130, 246, 0.05) 50%, transparent 70%)',
        filter: 'blur(40px)',
        pointerEvents: 'none',
        zIndex: 0
      }} />

      <div style={{
        position: 'relative',
        zIndex: 1,
        maxWidth: '560px',
        width: '100%',
        padding: '48px 36px',
        borderRadius: '24px',
        background: 'rgba(15, 23, 42, 0.65)',
        border: '1px solid rgba(255, 255, 255, 0.09)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        boxShadow: '0 30px 60px -15px rgba(0, 0, 0, 0.65), 0 0 0 1px rgba(255, 255, 255, 0.04) inset'
      }}>
        <div style={{
          width: '68px',
          height: '68px',
          borderRadius: '18px',
          background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.2) 0%, rgba(168, 85, 247, 0.2) 100%)',
          border: '1px solid rgba(168, 85, 247, 0.35)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          margin: '0 auto 20px',
          boxShadow: '0 12px 30px -5px rgba(99, 102, 241, 0.3), inset 0 1px 1px rgba(255, 255, 255, 0.2)'
        }}>
          <img 
            src="/brainhalflogo.png" 
            alt="BrainHalf Logo" 
            style={{ width: '42px', height: '42px', objectFit: 'contain', filter: 'drop-shadow(0 2px 8px rgba(0,0,0,0.4))' }} 
          />
        </div>

        <div style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '8px',
          padding: '5px 14px',
          borderRadius: '999px',
          background: 'rgba(99, 102, 241, 0.1)',
          border: '1px solid rgba(129, 140, 248, 0.25)',
          color: '#a5b4fc',
          fontSize: '11px',
          fontWeight: 600,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          marginBottom: '16px'
        }}>
          <span style={{
            width: '6px',
            height: '6px',
            borderRadius: '50%',
            background: '#818cf8',
            boxShadow: '0 0 8px #818cf8'
          }} />
          Autonomous AI Studio
        </div>

        <h1 style={{
          fontSize: '28px',
          fontWeight: '700',
          margin: '0 0 12px',
          letterSpacing: '-0.03em',
          lineHeight: '1.2',
          background: 'linear-gradient(135deg, #ffffff 30%, #cbd5e1 70%, #94a3b8 100%)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent'
        }}>
          Welcome to BrainHalf
        </h1>

        <p style={{
          color: '#94a3b8',
          fontSize: '14px',
          lineHeight: '1.65',
          margin: '0 0 28px',
          fontWeight: 400
        }}>
          Your real-time edge compiler and AI software engineer are online. Send a prompt in the chat panel to synthesize full-stack React components and interactive web apps instantly.
        </p>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
          gap: '10px',
          marginBottom: '28px',
          textAlign: 'left'
        }}>
          <div style={{
            padding: '12px 14px',
            borderRadius: '12px',
            background: 'rgba(255, 255, 255, 0.03)',
            border: '1px solid rgba(255, 255, 255, 0.06)'
          }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: '#c7d2fe', marginBottom: '4px' }}>Edge Preview</div>
            <div style={{ fontSize: '11px', color: '#64748b', lineHeight: '1.4' }}>Zero cold-start hot reload runtime</div>
          </div>
          <div style={{
            padding: '12px 14px',
            borderRadius: '12px',
            background: 'rgba(255, 255, 255, 0.03)',
            border: '1px solid rgba(255, 255, 255, 0.06)'
          }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: '#c7d2fe', marginBottom: '4px' }}>Modular React</div>
            <div style={{ fontSize: '11px', color: '#64748b', lineHeight: '1.4' }}>Multi-file components & styles</div>
          </div>
          <div style={{
            padding: '12px 14px',
            borderRadius: '12px',
            background: 'rgba(255, 255, 255, 0.03)',
            border: '1px solid rgba(255, 255, 255, 0.06)'
          }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: '#c7d2fe', marginBottom: '4px' }}>Production Ready</div>
            <div style={{ fontSize: '11px', color: '#64748b', lineHeight: '1.4' }}>Instant export or global deploy</div>
          </div>
        </div>

        <div style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '8px',
          padding: '6px 16px',
          borderRadius: '999px',
          background: 'rgba(16, 185, 129, 0.08)',
          border: '1px solid rgba(16, 185, 129, 0.22)',
          color: '#34d399',
          fontSize: '12px',
          fontWeight: 500
        }}>
          <span style={{
            width: '6px',
            height: '6px',
            borderRadius: '50%',
            background: '#10b981',
            boxShadow: '0 0 8px #10b981'
          }} />
          Zero Cold-Start Runtime Active
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
