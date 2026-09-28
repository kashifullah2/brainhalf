import React, { useRef, useState } from 'react';
import { FileCode, FileText, FileJson, Palette, Server, Database, Key, Plus, Pencil, Trash2, X, Check } from 'lucide-react';

interface FileExplorerProps {
  files: { [path: string]: string };
  activeFile: string;
  onSelectFile: (path: string) => void;
  headerTitle?: string;
  filter?: (path: string) => boolean;
  onCreateFile?: (path: string) => void;
  onRenameFile?: (oldPath: string, newPath: string) => void;
  onDeleteFile?: (path: string) => void;
  readOnly?: boolean;
}

const isServerFile = (path: string) =>
  path.startsWith('/server/') || path.startsWith('server/') || path.includes('.env') || path.includes('db.js');

function getFileIcon(path: string) {
  if (path.includes('.env')) return <Key size={14} strokeWidth={1.75} color="var(--color-success)" />;
  if (path.includes('db.js') || path.includes('database')) return <Database size={14} strokeWidth={1.75} color="var(--color-warning)" />;
  if (isServerFile(path)) return <Server size={14} strokeWidth={1.75} color="var(--color-code-violet)" />;
  if (path.endsWith('.jsx') || path.endsWith('.tsx') || path.endsWith('.js') || path.endsWith('.ts')) return <FileCode size={14} strokeWidth={1.75} color="var(--color-info)" />;
  if (path.endsWith('.css')) return <Palette size={14} strokeWidth={1.75} color="var(--accent-light)" />;
  if (path.endsWith('.json')) return <FileJson size={14} strokeWidth={1.75} color="var(--color-warning)" />;
  return <FileText size={14} strokeWidth={1.75} color="var(--text-muted)" />;
}

function normalizePath(raw: string): string {
  const p = raw.trim();
  if (!p) return '';
  return p.startsWith('/') ? p : `/${p}`;
}

