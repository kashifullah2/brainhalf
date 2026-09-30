import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Code2, Download, FileText, GitBranch, Monitor,
  RotateCcw, Search, Terminal, Upload,
} from 'lucide-react';
import './CommandPalette.css';

interface PaletteItem {
  id: string;
  label: string;
  detail?: string;
  icon?: React.ReactNode;
  section: 'file' | 'action';
  onSelect: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  files: Record<string, string>;
  onSelectFile: (path: string) => void;
  onSwitchTab: (tab: 'preview' | 'code' | 'console') => void;
  onExportZip: () => void;
  onOpenGithub: () => void;
  onPublish: () => void;
  onUndo?: () => void;
}

function fuzzyMatch(query: string, target: string): number {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  if (!q) return 1;
  if (t === q) return 3;
  if (t.includes(q)) return 2;
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length ? 1 : 0;
}

export default function CommandPalette({
  open, onClose, files, onSelectFile, onSwitchTab,
  onExportZip, onOpenGithub, onPublish, onUndo,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIndex(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const actions: PaletteItem[] = useMemo(() => {
    const items: PaletteItem[] = [
      { id: 'tab:preview', label: 'Preview', detail: 'Switch to preview tab', icon: <Monitor size={15} />, section: 'action', onSelect: () => { onSwitchTab('preview'); onClose(); } },
      { id: 'tab:code', label: 'Code', detail: 'Switch to code editor', icon: <Code2 size={15} />, section: 'action', onSelect: () => { onSwitchTab('code'); onClose(); } },
      { id: 'tab:build', label: 'Console', detail: 'Open the project console', icon: <Terminal size={15} />, section: 'action', onSelect: () => { onSwitchTab('console'); onClose(); } },
      { id: 'act:publish', label: 'Publish', detail: 'Put your project on the internet', icon: <Upload size={15} />, section: 'action', onSelect: () => { onPublish(); onClose(); } },
      { id: 'act:zip', label: 'Download ZIP', detail: 'Export project as ZIP archive', icon: <Download size={15} />, section: 'action', onSelect: () => { onExportZip(); onClose(); } },
      { id: 'act:github', label: 'Export to GitHub', detail: 'Push to GitHub repository', icon: <GitBranch size={15} />, section: 'action', onSelect: () => { onOpenGithub(); onClose(); } },
    ];
    if (onUndo) {
      items.push({ id: 'act:undo', label: 'Undo the builder’s last change', detail: 'Restore to before the last generation', icon: <RotateCcw size={15} />, section: 'action', onSelect: () => { onUndo(); onClose(); } });
    }
    return items;
  }, [onSwitchTab, onExportZip, onOpenGithub, onPublish, onUndo, onClose]);

  const fileItems: PaletteItem[] = useMemo(() =>
    Object.keys(files).sort().map(path => ({
      id: `file:${path}`,
      label: path.split('/').pop() || path,
      detail: path,
      icon: <FileText size={15} />,
      section: 'file' as const,
      onSelect: () => { onSelectFile(path); onClose(); },
    })),
  [files, onSelectFile, onClose]);

  const filtered = useMemo(() => {
    const all = [...fileItems, ...actions];
    if (!query.trim()) return all;
    return all
      .map(item => ({ item, score: Math.max(fuzzyMatch(query, item.label), fuzzyMatch(query, item.detail || '')) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .map(({ item }) => item);
  }, [query, fileItems, actions]);

  useEffect(() => { setActiveIndex(0); }, [query]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex(i => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && filtered[activeIndex]) {
      e.preventDefault();
      filtered[activeIndex].onSelect();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  }, [filtered, activeIndex, onClose]);

  useEffect(() => {
    const active = listRef.current?.querySelector('[data-active="true"]');
    active?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  if (!open) return null;

  const fileResults = filtered.filter(i => i.section === 'file');
  const actionResults = filtered.filter(i => i.section === 'action');

  return (
    <div className="cmd-palette-backdrop" onClick={onClose}>
      <div className="cmd-palette" onClick={e => e.stopPropagation()} role="dialog" aria-label="Command palette">
        <div className="cmd-palette-input-row">
          <Search size={16} className="cmd-palette-search-icon" />
          <input
            ref={inputRef}
            className="cmd-palette-input"
            placeholder="Search files and actions..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            aria-label="Search files and actions"
            autoComplete="off"
            spellCheck={false}
          />
          <kbd className="cmd-palette-kbd">ESC</kbd>
        </div>

        <div className="cmd-palette-list" ref={listRef} role="listbox">
          {filtered.length === 0 && (
            <div className="cmd-palette-empty">No results for &ldquo;{query}&rdquo;</div>
          )}

          {fileResults.length > 0 && (
            <>
              <div className="cmd-palette-section-header">Files</div>
              {fileResults.map((item) => {
                const globalIdx = filtered.indexOf(item);
                return (
                  <button
                    key={item.id}
                    role="option"
                    aria-selected={globalIdx === activeIndex}
                    data-active={globalIdx === activeIndex}
                    className={`cmd-palette-item${globalIdx === activeIndex ? ' active' : ''}`}
                    onClick={item.onSelect}
                    onMouseEnter={() => setActiveIndex(globalIdx)}
                  >
                    <span className="cmd-palette-item-icon">{item.icon}</span>
                    <span className="cmd-palette-item-label">{item.label}</span>
                    {item.detail && item.detail !== item.label && (
                      <span className="cmd-palette-item-detail">{item.detail}</span>
                    )}
                  </button>
                );
              })}
            </>
          )}

          {actionResults.length > 0 && (
            <>
              <div className="cmd-palette-section-header">Actions</div>
              {actionResults.map(item => {
                const globalIdx = filtered.indexOf(item);
                return (
                  <button
                    key={item.id}
                    role="option"
                    aria-selected={globalIdx === activeIndex}
                    data-active={globalIdx === activeIndex}
                    className={`cmd-palette-item${globalIdx === activeIndex ? ' active' : ''}`}
                    onClick={item.onSelect}
                    onMouseEnter={() => setActiveIndex(globalIdx)}
                  >
                    <span className="cmd-palette-item-icon">{item.icon}</span>
                    <span className="cmd-palette-item-label">{item.label}</span>
                    {item.detail && <span className="cmd-palette-item-detail">{item.detail}</span>}
                  </button>
                );
              })}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
