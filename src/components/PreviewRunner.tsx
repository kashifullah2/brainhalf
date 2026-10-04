import React, { useState, useEffect, useMemo, Component, ErrorInfo, ReactNode } from 'react';
import * as ReactDOM from 'react-dom/client';
import * as ReactDOMBase from 'react-dom';
import * as JSXRuntime from 'react/jsx-runtime';
import { selectAppEntry, selectHtmlEntry } from '../lib/preview-entry';
import { createPreviewModuleLoader, previewCss } from '../lib/preview-runtime';
import { usePreviewFiles } from '../lib/use-preview-files';
import { usePreviewInspect } from '../lib/use-preview-inspect';
import { PreviewErrorPanel, classifyError } from './PreviewErrorPanel';
import { HtmlPreview } from './HtmlPreview';

const TRANSIENT_STREAM_WINDOW_MS = 5_000;

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
const builtinLibraries: Record<string, unknown> = {
  react: React,
  'react-dom': ReactDOMBase,
  'react-dom/client': ReactDOM,
  'react/jsx-runtime': JSXRuntime,
};

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

export const PreviewRunner: React.FC<{ projectId: string; initialFiles?: Record<string, string> }> = ({
  projectId,
  initialFiles,
}) => {
  const {
    revision,
    files,
    waitingForFiles,
    runtimeError,
    reportRuntimeError,
    dependencies,
    transpileCacheRef,
    lastFileSyncAtRef,
    setTransientTick,
  } = usePreviewFiles(projectId, initialFiles, builtinLibraries);

  const {
    inspectMode,
    hoveredRect,
    inspectOverlayRef,
    contextMenu,
    sendContextAction,
    handleInspectMouseMove,
    handleInspectClick,
  } = usePreviewInspect(projectId);

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
  const filesStreaming = Date.now() - lastFileSyncAtRef.current < TRANSIENT_STREAM_WINDOW_MS;
  const transientStreamError = !!activeError && filesStreaming && isTransientResolutionError(activeError);

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
    return (
      <>
        {stylesCode && <style dangerouslySetInnerHTML={{ __html: stylesCode.replace(/<\/style/gi, '<\\/style') }} />}
        <PreparingPreview />
      </>
    );
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
            onMouseLeave={() => {}}
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
