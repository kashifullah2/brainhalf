import React, { useState, useEffect, useMemo, Component, ErrorInfo, ReactNode } from 'react';
import * as ReactDOM from 'react-dom/client';
import * as LucideIcons from 'lucide-react';
import { transform } from 'sucrase';
import { basicReactTemplate } from '../lib/templates';
import { getProjectFiles, saveProjectFiles } from '../lib/project-store';
import { executeBackendRequest } from '../lib/backend-runner';

// Safe proxy for Lucide icons: if an icon doesn't exist, return a fallback SVG icon instead of crashing
const safeLucideIcons: any = new Proxy(LucideIcons, {
  get(target: any, prop: string) {
    if (prop in target) return target[prop];
    return (props: any) => (
      <svg
        width={props.size || 16}
        height={props.size || 16}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={props.strokeWidth || 2}
        strokeLinecap="round"
        strokeLinejoin="round"
        {...props}
      >
        <circle cx="12" cy="12" r="10" />
      </svg>
    );
  }
});

interface ErrorBoundaryProps {
  children: ReactNode;
  onError: (error: Error, info: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class PreviewErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    console.error('PREVIEW ERROR CAUGHT:', error?.message || error, error?.stack);
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('PREVIEW COMPONENT DID CATCH:', error?.message, errorInfo?.componentStack);
    this.props.onError(error, errorInfo);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    const isBackend = (this.state.error?.message || '').includes('[Backend Error]');
    const title = isBackend ? 'Backend Server Error' : 'Preview Runtime Error';
    const layer = isBackend ? 'backend' : 'frontend';

    return (
      <div style={{
        padding: '24px',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        color: '#f87171',
        background: '#090a0f',
        height: '100%',
        minHeight: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        boxSizing: 'border-box'
      }}>
        <div style={{
          background: 'rgba(239, 68, 68, 0.1)',
          border: '1px solid rgba(239, 68, 68, 0.3)',
          borderRadius: '12px',
          padding: '24px',
          maxWidth: '500px'
        }}>
          <h3 style={{ fontSize: '16px', fontWeight: 600, color: '#f87171', marginBottom: '8px' }}>
            {title}
          </h3>
          <p style={{ color: '#9ca3af', fontSize: '13px', lineHeight: 1.5, marginBottom: '16px', wordBreak: 'break-word' }}>
            {this.state.error?.message || 'An error occurred during rendering.'}
          </p>
          <button
            onClick={() => {
              if (window.parent) {
                window.parent.postMessage({
                  type: 'preview-auto-fix',
                  layer,
                  error: this.state.error?.message || 'Runtime error'
                }, window.location.origin);
              }
            }}
            style={{
              padding: '8px 16px',
              background: '#6366f1',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '12px',
              fontWeight: 500
            }}
          >
            Request AI Auto-Fix
          </button>
        </div>
      </div>
    );
  }
}

