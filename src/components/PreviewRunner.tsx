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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function shallowEqualSnapshot(a: unknown, b: unknown, depth = 0): boolean {
  if (Object.is(a, b)) return true;
  if (depth > 2) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length || a.length > 200) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (!Object.is(a[i], b[i]) && !shallowEqualSnapshot(a[i], b[i], depth + 1)) return false;
    }
    return true;
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length || keysA.length > 100) return false;
    for (let i = 0; i < keysA.length; i += 1) {
      const key = keysA[i];
      if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
      if (!Object.is(a[key], b[key]) && !shallowEqualSnapshot(a[key], b[key], depth + 1)) {
        return false;
      }
    }
    return true;
  }
  return false;
}

function createStabilizedUseState(baseUseState: typeof React.useState): typeof React.useState {
  return function useStabilizedState<S>(initialState?: S | (() => S)) {
    const [state, setState] = baseUseState(initialState as S);
    const rapidMetaRef = React.useRef<{ count: number; lastTs: number }>({ count: 0, lastTs: 0 });
    const stableSetState = React.useCallback((action: React.SetStateAction<S>) => {
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      if (now - rapidMetaRef.current.lastTs < 40) {
        rapidMetaRef.current.count += 1;
      } else {
        rapidMetaRef.current.count = 1;
      }
      rapidMetaRef.current.lastTs = now;
      setState((prev: S) => {
        const next = typeof action === 'function' ? (action as (prevState: S) => S)(prev) : action;
        if (rapidMetaRef.current.count > 3 && shallowEqualSnapshot(prev, next)) {
          return prev;
        }
        return next;
      });
    }, []);
    return [state, stableSetState] as const;
  } as typeof React.useState;
}

function createStabilizedUseSyncExternalStore(
  baseHook: typeof React.useSyncExternalStore
): typeof React.useSyncExternalStore {
  return function useStabilizedSyncExternalStore<Snapshot>(
    subscribe: (onStoreChange: () => void) => () => void,
    getSnapshot: () => Snapshot,
    getServerSnapshot?: () => Snapshot
  ): Snapshot {
    const cacheRef = React.useRef<{ initialized: boolean; value: Snapshot }>({
      initialized: false,
      value: undefined as unknown as Snapshot,
    });
    const getSnapshotRef = React.useRef(getSnapshot);
    getSnapshotRef.current = getSnapshot;

    const stableGetSnapshot = React.useCallback((): Snapshot => {
      const next = getSnapshotRef.current();
      if (cacheRef.current.initialized && shallowEqualSnapshot(cacheRef.current.value, next)) {
        return cacheRef.current.value;
      }
      cacheRef.current.initialized = true;
      cacheRef.current.value = next;
      return next;
    }, []);

    return baseHook(subscribe, stableGetSnapshot, getServerSnapshot);
  };
}

function stabilizeZustandStoreHook<T extends (...args: any[]) => any>(useBoundStore: T): T {
  if (typeof useBoundStore !== 'function' || (useBoundStore as any).__bhStabilized) return useBoundStore;
  const wrapped = ((selector?: (state: any) => any, equalityFn?: (a: any, b: any) => boolean) => {
    const cacheRef = React.useRef<{ initialized: boolean; value: any }>({
      initialized: false,
      value: undefined,
    });
    const selectorRef = React.useRef(selector);
    selectorRef.current = selector;
    const eqRef = React.useRef(equalityFn);
    eqRef.current = equalityFn;

    const stableSelector = React.useCallback((state: any) => {
      const currentSelector = selectorRef.current;
      const next = typeof currentSelector === 'function' ? currentSelector(state) : state;
      const isEqual = eqRef.current || shallowEqualSnapshot;
      if (cacheRef.current.initialized && isEqual(cacheRef.current.value, next)) {
        return cacheRef.current.value;
      }
      cacheRef.current.initialized = true;
      cacheRef.current.value = next;
      return next;
    }, []);

    return useBoundStore(stableSelector, equalityFn || shallowEqualSnapshot);
  }) as unknown as T;
  Object.assign(wrapped, useBoundStore, { __bhStabilized: true });
  Object.setPrototypeOf(wrapped, Object.getPrototypeOf(useBoundStore));
  return wrapped;
}

function wrapZustandModule(zustandMod: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!zustandMod || typeof zustandMod !== 'object') return zustandMod;
  const wrapCreate = (origCreate: any) => {
    if (typeof origCreate !== 'function') return origCreate;
    const wrappedCreate = (initializer?: any) => {
      if (typeof initializer !== 'function') {
        return (nextInit: any) => wrappedCreate(nextInit);
      }
      let syncUpdateDepth = 0;
      let resetScheduled = false;
      const safeInitializer = (set: any, get: any, api: any) => {
        const safeSet = (partial: any, replace?: boolean) => {
          if (syncUpdateDepth > 25) return;
          const currentState = typeof get === 'function' ? get() : undefined;
          const nextPartial = typeof partial === 'function' ? partial(currentState) : partial;
          if (!replace && isPlainObject(currentState) && isPlainObject(nextPartial)) {
            const keys = Object.keys(nextPartial);
            if (keys.length > 0 && keys.every(k => Object.is(currentState[k], nextPartial[k]))) {
              return;
            }
          }
          syncUpdateDepth += 1;
          if (!resetScheduled) {
            resetScheduled = true;
            queueMicrotask(() => {
              syncUpdateDepth = 0;
              resetScheduled = false;
            });
          }
          return set(nextPartial, replace);
        };
        if (api && typeof api.setState === 'function') {
          api.setState = safeSet;
        }
        return initializer(safeSet, get, api);
      };
      const storeHook = origCreate(safeInitializer);
      return stabilizeZustandStoreHook(storeHook);
    };
    return Object.assign(wrappedCreate, origCreate);
  };

  const nextMod: Record<string, unknown> = { ...zustandMod };
  if (typeof nextMod.create === 'function') {
    nextMod.create = wrapCreate(nextMod.create);
  }
  if (typeof nextMod.default === 'function') {
    nextMod.default = wrapCreate(nextMod.default);
  } else if (nextMod.default && typeof nextMod.default === 'object') {
    const defObj = { ...(nextMod.default as Record<string, unknown>) };
    if (typeof defObj.create === 'function') defObj.create = wrapCreate(defObj.create);
    nextMod.default = defObj;
  }
  return nextMod;
}

