import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  Code2, Monitor, ExternalLink, RefreshCw, Loader2, Play, Sparkles, Lock,
  Terminal, Copy, Check, FolderCode, Download,
  Tablet, Smartphone, WrapText, ListFilter,
  Zap, Box, MoreHorizontal, X, Server, AlertTriangle
} from 'lucide-react';
import Editor from '@monaco-editor/react';
import { basicReactTemplate } from '../lib/templates';
import { appEvents } from '../lib/events';
import { exportProjectAsZip } from '../lib/zip-export';
import { exportToGitHub } from '../lib/github-export';
import { normalizePath } from '../lib/utils';
import { getProjectFiles, saveProjectFiles } from '../lib/project-store';
import { validateBackendFiles, isFullStackProject } from '../lib/backend-runner';
import FileExplorer from './FileExplorer';
import { SandpackProvider, SandpackPreview } from '@codesandbox/sandpack-react';
import { withTokenQuery } from '../lib/auth-client';

type GenerationStatus = 'Idle' | 'Generating' | 'Ready' | 'Error';
type WorkspaceTab = 'code' | 'backend' | 'preview' | 'console' | 'logs';
type ViewportMode = 'desktop' | 'tablet' | 'mobile';
type PreviewEngine = 'edge' | 'sandpack';
type FileMap = Record<string, string>;

interface BuildLogItem {
  id: string;
  time: string;
  text: string;
  type: 'info' | 'success' | 'warn' | 'error';
}

interface WorkspaceProps {
  activeProjectId: string;
  mobileTab?: 'chat' | 'code' | 'preview';
}

const MAX_LOG_ENTRIES = 250;

/* ------------------------------------------------------------------ *
 * Helpers hoisted out of the component
 *
 * The legacy-starter migration was written out three separate times —
 * in the useState initialiser, again in the project-change effect, and
 * partially in the Sandpack memo. The three copies had already drifted
 * (only one of them applied the 100vh fix). One function now.
 * ------------------------------------------------------------------ */

const LEGACY_STARTER_MARKERS = [
  'BRAINHALF CORE // REACTIVE ENGINE',
  'BrainHalf Studio',
  'From interactive workflows to full-stack reactive prototypes',
];

function baselineFiles(): FileMap {
  return {
    '/src/App.jsx': basicReactTemplate['src'].directory['App.jsx'].file.contents,
    '/src/main.jsx': basicReactTemplate['src'].directory['main.jsx'].file.contents,
    '/src/styles.css': basicReactTemplate['src'].directory['styles.css'].file.contents,
  };
}

/**
 * Returns a migrated copy when the project carries an outdated starter, or the
 * same reference when nothing changed — so callers can cheaply tell whether a
 * persist is needed.
 */
function migrateStarter(files: FileMap): FileMap {
  const app = files['/src/App.jsx'];
  if (!app) return files;

  if (LEGACY_STARTER_MARKERS.some(marker => app.includes(marker))) {
    return { ...files, '/src/App.jsx': basicReactTemplate['src'].directory['App.jsx'].file.contents };
  }

  // The starter used 100vh inside a flex-height preview frame, which produced a
  // scrollbar and clipped the card on short viewports.
  const isCurrentStarter =
    app.includes("minHeight: '100vh'") &&
    (app.includes('What do you want to build?') || app.includes('Architect your idea into living software.'));
  if (isCurrentStarter) {
    return { ...files, '/src/App.jsx': app.replace("minHeight: '100vh'", "height: '100%', minHeight: '100%'") };
  }

  return files;
}

function timestamp(): string {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function isServerPath(path: string): boolean {
  return path.startsWith('/server/') || path.startsWith('server/') || path.includes('.env');
}

/** Copies text with a documented fallback for non-secure contexts. */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the textarea path */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/** Tracks viewport width so the toolbar can drop labels before it overflows. */
function useViewportWidth(): number {
  const [width, setWidth] = useState(() => (typeof window === 'undefined' ? 1280 : window.innerWidth));
  useEffect(() => {
    let frame = 0;
    const onResize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setWidth(window.innerWidth));
    };
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', onResize);
    };
  }, []);
  return width;
}

const STARTER_BACKEND: FileMap = {
  '/server/index.js': `import express from 'express';
import cors from 'cors';
import { router as apiRoutes } from './routes/api.js';

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());
app.use('/api', apiRoutes);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'brainhalf-backend', timestamp: new Date().toISOString() });
});

app.listen(port, () => {
  console.log(\`Backend server running on port \${port}\`);
});
`,
  '/server/routes/api.js': `import { Router } from 'express';
import { getItems, createItem, getItemById, deleteItem } from '../controllers/items.js';

export const router = Router();

router.get('/items', getItems);
router.post('/items', createItem);
router.get('/items/:id', getItemById);
router.delete('/items/:id', deleteItem);
`,
  '/server/controllers/items.js': `import { db } from '../db.js';

export const getItems = (req, res) => {
  res.json(db.findAll('items'));
};

export const createItem = (req, res) => {
  if (!req.body || typeof req.body !== 'object') {
    return res.status(400).json({ error: 'Expected a JSON body' });
  }
  res.status(201).json(db.create('items', req.body));
};

export const getItemById = (req, res) => {
  const item = db.findById('items', req.params.id);
  if (!item) return res.status(404).json({ error: 'Item not found' });
  res.json(item);
};

export const deleteItem = (req, res) => {
  const success = db.delete('items', req.params.id);
  if (!success) return res.status(404).json({ error: 'Item not found' });
  res.json({ success: true });
};
`,
  '/server/db.js': `// In-memory data layer for the BrainHalf preview.
// Swap for Postgres or Mongo by reading process.env.DATABASE_URL / MONGODB_URI.
export class LocalDatabase {
  constructor() {
    this.collections = new Map();
  }
  findAll(name) { return Array.from(this.collections.get(name)?.values() || []); }
  findById(name, id) { return this.collections.get(name)?.get(String(id)) || null; }
  create(name, data) {
    if (!this.collections.has(name)) this.collections.set(name, new Map());
    const id = data.id || crypto.randomUUID();
    const record = { ...data, id, createdAt: new Date().toISOString() };
    this.collections.get(name).set(String(id), record);
    return record;
  }
  delete(name, id) { return this.collections.get(name)?.delete(String(id)) || false; }
}

export const db = new LocalDatabase();
`,
  // NOTE: no default secret value here. A shipped placeholder like
  // "brainhalf_development_secret_key_12345" is the kind of thing that survives
  // all the way into a deployed app and becomes a real JWT forgery vector.
  '/server/.env': `PORT=3001
NODE_ENV=development
# Generate a strong value before deploying, e.g. openssl rand -hex 32
JWT_SECRET=
# DATABASE_URL=postgresql://user:pass@localhost:5432/mydb
`,
};

