import React, { useState, useEffect, useLayoutEffect, useCallback, useMemo, useRef, Component, ErrorInfo, ReactNode } from 'react';
import * as ReactDOM from 'react-dom/client';
import * as ReactDOMBase from 'react-dom';
import * as JSXRuntime from 'react/jsx-runtime';
import { basicReactTemplate } from '../lib/templates';
import { InMemoryDataStore } from '../lib/backend-runner';
import { isAllowedOrigin } from '../lib/allowed-origins';
import { selectAppEntry, selectHtmlEntry } from '../lib/preview-entry';
import { loadPreviewDependencies } from '../lib/preview-modules';
import { createPreviewFetch } from '../lib/preview-fetch';
import { createPreviewModuleLoader, previewCss } from '../lib/preview-runtime';
import { HtmlPreview } from './HtmlPreview';

const nativeFetch = window.fetch.bind(window);

// ---------------------------------------------------------------------------
// Lucide icon fallback: if a requested icon doesn't exist in the loaded
// lucide-react bundle, hand back a neutral placeholder SVG instead of
// throwing, so a single bad icon name can't crash the whole preview.
// ---------------------------------------------------------------------------
function createSafeLucideIcons(target: Record<string, unknown>) {
  return new Proxy(target, {
    get(source: Record<string, unknown>, prop: string) {
      if (prop in source) return source[prop];
      const FallbackIcon = (props: any) => (
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
      FallbackIcon.displayName = `MissingLucideIcon(${String(prop)})`;
      return FallbackIcon;
    }
  });
}

const safeLucideIcons = createSafeLucideIcons({});
const builtinLibraries = {
  react: React,
  'react-dom': ReactDOMBase,
  'react-dom/client': ReactDOM,
  'react/jsx-runtime': JSXRuntime,
};

// Keep default-export compatibility for generated code that expects the
// full lucide-react package shape (`import Icons from 'lucide-react'`
// as well as `import { X } from 'lucide-react'`).
const lucideModule = (icons: Record<string, unknown>) => new Proxy<Record<string, unknown>>({ default: icons, ...icons }, {
  get: (target, property: string) => property in target ? target[property] : icons[property],
});

function isValidPreviewComponent(candidate: unknown): candidate is React.ElementType {
  if (typeof candidate === 'function' || typeof candidate === 'string') return true;
  if (!candidate || typeof candidate !== 'object') return false;
  const reactType = (candidate as { $$typeof?: symbol }).$$typeof;
  return (
    reactType === Symbol.for('react.memo') ||
    reactType === Symbol.for('react.forward_ref') ||
    reactType === Symbol.for('react.lazy')
  );
}

// ---------------------------------------------------------------------------
// Shared error panel so the boundary UI and the build-error UI can't drift
// out of sync with each other.
// ---------------------------------------------------------------------------
function PreviewErrorPanel({
  title,
  message,
  layer,
}: {
  title: string;
  message: string;
  layer: 'frontend' | 'backend';
}) {
  const requestAutoFix = () => {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage(
        { type: 'preview-auto-fix', layer, error: message },
        window.location.origin
      );
    }
  };

  return (
    <div
      style={{
        padding: '24px',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        color: '#b44a4e',
        background: '#edf3f7',
        height: '100%',
        minHeight: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          background: '#ffffff',
          border: '1px solid #dfe6eb',
          borderRadius: '12px',
          padding: '24px',
          maxWidth: '500px',
        }}
      >
        <h3 style={{ fontSize: '20px', fontWeight: 500, color: '#243c4b', marginBottom: '8px' }}>
          {title}
        </h3>
        <p
          style={{
            color: '#657580',
            fontSize: '13px',
            lineHeight: 1.5,
            marginBottom: '16px',
            wordBreak: 'break-word',
          }}
        >
          {message || 'An error occurred during rendering.'}
        </p>
        <button
          onClick={requestAutoFix}
          style={{
            padding: '11px 16px',
            minHeight: '40px',
            background: '#294b61',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
            fontSize: '12px',
            fontWeight: 500,
          }}
        >
          Request AI Auto-Fix
        </button>
      </div>
    </div>
  );
}

function classifyError(message: string): { title: string; layer: 'frontend' | 'backend' } {
  const isBackend = message.includes('[Backend Error]');
  return {
    title: isBackend ? 'Backend Server Error' : 'Preview Runtime Error',
    layer: isBackend ? 'backend' : 'frontend',
  };
}

