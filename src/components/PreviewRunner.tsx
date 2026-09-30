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
import { plainLanguageError } from '../lib/verification-copy';

const nativeFetch = window.fetch.bind(window);

// Time budget for a single CDN dependency load before it counts as failed.
const DEP_LOAD_TIMEOUT_MS = 20_000;
// Automatic retries for a failed dependency load — CDN flakes are common and
// a single failed fetch should never permanently break the preview.
const DEP_LOAD_MAX_RETRIES = 2;
// How long to wait for the parent's file sync before re-requesting, and how
// many re-requests to make before surfacing a visible error.
const FILE_SYNC_RETRY_MS = 2_000;
const FILE_SYNC_MAX_ATTEMPTS = 5;

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
        '*'
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
          {message ? plainLanguageError(message) : 'Something went wrong while showing your app.'}{' '}
          The builder can usually fix this — ask it to take a look.
        </p>
        {message && (
          <details style={{ marginBottom: '16px', textAlign: 'left', fontSize: '12px', color: '#657580' }}>
            <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Technical details</summary>
            <code style={{ display: 'block', marginTop: '6px', padding: '8px', background: '#f4f7f9', borderRadius: '6px', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{message}</code>
          </details>
        )}
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
          Ask the builder to fix it
        </button>
      </div>
    </div>
  );
}

function classifyError(message: string): { title: string; layer: 'frontend' | 'backend' } {
  const isBackend = message.includes('[Backend Error]');
  return {
    title: isBackend ? 'A data feature ran into a problem' : 'This preview ran into a problem',
    layer: isBackend ? 'backend' : 'frontend',
  };
}

// How long after the last file sync an unresolved-local-import error is
// still treated as mid-stream noise. The parent debounces preview syncs
// during generation at 800ms, so 5s comfortably covers gaps between
// streaming deltas without hiding genuine errors for long.
const TRANSIENT_STREAM_WINDOW_MS = 5_000;

/**
 * True when `error` looks like a failed *local* module resolution, e.g. the
 * preview loader's `Cannot resolve module "./components/LandingPage"
 * imported from "/src/App.jsx"`.
 *
 * The builder saves App.tsx before the files it imports, and the preview
 * evaluates immediately — so while file syncs are still landing, these are
 * expected mid-stream noise, not real breakage. A bare specifier (an npm
 * package like "clsx") never counts as transient: no later file sync can
 * make it resolve.
 */
