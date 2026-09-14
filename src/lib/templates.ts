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
      background: 'radial-gradient(ellipse at 25% 15%, rgba(20, 184, 166, 0.14) 0%, rgba(9, 13, 22, 0.98) 65%, #05070b 100%)',
      color: '#f8fafc',
      padding: '24px 20px',
      boxSizing: 'border-box',
      textAlign: 'center',
      position: 'relative',
      overflow: 'hidden'
    }}>
      <style dangerouslySetInnerHTML={{ __html: '@keyframes heroGradientPulse { 0% { transform: scale(0.96); opacity: 0.75; } 50% { transform: scale(1.06) translateY(6px); opacity: 1; } 100% { transform: scale(0.98) translateY(-4px); opacity: 0.85; } } @keyframes iconGlowPulse { 0%, 100% { box-shadow: 0 0 24px rgba(20, 184, 166, 0.35), 0 0 48px rgba(13, 148, 136, 0.15); } 50% { box-shadow: 0 0 32px rgba(45, 212, 191, 0.55), 0 0 60px rgba(20, 184, 166, 0.25); } }' }} />

      {/* Architectural Blueprint Dot Grid & Vignette Texture */}
      <div style={{
        position: 'absolute',
        inset: 0,
        backgroundImage: 'radial-gradient(rgba(45, 212, 191, 0.12) 1px, transparent 1px)',
        backgroundSize: '24px 24px',
        opacity: 0.6,
        pointerEvents: 'none',
        zIndex: 0,
        maskImage: 'radial-gradient(ellipse at 50% 50%, black 40%, transparent 85%)',
        WebkitMaskImage: 'radial-gradient(ellipse at 50% 50%, black 40%, transparent 85%)'
      }} />

      <div className="hero-section-card" style={{
        position: 'relative',
        zIndex: 1,
        maxWidth: '560px',
        width: '100%',
        padding: '52px 36px',
        borderRadius: '24px 8px 24px 14px',
        background: 'radial-gradient(ellipse at 20% 0%, rgba(20, 184, 166, 0.18) 0%, rgba(13, 148, 136, 0.06) 45%, rgba(13, 17, 26, 0.96) 85%)',
        border: '1px solid rgba(255, 255, 255, 0.09)',
        borderTop: '1px solid rgba(45, 212, 191, 0.35)',
        textAlign: 'center',
        boxShadow: '0 20px 48px -12px rgba(0, 0, 0, 0.65), 0 0 40px rgba(20, 184, 166, 0.08)',
        backdropFilter: 'blur(16px)',
        overflow: 'hidden'
      }}>
        {/* Asymmetric Top Accent Line */}
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '140px',
          height: '2px',
          background: 'linear-gradient(90deg, #2dd4bf 0%, rgba(45, 212, 191, 0) 100%)',
          pointerEvents: 'none',
          zIndex: 1
        }} />

        {/* Asymmetric Brand-Teal Directional Glow */}
        <div style={{
          position: 'absolute',
          top: '-35%',
          left: '10%',
          width: '140%',
          height: '140%',
          background: 'radial-gradient(circle at 30% 30%, rgba(20, 184, 166, 0.20) 0%, rgba(13, 148, 136, 0.08) 35%, transparent 65%)',
          filter: 'blur(32px)',
          pointerEvents: 'none',
          zIndex: 0,
          animation: 'heroGradientPulse 8s ease-in-out infinite alternate'
        }} />

        {/* Asymmetric Technical Eyebrow Tag */}
        <div style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          padding: '4px 10px',
          borderRadius: '6px 2px 6px 2px',
          background: 'rgba(20, 184, 166, 0.08)',
          border: '1px solid rgba(20, 184, 166, 0.22)',
          marginBottom: '18px',
          fontSize: '11px',
          fontWeight: 600,
          letterSpacing: '0.08em',
          color: '#2dd4bf',
          textTransform: 'uppercase',
          fontFamily: "'JetBrains Mono', monospace",
          position: 'relative',
          zIndex: 1
        }}>
          <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#2dd4bf', boxShadow: '0 0 8px #2dd4bf', display: 'inline-block' }} />
          BRAINHALF CORE // REACTIVE ENGINE
        </div>

        {/* 64px Icon with brand-teal glow */}
        <div className="hero-icon-container" style={{
          width: '64px',
          height: '64px',
          borderRadius: '16px 6px 16px 8px',
          background: 'linear-gradient(135deg, rgba(45, 212, 191, 0.12) 0%, rgba(20, 184, 166, 0.03) 100%)',
          border: '1px solid rgba(45, 212, 191, 0.25)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          margin: '0 auto 20px',
          boxShadow: '0 0 24px rgba(20, 184, 166, 0.35), 0 0 48px rgba(13, 148, 136, 0.15)',
          animation: 'iconGlowPulse 4s ease-in-out infinite alternate',
          position: 'relative',
          zIndex: 1
        }}>
          <BrainCircuit 
            size={36} 
            strokeWidth={1.75} 
            color="#2dd4bf" 
            style={{ filter: 'drop-shadow(0 0 10px rgba(45, 212, 191, 0.65)) drop-shadow(0 0 20px rgba(20, 184, 166, 0.4))' }} 
          />
        </div>

        <h1 style={{
          fontSize: '25px',
          fontWeight: 700,
          margin: '0 0 10px',
          color: '#f8fafc',
          letterSpacing: '-0.03em',
          lineHeight: '1.25',
          fontFamily: "'Space Grotesk', -apple-system, sans-serif",
          position: 'relative',
          zIndex: 1
        }}>
          Architect your idea into living software.
        </h1>

        <p style={{
          color: '#94a3b8',
          fontSize: '14px',
          lineHeight: '1.6',
          margin: '0 auto 28px',
          maxWidth: '460px',
          fontWeight: 400,
          position: 'relative',
          zIndex: 1
        }}>
          From interactive workflows to full-stack reactive prototypes—direct the architecture, shape state in real time, and inspect generated code instantly.
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
                background: 'rgba(255, 255, 255, 0.04)',
                border: '1px solid rgba(255, 255, 255, 0.09)',
                color: '#cbd5e1',
                padding: '9px 18px',
                minHeight: '40px',
                borderRadius: '10px 4px 10px 4px',
                fontSize: '13px',
                fontWeight: 500,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 0.18s ease',
                boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(20, 184, 166, 0.12)';
                e.currentTarget.style.borderColor = 'rgba(45, 212, 191, 0.3)';
                e.currentTarget.style.color = '#f0fdfa';
                e.currentTarget.style.transform = 'translateY(-1px)';
                e.currentTarget.style.boxShadow = '0 4px 14px rgba(20, 184, 166, 0.2)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)';
                e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.09)';
                e.currentTarget.style.color = '#cbd5e1';
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.1)';
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
