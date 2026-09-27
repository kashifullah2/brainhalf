import { useAutomaticBackend } from '../lib/automatic-backend';
import { useAutomaticBuildFix } from '../lib/automatic-build-fix';
import { useTheme } from '../lib/theme';
import { authFetch } from '../lib/auth-client';
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  Code2, Columns2, Monitor, Loader2,
  Terminal, Copy, Check, FolderCode, Download,
  WrapText, ListFilter,
  Server, Eye, MoreHorizontal, RotateCcw,
  Share2, Cloud, GitBranch, HelpCircle, ArrowUpRight, PanelLeft, AlertCircle, MessageSquare
} from 'lucide-react';
import Editor, { loader } from '@monaco-editor/react';
import { basicReactTemplate } from '../lib/templates';
import { appEvents } from '../lib/events';
import { exportProjectAsZip } from '../lib/zip-export';
import { exportToGitHub } from '../lib/github-export';
import { PREVIEW_LOAD_TIMEOUT, PREVIEW_SYNC_DEBOUNCE } from '../lib/timeouts';
import { normalizePath } from '../lib/utils';
import { selectAppEntry, selectHtmlEntry, isStarterApp } from '../lib/preview-entry';
import { previewFiles, PREVIEW_SANDBOX } from '../lib/preview-isolation';
import { setPreviewStatus, setPlatformStatus } from '../lib/status-store';
import { bindProjectStore } from '../lib/project-store';
import { validateBackendFiles, isFullStackProject } from '../lib/backend-runner';
import { diagnosePreviewError } from '../lib/preview-diagnostics';
import { createTypeScriptStarter } from '../lib/project-starters';
import { useProjectRuntime } from '../lib/project-runtime-client';
import PreviewCanvas from './PreviewCanvas';
import ActionMenu from './ActionMenu';
import FileExplorer from './FileExplorer';
import ConfirmModal from './ConfirmModal';
import BuildProgress, { type FileProgress } from './BuildProgress';
import GenerationProgress from './GenerationProgress';
import ProjectConsole from './ProjectConsole';
import PublishDialog from './PublishDialog';
import CommandPalette from './CommandPalette';

type GenerationStatus = 'Idle' | 'Generating' | 'Connecting' | 'Ready' | 'Error' | 'Stopped';
type WorkspaceTab = 'code' | 'preview' | 'console' | 'logs';
type ViewportMode = 'desktop' | 'tablet' | 'mobile';
type FileMap = Record<string, string>;

function computeFileDelta(previous: FileMap, next: FileMap): { changed: FileMap; removed: string[] } {
  const changed: FileMap = {};
  const removed: string[] = [];

  for (const [path, content] of Object.entries(next)) {
    if (previous[path] !== content) changed[path] = content;
  }
  for (const path of Object.keys(previous)) {
    if (!(path in next)) removed.push(path);
  }

  return { changed, removed };
}

interface BuildLogItem {
  id: string;
  time: string;
  text: string;
  type: 'info' | 'success' | 'warn' | 'error';
}

interface WorkspaceProps {
  activeProjectId: string;
  mobileTab?: 'chat' | WorkspaceTab;
  onSelectMobileTab?: (tab: WorkspaceTab | 'chat') => void;
}

const MAX_LOG_ENTRIES = 250;

let monacoFallbackWorkerUrl: string | null = null;

function configureMonacoWorkerFallback() {
  if (typeof window === 'undefined') return;
  if (!monacoFallbackWorkerUrl) {
    monacoFallbackWorkerUrl = URL.createObjectURL(new Blob([
      'self.onmessage = () => { /* Monaco worker fallback: no-op */ };',
    ], { type: 'text/javascript' }));
  }
  (window as any).MonacoEnvironment = {
    getWorker() {
      return new Worker(monacoFallbackWorkerUrl as string, { type: 'classic' });
    },
  };
}

/* ------------------------------------------------------------------ *
 * Helpers hoisted out of the component
 *
 * The legacy-starter migration was written out three separate times —
 * in the useState initialiser, again in the project-change effect, and
 * partially in a since-removed Sandpack file map. The three copies had
 * already drifted (only one of them applied the 100vh fix). One function now.
 * ------------------------------------------------------------------ */

const LEGACY_STARTER_MARKERS = [
  'BRAINHALF CORE // REACTIVE ENGINE',
  'BrainHalf Studio',
  'From interactive workflows to full-stack reactive prototypes',
];

function baselineFiles(): FileMap {
  return createTypeScriptStarter();
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

function hasGeneratedAppCode(files: FileMap): boolean {
  if (!files) return false;
  const entry = selectAppEntry(files);
  const app = entry ? files[entry] : null;
  if (app && !isStarterApp(app)) return true;

  const htmlEntry = selectHtmlEntry(files);
  if (htmlEntry) {
    const html = files[htmlEntry];
    const body = html?.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? '';
    const stripped = body.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<div\s+id="root"\s*\/?>(<\/div>)?/gi, '').trim();
    if (stripped.length > 100) return true;
  }

  return false;
}