export function isTransientResolutionError(error: string | null | undefined): boolean {
  if (!error) return false;
  return /(?:cannot (?:find|resolve) module|failed to resolve import|module not found|unknown (?:file|module)|no such (?:file|module))\s*:?\s*['"`](?:\.{1,2}\/|@\/|~\/|\/)/i.test(error);
}

function PreparingPreview() {
  return <div role="status" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#edf3f7', color: '#657580', fontFamily: 'system-ui, sans-serif', fontSize: 13 }}>Preparing your preview…</div>;
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
    if (window.parent !== window) window.parent.postMessage({ type: 'preview-success' }, '*');
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
  // Only wait for the parent's sync-files when no embedded files were supplied.
  // If initialFiles is present (server-embedded snapshot), render immediately
  // so the preview isn't stuck on "Preparing…" if the postMessage is delayed.
  const [waitingForFiles, setWaitingForFiles] = useState(
    () => window.parent !== window && (!initialFiles || Object.keys(initialFiles).length === 0)
  );
  const waitingForFilesRef = useRef(waitingForFiles);

  // File-stream activity signal. The parent posts `sync-files` /
  // `sync-files-delta` each time generated files land in the preview; while
  // those keep arriving, the builder is still streaming and
  // unresolved-local-import errors are expected mid-stream noise.
  const lastFileSyncAtRef = useRef(0);
  // Tick to force a re-render once the transient window elapses, so a
  // genuine error that survived the stream still reaches the error card.
  const [, setTransientTick] = useState(0);

  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const reportRuntimeError = useCallback((error: string) => {
    setRuntimeError(error);
    if (window.parent !== window) window.parent.postMessage({ type: 'preview-error', layer: 'frontend', error }, '*');
  }, []);

  // Listen for file sync messages from the parent window. Only messages from
  // the parent frame, on an allowed origin, targeting this exact project are
  // accepted — otherwise an embedded third-party page could swap the
  // previewed app for arbitrary code.
  useEffect(() => {
    const applyFiles = (next: Record<string, string>) => {
      // A sync just landed: the file stream is active.
      lastFileSyncAtRef.current = Date.now();
      const initialSync = waitingForFilesRef.current;
      waitingForFilesRef.current = false;
      setWaitingForFiles(false);
      // Any fresh sync invalidates errors from the previous render — including
      // the file-sync watchdog error — so the preview recovers on its own.
      setRuntimeError(null);
      const previous = currentFiles.current;
      if (Object.keys(previous).length === Object.keys(next).length && Object.keys(previous).every(path => previous[path] === next[path])) return;
      if (!initialSync && selectHtmlEntry(previous)) {
        // Ask the parent to reload the iframe so the navigation comes from the
        // same-origin parent context. A reload initiated here (opaque-origin
        // sandbox) would have sec-fetch-site:cross-site, which causes the worker
        // to treat it as untrusted and block the bh_session cookie — 401.
        if (window.parent !== window) {
          window.parent.postMessage({ type: 'request-reload', projectId }, '*');
        } else {
          window.location.reload();
        }
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
      window.parent.postMessage({ type: 'request-preview-files', projectId }, '*');
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

  const depLoadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastImportKeyRef = useRef('');

  useEffect(() => {
    if (waitingForFiles) return;
    let active = true;
    let retryCount = 0;

    const doLoad = () => {
      const timeout = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`Timed out after ${DEP_LOAD_TIMEOUT_MS / 1000}s`)), DEP_LOAD_TIMEOUT_MS);
      });
      Promise.race([loadPreviewDependencies(files, builtinLibraries), timeout])
        .then((libraries) => {
          if (active) setDependencies({ files, libraries });
        })
        .catch((error) => {
          if (!active) return;
          if (retryCount < DEP_LOAD_MAX_RETRIES) {
            retryCount += 1;
            depLoadTimerRef.current = setTimeout(doLoad, 1_500 * retryCount);
            return;
          }
          setDependencies({
            files,
            libraries: {},
            error: `Dependency loading failed: ${error instanceof Error ? error.message : String(error)}`,
          });
        });
    };

    // Build a fingerprint of the import specifiers to avoid reloading
    // dependencies when only file content (not imports) changed.
    const importKey = Object.entries(files)
      .filter(([path]) => /\.(?:[cm]?[jt]sx?|html)$/.test(path))
      .flatMap(([, content]) => {
        const matches = content.match(/\b(?:from|import)\s+['"]([^'"]+)['"]/g);
        return matches || [];
      })
      .sort()
      .join('\n');

    if (importKey !== lastImportKeyRef.current || !dependencies) {
      lastImportKeyRef.current = importKey;
      if (depLoadTimerRef.current) clearTimeout(depLoadTimerRef.current);
      depLoadTimerRef.current = setTimeout(doLoad, dependencies ? 300 : 0);
    } else if (dependencies && dependencies.files !== files) {
      if (dependencies.error) {
        // The previous dependency load failed — a fresh file sync is a new
        // chance to recover, so retry instead of staying on the error panel.
        if (depLoadTimerRef.current) clearTimeout(depLoadTimerRef.current);
        depLoadTimerRef.current = setTimeout(doLoad, 500);
      } else {
        setDependencies({ ...dependencies, files });
      }
    }

    return () => {
      active = false;
      if (depLoadTimerRef.current) {
        clearTimeout(depLoadTimerRef.current);
        depLoadTimerRef.current = null;
      }
    };
  }, [files, waitingForFiles]);

  // Intercept fetch calls to /api/* and route them to the simulated backend
  // instead of the network. Always restores the native fetch on cleanup so
  // this component never leaks a global patch.
  useLayoutEffect(() => {
    window.fetch = createPreviewFetch(nativeFetch, files, store, window.location.origin, (error) => {
      if (window.parent !== window) window.parent.postMessage({ type: 'preview-error', layer: 'backend', error, file: '/server/index.js' }, '*');
    });
    return () => { window.fetch = nativeFetch; };
  }, [files, store]);

  // Watchdog: the initial request-preview-files (sent on mount) can be lost
  // if the parent's message listener wasn't attached yet or the parent
  // remounted. Re-request a few times, then show a real error instead of
  // spinning on "Preparing your preview…" forever.
  useEffect(() => {
    if (!waitingForFiles || window.parent === window) return;
    let attempts = 0;
    const id = setInterval(() => {
      if (!waitingForFilesRef.current) {
        clearInterval(id);
        return;
      }
      attempts += 1;
      if (attempts <= FILE_SYNC_MAX_ATTEMPTS) {
        window.parent.postMessage({ type: 'request-preview-files', projectId }, '*');
        return;
      }
      clearInterval(id);
      waitingForFilesRef.current = false;
      setWaitingForFiles(false);
      reportRuntimeError('Preview did not receive project files from the editor. Refresh the preview to try again.');
    }, FILE_SYNC_RETRY_MS);
    return () => clearInterval(id);
  }, [waitingForFiles, projectId, reportRuntimeError]);

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

  const [inspectMode, setInspectMode] = useState(false);
  const [hoveredRect, setHoveredRect] = useState<DOMRect | null>(null);
  const inspectOverlayRef = useRef<HTMLDivElement>(null);

  const [contextMenu, setContextMenu] = useState<{
    x: number; y: number;
    tagName: string; id?: string; className?: string; text?: string;
  } | null>(null);

  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      if (inspectMode) return;
      e.preventDefault();
      const el = e.target as Element;
      const rawClass = typeof el.className === 'string' ? el.className.trim() : '';
      setContextMenu({
        x: e.clientX, y: e.clientY,
        tagName: el.tagName.toLowerCase(),
        id: el.id || undefined,
        className: rawClass || undefined,
        text: el.textContent?.trim().replace(/\s+/g, ' ').slice(0, 80) || undefined,
      });
    };
    document.addEventListener('contextmenu', handleContextMenu);
    return () => document.removeEventListener('contextmenu', handleContextMenu);
  }, [inspectMode]);

  useEffect(() => {
    if (!contextMenu) return;
    const dismiss = (e: MouseEvent) => {
      const menu = document.getElementById('bh-ctx-menu');
      if (menu && menu.contains(e.target as Node)) return;
      setContextMenu(null);
    };
    window.addEventListener('mousedown', dismiss, true);
    return () => window.removeEventListener('mousedown', dismiss, true);
  }, [contextMenu]);

  const sendContextAction = useCallback((action: string) => {
    if (!contextMenu) return;
    const { x: _x, y: _y, ...info } = contextMenu;
    setContextMenu(null);
    if (window.parent !== window) {
      window.parent.postMessage({ type: 'element-context-action', action, ...info }, '*');
    }
  }, [contextMenu]);

  useEffect(() => {
    const handle = (e: MessageEvent) => {
      if (e.source !== window.parent || !isAllowedOrigin(e.origin)) return;
      if (e.data?.type === 'set-inspect-mode' && e.data.projectId === projectId) {
        setInspectMode(!!e.data.enabled);
        if (!e.data.enabled) setHoveredRect(null);
      }
    };
    window.addEventListener('message', handle);
    return () => window.removeEventListener('message', handle);
  }, [projectId]);

  useEffect(() => {
    if (!inspectMode) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setInspectMode(false); setHoveredRect(null); }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [inspectMode]);

  const handleInspectMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const overlay = inspectOverlayRef.current;
    if (!overlay) return;
    overlay.style.pointerEvents = 'none';
    const el = document.elementFromPoint(e.clientX, e.clientY);
    overlay.style.pointerEvents = 'all';
    if (el && el !== overlay) setHoveredRect(el.getBoundingClientRect());
  }, [setHoveredRect]);

  const handleInspectClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    const overlay = inspectOverlayRef.current;
    if (!overlay) return;
    overlay.style.pointerEvents = 'none';
    const el = document.elementFromPoint(e.clientX, e.clientY);
    overlay.style.pointerEvents = 'all';
    setInspectMode(false);
    setHoveredRect(null);
    if (!el || el === overlay) return;
    const id = el.id || undefined;
    const rawClass = typeof el.className === 'string' ? el.className.trim() : '';
    const text = el.textContent?.trim().replace(/\s+/g, ' ').slice(0, 80) || undefined;
    if (window.parent !== window) {
      window.parent.postMessage({
        type: 'element-selected',
        tagName: el.tagName.toLowerCase(),
        id,
        className: rawClass || undefined,
        text,
      }, '*');
    }
  }, [setInspectMode, setHoveredRect]);

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
      window.parent.postMessage({ type: 'preview-error', error: buildError }, '*');
    }
  }, [buildError]);

  const activeError = buildError || runtimeError;
  // The builder saves App.tsx before the files it imports, and the preview
  // evaluates immediately — so while file syncs are still landing, an
  // unresolved-local-import error is expected mid-stream noise. Show the
  // calm "Preparing your preview…" state instead of the error card; once
  // syncs settle, genuine errors surface normally.
  const filesStreaming = Date.now() - lastFileSyncAtRef.current < TRANSIENT_STREAM_WINDOW_MS;
  const transientStreamError = !!activeError && filesStreaming && isTransientResolutionError(activeError);

  // Nothing re-renders on its own once the syncs stop, so re-render when the
  // transient window elapses — a genuine error that survived the stream must
  // still reach the error card instead of lingering on "Preparing…".
  useEffect(() => {
    if (!transientStreamError) return;
    const remaining = TRANSIENT_STREAM_WINDOW_MS - (Date.now() - lastFileSyncAtRef.current);
    const id = setTimeout(() => setTransientTick((t) => t + 1), Math.max(0, remaining));
    return () => clearTimeout(id);
  });

  if (activeError) {
    if (transientStreamError) {
      return <PreparingPreview />;
    }
    const { title, layer } = classifyError(activeError);
    return (
      <PreviewErrorPanel
        title={buildError && !buildError.includes('[Backend Error]') ? 'Transpilation Error' : title}
        message={activeError}
        layer={layer}
      />
    );
  }

  if (waitingForFiles || !dependencies || dependencies.files !== files) {
    return <PreparingPreview />;
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
            window.parent.postMessage({ type: 'preview-error', layer, error: err.message }, '*');
          }
        }}
      >
        {RenderedComponent ? <RenderedComponent /> : null}
        {RenderedComponent ? <PreviewReadySignal /> : null}
      </PreviewErrorBoundary>
      {inspectMode && (
        <>
          {hoveredRect && (
            <div
              aria-hidden="true"
              style={{
                position: 'fixed',
                top: hoveredRect.top,
                left: hoveredRect.left,
                width: hoveredRect.width,
                height: hoveredRect.height,
                outline: '2px solid #3659D9',
                background: 'rgba(54,89,217,0.08)',
                pointerEvents: 'none',
                zIndex: 999998,
                boxSizing: 'border-box',
              }}
            />
          )}
          <div
            ref={inspectOverlayRef}
            role="presentation"
            aria-label="Click an element to select it for editing"
            style={{ position: 'fixed', inset: 0, zIndex: 999999, cursor: 'crosshair' }}
            onMouseMove={handleInspectMouseMove}
            onMouseLeave={() => setHoveredRect(null)}
            onClick={handleInspectClick}
          />
        </>
      )}
      {contextMenu && (
        <div
          id="bh-ctx-menu"
          role="menu"
          aria-label="Element quick actions"
          style={{
            position: 'fixed',
            top: Math.min(contextMenu.y, window.innerHeight - 200),
            left: Math.min(contextMenu.x, window.innerWidth - 180),
            zIndex: 1000000,
            background: '#1c2b36',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 8,
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
            padding: '4px',
            minWidth: 164,
            userSelect: 'none',
            fontFamily: 'system-ui, -apple-system, sans-serif',
          }}
        >
          {contextMenu.text && (
            <div style={{ padding: '5px 10px 6px', color: '#657580', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 152, borderBottom: '1px solid rgba(255,255,255,0.08)', marginBottom: 2 }}>
              {contextMenu.tagName}{contextMenu.id ? `#${contextMenu.id}` : ''}
            </div>
          )}
          {([
            ['change-text', 'Change text'],
            ['change-style', 'Change style'],
            ['change-color', 'Change color'],
            ['remove', 'Remove element'],
          ] as const).map(([action, label]) => (
            <button
              key={action}
              role="menuitem"
              onClick={() => sendContextAction(action)}
              style={{ display: 'block', width: '100%', padding: '7px 10px', textAlign: 'left', background: 'transparent', border: 'none', color: '#c8d6e0', cursor: 'pointer', fontSize: 13, borderRadius: 4 }}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </>
  );
};
