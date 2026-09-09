import React from 'react';
import { FileCode, FileText, FileJson, Palette } from 'lucide-react';

interface FileExplorerProps {
  files: { [path: string]: string };
  activeFile: string;
  onSelectFile: (path: string) => void;
}

const FileExplorer: React.FC<FileExplorerProps> = ({ files, activeFile, onSelectFile }) => {
  const getFileIcon = (path: string) => {
    if (path.endsWith('.jsx') || path.endsWith('.tsx')) {
      return <FileCode size={14} color="#38bdf8" />;
    }
    if (path.endsWith('.js') || path.endsWith('.ts')) {
      return <FileCode size={14} color="#60a5fa" />;
    }
    if (path.endsWith('.css')) {
      return <Palette size={14} color="var(--accent-light)" />;
    }
    if (path.endsWith('.json')) {
      return <FileJson size={14} color="#facc15" />;
    }
    return <FileText size={14} color="var(--text-muted)" />;
  };

  const filePaths = Object.keys(files).sort();

  return (
    <div className="file-explorer-container">
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
        <span>Files</span>
        <span style={{ fontSize: '10px', color: 'var(--accent-light)', background: 'rgba(168, 85, 247, 0.1)', padding: '1px 6px', borderRadius: '4px' }}>
          {filePaths.length}
        </span>
      </div>
      <div style={{ padding: '8px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '2px' }}>
        {filePaths.map(path => {
          const isActive = path === activeFile;
          const fileName = path.split('/').pop() || path;
          
          return (
            <div
              key={path}
              className={`file-tree-item ${isActive ? 'active' : ''}`}
              onClick={() => onSelectFile(path)}
              title={path}
            >
              {getFileIcon(path)}
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '12px', fontFamily: 'var(--font-mono)' }}>
                {fileName}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default FileExplorer;
