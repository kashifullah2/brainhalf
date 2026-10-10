import { useAutomaticBackend } from '../lib/automatic-backend';
import { useAutomaticBuildFix } from '../lib/automatic-build-fix';
import { useAutomaticPreviewFix } from '../lib/automatic-preview-fix';
import { useTheme } from '../lib/theme';
import { authFetch } from '../lib/auth-client';
import { apiOrigin } from '../lib/api-origin';
import React, { useState, useEffect, useRef, useMemo, useCallback, lazy, Suspense } from 'react';
import {
  Code2, Columns2, Monitor, Loader2,
  Terminal, Copy, Check, FolderCode, Download,
  WrapText, ListFilter, Camera,
  Server, Eye, Settings, RotateCcw,
  Share2, Cloud, GitBranch, HelpCircle, ArrowUpRight, PanelLeft, AlertCircle, MessageSquare
} from 'lucide-react';
import Editor, { loader } from '@monaco-editor/react';
import { basicReactTemplate } from '../lib/templates';
import { appEvents, type GenerationStatusPayload } from '../lib/events';
import { exportProjectAsZip } from '../lib/zip-export';
import { useGithubSync } from './GithubSyncModal';
import { PreviewStoreCappedBanner } from './PreviewStoreCappedBanner';
import { PREVIEW_LOAD_TIMEOUT, PREVIEW_SYNC_DEBOUNCE } from '../lib/timeouts';
import { normalizePath } from '../lib/utils';
import { selectAppEntry, selectHtmlEntry, isStarterApp } from '../lib/preview-entry';
import { previewFiles, PREVIEW_SANDBOX, PREVIEW_ALLOW } from '../lib/preview-isolation';
import { setPreviewStatus, setPlatformStatus } from '../lib/status-store';
import { bindProjectStore, recoverProjectFiles, formatRelativeTime } from '../lib/project-store';
import { validateBackendFiles, isFullStackProject } from '../lib/backend-runner';
import { diagnosePreviewError, plainPreviewError, extractFileFromError, detectLayerFromError, sanitizeErrorForDisplay } from '../lib/preview-diagnostics';
import { createTypeScriptStarter } from '../lib/project-starters';
import { useProjectRuntime } from '../lib/project-runtime-client';
import PreviewCanvas from './PreviewCanvas';
import LivePreviewFrame from './LivePreviewFrame';
import { DesignPreviewStrip } from './DesignPreviewStrip';
import ConfirmModal from './ConfirmModal';
import BuildProgress, { type FileProgress } from './BuildProgress';
import GenerationProgress from './GenerationProgress';
const FileExplorer = lazy(() => import('./FileExplorer'));
const ProjectConsole = lazy(() => import('./ProjectConsole'));
const PublishPopover = lazy(() => import('./PublishPopover'));
import TopNav from './TopNav';
import { useWebContainer } from '../lib/use-webcontainer';
import { webContainerSupported } from '../lib/webcontainer';
import WebContainerPreview from './WebContainerPreview';
import BuilderOverlay from './BuilderOverlay';
import BackendBuildProgress from './BackendBuildProgress';
const TerminalPanel = lazy(() => import('./Terminal'));

type GenerationStatus = 'Idle' | 'Generating' | 'Connecting' | 'Ready' | 'Error' | 'Stopped';
type WorkspaceTab = 'code' | 'preview' | 'console' | 'logs' | 'terminal';
type ViewportMode = 'desktop' | 'tablet' | 'mobile';
type FileMap = Record<string, string>;
type PreviewIssue = { error: string; plainExplanation: string; file: string; layer: 'backend' | 'frontend' };

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
  // TopNav passthrough props
  currentUser?: { email?: string; name?: string; devMode?: boolean } | null;
  onGoHome?: () => void;
  onNewProject?: () => void;
  onOpenDashboard?: () => void;
  onLogout?: () => void | Promise<void>;
  creatingProject?: boolean;
  isMobile?: boolean;
}

const MAX_LOG_ENTRIES = 250;

let monacoFallbackWorkerUrl: string | null = null;

