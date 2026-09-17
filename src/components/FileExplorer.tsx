import React from 'react';
import { FileCode, FileText, FileJson, Palette, Server, Database, Key } from 'lucide-react';

interface FileExplorerProps {
  files: { [path: string]: string };
  activeFile: string;
  onSelectFile: (path: string) => void;
  headerTitle?: string;
  filter?: (path: string) => boolean;
  onAddBackend?: () => void;
}

const isServerFile = (path: string) =>
  path.startsWith('/server/') || path.startsWith('server/') || path.includes('.env') || path.includes('db.js');

const FileExplorer: React.FC<FileExplorerProps> = ({ files, activeFile, onSelectFile, headerTitle, filter, onAddBackend }) => {
  const getFileIcon = (path: string) => {
    if (path.includes('.env')) {
      return <Key size={16} strokeWidth={1.75} color="#10b981" />;
    }
    if (path.includes('db.js') || path.includes('database')) {
      return <Database size={16} strokeWidth={1.75} color="#f59e0b" />;
    }
    if (isServerFile(path)) {
      return <Server size={16} strokeWidth={1.75} color="#a855f7" />;
    }
    if (path.endsWith('.jsx') || path.endsWith('.tsx')) {
      return <FileCode size={16} strokeWidth={1.75} color="#38bdf8" />;
    }
    if (path.endsWith('.js') || path.endsWith('.ts')) {
      return <FileCode size={16} strokeWidth={1.75} color="#60a5fa" />;
    }
    if (path.endsWith('.css')) {
      return <Palette size={16} strokeWidth={1.75} color="var(--accent-light)" />;
    }
    if (path.endsWith('.json')) {
      return <FileJson size={16} strokeWidth={1.75} color="#facc15" />;
    }
    return <FileText size={16} strokeWidth={1.75} color="var(--text-muted)" />;
  };

  const rawPaths = Object.keys(files);
  const filePaths = (filter ? rawPaths.filter(filter) : rawPaths).sort();
  const clientFiles = filePaths.filter(p => !isServerFile(p));
  const serverFiles = filePaths.filter(isServerFile);

  const renderFileItem = (path: string) => {
    const isActive = path === activeFile;
    const fileName = path.split('/').pop() || path;
    const isServer = isServerFile(path);

    return (
      <div
        key={path}
        role="treeitem"
        aria-selected={isActive}
        tabIndex={0}
        className={`file-tree-item ${isActive ? 'active' : ''}`}
        onClick={() => onSelectFile(path)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            onSelectFile(path);
          }
        }}
        title={path}
      >
        {getFileIcon(path)}
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '12px', fontFamily: 'var(--font-mono)' }}>
          {fileName}
        </span>
        {isServer && (
          <span style={{ marginLeft: 'auto', fontSize: '9px', color: '#c084fc', opacity: 0.8, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            API
          </span>
        )}
      </div>
    );
  };

  return (
    <div className="file-explorer-container" role="tree" aria-label="Project files">
      <div style={{
        padding: '12px 16px',
        borderBottom: '1px solid var(--border-subtle)',
        fontSize: '11px',
        fontWeight: 600,
        color: 'var(--text-muted)',
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        background: 'rgba(255, 255, 255, 0.015)'
      }}>
        <span>{headerTitle || 'Project files'}</span>
        <span style={{ fontSize: '10px', color: 'var(--accent-light)', background: 'rgba(168, 85, 247, 0.1)', padding: '1px 6px', borderRadius: '4px' }}>
          {filePaths.length}
        </span>
      </div>

      <div style={{ padding: '8px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '2px' }}>
        {serverFiles.length > 0 ? (
          <>
            <div style={{ padding: '6px 8px 4px', fontSize: '10px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span>Client (Frontend)</span>
              <span style={{ fontSize: '9px', opacity: 0.7 }}>{clientFiles.length}</span>
            </div>
            {clientFiles.map(renderFileItem)}

            <div style={{ padding: '12px 8px 4px', fontSize: '10px', fontWeight: 600, color: '#c084fc', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <Server size={11} strokeWidth={2} /> Server (Express)
              </span>
              <span style={{ fontSize: '9px', opacity: 0.7 }}>{serverFiles.length}</span>
            </div>
            {serverFiles.map(renderFileItem)}
          </>
        ) : (
          <>
            {clientFiles.map(renderFileItem)}
            {onAddBackend && (
              <div style={{ marginTop: '16px', padding: '0 4px' }}>
                <button
                  type="button"
                  onClick={onAddBackend}
                  style={{
                    width: '100%',
                    padding: '6px 8px',
                    fontSize: '11px',
                    color: '#c084fc',
                    background: 'rgba(168, 85, 247, 0.08)',
                    border: '1px dashed rgba(168, 85, 247, 0.3)',
                    borderRadius: '6px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}
                  className="hover-bright"
                  title="Scaffold an Express REST backend for this project"
                >
                  <Server size={12} strokeWidth={2} /> + Add Backend API
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default FileExplorer;
