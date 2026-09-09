import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Code2, Monitor, ExternalLink, RefreshCw, Loader2, Play, Sparkles, Lock, AlertCircle, Terminal, CheckCircle2, Copy, Check, FolderCode, Download } from 'lucide-react';
import Editor from '@monaco-editor/react';
import { getWebContainer } from '../lib/webcontainer';
import { basicReactTemplate } from '../lib/templates';
import { appEvents } from '../lib/events';
import { sanitizeCodeForPreview } from '../lib/code-sanitizer';
import { exportProjectAsZip } from '../lib/zip-export';
import FileExplorer from './FileExplorer';

type GenerationStatus = 'Idle' | 'Generating' | 'Ready' | 'Error';

interface WorkspaceProps {
  activeProjectId: string;
}

const Workspace: React.FC<WorkspaceProps> = ({ activeProjectId }) => {
  const [activeTab, setActiveTab] = useState<'code' | 'preview' | 'console'>('preview');
  const [iframeUrl, setIframeUrl] = useState('');
  const [isBooting, setIsBooting] = useState(false);
  const [status, setStatus] = useState<GenerationStatus>('Idle');
  const [statusDetail, setStatusDetail] = useState('');
  const [hasProject, setHasProject] = useState(false);
  const [generatingFile, setGeneratingFile] = useState('');
  const [consoleLogs, setConsoleLogs] = useState<string[]>([]);
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
  const webcontainerRef = useRef<any>(null);
  const isBootingRef = useRef(false);

  // Keep filesRef always updated synchronously
  useEffect(() => {
    filesRef.current = files;
  }, [files]);

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
      
      if (webcontainerRef.current) {
        webcontainerRef.current.mount(basicReactTemplate).catch(console.error);
      }
    };

    handleClearWorkspace();

    const unsubClear = appEvents.on('clear-workspace', handleClearWorkspace);
    return () => unsubClear();
  }, [activeProjectId]);

  // Helper to safely write files with recursive directory creation and sanitization
  const writeWebContainerFile = async (wc: any, filePath: string, content: string) => {
    if (!wc) return;
    const cleanPath = filePath.startsWith('/') ? filePath : `/${filePath}`;
    
    // Ensure parent directory exists before writing
    const lastSlash = cleanPath.lastIndexOf('/');
    if (lastSlash > 0) {
      const dir = cleanPath.substring(0, lastSlash);
      try {
        await wc.fs.mkdir(dir, { recursive: true });
      } catch (e) {
        // ignore if directory already exists
      }
    }

    const safeCode = sanitizeCodeForPreview(content, cleanPath);
    await wc.fs.writeFile(cleanPath, safeCode);
    console.log('Wrote file to WebContainer:', cleanPath);
  };

  // Pre-boot WebContainer in background on mount so Vite dev server is ready immediately
  useEffect(() => {
    if (!webcontainerRef.current && !isBootingRef.current) {
      bootWebContainer();
    }
  }, []);

  // Synchronize generation events
  useEffect(() => {
    const handleGenerationStatus = async ({ status: newStatus, detail, file, error }: any) => {
      console.log('Generation status update:', newStatus, detail, file);
      
      if (newStatus === 'Generating') {
        setStatus('Generating');
        setHasProject(true);
        if (detail) setStatusDetail(detail);
        if (file) setGeneratingFile(file);

        if (!webcontainerRef.current && !isBootingRef.current) {
          bootWebContainer();
        }
      } else if (newStatus === 'Ready') {
        setHasProject(true);
        setStatusDetail('');
        
        // Ensure all generated files are written to WebContainer
        if (webcontainerRef.current) {
          for (const [filePath, content] of Object.entries(filesRef.current)) {
            try {
              await writeWebContainerFile(webcontainerRef.current, filePath, content);
            } catch (err) {
              console.error('Error writing file on Ready:', filePath, err);
            }
          }
          if (iframeUrl) {
            setStatus('Ready');
          }
        } else if (!isBootingRef.current) {
          bootWebContainer();
        }
      } else if (newStatus === 'Error') {
        setStatus('Error');
        setStatusDetail(error || 'Generation failed');
      }
    };

    const handleFileGenerated = async ({ path, content, isComplete }: { path: string; content: string; isComplete?: boolean }) => {
      const cleanPath = path.startsWith('/') ? path : `/${path}`;
      setHasProject(true);
      setGeneratingFile(path);
      
      // Update both ref and React state immediately
      filesRef.current[cleanPath] = content;
      setFiles(prev => ({
        ...prev,
        [cleanPath]: content
      }));

      // Write complete file to WebContainer
      if (isComplete && webcontainerRef.current) {
        try {
          await writeWebContainerFile(webcontainerRef.current, cleanPath, content);
        } catch (e) {
          console.error('Failed writing complete file to WebContainer:', e);
        }
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
      } catch (e) {
        console.error('Export project error:', e);
      }
    };

    const handleRequestContext = ({ requestId }: { requestId: string }) => {
      appEvents.emit(`workspace-context-response-${requestId}`, { files: filesRef.current });
    };

    const handleExecuteCommand = async ({ command, requestId }: { command: string; requestId: string }) => {
      if (!webcontainerRef.current) {
        appEvents.emit(`command-result-${requestId}`, { output: 'Error: WebContainer not booted.' });
        return;
      }
      try {
        const parts = command.split(' ');
        const cmd = parts[0];
        const args = parts.slice(1);
        
        const process = await webcontainerRef.current.spawn(cmd, args);
        let output = '';
        
        process.output.pipeTo(new WritableStream({
          write(data) {
            output += data;
          }
        }));
        
        const exitCode = await process.exit;
        appEvents.emit(`command-result-${requestId}`, { 
          output: `Exit Code: ${exitCode}\n\n${output}` 
        });
      } catch (err: any) {
        appEvents.emit(`command-result-${requestId}`, { output: `Failed to execute: ${err.message}` });
      }
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
  }, [iframeUrl]);

  const bootWebContainer = async () => {
    if (isBootingRef.current || webcontainerRef.current) return;
    
    isBootingRef.current = true;
    setIsBooting(true);
    setStatus('Generating');
    setStatusDetail('Booting preview engine...');

    try {
      const wc = await getWebContainer();
      webcontainerRef.current = wc;

      setStatusDetail('Mounting files...');
      await wc.mount(basicReactTemplate);

      // Write any generated files from filesRef
      for (const [filePath, content] of Object.entries(filesRef.current)) {
        try {
          await writeWebContainerFile(wc, filePath, content);
        } catch (err) {
          console.warn('Pre-mount file write note:', filePath, err);
        }
      }

      setStatusDetail('Installing packages...');
      const installProcess = await wc.spawn('npm', ['install']);
      
      installProcess.output.pipeTo(new WritableStream({
        write(data) {
          console.log('[npm install]', data);
          setConsoleLogs(prev => [...prev.slice(-300), `[npm] ${data}`]);
        }
      }));

      const installExitCode = await installProcess.exit;
      if (installExitCode !== 0) {
        throw new Error('Package install failed');
      }

      setStatusDetail('Starting dev server...');
      const startProcess = await wc.spawn('npm', ['run', 'dev']);
      
      let devErrorBuffer = '';
      let errorTimeout: any = null;

      startProcess.output.pipeTo(new WritableStream({
        write(data) {
          console.log('[npm run dev]', data);
          setConsoleLogs(prev => [...prev.slice(-300), data]);
          if (data.includes('Error:') || data.includes('ERR_') || data.includes('Failed to parse source') || data.includes('Internal server error')) {
            devErrorBuffer += data + '\n';
            if (errorTimeout) clearTimeout(errorTimeout);
            errorTimeout = setTimeout(() => {
              if (devErrorBuffer.trim().length > 0) {
                appEvents.emit('auto-fix-error', { error: devErrorBuffer.trim() });
                devErrorBuffer = '';
              }
            }, 1500); // wait 1.5s to gather full error trace
          } else if (devErrorBuffer.length > 0) {
            devErrorBuffer += data + '\n';
          }
        }
      }));

      wc.on('server-ready', async (port: number, url: string) => {
        console.log('Dev server ready at:', url);
        
        // CRITICAL: Push all latest generated files from filesRef.current
        for (const [filePath, content] of Object.entries(filesRef.current)) {
          try {
            await writeWebContainerFile(wc, filePath, content);
          } catch (e) {
            console.warn('Sync on server-ready error:', filePath, e);
          }
        }

        setStatus('Ready');
        setStatusDetail('');
        setIframeUrl(url);
        setIsBooting(false);
        isBootingRef.current = false;
      });

    } catch (error: any) {
      console.error('WebContainer Boot Error:', error);
      setStatus('Error');
      setStatusDetail(error.message || 'WebContainer error');
      setIsBooting(false);
      isBootingRef.current = false;
    }
  };

  const handleEditorChange = async (value: string | undefined) => {
    if (!value) return;
    filesRef.current[activeFile] = value;
    setFiles(prev => ({
      ...prev,
      [activeFile]: value
    }));
    
    if (webcontainerRef.current && status === 'Ready') {
      try {
        await writeWebContainerFile(webcontainerRef.current, activeFile, value);
      } catch (err) {
        console.error('Failed to update file:', err);
      }
    }
  };

  const handleRefresh = () => {
    if (iframeRef.current && iframeUrl) {
      iframeRef.current.src = iframeUrl;
    }
  };

  // Calculate stages for the progress checklist
  const getStageState = (stageName: string) => {
    if (status === 'Ready' && iframeUrl) return 'done';
    if (stageName === 'init') return 'done';
    if (stageName === 'packages') {
      if (status === 'Idle') return 'pending';
      if (statusDetail.includes('Mounting') || statusDetail.includes('Installing') || statusDetail.includes('Booting')) return 'current';
      return 'done';
    }
    if (stageName === 'code') {
      if (status === 'Idle') return 'pending';
      if (statusDetail.includes('Mounting') || statusDetail.includes('Installing') || statusDetail.includes('Booting')) return 'pending';
      if (status === 'Generating' || generatingFile) return 'current';
      if (status === 'Ready') return 'done';
      return 'pending';
    }
    if (stageName === 'server') {
      if (iframeUrl) return 'done';
      if (statusDetail.includes('Starting') || statusDetail.includes('dev server')) return 'current';
      return 'pending';
    }
    return 'pending';
  };

  const progressPercent = useMemo(() => {
    if (status === 'Ready' && iframeUrl) return 100;
    if (status === 'Idle') return 0;
    if (status === 'Generating') {
      if (statusDetail.includes('Starting') || iframeUrl) return 85;
      if (generatingFile) return 65;
      if (statusDetail.includes('Installing')) return 35;
      return 25;
    }
    return 50;
  }, [status, statusDetail, generatingFile, iframeUrl]);

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
        padding: '8px 16px',
        borderBottom: '1px solid var(--border-subtle)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        background: 'rgba(255, 255, 255, 0.015)',
        flexShrink: 0
      }}>
        {/* Modern 3-Way Segmented Control */}
        <div className="segmented-control">
          <button 
            onClick={() => setActiveTab('code')}
            className={`segmented-tab ${activeTab === 'code' ? 'active' : ''}`}
            title="Inspect & Edit Code"
          >
            <Code2 size={13} /> 
            <span>Code</span>
          </button>
          <button 
            onClick={() => setActiveTab('preview')}
            className={`segmented-tab ${activeTab === 'preview' ? 'active' : ''}`}
            title="Live Application Preview"
          >
            <Monitor size={13} /> 
            <span>Preview</span>
          </button>
          <button 
            onClick={() => setActiveTab('console')}
            className={`segmented-tab ${activeTab === 'console' ? 'active' : ''}`}
            title="Terminal & Dev Server Logs"
          >
            <Terminal size={13} /> 
            <span>Console</span>
            {consoleLogs.length > 0 && (
              <span style={{
                fontSize: '9px',
                padding: '1px 5px',
                borderRadius: '4px',
                background: 'rgba(255, 255, 255, 0.1)',
                color: 'var(--text-muted)'
              }}>
                {consoleLogs.length}
              </span>
            )}
          </button>
        </div>

        {/* Right side controls */}
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <div className={`status-badge ${status.toLowerCase()}`}>
            <span className={`status-dot ${status.toLowerCase()}`} />
            <span>{status === 'Generating' ? (generatingFile ? 'Writing code...' : 'Generating...') : status}</span>
          </div>

          <button className="icon-btn" title="Refresh preview" onClick={handleRefresh} disabled={!iframeUrl}>
            <RefreshCw size={14} />
          </button>
          <button className="icon-btn" title="Open preview in new tab" onClick={() => iframeUrl && window.open(iframeUrl, '_blank')} disabled={!iframeUrl}>
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
                        borderBottom: isActive ? '2px solid var(--accent-secondary)' : '2px solid transparent',
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
                      <Code2 size={13} color={isActive ? 'var(--accent-light)' : undefined} />
                      <span>{name}</span>
                    </div>
                  );
                })}
              </div>

              {/* Breadcrumbs & Editor Action Toolbar */}
              <div style={{
                padding: '5px 14px',
                background: 'rgba(255, 255, 255, 0.015)',
                borderBottom: '1px solid var(--border-subtle)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                fontSize: '11px',
                fontFamily: 'var(--font-mono)',
                color: 'var(--text-muted)'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <FolderCode size={12} color="var(--accent-secondary)" />
                  <span>src</span>
                  <span style={{ opacity: 0.4 }}>/</span>
                  <span style={{ color: '#f3f4f6', fontWeight: 600 }}>{activeFile.split('/').pop()}</span>
                  <span style={{ opacity: 0.4 }}>•</span>
                  <span>{(files[activeFile] || '').split('\n').length} lines</span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
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
                    wordWrap: 'on',
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
                <span style={{ fontSize: '10px', color: '#10b981', background: 'rgba(16, 185, 129, 0.1)', padding: '2px 6px', borderRadius: '4px' }}>WebContainer Active</span>
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
        ) : (
          /* PREVIEW TAB */
          <div style={{ 
            height: '100%', 
            width: '100%',
            display: 'flex', 
            background: 'var(--bg-base)',
            position: 'relative',
            overflow: 'hidden'
          }}>
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
                background: 'radial-gradient(circle at 50% 45%, rgba(99, 102, 241, 0.07) 0%, transparent 60%)'
              }}>
                <div style={{ position: 'relative', width: '96px', height: '96px', marginBottom: '20px' }}>
                  <div style={{
                    position: 'absolute',
                    inset: 0,
                    borderRadius: '16px',
                    background: 'linear-gradient(135deg, rgba(20, 24, 33, 0.95), rgba(30, 27, 46, 0.95))',
                    border: '1px solid rgba(168, 85, 247, 0.3)',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '10px',
                    boxShadow: '0 12px 36px rgba(0, 0, 0, 0.4), 0 0 24px rgba(99, 102, 241, 0.2)'
                  }}>
                    <Sparkles size={24} color="#c084fc" />
                  </div>
                </div>

                <h3 style={{
                  fontSize: '18px',
                  fontWeight: 600,
                  color: 'var(--text-primary)',
                  marginBottom: '8px',
                  fontFamily: "'Outfit', sans-serif"
                }}>
                  Your Live Preview Awaits
                </h3>

                <p style={{
                  fontSize: '13px',
                  color: 'var(--text-secondary)',
                  maxWidth: '380px',
                  lineHeight: 1.5,
                  marginBottom: '20px'
                }}>
                  Ask the AI assistant to build any app or component. BrainHalf generates React code and mounts it in WebContainer immediately.
                </p>

                <button className="button-primary" onClick={bootWebContainer}>
                  <Play size={14} fill="white" /> Launch WebContainer Preview
                </button>
              </div>
            ) : iframeUrl ? (
              /* Live Iframe Preview */
              <iframe
                ref={iframeRef}
                src={iframeUrl}
                style={{
                  width: '100%',
                  height: '100%',
                  border: 'none',
                  background: 'white'
                }}
                title="Live Application Preview"
                allow="cross-origin-isolated"
              />
            ) : status === 'Error' ? (
              /* Error State */
              <div style={{
                height: '100%',
                width: '100%',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '14px',
                padding: '32px',
                textAlign: 'center'
              }}>
                <div style={{
                  width: '52px',
                  height: '52px',
                  borderRadius: '50%',
                  background: 'rgba(239, 68, 68, 0.1)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: '1px solid rgba(239, 68, 68, 0.3)'
                }}>
                  <AlertCircle size={28} color="#ef4444" />
                </div>
                <h3 style={{ fontSize: '16px', fontWeight: 600, color: '#f87171' }}>Preview Generation Error</h3>
                <p style={{ fontSize: '13px', color: 'var(--text-secondary)', maxWidth: '380px', lineHeight: 1.5 }}>
                  {statusDetail || 'An error occurred while compiling code.'}
                </p>
                <button className="button-primary" onClick={bootWebContainer}>
                  <Play size={14} fill="white" /> Retry Preview
                </button>
              </div>
            ) : (
              /* Intentional, High-Polish Generation Experience (Solves Problem #9) */
              <div style={{
                width: '100%',
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '24px',
                background: 'radial-gradient(circle at 50% 40%, rgba(168, 85, 247, 0.08) 0%, transparent 70%)'
              }}>
                <div style={{
                  width: '100%',
                  maxWidth: '440px',
                  background: 'rgba(18, 21, 32, 0.85)',
                  border: '1px solid rgba(168, 85, 247, 0.25)',
                  borderRadius: '16px',
                  padding: '28px 24px',
                  boxShadow: '0 16px 48px rgba(0, 0, 0, 0.45), 0 0 32px rgba(168, 85, 247, 0.12)',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  textAlign: 'center',
                  backdropFilter: 'blur(12px)'
                }}>
                  {/* Glowing Sparkles Avatar */}
                  <div style={{
                    width: '56px',
                    height: '56px',
                    borderRadius: '14px',
                    background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.25), rgba(168, 85, 247, 0.35))',
                    border: '1px solid rgba(168, 85, 247, 0.4)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginBottom: '16px',
                    boxShadow: '0 0 20px rgba(168, 85, 247, 0.35)'
                  }}>
                    <Sparkles size={24} color="#c084fc" />
                  </div>

                  <h3 style={{
                    fontSize: '17px',
                    fontWeight: 600,
                    color: '#ffffff',
                    margin: '0 0 6px 0',
                    fontFamily: 'var(--font-brand)'
                  }}>
                    Building your application
                  </h3>

                  <p style={{
                    fontSize: '12.5px',
                    color: 'var(--text-secondary)',
                    margin: '0 0 22px 0',
                    maxWidth: '340px',
                    lineHeight: 1.5
                  }}>
                    {generatingFile ? `Writing ${generatingFile}...` : statusDetail || 'Generating React components and launching live preview...'}
                  </p>

                  {/* Staged Checklist */}
                  <div style={{
                    width: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '10px',
                    background: 'rgba(0, 0, 0, 0.3)',
                    padding: '14px 16px',
                    borderRadius: '10px',
                    border: '1px solid var(--border-subtle)',
                    marginBottom: '20px',
                    textAlign: 'left'
                  }}>
                    {/* Stage 1: Workspace */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '9px', fontSize: '12.5px' }}>
                      <CheckCircle2 size={15} color="#10b981" />
                      <span style={{ color: '#e2e8f0' }}>Project workspace initialized</span>
                    </div>

                    {/* Stage 2: Runtime */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '9px', fontSize: '12.5px' }}>
                      {getStageState('packages') === 'done' ? (
                        <CheckCircle2 size={15} color="#10b981" />
                      ) : (
                        <Loader2 size={15} className="lucide-spin" color="#a855f7" />
                      )}
                      <span style={{ color: getStageState('packages') === 'done' ? '#e2e8f0' : '#ffffff' }}>
                        Dependencies & runtime ready
                      </span>
                    </div>

                    {/* Stage 3: Code Generation */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '9px', fontSize: '12.5px' }}>
                      {getStageState('code') === 'done' ? (
                        <CheckCircle2 size={15} color="#10b981" />
                      ) : getStageState('code') === 'current' ? (
                        <Loader2 size={15} className="lucide-spin" color="#a855f7" />
                      ) : (
                        <span style={{ width: '15px', height: '15px', borderRadius: '50%', border: '1px solid #4b5563', display: 'inline-block' }} />
                      )}
                      <span style={{ color: getStageState('code') === 'current' ? '#ffffff' : '#94a3b8' }}>
                        Generating {generatingFile ? generatingFile.split('/').pop() : 'components'}
                      </span>
                    </div>

                    {/* Stage 4: Preview Launch */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '9px', fontSize: '12.5px' }}>
                      {iframeUrl ? (
                        <CheckCircle2 size={15} color="#10b981" />
                      ) : getStageState('server') === 'current' ? (
                        <Loader2 size={15} className="lucide-spin" color="#a855f7" />
                      ) : (
                        <span style={{ width: '15px', height: '15px', borderRadius: '50%', border: '1px solid #4b5563', display: 'inline-block' }} />
                      )}
                      <span style={{ color: getStageState('server') === 'current' ? '#ffffff' : '#94a3b8' }}>
                        Launching live preview
                      </span>
                    </div>
                  </div>

                  {/* Animated Progress Bar */}
                  <div style={{
                    width: '100%',
                    height: '6px',
                    borderRadius: '3px',
                    background: 'rgba(255, 255, 255, 0.08)',
                    overflow: 'hidden',
                    marginBottom: '8px'
                  }}>
                    <div style={{
                      height: '100%',
                      width: `${progressPercent}%`,
                      background: 'linear-gradient(90deg, #6366f1, #a855f7)',
                      borderRadius: '3px',
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
                    <span>Vite Hot Reload</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default Workspace;
