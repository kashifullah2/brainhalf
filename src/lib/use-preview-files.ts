import { useState, useEffect, useLayoutEffect, useCallback, useRef } from 'react';
import { basicReactTemplate } from './templates';
import { InMemoryDataStore } from './backend-runner';
import { PRODUCTION_ALLOWED_ORIGINS, ALLOWED_ORIGINS } from './allowed-origins';
import { selectHtmlEntry } from './preview-entry';
import { loadPreviewDependencies } from './preview-modules';
import { createPreviewFetch } from './preview-fetch';

const nativeFetch = window.fetch.bind(window);

const DEP_LOAD_TIMEOUT_MS = 30_000;
const DEP_LOAD_MAX_RETRIES = 2;
const FILE_SYNC_RETRY_MS = 2_000;
const FILE_SYNC_MAX_ATTEMPTS = 5;

function isTrustedParentOrigin(origin: string): boolean {
  if (PRODUCTION_ALLOWED_ORIGINS.includes(origin)) return true;
  // In local dev, also trust localhost origins
  if (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
    return ALLOWED_ORIGINS.includes(origin);
  }
  return false;
}

function getDefaultFiles(): Record<string, string> {
  return {
    '/src/App.jsx': basicReactTemplate['src'].directory['App.jsx'].file.contents,
    '/src/styles.css': basicReactTemplate['src'].directory['styles.css'].file.contents,
  };
}

export interface PreviewDependencies {
  files: Record<string, string>;
  libraries: Record<string, unknown>;
  error?: string;
}

export function usePreviewFiles(
  projectId: string,
  initialFiles?: Record<string, string>,
  builtinLibraries: Record<string, unknown> = {},
) {
  const [revision, setRevision] = useState(0);
  const [syncAck, setSyncAck] = useState(0);
  const [files, setFiles] = useState<Record<string, string>>(() => {
    if (initialFiles && Object.keys(initialFiles).length > 0) return initialFiles;
    return getDefaultFiles();
  });
  const currentFiles = useRef(files);
  currentFiles.current = files;

  const [waitingForFiles, setWaitingForFiles] = useState(
    () => window.parent !== window && (!initialFiles || Object.keys(initialFiles).length === 0)
  );
  const waitingForFilesRef = useRef(waitingForFiles);

  const lastFileSyncAtRef = useRef(0);
  const [, setTransientTick] = useState(0);

  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const reportRuntimeError = useCallback((error: string) => {
    setRuntimeError(error);
    if (window.parent !== window) window.parent.postMessage({ type: 'preview-error', layer: 'frontend', error }, '*');
  }, []);

  // Listen for file sync messages from the parent window.
  useEffect(() => {
    const applyFiles = (next: Record<string, string>) => {
      lastFileSyncAtRef.current = Date.now();
      const initialSync = waitingForFilesRef.current;
      waitingForFilesRef.current = false;
      setWaitingForFiles(false);
      setRuntimeError(null);
      const previous = currentFiles.current;
      if (Object.keys(previous).length === Object.keys(next).length && Object.keys(previous).every(path => previous[path] === next[path])) {
        // Files already match (e.g. embedded in #preview-data on initial load).
        // Still bump syncAck so PreviewReadySignal re-notifies the parent
        // Workspace that the preview is rendered and ready!
        setSyncAck(value => value + 1);
        return;
      }
      if (!initialSync && selectHtmlEntry(previous)) {
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
      setSyncAck(value => value + 1);
    };
    const handleMessage = (event: MessageEvent) => {
      if (event.source !== window.parent || !isTrustedParentOrigin(event.origin)) return;
      if (!event.data || typeof event.data !== 'object') return;
      if (event.data.type === 'preview-revision' || event.data.type === 'check-preview-ready') {
        setSyncAck(value => value + 1);
        return;
      }
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
        if (Object.keys(changed).length === 0 && removed.length === 0) {
          setSyncAck(value => value + 1);
          return;
        }

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

  // Simulated backend store.
  const [store] = useState(() => new InMemoryDataStore());
  const transpileCacheRef = useRef(new Map<string, { source: string; code: string }>());

  const [dependencies, setDependencies] = useState<PreviewDependencies | null>(null);
  const depLoadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastImportKeyRef = useRef('');

  useEffect(() => {
    if (waitingForFiles) return;
    let active = true;
    let retryCount = 0;

    const doLoad = () => {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: 'preview-loading', projectId }, '*');
      }
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
            if (window.parent && window.parent !== window) {
              window.parent.postMessage({ type: 'preview-loading', projectId }, '*');
            }
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

    const pkgJson = files['/package.json'] ?? files['package.json'] ?? '';
    const importKey = [
      pkgJson,
      ...Object.entries(files)
        .filter(([path]) => /\.(?:[cm]?[jt]sx?|html)$/.test(path))
        .flatMap(([, content]) => {
          const matches = content.match(/\b(?:from\s*|import\s*(?:\(\s*)?|require\s*\(\s*)['"]([^'"]+)['"]/g);
          return matches || [];
        })
        .sort(),
    ].join('\n');

    if (importKey !== lastImportKeyRef.current || !dependencies) {
      lastImportKeyRef.current = importKey;
      if (depLoadTimerRef.current) clearTimeout(depLoadTimerRef.current);
      depLoadTimerRef.current = setTimeout(doLoad, dependencies ? 300 : 0);
    } else if (dependencies && dependencies.files !== files) {
      if (dependencies.error) {
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

  // Intercept fetch calls to /api/* and route them to simulated backend.
  useLayoutEffect(() => {
    window.fetch = createPreviewFetch(nativeFetch, files, store, window.location.origin, (error) => {
      if (window.parent !== window) window.parent.postMessage({ type: 'preview-error', layer: 'backend', error, file: '/server/index.js' }, '*');
    });
    return () => { window.fetch = nativeFetch; };
  }, [files, store]);

  // Watchdog: re-request files if initial sync was lost.
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

  // Global error listeners.
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

  return {
    revision,
    syncAck,
    files,
    waitingForFiles,
    runtimeError,
    reportRuntimeError,
    dependencies,
    store,
    transpileCacheRef,
    lastFileSyncAtRef,
    setTransientTick,
  };
}
