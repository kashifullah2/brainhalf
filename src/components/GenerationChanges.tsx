import React, { useState } from 'react';
import { ChevronDown, ChevronRight, ExternalLink, FileDiff, FileMinus, FilePlus, FileText } from 'lucide-react';
import { computeLineDiff, type FileChange } from '../lib/file-diff';
import { appEvents } from '../lib/events';
import { normalizePath } from '../lib/utils';

/** Old/new file contents for inline diff rendering — only kept in memory for
 *  the live session, so restored chats may not have them. */
export interface ChangeContent {
  path: string;
  before: string;
  after: string;
}

interface GenerationChangesProps {
  changes: FileChange[];
  contents?: ChangeContent[];
}

const KIND_META: Record<FileChange['kind'], { label: string; color: string; icon: React.ReactNode }> = {
  added:    { label: 'new',     color: 'var(--color-success)', icon: <FilePlus size={12} /> },
  modified: { label: 'edited',  color: 'var(--color-info)',    icon: <FileText size={12} /> },
  deleted:  { label: 'removed', color: 'var(--color-error)',   icon: <FileMinus size={12} /> },
};

function InlineDiff({ before, after }: { before: string; after: string }) {
  const lines = computeLineDiff(before, after);
  if (lines === null) {
    return <div style={{ padding: '8px 12px', fontSize: '12px', color: 'var(--text-muted)' }}>Change is too large to display inline — open the file to review it.</div>;
  }
  const visible = lines.filter(line => line.type !== 'same');
  if (visible.length === 0) {
    return <div style={{ padding: '8px 12px', fontSize: '12px', color: 'var(--text-muted)' }}>No line differences.</div>;
  }
  return (
    <pre style={{
      margin: 0,
      padding: '8px 0',
      maxHeight: '260px',
      overflow: 'auto',
      fontFamily: 'var(--font-mono)',
      fontSize: '11.5px',
      lineHeight: 1.55,
    }}>
      {visible.map((line, index) => (
        <div
          key={index}
          style={{
            padding: '0 12px',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            color: line.type === 'added' ? 'var(--color-success)' : 'var(--color-error)',
            background: line.type === 'added' ? 'rgba(34, 197, 94, 0.08)' : 'rgba(239, 68, 68, 0.08)',
          }}
        >
          {line.type === 'added' ? '+ ' : '- '}{line.text}
        </div>
      ))}
    </pre>
  );
}

/**
 * Compact per-generation diff summary shown in the chat after the builder
 * finishes: which files were added/edited/removed and by how much, with an
 * expandable inline diff per file when the contents are still in memory.
 */
export const GenerationChanges: React.FC<GenerationChangesProps> = ({ changes, contents }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [diffPath, setDiffPath] = useState<string | null>(null);
  if (changes.length === 0) return null;

  const totalAdded = changes.reduce((sum, change) => sum + change.added, 0);
  const totalRemoved = changes.reduce((sum, change) => sum + change.removed, 0);
  const contentByPath = new Map((contents ?? []).map(content => [content.path, content]));

  return (
    <div className="generation-changes-card" style={{
      border: '1px solid var(--border-color)',
      borderRadius: 'var(--radius-asym-sm, 10px 4px 10px 4px)',
      background: 'var(--bg-card)',
      overflow: 'hidden',
      margin: '8px 0',
      fontSize: '12px',
    }}>
      <button
        type="button"
        onClick={() => setIsExpanded(current => !current)}
        aria-expanded={isExpanded}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          width: '100%',
          padding: '8px 12px',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          color: 'var(--text-primary)',
          fontSize: '12px',
          textAlign: 'left',
        }}
      >
        {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <FileDiff size={13} style={{ color: 'var(--color-info)', flexShrink: 0 }} />
        <span style={{ fontWeight: 600 }}>
          {changes.length} file{changes.length === 1 ? '' : 's'} changed
        </span>
        <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: '11px', flexShrink: 0 }}>
          <span style={{ color: 'var(--color-success)' }}>+{totalAdded}</span>
          {' '}
          <span style={{ color: 'var(--color-error)' }}>−{totalRemoved}</span>
        </span>
      </button>

      {isExpanded && (
        <ul style={{ margin: 0, padding: '4px 0', listStyle: 'none', borderTop: '1px solid var(--border-subtle)' }}>
          {changes.map(change => {
            const meta = KIND_META[change.kind];
            const content = contentByPath.get(change.path);
            const diffOpen = diffPath === change.path;
            return (
              <li key={change.path} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '7px', padding: '6px 12px', flexWrap: 'wrap' }}>
                  <span style={{ color: meta.color, display: 'flex', flexShrink: 0 }}>{meta.icon}</span>
                  <code style={{
                    flex: 1,
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    fontSize: '11.5px',
                    color: 'var(--text-primary)',
                  }}>
                    {change.path}
                  </code>
                  <span style={{
                    fontSize: '10px',
                    color: meta.color,
                    background: 'var(--bg-surface-2)',
                    padding: '1px 7px',
                    borderRadius: '4px',
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                    flexShrink: 0,
                  }}>
                    {meta.label}
                  </span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', flexShrink: 0 }}>
                    {change.added > 0 && <span style={{ color: 'var(--color-success)' }}>+{change.added} </span>}
                    {change.removed > 0 && <span style={{ color: 'var(--color-error)' }}>−{change.removed}</span>}
                  </span>
                  <span style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                    {content && change.kind !== 'deleted' && (
                      <button
                        type="button"
                        onClick={() => setDiffPath(current => (current === change.path ? null : change.path))}
                        aria-expanded={diffOpen}
                        style={{ background: 'transparent', border: '1px solid var(--border-subtle)', borderRadius: '5px', padding: '2px 8px', fontSize: '10.5px', color: 'var(--text-secondary)', cursor: 'pointer' }}
                      >
                        {diffOpen ? 'Hide changes' : 'Show changes'}
                      </button>
                    )}
                    {change.kind !== 'deleted' && (
                      <button
                        type="button"
                        onClick={() => appEvents.emit('open-file', { path: normalizePath(change.path) })}
                        title="Open in editor"
                        style={{ background: 'transparent', border: '1px solid var(--border-subtle)', borderRadius: '5px', padding: '2px 8px', fontSize: '10.5px', color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '3px' }}
                      >
                        <ExternalLink size={10} />Open
                      </button>
                    )}
                  </span>
                </div>
                {diffOpen && content && (
                  <div style={{ borderTop: '1px solid var(--border-subtle)', background: 'var(--bg-surface)' }}>
                    <InlineDiff before={content.before} after={content.after} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

export default GenerationChanges;