const FileExplorer: React.FC<FileExplorerProps> = ({
  files, activeFile, onSelectFile, headerTitle, filter,
  onCreateFile, onRenameFile, onDeleteFile, readOnly = false,
}) => {
  const [hoveredFile, setHoveredFile] = useState<string | null>(null);
  const [renamingFile, setRenamingFile] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [creating, setCreating] = useState(false);
  const [newFileName, setNewFileName] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const renameRef = useRef<HTMLInputElement>(null);
  const newFileRef = useRef<HTMLInputElement>(null);

  const canEdit = !readOnly && (onCreateFile || onRenameFile || onDeleteFile);

  const rawPaths = Object.keys(files);
  const filePaths = (filter ? rawPaths.filter(filter) : rawPaths).sort();
  const clientFiles = filePaths.filter(p => !isServerFile(p));
  const serverFiles = filePaths.filter(isServerFile);

  function startRename(path: string) {
    setRenamingFile(path);
    setRenameValue(path.startsWith('/') ? path.slice(1) : path);
    setTimeout(() => renameRef.current?.select(), 30);
  }

  function commitRename() {
    if (!renamingFile || !onRenameFile) { setRenamingFile(null); return; }
    const newPath = normalizePath(renameValue);
    if (newPath && newPath !== renamingFile && !files[newPath]) {
      onRenameFile(renamingFile, newPath);
    }
    setRenamingFile(null);
  }

  function startCreate() {
    setCreating(true);
    setNewFileName('src/');
    setTimeout(() => { newFileRef.current?.focus(); newFileRef.current?.select(); }, 30);
  }

  function commitCreate() {
    if (!onCreateFile) { setCreating(false); return; }
    const newPath = normalizePath(newFileName);
    if (newPath && !files[newPath]) {
      onCreateFile(newPath);
    }
    setCreating(false);
    setNewFileName('');
  }

  const renderFileItem = (path: string) => {
    const isActive = path === activeFile;
    const fileName = path.split('/').pop() || path;
    const isServer = isServerFile(path);
    const isHovered = hoveredFile === path;
    const isRenaming = renamingFile === path;
    const isDeleteConfirm = confirmDelete === path;

    if (isDeleteConfirm) {
      return (
        <div key={path} className="file-tree-item active" style={{ gap: '6px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '11px', color: 'var(--color-error)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            Delete {fileName}?
          </span>
          <button
            onClick={() => { onDeleteFile?.(path); setConfirmDelete(null); }}
            title="Confirm delete"
            style={{ background: 'var(--color-error)', border: 'none', borderRadius: '3px', padding: '2px 7px', color: '#fff', fontSize: '10px', cursor: 'pointer', flexShrink: 0 }}
          >
            Delete
          </button>
          <button
            onClick={() => setConfirmDelete(null)}
            title="Cancel"
            style={{ background: 'transparent', border: '1px solid var(--border-subtle)', borderRadius: '3px', padding: '2px 6px', color: 'var(--text-muted)', fontSize: '10px', cursor: 'pointer', flexShrink: 0 }}
          >
            Cancel
          </button>
        </div>
      );
    }

    if (isRenaming) {
      return (
        <div key={path} className="file-tree-item active" style={{ gap: '4px' }}>
          <input
            ref={renameRef}
            value={renameValue}
            onChange={e => setRenameValue(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') commitRename(); else if (e.key === 'Escape') setRenamingFile(null); }}
            onBlur={commitRename}
            style={{ flex: 1, minWidth: 0, background: 'var(--bg-input, rgba(0,0,0,0.2))', border: '1px solid var(--accent-primary)', borderRadius: '3px', color: 'var(--text-primary)', fontSize: '11px', fontFamily: 'var(--font-mono)', padding: '1px 4px', outline: 'none' }}
            aria-label="Rename file"
            autoFocus
          />
          <button onClick={commitRename} title="Confirm rename" style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '1px', color: 'var(--color-success)', flexShrink: 0, display: 'flex' }}><Check size={12} /></button>
          <button onClick={() => setRenamingFile(null)} title="Cancel rename" style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '1px', color: 'var(--text-muted)', flexShrink: 0, display: 'flex' }}><X size={12} /></button>
        </div>
      );
    }

    return (
      <div
        key={path}
        role="treeitem"
        aria-selected={isActive}
        tabIndex={0}
        className={`file-tree-item ${isActive ? 'active' : ''}`}
        onClick={() => onSelectFile(path)}
        onDoubleClick={() => canEdit && onRenameFile && startRename(path)}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') onSelectFile(path); }}
        onMouseEnter={() => setHoveredFile(path)}
        onMouseLeave={() => setHoveredFile(null)}
        title={path}
        style={{ position: 'relative' }}
      >
        {getFileIcon(path)}
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '12px', fontFamily: 'var(--font-mono)', flex: 1, minWidth: 0 }}>
          {fileName}
        </span>
        {isServer && !isHovered && (
          <span style={{ marginLeft: 'auto', fontSize: '9px', color: 'var(--color-code-violet)', opacity: 0.8, textTransform: 'uppercase', letterSpacing: '0.04em', flexShrink: 0 }}>
            API
          </span>
        )}
        {canEdit && isHovered && (
          <span style={{ display: 'flex', gap: '2px', marginLeft: 'auto', flexShrink: 0 }}>
            {onRenameFile && (
              <button
                onClick={e => { e.stopPropagation(); startRename(path); }}
                title="Rename file"
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '1px 3px', color: 'var(--text-muted)', display: 'flex', borderRadius: '3px' }}
                onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-primary)')}
                onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}
              >
                <Pencil size={11} />
              </button>
            )}
            {onDeleteFile && (
              <button
                onClick={e => { e.stopPropagation(); setConfirmDelete(path); }}
                title="Delete file"
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '1px 3px', color: 'var(--text-muted)', display: 'flex', borderRadius: '3px' }}
                onMouseEnter={e => (e.currentTarget.style.color = 'var(--color-error)')}
                onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}
              >
                <Trash2 size={11} />
              </button>
            )}
          </span>
        )}
      </div>
    );
  };

  return (
    <div className="file-explorer-container" role="tree" aria-label="Project files">
      <div className="studio-files-heading" style={{
        padding: '8px 10px 8px 16px',
        borderBottom: '1px solid var(--border-subtle)',
        fontSize: '11px',
        fontWeight: 600,
        color: 'var(--text-muted)',
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        background: 'rgba(36, 60, 75, 0.015)'
      }}>
        <span style={{ flex: 1 }}>{headerTitle || 'Project files'}</span>
        <span style={{ fontSize: '10px', color: 'var(--accent-light)', background: 'rgba(168, 85, 247, 0.1)', padding: '1px 6px', borderRadius: '4px', flexShrink: 0 }}>
          {filePaths.length}
        </span>
        {canEdit && onCreateFile && (
          <button
            onClick={startCreate}
            title="New file"
            aria-label="New file"
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', padding: '2px', borderRadius: '4px', flexShrink: 0 }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-primary)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}
          >
            <Plus size={14} />
          </button>
        )}
      </div>

      <div style={{ padding: '8px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '2px' }}>
        {serverFiles.length > 0 ? (
          <>
            <div style={{ padding: '6px 8px 4px', fontSize: '10px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span>Client (Frontend)</span>
              <span style={{ fontSize: '9px', opacity: 0.7 }}>{clientFiles.length}</span>
            </div>
            {clientFiles.map(renderFileItem)}

            <div style={{ padding: '12px 8px 4px', fontSize: '10px', fontWeight: 600, color: 'var(--color-code-violet)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <Server size={11} strokeWidth={2} /> Backend
              </span>
              <span style={{ fontSize: '9px', opacity: 0.7 }}>{serverFiles.length}</span>
            </div>
            {serverFiles.map(renderFileItem)}
          </>
        ) : (
          clientFiles.map(renderFileItem)
        )}

        {creating && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '4px 4px' }}>
            {getFileIcon(newFileName)}
            <input
              ref={newFileRef}
              value={newFileName}
              onChange={e => setNewFileName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') commitCreate(); else if (e.key === 'Escape') setCreating(false); }}
              onBlur={() => setTimeout(() => setCreating(false), 150)}
              placeholder="src/NewFile.tsx"
              style={{ flex: 1, minWidth: 0, background: 'var(--bg-input, rgba(0,0,0,0.2))', border: '1px solid var(--accent-primary)', borderRadius: '3px', color: 'var(--text-primary)', fontSize: '11px', fontFamily: 'var(--font-mono)', padding: '2px 5px', outline: 'none' }}
              aria-label="New file path"
            />
            <button onClick={commitCreate} title="Create" style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '1px', color: 'var(--color-success)', display: 'flex', flexShrink: 0 }}><Check size={12} /></button>
            <button onClick={() => setCreating(false)} title="Cancel" style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '1px', color: 'var(--text-muted)', display: 'flex', flexShrink: 0 }}><X size={12} /></button>
          </div>
        )}
      </div>
    </div>
  );
};

export default FileExplorer;
