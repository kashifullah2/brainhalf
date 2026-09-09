import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { 
  Code2, Monitor, ExternalLink, RefreshCw, Loader2, Play, Sparkles, Lock, 
  AlertCircle, Terminal, CheckCircle2, Copy, Check, FolderCode, Download, 
  ArrowDown, Tablet, Smartphone, WrapText, Wrench, RotateCcw, ListFilter
} from 'lucide-react';
import Editor from '@monaco-editor/react';
import { basicReactTemplate } from '../lib/templates';
import { appEvents } from '../lib/events';
import { exportProjectAsZip } from '../lib/zip-export';
import FileExplorer from './FileExplorer';

type GenerationStatus = 'Idle' | 'Generating' | 'Ready' | 'Error';
type WorkspaceTab = 'code' | 'preview' | 'console' | 'logs';
type ViewportMode = 'desktop' | 'tablet' | 'mobile';

interface BuildLogItem {
  id: string;
  time: string;
  text: string;
  type: 'info' | 'success' | 'warn' | 'error';
}

interface WorkspaceProps {
  activeProjectId: string;
}

const Workspace: React.FC<WorkspaceProps> = ({ activeProjectId }) => {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('preview');
  const [viewportMode, setViewportMode] = useState<ViewportMode>('desktop');
  const [wordWrap, setWordWrap] = useState<'on' | 'off'>('on');
  const iframeUrl = `/preview/${activeProjectId}/`;
  const [status, setStatus] = useState<GenerationStatus>('Idle');
  const [statusDetail, setStatusDetail] = useState('');
  const [hasProject, setHasProject] = useState(false);
  const [generatingFile, setGeneratingFile] = useState('');
  const [consoleLogs, setConsoleLogs] = useState<string[]>([]);
  const [buildLogs, setBuildLogs] = useState<BuildLogItem[]>([
    {
      id: 'init',
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      text: 'BrainHalf development studio initialized.',
      type: 'info'
    }
  ]);
  const [copiedCode, setCopiedCode] = useState(false);
  const consoleEndRef = useRef<HTMLDivElement>(null);
  
  const [files, setFiles] = useState<{ [path: string]: string }>({
    '/src/App.jsx': basicReactTemplate['src'].directory['App.jsx'].file.contents,
    '/src/main.jsx': basicReactTemplate['src'].directory['main.jsx'].file.contents,
    '/src/styles.css': basicReactTemplate['src'].directory['styles.css'].file.contents,
  });
  const [activeFile, setActiveFile] = useState('/src/App.jsx');

  const filesRef = useRef(files);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const handleRefreshRef = useRef<() => void>(() => {});

  const addBuildLog = useCallback((text: string, type: 'info' | 'success' | 'warn' | 'error' = 'info') => {
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setBuildLogs(prev => [...prev.slice(-250), { id: Math.random().toString(36).slice(2), time, text, type }]);
  }, []);

  // Keep filesRef always updated synchronously
  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  // Helper to sync files to backend
  const syncFilesToEdge = useCallback((currentFiles: any) => {
    appEvents.emit('sync-files', { files: currentFiles });
  }, []);

  // Reset workspace when project changes or when cleared
  useEffect(() => {
    const handleClearWorkspace = () => {
      const defaultFiles = {
        '/src/App.jsx': basicReactTemplate['src'].directory['App.jsx'].file.contents,
        '/src/main.jsx': basicReactTemplate['src'].directory['main.jsx'].file.contents,
        '/src/styles.css': basicReactTemplate['src'].directory['styles.css'].file.contents,
      };
      setFiles(defaultFiles);
      filesRef.current = defaultFiles;
      setHasProject(false);
      setStatus('Idle');
      setStatusDetail('');
      setActiveFile('/src/App.jsx');
      addBuildLog('Workspace reset to baseline React 18 template', 'warn');
      syncFilesToEdge(defaultFiles);
    };

    // Initial sync
    syncFilesToEdge(filesRef.current);
    
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
        }
        if (file) {
          setGeneratingFile(file);
          addBuildLog(`AI generating: ${file}`, 'info');
        }
      } else if (newStatus === 'Ready') {
        setHasProject(true);
        setStatusDetail('');
        setStatus('Ready');
        addBuildLog('All components generated successfully', 'success');
        syncFilesToEdge(filesRef.current);
        if (handleRefreshRef.current) handleRefreshRef.current();
      } else if (newStatus === 'Error') {
        setStatus('Error');
        const errMsg = error || 'Generation failed';
        setStatusDetail(errMsg);
        addBuildLog(`Build error: ${errMsg}`, 'error');
      }
    };

    const handleFileGenerated = ({ path, content, isComplete }: { path: string; content: string; isComplete?: boolean }) => {
      const cleanPath = path.startsWith('/') ? path : `/${path}`;
      setHasProject(true);
      setGeneratingFile(path);
      
      filesRef.current[cleanPath] = content;
      setFiles(prev => ({
        ...prev,
        [cleanPath]: content
      }));

      if (isComplete) {
        addBuildLog(`Compiled: ${cleanPath}`, 'success');
        syncFilesToEdge(filesRef.current);
      }
    };

    const handleOpenFile = ({ path }: { path: string }) => {
      const cleanPath = path.startsWith('/') ? path : `/${path}`;
      setActiveFile(cleanPath);
      setActiveTab('code');
    };

    const handleExport = async ({ projectName }: { projectName?: string }) => {
      try {
        await exportProjectAsZip(filesRef.current, projectName || 'brainhalf-project');
        addBuildLog(`Project bundle exported as ZIP: ${projectName || 'brainhalf-project'}`, 'success');
      } catch (e) {
        addBuildLog('Export ZIP error', 'error');
      }
    };

    const handleRequestContext = ({ requestId }: { requestId: string }) => {
      appEvents.emit(`workspace-context-response-${requestId}`, { files: filesRef.current });
    };

    const handleExecuteCommand = async ({ command, requestId }: { command: string; requestId: string }) => {
      appEvents.emit(`command-result-${requestId}`, { output: 'Edge Preview mode active. Terminal commands are simulated.' });
    };

    const unsubStatus = appEvents.on('generation-status', handleGenerationStatus);
    const unsubFile = appEvents.on('file-generated', handleFileGenerated);
    const unsubOpen = appEvents.on('open-file', handleOpenFile);
    const unsubExport = appEvents.on('request-export', handleExport);
    const unsubContext = appEvents.on('request-workspace-context', handleRequestContext);
    const unsubExec = appEvents.on('execute-command', handleExecuteCommand);
    
    return () => {
      unsubStatus();
      unsubFile();
      unsubOpen();
      unsubExport();
      unsubContext();
      unsubExec();
    };
  }, [addBuildLog, syncFilesToEdge]);

  const handleEditorChange = async (value: string | undefined) => {
    if (!value) return;
    filesRef.current[activeFile] = value;
    setFiles(prev => ({
      ...prev,
      [activeFile]: value
    }));
    
    if (status === 'Ready' || status === 'Idle') {
      syncFilesToEdge(filesRef.current);
    }
  };

  const handleRefresh = () => {
    if (iframeRef.current && iframeUrl) {
      iframeRef.current.src = iframeUrl;
      addBuildLog('Preview reloaded', 'info');
    }
  };

  useEffect(() => {
    handleRefreshRef.current = handleRefresh;
  });

  // Calculate stages for the progress checklist
  const getStageState = (stageName: string) => {
    if (status === 'Ready') return 'done';
    if (stageName === 'init') return 'done';
    if (stageName === 'packages') return 'done';
    if (stageName === 'code') {
      if (status === 'Generating' || generatingFile) return 'current';
      return 'pending';
    }
    if (stageName === 'server') {
      return 'pending';
    }
    return 'pending';
  };

  const progressPercent = useMemo(() => {
    if (status === 'Ready') return 100;
    if (status === 'Idle') return 0;
    if (status === 'Generating') return 65;
    return 50;
  }, [status]);

  const currentStep = useMemo(() => {
    if (status !== 'Generating') return 3;
    return 2;
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
        {/* Professional 4-Way Workspace Navigation */}
        <div className="segmented-control" role="tablist" aria-label="Workspace navigation">
          <button 
            role="tab"
            aria-selected={activeTab === 'code'}
            onClick={() => setActiveTab('code')}
            className={`segmented-tab ${activeTab === 'code' ? 'active' : ''}`}
            title="Inspect & Edit Code (Monaco Editor)"
          >
            <Code2 size={13} /> 
            <span>Code</span>
          </button>
          <button 
            role="tab"
            aria-selected={activeTab === 'preview'}
            onClick={() => setActiveTab('preview')}
            className={`segmented-tab ${activeTab === 'preview' ? 'active' : ''}`}
            title="Live Application Preview"
          >
            <Monitor size={13} /> 
            <span>Preview</span>
          </button>
          <button 
            role="tab"
            aria-selected={activeTab === 'console'}
            onClick={() => setActiveTab('console')}
            className={`segmented-tab ${activeTab === 'console' ? 'active' : ''}`}
            title="Terminal & Runtime Server Output"
          >
            <Terminal size={13} /> 
            <span>Console</span>
            {consoleLogs.length > 0 && (
              <span style={{
                fontSize: '9px',
                padding: '1px 5px',
                borderRadius: '4px',
                background: 'rgba(255, 255, 255, 0.08)',
                color: 'var(--text-muted)'
              }}>
                {consoleLogs.length}
              </span>
            )}
          </button>
          <button 
            role="tab"
            aria-selected={activeTab === 'logs'}
            onClick={() => setActiveTab('logs')}
            className={`segmented-tab ${activeTab === 'logs' ? 'active' : ''}`}
            title="Build Pipeline & Event Timeline"
          >
            <ListFilter size={13} /> 
            <span>Logs</span>
            {buildLogs.length > 1 && (
              <span style={{
                fontSize: '9px',
                padding: '1px 5px',
                borderRadius: '4px',
                background: 'rgba(59, 130, 246, 0.15)',
                color: '#93c5fd'
              }}>
                {buildLogs.length}
              </span>
            )}
          </button>
        </div>

        {/* Right side controls: Rich detailed status badge & quick actions */}
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <div className={`status-badge ${status.toLowerCase()}`} title={statusDetail || status}>
            {status === 'Generating' ? (
              <>
                <Loader2 size={13} className="lucide-spin" style={{ color: 'var(--color-ai)' }} />
                <div className="status-text-group">
                  <div className="status-line-top">
                    <span className="status-title">Building</span>
                    <span className="status-step-pill">Step {currentStep} of 3</span>
                  </div>
                  <span className="status-detail-text">
                    {generatingFile ? generatingFile.split('/').pop() : (statusDetail || 'Generating components...')}
                  </span>
                </div>
              </>
            ) : status === 'Ready' ? (
              <>
                <CheckCircle2 size={13} style={{ color: 'var(--color-success)' }} />
                <span style={{ fontWeight: 600, color: 'var(--color-success)' }}>Ready</span>
              </>
            ) : status === 'Error' ? (
              <>
                <AlertCircle size={13} style={{ color: 'var(--color-error)' }} />
                <span style={{ fontWeight: 600, color: 'var(--color-error)' }}>Build failed</span>
              </>
            ) : (
              <>
                <span className="status-dot idle" />
                <span>Idle</span>
              </>
            )}
          </div>

          <button 
            className="icon-btn" 
            title="Refresh preview" 
            aria-label="Refresh preview"
            onClick={handleRefresh} 
            disabled={!iframeUrl}
          >
            <RefreshCw size={14} />
          </button>
          <button 
            className="icon-btn" 
            title="Open preview in new tab" 
            aria-label="Open preview in new tab"
            onClick={() => iframeUrl && window.open(iframeUrl, '_blank')} 
            disabled={!iframeUrl}
          >
            <ExternalLink size={14} />
          </button>
        </div>
      </div>

      {/* Workspace Content Area */}
      <div style={{ flex: 1, position: 'relative', display: 'flex', overflow: 'hidden' }}>
        {activeTab === 'code' ? (
          /* CODE EDITOR TAB */
          <div style={{ display: 'flex', width: '100%', height: '100%' }}>
            <FileExplorer 
              files={files} 
              activeFile={activeFile} 
              onSelectFile={setActiveFile} 
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
                {Object.keys(files).map(filePath => {
                  const isActive = filePath === activeFile;
                  const name = filePath.split('/').pop();
                  return (
                    <div
                      key={filePath}
                      onClick={() => setActiveFile(filePath)}
                      style={{
                        padding: '6px 12px',
                        background: isActive ? 'var(--bg-code-editor)' : 'transparent',
                        borderBottom: isActive ? '2px solid var(--color-info)' : '2px solid transparent',
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
                      <Code2 size={13} color={isActive ? 'var(--color-info)' : undefined} />
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
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <FolderCode size={12} color="var(--color-neutral)" />
                  <span>src</span>
                  <span style={{ opacity: 0.4 }}>/</span>
                  <span style={{ color: '#f3f4f6', fontWeight: 600 }}>{activeFile.split('/').pop()}</span>
                  <span style={{ opacity: 0.4 }}>•</span>
                  <span>{(files[activeFile] || '').split('\n').length} lines</span>
                  <span style={{
                    fontSize: '9.5px',
                    padding: '1px 5px',
                    borderRadius: '4px',
                    background: 'rgba(255, 255, 255, 0.06)',
                    color: 'var(--text-muted)',
                    marginLeft: '4px'
                  }}>
                    {activeFile.endsWith('.css') ? 'CSS' : activeFile.endsWith('.json') ? 'JSON' : 'React (JSX)'}
                  </span>
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
                    <WrapText size={12} />
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
                    {copiedCode ? <Check size={12} color="#34d399" /> : <Copy size={12} />}
                    <span>{copiedCode ? 'Copied' : 'Copy'}</span>
                  </button>

                  <button
                    onClick={() => exportProjectAsZip(filesRef.current, 'brainhalf-project')}
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
                    <Download size={12} />
                    <span>Export ZIP</span>
                  </button>
                </div>
              </div>

              {/* Monaco Editor Container */}
              <div style={{ flex: 1, height: 'calc(100% - 66px)' }}>
                <Editor 
                  height="100%"
                  language={
                    activeFile.endsWith('.css') ? 'css' : 
                    activeFile.endsWith('.json') ? 'json' : 
                    activeFile.endsWith('.html') ? 'html' : 
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
                <Terminal size={14} color="#a855f7" />
                <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>Terminal & Dev Server Logs</span>
                <span style={{ fontSize: '10px', color: '#10b981', background: 'rgba(16, 185, 129, 0.1)', padding: '2px 6px', borderRadius: '4px' }}>Edge Preview Active</span>
              </div>
              <button
                onClick={() => setConsoleLogs([])}
                style={{
                  background: 'transparent',
                  border: '1px solid var(--border-subtle)',
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
                  $ WebContainer runtime connected. Waiting for build and dev server logs...
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
                <ListFilter size={14} color="#3b82f6" />
                <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>Build Pipeline Timeline & Activity</span>
                <span style={{ fontSize: '10px', color: 'var(--text-muted)', background: 'rgba(255, 255, 255, 0.06)', padding: '2px 6px', borderRadius: '4px' }}>
                  {buildLogs.length} events
                </span>
              </div>
              <button
                onClick={() => setBuildLogs([])}
                style={{
                  background: 'transparent',
                  border: '1px solid var(--border-subtle)',
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
                  No build pipeline events recorded yet. Pipeline steps, file generation, and server states will be logged here.
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
          <div style={{ 
            height: '100%', 
            width: '100%',
            display: 'flex', 
            flexDirection: 'column',
            background: 'var(--bg-preview-canvas)',
            position: 'relative',
            overflow: 'hidden'
          }}>
            {/* Realistic Compact Browser Chrome Bar */}
            <div className="browser-chrome">
              {/* Left: Window Dots & Navigation Controls */}
              <div className="browser-chrome-left">
                <div className="browser-dots">
                  <span className="browser-dot close" title="Close" />
                  <span className="browser-dot minimize" title="Minimize" />
                  <span className="browser-dot maximize" title="Maximize" />
                </div>
                <div className="browser-nav-actions">
                  <button 
                    className="browser-action-btn" 
                    title="Refresh live preview" 
                    aria-label="Refresh live preview"
                    onClick={handleRefresh}
                    disabled={!iframeUrl}
                  >
                    <RefreshCw size={12} />
                  </button>
                  <button 
                    className="browser-action-btn" 
                    title="Open live preview in new window" 
                    aria-label="Open live preview in new window"
                    onClick={() => iframeUrl && window.open(iframeUrl, '_blank')}
                    disabled={!iframeUrl}
                  >
                    <ExternalLink size={12} />
                  </button>
                </div>
              </div>

              {/* Center: Centered URL Pill */}
              <div className="browser-chrome-center">
                <div className="browser-url-pill">
                  <Lock size={11} style={{ opacity: 0.6 }} />
                  <span>preview.brainhalf.app/live</span>
                  {viewportMode !== 'desktop' && (
                    <span className="browser-viewport-badge">
                      {viewportMode === 'tablet' ? '768px' : '375px'}
                    </span>
                  )}
                </div>
              </div>

              {/* Right: Viewport Mode Switcher (Desktop / Tablet / Mobile) */}
              <div className="browser-chrome-right">
                <div className="viewport-segmented-control">
                  <button
                    onClick={() => setViewportMode('desktop')}
                    className={`viewport-pill-btn ${viewportMode === 'desktop' ? 'active' : ''}`}
                    title="Desktop View (Full Width)"
                    aria-label="Desktop View"
                  >
                    <Monitor size={12} />
                    <span>Desktop</span>
                  </button>
                  <button
                    onClick={() => setViewportMode('tablet')}
                    className={`viewport-pill-btn ${viewportMode === 'tablet' ? 'active' : ''}`}
                    title="Tablet View (768px)"
                    aria-label="Tablet View"
                  >
                    <Tablet size={12} />
                    <span>Tablet</span>
                  </button>
                  <button
                    onClick={() => setViewportMode('mobile')}
                    className={`viewport-pill-btn ${viewportMode === 'mobile' ? 'active' : ''}`}
                    title="Mobile View (375px)"
                    aria-label="Mobile View"
                  >
                    <Smartphone size={12} />
                    <span>Mobile</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Horizontal Build Pipeline Stepper Bar */}
            {(status === 'Generating' || (!iframeUrl && hasProject && status !== 'Error')) && (
              <div className="build-pipeline-bar">
                <div className="pipeline-stepper">
                  <div className={`pipeline-step-item ${getStageState('packages') === 'done' ? 'done' : 'active'}`}>
                    {getStageState('packages') === 'done' ? (
                      <CheckCircle2 size={13} style={{ color: 'var(--color-success)' }} />
                    ) : (
                      <Loader2 size={13} className="lucide-spin" style={{ color: 'var(--color-ai)' }} />
                    )}
                    <span>✓ Install packages</span>
                  </div>

                  <div className={`pipeline-connector-line ${getStageState('packages') === 'done' ? 'active' : ''}`} />

                  <div className={`pipeline-step-item ${getStageState('code') === 'done' ? 'done' : (getStageState('code') === 'current' ? 'active' : '')}`}>
                    {getStageState('code') === 'done' ? (
                      <CheckCircle2 size={13} style={{ color: 'var(--color-success)' }} />
                    ) : getStageState('code') === 'current' ? (
                      <Loader2 size={13} className="lucide-spin" style={{ color: 'var(--color-ai)' }} />
                    ) : (
                      <span className="status-dot idle" />
                    )}
                    <span>● Generate code {generatingFile ? `(${generatingFile.split('/').pop()})` : ''}</span>
                  </div>

                  <div className={`pipeline-connector-line ${iframeUrl ? 'active' : ''}`} />

                  <div className={`pipeline-step-item ${iframeUrl ? 'done' : (getStageState('server') === 'current' ? 'active' : '')}`}>
                    {iframeUrl ? (
                      <CheckCircle2 size={13} style={{ color: 'var(--color-success)' }} />
                    ) : getStageState('server') === 'current' ? (
                      <Loader2 size={13} className="lucide-spin" style={{ color: 'var(--color-ai)' }} />
                    ) : (
                      <span className="status-dot idle" />
                    )}
                    <span>○ Launch preview</span>
                  </div>
                </div>

                <div className="pipeline-progress-track">
                  <div className="pipeline-progress-fill" style={{ width: `${progressPercent}%` }} />
                </div>
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
                    background: 'rgba(59, 130, 246, 0.1)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginBottom: '24px'
                  }}>
                    <Sparkles size={24} color="var(--color-info)" />
                  </div>

                  <h3 style={{
                    fontSize: '18px',
                    fontWeight: 600,
                    color: 'var(--text-primary)',
                    marginBottom: '8px',
                    fontFamily: 'var(--font-brand)'
                  }}>
                    Your Live Preview Awaits
                  </h3>

                  <p style={{
                    fontSize: '13px',
                    color: 'var(--text-secondary)',
                    maxWidth: '380px',
                    lineHeight: 1.5,
                    marginBottom: '24px'
                  }}>
                    Ask the AI assistant to build any app or component. BrainHalf generates React code and mounts it in WebContainer immediately.
                  </p>

                  <button className="button-primary" onClick={handleRefresh}>
                    <Play size={14} fill="white" /> Launch Edge Preview
                  </button>
                </div>
              ) : iframeUrl ? (
                /* Live Iframe Preview with Viewport Chassis */
                <div className={`viewport-frame-container ${viewportMode}`}>
                  <div className={`viewport-device-chassis ${viewportMode}`}>
                    <iframe
                      ref={iframeRef}
                      src={iframeUrl}
                      style={{
                        width: '100%',
                        height: '100%',
                        border: 'none',
                        display: 'block',
                        background: '#0f111a'
                      }}
                      title="Live Application Preview"
                      allow="cross-origin-isolated"
                    />
                  </div>
                </div>
              ) : status === 'Error' ? (
                /* Actionable Error State */
                <div style={{
                  height: '100%',
                  width: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '32px',
                  textAlign: 'center'
                }}>
                  <div style={{
                    width: '48px',
                    height: '48px',
                    borderRadius: '8px',
                    background: 'var(--color-error-bg)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: '1px solid var(--color-error-border)',
                    marginBottom: '16px'
                  }}>
                    <AlertCircle size={26} color="var(--color-error)" />
                  </div>

                  <h3 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '8px', fontFamily: 'var(--font-brand)' }}>
                    Preview Generation Error
                  </h3>

                  <p style={{ fontSize: '13px', color: 'var(--text-secondary)', maxWidth: '440px', lineHeight: 1.5, marginBottom: '8px' }}>
                    {statusDetail || 'A compilation, build, or package resolution error occurred in WebContainer.'}
                  </p>

                  <p style={{ fontSize: '12px', color: 'var(--text-muted)', maxWidth: '380px', marginBottom: '24px' }}>
                    The AI assistant can analyze the stack trace and fix dependencies or syntax automatically.
                  </p>

                  <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center' }}>
                    <button 
                      className="button-primary" 
                      onClick={() => {
                        appEvents.emit('auto-fix-error', { error: statusDetail || 'Build compilation error' });
                      }}
                      style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                    >
                      <Wrench size={14} />
                      <span>Fix automatically with AI</span>
                    </button>

                    <button 
                      className="button-ghost" 
                      onClick={() => setActiveTab('console')}
                      style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                    >
                      <Terminal size={14} />
                      <span>View logs</span>
                    </button>

                    <button 
                      className="button-ghost" 
                      onClick={handleRefresh}
                      style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                      title="Re-run edge preview"
                    >
                      <RotateCcw size={14} />
                      <span>Retry</span>
                    </button>
                  </div>
                </div>
              ) : (
                /* Intentional, High-Polish Generation Experience */
                <div style={{
                  width: '100%',
                  height: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '32px',
                  background: 'radial-gradient(circle at 50% 40%, rgba(59, 130, 246, 0.04) 0%, transparent 70%)'
                }}>
                  <div style={{
                    width: '100%',
                    maxWidth: '420px',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    textAlign: 'center'
                  }}>
                    {/* Pulsing AI Generator Icon */}
                    <div style={{
                      width: '48px',
                      height: '48px',
                      borderRadius: '8px',
                      background: 'rgba(168, 85, 247, 0.12)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      marginBottom: '24px'
                    }}>
                      <Sparkles size={24} color="var(--color-ai)" className="pulse-sparkle" />
                    </div>

                    <h3 style={{
                      fontSize: '18px',
                      fontWeight: 600,
                      color: '#ffffff',
                      margin: '0 0 8px 0',
                      fontFamily: 'var(--font-brand)'
                    }}>
                      Building your application
                    </h3>

                    <p style={{
                      fontSize: '13px',
                      color: 'var(--text-secondary)',
                      margin: '0 0 32px 0',
                      maxWidth: '360px',
                      lineHeight: 1.5
                    }}>
                      {generatingFile ? `Writing ${generatingFile}...` : statusDetail || 'Generating React components and launching live preview...'}
                    </p>

                    {/* Stepper */}
                    <div style={{
                      width: '100%',
                      marginBottom: '32px',
                      textAlign: 'left'
                    }}>
                      <div style={{
                        fontSize: '11px',
                        fontWeight: 700,
                        color: 'var(--text-muted)',
                        letterSpacing: '0.08em',
                        marginBottom: '16px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between'
                      }}>
                        <span>BUILD PIPELINE</span>
                        <span style={{ color: 'var(--color-ai)' }}>Step {currentStep} of 3</span>
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {/* Step 1: Install Packages */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13px' }}>
                          {getStageState('packages') === 'done' ? (
                            <CheckCircle2 size={16} style={{ color: 'var(--color-success)', flexShrink: 0 }} />
                          ) : (
                            <Loader2 size={16} className="lucide-spin" style={{ color: 'var(--color-ai)', flexShrink: 0 }} />
                          )}
                          <span style={{ color: getStageState('packages') === 'done' ? 'var(--color-success)' : '#ffffff', fontWeight: 500 }}>
                            Install packages & runtime
                          </span>
                        </div>

                        {/* Stepper Arrow */}
                        <div style={{ paddingLeft: '8px', color: 'var(--text-muted)' }}>
                          <ArrowDown size={12} style={{ opacity: 0.35 }} />
                        </div>

                        {/* Step 2: Generate Code */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13px' }}>
                          {getStageState('code') === 'done' ? (
                            <CheckCircle2 size={16} style={{ color: 'var(--color-success)', flexShrink: 0 }} />
                          ) : getStageState('code') === 'current' ? (
                            <Loader2 size={16} className="lucide-spin" style={{ color: 'var(--color-ai)', flexShrink: 0 }} />
                          ) : (
                            <span style={{ width: '16px', height: '16px', borderRadius: '50%', border: '1.5px solid #4b5563', display: 'inline-block', flexShrink: 0 }} />
                          )}
                          <span style={{ color: getStageState('code') === 'current' ? '#ffffff' : getStageState('code') === 'done' ? 'var(--color-success)' : 'var(--text-muted)', fontWeight: 500 }}>
                            Generate code {generatingFile ? `(${generatingFile.split('/').pop()})` : ''}
                          </span>
                        </div>

                        {/* Stepper Arrow */}
                        <div style={{ paddingLeft: '8px', color: 'var(--text-muted)' }}>
                          <ArrowDown size={12} style={{ opacity: 0.35 }} />
                        </div>

                        {/* Step 3: Launch Preview */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13px' }}>
                          {iframeUrl ? (
                            <CheckCircle2 size={16} style={{ color: 'var(--color-success)', flexShrink: 0 }} />
                          ) : getStageState('server') === 'current' ? (
                            <Loader2 size={16} className="lucide-spin" style={{ color: 'var(--color-ai)', flexShrink: 0 }} />
                          ) : (
                            <span style={{ width: '16px', height: '16px', borderRadius: '50%', border: '1.5px solid #4b5563', display: 'inline-block', flexShrink: 0 }} />
                          )}
                          <span style={{ color: iframeUrl ? 'var(--color-success)' : getStageState('server') === 'current' ? '#ffffff' : 'var(--text-muted)', fontWeight: 500 }}>
                            Launch preview (Vite Server)
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Progress Bar */}
                    <div style={{
                      width: '100%',
                      height: '3px',
                      borderRadius: '2px',
                      background: 'rgba(255, 255, 255, 0.06)',
                      overflow: 'hidden',
                      marginBottom: '12px'
                    }}>
                      <div style={{
                        height: '100%',
                        width: `${progressPercent}%`,
                        background: 'linear-gradient(90deg, #3b82f6, #a855f7)',
                        borderRadius: '2px',
                        transition: 'width 0.4s ease'
                      }} />
                    </div>

                    <div style={{
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      fontSize: '11px',
                      color: 'var(--text-muted)',
                      fontFamily: 'var(--font-mono)'
                    }}>
                      <span>{progressPercent}% completed</span>
                      <span>Vite Dev Server</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Workspace;