const REACT_MINIFIED_ERRORS: Record<string, string> = {
  '130': 'Element type is invalid: expected a string or a class/function component, but got undefined or an object. Check default vs named imports/exports.',
  '185': 'Maximum update depth exceeded (#185): a component or store selector triggered an infinite re-render loop (for example, returning a new array/object inside a Zustand selector or calling setState during render/useEffect without stable dependencies).',
  '300': 'Rendered fewer hooks than expected (#300): do not call React hooks after an early return or inside conditions.',
  '301': 'Too many re-renders (#301): a component called setState unconditionally during render.',
  '310': 'Rendered more hooks than during the previous render (#310): ensure all hooks are called unconditionally at the top level of the component.',
};

export function formatPreviewRenderError(error: Error | null | undefined, errorInfo?: ErrorInfo): string {
  const raw = error?.message || 'An error occurred during rendering.';
  const match = raw.match(/Minified React error #(\d+)/i);
  const decoded = match && REACT_MINIFIED_ERRORS[match[1]]
    ? `${REACT_MINIFIED_ERRORS[match[1]]} (${raw})`
    : raw;
  const stackLines = (errorInfo?.componentStack || '')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.startsWith('at ') || line.startsWith('in '))
    .map(line => line.replace(/^(?:at|in)\s+([A-Za-z0-9_$]+).*/, '$1'))
    .filter(name => name && !['PreviewErrorBoundary', 'PreviewRouter', 'MemoryRouter', 'Router', 'Canvas', 'ErrorBoundary'].includes(name))
    .slice(0, 5);
  if (stackLines.length > 0 && !decoded.includes('[Component stack:')) {
    return `${decoded} [Component stack: ${stackLines.join(' <- ')}]`;
  }
  return decoded;
}

const safeLucideIcons = createSafeLucideIcons({});
const stabilizedReact = Object.assign({}, React, {
  useState: createStabilizedUseState(React.useState),
  useSyncExternalStore: createStabilizedUseSyncExternalStore(React.useSyncExternalStore),
  default: undefined as unknown,
});
stabilizedReact.default = stabilizedReact;

const builtinLibraries: Record<string, unknown> = {
  react: stabilizedReact,
  'react-dom': ReactDOMBase,
  'react-dom/client': ReactDOM,
  'react/jsx-runtime': JSXRuntime,
  'react/jsx-dev-runtime': JSXRuntime,
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
  formattedMessage: string;
}

function PreviewReadySignal({ revision, syncAck }: { revision: number; syncAck: number }) {
  useEffect(() => {
    if (window.parent !== window) window.parent.postMessage({ type: 'preview-success' }, '*');
  }, [revision, syncAck]);
  return null;
}

class PreviewErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, formattedMessage: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error, formattedMessage: formatPreviewRenderError(error) };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    const formattedMessage = formatPreviewRenderError(error, errorInfo);
    this.setState({ formattedMessage });
    console.error('Preview render error:', formattedMessage, errorInfo?.componentStack);
    this.props.onError(new Error(formattedMessage), errorInfo);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    const message = this.state.formattedMessage || formatPreviewRenderError(this.state.error);
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
    syncAck,
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
      for (const libName of Object.keys(libraries)) {
        if (libName === 'zustand' || libName.startsWith('zustand/')) {
          libraries[libName] = wrapZustandModule(libraries[libName] as Record<string, unknown>);
        }
      }
      for (const name of ['react-router-dom', 'react-router']) {
        const router = libraries[name] as any;
        if (!router?.MemoryRouter) continue;
        const PreviewRouter = (props: any) => router.useInRouterContext() ? props.children : React.createElement(router.MemoryRouter, props);
        libraries[name] = { ...router, BrowserRouter: PreviewRouter, HashRouter: PreviewRouter, MemoryRouter: PreviewRouter };
      }
      const loader = createPreviewModuleLoader(files, libraries, stabilizedReact, transpileCacheRef.current);
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
        {/* Safe: PreviewRunner only mounts inside an opaque-origin sandbox — see preview-main.tsx:41 */}
        {stylesCode && <style dangerouslySetInnerHTML={{ __html: stylesCode.replace(/<\/style/gi, '<\\/style') }} />}
        <PreparingPreview />
      </>
    );
  }

  return (
    <>
      {/* Safe: PreviewRunner only mounts inside an opaque-origin sandbox — see preview-main.tsx:41 */}
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
        {RenderedComponent ? <PreviewReadySignal revision={revision} syncAck={syncAck} /> : null}
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