const Workspace: React.FC<WorkspaceProps> = ({ activeProjectId, mobileTab }) => {
  const [files, setFiles] = useState<FileMap>(() => migrateStarter(getProjectFiles(activeProjectId) || baselineFiles()));
  
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('preview');
  const [viewportMode, setViewportMode] = useState<ViewportMode>('desktop');
  const [previewEngine, setPreviewEngine] = useState<PreviewEngine>(() => isFullStackProject(migrateStarter(getProjectFiles(activeProjectId) || baselineFiles())) ? 'edge' : 'sandpack');
  const [edgeRefreshCounter, setEdgeRefreshCounter] = useState(0);
  const [wordWrap, setWordWrap] = useState<'on' | 'off'>('on');

  const viewportWidth = useViewportWidth();
  const compactToolbar = viewportWidth < 1100;

  // FIX: the initialiser used to run the starter migration and call
  // saveProjectFiles() as a side effect. A useState initialiser can run more
  // than once (StrictMode, a re-mount), so that wrote to storage during render.
  // It now only computes; the effect below owns persistence.
  const [status, setStatus] = useState<GenerationStatus>(() => (getProjectFiles(activeProjectId) ? 'Ready' : 'Idle'));
  const [statusDetail, setStatusDetail] = useState('');
  const [hasProject, setHasProject] = useState(true);
  const [generatingFile, setGeneratingFile] = useState('');
  const [activeFile, setActiveFile] = useState('/src/App.jsx');

  const [consoleLogs, setConsoleLogs] = useState<string[]>(['Preview ready.', 'Waiting for changes...']);
  const [buildLogs, setBuildLogs] = useState<BuildLogItem[]>([
    { id: 'init', time: timestamp(), text: 'Workspace ready.', type: 'info' }
  ]);
  const [copiedCode, setCopiedCode] = useState(false);

  // GitHub export
  const [showGithubModal, setShowGithubModal] = useState(false);
  const [githubRepo, setGithubRepo] = useState('');
  const [githubToken, setGithubToken] = useState('');
  const [rememberToken, setRememberToken] = useState(false);
  const [githubStatus, setGithubStatus] = useState<{ loading: boolean; error?: string; success?: string }>({ loading: false });

  const [showDiagnosticMenu, setShowDiagnosticMenu] = useState(false);
  const [showEngineMenu, setShowEngineMenu] = useState(false);

  const diagnosticMenuRef = useRef<HTMLDivElement>(null);
  const engineMenuRef = useRef<HTMLDivElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const githubTriggerRef = useRef<HTMLElement | null>(null);
  const consoleEndRef = useRef<HTMLDivElement>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const filesRef = useRef<FileMap>(files);
  const activeFileRef = useRef(activeFile);
  const handleRefreshRef = useRef<() => void>(() => { });

  useEffect(() => {
    if (mobileTab === 'code' || mobileTab === 'preview') setActiveTab(mobileTab);
  }, [mobileTab]);

  const addBuildLog = useCallback((text: string, type: BuildLogItem['type'] = 'info') => {
    setBuildLogs(prev => [
      ...prev.slice(-(MAX_LOG_ENTRIES - 1)),
      { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, time: timestamp(), text, type }
    ]);
  }, []);

  const addConsoleLog = useCallback((text: string) => {
    setConsoleLogs(prev => [...prev.slice(-(MAX_LOG_ENTRIES - 1)), text]);
  }, []);

  /**
   * The single mutation point for the file map.
   *
   * FIX: handlers used to do `filesRef.current[path] = content` and then call
   * `saveProjectFiles(activeProjectId, filesRef.current)`. Because filesRef and
   * the `files` state pointed at the same object, that mutated current React
   * state in place and persisted a snapshot that React had not rendered yet.
   * Every write now produces a new object, updates the ref, persists, and
   * syncs — in that order, once.
   */
  const commitFiles = useCallback((next: FileMap, opts: { replaceAll?: boolean; persist?: boolean } = {}) => {
    const { replaceAll = false, persist = true } = opts;
    filesRef.current = next;
    setFiles(next);
    if (persist) saveProjectFiles(activeProjectId, next);
    appEvents.emit('sync-files', { files: next, replaceAll });
  }, [activeProjectId]);

  useEffect(() => { activeFileRef.current = activeFile; }, [activeFile]);

  // Keep filesRef in step with any state update that did not go through
  // commitFiles, and push the current map into the preview iframe.
  useEffect(() => {
    filesRef.current = files;
    iframeRef.current?.contentWindow?.postMessage({ type: 'sync-files', files }, window.location.origin);
  }, [files]);

  // FIX: consoleEndRef and a logs anchor were rendered but nothing ever scrolled
  // to them, so both panes silently stopped following new output once the list
  // exceeded the visible height.
  useEffect(() => {
    if (activeTab === 'console') consoleEndRef.current?.scrollIntoView({ block: 'end' });
  }, [consoleLogs, activeTab]);

  useEffect(() => {
    if (activeTab === 'logs') logsEndRef.current?.scrollIntoView({ block: 'end' });
  }, [buildLogs, activeTab]);

  useEffect(() => {
    const unsub = appEvents.on('open-github-modal', () => {
      githubTriggerRef.current = document.activeElement as HTMLElement;
      setShowGithubModal(true);
    });
    return () => unsub();
  }, []);

  // Dropdown dismissal. Escape closes the innermost layer only, so it does not
  // tear down the whole UI in one keystroke. Window blur handles clicks into iframes.
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (diagnosticMenuRef.current && !diagnosticMenuRef.current.contains(e.target as Node)) setShowDiagnosticMenu(false);
      if (engineMenuRef.current && !engineMenuRef.current.contains(e.target as Node)) setShowEngineMenu(false);
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (showGithubModal) { setShowGithubModal(false); return; }
      if (showEngineMenu) { setShowEngineMenu(false); return; }
      if (showDiagnosticMenu) setShowDiagnosticMenu(false);
    };
    const handleWindowBlur = () => {
      setShowDiagnosticMenu(false);
      setShowEngineMenu(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('blur', handleWindowBlur);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('blur', handleWindowBlur);
    };
  }, [showGithubModal, showEngineMenu, showDiagnosticMenu]);

  // Modal focus management: move focus in on open, restore it on close, and keep
  // Tab inside the dialog while it is up.
  useEffect(() => {
    if (!showGithubModal) {
      githubTriggerRef.current?.focus?.();
      return;
    }
    const node = modalRef.current;
    if (!node) return;
    const focusables = node.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), [href], select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    focusables[0]?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    node.addEventListener('keydown', onKeyDown);
    return () => node.removeEventListener('keydown', onKeyDown);
  }, [showGithubModal]);

  const handleExportZip = useCallback(async () => {
    try {
      await exportProjectAsZip(filesRef.current, activeProjectId || 'brainhalf-project');
      addBuildLog(`Project exported as ZIP: ${activeProjectId || 'brainhalf-project'}`, 'success');
    } catch (err: any) {
      addBuildLog(`ZIP export failed: ${err?.message || err}`, 'error');
    }
  }, [activeProjectId, addBuildLog]);

  const handleExportGitHub = useCallback(async () => {
    if (!githubRepo.trim() || !githubToken.trim()) return;
    setGithubStatus({ loading: true });
    try {
      // FIX: the PAT was written to localStorage unconditionally, where it
      // persists indefinitely and is readable by any XSS on this origin. It is
      // now kept in memory by default; persisting is an explicit opt-in, and
      // sessionStorage clears when the tab closes.
      if (rememberToken) {
        try { sessionStorage.setItem('brainhalf_github_pat', githubToken); } catch { /* storage may be blocked */ }
      } else {
        try { sessionStorage.removeItem('brainhalf_github_pat'); } catch { /* ignore */ }
      }
      await exportToGitHub(filesRef.current, githubRepo.trim(), githubToken.trim());
      setGithubStatus({ loading: false, success: `Pushed to GitHub: ${githubRepo.trim()}` });
      addBuildLog(`Pushed codebase to GitHub: ${githubRepo.trim()}`, 'success');
    } catch (err: any) {
      setGithubStatus({ loading: false, error: err?.message || 'Failed to export to GitHub' });
      addBuildLog(`GitHub export failed: ${err?.message || err}`, 'error');
    }
  }, [githubRepo, githubToken, rememberToken, addBuildLog]);

  // Restore an opted-in token for this tab only.
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem('brainhalf_github_pat');
      if (saved) { setGithubToken(saved); setRememberToken(true); }
    } catch { /* storage may be unavailable */ }
  }, []);

  /* ---------------- Sandpack file map ---------------- */
  const sandpackFiles = useMemo(() => {
    const spFiles: Record<string, string> = {};

    for (const [rawPath, content] of Object.entries(files)) {
      // Server files are not bundled by Sandpack and a .env in the bundler's
      // virtual FS is a secret sitting in the browser for no benefit.
      if (isServerPath(rawPath)) continue;
      const cleanPath = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
      spFiles[cleanPath] = content;
      if (cleanPath.startsWith('/src/')) spFiles[cleanPath.replace(/^\/src\//, '/')] = content;
    }

    const appCode =
      files['/src/App.jsx'] || files['/src/App.tsx'] || files['/src/App.js'] ||
      files['/App.jsx'] || files['/App.tsx'] || files['/App.js'] ||
      files['App.jsx'] || files['App.tsx'] || files['src/App.jsx'] || '';

    if (appCode) {
      spFiles['/App.tsx'] = appCode;
      spFiles['/App.jsx'] = appCode;
      spFiles['/App.js'] = appCode;
      spFiles['/src/App.jsx'] = appCode;
    }

    const stylesCode =
      files['/src/styles.css'] || files['/styles.css'] || files['src/styles.css'] || files['styles.css'] || '';
    spFiles['/styles.css'] = stylesCode;
    spFiles['/src/styles.css'] = stylesCode;

    spFiles['/index.tsx'] = `import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';

const rootElement = document.getElementById('root');
if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
`;

    // Auto-stub missing relative imports so Sandpack does not hard-crash with
    // "Could not find module in path" mid-generation.
    //
    // FIX: the scan iterated Object.entries(spFiles) captured once, so a stub
    // created during the pass was never itself scanned — a missing component
    // that imported another missing component still crashed. A worklist handles
    // the transitive case, with a ceiling so a pathological project cannot spin.
    const registered = new Set(Object.keys(spFiles));
    const queue = Object.keys(spFiles).filter(p => /\.(jsx?|tsx?)$/.test(p));
    let processed = 0;

    while (queue.length > 0 && processed < 500) {
      const filePath = queue.shift() as string;
      processed++;
      const content = spFiles[filePath];
      if (typeof content !== 'string') continue;

      const importRegex = /(?:from|import)\s*\(?['"](\.[^'"]+)['"]\)?/g;
      let match: RegExpExecArray | null;
      while ((match = importRegex.exec(content)) !== null) {
        const relImport = match[1];
        const dir = filePath.substring(0, filePath.lastIndexOf('/')) || '';
        const parts = (dir + '/' + relImport).split('/').filter(Boolean);
        const resolvedParts: string[] = [];
        for (const p of parts) {
          if (p === '.') continue;
          if (p === '..') resolvedParts.pop();
          else resolvedParts.push(p);
        }
        const resolvedPath = '/' + resolvedParts.join('/');

        const exists = ['', '.jsx', '.tsx', '.js', '.ts', '/index.jsx', '/index.tsx']
          .some(suffix => registered.has(resolvedPath + suffix));
        if (exists) continue;

        const compName = resolvedPath.split('/').pop()?.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_]/g, '') || 'Component';
        const stubCode = `import React from 'react';
export default function ${compName}(props) {
  return (
    <div style={{
      padding: '16px 20px',
      margin: '12px 0',
      border: '1px dashed rgba(99, 102, 241, 0.4)',
      borderRadius: '8px',
      background: 'rgba(99, 102, 241, 0.05)',
      color: '#818cf8',
      fontFamily: 'system-ui, sans-serif'
    }}>
      <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '4px' }}>${compName}</div>
      <div style={{ fontSize: '11px', opacity: 0.7 }}>Component loading...</div>
      {props?.children}
    </div>
  );
}
`;
        const register = (p: string) => {
          if (registered.has(p)) return;
          spFiles[p] = stubCode;
          registered.add(p);
          if (/\.(jsx?|tsx?)$/.test(p)) queue.push(p);
        };

        register(resolvedPath);
        if (!/\.(jsx?|tsx?)$/.test(resolvedPath)) register(resolvedPath + '.jsx');
        register(resolvedPath.startsWith('/src/') ? resolvedPath.replace(/^\/src\//, '/') : '/src' + resolvedPath);
      }
    }

    return spFiles;
  }, [files]);

  /* ---------------- Project lifecycle ---------------- */
  useEffect(() => {
    const stored = getProjectFiles(activeProjectId);
    const isNewProject = !stored || Object.keys(stored).length === 0;
    const next = isNewProject ? baselineFiles() : migrateStarter(stored);

    filesRef.current = next;
    setFiles(next);
    setHasProject(true);
    setStatus('Ready');
    setActiveFile(prev => (next[prev] ? prev : '/src/App.jsx'));
    saveProjectFiles(activeProjectId, next);
    appEvents.emit('sync-files', { files: next, replaceAll: isNewProject });

    const handleClearWorkspace = () => {
      const fresh = baselineFiles();
      filesRef.current = fresh;
      setFiles(fresh);
      setHasProject(true);
      setStatus('Idle');
      setStatusDetail('');
      setActiveFile('/src/App.jsx');
      saveProjectFiles(activeProjectId, fresh);
      appEvents.emit('sync-files', { files: fresh, replaceAll: true });
      addBuildLog('Workspace reset to the baseline React 18 template', 'warn');
    };

    const unsubClear = appEvents.on('clear-workspace', handleClearWorkspace);
    return () => unsubClear();
  }, [activeProjectId, addBuildLog]);

  /* ---------------- Generation events ---------------- */
  useEffect(() => {
    const handleGenerationStatus = ({ status: newStatus, detail, file, error }: any) => {
      if (newStatus === 'Generating') {
        setStatus('Generating');
        setHasProject(true);
        if (detail) {
          setStatusDetail(detail);
          addBuildLog(detail, 'info');
          addConsoleLog(`[ai] ${detail}`);
        }
        if (file) {
          setGeneratingFile(file);
          addBuildLog(`Generating: ${file}`, 'info');
        }
        return;
      }

      if (newStatus === 'Ready') {
        setHasProject(true);
        setGeneratingFile('');
        const backendErr = validateBackendFiles(filesRef.current);
        if (backendErr) {
          setStatus('Error');
          const msg = backendErr.error || '[Backend Error] Syntax or configuration error in server files';
          setStatusDetail(msg);
          addBuildLog(msg, 'error');
          addConsoleLog(`[backend-error] ${msg}`);
          return;
        }
        setStatusDetail('');
        setStatus('Ready');
        addBuildLog(
          isFullStackProject(filesRef.current)
            ? 'Full-stack application (frontend + backend) ready'
            : 'All components generated successfully',
          'success'
        );
        addConsoleLog('[build] Client and server components compiled.');
        appEvents.emit('sync-files', { files: filesRef.current, replaceAll: false });
        handleRefreshRef.current?.();
        return;
      }

      if (newStatus === 'Error') {
        setStatus('Error');
        setGeneratingFile('');
        const errMsg = error || 'Generation failed';
        const attributed = errMsg.startsWith('[') ? errMsg : `[Build Error] ${errMsg}`;
        setStatusDetail(attributed);
        addBuildLog(attributed, 'error');
        addConsoleLog(`[error] ${attributed}`);
      }
    };

    const handleFileGenerated = ({ path, content, isComplete }: { path: string; content: string; isComplete?: boolean }) => {
      const cleanPath = normalizePath(path);
      setHasProject(true);
      setGeneratingFile(path);

      // Streaming chunks arrive many times per file, so only the completed file
      // is persisted and synced; intermediate states just update the editor.
      const next = { ...filesRef.current, [cleanPath]: content };
      if (isComplete) {
        commitFiles(next);
        addBuildLog(`Compiled: ${cleanPath}`, 'success');
        addConsoleLog(`[transpiler] Compiled ${cleanPath}`);
      } else {
        filesRef.current = next;
        setFiles(next);
      }
    };

    const handleFileDeleted = ({ path }: { path: string }) => {
      const cleanPath = normalizePath(path);
      const next = { ...filesRef.current };
      delete next[cleanPath];
      commitFiles(next);
      if (activeFileRef.current === cleanPath) setActiveFile('/src/App.jsx');
      addBuildLog(`Deleted: ${cleanPath}`, 'info');
      addConsoleLog(`[transpiler] Deleted ${cleanPath}`);
    };

    const handleOpenFile = ({ path }: { path: string }) => {
      const cleanPath = normalizePath(path);
      setActiveFile(cleanPath);
      setActiveTab(isServerPath(cleanPath) ? 'backend' : 'code');
    };

    const handleExport = async ({ projectName }: { projectName?: string }) => {
      try {
        await exportProjectAsZip(filesRef.current, projectName || 'brainhalf-project');
        addBuildLog(`Project exported as ZIP: ${projectName || 'brainhalf-project'}`, 'success');
      } catch (err: any) {
        addBuildLog(`ZIP export failed: ${err?.message || err}`, 'error');
      }
    };

    const handleRequestContext = ({ requestId }: { requestId: string }) => {
      appEvents.emit(`workspace-context-response-${requestId}`, { files: filesRef.current });
    };

    // FIX: this used to log "Command executed: <cmd>" and return
    // `{ output: 'Command executed: ...' }` without running anything. The
    // preview has no shell, so the agent was being told its command succeeded
    // and would act on that. It now reports the truth.
    const handleExecuteCommand = async ({ command, requestId }: { command: string; requestId: string }) => {
      addConsoleLog(`$ ${command}`);
      const message = 'Shell commands are not supported in the edge preview runtime. ' +
        'Change project files directly, or export the project and run the command locally.';
      addConsoleLog(`  ${message}`);
      appEvents.emit(`command-result-${requestId}`, { output: message, ok: false, unsupported: true });
    };

    const handleFilesRefreshed = (newFiles: FileMap) => {
      if (!newFiles || Object.keys(newFiles).length === 0) return;
      filesRef.current = newFiles;
      setFiles(newFiles);
      saveProjectFiles(activeProjectId, newFiles);
      setHasProject(true);
      setStatus('Ready');
      handleRefreshRef.current?.();
    };

    const handleWorkspaceFilesChanged = ({ projectId, files: changedFiles }: { projectId: string; files: FileMap }) => {
      if (projectId !== activeProjectId || !changedFiles) return;
      filesRef.current = changedFiles;
      setFiles(changedFiles);
      saveProjectFiles(activeProjectId, changedFiles);
      setHasProject(true);
      handleRefreshRef.current?.();
    };

    const unsubs = [
      appEvents.on('generation-status', handleGenerationStatus),
      appEvents.on('file-generated', handleFileGenerated),
      appEvents.on('file-deleted', handleFileDeleted),
      appEvents.on('open-file', handleOpenFile),
      appEvents.on('request-export', handleExport),
      appEvents.on('request-workspace-context', handleRequestContext),
      appEvents.on('execute-command', handleExecuteCommand),
      appEvents.on('files-refreshed', handleFilesRefreshed),
      appEvents.on('workspace-files-changed', handleWorkspaceFilesChanged),
    ];
    return () => unsubs.forEach(unsub => unsub());
  }, [activeProjectId, addBuildLog, addConsoleLog, commitFiles]);

  /* ---------------- Preview iframe messages ---------------- */
  useEffect(() => {
    const handleWindowMessage = (event: MessageEvent) => {
      // FIX: only the message source was checked. An origin check matters too —
      // source identity alone does not tell you the frame still holds the
      // document you served it.
      if (event.origin !== window.location.origin) return;
      if (iframeRef.current && event.source !== iframeRef.current.contentWindow) return;
      if (!event.data || typeof event.data !== 'object') return;

      const { type } = event.data;

      if (type === 'preview-error') {
        const errorMsg = event.data.error || 'Preview runtime error';
        const file = event.data.file || activeFileRef.current;
        const layer = event.data.layer || (String(file).includes('server') ? 'backend' : 'frontend');
        const prefix = layer === 'backend' ? '[Backend Error]' : '[Frontend Error]';
        const cleanMsg = errorMsg.startsWith('[') ? errorMsg : `${prefix} ${errorMsg}`;
        const lineInfo = event.data.lineno ? ` (line ${event.data.lineno})` : '';
        const fullErr = `${cleanMsg}${lineInfo}`;
        setStatus('Error');
        setStatusDetail(fullErr);
        addBuildLog(`${prefix} in ${file}: ${errorMsg}`, 'error');
        addConsoleLog(`[${layer}-error] ${fullErr}`);
        return;
      }

      if (type === 'preview-auto-fix') {
        const file = event.data.file || activeFileRef.current;
        const layer = event.data.layer || (String(file).includes('server') ? 'backend' : 'frontend');
        appEvents.emit('auto-fix-error', { error: event.data.error || 'Error occurred', file, layer });
        return;
      }

      if (type === 'preview-success') {
        setStatus(prev => (prev === 'Error' ? 'Ready' : prev));
        setStatusDetail(prev => (prev.includes('Transpile') || prev.includes('Preview') ? '' : prev));
        appEvents.emit('preview-success', null);
        return;
      }

      if (type === 'request-preview-files') {
        iframeRef.current?.contentWindow?.postMessage(
          { type: 'sync-files', files: filesRef.current },
          window.location.origin
        );
      }
    };

    window.addEventListener('message', handleWindowMessage);
    return () => window.removeEventListener('message', handleWindowMessage);
    // FIX: this effect depended on `statusDetail`, so it tore down and
    // re-registered the window listener on every error message — a listener
    // churn that occasionally dropped a message mid-swap. The handler reads
    // what it needs from refs and functional setState instead.
  }, [addBuildLog, addConsoleLog]);

  const handleEditorChange = useCallback((value: string | undefined) => {
    if (value === undefined) return;
    commitFiles({ ...filesRef.current, [activeFileRef.current]: value });
  }, [commitFiles]);

  const handleLaunchPreview = useCallback(() => {
    setHasProject(true);
    setStatus('Ready');
    appEvents.emit('sync-files', { files: filesRef.current, replaceAll: false });
    setEdgeRefreshCounter(c => c + 1);
    addBuildLog(`Launching ${previewEngine === 'edge' ? 'Cloudflare Edge' : 'Sandpack'} preview`, 'info');
  }, [previewEngine, addBuildLog]);

  const handleRefresh = useCallback(() => {
    appEvents.emit('sync-files', { files: filesRef.current, replaceAll: false });
    setEdgeRefreshCounter(c => c + 1);
    addBuildLog(`Reloading ${previewEngine === 'edge' ? 'Cloudflare Edge' : 'Sandpack'} preview`, 'info');
  }, [previewEngine, addBuildLog]);

  useEffect(() => { handleRefreshRef.current = handleRefresh; }, [handleRefresh]);

  const handleCopyCurrentFile = useCallback(async () => {
    const ok = await copyText(files[activeFile] || '');
    if (!ok) {
      addBuildLog('Could not copy to the clipboard. Select the code and copy manually.', 'warn');
      return;
    }
    setCopiedCode(true);
    window.setTimeout(() => setCopiedCode(false), 2000);
  }, [files, activeFile, addBuildLog]);

  const handleScaffoldBackend = useCallback(() => {
    const serverFile = Object.keys(filesRef.current).find(isServerPath);
    if (serverFile) {
      setActiveFile(serverFile);
      return;
    }
    const next = { ...filesRef.current, ...STARTER_BACKEND };
    commitFiles(next);
    setActiveFile('/server/index.js');
    addBuildLog('Scaffolded Express backend in /server', 'success');
  }, [commitFiles, addBuildLog]);

  const visibleFiles = useMemo(
    () => Object.keys(files).filter(p => (activeTab === 'backend'
      ? isServerPath(p) || p === '/package.json'
      : !isServerPath(p))),
    [files, activeTab]
  );

  const editorLanguage = useMemo(() => {
    if (activeFile.endsWith('.css')) return 'css';
    if (activeFile.endsWith('.json')) return 'json';
    if (activeFile.endsWith('.html')) return 'html';
    if (activeFile.includes('.env')) return 'ini';
    if (activeFile.endsWith('.py')) return 'python';
    if (activeFile.endsWith('.tsx') || activeFile.endsWith('.ts')) return 'typescript';
    return 'javascript';
  }, [activeFile]);

  const isEditorTab = activeTab === 'code' || activeTab === 'backend';

  return (
    <div className="workspace-panel-container">
      {/* Header. minHeight rather than height, and the nav scrolls rather than
          overflowing, so the tabs never collide with the status area on narrow
          viewports. */}
      <div style={{
        minHeight: '48px',
        padding: '0 12px',
        borderBottom: '1px solid var(--border-subtle)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '8px',
        background: 'rgba(255, 255, 255, 0.015)',
        flexShrink: 0,
        position: 'relative',
        zIndex: 50
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', minWidth: 0, overflowX: 'auto', scrollbarWidth: 'none' }}>
            <div className="segmented-control" role="tablist" aria-label="Workspace navigation" style={{ flexShrink: 0 }}>
              <button
                role="tab"
                aria-selected={activeTab === 'code'}
                onClick={() => {
                  setActiveTab('code');
                  if (isServerPath(activeFile)) {
                    const clientFile = Object.keys(filesRef.current).find(p => !isServerPath(p));
                    if (clientFile) setActiveFile(clientFile);
                  }
                }}
                className={`segmented-tab ${activeTab === 'code' ? 'active' : ''}`}
                title="Frontend client code"
              >
                <Code2 size={16} strokeWidth={1.75} />
                <span>Code</span>
              </button>

              <button
                role="tab"
                aria-selected={activeTab === 'backend'}
                onClick={() => { setActiveTab('backend'); handleScaffoldBackend(); }}
                className={`segmented-tab ${activeTab === 'backend' ? 'active' : ''}`}
                title="Backend REST API, database and environment"
              >
                <Server size={16} strokeWidth={1.75} />
                <span>Backend</span>
              </button>

              <button
                role="tab"
                aria-selected={activeTab === 'preview'}
                onClick={() => setActiveTab('preview')}
                className={`segmented-tab ${activeTab === 'preview' ? 'active' : ''}`}
                title="Live application preview"
              >
                <Monitor size={16} strokeWidth={1.75} />
                <span>Preview</span>
              </button>

              {(activeTab === 'console' || activeTab === 'logs') && (
                <div className="segmented-tab active" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  {activeTab === 'console' ? <Terminal size={16} strokeWidth={1.75} /> : <ListFilter size={16} strokeWidth={1.75} />}
                  <span>{activeTab === 'console' ? 'Console' : 'Logs'}</span>
                  <button
                    type="button"
                    onClick={() => setActiveTab('preview')}
                    aria-label="Close diagnostics and return to preview"
                    title="Close diagnostics"
                    style={{
                      background: 'transparent', border: 'none', padding: 0, margin: 0,
                      display: 'flex', cursor: 'pointer', color: 'inherit', opacity: 0.7
                    }}
                  >
                    <X size={16} strokeWidth={1.75} />
                  </button>
                </div>
              )}
            </div>
          </div>

          <div style={{ position: 'relative', flexShrink: 0, zIndex: 100 }} ref={diagnosticMenuRef}>
            <button
              onClick={() => setShowDiagnosticMenu(prev => !prev)}
              className="icon-btn"
              title="Diagnostics (console, logs)"
              aria-label="Diagnostics"
              aria-expanded={showDiagnosticMenu}
              aria-haspopup="menu"
              style={{
                width: '32px', height: '32px', borderRadius: '6px',
                color: (activeTab === 'console' || activeTab === 'logs') ? 'var(--text-primary)' : 'var(--text-muted)'
              }}
            >
              <MoreHorizontal size={16} strokeWidth={1.75} />
            </button>

            {showDiagnosticMenu && (
              <div role="menu" style={{
                position: 'absolute', top: 'calc(100% + 6px)', left: 0, width: '190px',
                background: '#12141c', border: '1px solid var(--border-medium)', borderRadius: '8px',
                boxShadow: '0 12px 28px rgba(0,0,0,0.75)', padding: '4px', zIndex: 1000,
                display: 'flex', flexDirection: 'column', gap: '2px'
              }}>
                <button role="menuitem" className="deploy-menu-item" style={{ padding: '8px', fontSize: '12px' }}
                  onClick={() => { setActiveTab('console'); setShowDiagnosticMenu(false); }}>
                  <Terminal size={16} strokeWidth={1.75} color="var(--color-neutral)" />
                  <span>Terminal console</span>
                  <span style={{ marginLeft: 'auto', fontSize: '10px', color: 'var(--text-muted)' }}>{consoleLogs.length}</span>
                </button>
                <button role="menuitem" className="deploy-menu-item" style={{ padding: '8px', fontSize: '12px' }}
                  onClick={() => { setActiveTab('logs'); setShowDiagnosticMenu(false); }}>
                  <ListFilter size={16} strokeWidth={1.75} color="var(--color-neutral)" />
                  <span>Activity logs</span>
                  <span style={{ marginLeft: 'auto', fontSize: '10px', color: 'var(--text-muted)' }}>{buildLogs.length}</span>
                </button>
              </div>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexShrink: 0 }}>
          {status === 'Generating' && (
            <div
              role="status"
              aria-live="polite"
              style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11.5px', color: 'var(--text-muted)', maxWidth: '220px' }}
            >
              <Loader2 size={12} className="lucide-spin" style={{ color: 'var(--text-primary)', flexShrink: 0 }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {generatingFile ? generatingFile.split('/').pop() : 'Generating...'}
              </span>
            </div>
          )}
          {status === 'Error' && statusDetail && (
            <div
              role="status"
              aria-live="assertive"
              title={statusDetail}
              style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11.5px', color: '#fca5a5', maxWidth: '280px' }}
            >
              <AlertTriangle size={12} style={{ flexShrink: 0 }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{statusDetail}</span>
            </div>
          )}
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, position: 'relative', display: 'flex', overflow: 'hidden', minHeight: 0 }}>
        {isEditorTab ? (
          <div style={{ display: 'flex', width: '100%', height: '100%', minWidth: 0 }}>
            <FileExplorer
              files={files}
              activeFile={activeFile}
              onSelectFile={setActiveFile}
              headerTitle={activeTab === 'backend' ? 'Server files' : 'Client files'}
              filter={path => (activeTab === 'backend' ? isServerPath(path) || path === '/package.json' : !isServerPath(path))}
            />

            <div style={{ flex: 1, minWidth: 0, height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg-code-editor)', overflow: 'hidden' }}>
              {/* File tabs */}
              <div style={{
                minHeight: '36px', background: 'rgba(0, 0, 0, 0.4)',
                borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center',
                overflowX: 'auto', padding: '0 4px', gap: '2px', flexShrink: 0
              }}>
                {visibleFiles.map(filePath => {
                  const isActive = filePath === activeFile;
                  return (
                    <button
                      key={filePath}
                      type="button"
                      onClick={() => setActiveFile(filePath)}
                      aria-current={isActive}
                      title={filePath}
                      style={{
                        padding: '8px 12px',
                        background: isActive ? 'var(--bg-code-editor)' : 'transparent',
                        borderBottom: isActive ? '2px solid var(--accent-primary)' : '2px solid transparent',
                        borderTop: 'none', borderLeft: 'none', borderRight: 'none',
                        color: isActive ? '#ffffff' : 'var(--text-muted)',
                        fontSize: '12px', fontFamily: 'var(--font-mono)',
                        display: 'flex', alignItems: 'center', gap: '6px',
                        cursor: 'pointer', borderRadius: '4px 4px 0 0',
                        whiteSpace: 'nowrap', flexShrink: 0, transition: 'all 0.15s ease'
                      }}
                      className="hover-bright"
                    >
                      {activeTab === 'backend'
                        ? <Server size={13} color={isActive ? '#c084fc' : undefined} />
                        : <Code2 size={13} color={isActive ? 'var(--accent-light)' : undefined} />}
                      <span>{filePath.split('/').pop()}</span>
                    </button>
                  );
                })}
              </div>

              {/* Breadcrumbs and actions. flexWrap so the action cluster drops
                  to a second line instead of overlapping the path on narrow
                  panes. */}
              <div style={{
                padding: '6px 12px', background: 'rgba(0, 0, 0, 0.25)',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                flexWrap: 'wrap', gap: '8px',
                fontSize: '11px', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', flexShrink: 0
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                  <span style={{
                    background: activeTab === 'backend' ? 'rgba(168, 85, 247, 0.15)' : 'rgba(56, 189, 248, 0.15)',
                    color: activeTab === 'backend' ? '#c084fc' : '#38bdf8',
                    border: `1px solid ${activeTab === 'backend' ? 'rgba(168, 85, 247, 0.3)' : 'rgba(56, 189, 248, 0.3)'}`,
                    padding: '2px 8px', borderRadius: '4px', fontSize: '10.5px', fontWeight: 600,
                    display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0
                  }}>
                    {activeTab === 'backend'
                      ? <><Server size={12} strokeWidth={2} />Node.js / Express</>
                      : <><Code2 size={12} strokeWidth={2} />React / Vite</>}
                  </span>
                  <span style={{
                    color: 'var(--text-primary)', fontWeight: 500,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0
                  }}>
                    {activeFile}
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
                  <button
                    onClick={() => setWordWrap(prev => (prev === 'on' ? 'off' : 'on'))}
                    aria-pressed={wordWrap === 'on'}
                    className="hover-bright"
                    title={`Word wrap is ${wordWrap}`}
                    style={{
                      background: wordWrap === 'on' ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
                      border: 'none', color: wordWrap === 'on' ? '#ffffff' : 'var(--text-muted)',
                      borderRadius: '4px', padding: '6px 8px', minHeight: '32px', cursor: 'pointer',
                      display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', fontFamily: 'inherit'
                    }}
                  >
                    <WrapText size={16} strokeWidth={1.75} />
                    {!compactToolbar && <span>Wrap</span>}
                  </button>

                  <button
                    onClick={handleCopyCurrentFile}
                    className="hover-bright"
                    title="Copy this file"
                    aria-label="Copy this file"
                    style={{
                      background: 'transparent', border: 'none',
                      color: copiedCode ? '#34d399' : 'var(--text-muted)',
                      padding: '6px 8px', minHeight: '32px', cursor: 'pointer',
                      display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', fontFamily: 'inherit'
                    }}
                  >
                    {copiedCode ? <Check size={16} strokeWidth={1.75} color="#34d399" /> : <Copy size={16} strokeWidth={1.75} />}
                    {!compactToolbar && <span>{copiedCode ? 'Copied' : 'Copy'}</span>}
                  </button>

                  <button
                    onClick={(e) => { githubTriggerRef.current = e.currentTarget; setShowGithubModal(true); }}
                    className="hover-bright"
                    title="Export to GitHub"
                    aria-label="Export to GitHub"
                    style={{
                      background: 'transparent', border: 'none', color: 'var(--text-muted)',
                      padding: '6px 8px', minHeight: '32px', cursor: 'pointer',
                      display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', fontFamily: 'inherit'
                    }}
                  >
                    <FolderCode size={16} strokeWidth={1.75} />
                    {!compactToolbar && <span>GitHub</span>}
                  </button>

                  <button
                    onClick={handleExportZip}
                    className="hover-bright"
                    title="Export the project as a ZIP"
                    aria-label="Export the project as a ZIP"
                    style={{
                      background: 'transparent', border: 'none', color: 'var(--text-muted)',
                      padding: '6px 8px', minHeight: '32px', cursor: 'pointer',
                      display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', fontFamily: 'inherit'
                    }}
                  >
                    <Download size={16} strokeWidth={1.75} />
                    {!compactToolbar && <span>ZIP</span>}
                  </button>
                </div>
              </div>

              {/* FIX: the editor wrapper used height: calc(100% - 66px) with a
                  hardcoded chrome height. The breadcrumb row wraps on narrow
                  panes, so the real chrome is taller than 66px and the editor
                  overflowed its container. flex:1 with minHeight:0 measures. */}
              <div style={{ flex: 1, minHeight: 0, minWidth: 0, overflow: 'hidden' }}>
                <Editor
                  height="100%"
                  language={editorLanguage}
                  value={files[activeFile] ?? ''}
                  onChange={handleEditorChange}
                  theme="vs-dark"
                  path={activeFile}
                  options={{
                    minimap: { enabled: false },
                    fontSize: 13,
                    lineNumbers: 'on',
                    wordWrap,
                    scrollBeyondLastLine: false,
                    automaticLayout: true,
                    tabSize: 2
                  }}
                />
              </div>
            </div>
          </div>
        ) : activeTab === 'console' ? (
          <div style={{
            width: '100%', height: '100%', background: '#090b10', color: '#e2e8f0',
            display: 'flex', flexDirection: 'column', fontFamily: 'var(--font-mono)', fontSize: '12px', minWidth: 0
          }}>
            <div style={{
              padding: '8px 14px', background: 'rgba(255, 255, 255, 0.02)',
              borderBottom: '1px solid var(--border-subtle)', display: 'flex',
              alignItems: 'center', justifyContent: 'space-between', flexShrink: 0
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Terminal size={14} color="var(--accent-light)" />
                <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>Console</span>
              </div>
              <button
                onClick={() => setConsoleLogs([])}
                className="hover-bright"
                style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', borderRadius: '4px', padding: '6px 10px', minHeight: '32px', fontSize: '11px', cursor: 'pointer' }}
              >
                Clear
              </button>
            </div>
            <div style={{ flex: 1, minHeight: 0, padding: '12px 16px', overflowY: 'auto', lineHeight: 1.6 }}>
              {consoleLogs.length === 0 ? (
                <div style={{ color: 'var(--text-muted)' }}>
                  No console output yet. Run a generation or open the preview to see runtime messages here.
                </div>
              ) : (
                consoleLogs.map((log, lIdx) => (
                  <div
                    key={lIdx}
                    style={{
                      color: /error|ERR_/i.test(log) ? '#f87171' : /ready|VITE/i.test(log) ? '#34d399' : '#cbd5e1',
                      whiteSpace: 'pre-wrap', wordBreak: 'break-word'
                    }}
                  >
                    {log}
                  </div>
                ))
              )}
              <div ref={consoleEndRef} />
            </div>
          </div>
        ) : activeTab === 'logs' ? (
          <div style={{
            width: '100%', height: '100%', background: '#090b10', color: '#e2e8f0',
            display: 'flex', flexDirection: 'column', fontFamily: 'var(--font-mono)', fontSize: '12px', minWidth: 0
          }}>
            <div style={{
              padding: '8px 14px', background: 'rgba(255, 255, 255, 0.02)',
              borderBottom: '1px solid var(--border-subtle)', display: 'flex',
              alignItems: 'center', justifyContent: 'space-between', flexShrink: 0
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <ListFilter size={14} color="var(--accent-light)" />
                <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>Activity</span>
              </div>
              <button
                onClick={() => setBuildLogs([])}
                className="hover-bright"
                style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', borderRadius: '4px', padding: '6px 10px', minHeight: '32px', fontSize: '11px', cursor: 'pointer' }}
              >
                Clear
              </button>
            </div>
            <div style={{ flex: 1, minHeight: 0, padding: '14px 18px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {buildLogs.length === 0 ? (
                <div style={{ color: 'var(--text-muted)', padding: '16px 0' }}>
                  No activity recorded yet. Generations, file writes and errors will be listed here.
                </div>
              ) : (
                buildLogs.map(item => (
                  <div key={item.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', lineHeight: 1.5 }}>
                    <span style={{ color: 'var(--text-muted)', fontSize: '11px', flexShrink: 0, minWidth: '62px' }}>
                      [{item.time}]
                    </span>
                    <span style={{
                      width: '6px', height: '6px', borderRadius: '50%', marginTop: '6px', flexShrink: 0,
                      background: item.type === 'success' ? '#10b981' : item.type === 'error' ? '#ef4444' : item.type === 'warn' ? '#f59e0b' : '#3b82f6'
                    }} />
                    <span style={{
                      color: item.type === 'error' ? '#fca5a5' : item.type === 'success' ? '#86efac' : item.type === 'warn' ? '#fde68a' : '#e2e8f0',
                      wordBreak: 'break-word', minWidth: 0
                    }}>
                      {item.text}
                    </span>
                  </div>
                ))
              )}
              <div ref={logsEndRef} />
            </div>
          </div>
        ) : (
          /* PREVIEW */
          <div
            className="preview-pane-container"
            style={{
              height: '100%', width: '100%', display: 'flex', flexDirection: 'column',
              background: 'var(--bg-preview-canvas)', position: 'relative', overflow: 'hidden',
              containerType: 'inline-size', minWidth: 0
            }}
          >
            <div className="browser-chrome" style={{
              padding: '0 12px', minHeight: '40px', boxSizing: 'border-box',
              display: 'flex', alignItems: 'center', gap: '8px'
            }}>
              <div className="browser-chrome-left" style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
                <button className="browser-action-btn" title="Refresh the preview" aria-label="Refresh the preview" onClick={handleRefresh}>
                  <RefreshCw size={16} strokeWidth={1.75} />
                </button>
                <button
                  className="browser-action-btn"
                  title="Open the preview in a new tab"
                  aria-label="Open the preview in a new tab"
                  onClick={() => {
                    appEvents.emit('sync-files', { files: filesRef.current, replaceAll: false });
                    // noopener/noreferrer: without them the opened tab gets a
                    // window.opener handle back into this origin.
                    window.open(withTokenQuery(`/preview/${activeProjectId}/index.html`), '_blank', 'noopener,noreferrer');
                  }}
                >
                  <ExternalLink size={16} strokeWidth={1.75} />
                </button>
              </div>

              {/* The URL pill is decorative; it collapses first so it can never
                  push the viewport controls out of the bar. */}
              <div className="browser-chrome-center" style={{ flex: 1, minWidth: 0, display: compactToolbar ? 'none' : 'flex', justifyContent: 'center' }}>
                <div className="browser-url-pill" title={`/preview/${activeProjectId}/index.html`} style={{ cursor: 'default', maxWidth: '100%', overflow: 'hidden' }}>
                  <Lock size={16} strokeWidth={1.75} style={{ opacity: 0.8, color: 'var(--color-success)', flexShrink: 0 }} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {previewEngine === 'edge'
                      ? `brainhalf.com/preview/${activeProjectId.slice(0, 8)}`
                      : 'sandpack bundler (local)'}
                  </span>
                  {viewportMode !== 'desktop' && (
                    <span className="browser-viewport-badge">{viewportMode === 'tablet' ? '768px' : '375px'}</span>
                  )}
                </div>
              </div>

              <div className="browser-chrome-right" style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0, marginLeft: 'auto' }}>
                <div className="viewport-segmented-control" role="group" aria-label="Viewport size and preview runtime">
                  {([
                    { mode: 'desktop' as const, Icon: Monitor, label: 'Desktop', title: 'Desktop view' },
                    { mode: 'tablet' as const, Icon: Tablet, label: 'Tablet', title: 'Tablet view (768px)' },
                    { mode: 'mobile' as const, Icon: Smartphone, label: 'Mobile', title: 'Mobile view (375px)' },
                  ]).map(({ mode, Icon, label, title }) => (
                    <button
                      key={mode}
                      onClick={() => setViewportMode(mode)}
                      className={`viewport-pill-btn ${viewportMode === mode ? 'active' : ''}`}
                      title={title}
                      aria-label={title}
                      aria-pressed={viewportMode === mode}
                    >
                      <Icon size={16} strokeWidth={1.75} />
                      {!compactToolbar && <span>{label}</span>}
                    </button>
                  ))}

                  <div style={{ position: 'relative', display: 'inline-flex' }} ref={engineMenuRef}>
                    <button
                      onClick={() => setShowEngineMenu(prev => !prev)}
                      className={`viewport-pill-btn ${showEngineMenu ? 'active' : ''}`}
                      title={`Runtime: ${previewEngine === 'edge' ? 'Cloudflare Edge' : 'Sandpack'}`}
                      aria-label="Preview runtime engine"
                      aria-expanded={showEngineMenu}
                      aria-haspopup="menu"
                      style={{ width: 'auto', minWidth: 'max-content', cursor: 'pointer' }}
                    >
                      {previewEngine === 'edge'
                        ? <Zap size={16} strokeWidth={1.75} color="#a78bfa" />
                        : <Box size={16} strokeWidth={1.75} color="#38bdf8" />}
                      {!compactToolbar && <span>{previewEngine === 'edge' ? 'Edge' : 'Sandpack'}</span>}
                    </button>

                    {showEngineMenu && (
                      <div role="menu" style={{
                        position: 'absolute', top: 'calc(100% + 4px)', right: 0, width: '200px',
                        background: '#12141c', border: '1px solid var(--border-medium)', borderRadius: '8px',
                        boxShadow: '0 12px 28px rgba(0, 0, 0, 0.65)', padding: '4px', zIndex: 1000,
                        display: 'flex', flexDirection: 'column', gap: '2px'
                      }}>
                        <div style={{ padding: '4px 8px', fontSize: '10.5px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                          Preview runtime
                        </div>
                        <button
                          role="menuitem"
                          className={`deploy-menu-item ${previewEngine === 'edge' ? 'active' : ''}`}
                          style={{ padding: '8px', fontSize: '12px' }}
                          onClick={() => {
                            setPreviewEngine('edge');
                            appEvents.emit('sync-files', { files: filesRef.current, replaceAll: false });
                            setEdgeRefreshCounter(c => c + 1);
                            addBuildLog('Switched to the Cloudflare Edge preview', 'info');
                            setShowEngineMenu(false);
                          }}
                        >
                          <Zap size={16} strokeWidth={1.75} color="#a78bfa" />
                          <span>Cloudflare Edge</span>
                          {previewEngine === 'edge' && <Check size={16} strokeWidth={1.75} color="var(--color-success)" style={{ marginLeft: 'auto' }} />}
                        </button>
                        <button
                          role="menuitem"
                          className={`deploy-menu-item ${previewEngine === 'sandpack' ? 'active' : ''}`}
                          style={{ padding: '8px', fontSize: '12px' }}
                          onClick={() => {
                            setPreviewEngine('sandpack');
                            addBuildLog('Switched to the Sandpack bundler (frontend only — backend routes will not respond)', 'warn');
                            setShowEngineMenu(false);
                          }}
                        >
                          <Box size={16} strokeWidth={1.75} color="#38bdf8" />
                          <span>Sandpack bundler</span>
                          {previewEngine === 'sandpack' && <Check size={16} strokeWidth={1.75} color="var(--color-success)" style={{ marginLeft: 'auto' }} />}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* FIX: the progress bar was hardcoded to 65% during generation, so
                it showed fake determinate progress that never moved. Generation
                length is genuinely unknown, so this is an indeterminate bar. */}
            {status === 'Generating' && (
              <div
                role="progressbar"
                aria-label="Generating"
                style={{ height: '2px', width: '100%', background: 'rgba(255, 255, 255, 0.05)', position: 'relative', overflow: 'hidden', flexShrink: 0 }}
              >
                <div className="bh-indeterminate-bar" style={{
                  height: '100%', width: '35%', background: 'var(--text-primary)',
                  boxShadow: '0 0 8px rgba(255, 255, 255, 0.4)'
                }} />
              </div>
            )}

            <div style={{ flex: 1, minHeight: 0, width: '100%', display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden' }}>
              {!hasProject ? (
                <div style={{
                  height: '100%', width: '100%', display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center', padding: '32px', textAlign: 'center',
                  background: 'radial-gradient(circle at 50% 45%, rgba(59, 130, 246, 0.05) 0%, transparent 60%)'
                }}>
                  <div style={{
                    width: '48px', height: '48px', borderRadius: '8px',
                    background: 'rgba(99, 102, 241, 0.12)', display: 'flex',
                    alignItems: 'center', justifyContent: 'center', marginBottom: '24px'
                  }}>
                    <Sparkles size={24} color="var(--accent-light)" />
                  </div>
                  <h3 style={{ fontSize: '18px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '8px', fontFamily: 'var(--font-brand)' }}>
                    Ready to preview
                  </h3>
                  <p style={{ fontSize: '13px', color: 'var(--text-secondary)', maxWidth: '380px', lineHeight: 1.5, marginBottom: '24px' }}>
                    Describe what you'd like to build in the chat, and the live preview appears here.
                  </p>
                  <button className="button-primary" onClick={handleLaunchPreview}>
                    <Play size={16} strokeWidth={1.75} fill="currentColor" /> Launch preview
                  </button>
                </div>
              ) : previewEngine === 'edge' ? (
                <div className={`viewport-frame-container ${viewportMode}`}>
                  <div className={`viewport-device-chassis ${viewportMode}`} style={{ height: '100%', overflow: 'hidden', background: '#090a0f' }}>
                    <iframe
                      ref={iframeRef}
                      key={`edge-preview-${activeProjectId}-${edgeRefreshCounter}`}
                      src={withTokenQuery(`/preview/${activeProjectId}/index.html`)}
                      onLoad={() => {
                        iframeRef.current?.contentWindow?.postMessage(
                          { type: 'sync-files', files: filesRef.current },
                          window.location.origin
                        );
                      }}
                      style={{ width: '100%', height: '100%', border: 'none', display: 'block', background: '#090a0f' }}
                      title="Cloudflare Edge preview"
                      allow="fullscreen; clipboard-read; clipboard-write"
                    />
                  </div>
                </div>
              ) : (
                <div className={`viewport-frame-container ${viewportMode}`}>
                  <div className={`viewport-device-chassis ${viewportMode}`} style={{ height: '100%', overflow: 'hidden', background: '#000' }}>
                    <SandpackProvider
                      key={`sandpack-${activeProjectId}`}
                      template="react-ts"
                      files={sandpackFiles}
                      theme="dark"
                      customSetup={{
                        entry: '/index.tsx',
                        dependencies: {
                          // FIX: these were pinned to "latest", so an upstream
                          // release could break every preview overnight with no
                          // change on your side. Pinned to the versions the edge
                          // import map already uses, so the two runtimes agree.
                          'lucide-react': '0.344.0',
                          'framer-motion': '10.16.4',
                          'clsx': '2.1.0',
                          'tailwind-merge': '2.2.1',
                          'react-router-dom': '6.22.3'
                        }
                      }}
                      options={{ recompileMode: 'immediate', recompileDelay: 300, activeFile: '/App.tsx' }}
                      style={{ height: '100%', width: '100%' }}
                    >
                      <SandpackPreview showNavigator={false} showOpenInCodeSandbox={false} style={{ height: '100%', width: '100%' }} />
                    </SandpackProvider>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* GitHub export modal */}
      {showGithubModal && (
        <div
          onMouseDown={(e) => { if (e.target === e.currentTarget) setShowGithubModal(false); }}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center',
            justifyContent: 'center', zIndex: 100000, padding: '16px'
          }}
        >
          <div
            ref={modalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="github-export-title"
            style={{
              background: 'var(--bg-panel)', border: '1px solid var(--border-color)',
              borderRadius: '12px', width: '420px', maxWidth: '100%',
              // maxHeight + scroll: at 375px with the keyboard up, the fixed
              // layout put the submit button below the fold and unreachable.
              maxHeight: '90vh', overflowY: 'auto',
              padding: '24px', boxShadow: '0 20px 40px rgba(0,0,0,0.5)',
              display: 'flex', flexDirection: 'column', gap: '16px'
            }}
          >
            <h3 id="github-export-title" style={{ margin: 0, fontSize: '18px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <FolderCode size={20} />
              Export to GitHub
            </h3>

            <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>
              Create a new repository or push to an existing one.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label htmlFor="gh-repo" style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                Repository name
              </label>
              <input
                id="gh-repo"
                type="text"
                value={githubRepo}
                onChange={e => setGithubRepo(e.target.value)}
                placeholder="brainhalf-app"
                autoComplete="off"
                style={{
                  background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border-color)',
                  borderRadius: '6px', padding: '10px 12px', color: 'white',
                  fontSize: '13px', outline: 'none', fontFamily: 'inherit', minHeight: '44px'
                }}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label htmlFor="gh-token" style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                Personal access token
              </label>
              <input
                id="gh-token"
                type="password"
                value={githubToken}
                onChange={e => setGithubToken(e.target.value)}
                placeholder="ghp_..."
                autoComplete="off"
                style={{
                  background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border-color)',
                  borderRadius: '6px', padding: '10px 12px', color: 'white',
                  fontSize: '13px', outline: 'none', fontFamily: 'inherit', minHeight: '44px'
                }}
              />
              <span style={{ fontSize: '11px', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                Needs the <code>repo</code> scope. The token is sent straight to GitHub and is not stored on our servers.
              </span>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'var(--text-secondary)', cursor: 'pointer', minHeight: '32px' }}>
                <input
                  type="checkbox"
                  checked={rememberToken}
                  onChange={e => setRememberToken(e.target.checked)}
                  style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                />
                Keep it for this browser tab only
              </label>
            </div>

            {githubStatus.error && (
              <div role="alert" style={{ padding: '10px', background: 'rgba(239, 68, 68, 0.1)', color: '#f87171', border: '1px solid rgba(239, 68, 68, 0.2)', borderRadius: '6px', fontSize: '12px', lineHeight: 1.5 }}>
                {githubStatus.error}
              </div>
            )}

            {githubStatus.success && (
              <div role="status" style={{ padding: '10px', background: 'rgba(34, 197, 94, 0.1)', color: '#22c55e', border: '1px solid rgba(34, 197, 94, 0.2)', borderRadius: '6px', fontSize: '12px', lineHeight: 1.5 }}>
                {githubStatus.success}
              </div>
            )}

            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '8px', flexWrap: 'wrap' }}>
              <button
                onClick={() => { setShowGithubModal(false); setGithubStatus({ loading: false }); }}
                style={{
                  padding: '10px 16px', minHeight: '44px', background: 'transparent',
                  border: '1px solid var(--border-color)', color: 'var(--text-primary)',
                  borderRadius: '6px', cursor: 'pointer', fontSize: '13px'
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleExportGitHub}
                disabled={githubStatus.loading || !githubRepo.trim() || !githubToken.trim()}
                style={{
                  padding: '10px 16px', minHeight: '44px', background: 'var(--brand-primary)',
                  border: 'none', color: 'white', borderRadius: '6px',
                  cursor: (githubStatus.loading || !githubRepo.trim() || !githubToken.trim()) ? 'not-allowed' : 'pointer',
                  opacity: (githubStatus.loading || !githubRepo.trim() || !githubToken.trim()) ? 0.6 : 1,
                  display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', fontWeight: 500
                }}
              >
                {githubStatus.loading && <Loader2 size={14} className="lucide-spin" />}
                {githubStatus.loading ? 'Exporting...' : 'Export project'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Workspace;