function configureMonacoWorkerFallback() {
  if (typeof window === 'undefined') return;
  if (!monacoFallbackWorkerUrl) {
    monacoFallbackWorkerUrl = URL.createObjectURL(new Blob([
      'self.onmessage = () => { /* Monaco worker fallback: no-op */ };',
    ], { type: 'text/javascript' }));
    // Revoke on page unload so the blob URL does not leak memory for the
    // lifetime of the tab (it is only needed for the first Monaco init).
    window.addEventListener('pagehide', () => {
      if (monacoFallbackWorkerUrl) { URL.revokeObjectURL(monacoFallbackWorkerUrl); monacoFallbackWorkerUrl = null; }
    }, { once: true });
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
  'The builder writes your app’s pages, design, and features together.',
  'Simple apps take 15–30 seconds. More complex apps may take a few minutes.',
  "You can ask the builder to change anything once it's finished.",
  'Try describing a real task you do manually right now.',
  'Your work is saved automatically as each part is finished.',
  'The builder reviews your project before writing — planning takes a moment.',
];

const Workspace: React.FC<WorkspaceProps> = ({
  activeProjectId, mobileTab, onSelectMobileTab,
  currentUser, onGoHome, onNewProject, onOpenDashboard, onLogout, creatingProject, isMobile,
}) => {
  const { isCurrent, getProjectFiles, getProjectFilesAsync, saveProjectFiles, saveProjectFilesDebounced, flushProjectFileWrites, forkProject, setActiveProjectId } = useMemo(bindProjectStore, []);
  const [files, setFiles] = useState<FileMap>(() => migrateStarter(getProjectFiles(activeProjectId) || baselineFiles()));
  const runtime = useProjectRuntime(activeProjectId, 'development', true);
  const prodRuntime = useProjectRuntime(activeProjectId, 'production', true);
  // Only show the live URL badge when there's an active production release —
  // productionUrl is always a non-empty string in the type, so checking it
  // alone would show the badge for unpublished projects.
  const prodLiveUrl: string = (prodRuntime.status?.activeRelease && prodRuntime.status?.productionUrl) ? prodRuntime.status.productionUrl : '';
  // Header "Publish" opens the console's Publish section (the single publish
  // UI) instead of a duplicate dialog. The nonce re-triggers the navigation
  // even when the section value repeats.
  const [consoleSectionRequest, setConsoleSectionRequest] = useState<{ section: string; nonce: number } | null>(null);
  // Header "Go live" opens a small publish panel under the button — naming the
  // app, choosing who can see it, and publishing to production all happen
  // there without leaving the workspace.
  const [publishOpen, setPublishOpen] = useState(false);
  const backend = useAutomaticBackend(activeProjectId, runtime);
  const startBackend = backend.start;

  // Show a "ready to publish" nudge for 8 seconds the first time the backend
  // goes live after a build. Resets on project change.
  const [showPublishNudge, setShowPublishNudge] = useState(false);
  const prevBackendReadyRef = useRef(false);
  useEffect(() => { prevBackendReadyRef.current = false; setShowPublishNudge(false); }, [activeProjectId]);
  useEffect(() => {
    if (backend.ready && !prevBackendReadyRef.current) {
      // Transition false → true: backend just became live for the first time.
      setShowPublishNudge(true);
      const timer = setTimeout(() => setShowPublishNudge(false), 8000);
      prevBackendReadyRef.current = true;
      return () => clearTimeout(timer);
    }
    if (!backend.ready) prevBackendReadyRef.current = false;
  }, [backend.ready]);
  
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('preview');
  const selectTab = useCallback((tab: WorkspaceTab) => {
    setActiveTab(tab);
    onSelectMobileTab?.(tab);
  }, [onSelectMobileTab]);
  // Resizing across the mobile breakpoint must not hide a pane the user
  // explicitly opened (console, logs, code): the app shell hides the workspace
  // when the mobile tab is 'chat'. The default 'preview' tab is not pushed —
  // mobile intentionally lands on the chat.
  const mobileModeRef = useRef<{ mobile: boolean; tab: typeof mobileTab }>({ mobile: mobileTab !== undefined, tab: mobileTab });
  useEffect(() => {
    const previous = mobileModeRef.current;
    const mobile = mobileTab !== undefined;
    if (mobile && !previous.mobile && activeTab !== 'preview') {
      onSelectMobileTab?.(activeTab);
    } else if (!mobile && previous.mobile && previous.tab && previous.tab !== 'chat' && previous.tab !== activeTab) {
      setActiveTab(previous.tab);
    }
    mobileModeRef.current = { mobile, tab: mobileTab };
  }, [mobileTab, activeTab, onSelectMobileTab]);
  useEffect(() => appEvents.on('open-project-console', () => selectTab('console')), [selectTab]);
  // "Choose an app to remove" (hosted-limit states) lands on the console's
  // app-spaces manager: request the section, then switch to the console tab.
  const openHostedSlots = useCallback(() => {
    setConsoleSectionRequest({ section: 'Hosted apps', nonce: Date.now() });
    selectTab('console');
  }, [selectTab]);
  const [viewportMode, setViewportMode] = useState<ViewportMode>('desktop');
  // Load saved viewport mode when switching projects
  useEffect(() => {
    try {
      const saved = localStorage.getItem(`bh_viewport_${activeProjectId}`);
      setViewportMode((['desktop', 'tablet', 'mobile'] as const).includes(saved as ViewportMode) ? saved as ViewportMode : 'desktop');
    } catch { setViewportMode('desktop'); }
  }, [activeProjectId]);
  const handleViewportMode = useCallback((mode: ViewportMode) => {
    setViewportMode(mode);
    try { localStorage.setItem(`bh_viewport_${activeProjectId}`, mode); } catch {}
  }, [activeProjectId]);
  const [previewSessionReady, setPreviewSessionReady] = useState(false);
  useEffect(() => { setPreviewSessionReady(false); }, [activeProjectId]);
  const edgeRefreshCounterRef = useRef(0);
  const [edgeRefreshCounter, setEdgeRefreshCounter] = useState(0);
  const reloadPreview = useCallback(() => {
    edgeRefreshCounterRef.current++;
    if (iframeRef.current) {
      try {
        const src = `/preview/${activeProjectId}/index.html`;
        iframeRef.current.contentWindow?.location.replace(src);
      } catch {
        setEdgeRefreshCounter(c => c + 1);
      }
    } else {
      setEdgeRefreshCounter(c => c + 1);
    }
  }, [activeProjectId]);
  const previewTargetOrigin = useMemo(() => previewMessageTargetOrigin(), []);
  const [wordWrap, setWordWrap] = useState<'on' | 'off'>('on');
  const hasGeneratedApp = useMemo(() => hasGeneratedAppCode(files), [files]);
  const viewportWidth = useViewportWidth();
  const compactToolbar = viewportWidth < 1100;
  const showFileExplorer = viewportWidth > 768;

  // FIX: the initialiser used to run the starter migration and call
  // saveProjectFiles() as a side effect. A useState initialiser can run more
  // than once (StrictMode, a re-mount), so that wrote to storage during render.
  // It now only computes; the effect below owns persistence.
  const [status, setStatus] = useState<GenerationStatus>(() => (getProjectFiles(activeProjectId) ? 'Ready' : 'Idle'));
  // The last build/connection error in the user's own words (e.g. the quota
  // message) — shown in the preview empty-state instead of a generic line.
  const [statusError, setStatusError] = useState('');
  // Tracks whether useAutomaticBuildFix has triggered a repair so the
  // DesignPreviewStrip can show "Auto-fixing your app…" instead of the static
  // "Ask the builder to fix" button — cleared when the project or status changes.
  const [autoFixing, setAutoFixing] = useState(false);
  useEffect(() => { setAutoFixing(false); }, [activeProjectId]);
  useEffect(() => {
    if (status === 'Generating') setAutoFixing(false);
  }, [status]);
  useAutomaticBuildFix(activeProjectId, runtime, status === 'Generating', () => setAutoFixing(true));

  const [projectDeletedFlag, setProjectDeletedFlag] = useState(false);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  useEffect(() => { setProjectDeletedFlag(false); }, [activeProjectId]);
  useEffect(() =>
    appEvents.on('runtime-status', event => {
      if (event.projectId === activeProjectId && (event as any).deleted) setProjectDeletedFlag(true);
    }),
  [activeProjectId]);
  const handleRecoveryExport = useCallback(async () => {
    setRecoveryBusy(true);
    try {
      const recovered = await recoverProjectFiles(activeProjectId);
      const source = recovered && Object.keys(recovered).length > 0 ? recovered : filesRef.current;
      if (!source || !Object.keys(source).length) { alert('No files could be recovered for this project.'); return; }
      await exportProjectAsZip(source, activeProjectId || 'brainhalf-recovery');
    } catch { alert('Export failed. Your files may still be recoverable — try again.'); }
    finally { setRecoveryBusy(false); }
  }, [activeProjectId]);

  // Switched to Lovable-style Instant Preview by bypassing WebContainers
  const wcEnabled = false; // webContainerSupported();
  const wc = useWebContainer(activeProjectId, files);

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
  const [activeFile, setActiveFileRaw] = useState(() => selectAppEntry(files) || Object.keys(files)[0] || '/src/App.tsx');
  // Wrap setActiveFile: record user intent during generation so the live-follow
  // auto-switch stops once the user has manually chosen what they want to see.
  const setActiveFile = useCallback((path: string | ((prev: string) => string)) => {
    if (generationActiveRef.current) userPickedFileInGenRef.current = true;
    setActiveFileRaw(path);
  }, []);
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

  // Undo last AI change — quick restore to the most recent "Before agent changes" checkpoint
  const [undoCheckpoint, setUndoCheckpoint] = useState<{ id: string; revision: number } | null>(null);
  const [undoLoading, setUndoLoading] = useState(false);
  // Full version history list — all source_checkpoints (up to 12)
  const [checkpointList, setCheckpointList] = useState<Array<{ id: string; label: string; createdAt: number; fileCount: number }>>([]);
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [restoringCheckpointId, setRestoringCheckpointId] = useState<string | null>(null);

  // On project switch, clear undo/history state
  useEffect(() => { setUndoCheckpoint(null); setCheckpointList([]); setShowVersionHistory(false); }, [activeProjectId]);

  const splitView = false;

  const theme = useTheme();
  const [readOnlyProjectId, setReadOnlyProjectId] = useState<string | null>(null);
  const isReadOnlyProject = isReadOnlyProjectView(readOnlyProjectId, activeProjectId);

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
          // Neutral grey family, matching the studio dark elevation scale —
          // the previous palette was blue-tinted (#10161F family) and clashed
          // with the neutral dark-grey surfaces.
          { token: 'comment', foreground: '8A8A8A', fontStyle: 'italic' },
          { token: 'keyword', foreground: 'C3D6F2' },
          { token: 'string', foreground: '9FD4B8' },
          { token: 'number', foreground: 'E3C08D' },
          { token: 'type', foreground: 'A3C2F5' },
          { token: 'tag', foreground: 'A3C2F5' },
        ],
        colors: {
          'editor.background': '#131313', 'editor.foreground': '#EDEDED',
          'editorLineNumber.foreground': '#7A7A7A', 'editorLineNumber.activeForeground': '#EDEDED',
          'editor.lineHighlightBackground': '#1D1D1D', 'editor.selectionBackground': '#3D3D3D',
          'editor.inactiveSelectionBackground': '#2C2C2C', 'editorCursor.foreground': '#A3C2F5',
          'editorIndentGuide.background1': '#2C2C2C', 'editorIndentGuide.activeBackground1': '#555555',
          'editorWidget.background': '#242424', 'editorWidget.border': '#4A4A4A',
          'editorSuggestWidget.background': '#242424', 'editorSuggestWidget.border': '#4A4A4A',
          'editorSuggestWidget.selectedBackground': '#333333',
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

  const consoleEndRef = useRef<HTMLDivElement>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const syncedPreviewFilesRef = useRef<FileMap>({});
  const [previewIssue, setPreviewIssue] = useState<PreviewIssue | null>(null);
  const [previewCapReason, setPreviewCapReason] = useState<'rows' | 'bytes' | null>(null);
  const [previewLoadState, setPreviewLoadState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [previewLoadError, setPreviewLoadError] = useState('');
  const previewLoadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Mirror for the generation-status effect, whose subscription does not
  // resubscribe on preview state changes.
  const previewLoadStateRef = useRef(previewLoadState);
  useEffect(() => { previewLoadStateRef.current = previewLoadState; }, [previewLoadState]);
  useEffect(() => setPreviewIssue(null), [activeProjectId]);
  // Self-heal stale "Cannot resolve module" errors: if the missing file arrives
  // (e.g. via a fix run), the old error overlay must not stick around obscuring
  // the preview. Clear it and let the preview retry with the complete file set.
  useEffect(() => {
    if (!previewIssue || previewIssue.layer !== 'frontend') return;
    const m = /Cannot resolve module "([^"]+)"/.exec(previewIssue.error);
    if (!m) return;
    const spec = m[1];
    // Resolve relative to the importing file's directory.
    const importerDir = previewIssue.file.slice(0, previewIssue.file.lastIndexOf('/'));
    const resolved = (importerDir + '/' + spec).split('/').reduce<string[]>((acc, part) => {
      if (part === '..') acc.pop(); else if (part !== '.') acc.push(part);
      return acc;
    }, []).join('/');
    const exists = files[resolved] !== undefined || files[resolved + '.tsx'] !== undefined || files[resolved + '.ts'] !== undefined || files[resolved + '.jsx'] !== undefined || files[resolved + '.js'] !== undefined;
    if (exists) {
      setPreviewIssue(null);
      setPreviewLoadError('');
      if (previewLoadStateRef.current === 'error') markPreviewState('loading');
    }
  }, [files, previewIssue]);
  useEffect(() => {
    setPreviewLoadState('idle');
    setPreviewLoadError('');
    if (previewLoadTimerRef.current) {
      clearTimeout(previewLoadTimerRef.current);
      previewLoadTimerRef.current = null;
    }
  }, [activeProjectId]);
  const [generationMode, setGenerationMode] = useState<'full' | 'incremental'>('full');
  const [previewFixRequest, setPreviewFixRequest] = useState<{ projectId: string; error: string; file: string; layer: string } | null>(null);
  useAutomaticPreviewFix(activeProjectId, previewIssue, status === 'Generating', previewLoadState, () => setAutoFixing(true));
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

  // Live code follow: when the user is on the Code tab and hasn't manually
  // chosen a file in this generation, auto-switch the editor to each new file
  // as the AI starts writing it — gives the Lovable-style "live coding" effect.
  const userPickedFileInGenRef = useRef(false);
  const resolvedActiveTabRef = useRef(resolvedActiveTab);

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
      reloadPreview();
    }
    prevHasGeneratedRef.current = hasGeneratedApp;
  }, [hasGeneratedApp, markPreviewState, reloadPreview]);

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

  const github = useGithubSync({ activeProjectId, isCurrent, filesRef, commitFiles, addBuildLog });

  useEffect(() => { activeFileRef.current = activeFile; }, [activeFile]);
  useEffect(() => { resolvedActiveTabRef.current = resolvedActiveTab; }, [resolvedActiveTab]);
  // Reset the "user picked a file" flag on project change so each new project
  // starts with live-follow enabled.
  useEffect(() => { userPickedFileInGenRef.current = false; }, [activeProjectId]);

  useEffect(() => {
    syncedPreviewFilesRef.current = {};
  }, [activeProjectId]);

  // Keep filesRef in step with any state update that did not go through
  // commitFiles, and stream only the changed preview files to the iframe.
  // Debounced during generation to avoid spamming the preview with every
  // streaming chunk — only the final complete files reach the iframe.
  const previewSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const streamFlushRef = useRef<number | null>(null);
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
      if (streamFlushRef.current) {
        cancelAnimationFrame(streamFlushRef.current);
        streamFlushRef.current = null;
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

  const handleCreateFile = useCallback((path: string) => {
    if (!path || files[path] !== undefined) return;
    commitFiles({ ...filesRef.current, [path]: '' });
    setActiveFile(path);
    selectTab('code');
    addBuildLog(`Created file: ${path}`, 'info');
  }, [files, commitFiles, selectTab, addBuildLog]);

  const handleRenameFile = useCallback((oldPath: string, newPath: string) => {
    if (!oldPath || !newPath || oldPath === newPath || files[newPath] !== undefined) return;
    const next = { ...filesRef.current };
    next[newPath] = next[oldPath];
    delete next[oldPath];
    commitFiles(next);
    if (activeFile === oldPath) setActiveFile(newPath);
    addBuildLog(`Renamed: ${oldPath} → ${newPath}`, 'info');
  }, [files, activeFile, commitFiles, addBuildLog]);

  const handleDeleteFile = useCallback((path: string) => {
    if (!path || files[path] === undefined) return;
    const next = { ...filesRef.current };
    delete next[path];
    commitFiles(next, { replaceAll: true });
    if (activeFile === path) {
      const remaining = Object.keys(next);
      setActiveFile(selectAppEntry(next) || remaining[0] || '/src/App.tsx');
    }
    addBuildLog(`Deleted file: ${path}`, 'warn');
  }, [files, activeFile, commitFiles, addBuildLog]);

  const handleExportZip = useCallback(async () => {
    try {
      await exportProjectAsZip(filesRef.current, activeProjectId || 'brainhalf-project');
      addBuildLog(`Project exported as ZIP: ${activeProjectId || 'brainhalf-project'}`, 'success');
    } catch (err: any) {
      addBuildLog(`ZIP export failed: ${err?.message || err}`, 'error');
    }
  }, [activeProjectId, addBuildLog]);

  const refreshUndoCheckpoint = useCallback(async () => {
    if (!activeProjectId || !isCurrent()) return;
    try {
      const origin = apiOrigin();
      const base = `${origin}/agents/chat-agent/${encodeURIComponent(activeProjectId)}/checkpoints`;
      const resp = await authFetch(base, { signal: AbortSignal.timeout(8_000), headers: { 'Content-Type': 'application/json' } });
      const data = await resp.json() as { checkpoints?: Array<{ id: string; label: string; createdAt?: number; fileCount?: number }>; revision?: number };
      if (Array.isArray(data.checkpoints) && typeof data.revision === 'number') {
        const cp = data.checkpoints.find(c => c.label === 'Before agent changes');
        if (cp) setUndoCheckpoint({ id: cp.id, revision: data.revision });
        setCheckpointList(data.checkpoints.map(c => ({
          id: c.id,
          label: c.label,
          createdAt: typeof c.createdAt === 'number' ? c.createdAt : 0,
          fileCount: typeof c.fileCount === 'number' ? c.fileCount : 0,
        })));
      }
    } catch { /* silent — undo/history buttons just won't appear */ }
  }, [activeProjectId, isCurrent, setUndoCheckpoint]);

  const quickUndo = useCallback(async () => {
    if (!undoCheckpoint || !activeProjectId) return;
    setUndoLoading(true);
    try {
      const origin = apiOrigin();
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
  }, [undoCheckpoint, activeProjectId, addBuildLog, setUndoCheckpoint, setUndoLoading]);

  const restoreCheckpoint = useCallback(async (checkpointId: string, revision: number) => {
    if (!activeProjectId || restoringCheckpointId) return;
    setRestoringCheckpointId(checkpointId);
    setShowVersionHistory(false);
    try {
      const origin = apiOrigin();
      const base = `${origin}/agents/chat-agent/${encodeURIComponent(activeProjectId)}/checkpoints`;
      const resp = await authFetch(`${base}/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: checkpointId, revision }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error || 'Restore failed');
      }
      addBuildLog('Restored to selected version', 'info');
      void refreshUndoCheckpoint();
    } catch (err: any) {
      addBuildLog(`Restore failed: ${err?.message || err}`, 'error');
    } finally {
      setRestoringCheckpointId(null);
    }
  }, [activeProjectId, restoringCheckpointId, addBuildLog, refreshUndoCheckpoint]);

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
    const handleGenerationStatus = ({ status: newStatus, detail, file, error, projectId }: GenerationStatusPayload) => {
      if (projectId && projectId !== activeProjectId) return;
      if (newStatus === 'Generating') {
        setUndoCheckpoint(null);
        setStatusError('');
        if (!generationActiveRef.current) {
          setGenerationMode('full');
          generationTouchedRef.current = new Set();
          userPickedFileInGenRef.current = false;
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
        setStatusError('');
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
        if (previewLoadStateRef.current === 'ready') {
          // The preview already rendered the final file set — its success
          // landed while the builder was finishing. Restarting the load cycle
          // here races that render and used to leave a stale "preview failed"
          // state on screen until a manual refresh.
          setStatus('Ready');
          setPreviewStatus(activeProjectId, 'Ready');
        } else {
          // No render has confirmed the final files yet (e.g. a mid-generation
          // module error was the last word). Force one clean reload so the
          // result is authoritative instead of depending on a file sync that
          // already happened and cannot repeat.
          markPreviewState('loading');
          if (completedGeneration) reloadPreview();
        }
        if (completedGeneration) startBackend(filesRef.current);
        addBuildLog(
          completedGeneration && isFullStackProject(filesRef.current)
            ? 'Source saved. Starting the backend when managed development hosting is available.'
            : 'Source saved. Review the browser preview and run project checks.',
          'success'
        );
        if (completedGeneration) addConsoleLog('[validation] Generation complete; project typecheck, build and tests have not been run by this preview.');
        if (completedGeneration) void github.autoSync();
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
        setStatusError(errMsg);
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

      // Live code follow: when the user is on the Code tab, auto-switch to each
      // new file as the AI begins streaming it. This creates the "watching code
      // being written" effect. Guards:
      //   1. Only on first chunk of a brand-new file (not already in filesRef)
      //   2. Only while generation is active
      //   3. Only when user is on the code tab
      //   4. Only if user hasn't manually chosen a different file this generation
      if (
        !isComplete &&
        generationActiveRef.current &&
        !userPickedFileInGenRef.current &&
        resolvedActiveTabRef.current === 'code' &&
        filesRef.current[cleanPath] === undefined
      ) {
        // Use the raw setter so this system switch doesn't itself count as a
        // user pick and stop future auto-follows.
        setActiveFileRaw(cleanPath);
      }

      if (isComplete) {
        commitFiles(next, { sync: false });
        addBuildLog(`Compiled: ${cleanPath}`, 'success');
        addConsoleLog(`[transpiler] Compiled ${cleanPath}`);

      } else {
        // Streaming chunks arrive many times per second per file. Update the ref
        // immediately (so the next chunk reads fresh state) but coalesce React
        // renders to one per animation frame to avoid layout thrashing.
        filesRef.current = next;
        if (!streamFlushRef.current) {
          streamFlushRef.current = requestAnimationFrame(() => {
            streamFlushRef.current = null;
            setFiles({ ...filesRef.current });
          });
        }
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
      reloadPreview();
      // Auto-start the backend when opening an existing full-stack project so
      // the live preview is always available without a manual "Start" click.
      if (generated && isFullStackProject(newFiles)) startBackend(newFiles);
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
      appEvents.on('generation-mode', ({ mode }: { mode: 'full' | 'incremental' }) => setGenerationMode(mode)),
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
      appEvents.on('preview-store-capped', (payload: unknown) => {
        const p = payload as { capped: boolean; reason?: string };
        setPreviewCapReason(p.capped ? ((p.reason as 'rows' | 'bytes') ?? 'rows') : null);
      }),
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
        setPreviewIssue({ error: fullErr, plainExplanation: plainPreviewError(diagnostic, layer), file, layer });
        if (generationActiveRef.current) {
          // Mid-generation module errors are expected: files land one at a
          // time, so an import can briefly point at a file that has not been
          // written yet. Surface the diagnostic in the preview panel but do
          // NOT flip the workspace out of 'Generating' — a later render with
          // the complete file set clears this, and flipping status here used
          // to leave the UI stuck on "Error" even after recovery.
          setPreviewLoadState('error');
          setPreviewLoadError(fullErr);
          if (previewLoadTimerRef.current) {
            clearTimeout(previewLoadTimerRef.current);
            previewLoadTimerRef.current = null;
          }
          appEvents.emit('preview-state', { projectId: activeProjectId, state: 'error', error: fullErr });
          addBuildLog(`${prefix} in ${file}: ${errorMsg} (files still writing — will recover when generation completes)`, 'warn');
          addConsoleLog(`[${layer}-error] ${fullErr}`);
          return;
        }
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
        if (generationActiveRef.current) {
          // A render completed with the files synced so far, so any earlier
          // mid-generation module error (files are written one by one) is
          // obsolete. Clear it — otherwise it can stick on screen after the
          // final files land — but keep the workspace in its generating
          // state until the builder actually finishes.
          setPreviewIssue(null);
          markPreviewState('ready');
          return;
        }
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
        reloadPreview();
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
    if (isReadOnlyProject) return;
    commitFiles({ ...filesRef.current, [activeFileRef.current]: value }, { debounce: true });
  }, [commitFiles, isReadOnlyProject]);

  const handleRefresh = useCallback(() => {
    appEvents.emit('sync-files', { files: filesRef.current, replaceAll: false });
    if (hasGeneratedAppCode(filesRef.current)) {
      setStatus('Connecting');
      markPreviewState('loading');
    }
    reloadPreview();
    addBuildLog('Reloading Cloudflare Edge preview', 'info');
  }, [addBuildLog, markPreviewState, selectTab, reloadPreview]);

  const handlePopoutPreview = useCallback(() => {
    if (isFullStackProject(filesRef.current) && backend.ready) {
      // Live backend is running — open the actual dev server URL.
      void backend.open();
      return;
    }
    // For static apps, or full-stack apps whose backend hasn't started yet,
    // always fall through to the edge preview so the button is never a no-op.
    appEvents.emit('sync-files', { files: filesRef.current, replaceAll: false });
    window.open(`/preview/${activeProjectId}/index.html`, '_blank', 'noopener,noreferrer');
  }, [activeProjectId, backend.ready, backend.open]);

  // When the design preview iframe loads, send files — and quickly detect
  // expired sessions (which return JSON, not HTML) to show a clear error
  // instead of waiting for the 45-second load timeout.
  const handlePreviewIframeLoad = useCallback(() => {
    iframeRef.current?.contentWindow?.postMessage(
      { type: 'sync-files', projectId: activeProjectId, files: previewFiles(filesRef.current, true) },
      previewTargetOrigin
    );
    // Fast-path: detect expired session by fetching the preview URL and
    // checking the status. 401/403 with a JSON body → expired; a 429 from the
    // preview rate limiter is transient and recovers on the next reload, so it
    // must not be misreported as an expired session.
    void fetch(`/preview/${activeProjectId}/index.html`, { credentials: 'include', signal: AbortSignal.timeout(5_000) })
      .then(res => {
        const ct = res.headers.get('content-type') || '';
        if ((res.status === 401 || res.status === 403) && (ct.includes('application/json') || ct.includes('text/plain'))) {
          const message = 'Preview session expired. Refresh the page to start a new session.';
          setPreviewLoadState('error');
          setPreviewLoadError(message);
          setStatus('Error');
          setPreviewStatus(activeProjectId, 'Error');
        }
      })
      .catch(() => { /* network error — timeout will handle it */ });
  }, [activeProjectId, previewTargetOrigin]);

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

  const previewActionIssue = useMemo<PreviewIssue | null>(() => {
    return previewIssue ?? (previewLoadError
      ? (() => {
          const layer = detectLayerFromError(previewLoadError);
          const file = extractFileFromError(previewLoadError);
          return { error: previewLoadError, plainExplanation: plainPreviewError(diagnosePreviewError(previewLoadError), layer), file, layer };
        })()
      : null);
  }, [previewIssue, previewLoadError]);

  // Single source of truth for the preview error overlay — used in both split
  // and single-panel layouts. Renders null when the error should not be shown.
  // Suppress the error overlay while the backend is actively building — the
  // edge preview for a full-stack app returns an auth gate (which looks like an
  // error) when the backend hasn't deployed yet, but we show BackendBuildProgress
  // instead. Showing both would confuse the user.
  const suppressPreviewError = backend.isBuilding && isFullStackProject(filesRef.current);
  const previewErrorOverlay = previewLoadState === 'error' && status !== 'Generating' && !backend.ready && !suppressPreviewError
    ? (
        <div className="studio-preview-empty has-error premium-error-overlay" role="alert" aria-live="polite">
          <div className="premium-error-icon-wrapper" aria-hidden="true">
            <div className="premium-error-icon-bg"></div>
            {autoFixing ? <Loader2 size={36} strokeWidth={1.5} className="lucide-spin" /> : <AlertCircle size={36} strokeWidth={1.5} />}
          </div>
          <span className="studio-eyebrow-label premium-eyebrow">{autoFixing ? 'AUTO-FIXING' : 'PREVIEW ERROR'}</span>
          <h2 className="premium-error-title">{autoFixing ? 'Fixing your app automatically…' : 'Your preview ran into a problem.'}</h2>
          <p className="premium-error-desc">{autoFixing ? 'The builder detected the error and is working on a fix. This usually takes a few seconds.' : (previewActionIssue?.plainExplanation || 'The preview could not be shown yet. The builder can try to fix this.')}</p>
          <div className="premium-error-actions">
            {autoFixing ? null : previewActionIssue
              ? <button type="button" className="studio-empty-action premium-action-btn" onClick={() => appEvents.emit('auto-fix-error', { ...previewActionIssue, projectId: activeProjectId })}><RotateCcw size={16} />Ask the builder to fix</button>
              : <button type="button" className="studio-empty-action premium-action-btn secondary" onClick={openChat}><MessageSquare size={16} />Open chat</button>
            }
            {!autoFixing && undoCheckpoint && (
              <button type="button" className="studio-empty-action premium-action-btn secondary" disabled={undoLoading} onClick={quickUndo}>
                {undoLoading ? <><Loader2 size={16} className="lucide-spin" />Reverting…</> : <><RotateCcw size={16} />Revert to working version</>}
              </button>
            )}
            {!autoFixing && (
              <button type="button" className="studio-empty-action premium-action-btn secondary" onClick={() => { openChat(); appEvents.emit('screenshot-fix-request', { projectId: activeProjectId }); }}>
                <Camera size={16} />Fix with screenshot
              </button>
            )}
          </div>
          {!autoFixing && previewActionIssue && <details style={{ marginTop: 16, maxWidth: 420, textAlign: 'left', color: 'var(--text-muted)', fontSize: 12 }}><summary style={{ cursor: 'pointer' }}>Technical details</summary><pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', marginTop: 8 }}>{sanitizeErrorForDisplay(previewActionIssue.error)}</pre></details>}
        </div>
      )
    : null;

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
      {/* Bolt-style unified topbar — replaces separate workspace-toolbar */}
      <TopNav
        activeProjectId={activeProjectId}
        currentUser={currentUser}
        onGoHome={onGoHome}
        onNewProject={onNewProject}
        onOpenDashboard={onOpenDashboard}
        onLogout={onLogout}
        creatingProject={creatingProject}
        isMobile={isMobile}
        mobileTab={mobileTab}
        onSelectMobileTab={onSelectMobileTab}
        activeTab={resolvedActiveTab}
        onSelectTab={selectTab}
        hasGeneratedApp={hasGeneratedApp && status !== 'Generating'}
        hasFiles={Object.keys(files).length > 0}
        viewportMode={viewportMode}
        onViewportMode={handleViewportMode}
        onRefreshPreview={reloadPreview}
        onOpenPreview={handlePopoutPreview}
        previewReady={hasGeneratedApp && status !== 'Generating' && previewLoadState !== 'error'}
        openPreviewReady={hasGeneratedApp && status !== 'Generating'}
        shareCopied={shareCopied}
        onShare={async () => {
          const shareUrl = `${window.location.origin}${window.location.pathname}?project=${activeProjectId}`;
          const ok = await copyText(shareUrl);
          if (ok) { setShareCopied(true); } else { setShareFallback(shareUrl); }
        }}
        publishOpen={publishOpen}
        onPublish={() => {
          if (!hasGeneratedApp || status === 'Generating') return;
          if (previewLoadState === 'error') {
            addBuildLog('Publishing is blocked until the preview error is fixed — the cloud build would hit the same problem.', 'warn');
            return;
          }
          setPublishOpen(open => !open);
        }}
        publishBlockedReason={previewLoadState === 'error' ? 'Fix the preview error before publishing — the cloud build would fail the same way.' : undefined}
        onExportZip={() => { void handleExportZip(); }}
        onExportGithub={() => github.openModal()}
        onResetWorkspace={() => setShowResetConfirm(true)}
        inspectActive={inspectModeActive}
        onInspect={!backend.liveUrl && hasGeneratedApp ? handleInspectToggle : undefined}
        liveUrl={prodLiveUrl || undefined}
        publishPopoverSlot={publishOpen && hasGeneratedApp ? (
          <Suspense fallback={null}>
          <PublishPopover
            projectId={activeProjectId}
            files={files}
            onClose={() => setPublishOpen(false)}
            onCustomDomain={() => {
              setPublishOpen(false);
              setConsoleSectionRequest({ section: 'Web address', nonce: Date.now() });
              selectTab('console');
            }}
            onOpenHostedSlots={() => {
              setPublishOpen(false);
              setConsoleSectionRequest({ section: 'My live apps', nonce: Date.now() });
              selectTab('console');
            }}
          />
          </Suspense>
        ) : undefined}
      />

      {/* Content */}
      <div style={{ flex: 1, position: 'relative', display: 'flex', overflow: 'hidden', minHeight: 0 }}>
        {splitView ? (
          <div style={{ display: 'flex', width: '100%', height: '100%', minWidth: 0 }}>
            {showFileExplorer && hasGeneratedApp && <Suspense fallback={null}><FileExplorer
              files={files}
              activeFile={activeFile}
              onSelectFile={setActiveFile}
              headerTitle="Project files"
              onCreateFile={!isReadOnlyProject ? handleCreateFile : undefined}
              onRenameFile={!isReadOnlyProject ? handleRenameFile : undefined}
              onDeleteFile={!isReadOnlyProject ? handleDeleteFile : undefined}
              readOnly={isReadOnlyProject}
            /></Suspense>}
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
            <div style={{ flex: 1, minWidth: 0, height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg-preview-canvas)', position: 'relative', overflow: 'hidden', containerType: 'inline-size' }}>
              {status === 'Generating' && (
                <GenerationProgress files={Object.keys(files)} progress={fileProgress} />
              )}
              <div style={{ flex: 1, minHeight: 0, width: '100%', display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden' }}>
                <BuilderOverlay
                  isGenerating={status === 'Generating'}
                  fileProgress={fileProgress}
                  files={Object.keys(files)}
                  previewReady={hasGeneratedApp && (wcEnabled ? wc.status === 'ready' : backend.liveUrl ? true : previewLoadState === 'ready')}
                  isFirstGeneration={!hasGeneratedApp && generationEverAttempted}
                />
                {isWaitingForFirstApp && previewLoadState !== 'error' && (
                  <div className={`studio-preview-empty${status === 'Error' ? ' has-error' : ''}`} role="status" aria-live="polite">
                    <div className="studio-empty-window" aria-hidden="true"><div><i /><i /><i /></div>{status === 'Error' ? <AlertCircle size={32} strokeWidth={1.5} /> : <Code2 size={32} strokeWidth={1.5} />}</div>
                    <span className="studio-eyebrow-label">{status === 'Error' ? "LET'S GET YOU BACK ON TRACK" : status === 'Stopped' ? 'BUILD PAUSED' : (status === 'Ready' && generationEverAttempted) ? 'BUILD UNFINISHED' : 'FROM YOUR IDEA TO YOUR FIRST VERSION'}</span>
                    <h2>{status === 'Error' ? "Your app hasn't been built yet." : status === 'Stopped' ? "Continue when you're ready." : status === 'Generating' ? 'Your idea is taking shape.' : status === 'Connecting' ? 'Preparing your preview.' : (status === 'Ready' && generationEverAttempted) ? "The app's screens weren't finished." : 'A place for your next idea.'}</h2>
                    <p>{status === 'Error' ? (statusError || "The last request couldn't finish. Open the conversation to retry or choose another model.") : status === 'Stopped' ? 'Your conversation is saved. Send a message to pick up where you left off.' : status === 'Generating' ? "The builder is working on your first version. The preview will appear here as it takes shape." : status === 'Connecting' ? "Your files are ready. We’re getting your preview ready now." : (status === 'Ready' && generationEverAttempted) ? 'The builder set up the behind-the-scenes parts but ran out of space before writing the screens you see. Ask it to build the app’s screens.' : 'Describe what you want to make in the chat. Make it together, then try it right here.'}</p>
                    {(status === 'Generating' || status === 'Connecting')
                      ? <div className="studio-preview-empty-note"><Loader2 className="lucide-spin" size={16} />{status === 'Generating' ? GENERATION_TIPS[tipIndex] : 'Getting your preview ready'}</div>
                      : status === 'Error' || status === 'Stopped'
                      ? <button type="button" className="studio-empty-action" onClick={openChat}><MessageSquare size={16} />Open chat</button>
                      : (status === 'Ready' && generationEverAttempted)
                      ? <button type="button" className="studio-empty-action" onClick={openChat}><MessageSquare size={16} />Ask the builder to finish the screens</button>
                      : <button type="button" className="studio-empty-action" onClick={openChat}><MessageSquare size={16} />Describe your app</button>
                    }
                    {Object.keys(files).length > 0 && <BuildProgress files={Object.keys(files)} progress={fileProgress} building={status === 'Generating'} agentTouched={generationTouchedRef.current} />}
                  </div>
                )}
                {previewErrorOverlay}
                {isReadOnlyProject && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 16px', background: 'linear-gradient(90deg, rgba(14, 165, 233, 0.15) 0%, rgba(99, 102, 241, 0.15) 100%)', borderBottom: '1px solid rgba(56, 189, 248, 0.25)', fontSize: '12px', color: 'var(--text-primary)', zIndex: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Eye size={14} style={{ color: 'var(--color-info)' }} />
                      <span><strong>Read-Only Preview</strong> — Clone a copy to edit.</span>
                    </div>
                    <button onClick={handleForkProject} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '4px 12px', borderRadius: '6px', fontSize: '12px', fontWeight: 500, background: '#0ea5e9', color: 'var(--text-on-accent)', border: 'none', cursor: 'pointer' }}>
                      <GitBranch size={13} /><span>Clone</span>
                    </button>
                  </div>
                )}
                {isFullStackProject(files) && !isWaitingForFirstApp && !backend.liveUrl && (
                  <>
                    {backend.isBuilding && status !== 'Generating' && (
                      <div className="preview-building-pill preview-building-pill--backend" role="status"><Loader2 size={13} className="lucide-spin" /><span>{backend.message || 'Starting your backend — live preview on its way…'}</span></div>
                    )}
                    <DesignPreviewStrip backend={backend} runtime={runtime} status={status} filesRef={filesRef} onOpenHostedSlots={openHostedSlots} projectId={activeProjectId} autoFixing={autoFixing} />
                  </>
                )}
                {isFullStackProject(files) && !isWaitingForFirstApp && backend.liveUrl && status !== 'Error' && (
                  <div className="preview-health-strip preview-health-strip--compact" role="status">
                    <span className="preview-health-dot" aria-hidden="true" />
                    <span className="preview-health-url" title={backend.liveUrl}>{(() => { try { return new URL(backend.liveUrl).hostname; } catch { return backend.liveUrl.replace(/^https?:\/\//, '').split('/')[0]; } })()}</span>
                    {backend.canUpdate && (
                      <button disabled={status === 'Generating'} onClick={() => backend.start(filesRef.current, true)}>
                        <RotateCcw size={12} strokeWidth={2} />Update
                      </button>
                    )}
                    <button onClick={() => void backend.open()}>
                      Open <ArrowUpRight size={12} strokeWidth={1.75} />
                    </button>
                  </div>
                )}
                {projectDeletedFlag && (
                  <div className="preview-health-strip has-fault" role="alert" style={{ background: 'var(--bg-error, #2a1215)', borderColor: 'var(--border-error, #5c2127)' }}>
                    <AlertCircle size={15} />
                    <div className="preview-health-strip-body">
                      <strong>Project deleted</strong> · This project was deleted from the server and can no longer be edited.
                      <br />You can still download a copy of your files.
                    </div>
                    <button type="button" disabled={recoveryBusy} onClick={handleRecoveryExport}>
                      <Download size={14} style={{ marginRight: '6px' }} />{recoveryBusy ? 'Exporting…' : 'Download files'}
                    </button>
                  </div>
                )}
                <PreviewCanvas mode={viewportMode}>
                  {wcEnabled ? (
                    <WebContainerPreview status={wc.status} previewUrl={wc.previewUrl} error={wc.error} onRestart={wc.restart} onOpenTerminal={() => selectTab('terminal')} />
                  ) : backend.liveUrl ? (
                    <LivePreviewFrame projectId={activeProjectId} liveUrl={backend.liveUrl} />
                  ) : backend.isBuilding && isFullStackProject(filesRef.current) && status !== 'Generating' ? (
                    // Show a rich build progress card instead of the auth-gated edge
                    // preview while the backend pipeline is running (npm install → build
                    // → deploy). The edge preview for full-stack apps just shows "Sign in
                    // to your account" at this point — the card is far more useful.
                    <BackendBuildProgress
                      message={backend.message}
                      startedAt={backend.buildStartedAt}
                    />
                  ) : previewSessionReady ? <iframe
                    ref={iframeRef}
                    key={`edge-preview-${activeProjectId}-${edgeRefreshCounter}`}
                    src={`/preview/${activeProjectId}/index.html`}
                    sandbox={PREVIEW_SANDBOX}
                    allow={PREVIEW_ALLOW}
                    onLoad={handlePreviewIframeLoad}
                    onError={() => {
                      // During generation the file set is partial — Vite HMR errors are expected.
                      // Skip status changes here; the generation flow handles final error state.
                      if (generationActiveRef.current) return;
                      const message = 'The preview failed to load.';
                      setPreviewIssue({ error: message, plainExplanation: 'Your app could not be loaded in the preview. The builder can try to fix this.', file: '', layer: isFullStackProject(files) ? 'backend' : 'frontend' });
                      setStatus('Error');
                      setPreviewStatus(activeProjectId, 'Error');
                      markPreviewState('error', message);
                    }}
                    style={{ width: '100%', height: '100%', border: 'none', display: 'block', background: 'var(--bg-card)' }}
                    title="Application Preview"
                  /> : <div className="studio-session-loading" role="status">Connecting your preview…</div>}
                </PreviewCanvas>
                {hasGeneratedApp && previewIssue && status !== 'Generating' && <div className="preview-health-strip has-error" role="status">{autoFixing ? <Loader2 size={15} className="lucide-spin" /> : <AlertCircle size={15} />}<span title={sanitizeErrorForDisplay(previewIssue.error).slice(0, 500)}>{autoFixing ? 'Auto-fixing…' : previewIssue.plainExplanation}</span>{!autoFixing && <button onClick={() => appEvents.emit('auto-fix-error', { ...previewIssue, projectId: activeProjectId })}>Fix</button>}{!autoFixing && undoCheckpoint && <button disabled={undoLoading} onClick={quickUndo}>{undoLoading ? 'Reverting…' : 'Revert'}</button>}{!autoFixing && <button onClick={() => { openChat(); appEvents.emit('screenshot-fix-request', { projectId: activeProjectId }); }} title="Fix with screenshot"><Camera size={13} /></button>}</div>}
                {hasGeneratedApp && status === 'Generating' && previewLoadState !== 'error' && <div className="preview-building-pill" role="status"><Loader2 size={13} className="lucide-spin" /><span>{generationMode === 'incremental' ? 'Editing your app — targeted changes in progress.' : 'Building your app — the preview refreshes when it\'s ready.'}</span></div>}
                {hasGeneratedApp && !previewIssue && <PreviewStoreCappedBanner reason={previewCapReason} />}
              </div>
            </div>
          </div>
        ) : isEditorTab ? (
          <div style={{ display: 'flex', width: '100%', height: '100%', minWidth: 0 }}>
            {showFileExplorer && hasGeneratedApp && <Suspense fallback={null}><FileExplorer
              files={files}
              activeFile={activeFile}
              onSelectFile={setActiveFile}
              headerTitle="Project files"
              onCreateFile={!isReadOnlyProject ? handleCreateFile : undefined}
              onRenameFile={!isReadOnlyProject ? handleRenameFile : undefined}
              onDeleteFile={!isReadOnlyProject ? handleDeleteFile : undefined}
              readOnly={isReadOnlyProject}
            /></Suspense>}

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
                      ? <><Server size={12} strokeWidth={2} />Backend</>
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
                    onClick={(e) => { (e.currentTarget as HTMLElement).focus(); github.openModal(); }}
                    className="hover-bright"
                    title={github.savedRepo ? `GitHub: ${github.savedRepo}${github.hasToken ? ' · auto-sync on' : ''}` : 'Export to GitHub'}
                    aria-label={github.savedRepo ? `GitHub: ${github.savedRepo}` : 'Export to GitHub'}
                    style={{
                      background: 'transparent', border: 'none',
                      color: github.savedRepo ? 'var(--color-success, #22c55e)' : 'var(--text-muted)',
                      padding: '6px 8px', minHeight: '32px', cursor: 'pointer',
                      display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', fontFamily: 'inherit'
                    }}
                  >
                    {github.syncing
                      ? <Loader2 size={16} strokeWidth={1.75} className="lucide-spin" />
                      : <FolderCode size={16} strokeWidth={1.75} />}
                    {!compactToolbar && (
                      <span>{github.savedRepo ? github.savedRepo : 'GitHub'}</span>
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
                  {checkpointList.length > 0 && (
                    <div style={{ position: 'relative' }}>
                      <button
                        onClick={() => setShowVersionHistory(v => !v)}
                        disabled={status === 'Generating'}
                        className="hover-bright"
                        title="Restore a previous version"
                        aria-label="Version history"
                        style={{
                          background: 'transparent', border: '1px solid var(--border-subtle, #374151)',
                          color: 'var(--text-muted)', borderRadius: '4px',
                          padding: '6px 8px', minHeight: '32px', cursor: 'pointer',
                          display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', fontFamily: 'inherit'
                        }}
                      >
                        <GitBranch size={16} strokeWidth={1.75} />
                        {!compactToolbar && <span>History</span>}
                      </button>
                      {showVersionHistory && (
                        <div
                          style={{
                            position: 'absolute', top: '100%', right: 0, marginTop: 4,
                            background: 'var(--bg-surface, #1f2937)', border: '1px solid var(--border-subtle, #374151)',
                            borderRadius: 6, zIndex: 100, minWidth: 240, maxHeight: 300, overflowY: 'auto',
                            boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
                          }}
                          onMouseLeave={() => setShowVersionHistory(false)}
                        >
                          <div style={{ padding: '8px 12px', fontSize: 11, color: 'var(--text-muted)', borderBottom: '1px solid var(--border-subtle, #374151)', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                            Version history
                          </div>
                          {checkpointList.map(cp => (
                            <button
                              key={cp.id}
                              onClick={() => void restoreCheckpoint(cp.id, undoCheckpoint?.revision ?? 0)}
                              disabled={!!restoringCheckpointId}
                              style={{
                                display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
                                width: '100%', padding: '8px 12px', background: 'transparent',
                                border: 'none', borderBottom: '1px solid var(--border-subtle, #374151)',
                                color: 'var(--text-primary, #f9fafb)', cursor: 'pointer', textAlign: 'left',
                                fontSize: 12, fontFamily: 'inherit', gap: 2,
                              }}
                            >
                              <span style={{ fontWeight: 500 }}>
                                {restoringCheckpointId === cp.id ? <Loader2 size={12} className="lucide-spin" style={{ marginRight: 4 }} /> : null}
                                {cp.label}
                              </span>
                              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                                {cp.fileCount} files · {cp.createdAt ? formatRelativeTime(cp.createdAt) : ''}
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
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
                      tabSize: 2,
                      readOnly: isReadOnlyProject
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
        ) : resolvedActiveTab === 'terminal' && wcEnabled ? (
          <div className="wc-terminal-tab-panel">
            <div className="wc-terminal-header">
              <Terminal size={13} />
              <span>Terminal</span>
              <span className="wc-terminal-status" data-status={wc.status}>
                {wc.status === 'ready' ? 'Connected' : wc.status === 'error' ? 'Error' : wc.status === 'installing' ? 'Installing…' : wc.status === 'starting' ? 'Starting…' : 'Booting…'}
              </span>
            </div>
            <div className="wc-terminal-body">
              <Suspense fallback={<div style={{ padding: 16, color: 'var(--text-muted)', fontSize: 13 }}>Loading terminal…</div>}>
                <TerminalPanel onReady={wc.attachTerminal} />
              </Suspense>
            </div>
          </div>
        ) : resolvedActiveTab === 'console' ? (
          <Suspense fallback={<div style={{ display: 'grid', placeItems: 'center', width: '100%', height: '100%', color: 'var(--text-muted)' }}>Loading console…</div>}><ProjectConsole key={activeProjectId} projectId={activeProjectId} files={files} onClose={() => selectTab('preview')} sectionRequest={consoleSectionRequest} /></Suspense>
        ) : resolvedActiveTab === 'logs' ? (
          <div className="activity-panel">
            <div className="activity-panel-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                <ListFilter size={13} style={{ color: 'var(--text-muted)' }} />
                <span style={{ fontWeight: 600, fontSize: '12px', color: 'var(--text-primary)' }}>Activity</span>
              </div>
              <button onClick={() => setBuildLogs([])} className="activity-panel-clear">Clear</button>
            </div>
            <div className="activity-panel-body">
              {buildLogs.length === 0 ? (
                <div className="activity-panel-empty">
                  <ListFilter size={20} style={{ opacity: 0.25, marginBottom: '6px' }} />
                  <span>No events yet</span>
                  <span style={{ fontSize: '11px', marginTop: '2px' }}>Generations and file writes will appear here</span>
                </div>
              ) : (
                buildLogs.map(item => (
                  <div key={item.id} className={`activity-log-row activity-log-row--${item.type}`}>
                    <span className="activity-log-dot" aria-hidden="true" />
                    <span className="activity-log-text">{item.text}</span>
                    <time className="activity-log-time">{item.time}</time>
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
              <BuilderOverlay
                isGenerating={status === 'Generating'}
                fileProgress={fileProgress}
                files={Object.keys(files)}
                previewReady={hasGeneratedApp && (wcEnabled ? wc.status === 'ready' : backend.liveUrl ? true : previewLoadState === 'ready')}
                isFirstGeneration={!hasGeneratedApp && generationEverAttempted}
              />
              {/* Keep fresh, building and failed projects distinct without showing a fake app. */}
              {isWaitingForFirstApp && previewLoadState !== 'error' && (
                <div className={`studio-preview-empty${status === 'Error' ? ' has-error' : ''}`} role="status" aria-live="polite">
                  <div className="studio-empty-window" aria-hidden="true"><div><i /><i /><i /></div>{status === 'Error' ? <AlertCircle size={32} strokeWidth={1.5} /> : <Code2 size={32} strokeWidth={1.5} />}</div>
                  <span className="studio-eyebrow-label">{status === 'Error' ? "LET'S GET YOU BACK ON TRACK" : status === 'Stopped' ? 'BUILD PAUSED' : (status === 'Ready' && generationEverAttempted) ? 'BUILD UNFINISHED' : 'FROM YOUR IDEA TO YOUR FIRST VERSION'}</span>
                  <h2>{status === 'Error' ? "Your app hasn't been built yet." : status === 'Stopped' ? "Continue when you're ready." : status === 'Generating' ? 'Your idea is taking shape.' : status === 'Connecting' ? 'Preparing your preview.' : (status === 'Ready' && generationEverAttempted) ? "The app's screens weren't finished." : 'A place for your next idea.'}</h2>
                  <p>{status === 'Error' ? (statusError || "The last request couldn't finish. Open the conversation to retry or choose another model.") : status === 'Stopped' ? 'Your conversation is saved. Send a message to pick up where you left off.' : status === 'Generating' ? "The builder is working on your first version. The preview will appear here as it takes shape." : status === 'Connecting' ? "Your files are ready. We’re getting your preview ready now." : (status === 'Ready' && generationEverAttempted) ? 'The builder set up the behind-the-scenes parts but ran out of space before writing the screens you see. Ask it to build the app’s screens.' : 'Describe what you want to make in the chat. Make it together, then try it right here.'}</p>
                  {(status === 'Generating' || status === 'Connecting')
                    ? <div className="studio-preview-empty-note"><Loader2 className="lucide-spin" size={16} />{status === 'Generating' ? GENERATION_TIPS[tipIndex] : 'Getting your preview ready'}</div>
                    : status === 'Error' || status === 'Stopped'
                    ? <button type="button" className="studio-empty-action" onClick={openChat}><MessageSquare size={16} />Open chat</button>
                    : (status === 'Ready' && generationEverAttempted)
                    ? <button type="button" className="studio-empty-action" onClick={openChat}><MessageSquare size={16} />Ask the builder to finish the screens</button>
                    : <button type="button" className="studio-empty-action" onClick={openChat}><MessageSquare size={16} />Describe your app</button>
                  }
                  {Object.keys(files).length > 0 && <BuildProgress files={Object.keys(files)} progress={fileProgress} building={status === 'Generating'} agentTouched={generationTouchedRef.current} />}
                </div>
              )}
              {previewErrorOverlay}
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
              {isFullStackProject(files) && !isWaitingForFirstApp && !backend.liveUrl && (
                <>
                  {backend.isBuilding && status !== 'Generating' && (
                    <div className="preview-building-pill preview-building-pill--backend" role="status"><Loader2 size={13} className="lucide-spin" /><span>{backend.message || 'Starting your backend — live preview on its way…'}</span></div>
                  )}
                  <DesignPreviewStrip backend={backend} runtime={runtime} status={status} filesRef={filesRef} onOpenHostedSlots={openHostedSlots} projectId={activeProjectId} autoFixing={autoFixing} />
                </>
              )}
              {isFullStackProject(files) && !isWaitingForFirstApp && backend.liveUrl && status !== 'Error' && (
                <div className="preview-health-strip preview-health-strip--compact" role="status">
                  <span className="preview-health-dot" aria-hidden="true" />
                  <span className="preview-health-url" title={backend.liveUrl}>{backend.liveUrl.replace(/^https?:\/\//, '')}</span>
                  {backend.canUpdate && (
                    <button disabled={status === 'Generating'} onClick={() => backend.start(filesRef.current, true)}>
                      <RotateCcw size={12} strokeWidth={2} />Update
                    </button>
                  )}
                  <button onClick={() => void backend.open()}>
                    Open <ArrowUpRight size={12} strokeWidth={1.75} />
                  </button>
                </div>
              )}
              {projectDeletedFlag && (
                <div className="preview-health-strip has-fault" role="alert" style={{ background: 'var(--bg-error, #2a1215)', borderColor: 'var(--border-error, #5c2127)' }}>
                  <AlertCircle size={15} />
                  <div className="preview-health-strip-body">
                    <strong>Project deleted</strong> · This project was deleted from the server.
                    <br />You can still download a copy of your files.
                  </div>
                  <button type="button" disabled={recoveryBusy} onClick={handleRecoveryExport}>
                    <Download size={14} style={{ marginRight: '6px' }} />{recoveryBusy ? 'Exporting…' : 'Download files'}
                  </button>
                </div>
              )}
              <PreviewCanvas mode={viewportMode}>
                  {wcEnabled ? (
                    <WebContainerPreview status={wc.status} previewUrl={wc.previewUrl} error={wc.error} onRestart={wc.restart} onOpenTerminal={() => selectTab('terminal')} />
                  ) : backend.liveUrl ? (
                    <LivePreviewFrame projectId={activeProjectId} liveUrl={backend.liveUrl} />
                  ) : backend.isBuilding && isFullStackProject(filesRef.current) && status !== 'Generating' ? (
                    // Show a rich build progress card instead of the auth-gated edge
                    // preview while the backend pipeline is running (npm install → build
                    // → deploy). The edge preview for full-stack apps just shows "Sign in
                    // to your account" at this point — the card is far more useful.
                    <BackendBuildProgress
                      message={backend.message}
                      startedAt={backend.buildStartedAt}
                    />
                  ) : previewSessionReady ? <iframe
                    ref={iframeRef}
                    key={`edge-preview-${activeProjectId}-${edgeRefreshCounter}`}
                    src={`/preview/${activeProjectId}/index.html`}
                    sandbox={PREVIEW_SANDBOX}
                    allow={PREVIEW_ALLOW}
                    onLoad={handlePreviewIframeLoad}
                    onError={() => {
                      // During generation the file set is partial — Vite HMR errors are expected.
                      // Skip status changes here; the generation flow handles final error state.
                      if (generationActiveRef.current) return;
                      const message = 'The preview failed to load.';
                      setPreviewIssue({ error: message, plainExplanation: 'Your app could not be loaded in the preview. The builder can try to fix this.', file: '', layer: isFullStackProject(files) ? 'backend' : 'frontend' });
                      setStatus('Error');
                      setPreviewStatus(activeProjectId, 'Error');
                      markPreviewState('error', message);
                    }}
                    style={{ width: '100%', height: '100%', border: 'none', display: 'block', background: 'var(--bg-card)' }}
                    title="Application Preview"
                  /> : <div className="studio-session-loading" role="status">Connecting your preview…</div>}
              </PreviewCanvas>
              {hasGeneratedApp && previewIssue && status !== 'Generating' && <div className="preview-health-strip has-error" role="status">{autoFixing ? <Loader2 size={15} className="lucide-spin" /> : <AlertCircle size={15} />}<span title={sanitizeErrorForDisplay(previewIssue.error).slice(0, 500)}>{autoFixing ? 'Auto-fixing…' : previewIssue.plainExplanation}</span>{!autoFixing && <button onClick={() => appEvents.emit('auto-fix-error', { ...previewIssue, projectId: activeProjectId })}>Fix</button>}{!autoFixing && undoCheckpoint && <button disabled={undoLoading} onClick={quickUndo}>{undoLoading ? 'Reverting…' : 'Revert'}</button>}{!autoFixing && <button onClick={() => { openChat(); appEvents.emit('screenshot-fix-request', { projectId: activeProjectId }); }} title="Fix with screenshot"><Camera size={13} /></button>}</div>}
              {hasGeneratedApp && status === 'Generating' && previewLoadState !== 'error' && <div className="preview-building-pill" role="status"><Loader2 size={13} className="lucide-spin" /><span>{generationMode === 'incremental' ? 'Editing your app — targeted changes in progress.' : 'Building your app — the preview refreshes when it\'s ready.'}</span></div>}
              {hasGeneratedApp && !previewIssue && <PreviewStoreCappedBanner reason={previewCapReason} />}

            </div>
          </div>
        )}
      </div>

      <footer className="studio-workspace-footer">
        <div className="studio-build-meta" aria-label="Build information">
        <span>
          <FolderCode size={12} />
          {(() => {
            const progressKeys = Object.keys(fileProgress);
            const allPaths = [...new Set([...progressKeys, ...Object.keys(files)])];
            const total = allPaths.length;
            const saved = allPaths.filter(p => fileProgress[p] === 'saved' || (!progressKeys.includes(p) && fileProgress[p] !== 'writing')).length;
            return status === 'Generating' && total > 0 ? `${saved} of ${total} files written` : `${total} files`;
          })()}
        </span>
        {wcEnabled && <button type="button" onClick={() => selectTab('terminal')} aria-pressed={resolvedActiveTab === 'terminal'}><Terminal size={14} />Terminal</button>}
        <button type="button" onClick={() => selectTab('console')} aria-pressed={resolvedActiveTab === 'console'}><Settings size={14} />Console</button><button type="button" onClick={() => selectTab('logs')} aria-pressed={resolvedActiveTab === 'logs'}><ListFilter size={14} />Activity</button>
        </div>
      </footer>

      {/* GitHub export modal */}
      {github.modalElement}


    </div>
  );
};

/** True when the project is open read-only (ownership was denied). Guards both
 *  the Monaco editor option and the commit path so a read-only project can
 *  never accept or persist edits. */
export function isReadOnlyProjectView(readOnlyProjectId: string | null, activeProjectId: string): boolean {
  return readOnlyProjectId !== null && readOnlyProjectId === activeProjectId;
}

export default Workspace;
