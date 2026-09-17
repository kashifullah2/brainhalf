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
    "lucide-react": "^1.43.0",
    "react-router-dom": "^6.22.3"
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
            <button onClick={() => window.location.reload()} style={{ padding: '8px 16px', background: '#5558e4', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: 500 }}>
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

.suggestion-pill:hover {
  background: rgba(255, 255, 255, 0.08) !important;
  border-color: rgba(255, 255, 255, 0.18) !important;
  color: #ffffff !important;
  transform: translateY(-1px) !important;
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

export const fullStackReactTemplate = {
  ...basicReactTemplate,
  'package.json': {
    file: {
      contents: `
{
  "name": "fullstack-preview-app",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "start:server": "node server/index.js"
  },
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "lucide-react": "^1.43.0",
    "react-router-dom": "^6.22.3",
    "express": "^4.19.2",
    "cors": "^2.8.5"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.2.1",
    "vite": "^5.1.4"
  }
}
      `,
    },
  },
  'server/index.js': {
    file: {
      contents: `
import express from 'express';
import cors from 'cors';

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(3001, () => {
  console.log('Backend server running on port 3001');
});
      `,
    },
  },
};