export const PreviewRunner: React.FC<{ projectId: string }> = ({ projectId }) => {
  const [files, setFiles] = useState<Record<string, string>>(() => {
    const saved = getProjectFiles(projectId);
    if (saved && Object.keys(saved).length > 0) {
      if (saved['/src/App.jsx'] && (
        saved['/src/App.jsx'].includes('BRAINHALF CORE // REACTIVE ENGINE') ||
        saved['/src/App.jsx'].includes('BrainHalf Studio') ||
        saved['/src/App.jsx'].includes('From interactive workflows to full-stack reactive prototypes')
      )) {
        saved['/src/App.jsx'] = basicReactTemplate['src'].directory['App.jsx'].file.contents;
        saveProjectFiles(projectId, saved);
      } else if (saved['/src/App.jsx'] && saved['/src/App.jsx'].includes("minHeight: '100vh'") && (saved['/src/App.jsx'].includes("What do you want to build?") || saved['/src/App.jsx'].includes("Architect your idea into living software."))) {
        saved['/src/App.jsx'] = saved['/src/App.jsx'].replace("minHeight: '100vh'", "height: '100%', minHeight: '100%'");
      }
      return saved;
    }
    return {
      '/src/App.jsx': basicReactTemplate['src'].directory['App.jsx'].file.contents,
      '/src/styles.css': basicReactTemplate['src'].directory['styles.css'].file.contents,
    };
  });

  // Listen for file sync messages from parent window
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (!event.data || typeof event.data !== 'object') return;
      if (event.data.type === 'sync-files' && event.data.files) {
        setFiles(event.data.files);
      }
    };

    window.addEventListener('message', handleMessage);

    // Request initial files from parent
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type: 'request-preview-files', projectId }, window.location.origin);
    }

    return () => window.removeEventListener('message', handleMessage);
  }, [projectId]);

  // Intercept window.fetch to route /api/* requests to backend runner in preview
  useEffect(() => {
    const originalFetch = window.fetch;
    window.fetch = async (...args) => {
      const urlStr = typeof args[0] === 'string' ? args[0] : ((args[0] as Request).url || '');
      const urlObj = new URL(urlStr, window.location.origin);

      if (urlObj.pathname.startsWith('/api/')) {
        try {
          const init = args[1] || {};
          let bodyData = null;
          if (init.body) {
            try { bodyData = typeof init.body === 'string' ? JSON.parse(init.body) : init.body; } catch (_) {}
          }
          const headersObj: Record<string, string> = {};
          if (init.headers) {
            if (init.headers instanceof Headers) {
              init.headers.forEach((v, k) => { headersObj[k.toLowerCase()] = v; });
            } else if (typeof init.headers === 'object') {
              Object.entries(init.headers).forEach(([k, v]) => { headersObj[k.toLowerCase()] = String(v); });
            }
          }

          const backendRes = await executeBackendRequest(files, {
            method: init.method || 'GET',
            url: urlObj.toString(),
            headers: headersObj,
            body: bodyData
          });

          if (backendRes.status >= 400 && window.parent && window.parent !== window) {
            window.parent.postMessage({
              type: 'preview-error',
              layer: 'backend',
              error: backendRes.error || `[Backend Error] ${backendRes.status}: ${backendRes.body?.error || 'API call failed'}`,
              file: '/server/index.js'
            }, window.location.origin);
          }

          return new Response(JSON.stringify(backendRes.body), {
            status: backendRes.status,
            headers: {
              'Content-Type': 'application/json',
              ...(backendRes.headers || {})
            }
          });
        } catch (e: any) {
          if (window.parent && window.parent !== window) {
            window.parent.postMessage({
              type: 'preview-error',
              layer: 'backend',
              error: `[Backend Error] Failed to execute API route: ${e.message}`,
              file: '/server/index.js'
            }, window.location.origin);
          }
          throw e;
        }
      }

      return originalFetch(...args);
    };

    return () => {
      window.fetch = originalFetch;
    };
  }, [files]);

  // Extract CSS
  const stylesCode = useMemo(() => {
    return (
      files['/src/styles.css'] ||
      files['/styles.css'] ||
      files['src/styles.css'] ||
      files['styles.css'] ||
      ''
    );
  }, [files]);

  // Compile and evaluate component
  const { Component: RenderedComponent, error: buildError } = useMemo(() => {
    // Locate main App code
    const appPath = Object.keys(files).find(p =>
      p.endsWith('/App.jsx') || p.endsWith('/App.tsx') || p.endsWith('/App.js') || p === 'App.jsx' || p === 'App.tsx'
    );
    const appCode = appPath ? files[appPath] : (files['/src/App.jsx'] || files['/App.jsx']);

    if (!appCode) {
      return { Component: null, error: 'No App component found in project.' };
    }

    try {
      const moduleCache: Record<string, any> = {};

      const resolveFilePath = (currentPath: string, importPath: string): string | null => {
        if (files[importPath]) return importPath;
        if (files[`/${importPath}`]) return `/${importPath}`;
        if (files[`/src/${importPath}`]) return `/src/${importPath}`;

        const currentDir = currentPath.substring(0, currentPath.lastIndexOf('/')) || '/src';
        const clean = importPath.replace(/^\.\//, '').replace(/^\//, '');

        const candidates = [
          `${currentDir}/${clean}`,
          `${currentDir}/${clean}.jsx`,
          `${currentDir}/${clean}.tsx`,
          `${currentDir}/${clean}.js`,
          `${currentDir}/${clean}.ts`,
          `/src/${clean}`,
          `/src/${clean}.jsx`,
          `/src/${clean}.tsx`,
          `/src/${clean}.js`,
          `/src/${clean}.ts`,
          `/${clean}`,
          `/${clean}.jsx`,
          `/${clean}.tsx`,
        ];

        for (const c of candidates) {
          if (files[c]) return c;
        }
        return null;
      };

      const requireModule = (fromPath: string, moduleName: string) => {
        if (moduleName === 'react') return React;
        if (moduleName === 'react-dom' || moduleName === 'react-dom/client') return ReactDOM;
        if (moduleName === 'lucide-react') return safeLucideIcons;
        if (moduleName.endsWith('.css')) return {};

        const resolved = resolveFilePath(fromPath, moduleName);
        if (resolved && files[resolved]) {
          if (moduleCache[resolved]) return moduleCache[resolved].exports;

          const rawCode = files[resolved];
          const transformed = transform(rawCode, {
            transforms: ['jsx', 'imports', 'typescript'],
            jsxRuntime: 'classic'
          });

          const mod = { exports: {} };
          moduleCache[resolved] = mod;

          const fn = new Function('require', 'exports', 'module', 'React', transformed.code);
          fn((name: string) => requireModule(resolved, name), mod.exports, mod, React);
          return mod.exports;
        }

        return {};
      };

      // Transform main App
      const transformed = transform(appCode, {
        transforms: ['jsx', 'imports', 'typescript'],
        jsxRuntime: 'classic'
      });

      const mainMod = { exports: {} };
      moduleCache[appPath || '/src/App.jsx'] = mainMod;

      const fn = new Function('require', 'exports', 'module', 'React', transformed.code);
      fn((name: string) => requireModule(appPath || '/src/App.jsx', name), mainMod.exports, mainMod, React);

      const Exported = (mainMod.exports as any).default || (mainMod.exports as any).App || Object.values(mainMod.exports).find(v => typeof v === 'function');
      if (!Exported) {
        return { Component: null, error: 'Component does not have a default export.' };
      }

      return { Component: Exported, error: null };
    } catch (err: any) {
      return { Component: null, error: err.message || 'Transpilation error' };
    }
  }, [files]);

  useEffect(() => {
    if (buildError) {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({
          type: 'preview-error',
          error: buildError
        }, window.location.origin);
      }
    } else {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: 'preview-success' }, window.location.origin);
      }
    }
  }, [buildError]);

  if (buildError) {
    return (
      <div style={{
        padding: '24px',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        color: '#f87171',
        background: '#090a0f',
        height: '100%',
        minHeight: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        boxSizing: 'border-box'
      }}>
        <div style={{
          background: 'rgba(239, 68, 68, 0.1)',
          border: '1px solid rgba(239, 68, 68, 0.3)',
          borderRadius: '12px',
          padding: '24px',
          maxWidth: '500px'
        }}>
          <h3 style={{ fontSize: '16px', fontWeight: 600, color: '#f87171', marginBottom: '8px' }}>
            {buildError.includes('[Backend Error]') ? 'Backend Server Error' : 'Transpilation Error'}
          </h3>
          <p style={{ color: '#9ca3af', fontSize: '13px', lineHeight: 1.5, marginBottom: '16px', wordBreak: 'break-word' }}>
            {buildError}
          </p>
          <button
            onClick={() => {
              if (window.parent) {
                window.parent.postMessage({
                  type: 'preview-auto-fix',
                  layer: buildError.includes('[Backend Error]') ? 'backend' : 'frontend',
                  error: buildError
                }, window.location.origin);
              }
            }}
            style={{
              padding: '8px 16px',
              background: '#6366f1',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '12px',
              fontWeight: 500
            }}
          >
            Request AI Auto-Fix
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      {stylesCode && <style dangerouslySetInnerHTML={{ __html: stylesCode }} />}
      <PreviewErrorBoundary onError={(err) => {
        if (window.parent && window.parent !== window) {
          const isBackend = (err.message || '').includes('[Backend Error]');
          window.parent.postMessage({
            type: 'preview-error',
            layer: isBackend ? 'backend' : 'frontend',
            error: err.message
          }, window.location.origin);
        }
      }}>
        {RenderedComponent ? <RenderedComponent /> : null}
      </PreviewErrorBoundary>
    </>
  );
};