interface ErrorBoundaryProps {
  children: ReactNode;
  onError: (error: Error, info: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

function PreviewReadySignal() {
  useEffect(() => {
    if (window.parent !== window) window.parent.postMessage({ type: 'preview-success' }, window.location.origin);
  }, []);
  return null;
}

class PreviewErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Preview render error:', error?.message, errorInfo?.componentStack);
    this.props.onError(error, errorInfo);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    const message = this.state.error?.message || 'An error occurred during rendering.';
    const { title, layer } = classifyError(message);
    return <PreviewErrorPanel title={title} message={message} layer={layer} />;
  }
}

// ---------------------------------------------------------------------------
// Default starter project (used only when the caller supplies no files).
// ---------------------------------------------------------------------------
function getDefaultFiles(): Record<string, string> {
  return {
    '/src/App.jsx': basicReactTemplate['src'].directory['App.jsx'].file.contents,
    '/src/styles.css': basicReactTemplate['src'].directory['styles.css'].file.contents,
  };
}

export const PreviewRunner: React.FC<{ projectId: string; initialFiles?: Record<string, string> }> = ({
  projectId,
  initialFiles,
}) => {
  const [revision, setRevision] = useState(0);
  const [files, setFiles] = useState<Record<string, string>>(() => {
    if (initialFiles && Object.keys(initialFiles).length > 0) return initialFiles;
    return getDefaultFiles();
  });
  const currentFiles = useRef(files);
  currentFiles.current = files;
  const [waitingForFiles, setWaitingForFiles] = useState(window.parent !== window);
  const waitingForFilesRef = useRef(waitingForFiles);

  // Listen for file sync messages from the parent window. Only messages from
  // the parent frame, on an allowed origin, targeting this exact project are
  // accepted — otherwise an embedded third-party page could swap the
  // previewed app for arbitrary code.
  useEffect(() => {
    const applyFiles = (next: Record<string, string>) => {
      const initialSync = waitingForFilesRef.current;
      waitingForFilesRef.current = false;
      setWaitingForFiles(false);
      const previous = currentFiles.current;
      if (Object.keys(previous).length === Object.keys(next).length && Object.keys(previous).every(path => previous[path] === next[path])) return;
      if (!initialSync && selectHtmlEntry(previous)) {
        window.location.reload();
        return;
      }
      currentFiles.current = next;
      setFiles(next);
      setRevision(value => value + 1);
    };
    const handleMessage = (event: MessageEvent) => {
      if (event.source !== window.parent || !isAllowedOrigin(event.origin)) return;
      if (!event.data || typeof event.data !== 'object') return;
      if (event.data.projectId !== projectId) return;

      if (event.data.type === 'sync-files' && event.data.files) {
        applyFiles(event.data.files);
        return;
      }

      if (event.data.type === 'sync-files-delta') {
        const changed =
          event.data.changed && typeof event.data.changed === 'object'
            ? (event.data.changed as Record<string, string>)
            : {};
        const removed = Array.isArray(event.data.removed) ? (event.data.removed as string[]) : [];
        if (Object.keys(changed).length === 0 && removed.length === 0) return;

        const next = { ...currentFiles.current, ...changed };
        for (const path of removed) delete next[path];
        applyFiles(next);
      }
    };

    window.addEventListener('message', handleMessage);

    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type: 'request-preview-files', projectId }, window.location.origin);
    }

    return () => window.removeEventListener('message', handleMessage);
  }, [projectId]);

  // Simulated backend store for this preview instance. Created once (lazy
  // init) and never replaced, so the generated app's "database" persists for
  // the lifetime of this one preview and isn't shared across previews.
  const [store] = useState(() => new InMemoryDataStore());
  const transpileCacheRef = useRef(new Map<string, { source: string; code: string }>());

  const [dependencies, setDependencies] = useState<{
    files: Record<string, string>;
    libraries: Record<string, unknown>;
    error?: string;
  } | null>(null);

  useEffect(() => {
    if (waitingForFiles) return;
    let active = true;
    loadPreviewDependencies(files, builtinLibraries)
      .then((libraries) => {
        if (active) setDependencies({ files, libraries });
      })
      .catch((error) => {
        if (active) {
          setDependencies({
            files,
            libraries: {},
            error: `Dependency loading failed: ${error instanceof Error ? error.message : String(error)}`,
          });
        }
      });
    return () => {
      active = false;
    };
  }, [files, waitingForFiles]);

  // Intercept fetch calls to /api/* and route them to the simulated backend
  // instead of the network. Always restores the native fetch on cleanup so
  // this component never leaks a global patch.
  useLayoutEffect(() => {
    window.fetch = createPreviewFetch(nativeFetch, files, store, window.location.origin, (error) => {
      if (window.parent !== window) window.parent.postMessage({ type: 'preview-error', layer: 'backend', error, file: '/server/index.js' }, window.location.origin);
    });
    return () => { window.fetch = nativeFetch; };
  }, [files, store]);

  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const reportRuntimeError = useCallback((error: string) => {
    setRuntimeError(error);
    if (window.parent !== window) window.parent.postMessage({ type: 'preview-error', layer: 'frontend', error }, window.location.origin);
  }, []);

  useLayoutEffect(() => {
    setRuntimeError(null);
    const handleError = (event: ErrorEvent) => reportRuntimeError(event.error?.message || event.message || 'Preview script failed');
    const handleRejection = (event: PromiseRejectionEvent) => reportRuntimeError(event.reason instanceof Error ? event.reason.message : String(event.reason));
    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleRejection);
    return () => {
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleRejection);
    };
  }, [files, reportRuntimeError]);

  const htmlEntry = useMemo(() => selectHtmlEntry(files), [files]);

  const stylesCode = useMemo(() => {
    return Object.entries(files)
      .filter(([path]) => path.endsWith('.css'))
      .map(([path, content]) => previewCss(files, path, content))
      .join('\n');
  }, [files]);

  const { Component: RenderedComponent, error: buildError } = useMemo(() => {
    if (waitingForFiles) return { Component: null, error: null };
    if (!dependencies || dependencies.files !== files) return { Component: null, error: null };
    if (dependencies.error) return { Component: null, error: dependencies.error };
    if (htmlEntry) return { Component: null, error: null };

    const appPath = selectAppEntry(files);
    const appCode = appPath ? files[appPath] : null;

    if (!appPath || !appCode) {
      return { Component: null, error: 'No App component found in project.' };
    }

    try {
      const loadedIcons = dependencies.libraries['lucide-react'] as Record<string, unknown> | undefined;
      const libraries: Record<string, unknown> = { ...dependencies.libraries, 'lucide-react': lucideModule(loadedIcons ? createSafeLucideIcons(loadedIcons) : safeLucideIcons) };
      for (const name of ['react-router-dom', 'react-router']) {
        const router = libraries[name] as any;
        if (!router?.MemoryRouter) continue;
        const PreviewRouter = (props: any) => router.useInRouterContext() ? props.children : React.createElement(router.MemoryRouter, props);
        libraries[name] = { ...router, BrowserRouter: PreviewRouter, HashRouter: PreviewRouter, MemoryRouter: PreviewRouter };
      }
      const loader = createPreviewModuleLoader(files, libraries, React, transpileCacheRef.current);
      const exports = loader.execute(appPath);

      const exportCandidates: unknown[] = [
        exports.default,
        exports.App,
        ...Object.values(exports as Record<string, unknown>),
      ];
      const Exported = exportCandidates.find(isValidPreviewComponent);
      if (!Exported) {
        return {
          Component: null,
          error: 'App export is not a valid React component. Export a function/class component from App.',
        };
      }

      const router = (dependencies.libraries['react-router-dom'] || dependencies.libraries['react-router']) as any;
      const PreviewComponent = router?.MemoryRouter
        ? () => React.createElement(router.MemoryRouter, null, React.createElement(Exported as any))
        : (Exported as React.ElementType);

      return { Component: PreviewComponent, error: null };
    } catch (err: any) {
      return { Component: null, error: err?.message || 'Transpilation error' };
    }
  }, [dependencies, files, htmlEntry, waitingForFiles]);

  useEffect(() => {
    if (buildError && window.parent && window.parent !== window) {
      window.parent.postMessage({ type: 'preview-error', error: buildError }, window.location.origin);
    }
  }, [buildError]);

  if (buildError || runtimeError) {
    const message = buildError || runtimeError!;
    const { title, layer } = classifyError(message);
    return (
      <PreviewErrorPanel
        title={buildError && !buildError.includes('[Backend Error]') ? 'Transpilation Error' : title}
        message={message}
        layer={layer}
      />
    );
  }

  if (waitingForFiles || !dependencies || dependencies.files !== files) {
    return <div role="status" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#edf3f7', color: '#657580', fontFamily: 'system-ui, sans-serif', fontSize: 13 }}>Preparing your preview…</div>;
  }

  return (
    <>
      {stylesCode && <style dangerouslySetInnerHTML={{ __html: stylesCode.replace(/<\/style/gi, '<\\/style') }} />}
      {htmlEntry && <HtmlPreview files={files} entry={htmlEntry} libraries={dependencies.libraries} onError={reportRuntimeError} />}
      <PreviewErrorBoundary
        key={revision}
        onError={(err) => {
          if (window.parent && window.parent !== window) {
            const { layer } = classifyError(err.message || '');
            window.parent.postMessage({ type: 'preview-error', layer, error: err.message }, window.location.origin);
          }
        }}
      >
        {RenderedComponent ? <RenderedComponent /> : null}
        {RenderedComponent ? <PreviewReadySignal /> : null}
      </PreviewErrorBoundary>
    </>
  );
};
