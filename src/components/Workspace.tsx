import React, { useState, useEffect, useRef } from 'react';
import { Code2, Monitor, ExternalLink, RefreshCw, Loader2, Play, Sparkles, Lock, AlertCircle } from 'lucide-react';
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
  const [activeTab, setActiveTab] = useState<'code' | 'preview'>('preview');
  const [iframeUrl, setIframeUrl] = useState('');
  const [isBooting, setIsBooting] = useState(false);
  const [status, setStatus] = useState<GenerationStatus>('Idle');
  const [statusDetail, setStatusDetail] = useState('');
  const [hasProject, setHasProject] = useState(false);
  const [generatingFile, setGeneratingFile] = useState('');
  
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

  // Calculate stages for the top progress checklist
  const getStageState = (stageName: string) => {
    if (status === 'Ready') return 'done';
    if (status !== 'Generating') return 'idle';
    if (stageName === 'packages') {
      if (statusDetail.includes('Mounting') || statusDetail.includes('Booting')) return 'current';
      if (statusDetail.includes('Installing')) return 'current';
      return 'done';
    }
    if (stageName === 'build') {
      if (statusDetail.includes('Mounting') || statusDetail.includes('Installing') || statusDetail.includes('Booting')) return 'pending';
      if (statusDetail.includes('Starting') || statusDetail.includes('Writing')) return 'current';
      return 'done';
    }
    if (stageName === 'server') {
      if (statusDetail.includes('Starting')) return 'current';
      return 'pending';
    }
    return 'idle';
  };

  return (
    <div className="workspace-panel-container">
      {/* Workspace Header Tabs & Status */}
      <div style={{
        padding: '8px 16px',
        borderBottom: '1px solid var(--border-subtle)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        background: 'rgba(255, 255, 255, 0.015)',
        flexShrink: 0
      }}>
        {/* Active-tab underline brand tabs */}
        <div className="workspace-tabs">
          <button 
            onClick={() => setActiveTab('code')}
            className={`workspace-tab ${activeTab === 'code' ? 'active' : ''}`}
          >
            <Code2 size={13} /> 
            <span>Code</span>
          </button>
          <button 
            onClick={() => setActiveTab('preview')}
            className={`workspace-tab ${activeTab === 'preview' ? 'active' : ''}`}
          >
            <Monitor size={13} /> 
            <span>Preview</span>
          </button>
        </div>

        {/* Right side controls */}
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <div className={`status-badge ${status.toLowerCase()}`}>
            <span className={`status-dot ${status.toLowerCase()}`} />
            <span>{status}</span>
          </div>

          <button className="icon-btn" title="Refresh preview" onClick={handleRefresh} disabled={!iframeUrl}>
            <RefreshCw size={14} />
          </button>
          <button className="icon-btn" title="Open in new tab" onClick={() => iframeUrl && window.open(iframeUrl, '_blank')} disabled={!iframeUrl}>
            <ExternalLink size={14} />
          </button>
        </div>
      </div>

      {/* Slim Top-of-Panel Staged Checklist Progress Bar when Generating */}
      {status === 'Generating' && (
        <div style={{
          background: 'rgba(15, 18, 28, 0.95)',
          borderBottom: '1px solid rgba(168, 85, 247, 0.25)',
          padding: '8px 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: '11px',
          fontFamily: 'var(--font-mono)',
          color: 'var(--text-secondary)',
          boxShadow: '0 2px 10px rgba(0,0,0,0.3)',
          zIndex: 15
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <span style={{ color: '#c084fc', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Loader2 size={12} className="lucide-spin" />
              BUILD PIPELINE:
            </span>
            
            {/* Stage 1: Installing Packages */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <span style={{
                width: '6px', height: '6px', borderRadius: '50%',
                background: getStageState('packages') === 'done' ? '#10b981' : getStageState('packages') === 'current' ? '#a855f7' : '#4b5563',
                boxShadow: getStageState('packages') === 'current' ? '0 0 6px #a855f7' : 'none'
              }} />
              <span style={{ color: getStageState('packages') === 'current' ? '#ffffff' : 'inherit' }}>
                1. Install Packages
              </span>
            </div>

            <span style={{ opacity: 0.3 }}>→</span>

            {/* Stage 2: Code Generation */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <span style={{
                width: '6px', height: '6px', borderRadius: '50%',
                background: getStageState('build') === 'done' ? '#10b981' : getStageState('build') === 'current' ? '#a855f7' : '#4b5563',
                boxShadow: getStageState('build') === 'current' ? '0 0 6px #a855f7' : 'none'
              }} />
              <span style={{ color: getStageState('build') === 'current' ? '#ffffff' : 'inherit' }}>
                2. Generate Code
              </span>
            </div>

            <span style={{ opacity: 0.3 }}>→</span>

            {/* Stage 3: Live Dev Server */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <span style={{
                width: '6px', height: '6px', borderRadius: '50%',
                background: getStageState('server') === 'done' ? '#10b981' : getStageState('server') === 'current' ? '#a855f7' : '#4b5563',
                boxShadow: getStageState('server') === 'current' ? '0 0 6px #a855f7' : 'none'
              }} />
              <span style={{ color: getStageState('server') === 'current' ? '#ffffff' : 'inherit' }}>
                3. Launch Preview
              </span>
            </div>
          </div>

          <div style={{ color: '#c084fc', maxWidth: '280px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {generatingFile ? `writing ${generatingFile}` : statusDetail}
          </div>
        </div>
      )}

      {/* Workspace Content Area */}
      <div style={{ flex: 1, position: 'relative', display: 'flex', overflow: 'hidden' }}>
        {activeTab === 'code' ? (
          <div style={{ display: 'flex', width: '100%', height: '100%' }}>
            <FileExplorer 
              files={files} 
              activeFile={activeFile} 
              onSelectFile={setActiveFile} 
            />
            <div style={{ flex: 1, height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg-code-editor)', overflow: 'hidden' }}>
              {/* Proper Tab Bar above Monaco Editor */}
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

              <div style={{ flex: 1, height: 'calc(100% - 36px)' }}>
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
        ) : (
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
                <div style={{ position: 'relative', width: '110px', height: '110px', marginBottom: '20px' }}>
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
                  Ask the AI assistant to build any component or app. BrainHalf generates modular React code and mounts it in WebContainer immediately.
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
              /* Content-Aware App Skeleton Mock Browser */
              <div className="preview-browser-mock">
                <div className="preview-browser-header">
                  <div className="browser-dots">
                    <div className="browser-dot" style={{ background: '#ef4444' }} />
                    <div className="browser-dot" style={{ background: '#eab308' }} />
                    <div className="browser-dot" style={{ background: '#22c55e' }} />
                  </div>
                  <div className="browser-url-pill">
                    <Lock size={11} style={{ color: 'var(--accent-secondary)' }} />
                    <span>preview.brainhalf.app/live</span>
                  </div>
                </div>

                <div className="preview-skeleton-content" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  {/* Content-Aware Header */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '12px', borderBottom: '1px solid var(--border-subtle)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <div className="skeleton-shimmer" style={{ width: '28px', height: '28px', borderRadius: '6px' }} />
                      <div className="skeleton-shimmer" style={{ width: '110px', height: '14px', borderRadius: '4px' }} />
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <div className="skeleton-shimmer" style={{ width: '60px', height: '14px', borderRadius: '4px' }} />
                      <div className="skeleton-shimmer" style={{ width: '70px', height: '24px', borderRadius: '6px' }} />
                    </div>
                  </div>

                  {/* Content-Aware Body Grid / Dashboard Layout */}
                  <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '16px', flex: 1 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      <div className="skeleton-shimmer" style={{ width: '100%', height: '120px', borderRadius: '8px' }} />
                      <div className="skeleton-shimmer" style={{ width: '100%', height: '160px', borderRadius: '8px' }} />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      <div className="skeleton-shimmer" style={{ width: '100%', height: '80px', borderRadius: '8px' }} />
                      <div className="skeleton-shimmer" style={{ width: '100%', height: '200px', borderRadius: '8px' }} />
                    </div>
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
