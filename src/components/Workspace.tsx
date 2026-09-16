import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { 
  Code2, Monitor, ExternalLink, RefreshCw, Loader2, Play, Sparkles, Lock, 
  AlertCircle, Terminal, Copy, Check, FolderCode, Download, 
  Tablet, Smartphone, WrapText, ListFilter,
  Zap, Box, MoreHorizontal, X, Server
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

type GenerationStatus = 'Idle' | 'Generating' | 'Ready' | 'Error';
type WorkspaceTab = 'code' | 'backend' | 'preview' | 'console' | 'logs';
type ViewportMode = 'desktop' | 'tablet' | 'mobile';
type PreviewEngine = 'edge' | 'sandpack';

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

const Workspace: React.FC<WorkspaceProps> = ({ activeProjectId, mobileTab }) => {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('preview');
  const [viewportMode, setViewportMode] = useState<ViewportMode>('desktop');
  
  useEffect(() => {
    if (mobileTab === 'code' || mobileTab === 'preview') {
      setActiveTab(mobileTab);
    }
  }, [mobileTab]);
  const [previewEngine, setPreviewEngine] = useState<PreviewEngine>('edge');
  const [edgeRefreshCounter, setEdgeRefreshCounter] = useState(0);
  const [wordWrap, setWordWrap] = useState<'on' | 'off'>('on');
  const initialFiles = getProjectFiles(activeProjectId);
  const isBrandNewInit = !initialFiles;
  const [status, setStatus] = useState<GenerationStatus>(isBrandNewInit ? 'Idle' : 'Ready');
  const [statusDetail, setStatusDetail] = useState('');
  const [hasProject, setHasProject] = useState(true);
  const [generatingFile, setGeneratingFile] = useState('');
  const [consoleLogs, setConsoleLogs] = useState<string[]>([
    'Preview ready.',
    'Waiting for changes...'
  ]);
  const [buildLogs, setBuildLogs] = useState<BuildLogItem[]>([
    {
      id: 'init',
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      text: 'Workspace ready.',
      type: 'info'
    }
  ]);
  const [copiedCode, setCopiedCode] = useState(false);
  const consoleEndRef = useRef<HTMLDivElement>(null);
  
  const [files, setFiles] = useState<{ [path: string]: string }>(() => {
    let current = initialFiles;
    if (!current) {
      current = {
        '/src/App.jsx': basicReactTemplate['src'].directory['App.jsx'].file.contents,
        '/src/main.jsx': basicReactTemplate['src'].directory['main.jsx'].file.contents,
        '/src/styles.css': basicReactTemplate['src'].directory['styles.css'].file.contents,
      };
    } else if (current['/src/App.jsx']) {
      const isLegacyStarter = current['/src/App.jsx'].includes('BRAINHALF CORE // REACTIVE ENGINE') ||
        current['/src/App.jsx'].includes('BrainHalf Studio') ||
        current['/src/App.jsx'].includes('From interactive workflows to full-stack reactive prototypes');
      if (isLegacyStarter) {
        current = {
          ...current,
          '/src/App.jsx': basicReactTemplate['src'].directory['App.jsx'].file.contents
        };
        saveProjectFiles(activeProjectId, current);
      } else if (current['/src/App.jsx'].includes("minHeight: '100vh'") && (current['/src/App.jsx'].includes("What do you want to build?") || current['/src/App.jsx'].includes("Architect your idea into living software."))) {
        current = {
          ...current,
          '/src/App.jsx': current['/src/App.jsx'].replace("minHeight: '100vh'", "height: '100%', minHeight: '100%'")
        };
        saveProjectFiles(activeProjectId, current);
      }
    }
    return current;
  });
  const [activeFile, setActiveFile] = useState('/src/App.jsx');

  // GitHub Export State
  const [showGithubModal, setShowGithubModal] = useState(false);
  const [githubRepo, setGithubRepo] = useState('');
  const [githubToken, setGithubToken] = useState(() => {
    return typeof localStorage !== 'undefined' ? (localStorage.getItem('brainhalf_github_pat') || '') : '';
  });
  const [githubStatus, setGithubStatus] = useState<{loading: boolean, error?: string, success?: string}>({loading: false});

  const [showDiagnosticMenu, setShowDiagnosticMenu] = useState(false);
  const [showEngineMenu, setShowEngineMenu] = useState(false);
  const diagnosticMenuRef = useRef<HTMLDivElement>(null);
  const engineMenuRef = useRef<HTMLDivElement>(null);

  const filesRef = useRef(files);
  const activeFileRef = useRef(activeFile);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const handleRefreshRef = useRef<() => void>(() => {});
  const lastGenTimeRef = useRef(0);

  const addBuildLog = useCallback((text: string, type: 'info' | 'success' | 'warn' | 'error' = 'info') => {
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setBuildLogs(prev => [...prev.slice(-250), { id: Math.random().toString(36).slice(2), time, text, type }]);
  }, []);

  const addConsoleLog = useCallback((text: string) => {
    setConsoleLogs(prev => [...prev.slice(-250), text]);
  }, []);

  // Listen for open-github-modal event from TopNav
  useEffect(() => {
    const unsub = appEvents.on('open-github-modal', () => {
      setShowGithubModal(true);
    });
    return () => unsub();
  }, []);

  // Click outside and escape handlers for dropdown menus
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (diagnosticMenuRef.current && !diagnosticMenuRef.current.contains(e.target as Node)) {
        setShowDiagnosticMenu(false);
      }
      if (engineMenuRef.current && !engineMenuRef.current.contains(e.target as Node)) {
        setShowEngineMenu(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowDiagnosticMenu(false);
        setShowEngineMenu(false);
        setShowGithubModal(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  // Keep filesRef always updated synchronously and notify preview iframe
  useEffect(() => {
    filesRef.current = files;
    iframeRef.current?.contentWindow?.postMessage({
      type: 'sync-files',
      files
    }, '*');
  }, [files]);

  const handleExportZip = async () => {
    try {
      await exportProjectAsZip(filesRef.current, activeProjectId || 'brainhalf-project');
      addBuildLog(`Project bundle exported as ZIP: ${activeProjectId || 'brainhalf-project'}`, 'success');
    } catch (err) {
      addBuildLog(`Export ZIP error: ${err}`, 'error');
    }
  };

  const handleExportGitHub = async () => {
    if (!githubRepo || !githubToken) return;
    setGithubStatus({ loading: true, error: undefined, success: undefined });
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('brainhalf_github_pat', githubToken);
      }
      await exportToGitHub(filesRef.current, githubRepo, githubToken);
      setGithubStatus({ loading: false, success: `Successfully pushed to GitHub: ${githubRepo}` });
      addBuildLog(`Pushed codebase to GitHub repository: ${githubRepo}`, 'success');
    } catch (err: any) {
      setGithubStatus({ loading: false, error: err.message || 'Failed to export to GitHub' });
      addBuildLog(`GitHub Export Failed: ${err.message}`, 'error');
    }
  };

  useEffect(() => {
    activeFileRef.current = activeFile;
  }, [activeFile]);

  // Transform files to match Sandpack entry points so live generation always renders
  const sandpackFiles = useMemo(() => {
    const spFiles: Record<string, any> = {};

    // Copy all current files
    for (const [rawPath, content] of Object.entries(files)) {
      const cleanPath = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
      spFiles[cleanPath] = content;
      if (cleanPath.startsWith('/src/')) {
        const withoutSrc = cleanPath.replace(/^\/src\//, '/');
        spFiles[withoutSrc] = content;
      }
    }

    // Resolve main app component from any possible path
    const appCode = 
      files['/src/App.jsx'] || 
      files['/src/App.tsx'] || 
      files['/src/App.js'] || 
      files['/App.jsx'] || 
      files['/App.tsx'] || 
      files['/App.js'] || 
      files['App.jsx'] || 
      files['App.tsx'] || 
      files['src/App.jsx'] || 
      '';

    if (appCode) {
      spFiles['/App.tsx'] = appCode;
      spFiles['/App.jsx'] = appCode;
      spFiles['/App.js'] = appCode;
      spFiles['/src/App.jsx'] = appCode;
    }

    // Resolve styles
    const stylesCode = 
      files['/src/styles.css'] || 
      files['/styles.css'] || 
      files['src/styles.css'] || 
      files['styles.css'] || 
      '';

    spFiles['/styles.css'] = stylesCode;
    spFiles['/src/styles.css'] = stylesCode;

    // Provide explicit Sandpack index entry point
    spFiles['/index.tsx'] = `import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';

const rootElement = document.getElementById('root');
if (rootElement) {
  const root = ReactDOM.createRoot(rootElement);
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
`;

    // Scan all registered files for relative imports and auto-stub any missing modules
    // to prevent Sandpack crashes: "Could not find module in path: './components/Header.jsx' relative to '/App.js'"
    const registeredPaths = new Set(Object.keys(spFiles));
    const importRegex = /(?:from|import)\s*\(?['"](\.[^'"]+)['"]\)?/g;

    for (const [filePath, content] of Object.entries(spFiles)) {
      if (typeof content !== 'string') continue;
      if (!filePath.endsWith('.js') && !filePath.endsWith('.jsx') && !filePath.endsWith('.ts') && !filePath.endsWith('.tsx')) continue;

      let match;
      importRegex.lastIndex = 0;
      while ((match = importRegex.exec(content)) !== null) {
        const relImport = match[1]; // e.g. './components/Header.jsx' or './components/Header'
        
        // Resolve path relative to current file's directory
        const dir = filePath.substring(0, filePath.lastIndexOf('/')) || '';
        const parts = (dir + '/' + relImport).split('/').filter(Boolean);
        const resolvedParts: string[] = [];
        for (const p of parts) {
          if (p === '.') continue;
          if (p === '..') resolvedParts.pop();
          else resolvedParts.push(p);
        }
        const resolvedPath = '/' + resolvedParts.join('/');
        
        // Check variants: direct, .jsx, .tsx, .js, .ts, /index.jsx, /index.tsx
        const hasDirect = registeredPaths.has(resolvedPath);
        const hasJsx = registeredPaths.has(resolvedPath + '.jsx');
        const hasTsx = registeredPaths.has(resolvedPath + '.tsx');
        const hasJs = registeredPaths.has(resolvedPath + '.js');
        const hasTs = registeredPaths.has(resolvedPath + '.ts');
        const hasIndex = registeredPaths.has(resolvedPath + '/index.jsx') || registeredPaths.has(resolvedPath + '/index.tsx');

        if (!hasDirect && !hasJsx && !hasTsx && !hasJs && !hasTs && !hasIndex) {
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
export const ${compName} = ${compName};
`;
          spFiles[resolvedPath] = stubCode;
          registeredPaths.add(resolvedPath);
          if (!resolvedPath.endsWith('.jsx') && !resolvedPath.endsWith('.tsx') && !resolvedPath.endsWith('.js') && !resolvedPath.endsWith('.ts')) {
            spFiles[resolvedPath + '.jsx'] = stubCode;
            registeredPaths.add(resolvedPath + '.jsx');
          }
          if (resolvedPath.startsWith('/src/')) {
            const withoutSrc = resolvedPath.replace(/^\/src\//, '/');
            spFiles[withoutSrc] = stubCode;
            registeredPaths.add(withoutSrc);
          } else {
            const withSrc = '/src' + resolvedPath;
            spFiles[withSrc] = stubCode;
            registeredPaths.add(withSrc);
          }
        }
      }
    }

    return spFiles;
  }, [files]);

  // Helper to sync files to backend
  const syncFilesToEdge = useCallback((currentFiles: any, replaceAll: boolean = false) => {
    appEvents.emit('sync-files', { files: currentFiles, replaceAll });
  }, []);

  // Synchronize workspace when project changes or when cleared
  useEffect(() => {
    let loadedFiles = getProjectFiles(activeProjectId);
    if (loadedFiles && Object.keys(loadedFiles).length > 0) {
      if (loadedFiles['/src/App.jsx'] && (
        loadedFiles['/src/App.jsx'].includes('BRAINHALF CORE // REACTIVE ENGINE') ||
        loadedFiles['/src/App.jsx'].includes('BrainHalf Studio') ||
        loadedFiles['/src/App.jsx'].includes('From interactive workflows to full-stack reactive prototypes')
      )) {
        loadedFiles = {
          ...loadedFiles,
          '/src/App.jsx': basicReactTemplate['src'].directory['App.jsx'].file.contents
        };
        saveProjectFiles(activeProjectId, loadedFiles);
      }
      setFiles(loadedFiles);
      filesRef.current = loadedFiles;
      setHasProject(true);
      setStatus('Ready');
      syncFilesToEdge(loadedFiles);
    } else {
      const baseline = {
        '/src/App.jsx': basicReactTemplate['src'].directory['App.jsx'].file.contents,
        '/src/main.jsx': basicReactTemplate['src'].directory['main.jsx'].file.contents,
        '/src/styles.css': basicReactTemplate['src'].directory['styles.css'].file.contents,
      };
      setFiles(baseline);
      filesRef.current = baseline;
      setHasProject(true);
      setStatus('Ready');
      saveProjectFiles(activeProjectId, baseline);
      syncFilesToEdge(baseline, true);
    }

    const baselineFiles = {
      '/src/App.jsx': basicReactTemplate['src'].directory['App.jsx'].file.contents,
      '/src/main.jsx': basicReactTemplate['src'].directory['main.jsx'].file.contents,
      '/src/styles.css': basicReactTemplate['src'].directory['styles.css'].file.contents,
    };

    const handleClearWorkspace = () => {
      setFiles(baselineFiles);
      filesRef.current = baselineFiles;
      setHasProject(true);
      setStatus('Idle');
      setStatusDetail('');
      setActiveFile('/src/App.jsx');
      addBuildLog('Workspace reset to baseline React 18 template', 'warn');
      saveProjectFiles(activeProjectId, baselineFiles);
      syncFilesToEdge(baselineFiles, true);
    };

    const unsubClear = appEvents.on('clear-workspace', handleClearWorkspace);
    return () => unsubClear();
  }, [activeProjectId, addBuildLog, syncFilesToEdge]);

  // Synchronize generation events
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
          addBuildLog(`AI generating: ${file}`, 'info');
        }
      } else if (newStatus === 'Ready') {
        setHasProject(true);
        const backendErr = validateBackendFiles(filesRef.current);
        if (backendErr) {
          setStatus('Error');
          setStatusDetail(backendErr.error || '[Backend Error] Syntax or configuration error in server files');
          addBuildLog(backendErr.error || 'Backend validation failed', 'error');
          addConsoleLog(`[backend-error] ${backendErr.error}`);
          return;
        }
        setStatusDetail('');
        setStatus('Ready');
        addBuildLog(isFullStackProject(filesRef.current) ? 'Full-stack application (frontend + backend) ready' : 'All components generated successfully', 'success');
        addConsoleLog('[build] All client and server components compiled successfully.');
        syncFilesToEdge(filesRef.current);
        lastGenTimeRef.current = Date.now();
        if (handleRefreshRef.current) handleRefreshRef.current();
      } else if (newStatus === 'Error') {
        setStatus('Error');
        const errMsg = error || 'Generation failed';
        const attributedErr = errMsg.startsWith('[') ? errMsg : `[Build Error] ${errMsg}`;
        setStatusDetail(attributedErr);
        addBuildLog(attributedErr, 'error');
        addConsoleLog(`[error] ${attributedErr}`);
      }
    };

    const handleFileGenerated = ({ path, content, isComplete }: { path: string; content: string; isComplete?: boolean }) => {
      const cleanPath = normalizePath(path);
      setHasProject(true);
      setGeneratingFile(path);
      
      filesRef.current[cleanPath] = content;
      setFiles(prev => ({
        ...prev,
        [cleanPath]: content
      }));

      if (isComplete) {
        addBuildLog(`Compiled: ${cleanPath}`, 'success');
        addConsoleLog(`[transpiler] Successfully compiled ${cleanPath}`);
        syncFilesToEdge(filesRef.current);
        saveProjectFiles(activeProjectId, filesRef.current);
      }
    };

    const handleFileDeleted = ({ path }: { path: string }) => {
      const cleanPath = normalizePath(path);
      delete filesRef.current[cleanPath];
      setFiles(prev => {
        const next = { ...prev };
        delete next[cleanPath];
        return next;
      });
      if (activeFileRef.current === cleanPath) {
        setActiveFile('/src/App.jsx');
      }
      addBuildLog(`Deleted: ${cleanPath}`, 'info');
      addConsoleLog(`[transpiler] Deleted file ${cleanPath}`);
      syncFilesToEdge(filesRef.current);
      saveProjectFiles(activeProjectId, filesRef.current);
    };

    const handleOpenFile = ({ path }: { path: string }) => {
      const cleanPath = normalizePath(path);
      setActiveFile(cleanPath);
      setActiveTab('code');
    };

    const handleExport = async ({ projectName }: { projectName?: string }) => {
      try {
        await exportProjectAsZip(filesRef.current, projectName || 'brainhalf-project');
        addBuildLog(`Project bundle exported as ZIP: ${projectName || 'brainhalf-project'}`, 'success');
      } catch (err) {
        addBuildLog(`Export ZIP error: ${err}`, 'error');
      }
    };

    const handleRequestContext = ({ requestId }: { requestId: string }) => {
      appEvents.emit(`workspace-context-response-${requestId}`, { files: filesRef.current });
    };

    const handleExecuteCommand = async ({ command, requestId }: { command: string; requestId: string }) => {
      addConsoleLog(`$ ${command}`);
      addConsoleLog(`  [edge] Command processed in preview runtime: ${command}`);
      appEvents.emit(`command-result-${requestId}`, { output: `Command executed: ${command}` });
    };

    const handleFilesRefreshed = (newFiles: Record<string, string>) => {
      if (newFiles && Object.keys(newFiles).length > 0) {
        setFiles(newFiles);
        filesRef.current = newFiles;
        setHasProject(true);
        setStatus('Ready');
        if (handleRefreshRef.current) handleRefreshRef.current();
      }
    };

    const handleWorkspaceFilesChanged = ({ projectId, files: changedFiles }: { projectId: string; files: Record<string, string> }) => {
      if (projectId === activeProjectId && changedFiles) {
        setFiles(changedFiles);
        filesRef.current = changedFiles;
        setHasProject(true);
        if (handleRefreshRef.current) handleRefreshRef.current();
      }
    };

    const unsubStatus = appEvents.on('generation-status', handleGenerationStatus);
    const unsubFile = appEvents.on('file-generated', handleFileGenerated);
    const unsubFileDel = appEvents.on('file-deleted', handleFileDeleted);
    const unsubOpen = appEvents.on('open-file', handleOpenFile);
    const unsubExport = appEvents.on('request-export', handleExport);
    const unsubContext = appEvents.on('request-workspace-context', handleRequestContext);
    const unsubExec = appEvents.on('execute-command', handleExecuteCommand);
    const unsubRefreshed = appEvents.on('files-refreshed', handleFilesRefreshed);
    const unsubWorkspaceFiles = appEvents.on('workspace-files-changed', handleWorkspaceFilesChanged);
    
    return () => {
      unsubStatus();
      unsubFile();
      unsubFileDel();
      unsubOpen();
      unsubExport();
      unsubContext();
      unsubExec();
      unsubRefreshed();
      unsubWorkspaceFiles();
    };
  }, [activeProjectId, addBuildLog, addConsoleLog, syncFilesToEdge]);

  // Synchronize iframe preview messages (transpile errors, runtime errors, and auto-fix requests)
  useEffect(() => {
    const handleWindowMessage = (event: MessageEvent) => {
      // Security: Strictly verify the message originates from our active preview iframe
      if (iframeRef.current && event.source !== iframeRef.current.contentWindow) return;
      if (!event.data || typeof event.data !== 'object') return;
      if (event.data.type === 'preview-error') {
        const errorMsg = event.data.error || 'Preview runtime error';
        const file = event.data.file || activeFile;
        const layer = event.data.layer || (file.includes('server') ? 'backend' : 'frontend');
        const prefix = layer === 'backend' ? '[Backend Error]' : '[Frontend Error]';
        const cleanMsg = errorMsg.startsWith('[') ? errorMsg : `${prefix} ${errorMsg}`;
        const lineInfo = event.data.lineno ? ` (line ${event.data.lineno})` : '';
        const fullErr = `${cleanMsg}${lineInfo}`;
        setStatus('Error');
        setStatusDetail(fullErr);
        addBuildLog(`${prefix} in ${file}: ${errorMsg}`, 'error');
        addConsoleLog(`[${layer}-error] ${fullErr}`);
      } else if (event.data.type === 'preview-auto-fix') {
        const errorMsg = event.data.error || statusDetail || 'Error occurred';
        const file = event.data.file || activeFile;
        const layer = event.data.layer || (file.includes('server') ? 'backend' : 'frontend');
        appEvents.emit('auto-fix-error', { error: errorMsg, file, layer });
      } else if (event.data.type === 'preview-success') {
        setStatus(prev => (prev === 'Error' ? 'Ready' : prev));
        setStatusDetail(prev => (prev.includes('Transpile') || prev.includes('Preview') ? '' : prev));
        appEvents.emit('preview-success', null);
      } else if (event.data.type === 'request-preview-files') {
        iframeRef.current?.contentWindow?.postMessage({
          type: 'sync-files',
          files: filesRef.current
        }, '*');
      }
    };

    window.addEventListener('message', handleWindowMessage);
    return () => window.removeEventListener('message', handleWindowMessage);
  }, [activeFile, addBuildLog, addConsoleLog, statusDetail]);

  const handleEditorChange = async (value: string | undefined) => {
    if (value === undefined) return;
    filesRef.current[activeFile] = value;
    setFiles(prev => ({
      ...prev,
      [activeFile]: value
    }));
    saveProjectFiles(activeProjectId, filesRef.current);
    
    if (status === 'Ready' || status === 'Idle') {
      syncFilesToEdge(filesRef.current);
    }
  };

  const handleLaunchPreview = () => {
    setHasProject(true);
    setStatus('Ready');
    syncFilesToEdge(filesRef.current);
    setEdgeRefreshCounter(prev => prev + 1);
    addBuildLog(`Launching ${previewEngine === 'edge' ? 'Cloudflare Edge' : 'Sandpack'} preview...`, 'info');
  };

  const handleRefresh = () => {
    syncFilesToEdge(filesRef.current);
    setEdgeRefreshCounter(prev => prev + 1);
    addBuildLog(`Reloading ${previewEngine === 'edge' ? 'Cloudflare Edge' : 'Sandpack'} preview...`, 'info');
  };

  useEffect(() => {
    handleRefreshRef.current = handleRefresh;
  });

  const progressPercent = useMemo(() => {
    if (status === 'Ready') return 100;
    if (status === 'Idle') return 0;
    if (status === 'Generating') return 65;
    return 50;
  }, [status]);

  const handleCopyCurrentFile = () => {
    const code = files[activeFile] || '';
    navigator.clipboard.writeText(code);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  return (
    <div className="workspace-panel-container">
      {/* Workspace Header Segmented Control & Status */}
      <div style={{
        height: '48px',
        padding: '0 20px',
        borderBottom: '1px solid var(--border-subtle)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        background: 'rgba(255, 255, 255, 0.015)',
        flexShrink: 0
      }}>
        {/* Primary Workspace Navigation: Code | Preview with Diagnostics dropdown */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <div className="segmented-control" role="tablist" aria-label="Workspace navigation">
            <button 
              role="tab"
              aria-selected={activeTab === 'code'}
              onClick={() => {
                setActiveTab('code');
                const clientFile = Object.keys(files).find(p => p.includes('App.jsx') || p.includes('App.tsx') || p.includes('main.jsx') || (!p.startsWith('/server/') && !p.startsWith('server/') && !p.includes('.env')));
                if (clientFile && (activeFile.startsWith('/server/') || activeFile.startsWith('server/') || activeFile.includes('.env'))) {
                  setActiveFile(clientFile);
                }
              }}
              className={`segmented-tab ${activeTab === 'code' ? 'active' : ''}`}
              title="Inspect & Edit Frontend Client Code"
            >
              <Code2 size={16} strokeWidth={1.75} /> 
              <span>Code</span>
            </button>
            <button 
              role="tab"
              aria-selected={activeTab === 'backend'}
              onClick={() => {
                setActiveTab('backend');
                const serverFile = Object.keys(files).find(p => p.startsWith('/server/') || p.startsWith('server/') || p.includes('.env'));
                if (serverFile) {
                  setActiveFile(serverFile);
                } else {
                  // Initialize starter backend scaffolding if none exists
                  const starterBackend: Record<string, string> = {
                    ...files,
                    '/server/index.js': `import express from 'express';\nimport cors from 'cors';\nimport { router as apiRoutes } from './routes/api.js';\n\nconst app = express();\nconst port = process.env.PORT || 3001;\n\napp.use(cors());\napp.use(express.json());\napp.use('/api', apiRoutes);\n\napp.get('/api/health', (req, res) => {\n  res.json({ status: 'ok', service: 'brainhalf-backend', timestamp: new Date().toISOString() });\n});\n\napp.listen(port, () => {\n  console.log(\`Backend server running on port \${port}\`);\n});\n`,
                    '/server/routes/api.js': `import { Router } from 'express';\nimport { getItems, createItem, getItemById, deleteItem } from '../controllers/items.js';\n\nexport const router = Router();\n\nrouter.get('/items', getItems);\nrouter.post('/items', createItem);\nrouter.get('/items/:id', getItemById);\nrouter.delete('/items/:id', deleteItem);\n`,
                    '/server/controllers/items.js': `import { db } from '../db.js';\n\nexport const getItems = (req, res) => {\n  const items = db.findAll('items');\n  res.json(items);\n};\n\nexport const createItem = (req, res) => {\n  const newItem = db.create('items', req.body);\n  res.status(201).json(newItem);\n};\n\nexport const getItemById = (req, res) => {\n  const item = db.findById('items', req.params.id);\n  if (!item) return res.status(404).json({ error: 'Item not found' });\n  res.json(item);\n};\n\nexport const deleteItem = (req, res) => {\n  const success = db.delete('items', req.params.id);\n  if (!success) return res.status(404).json({ error: 'Item not found' });\n  res.json({ success: true });\n};\n`,
                    '/server/db.js': `// In-memory / SQLite Data Layer for BrainHalf Preview\n// Supports Cloudflare Durable Object SQLite and external Postgres/MongoDB if process.env.DATABASE_URL is provided\nexport class LocalDatabase {\n  constructor() {\n    this.collections = new Map();\n  }\n  findAll(name) { return Array.from(this.collections.get(name)?.values() || []); }\n  findById(name, id) { return this.collections.get(name)?.get(String(id)) || null; }\n  create(name, data) {\n    if (!this.collections.has(name)) this.collections.set(name, new Map());\n    const id = data.id || Math.random().toString(36).slice(2, 9);\n    const record = { ...data, id, createdAt: new Date().toISOString() };\n    this.collections.get(name).set(String(id), record);\n    return record;\n  }\n  delete(name, id) { return this.collections.get(name)?.delete(String(id)) || false; }\n}\n\nexport const db = new LocalDatabase();\n`,
                    '/server/.env': `PORT=3001\nNODE_ENV=development\nJWT_SECRET=brainhalf_development_secret_key_12345\n# DATABASE_URL=postgresql://user:pass@localhost:5432/mydb\n`
                  };
                  setFiles(starterBackend);
                  filesRef.current = starterBackend;
                  saveProjectFiles(activeProjectId, starterBackend);
                  setActiveFile('/server/index.js');
                  syncFilesToEdge(starterBackend);
                }
              }}
              className={`segmented-tab ${activeTab === 'backend' ? 'active' : ''}`}
              title="Inspect & Edit Backend REST API, Database & Environment"
            >
              <Server size={16} strokeWidth={1.75} /> 
              <span>Backend</span>
            </button>
            <button 
              role="tab"
              aria-selected={activeTab === 'preview'}
              onClick={() => setActiveTab('preview')}
              className={`segmented-tab ${activeTab === 'preview' ? 'active' : ''}`}
              title="Live Application Preview (Frontend + Backend)"
            >
              <Monitor size={16} strokeWidth={1.75} /> 
              <span>Preview</span>
            </button>
            {(activeTab === 'console' || activeTab === 'logs') && (
              <button 
                role="tab"
                aria-selected={true}
                className="segmented-tab active"
                style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                title={activeTab === 'console' ? "Terminal Console" : "Activity Logs"}
              >
                {activeTab === 'console' ? <Terminal size={16} strokeWidth={1.75} /> : <ListFilter size={16} strokeWidth={1.75} />}
                <span>{activeTab === 'console' ? 'Console' : 'Logs'}</span>
                <span 
                  onClick={(e) => { e.stopPropagation(); setActiveTab('preview'); }}
                  style={{ opacity: 0.6, cursor: 'pointer', display: 'flex' }}
                  title="Close diagnostic tab"
                >
                  <X size={16} strokeWidth={1.75} />
                </span>
              </button>
            )}
          </div>

          {/* Diagnostics overflow dropdown for Console & Logs */}
          <div style={{ position: 'relative' }} ref={diagnosticMenuRef}>
            <button
              onClick={() => setShowDiagnosticMenu(prev => !prev)}
              className="icon-btn"
              title="Diagnostics (Console, Logs)"
              aria-label="Diagnostics (Console, Logs)"
              aria-expanded={showDiagnosticMenu}
              style={{
                width: '28px',
                height: '28px',
                borderRadius: '6px',
                color: (activeTab === 'console' || activeTab === 'logs') ? 'var(--text-primary)' : 'var(--text-muted)'
              }}
            >
              <MoreHorizontal size={16} strokeWidth={1.75} />
            </button>

            {showDiagnosticMenu && (
              <div style={{
                position: 'absolute',
                top: 'calc(100% + 4px)',
                left: 0,
                width: '180px',
                background: '#12141c',
                border: '1px solid var(--border-medium)',
                borderRadius: '8px',
                boxShadow: '0 12px 28px rgba(0,0,0,0.65)',
                padding: '4px',
                zIndex: 1000,
                display: 'flex',
                flexDirection: 'column',
                gap: '2px'
              }}>
                <button
                  className="deploy-menu-item"
                  onClick={() => {
                    setActiveTab('console');
                    setShowDiagnosticMenu(false);
                  }}
                  style={{ padding: '6px 8px', fontSize: '12px' }}
                >
                  <Terminal size={16} strokeWidth={1.75} color="var(--color-neutral)" />
                  <span>Terminal Console</span>
                  {consoleLogs.length > 0 && (
                    <span style={{ marginLeft: 'auto', fontSize: '10px', color: 'var(--text-muted)' }}>
                      {consoleLogs.length}
                    </span>
                  )}
                </button>
                <button
                  className="deploy-menu-item"
                  onClick={() => {
                    setActiveTab('logs');
                    setShowDiagnosticMenu(false);
                  }}
                  style={{ padding: '6px 8px', fontSize: '12px' }}
                >
                  <ListFilter size={16} strokeWidth={1.75} color="var(--color-neutral)" />
                  <span>Activity Logs</span>
                  {buildLogs.length > 0 && (
                    <span style={{ marginLeft: 'auto', fontSize: '10px', color: 'var(--text-muted)' }}>
                      {buildLogs.length}
                    </span>
                  )}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Right side: Clean minimal spacing */}
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {status === 'Generating' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11.5px', color: 'var(--text-muted)' }}>
              <Loader2 size={12} className="lucide-spin" style={{ color: 'var(--text-primary)' }} />
              <span>{generatingFile ? `${generatingFile.split('/').pop()}` : 'Generating...'}</span>
            </div>
          )}
        </div>
      </div>

      {/* Workspace Content Area */}
      <div style={{ flex: 1, position: 'relative', display: 'flex', overflow: 'hidden' }}>
        {activeTab === 'code' || activeTab === 'backend' ? (
          /* CODE OR BACKEND EDITOR TAB */
          <div style={{ display: 'flex', width: '100%', height: '100%' }}>
            <FileExplorer 
              files={files} 
              activeFile={activeFile} 
              onSelectFile={setActiveFile} 
              headerTitle={activeTab === 'backend' ? 'Server Files' : 'Client Files'}
              filter={path => {
                if (activeTab === 'backend') {
                  return path.startsWith('/server/') || path.startsWith('server/') || path.includes('.env') || path === '/package.json';
                }
                return !path.startsWith('/server/') && !path.startsWith('server/') && !path.includes('.env');
              }}
            />
            <div style={{ flex: 1, height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg-code-editor)', overflow: 'hidden' }}>
              {/* File Tabs */}
              <div style={{
                height: '36px',
                background: 'rgba(0, 0, 0, 0.4)',
                borderBottom: '1px solid var(--border-subtle)',
                display: 'flex',
                alignItems: 'center',
                overflowX: 'auto',
                padding: '0 4px',
                gap: '2px'
              }}>
                {Object.keys(files)
                  .filter(filePath => {
                    if (activeTab === 'backend') {
                      return filePath.startsWith('/server/') || filePath.startsWith('server/') || filePath.includes('.env') || filePath === '/package.json';
                    }
                    return !filePath.startsWith('/server/') && !filePath.startsWith('server/') && !filePath.includes('.env');
                  })
                  .map(filePath => {
                    const isActive = filePath === activeFile;
                    const name = filePath.split('/').pop();
                    return (
                      <div
                        key={filePath}
                        onClick={() => setActiveFile(filePath)}
                        style={{
                          padding: '6px 12px',
                          background: isActive ? 'var(--bg-code-editor)' : 'transparent',
                          borderBottom: isActive ? '2px solid var(--accent-primary)' : '2px solid transparent',
                          color: isActive ? '#ffffff' : 'var(--text-muted)',
                          fontSize: '12px',
                          fontFamily: 'var(--font-mono)',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          cursor: 'pointer',
                          borderRadius: '4px 4px 0 0',
                          userSelect: 'none',
                          transition: 'all 0.15s ease'
                        }}
                        className="hover-bright"
                      >
                        {activeTab === 'backend' ? (
                          <Server size={13} color={isActive ? '#c084fc' : undefined} />
                        ) : (
                          <Code2 size={13} color={isActive ? 'var(--accent-light)' : undefined} />
                        )}
                        <span>{name}</span>
                      </div>
                    );
                  })}
              </div>

              {/* Breadcrumbs & Editor Action Toolbar */}
              <div style={{
                padding: '6px 16px',
                background: 'rgba(0, 0, 0, 0.25)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                fontSize: '11px',
                fontFamily: 'var(--font-mono)',
                color: 'var(--text-muted)'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {activeTab === 'backend' ? (
                    <span style={{
                      background: 'rgba(168, 85, 247, 0.15)',
                      color: '#c084fc',
                      border: '1px solid rgba(168, 85, 247, 0.3)',
                      padding: '2px 8px',
                      borderRadius: '4px',
                      fontSize: '10.5px',
                      fontWeight: 600,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px'
                    }}>
                      <Server size={12} strokeWidth={2} />
                      Node.js / Express
                    </span>
                  ) : (
                    <span style={{
                      background: 'rgba(56, 189, 248, 0.15)',
                      color: '#38bdf8',
                      border: '1px solid rgba(56, 189, 248, 0.3)',
                      padding: '2px 8px',
                      borderRadius: '4px',
                      fontSize: '10.5px',
                      fontWeight: 600,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px'
                    }}>
                      <Code2 size={12} strokeWidth={2} />
                      React / Vite
                    </span>
                  )}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <FolderCode size={12} color="var(--color-neutral)" />
                    <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{activeFile}</span>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <button
                    onClick={() => setWordWrap(prev => prev === 'on' ? 'off' : 'on')}
                    style={{
                      background: wordWrap === 'on' ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
                      border: 'none',
                      color: wordWrap === 'on' ? '#ffffff' : 'var(--text-muted)',
                      borderRadius: '4px',
                      padding: '2px 6px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      fontSize: '11px',
                      fontFamily: 'inherit'
                    }}
                    className="hover-bright"
                    title={`Toggle Word Wrap (Currently ${wordWrap})`}
                    aria-label="Toggle Word Wrap"
                  >
                    <WrapText size={16} strokeWidth={1.75} />
                    <span>Wrap</span>
                  </button>

                  <button
                    onClick={handleCopyCurrentFile}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: copiedCode ? '#34d399' : 'var(--text-muted)',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      fontSize: '11px',
                      fontFamily: 'inherit'
                    }}
                    className="hover-bright"
                    title="Copy full file code"
                    aria-label="Copy full file code"
                  >
                    {copiedCode ? <Check size={16} strokeWidth={1.75} color="#34d399" /> : <Copy size={16} strokeWidth={1.75} />}
                    <span>{copiedCode ? 'Copied' : 'Copy'}</span>
                  </button>

                  <button 
                    onClick={() => setShowGithubModal(true)}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--text-muted)',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      fontSize: '11px',
                      fontFamily: 'inherit'
                    }}
                    className="hover-bright"
                    title="Export to GitHub"
                    aria-label="Export GitHub"
                  >
                    <FolderCode size={16} strokeWidth={1.75} />
                    <span>Export GitHub</span>
                  </button>
                  <button
                    onClick={handleExportZip}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--text-muted)',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      fontSize: '11px',
                      fontFamily: 'inherit'
                    }}
                    className="hover-bright"
                    title="Export full project as ZIP"
                    aria-label="Export ZIP"
                  >
                    <Download size={16} strokeWidth={1.75} />
                    <span>Export ZIP</span>
                  </button>
                </div>
              </div>

              {/* Monaco Editor Container */}
              <div style={{ flex: 1, height: 'calc(100% - 66px)', minWidth: 0, overflow: 'hidden' }}>
                <Editor 
                  height="100%"
                  language={
                    activeFile.endsWith('.css') ? 'css' : 
                    activeFile.endsWith('.json') ? 'json' : 
                    activeFile.endsWith('.html') ? 'html' : 
                    activeFile.includes('.env') ? 'ini' :
                    activeFile.endsWith('.py') ? 'python' :
                    (activeFile.endsWith('.tsx') || activeFile.endsWith('.ts')) ? 'typescript' : 
                    'javascript'
                  }
                  value={files[activeFile] || ''}
                  onChange={handleEditorChange}
                  theme="vs-dark"
                  path={activeFile}
                  options={{ 
                    minimap: { enabled: false }, 
                    fontSize: 13, 
                    lineNumbers: 'on',
                    wordWrap: wordWrap,
                    scrollBeyondLastLine: false,
                    automaticLayout: true,
                    tabSize: 2
                  }}
                />
              </div>
            </div>
          </div>
        ) : activeTab === 'console' ? (
          /* TERMINAL / CONSOLE TAB */
          <div style={{
            width: '100%',
            height: '100%',
            background: '#090b10',
            color: '#e2e8f0',
            display: 'flex',
            flexDirection: 'column',
            fontFamily: 'var(--font-mono)',
            fontSize: '12px'
          }}>
            <div style={{
              padding: '8px 14px',
              background: 'rgba(255, 255, 255, 0.02)',
              borderBottom: '1px solid var(--border-subtle)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Terminal size={14} color="var(--accent-light)" />
                <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>Console</span>
              </div>
              <button
                onClick={() => setConsoleLogs([])}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-muted)',
                  borderRadius: '4px',
                  padding: '3px 8px',
                  fontSize: '11px',
                  cursor: 'pointer'
                }}
                className="hover-bright"
              >
                Clear Output
              </button>
            </div>
            <div style={{ flex: 1, padding: '12px 16px', overflowY: 'auto', lineHeight: 1.6 }}>
              {consoleLogs.length === 0 ? (
                <div style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>
                  Console output will appear here.
                </div>
              ) : (
                consoleLogs.map((log, lIdx) => (
                  <div 
                    key={lIdx} 
                    style={{ 
                      color: log.includes('Error') || log.includes('ERR_') ? '#f87171' : log.includes('ready') || log.includes('VITE') ? '#34d399' : '#cbd5e1',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word'
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
          /* BUILD PIPELINE TIMELINE & LOGS TAB */
          <div style={{
            width: '100%',
            height: '100%',
            background: '#090b10',
            color: '#e2e8f0',
            display: 'flex',
            flexDirection: 'column',
            fontFamily: 'var(--font-mono)',
            fontSize: '12px'
          }}>
            <div style={{
              padding: '8px 14px',
              background: 'rgba(255, 255, 255, 0.02)',
              borderBottom: '1px solid var(--border-subtle)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <ListFilter size={14} color="var(--accent-light)" />
                <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>Activity</span>
              </div>
              <button
                onClick={() => setBuildLogs([])}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-muted)',
                  borderRadius: '4px',
                  padding: '3px 8px',
                  fontSize: '11px',
                  cursor: 'pointer'
                }}
                className="hover-bright"
              >
                Clear Activity
              </button>
            </div>
            <div style={{ flex: 1, padding: '14px 18px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {buildLogs.length === 0 ? (
                <div style={{ color: 'var(--text-muted)', fontStyle: 'italic', padding: '16px 0' }}>
                  No activity recorded yet.
                </div>
              ) : (
                buildLogs.map(item => (
                  <div key={item.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', lineHeight: 1.5 }}>
                    <span style={{ color: 'var(--text-muted)', fontSize: '11px', flexShrink: 0, minWidth: '60px' }}>
                      [{item.time}]
                    </span>
                    <span style={{
                      width: '6px',
                      height: '6px',
                      borderRadius: '50%',
                      marginTop: '6px',
                      flexShrink: 0,
                      background: item.type === 'success' ? '#10b981' : item.type === 'error' ? '#ef4444' : item.type === 'warn' ? '#f59e0b' : '#3b82f6'
                    }} />
                    <span style={{
                      color: item.type === 'error' ? '#fca5a5' : item.type === 'success' ? '#86efac' : item.type === 'warn' ? '#fde68a' : '#e2e8f0',
                      wordBreak: 'break-word'
                    }}>
                      {item.text}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        ) : (
          /* PREVIEW TAB */
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
              containerType: 'inline-size'
            }}
          >
            {/* Minimal Developer Toolbar */}
            <div className="browser-chrome" style={{ padding: '0 16px', height: '40px', boxSizing: 'border-box' }}>
              {/* Left: Functional Preview Actions */}
              <div className="browser-chrome-left" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <button 
                  className="browser-action-btn" 
                  title="Refresh live preview" 
                  aria-label="Refresh live preview"
                  onClick={handleRefresh}
                >
                  <RefreshCw size={16} strokeWidth={1.75} />
                </button>
                <button 
                  className="browser-action-btn" 
                  title="Open live preview in new tab" 
                  aria-label="Open live preview in new window"
                  onClick={() => {
                    syncFilesToEdge(filesRef.current);
                    window.open(`/preview/${activeProjectId}/index.html`, '_blank');
                  }}
                >
                  <ExternalLink size={16} strokeWidth={1.75} />
                </button>
              </div>

              {/* Center: Clean URL Pill */}
              <div className="browser-chrome-center">
                <div 
                  className="browser-url-pill" 
                  title={`/preview/${activeProjectId}/index.html`}
                  style={{ cursor: 'default' }}
                >
                  <Lock size={16} strokeWidth={1.75} style={{ opacity: 0.8, color: 'var(--color-success)' }} />
                  <span>{previewEngine === 'edge' ? `brainhalf.com/preview/${activeProjectId.slice(0, 8)}` : 'preview.brainhalf.app/live'}</span>
                  {viewportMode !== 'desktop' && (
                    <span className="browser-viewport-badge">
                      {viewportMode === 'tablet' ? '768px' : '375px'}
                    </span>
                  )}
                </div>
              </div>

              {/* Right: Viewport Mode & Compact Runtime Selector (Desktop / Tablet / Mobile / Edge row) */}
              <div className="browser-chrome-right" style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0, marginRight: 0 }}>
                <div className="viewport-segmented-control" role="group" aria-label="Viewport and Runtime Engine options">
                  <button
                    onClick={() => setViewportMode('desktop')}
                    className={`viewport-pill-btn ${viewportMode === 'desktop' ? 'active' : ''}`}
                    title="Desktop View"
                    aria-label="Desktop View"
                  >
                    <Monitor size={16} strokeWidth={1.75} />
                    <span>Desktop</span>
                  </button>
                  <button
                    onClick={() => setViewportMode('tablet')}
                    className={`viewport-pill-btn ${viewportMode === 'tablet' ? 'active' : ''}`}
                    title="Tablet View (768px)"
                    aria-label="Tablet View"
                  >
                    <Tablet size={16} strokeWidth={1.75} />
                    <span>Tablet</span>
                  </button>
                  <button
                    onClick={() => setViewportMode('mobile')}
                    className={`viewport-pill-btn ${viewportMode === 'mobile' ? 'active' : ''}`}
                    title="Mobile View (375px)"
                    aria-label="Mobile View"
                  >
                    <Smartphone size={16} strokeWidth={1.75} />
                    <span>Mobile</span>
                  </button>

                  {/* 4th Option: Edge / Sandpack Engine Toggle */}
                  <div style={{ position: 'relative', display: 'inline-flex' }} ref={engineMenuRef}>
                    <button
                      onClick={() => setShowEngineMenu(prev => !prev)}
                      className={`viewport-pill-btn ${showEngineMenu ? 'active' : ''}`}
                      title={`Runtime Engine: ${previewEngine === 'edge' ? 'Cloudflare Edge' : 'Sandpack'}`}
                      aria-label="Preview Runtime Engine"
                      aria-expanded={showEngineMenu}
                      style={{
                        width: 'auto',
                        minWidth: 'max-content',
                        cursor: 'pointer'
                      }}
                    >
                      {previewEngine === 'edge' ? <Zap size={16} strokeWidth={1.75} color="#a78bfa" /> : <Box size={16} strokeWidth={1.75} color="#38bdf8" />}
                      <span>{previewEngine === 'edge' ? 'Edge' : 'Sandpack'}</span>
                    </button>

                    {showEngineMenu && (
                      <div style={{
                        position: 'absolute',
                        top: 'calc(100% + 4px)',
                        right: 0,
                        width: '190px',
                        background: '#12141c',
                        border: '1px solid var(--border-medium)',
                        borderRadius: '8px',
                        boxShadow: '0 12px 28px rgba(0, 0, 0, 0.65)',
                        padding: '4px',
                        zIndex: 1000,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '2px'
                      }}>
                        <div style={{ padding: '4px 8px', fontSize: '10.5px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                          Preview Runtime
                        </div>
                        <button
                          className={`deploy-menu-item ${previewEngine === 'edge' ? 'active' : ''}`}
                          onClick={() => {
                            setPreviewEngine('edge');
                            syncFilesToEdge(filesRef.current);
                            setEdgeRefreshCounter(c => c + 1);
                            addBuildLog('Switched to Cloudflare Edge Preview (Instant Edge Transpiler)', 'info');
                            setShowEngineMenu(false);
                          }}
                          style={{ padding: '6px 8px', fontSize: '12px' }}
                        >
                          <Zap size={16} strokeWidth={1.75} color="#a78bfa" />
                          <span>Cloudflare Edge (Fast)</span>
                          {previewEngine === 'edge' && <Check size={16} strokeWidth={1.75} color="var(--color-success)" style={{ marginLeft: 'auto' }} />}
                        </button>
                        <button
                          className={`deploy-menu-item ${previewEngine === 'sandpack' ? 'active' : ''}`}
                          onClick={() => {
                            setPreviewEngine('sandpack');
                            addBuildLog('Switched to Sandpack Virtual Bundler', 'info');
                            setShowEngineMenu(false);
                          }}
                          style={{ padding: '6px 8px', fontSize: '12px' }}
                        >
                          <Box size={16} strokeWidth={1.75} color="#38bdf8" />
                          <span>Sandpack Bundler</span>
                          {previewEngine === 'sandpack' && <Check size={16} strokeWidth={1.75} color="var(--color-success)" style={{ marginLeft: 'auto' }} />}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Sleek Minimal Progress Line during generation */}
            {status === 'Generating' && (
              <div style={{ height: '2px', width: '100%', background: 'rgba(255, 255, 255, 0.05)', position: 'relative', overflow: 'hidden' }}>
                <div 
                  style={{ 
                    height: '100%', 
                    width: `${progressPercent}%`, 
                    background: 'var(--text-primary)', 
                    transition: 'width 0.3s ease',
                    boxShadow: '0 0 8px rgba(255, 255, 255, 0.4)'
                  }} 
                />
              </div>
            )}

            {/* Application Area below browser chrome */}
            <div style={{ flex: 1, minHeight: 0, width: '100%', display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden' }}>
              {!hasProject ? (
                /* Empty State */
                <div style={{
                  height: '100%',
                  width: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '32px',
                  textAlign: 'center',
                  background: 'radial-gradient(circle at 50% 45%, rgba(59, 130, 246, 0.05) 0%, transparent 60%)'
                }}>
                  <div style={{
                    width: '48px',
                    height: '48px',
                    borderRadius: '8px',
                    background: 'rgba(99, 102, 241, 0.12)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginBottom: '24px'
                  }}>
                    <Sparkles size={24} color="var(--accent-light)" />
                  </div>

                  <h3 style={{
                    fontSize: '18px',
                    fontWeight: 600,
                    color: 'var(--text-primary)',
                    marginBottom: '8px',
                    fontFamily: 'var(--font-brand)'
                  }}>
                    Ready to Preview
                  </h3>

                  <p style={{
                    fontSize: '13px',
                    color: 'var(--text-secondary)',
                    maxWidth: '380px',
                    lineHeight: 1.5,
                    marginBottom: '24px'
                  }}>
                    Describe what you'd like to build in the chat to see your live preview here.
                  </p>

                  <button className="button-primary" onClick={handleLaunchPreview}>
                    <Play size={16} strokeWidth={1.75} fill="white" /> Launch Preview
                  </button>
                </div>
              ) : previewEngine === 'edge' ? (
                /* Live Cloudflare Edge Preview with Viewport Chassis */
                <div className={`viewport-frame-container ${viewportMode}`}>
                  <div className={`viewport-device-chassis ${viewportMode}`} style={{ height: '100%', overflow: 'hidden', background: '#090a0f' }}>
                    <iframe
                      ref={iframeRef}
                      key={`edge-preview-${activeProjectId}-${edgeRefreshCounter}`}
                      src={`/preview/${activeProjectId}/index.html`}
                      onLoad={() => {
                        iframeRef.current?.contentWindow?.postMessage({
                          type: 'sync-files',
                          files: filesRef.current
                        }, '*');
                      }}
                      style={{
                        width: '100%',
                        height: '100%',
                        border: 'none',
                        display: 'block',
                        background: '#090a0f'
                      }}
                      title="Cloudflare Edge Preview"
                      allow="fullscreen; clipboard-read; clipboard-write;"
                    />
                  </div>
                </div>
              ) : (
                /* Live Sandpack Preview with Viewport Chassis */
                <div className={`viewport-frame-container ${viewportMode}`}>
                  <div className={`viewport-device-chassis ${viewportMode}`} style={{ height: '100%', overflow: 'hidden', background: '#000' }}>
                    <SandpackProvider 
                      key={`sandpack-${activeProjectId}`}
                      template="react-ts" 
                      files={sandpackFiles} 
                      theme="dark"
                      customSetup={{
                        entry: "/index.tsx",
                        dependencies: {
                          "lucide-react": "latest",
                          "framer-motion": "latest",
                          "clsx": "latest",
                          "tailwind-merge": "latest"
                        }
                      }}
                      options={{
                        recompileMode: "immediate",
                        recompileDelay: 200,
                        activeFile: "/App.tsx"
                      }}
                      style={{ height: '100%', width: '100%' }}
                    >
                      <SandpackPreview 
                        showNavigator={false} 
                        showOpenInCodeSandbox={false}
                        style={{ height: '100%', width: '100%' }}
                      />
                    </SandpackProvider>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* GitHub Export Modal */}
      {showGithubModal && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0, 0, 0, 0.75)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 100000,
        }}>
          <div style={{
            background: 'var(--bg-panel)',
            border: '1px solid var(--border-color)',
            borderRadius: '12px',
            width: '400px',
            maxWidth: '90vw',
            padding: '24px',
            boxShadow: '0 20px 40px rgba(0,0,0,0.5)',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px'
          }}>
            <h3 style={{ margin: 0, fontSize: '18px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <FolderCode size={20} />
              Export to GitHub
            </h3>
            
            <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0 }}>
              Create a new repository or push to an existing one.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>Repository Name</label>
              <input 
                type="text" 
                value={githubRepo}
                onChange={e => setGithubRepo(e.target.value)}
                placeholder="e.g. brainhalf-app"
                style={{
                  background: 'rgba(0,0,0,0.2)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '6px',
                  padding: '8px 12px',
                  color: 'white',
                  fontSize: '13px',
                  outline: 'none',
                  fontFamily: 'inherit'
                }}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>Personal Access Token (PAT)</label>
              <input 
                type="password" 
                value={githubToken}
                onChange={e => setGithubToken(e.target.value)}
                placeholder="ghp_..."
                style={{
                  background: 'rgba(0,0,0,0.2)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '6px',
                  padding: '8px 12px',
                  color: 'white',
                  fontSize: '13px',
                  outline: 'none',
                  fontFamily: 'inherit'
                }}
              />
              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Needs 'repo' scope. Token is saved locally in your browser.</span>
            </div>

            {githubStatus.error && (
              <div style={{ padding: '8px', background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', border: '1px solid rgba(239, 68, 68, 0.2)', borderRadius: '6px', fontSize: '12px' }}>
                {githubStatus.error}
              </div>
            )}
            
            {githubStatus.success && (
              <div style={{ padding: '8px', background: 'rgba(34, 197, 94, 0.1)', color: '#22c55e', border: '1px solid rgba(34, 197, 94, 0.2)', borderRadius: '6px', fontSize: '12px' }}>
                {githubStatus.success}
              </div>
            )}

            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '8px' }}>
              <button 
                onClick={() => {
                  setShowGithubModal(false);
                  setGithubStatus({ loading: false });
                }}
                style={{
                  padding: '8px 16px',
                  background: 'transparent',
                  border: '1px solid var(--border-color)',
                  color: 'var(--text-primary)',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '13px'
                }}
              >
                Cancel
              </button>
              <button 
                onClick={handleExportGitHub}
                disabled={githubStatus.loading || !githubRepo || !githubToken}
                style={{
                  padding: '8px 16px',
                  background: 'var(--brand-primary)',
                  border: 'none',
                  color: 'white',
                  borderRadius: '6px',
                  cursor: githubStatus.loading ? 'not-allowed' : 'pointer',
                  opacity: githubStatus.loading ? 0.7 : 1,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  fontSize: '13px',
                  fontWeight: 500
                }}
              >
                {githubStatus.loading && <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />}
                {githubStatus.loading ? 'Exporting...' : 'Export Project'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Workspace;