function timestamp(): string {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function isServerPath(path: string): boolean {
  if (/^\/?(?:worker|migrations)\//.test(path)) return true;
  return path.startsWith('/server/') || path.startsWith('server/') || path.includes('.env');
}

function previewMessageTargetOrigin(): string {
  if (typeof window === 'undefined') return '*';
  // Sandbox previews currently use an opaque origin (`null`) because
  // PREVIEW_SANDBOX omits allow-same-origin. Opaque frames cannot be targeted
  // with a concrete origin string, so `*` is required for delivery.
  return PREVIEW_SANDBOX.includes('allow-same-origin') ? window.location.origin : '*';
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
  const previousFocus = document.activeElement as HTMLElement | null;
  const ta = document.createElement('textarea');
  try {
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    ta.remove();
    previousFocus?.focus({ preventScroll: true });
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

const GENERATION_TIPS = [
  'Your agent writes components, styles, and logic together.',
  'Simple apps take 15–30 seconds. Complex full-stack apps may take a few minutes.',
  "You can ask the agent to change anything once it's built.",
  'Try describing a real workflow you do manually right now.',
  'Your app is saved automatically as each file is built.',
  'The agent reads your project files before writing — planning takes a moment.',
];

const Workspace: React.FC<WorkspaceProps> = ({ activeProjectId, mobileTab, onSelectMobileTab }) => {
  const { isCurrent, getProjectFiles, getProjectFilesAsync, saveProjectFiles, saveProjectFilesDebounced, flushProjectFileWrites, forkProject, setActiveProjectId } = useMemo(bindProjectStore, []);
  const [files, setFiles] = useState<FileMap>(() => migrateStarter(getProjectFiles(activeProjectId) || baselineFiles()));
  const runtime = useProjectRuntime(activeProjectId, 'development', true);
  const [publishDialog, setPublishDialog] = useState<{ projectId: string; files?: Record<string, string> } | null>(null);
  useEffect(() => { setPublishDialog(null); }, [activeProjectId]);
  useEffect(() => appEvents.on('open-deploy-modal', () => setPublishDialog({ projectId: activeProjectId })), [activeProjectId]);
  const backend = useAutomaticBackend(activeProjectId, runtime);
  const startBackend = backend.start;
  
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('preview');
  const selectTab = useCallback((tab: WorkspaceTab) => {
    setActiveTab(tab);
    onSelectMobileTab?.(tab);
  }, [onSelectMobileTab]);
  useEffect(() => appEvents.on('open-project-console', () => selectTab('console')), [selectTab]);
  const [viewportMode, setViewportMode] = useState<ViewportMode>('desktop');
  const [edgeRefreshCounter, setEdgeRefreshCounter] = useState(0);
  const [previewSessionReady, setPreviewSessionReady] = useState(false);
  useEffect(() => { setPreviewSessionReady(false); }, [activeProjectId]);
  const previewTargetOrigin = useMemo(() => previewMessageTargetOrigin(), []);
  const [wordWrap, setWordWrap] = useState<'on' | 'off'>('on');
  const hasGeneratedApp = useMemo(() => hasGeneratedAppCode(files), [files]);

  const viewportWidth = useViewportWidth();
  const compactToolbar = viewportWidth < 1100;
  const [fileExplorerOverride, setFileExplorerOverride] = useState<boolean | null>(null);
  const showFileExplorer = fileExplorerOverride ?? viewportWidth > 768;

  // FIX: the initialiser used to run the starter migration and call
  // saveProjectFiles() as a side effect. A useState initialiser can run more
  // than once (StrictMode, a re-mount), so that wrote to storage during render.
  // It now only computes; the effect below owns persistence.
  const [status, setStatus] = useState<GenerationStatus>(() => (getProjectFiles(activeProjectId) ? 'Ready' : 'Idle'));
  useAutomaticBuildFix(activeProjectId, runtime, status === 'Generating');
  const fileProgressKey = `bh_fileprogress_${activeProjectId}`;
  const [fileProgress, setFileProgress] = useState<FileProgress>(() => {
    try {
      const stored = sessionStorage.getItem(`bh_fileprogress_${activeProjectId}`);
      if (stored) return JSON.parse(stored) as FileProgress;
    } catch {}
    return {};
  });
  const persistFileProgress = useCallback((next: FileProgress) => {
    try { sessionStorage.setItem(fileProgressKey, JSON.stringify(next)); } catch {}
  }, [fileProgressKey]);
  const generationActiveRef = useRef(false);
  const attemptedKey = `bh_genstarted_${activeProjectId}`;
  const generationEverAttempted = (() => {
    try { if (sessionStorage.getItem(`bh_genstarted_${activeProjectId}`)) return true; } catch { }
    // Derive from file state so a page reload doesn't lose this signal. Any
    // non-baseline component file or backend file means generation ran even if
    // App.tsx is still the starter placeholder (agent ran out of context).
    const paths = Object.keys(files);
    return paths.some(p => /^\/(worker|migrations|shared)\//.test(p)) ||
      paths.some(p => /^\/src\/components\//.test(p) && !/AppBoundary\.tsx$/.test(p));
  })();
  const touchedKey = `bh_touched_${activeProjectId}`;
  const generationTouchedRef = useRef<Set<string>>(
    (() => {
      try {
        const stored = sessionStorage.getItem(`bh_touched_${activeProjectId}`);
        if (stored) return new Set(JSON.parse(stored) as string[]);
      } catch {}
      return new Set<string>();
    })()
  );
  const isWaitingForFirstApp = !hasGeneratedApp;
  const openChat = () => {
    onSelectMobileTab?.('chat');
    requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('[aria-label="Message to the app builder"]')?.focus());
  };
  const [activeFile, setActiveFile] = useState(() => selectAppEntry(files) || Object.keys(files)[0] || '/src/App.tsx');
  const [monacoReady, setMonacoReady] = useState(false);

  const [consoleLogs, setConsoleLogs] = useState<string[]>(['Preview ready.', 'Waiting for changes...']);
  const buildLogKey = `bh_buildlog_${activeProjectId}`;
  const [buildLogs, setBuildLogs] = useState<BuildLogItem[]>(() => {
    try {
      const stored = sessionStorage.getItem(buildLogKey);
      if (stored) return JSON.parse(stored) as BuildLogItem[];
    } catch {}
    return [{ id: 'init', time: timestamp(), text: 'Workspace ready.', type: 'info' }];
  });
  const [copiedCode, setCopiedCode] = useState(false);

  // GitHub export / auto-sync
  const [showGithubModal, setShowGithubModal] = useState(false);
  const [githubRepo, setGithubRepo] = useState('');
  const [githubToken, setGithubToken] = useState('');
  // Repo name persisted per project; token stays in React state only (never on disk)
  const [savedGithubRepo, setSavedGithubRepo] = useState('');
  const [githubSyncing, setGithubSyncing] = useState(false);
  const [githubLastSynced, setGithubLastSynced] = useState<Date | null>(null);
  // Clear legacy keys that accidentally stored the PAT
  useEffect(() => { try { sessionStorage.removeItem('brainhalf_github_pat'); localStorage.removeItem('brainhalf_github_pat'); } catch {} }, []);
  // On project switch: load persisted repo name, clear session token, clear undo state
  useEffect(() => {
    if (!activeProjectId) return;
    setGithubToken('');
    setGithubLastSynced(null);
    setGithubSyncing(false);
    setUndoCheckpoint(null);
    try {
      const saved = localStorage.getItem(`bh_github_repo:${activeProjectId}`) || '';
      setSavedGithubRepo(saved);
      setGithubRepo(saved);
    } catch { setSavedGithubRepo(''); setGithubRepo(''); }
  }, [activeProjectId]);
  const [githubStatus, setGithubStatus] = useState<{ loading: boolean; error?: string; success?: string }>({ loading: false });
  useEffect(() => { if (showGithubModal) setGithubStatus({ loading: false }); }, [showGithubModal]);

  // Undo last AI change — quick restore to the most recent "Before agent changes" checkpoint
  const [undoCheckpoint, setUndoCheckpoint] = useState<{ id: string; revision: number } | null>(null);
  const [undoLoading, setUndoLoading] = useState(false);

  const [cmdPaletteOpen, setCmdPaletteOpen] = useState(false);
  const [splitView, setSplitView] = useState(false);

  const theme = useTheme();
  const [readOnlyProjectId, setReadOnlyProjectId] = useState<string | null>(null);
  const isReadOnlyProject = readOnlyProjectId === activeProjectId;

  const [tipIndex, setTipIndex] = useState(0);
  useEffect(() => {
    if (status !== 'Generating') return;
    const id = setInterval(() => setTipIndex(i => (i + 1) % GENERATION_TIPS.length), 5000);
    return () => clearInterval(id);
  }, [status]);

  useEffect(() => {
    let active = true;
    if (typeof window === 'undefined') return;
    void import('monaco-editor').then(monaco => {
      configureMonacoWorkerFallback();
      monaco.editor.defineTheme('brainhalf-studio', {
        base: 'vs',
        inherit: true,
        rules: [
          { token: 'comment', foreground: '626D80', fontStyle: 'italic' },
          { token: 'keyword', foreground: '7954A2' },
          { token: 'string', foreground: '28704D' },
          { token: 'number', foreground: '876015' },
          { token: 'type', foreground: '3659D9' },
          { token: 'tag', foreground: '3659D9' },
        ],
        colors: {
          'editor.background': '#FFFFFF', 'editor.foreground': '#202631',
          'editorLineNumber.foreground': '#626D80', 'editorLineNumber.activeForeground': '#3659D9',
          'editor.lineHighlightBackground': '#F4F5F9', 'editor.selectionBackground': '#DDE5FF',
          'editor.inactiveSelectionBackground': '#EDF0F8', 'editorCursor.foreground': '#3659D9',
          'editorIndentGuide.background1': '#E7EAF1', 'editorIndentGuide.activeBackground1': '#B4BDCE',
          'editorWidget.background': '#FAFBFE', 'editorWidget.border': '#E0E4ED',
          'editorSuggestWidget.background': '#FFFFFF', 'editorSuggestWidget.border': '#E0E4ED',
          'editorSuggestWidget.selectedBackground': '#EDF0F8',
          'scrollbarSlider.background': '#C7CDDB66', 'scrollbarSlider.hoverBackground': '#AAB4C688',
        },
      });
      monaco.editor.defineTheme('brainhalf-studio-dark', {
        base: 'vs-dark', inherit: true,
        rules: [
          { token: 'comment', foreground: 'A3AAA0', fontStyle: 'italic' },
          { token: 'keyword', foreground: 'C8B8CA' },
          { token: 'string', foreground: 'B1C9A4' },
          { token: 'number', foreground: 'D7BF90' },
          { token: 'type', foreground: 'BACBAD' },
          { token: 'tag', foreground: 'BACBAD' },
        ],
        colors: {
          'editor.background': '#222522', 'editor.foreground': '#ECEEE8',
          'editorLineNumber.foreground': '#A3AAA0', 'editorLineNumber.activeForeground': '#ECEEE8',
          'editor.lineHighlightBackground': '#2B3029', 'editor.selectionBackground': '#46523E',
          'editor.inactiveSelectionBackground': '#343C30', 'editorCursor.foreground': '#BACBAD',
          'editorIndentGuide.background1': '#373C35', 'editorIndentGuide.activeBackground1': '#626B5D',
          'editorWidget.background': '#222522', 'editorWidget.border': '#4C5546',
          'editorSuggestWidget.background': '#222522', 'editorSuggestWidget.border': '#4C5546',
          'editorSuggestWidget.selectedBackground': '#343C30',
        },
      });
      loader.config({ monaco });
      if (active) setMonacoReady(true);
    }).catch(() => {
      if (active) setMonacoReady(true);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const handleOwnershipDenied = (data: { projectId: string; reason?: string } | undefined) => {
      if (data?.projectId === activeProjectId) setReadOnlyProjectId(activeProjectId);
    };
    const unsub = appEvents.on('project-ownership-denied', handleOwnershipDenied);
    return () => { unsub(); };
  }, [activeProjectId]);

  const handleForkProject = async () => {
    const forked = await forkProject(activeProjectId);
    setActiveProjectId(forked.id);
    window.location.search = `?project=${forked.id}`;
  };

  const modalRef = useRef<HTMLDivElement>(null);
  const githubTriggerRef = useRef<HTMLElement | null>(null);
  const consoleEndRef = useRef<HTMLDivElement>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const syncedPreviewFilesRef = useRef<FileMap>({});
  const [previewIssue, setPreviewIssue] = useState<{ error: string; file: string; layer: 'backend' | 'frontend' } | null>(null);
  const [previewLoadState, setPreviewLoadState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [previewLoadError, setPreviewLoadError] = useState('');
  const previewLoadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => setPreviewIssue(null), [activeProjectId]);
  useEffect(() => {
    setPreviewLoadState('idle');
    setPreviewLoadError('');
    if (previewLoadTimerRef.current) {
      clearTimeout(previewLoadTimerRef.current);
      previewLoadTimerRef.current = null;
    }
  }, [activeProjectId]);
  const [previewFixRequest, setPreviewFixRequest] = useState<{ projectId: string; error: string; file: string; layer: string } | null>(null);
  const [inspectModeActive, setInspectModeActive] = useState(false);
  useEffect(() => setInspectModeActive(false), [activeProjectId]);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const [shareFallback, setShareFallback] = useState<string | null>(null);
  useEffect(() => {
    if (!shareCopied) return;
    const timer = setTimeout(() => setShareCopied(false), 2500);
    return () => clearTimeout(timer);
  }, [shareCopied]);

  const filesRef = useRef<FileMap>(files);
  const hydrationRef = useRef<Promise<void>>(Promise.resolve());
  const syncedRevisionRef = useRef(0);
  const activeFileRef = useRef(activeFile);
  const handleRefreshRef = useRef<() => void>(() => { });

  const resolvedActiveTab: WorkspaceTab = mobileTab && mobileTab !== 'chat' ? mobileTab : activeTab;

  const addBuildLog = useCallback((text: string, type: BuildLogItem['type'] = 'info') => {
    setBuildLogs(prev => {
      const last = prev[prev.length - 1];
      if (last && last.text === text && last.type === type) return prev;
      const next = [
        ...prev.slice(-(MAX_LOG_ENTRIES - 1)),
        { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, time: timestamp(), text, type }
      ];
      try { sessionStorage.setItem(buildLogKey, JSON.stringify(next)); } catch {}
      return next;
    });
  }, [buildLogKey]);

  const addConsoleLog = useCallback((text: string) => {
    setConsoleLogs(prev => [...prev.slice(-(MAX_LOG_ENTRIES - 1)), text]);
  }, []);

  const markPreviewState = useCallback((state: 'loading' | 'ready' | 'error', error = '') => {
    if (state === 'loading') {
      setStatus(() => generationActiveRef.current ? 'Generating' : 'Connecting');
      setPreviewLoadError('');
      setPreviewLoadState('loading');
      appEvents.emit('preview-state', { projectId: activeProjectId, state: 'loading' });
      if (previewLoadTimerRef.current) clearTimeout(previewLoadTimerRef.current);
      previewLoadTimerRef.current = setTimeout(() => {
        const message = 'Preview could not be loaded. Refresh, then run Build app again.';
        setPreviewLoadState('error');
        setPreviewLoadError(message);
        setStatus('Error');
        setPreviewStatus(activeProjectId, 'Error');
        appEvents.emit('preview-state', { projectId: activeProjectId, state: 'error', error: message });
      }, PREVIEW_LOAD_TIMEOUT);
      return;
    }

    if (previewLoadTimerRef.current) {
      clearTimeout(previewLoadTimerRef.current);
      previewLoadTimerRef.current = null;
    }

    if (state === 'ready') {
      setStatus(() => generationActiveRef.current ? 'Generating' : 'Ready');
      setPreviewStatus(activeProjectId, 'Ready');
      setPreviewLoadError('');
      setPreviewLoadState('ready');
      appEvents.emit('preview-state', { projectId: activeProjectId, state: 'ready' });
      return;
    }

    const message = error || 'Preview could not be loaded. Refresh, then run Build app again.';
    setStatus('Error');
    setPreviewStatus(activeProjectId, 'Error');
    setPreviewLoadState('error');
    setPreviewLoadError(message);
    appEvents.emit('preview-state', { projectId: activeProjectId, state: 'error', error: message });
  }, [activeProjectId]);

  // When the first real app file lands, force a clean iframe reload so the
  // preview renders immediately rather than waiting for the next user action.
  const prevHasGeneratedRef = useRef(hasGeneratedApp);
  useEffect(() => {
    if (!prevHasGeneratedRef.current && hasGeneratedApp) {
      setStatus(current => (current === 'Generating' ? 'Connecting' : current));
      markPreviewState('loading');
      setEdgeRefreshCounter(current => current + 1);
    }
    prevHasGeneratedRef.current = hasGeneratedApp;
  }, [hasGeneratedApp, markPreviewState]);

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
  const commitFiles = useCallback((next: FileMap, opts: { replaceAll?: boolean; persist?: boolean; debounce?: boolean; sync?: boolean } = {}) => {
    if (!isCurrent()) return;
    const { replaceAll = false, persist = true, debounce = false, sync = true } = opts;
    filesRef.current = next;
    setFiles(next);
    if (persist) {
      // The editor path fires on every keystroke; debouncing collapses the
      // burst into one storage write. The preview still gets every edit
      // immediately via the sync-files event below.
      if (debounce) saveProjectFilesDebounced(activeProjectId, next);
      else saveProjectFiles(activeProjectId, next);
    }
    if (sync) appEvents.emit('sync-files', { files: next, replaceAll });
  }, [activeProjectId]);

  useEffect(() => { activeFileRef.current = activeFile; }, [activeFile]);

  useEffect(() => {
    syncedPreviewFilesRef.current = {};
  }, [activeProjectId]);

  // Keep filesRef in step with any state update that did not go through
  // commitFiles, and stream only the changed preview files to the iframe.
  // Debounced during generation to avoid spamming the preview with every
  // streaming chunk — only the final complete files reach the iframe.
  const previewSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    filesRef.current = files;
    const syncToPreview = () => {
      const frameWindow = iframeRef.current?.contentWindow;
      if (!frameWindow) return;

      const nextPreviewFiles = previewFiles(files, true);
      const previousPreviewFiles = syncedPreviewFilesRef.current;
      if (Object.keys(previousPreviewFiles).length === 0) {
        frameWindow.postMessage({ type: 'sync-files', projectId: activeProjectId, files: nextPreviewFiles }, previewTargetOrigin);
        syncedPreviewFilesRef.current = nextPreviewFiles;
        return;
      }

      const { changed, removed } = computeFileDelta(previousPreviewFiles, nextPreviewFiles);
      if (Object.keys(changed).length > 0 || removed.length > 0) {
        frameWindow.postMessage({ type: 'sync-files-delta', projectId: activeProjectId, changed, removed }, previewTargetOrigin);
        syncedPreviewFilesRef.current = nextPreviewFiles;
      }
    };

    if (generationActiveRef.current) {
      if (previewSyncTimerRef.current) clearTimeout(previewSyncTimerRef.current);
      previewSyncTimerRef.current = setTimeout(syncToPreview, PREVIEW_SYNC_DEBOUNCE);
    } else {
      syncToPreview();
    }
    return () => {
      if (previewSyncTimerRef.current) {
        clearTimeout(previewSyncTimerRef.current);
        previewSyncTimerRef.current = null;
      }
    };
  }, [activeProjectId, files]);

  // FIX: consoleEndRef and a logs anchor were rendered but nothing ever scrolled
  // to them, so both panes silently stopped following new output once the list
  // exceeded the visible height.
  useEffect(() => {
    if (resolvedActiveTab === 'console') consoleEndRef.current?.scrollIntoView({ block: 'end' });
  }, [consoleLogs, resolvedActiveTab]);

  useEffect(() => {
    if (resolvedActiveTab === 'logs') logsEndRef.current?.scrollIntoView({ block: 'end' });
  }, [buildLogs, resolvedActiveTab]);

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
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (showGithubModal) { setShowGithubModal(false); return; }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [showGithubModal]);

  // Cmd+K / Ctrl+K opens the command palette
  useEffect(() => {
    const handleCmdK = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setCmdPaletteOpen(prev => !prev);
      }
    };
    document.addEventListener('keydown', handleCmdK);
    return () => document.removeEventListener('keydown', handleCmdK);
  }, []);

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
      await exportToGitHub(filesRef.current, githubRepo.trim(), githubToken.trim());
      // Persist repo name (never the token); token stays in state to enable auto-sync
      try { localStorage.setItem(`bh_github_repo:${activeProjectId}`, githubRepo.trim()); } catch {}
      setSavedGithubRepo(githubRepo.trim());
      setGithubLastSynced(new Date());
      setGithubStatus({ loading: false, success: `Synced to ${githubRepo.trim()} — auto-sync enabled for this session.` });
      addBuildLog(`Pushed codebase to GitHub: ${githubRepo.trim()}`, 'success');
    } catch (err: any) {
      setGithubStatus({ loading: false, error: err?.message || 'Failed to export to GitHub' });
      addBuildLog(`GitHub export failed: ${err?.message || err}`, 'error');
    }
  }, [githubRepo, githubToken, addBuildLog, activeProjectId]);

  const autoSyncGitHub = useCallback(async () => {
    if (!githubToken || !savedGithubRepo) return;
    setGithubSyncing(true);
    try {
      await exportToGitHub(filesRef.current, savedGithubRepo, githubToken);
      setGithubLastSynced(new Date());
      addBuildLog(`Auto-synced to GitHub: ${savedGithubRepo}`, 'success');
    } catch (err: any) {
      addBuildLog(`GitHub auto-sync failed: ${err?.message || err}`, 'warn');
    } finally {
      setGithubSyncing(false);
    }
  }, [githubToken, savedGithubRepo, addBuildLog]);

  const refreshUndoCheckpoint = useCallback(async () => {
    if (!activeProjectId) return;
    try {
      const origin = ['localhost', '127.0.0.1'].includes(location.hostname)
        ? import.meta.env.VITE_BACKEND_HOST || '' : '';
      const base = `${origin}/agents/chat-agent/${encodeURIComponent(activeProjectId)}/checkpoints`;
      const resp = await authFetch(base, { signal: AbortSignal.timeout(8_000), headers: { 'Content-Type': 'application/json' } });
      const data = await resp.json() as { checkpoints?: Array<{ id: string; label: string }>; revision?: number };
      if (Array.isArray(data.checkpoints) && typeof data.revision === 'number') {
        const cp = data.checkpoints.find(c => c.label === 'Before agent changes');
        if (cp) setUndoCheckpoint({ id: cp.id, revision: data.revision });
      }
    } catch { /* silent — undo button just won't appear */ }
  }, [activeProjectId]);

  const quickUndo = useCallback(async () => {
    if (!undoCheckpoint || !activeProjectId) return;
    setUndoLoading(true);
    try {
      const origin = ['localhost', '127.0.0.1'].includes(location.hostname)
        ? import.meta.env.VITE_BACKEND_HOST || '' : '';
      const base = `${origin}/agents/chat-agent/${encodeURIComponent(activeProjectId)}/checkpoints`;
      const resp = await authFetch(`${base}/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(undoCheckpoint),
        signal: AbortSignal.timeout(15_000),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error || 'Undo failed');
      }
      setUndoCheckpoint(null);
      addBuildLog('Restored to pre-generation checkpoint', 'info');
    } catch (err: any) {
      addBuildLog(`Undo failed: ${err?.message || err}`, 'error');
    } finally {
      setUndoLoading(false);
    }
  }, [undoCheckpoint, activeProjectId, addBuildLog]);

  const runReadinessAudit = useCallback(() => {
    const files = filesRef.current;
    const issues: Array<{ level: BuildLogItem['type']; text: string }> = [];

    const serverPaths = Object.keys(files).filter(isServerPath);
    const hasServer = serverPaths.length > 0;
    if (hasServer) issues.push({ level: 'warn', text: 'Backend execution, database migrations and authentication must be tested in the configured runtime. Browser preview is not backend validation.' });

    const appSource = files['/src/App.jsx'] || files['/src/App.tsx'] || '';
    if (appSource && !/loading|error|empty/i.test(appSource)) {
      issues.push({ level: 'warn', text: 'App likely missing explicit loading/error/empty UI states.' });
    }

    for (const [path, content] of Object.entries(files)) {
      if (/cdn\.tailwindcss\.com/i.test(content)) {
        issues.push({ level: 'warn', text: `${path} uses Tailwind CDN script; prefer bundled Tailwind for production.` });
      }
      if (/TODO|FIXME|lorem ipsum/i.test(content)) {
        issues.push({ level: 'warn', text: `${path} still contains placeholder markers (TODO/FIXME/Lorem).` });
      }
      if (content.length > 200_000) {
        issues.push({ level: 'warn', text: `${path} is large (${Math.round(content.length / 1024)}KB); consider splitting.` });
      }
    }

    addBuildLog('Source review started. These advisory checks do not run your type checker, tests, build or database.', 'info');
    if (issues.length === 0) {
      addBuildLog('No source warnings found. Run the project typecheck, tests and build before deployment.', 'info');
    } else {
      const errorCount = issues.filter((i) => i.level === 'error').length;
      const warnCount = issues.filter((i) => i.level === 'warn').length;
      addBuildLog(`Readiness audit found ${errorCount} error(s) and ${warnCount} warning(s).`, errorCount > 0 ? 'error' : 'warn');
      for (const issue of issues) addBuildLog(issue.text, issue.level);
    }
    selectTab('logs');
  }, [addBuildLog, selectTab]);

  /* ---------------- Project lifecycle ---------------- */
  useEffect(() => {
    generationActiveRef.current = false;
    let cancelled = false;
    hydrationRef.current = getProjectFilesAsync(activeProjectId).then(stored => {
      if (cancelled || !isCurrent()) return;
      const isNewProject = !stored || Object.keys(stored).length === 0;
      const next = isNewProject ? baselineFiles() : migrateStarter(stored);
      const generated = hasGeneratedAppCode(next);
      filesRef.current = next;
      setFiles(next);
      setStatus(() => generationActiveRef.current ? 'Generating' : generated ? 'Connecting' : 'Idle');
      setPreviewLoadState(generated ? 'loading' : 'idle');
      setPreviewLoadError('');
      if (generated) appEvents.emit('preview-state', { projectId: activeProjectId, state: 'loading' });
      setActiveFile(prev => (next[prev] !== undefined ? prev : selectAppEntry(next) || Object.keys(next)[0] || '/src/App.jsx'));
      saveProjectFiles(activeProjectId, next);
      appEvents.emit('sync-files', { files: next, replaceAll: isNewProject });
    });

    const handleClearWorkspace = () => {
      const fresh = baselineFiles();
      filesRef.current = fresh;
      setFiles(fresh);
      setStatus('Idle');
      setFileProgress({});
      try { sessionStorage.removeItem(fileProgressKey); sessionStorage.removeItem(touchedKey); sessionStorage.removeItem(attemptedKey); } catch {}
      setPreviewLoadState('idle');
      setPreviewLoadError('');
      if (previewLoadTimerRef.current) {
        clearTimeout(previewLoadTimerRef.current);
        previewLoadTimerRef.current = null;
      }
      setActiveFile('/src/App.jsx');
      saveProjectFiles(activeProjectId, fresh);
      appEvents.emit('sync-files', { files: fresh, replaceAll: true });
      addBuildLog('Workspace reset to the TypeScript React starter', 'warn');
    };

    const unsubClear = appEvents.on('clear-workspace', handleClearWorkspace);
    return () => {
      cancelled = true;
      unsubClear();
    };
  }, [activeProjectId, addBuildLog]);

  /* ---------------- Generation events ---------------- */
  useEffect(() => {
    let active = true;
    const handleGenerationStatus = ({ status: newStatus, detail, file, error, projectId }: any) => {
      if (projectId && projectId !== activeProjectId) return;
      if (newStatus === 'Generating') {
        setUndoCheckpoint(null);
        if (!generationActiveRef.current) {
          generationTouchedRef.current = new Set();
          setFileProgress({});
          try { sessionStorage.removeItem(fileProgressKey); sessionStorage.removeItem(touchedKey); sessionStorage.setItem(attemptedKey, '1'); } catch {}
        }
        generationActiveRef.current = true;
        setStatus('Generating');
        if (detail) {
          addBuildLog(detail, 'info');
          addConsoleLog(`[ai] ${detail}`);
        }
        if (file) {
          const normalized = normalizePath(file);
          generationTouchedRef.current.add(normalized);
          try { sessionStorage.setItem(touchedKey, JSON.stringify([...generationTouchedRef.current])); } catch {}
          setFileProgress(current => { const next = { ...current, [normalized]: 'writing' as const }; persistFileProgress(next); return next; });
          addBuildLog(`Generating: ${file}`, 'info');
        }
        return;
      }

      if (newStatus === 'Ready') {
        const completedGeneration = generationActiveRef.current;
        generationActiveRef.current = false;
        if (detail === 'Response received') {
          setStatus('Ready');
          return;
        }
        const backendErr = validateBackendFiles(filesRef.current);
        if (backendErr) {
          setStatus('Error');
          const msg = backendErr.error || '[Backend Error] Syntax or configuration error in server files';
          markPreviewState('error', msg);
          setPreviewStatus(activeProjectId, 'Error');
          addBuildLog(msg, 'error');
          addConsoleLog(`[backend-error] ${msg}`);
          return;
        }
        if (!hasGeneratedAppCode(filesRef.current)) {
          const expectedBuildOutput = typeof detail === 'string' && /app code updated|source saved/i.test(detail);
          if (expectedBuildOutput) {
            const missingPreviewMessage = 'Build finished but preview files were missing. Refresh and run Build app again.';
            setStatus('Error');
            setPreviewStatus(activeProjectId, 'Error');
            markPreviewState('error', missingPreviewMessage);
            addBuildLog(missingPreviewMessage, 'error');
            addConsoleLog(`[preview] ${missingPreviewMessage}`);
            return;
          }
          setStatus('Ready');
          if (previewLoadTimerRef.current) {
            clearTimeout(previewLoadTimerRef.current);
            previewLoadTimerRef.current = null;
          }
          setPreviewLoadState('idle');
          setPreviewLoadError('');
          if (completedGeneration) {
            setPlatformStatus('Stopped', 'Generation did not produce frontend files', activeProjectId);
          } else {
            appEvents.emit('preview-state', { projectId: activeProjectId, state: 'ready' });
          }
          return;
        }
        setStatus('Connecting');
        markPreviewState('loading');
        if (completedGeneration) startBackend(filesRef.current);
        addBuildLog(
          completedGeneration && isFullStackProject(filesRef.current)
            ? 'Source saved. Starting the backend when managed development hosting is available.'
            : 'Source saved. Review the browser preview and run project checks.',
          'success'
        );
        if (completedGeneration) addConsoleLog('[validation] Generation complete; project typecheck, build and tests have not been run by this preview.');
        if (completedGeneration) void autoSyncGitHub();
        if (completedGeneration) void refreshUndoCheckpoint();
        return;
      }

      if (newStatus === 'Stopped') {
        generationActiveRef.current = false;
        setFileProgress(current => { const next = Object.fromEntries(Object.entries(current).map(([path, state]) => [path, state === 'writing' ? 'partial' : state])) as FileProgress; persistFileProgress(next); return next; });
        setStatus('Stopped');
        const detailMsg = detail || 'Generation stopped by user';
        addBuildLog(detailMsg, 'warn');
        addConsoleLog(`[ai] ${detailMsg}`);
        return;
      }

      if (newStatus === 'Error') {
        generationActiveRef.current = false;
        setStatus('Error');
        const errMsg = error || 'Generation failed';
        const attributed = errMsg.startsWith('[') ? errMsg : `[Build Error] ${errMsg}`;
        // An inference failure is not evidence that the existing preview failed.
        // Keep the empty-app recovery screen and any working preview available.
        addBuildLog(attributed, 'error');
        addConsoleLog(`[error] ${attributed}`);
      }
    };

    const handleFileGenerated = ({ path, content, isComplete, projectId }: { path: string; content: string; isComplete?: boolean; projectId?: string }) => {
      if (!isCurrent() || (projectId && projectId !== activeProjectId) || typeof content !== 'string') return;
      const cleanPath = normalizePath(path);
      if (generationActiveRef.current) {
        generationTouchedRef.current.add(cleanPath);
        if (isComplete) try { sessionStorage.setItem(touchedKey, JSON.stringify([...generationTouchedRef.current])); } catch {}
      }
      setFileProgress(current => { const next = { ...current, [cleanPath]: isComplete ? 'saved' : 'writing' } as FileProgress; if (isComplete) persistFileProgress(next); return next; });
      if (filesRef.current[cleanPath] === content) return;

      // Streaming chunks arrive many times per file, so only the completed file
      // is persisted and synced; intermediate states just update the editor.
      const next = { ...filesRef.current, [cleanPath]: content };
      if (isComplete) {
        commitFiles(next, { sync: false });
        addBuildLog(`Compiled: ${cleanPath}`, 'success');
        addConsoleLog(`[transpiler] Compiled ${cleanPath}`);
      } else {
        filesRef.current = next;
        setFiles(next);
      }
    };

    const handleFileDeleted = ({ path, projectId }: { path: string; projectId?: string }) => {
      if (!isCurrent() || (projectId && projectId !== activeProjectId)) return;
      const cleanPath = normalizePath(path);
      setFileProgress(current => { const next = { ...current }; delete next[cleanPath]; persistFileProgress(next); return next; });
      const next = { ...filesRef.current };
      delete next[cleanPath];
      commitFiles(next, { sync: false });
      if (activeFileRef.current === cleanPath) setActiveFile(selectAppEntry(next) || Object.keys(next)[0] || '/src/App.jsx');
      addBuildLog(`Deleted: ${cleanPath}`, 'info');
      addConsoleLog(`[transpiler] Deleted ${cleanPath}`);
    };

    const handleOpenFile = ({ path }: { path: string }) => {
      const cleanPath = normalizePath(path);
      setActiveFile(cleanPath);
      selectTab('code');
    };

    const handleExport = async ({ projectName }: { projectName?: string }) => {
      try {
        await exportProjectAsZip(filesRef.current, projectName || 'brainhalf-project');
        addBuildLog(`Project exported as ZIP: ${projectName || 'brainhalf-project'}`, 'success');
      } catch (err: any) {
        addBuildLog(`ZIP export failed: ${err?.message || err}`, 'error');
      }
    };

    const handleRequestContext = async ({ requestId }: { requestId: string }) => {
      await hydrationRef.current;
      if (!active) return;
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
      if (!newFiles) return;
      const generated = hasGeneratedAppCode(newFiles);
      filesRef.current = newFiles;
      setFiles(newFiles);
      saveProjectFiles(activeProjectId, newFiles);
      setStatus(generated ? 'Connecting' : 'Idle');
      if (generated) markPreviewState('loading');
      else {
        setPreviewLoadState('idle');
        setPreviewLoadError('');
      }
      setEdgeRefreshCounter(current => current + 1);
    };

    const handleWorkspaceFilesChanged = ({ projectId, files: changedFiles }: { projectId: string; files: FileMap }) => {
      if (projectId !== activeProjectId || !changedFiles) return;
      filesRef.current = changedFiles;
      setFiles(changedFiles);
      saveProjectFiles(activeProjectId, changedFiles);
      handleRefreshRef.current?.();
    };

    const unsubs = [
      appEvents.on('workspace-session-ready', ({ projectId }: { projectId: string }) => {
        if (projectId === activeProjectId) setPreviewSessionReady(true);
      }),
      appEvents.on('generation-status', handleGenerationStatus),
      appEvents.on('file-generated', handleFileGenerated),
      appEvents.on('file-deleted', handleFileDeleted),
      appEvents.on('open-file', handleOpenFile),
      appEvents.on('request-export', handleExport),
      appEvents.on('request-workspace-context', handleRequestContext),
      appEvents.on('execute-command', handleExecuteCommand),
      appEvents.on('files-refreshed', handleFilesRefreshed),
      appEvents.on('workspace-files-synced', ({ projectId, revision }: { projectId: string; revision: number }) => {
        if (projectId !== activeProjectId) return;
        syncedRevisionRef.current = Math.max(syncedRevisionRef.current, revision);
        iframeRef.current?.contentWindow?.postMessage({ type: 'preview-revision', revision: syncedRevisionRef.current }, previewTargetOrigin);
      }),
      appEvents.on('workspace-sync-error', ({ projectId, error }: { projectId: string; error: string }) => {
        if (projectId === activeProjectId) {
          addBuildLog(error, 'error');
          addConsoleLog(`[workspace-sync] ${error}`);
        }
      }),
      appEvents.on('workspace-files-changed', handleWorkspaceFilesChanged),
    ];
    return () => {
      active = false;
      unsubs.forEach(unsub => unsub());
    };
  }, [startBackend, activeProjectId, addBuildLog, addConsoleLog, commitFiles, markPreviewState, selectTab]);

  useEffect(() => {
    if (status !== 'Generating') return;
    let elapsed = 0;
    const id = setInterval(() => {
      elapsed += 15;
      if (generationActiveRef.current) {
        addBuildLog(`The app builder is working… ${elapsed}s elapsed`, 'info');
      }
    }, 15_000);
    return () => clearInterval(id);
  }, [status, addBuildLog]);

  /* ---------------- Preview iframe messages ---------------- */
  useEffect(() => {
    const handleWindowMessage = (event: MessageEvent) => {
      if (!isCurrent()) return;
      if (event.origin !== 'null') return;
      if (!iframeRef.current || event.source !== iframeRef.current.contentWindow) return;
      if (!event.data || typeof event.data !== 'object') return;

      const { type } = event.data;

      if (type === 'preview-error') {
        const errorMsg = typeof event.data.error === 'string' ? event.data.error.slice(0, 4000) : 'Preview runtime error';
        const file = event.data.file || activeFileRef.current;
        const layer = event.data.layer || (String(file).includes('server') ? 'backend' : 'frontend');
        const prefix = layer === 'backend' ? '[Backend Error]' : '[Frontend Error]';
        const diagnostic = diagnosePreviewError(errorMsg);
        const cleanMsg = errorMsg.startsWith('[') ? errorMsg : `${prefix} ${errorMsg}`;
        const lineInfo = event.data.lineno ? ` (line ${event.data.lineno})` : '';
        const fullErr = `${cleanMsg}${lineInfo}`;
        setPreviewIssue({ error: fullErr, file, layer });
        setStatus('Error');
        setPreviewStatus(activeProjectId, 'Error');
        markPreviewState('error', fullErr);
        addBuildLog(`${prefix} in ${file}: ${errorMsg}`, 'error');
        addBuildLog(`Diagnosis (${diagnostic.category}): ${diagnostic.likelyCause}`, 'warn');
        addBuildLog(`Suggested fix: ${diagnostic.suggestedFix}`, 'info');
        addConsoleLog(`[${layer}-error] ${fullErr}`);
        addConsoleLog(`[diagnostic:${diagnostic.category}] ${diagnostic.likelyCause}`);
        return;
      }

      if (type === 'preview-auto-fix') {
        if (typeof event.data.error !== 'string') return;
        const request = {
          projectId: activeProjectId,
          error: event.data.error.slice(0, 4000),
          file: typeof event.data.file === 'string' ? event.data.file.slice(0, 256) : activeFileRef.current,
          layer: event.data.layer === 'backend' ? 'backend' : 'frontend',
        };
        setPreviewFixRequest(current => current || request);
        return;
      }

      if (type === 'preview-success') {
        if (generationActiveRef.current) return;
        if (previewLoadState === 'idle' && !hasGeneratedAppCode(filesRef.current)) return;
        setPreviewIssue(null);
        setPreviewStatus(activeProjectId, 'Ready');
        setStatus('Ready');
        markPreviewState('ready');
        appEvents.emit('preview-success', null);
        return;
      }

      if (type === 'element-selected' || type === 'element-context-action') {
        if (type === 'element-selected') setInspectModeActive(false);
        const { tagName, id, className, text } = event.data as { tagName?: string; id?: string; className?: string; text?: string };
        const parts: string[] = [tagName || 'element'];
        if (id) parts.push(`#${id}`);
        else if (className) {
          const cls = String(className).split(/\s+/).filter(Boolean).slice(0, 2).join('.');
          if (cls) parts.push(`.${cls}`);
        }
        const label = parts.join('');
        const snippet = text ? ` "${text.slice(0, 60)}"` : '';
        if (type === 'element-context-action') {
          const action = (event.data as { action?: string }).action;
          const prompts: Record<string, string> = {
            'change-text': `Change the text of the ${label}${snippet} to: `,
            'change-style': `Change the style of the ${label}${snippet}: `,
            'change-color': `Change the color of the ${label}${snippet} to: `,
            'remove': `Remove the ${label}${snippet} from the page`,
          };
          appEvents.emit('insert-prompt-draft', { prompt: prompts[action ?? ''] ?? `Edit the ${label}${snippet}: ` });
        } else {
          appEvents.emit('insert-prompt-draft', { prompt: `Edit the ${label}${snippet}: ` });
        }
        return;
      }

      if (type === 'request-preview-files') {
        iframeRef.current?.contentWindow?.postMessage(
          { type: 'sync-files', projectId: activeProjectId, files: previewFiles(filesRef.current, true) },
          previewTargetOrigin
        );
      }
      if (type === 'request-preview-revision') {
        iframeRef.current?.contentWindow?.postMessage({ type: 'preview-revision', revision: syncedRevisionRef.current }, previewTargetOrigin);
      }

      if (type === 'request-reload') {
        // The sandboxed iframe (opaque origin) asked the parent to reload it.
        // Doing the navigation from here keeps sec-fetch-site:same-origin so
        // the bh_session cookie is sent and the worker accepts the request.
        setEdgeRefreshCounter(c => c + 1);
      }
    };

    window.addEventListener('message', handleWindowMessage);
    return () => window.removeEventListener('message', handleWindowMessage);
  }, [activeProjectId, addBuildLog, addConsoleLog, markPreviewState, previewLoadState, previewTargetOrigin, status]);

  const handleInspectToggle = useCallback(() => {
    const next = !inspectModeActive;
    setInspectModeActive(next);
    iframeRef.current?.contentWindow?.postMessage(
      { type: 'set-inspect-mode', enabled: next, projectId: activeProjectId },
      previewTargetOrigin
    );
  }, [inspectModeActive, activeProjectId, previewTargetOrigin]);

  const handleEditorChange = useCallback((value: string | undefined) => {
    if (value === undefined) return;
    commitFiles({ ...filesRef.current, [activeFileRef.current]: value }, { debounce: true });
  }, [commitFiles]);

  const handleRefresh = useCallback(() => {
    appEvents.emit('sync-files', { files: filesRef.current, replaceAll: false });
    if (hasGeneratedAppCode(filesRef.current)) {
      setStatus('Connecting');
      markPreviewState('loading');
    }
    setEdgeRefreshCounter(c => c + 1);
    addBuildLog('Reloading Cloudflare Edge preview', 'info');
  }, [addBuildLog, markPreviewState, selectTab]);

  const handlePopoutPreview = useCallback(() => {
    if (isFullStackProject(filesRef.current)) {
      if (backend.ready) void backend.open();
      return;
    }
    appEvents.emit('sync-files', { files: filesRef.current, replaceAll: false });
    window.open(`/preview/${activeProjectId}/index.html`, '_blank', 'noopener,noreferrer');
  }, [activeProjectId, backend.ready, backend.open]);

  useEffect(() => { handleRefreshRef.current = handleRefresh; }, [handleRefresh]);

  useEffect(() => () => {
    if (previewLoadTimerRef.current) clearTimeout(previewLoadTimerRef.current);
  }, []);

  // Keystroke-saves are debounced, so an edit made inside the debounce window
  // would be lost on a tab close or navigation. Force the write out before the
  // page goes away. pagehide covers close/navigate/back; visibilitychange
  // covers mobile backgrounding, where the JS may be killed without further
  // notice.
  useEffect(() => {
    const flush = () => flushProjectFileWrites();
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', flush);
      flush();
    };
  }, []);

  const handleCopyCurrentFile = useCallback(async () => {
    const ok = await copyText(files[activeFile] || '');
    if (!ok) {
      addBuildLog('Could not copy to the clipboard. Select the code and copy manually.', 'warn');
      return;
    }
    setCopiedCode(true);
    window.setTimeout(() => setCopiedCode(false), 2000);
  }, [files, activeFile, addBuildLog]);

  const visibleFiles = useMemo(
    () => Object.keys(files).sort(),
    [files]
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

  const isEditorTab = resolvedActiveTab === 'code';

  return (
    <div className="workspace-panel-container">
      {previewFixRequest?.projectId === activeProjectId && <ConfirmModal
        isOpen={true}
        title="Review preview fix request"
        message={`Untrusted preview code requested an AI change. Only approve if you want to send this error to the builder (starts a new generation): ${previewFixRequest.error}`}
        confirmLabel="Approve AI fix"
        isDestructive={false}
        onCancel={() => setPreviewFixRequest(null)}
        onConfirm={() => {
          if (isCurrent() && previewFixRequest.projectId === activeProjectId) appEvents.emit('auto-fix-error', previewFixRequest);
          setPreviewFixRequest(null);
        }}
      />}
      <ConfirmModal
        isOpen={showResetConfirm}
        title="Reset workspace?"
        message="This resets files to the starter template for this project."
        confirmLabel="Reset workspace"
        isDestructive={true}
        onCancel={() => setShowResetConfirm(false)}
        onConfirm={() => {
          appEvents.emit('clear-workspace');
          setShowResetConfirm(false);
        }}
      />
      {shareFallback && <ConfirmModal isOpen title="Copy personal project link" message={`This link opens your project when you're logged in to BrainHalf:\n\n${shareFallback}`} confirmLabel="Done" cancelLabel="Close" isDestructive={false} onConfirm={() => setShareFallback(null)} onCancel={() => setShareFallback(null)} />}
      {/* Header. minHeight rather than height, and the nav scrolls rather than
          overflowing, so the tabs never collide with the status area on narrow
          viewports. */}
      <div className="workspace-toolbar">
        <div className="studio-workspace-tabs" aria-label="Workspace view" data-mobile={mobileTab !== undefined || undefined}>
          {mobileTab === undefined && <button type="button" onClick={() => selectTab('preview')} aria-pressed={resolvedActiveTab === 'preview'} className={resolvedActiveTab === 'preview' ? 'active' : ''}><Monitor size={15} />Preview</button>}
          {mobileTab === undefined && <button type="button" onClick={() => selectTab('code')} aria-pressed={resolvedActiveTab === 'code'} className={resolvedActiveTab === 'code' ? 'active' : ''}><Code2 size={15} />Code</button>}
          {mobileTab === undefined && <button type="button" onClick={() => selectTab('console')} aria-pressed={resolvedActiveTab === 'console'} className={resolvedActiveTab === 'console' ? 'active' : ''}><Terminal size={15} />Build</button>}
          {mobileTab === undefined && viewportWidth >= 900 && <button type="button" onClick={() => { setSplitView(v => !v); if (!splitView) setActiveTab('code'); }} aria-pressed={splitView} className={splitView ? 'active' : ''} title={splitView ? 'Exit split view' : 'Split view: code + preview'}><Columns2 size={15} /></button>}
          {mobileTab !== undefined && <span className="studio-mobile-workspace-label">{isEditorTab ? 'Project files' : resolvedActiveTab === 'console' ? 'Build' : resolvedActiveTab === 'logs' ? 'Activity' : 'Your app'}</span>}
          {(isEditorTab || splitView) && <button type="button" className="studio-files-toggle" onClick={() => setFileExplorerOverride(!showFileExplorer)} aria-pressed={showFileExplorer} title={showFileExplorer ? 'Hide project files' : 'Show project files'} aria-label={showFileExplorer ? 'Hide project files' : 'Show project files'}><PanelLeft size={14} /></button>}
        </div>

        <div className="studio-workspace-actions">
          <ActionMenu label="Project actions" className="studio-project-actions" items={[
            { label: 'Project console', icon: <Server />, onSelect: () => selectTab('console') },
            { label: 'Download source ZIP', icon: <Download />, onSelect: () => { void handleExportZip(); }, disabled: !Object.keys(files).length, separator: true },
            { label: 'Export to GitHub', icon: <GitBranch />, onSelect: () => { githubTriggerRef.current = document.activeElement as HTMLElement; setShowGithubModal(true); }, disabled: !Object.keys(files).length },
            { label: 'Run readiness audit', icon: <ListFilter />, onSelect: runReadinessAudit, separator: true },
            { label: 'Build guide', icon: <HelpCircle />, onSelect: () => { window.open('/guides/build-an-app-with-ai', '_blank', 'noopener,noreferrer'); } },
            { label: 'Reset workspace', icon: <RotateCcw />, onSelect: () => setShowResetConfirm(true), danger: true, separator: true },
          ]}><MoreHorizontal size={18} /></ActionMenu>

          <button
            className="studio-share-button"
            onClick={async () => {
              const shareUrl = `${window.location.origin}${window.location.pathname}?project=${activeProjectId}`;
              const ok = await copyText(shareUrl);
              if (ok) {
                setShareCopied(true);
              } else {
                setShareFallback(shareUrl);
              }
            }}
            style={{
              background: 'rgba(36, 60, 75, 0.05)',
              border: '1px solid rgba(36, 60, 75, 0.08)',
              borderRadius: '8px',
              padding: '5px 12px',
              color: 'var(--text-primary)',
              fontSize: '12px',
              fontWeight: 500,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
            title="Copy personal project link (requires your login to open)"
            aria-label="Share project link"
          >
            <Share2 size={14} strokeWidth={1.8} />
            <span aria-live="polite">{shareCopied ? 'Copied' : 'Share'}</span>
          </button>

          <button
            onClick={() => {
              if (hasGeneratedApp) {
                setPublishDialog({ projectId: activeProjectId, files: { ...files } });
              }
            }}
            className="studio-publish-button"
            disabled={!hasGeneratedApp}
            style={{
              background: hasGeneratedApp ? 'var(--accent-primary)' : 'rgba(36, 60, 75, 0.04)',
              color: hasGeneratedApp ? 'var(--text-on-accent)' : 'var(--text-muted)',
              border: hasGeneratedApp ? 'none' : '1px solid rgba(36, 60, 75, 0.08)',
              borderRadius: '8px',
              padding: '5px 14px',
              fontSize: '12px',
              fontWeight: 600,
              cursor: hasGeneratedApp ? 'pointer' : 'not-allowed',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              boxShadow: hasGeneratedApp ? '0 2px 8px var(--focus-ring)' : 'none',
              transition: 'all 0.15s ease'
            }}
            title={hasGeneratedApp ? "Publish application" : "Generate an app in chat before publishing"}
            aria-label={hasGeneratedApp ? "Publish application" : "Generate an app in chat before publishing"}
          >
            <Cloud size={14} strokeWidth={2} />
            <span>Publish</span>
          </button>

        </div>
      </div>

      {/* Content */}
      {publishDialog?.projectId === activeProjectId && <PublishDialog key={activeProjectId} projectId={activeProjectId} files={files} publishOnOpen={publishDialog.files} onClose={() => setPublishDialog(null)} onManage={() => { setPublishDialog(null); selectTab('console'); }} />}
      <div style={{ flex: 1, position: 'relative', display: 'flex', overflow: 'hidden', minHeight: 0 }}>
        {splitView ? (
          <div style={{ display: 'flex', width: '100%', height: '100%', minWidth: 0 }}>
            {showFileExplorer && <FileExplorer
              files={files}
              activeFile={activeFile}
              onSelectFile={setActiveFile}
              headerTitle="Project files"
            />}
            <div style={{ flex: 1, minWidth: 0, height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg-code-editor)', overflow: 'hidden', borderRight: '1px solid var(--border-subtle)' }}>
              <div className="studio-file-tabs" style={{
                minHeight: '36px', background: 'var(--bg-surface)',
                borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center',
                overflowX: 'auto', padding: '0 4px', gap: '2px', flexShrink: 0
              }}>
                {visibleFiles.map(filePath => {
                  const isActive = filePath === activeFile;
                  const isServer = isServerPath(filePath);
                  return (
                    <button
                      key={filePath}
                      onClick={() => setActiveFile(filePath)}
                      className={`studio-file-tab${isActive ? ' active' : ''}`}
                      title={filePath}
                      style={{
                        display: 'flex', alignItems: 'center', gap: '4px', padding: '6px 10px',
                        background: isActive ? 'var(--bg-code-editor)' : 'transparent',
                        border: isActive ? '1px solid var(--border-subtle)' : '1px solid transparent',
                        borderBottom: isActive ? '1px solid var(--bg-code-editor)' : '1px solid transparent',
                        borderRadius: '6px 6px 0 0', cursor: 'pointer',
                        color: isActive ? 'var(--text-primary)' : 'var(--text-muted)',
                        fontSize: '11.5px', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap',
                        flexShrink: 0, minHeight: '32px'
                      }}
                    >
                      {isServer && <Server size={11} strokeWidth={2} style={{ color: 'var(--color-code-violet)', opacity: isActive ? 1 : 0.6, flexShrink: 0 }} />}
                      <span>{filePath.split('/').pop()}</span>
                    </button>
                  );
                })}
              </div>
              <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', position: 'relative' }}>
                {monacoReady ? (
                  <Editor
                    key={`split-editor-${activeProjectId}`}
                    theme={theme === 'dark' ? 'brainhalf-studio-dark' : 'brainhalf-studio'}
                    language={editorLanguage}
                    path={activeFile}
                    value={files[activeFile] || ''}
                    onChange={handleEditorChange}
                    options={{ minimap: { enabled: false }, fontSize: 13, lineHeight: 22, fontFamily: 'var(--font-mono)', tabSize: 2, wordWrap: wordWrap, scrollBeyondLastLine: false, padding: { top: 12, bottom: 12 }, renderLineHighlight: 'line', smoothScrolling: true, cursorSmoothCaretAnimation: 'on', bracketPairColorization: { enabled: true }, readOnly: isReadOnlyProject }}
                    loading={<div style={{ display: 'grid', placeItems: 'center', width: '100%', height: '100%', color: 'var(--text-muted)' }}>Loading editor…</div>}
                  />
                ) : (
                  <div style={{ display: 'grid', placeItems: 'center', width: '100%', height: '100%', color: 'var(--text-muted)' }}>Loading editor…</div>
                )}
              </div>
            </div>
            <div style={{ flex: 1, minWidth: 0, height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg-preview-canvas)', position: 'relative', overflow: 'hidden' }}>
              {status === 'Generating' && (
                <GenerationProgress files={Object.keys(files)} progress={fileProgress} />
              )}
              <PreviewCanvas mode={viewportMode} onModeChange={setViewportMode} onRefresh={() => setEdgeRefreshCounter(value => value + 1)} onOpen={handlePopoutPreview} ready={hasGeneratedApp && (backend.liveUrl ? true : previewLoadState !== 'error')} openReady={isFullStackProject(files) ? hasGeneratedApp && backend.ready : undefined} onInspect={!backend.liveUrl && hasGeneratedApp ? handleInspectToggle : undefined} inspectActive={inspectModeActive}>
                {backend.liveUrl ? (
                  <iframe
                    key={`split-live-${activeProjectId}-${backend.liveUrl}`}
                    src={backend.liveUrl}
                    sandbox="allow-scripts allow-forms allow-popups allow-same-origin allow-modals allow-downloads"
                    style={{ width: '100%', height: '100%', border: 'none', display: 'block', background: 'var(--bg-card)' }}
                    title="Live App Preview"
                  />
                ) : previewSessionReady ? <iframe
                  ref={iframeRef}
                  key={`split-preview-${activeProjectId}-${edgeRefreshCounter}`}
                  src={`/preview/${activeProjectId}/index.html`}
                  sandbox={PREVIEW_SANDBOX}
                  onLoad={() => {
                    iframeRef.current?.contentWindow?.postMessage(
                      { type: 'sync-files', projectId: activeProjectId, files: previewFiles(filesRef.current, true) },
                      previewTargetOrigin
                    );
                  }}
                  style={{ width: '100%', height: '100%', border: 'none', display: 'block', background: 'white' }}
                  title="Design Preview"
                /> : null}
              </PreviewCanvas>
            </div>
          </div>
        ) : isEditorTab ? (
          <div style={{ display: 'flex', width: '100%', height: '100%', minWidth: 0 }}>
            {showFileExplorer && <FileExplorer
              files={files}
              activeFile={activeFile}
              onSelectFile={setActiveFile}
              headerTitle="Project files"
            />}

            <div style={{ flex: 1, minWidth: 0, height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg-code-editor)', overflow: 'hidden' }}>
              {/* File tabs */}
              <div className="studio-file-tabs" style={{
                minHeight: '36px', background: 'var(--bg-surface)',
                borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center',
                overflowX: 'auto', padding: '0 4px', gap: '2px', flexShrink: 0
              }}>
                {visibleFiles.map(filePath => {
                  const isActive = filePath === activeFile;
                  const isServer = isServerPath(filePath);
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
                        borderBottom: isActive ? (isServer ? '2px solid var(--color-code-violet)' : '2px solid var(--accent-primary)') : '2px solid transparent',
                        borderTop: 'none', borderLeft: 'none', borderRight: 'none',
                        color: isActive ? 'var(--text-primary)' : 'var(--text-muted)',
                        fontSize: '12px', fontFamily: 'var(--font-mono)',
                        display: 'flex', alignItems: 'center', gap: '6px',
                        cursor: 'pointer', borderRadius: '4px 4px 0 0',
                        whiteSpace: 'nowrap', flexShrink: 0, transition: 'all 0.15s ease'
                      }}
                      className="hover-bright"
                    >
                      {isServer
                        ? <Server size={13} color={isActive ? 'var(--color-code-violet)' : undefined} />
                        : <Code2 size={13} color={isActive ? 'var(--accent-light)' : undefined} />}
                      <span>{filePath.split('/').pop()}</span>
                    </button>
                  );
                })}
              </div>

              {/* Breadcrumbs and actions. flexWrap so the action cluster drops
                  to a second line instead of overlapping the path on narrow
                  panes. */}
              <div className="studio-code-toolbar" style={{
                padding: '6px 12px', background: 'var(--bg-surface)',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                flexWrap: 'wrap', gap: '8px',
                fontSize: '11px', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', flexShrink: 0
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                  <span style={{
                    background: isServerPath(activeFile) ? 'rgba(168, 85, 247, 0.15)' : 'rgba(56, 189, 248, 0.15)',
                    color: isServerPath(activeFile) ? 'var(--color-code-violet)' : 'var(--color-info)',
                    border: `1px solid ${isServerPath(activeFile) ? 'rgba(168, 85, 247, 0.3)' : 'rgba(56, 189, 248, 0.3)'}`,
                    padding: '2px 8px', borderRadius: '4px', fontSize: '10.5px', fontWeight: 600,
                    display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0
                  }}>
                    {isServerPath(activeFile)
                      ? <><Server size={12} strokeWidth={2} />{/^\/?(?:worker|migrations)\//.test(activeFile) ? 'Workers / D1' : 'Node.js / Express'}</>
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
                      background: wordWrap === 'on' ? 'rgba(36, 60, 75, 0.08)' : 'transparent',
                      border: 'none', color: wordWrap === 'on' ? 'var(--text-primary)' : 'var(--text-muted)',
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
                      color: copiedCode ? 'var(--color-success)' : 'var(--text-muted)',
                      padding: '6px 8px', minHeight: '32px', cursor: 'pointer',
                      display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', fontFamily: 'inherit'
                    }}
                  >
                    {copiedCode ? <Check size={16} strokeWidth={1.75} color="var(--color-success)" /> : <Copy size={16} strokeWidth={1.75} />}
                    {!compactToolbar && <span>{copiedCode ? 'Copied' : 'Copy'}</span>}
                  </button>

                  <button
                    onClick={(e) => { githubTriggerRef.current = e.currentTarget; setShowGithubModal(true); }}
                    className="hover-bright"
                    title={savedGithubRepo ? `GitHub: ${savedGithubRepo}${githubToken ? ' · auto-sync on' : ''}` : 'Export to GitHub'}
                    aria-label={savedGithubRepo ? `GitHub: ${savedGithubRepo}` : 'Export to GitHub'}
                    style={{
                      background: 'transparent', border: 'none',
                      color: savedGithubRepo ? 'var(--color-success, #22c55e)' : 'var(--text-muted)',
                      padding: '6px 8px', minHeight: '32px', cursor: 'pointer',
                      display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', fontFamily: 'inherit'
                    }}
                  >
                    {githubSyncing
                      ? <Loader2 size={16} strokeWidth={1.75} className="lucide-spin" />
                      : <FolderCode size={16} strokeWidth={1.75} />}
                    {!compactToolbar && (
                      <span>{savedGithubRepo ? savedGithubRepo : 'GitHub'}</span>
                    )}
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

                  {undoCheckpoint && (
                    <button
                      onClick={() => void quickUndo()}
                      disabled={undoLoading || status === 'Generating'}
                      className="hover-bright"
                      title="Undo last AI change — restore to before the last generation"
                      aria-label="Undo last AI change"
                      style={{
                        background: 'transparent', border: '1px solid var(--color-warning, #f59e0b)',
                        color: 'var(--color-warning, #f59e0b)', borderRadius: '4px',
                        padding: '6px 8px', minHeight: '32px', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', fontFamily: 'inherit'
                      }}
                    >
                      {undoLoading
                        ? <Loader2 size={16} strokeWidth={1.75} className="lucide-spin" />
                        : <RotateCcw size={16} strokeWidth={1.75} />}
                      {!compactToolbar && <span>Undo</span>}
                    </button>
                  )}
                </div>
              </div>

              {/* FIX: the editor wrapper used height: calc(100% - 66px) with a
                  hardcoded chrome height. The breadcrumb row wraps on narrow
                  panes, so the real chrome is taller than 66px and the editor
                  overflowed its container. flex:1 with minHeight:0 measures. */}
              <div style={{ flex: 1, minHeight: 0, minWidth: 0, overflow: 'hidden' }}>
                {monacoReady ? (
                  <Editor
                    height="100%"
                    language={editorLanguage}
                    value={files[activeFile] ?? ''}
                    onChange={handleEditorChange}
                    theme={theme === 'dark' ? 'brainhalf-studio-dark' : 'brainhalf-studio'}
                    path={activeFile}
                    options={{
                      minimap: { enabled: false },
                      fontSize: 13,
                      fontFamily: "'DM Studio Mono', Consolas, monospace",
                      lineHeight: 22,
                      padding: { top: 18, bottom: 18 },
                      renderLineHighlight: 'all',
                      overviewRulerBorder: false,
                      lineNumbers: 'on',
                      wordWrap,
                      scrollBeyondLastLine: false,
                      automaticLayout: true,
                      tabSize: 2
                    }}
                  />
                ) : (
                  <div style={{ display: 'grid', placeItems: 'center', width: '100%', height: '100%', color: 'var(--text-muted)' }}>
                    Loading editor…
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : resolvedActiveTab === 'console' ? (
          <ProjectConsole key={activeProjectId} projectId={activeProjectId} files={files} onClose={() => selectTab('preview')} />
        ) : resolvedActiveTab === 'logs' ? (
          <div style={{
            width: '100%', height: '100%', background: 'var(--bg-surface)', color: 'var(--text-primary)',
            display: 'flex', flexDirection: 'column', fontFamily: 'var(--font-mono)', fontSize: '12px', minWidth: 0
          }}>
            <div style={{
              padding: '8px 14px', background: 'rgba(36, 60, 75, 0.02)',
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
                      background: item.type === 'success' ? 'var(--color-success)' : item.type === 'error' ? 'var(--color-error)' : item.type === 'warn' ? 'var(--color-warning)' : 'var(--color-info)'
                    }} />
                    <span style={{
                      color: item.type === 'error' ? 'var(--color-error)' : item.type === 'success' ? 'var(--color-success)' : item.type === 'warn' ? 'var(--color-warning)' : 'var(--text-primary)',
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
          <div
            className="preview-pane-container"
            style={{
              height: '100%',
              width: '100%',
              display: 'flex',
              flexDirection: 'column',
              background: 'var(--bg-preview-canvas)',
              position: 'relative',
              overflow: 'hidden',
              containerType: 'inline-size',
              minWidth: 0
            }}
          >
            {/* Generation progress: determinate rail + animated filename strip */}
            {status === 'Generating' && (
              <GenerationProgress files={Object.keys(files)} progress={fileProgress} />
            )}

            {/* Canvas Area with Responsive Viewport Chassis */}
            <div style={{ flex: 1, minHeight: 0, width: '100%', display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden' }}>
              {/* Keep fresh, building and failed projects distinct without showing a fake app. */}
              {isWaitingForFirstApp && previewLoadState !== 'error' && (
                <div className={`studio-preview-empty${status === 'Error' ? ' has-error' : ''}`} role="status" aria-live="polite">
                  <div className="studio-empty-window" aria-hidden="true"><div><i /><i /><i /></div>{status === 'Error' ? <AlertCircle size={32} strokeWidth={1.5} /> : <Code2 size={32} strokeWidth={1.5} />}</div>
                  <span className="studio-eyebrow-label">{status === 'Error' ? "LET'S GET YOU BACK ON TRACK" : status === 'Stopped' ? 'BUILD PAUSED' : (status === 'Ready' && generationEverAttempted) ? 'GENERATION INCOMPLETE' : 'FROM YOUR IDEA TO YOUR FIRST VERSION'}</span>
                  <h2>{status === 'Error' ? "Your app hasn't been built yet." : status === 'Stopped' ? "Continue when you're ready." : status === 'Generating' ? 'Your idea is taking shape.' : status === 'Connecting' ? 'Preparing your preview.' : (status === 'Ready' && generationEverAttempted) ? "The frontend wasn't finished." : 'A place for your next idea.'}</h2>
                  <p>{status === 'Error' ? "The last request couldn't finish. Open the conversation to retry or choose another model." : status === 'Stopped' ? 'Your conversation is saved. Send a message to pick up where you left off.' : status === 'Generating' ? "Your agent is working on the first version. The preview will appear here as it's built." : status === 'Connecting' ? "Your files are ready. We are loading the preview runtime now." : (status === 'Ready' && generationEverAttempted) ? 'The agent set up backend files but ran out of context before writing the app interface. Ask it to build the frontend.' : 'Describe what you want to make in the chat. Build it together, then try it right here.'}</p>
                  {(status === 'Generating' || status === 'Connecting')
                    ? <div className="studio-preview-empty-note"><Loader2 className="lucide-spin" size={16} />{status === 'Generating' ? GENERATION_TIPS[tipIndex] : 'Building your preview'}</div>
                    : status === 'Error' || status === 'Stopped'
                    ? <button type="button" className="studio-empty-action" onClick={openChat}><MessageSquare size={16} />Open chat<ArrowUpRight size={16} /></button>
                    : (status === 'Ready' && generationEverAttempted)
                    ? <button type="button" className="studio-empty-action" onClick={openChat}><MessageSquare size={16} />Ask agent to build the UI<ArrowUpRight size={16} /></button>
                    : <button type="button" className="studio-empty-action" onClick={openChat}><MessageSquare size={16} />Describe your app<ArrowUpRight size={16} /></button>
                  }
                  {Object.keys(files).length > 0 && <BuildProgress files={Object.keys(files)} progress={fileProgress} building={status === 'Generating'} agentTouched={generationTouchedRef.current} />}
                </div>
              )}
              {previewLoadState === 'error' && (
                <div className="studio-preview-empty has-error" role="alert" aria-live="polite">
                  <div className="studio-empty-window" aria-hidden="true"><div><i /><i /><i /></div><AlertCircle size={32} strokeWidth={1.5} /></div>
                  <span className="studio-eyebrow-label">PREVIEW LOAD FAILED</span>
                  <h2>We couldn't open your latest preview.</h2>
                  <p>{previewLoadError || previewIssue?.error || 'The build completed but the preview output could not be loaded.'}</p>
                  <button type="button" className="studio-empty-action" onClick={openChat}><MessageSquare size={16} />Open chat<ArrowUpRight size={16} /></button>
                </div>
              )}
              {isReadOnlyProject && (
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '8px 16px',
                  background: 'linear-gradient(90deg, rgba(14, 165, 233, 0.15) 0%, rgba(99, 102, 241, 0.15) 100%)',
                  borderBottom: '1px solid rgba(56, 189, 248, 0.25)',
                  fontSize: '12px',
                  color: 'var(--text-primary)',
                  zIndex: 10
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Eye size={14} style={{ color: 'var(--color-info)' }} />
                    <span><strong>Read-Only Preview</strong> — This project is owned by another account. Clone a copy to edit files and chat.</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <button
                      onClick={handleForkProject}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '4px 12px',
                        borderRadius: '6px',
                        fontSize: '12px',
                        fontWeight: 500,
                        background: '#0ea5e9',
                        color: 'var(--text-on-accent)',
                        border: 'none',
                        cursor: 'pointer'
                      }}
                    >
                      <GitBranch size={13} />
                      <span>Clone to My Projects</span>
                    </button>
                  </div>
                </div>
              )}
              {isFullStackProject(files) && !isWaitingForFirstApp && !backend.liveUrl && <div className={`preview-health-strip${backend.fault ? ' has-fault' : ''}`} role="status"><Server size={15} /><span><strong>Design preview</strong> · Start the app preview to test sign-in and saved data.<br />{backend.message || runtime.error || (runtime.status?.availability?.state !== 'ready' ? runtime.status?.availability?.message : '') || 'Start your app preview to connect its backend.'}</span>{backend.canStart && <button disabled={status === 'Generating'} onClick={() => backend.start(filesRef.current, true)}>Start app preview</button>}{backend.canUpdate && <button disabled={status === 'Generating'} onClick={() => backend.start(filesRef.current, true)}>Update app preview</button>}</div>}
              {isFullStackProject(files) && !isWaitingForFirstApp && backend.liveUrl && <div className="preview-health-strip" role="status"><Server size={15} /><span><strong>Live app preview</strong> · Your running app is shown below.<br />{backend.message || 'App preview is running.'}</span>{backend.canUpdate && <button disabled={status === 'Generating'} onClick={() => backend.start(filesRef.current, true)}>Update app</button>}<button onClick={() => void backend.open()}>Open in new tab <ArrowUpRight size={13} /></button></div>}
              <PreviewCanvas mode={viewportMode} onModeChange={setViewportMode} onRefresh={() => setEdgeRefreshCounter(value => value + 1)} onOpen={handlePopoutPreview} ready={hasGeneratedApp && (backend.liveUrl ? true : previewLoadState !== 'error')} openReady={isFullStackProject(files) ? hasGeneratedApp && backend.ready : undefined} onInspect={!backend.liveUrl && hasGeneratedApp ? handleInspectToggle : undefined} inspectActive={inspectModeActive}>
                  {backend.liveUrl ? (
                    <iframe
                      key={`live-preview-${activeProjectId}-${backend.liveUrl}`}
                      src={backend.liveUrl}
                      sandbox="allow-scripts allow-forms allow-popups allow-same-origin allow-modals allow-downloads"
                      style={{ width: '100%', height: '100%', border: 'none', display: 'block', background: 'var(--bg-card)' }}
                      title="Live App Preview"
                    />
                  ) : previewSessionReady ? <iframe
                    ref={iframeRef}
                    key={`edge-preview-${activeProjectId}-${edgeRefreshCounter}`}
                    src={`/preview/${activeProjectId}/index.html`}
                    sandbox={PREVIEW_SANDBOX}
                    onLoad={() => {
                      iframeRef.current?.contentWindow?.postMessage(
                        { type: 'sync-files', projectId: activeProjectId, files: previewFiles(filesRef.current, true) },
                        previewTargetOrigin
                      );
                    }}
                    onError={() => {
                      const message = 'Preview iframe failed to load. Refresh, then run Build app again.';
                      setStatus('Error');
                      setPreviewStatus(activeProjectId, 'Error');
                      markPreviewState('error', message);
                    }}
                    style={{ width: '100%', height: '100%', border: 'none', display: 'block', background: 'var(--bg-card)' }}
                    title="Application Preview"
                  /> : <div className="studio-session-loading" role="status">Connecting your preview…</div>}
              </PreviewCanvas>
              {hasGeneratedApp && previewIssue && <div className="preview-health-strip has-error" role="status"><AlertCircle size={15} /><span>{previewIssue.error.slice(0, 180)}</span><button disabled={status === 'Generating'} onClick={() => appEvents.emit('auto-fix-error', { ...previewIssue, projectId: activeProjectId })}>Ask agent to fix</button></div>}

            </div>
          </div>
        )}
      </div>

      <footer className="studio-workspace-footer">
        <div className="studio-build-meta" aria-label="Build information">
          <span>{Object.keys(files).length} files</span>
          <button type="button" onClick={() => selectTab('console')} aria-pressed={resolvedActiveTab === 'console'}><Terminal size={13} />Build</button>
          <button type="button" onClick={() => selectTab('logs')} aria-pressed={resolvedActiveTab === 'logs'}><ListFilter size={14} />Activity</button>
        </div>
      </footer>

      {/* GitHub export modal */}
      {showGithubModal && (
        <div
          onMouseDown={(e) => { if (e.target === e.currentTarget) setShowGithubModal(false); }}
          style={{
            position: 'fixed', inset: 0, background: 'var(--overlay)',
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
              {savedGithubRepo && githubToken ? 'GitHub auto-sync' : 'Export to GitHub'}
            </h3>

            <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>
              {savedGithubRepo && githubToken
                ? `Auto-syncing to ${savedGithubRepo} after each generation.${githubLastSynced ? ` Last synced ${githubLastSynced.toLocaleTimeString()}.` : ''}`
                : 'New repositories are private. Existing repositories keep their default branch and newer commits are protected.'}
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
                  background: 'var(--bg-surface)', border: '1px solid var(--border-color)',
                  borderRadius: '6px', padding: '10px 12px', color: 'var(--text-primary)',
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
                  background: 'var(--bg-surface)', border: '1px solid var(--border-color)',
                  borderRadius: '6px', padding: '10px 12px', color: 'var(--text-primary)',
                  fontSize: '13px', outline: 'none', fontFamily: 'inherit', minHeight: '44px'
                }}
              />
              <span style={{ fontSize: '11px', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                Use a fine-grained token with Contents read/write, or a classic token with repo scope. Kept in memory this session only — never written to disk — to enable auto-sync after generation.
              </span>

            </div>

            {githubStatus.error && (
              <div role="alert" style={{ padding: '10px', background: 'rgba(239, 68, 68, 0.1)', color: 'var(--color-error)', border: '1px solid rgba(239, 68, 68, 0.2)', borderRadius: '6px', fontSize: '12px', lineHeight: 1.5 }}>
                {githubStatus.error}
              </div>
            )}

            {githubStatus.success && (
              <div role="status" style={{ padding: '10px', background: 'rgba(34, 197, 94, 0.1)', color: 'var(--color-success)', border: '1px solid rgba(34, 197, 94, 0.2)', borderRadius: '6px', fontSize: '12px', lineHeight: 1.5 }}>
                {githubStatus.success}
              </div>
            )}

            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '8px', flexWrap: 'wrap' }}>
              {savedGithubRepo && (
                <button
                  onClick={() => {
                    try { localStorage.removeItem(`bh_github_repo:${activeProjectId}`); } catch {}
                    setSavedGithubRepo('');
                    setGithubRepo('');
                    setGithubToken('');
                    setGithubLastSynced(null);
                    setShowGithubModal(false);
                  }}
                  style={{
                    padding: '10px 16px', minHeight: '44px', background: 'transparent',
                    border: '1px solid var(--border-color)', color: 'var(--color-error, #ef4444)',
                    borderRadius: '6px', cursor: 'pointer', fontSize: '13px', marginRight: 'auto'
                  }}
                >
                  Disconnect
                </button>
              )}
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
                  border: 'none', color: 'var(--text-on-accent)', borderRadius: '6px',
                  cursor: (githubStatus.loading || !githubRepo.trim() || !githubToken.trim()) ? 'not-allowed' : 'pointer',
                  opacity: (githubStatus.loading || !githubRepo.trim() || !githubToken.trim()) ? 0.6 : 1,
                  display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', fontWeight: 500
                }}
              >
                {githubStatus.loading && <Loader2 size={14} className="lucide-spin" />}
                {githubStatus.loading ? 'Syncing...' : savedGithubRepo ? 'Sync now' : 'Export & enable auto-sync'}
              </button>
            </div>
          </div>
        </div>
      )}

      <CommandPalette
        open={cmdPaletteOpen}
        onClose={() => setCmdPaletteOpen(false)}
        files={files}
        onSelectFile={(path) => { setActiveFile(path); selectTab('code'); }}
        onSwitchTab={selectTab}
        onExportZip={() => void handleExportZip()}
        onOpenGithub={() => { githubTriggerRef.current = document.activeElement as HTMLElement; setShowGithubModal(true); }}
        onPublish={() => setPublishDialog({ projectId: activeProjectId })}
        onUndo={undoCheckpoint ? () => void quickUndo() : undefined}
      />
    </div>
  );
};

export default Workspace;
