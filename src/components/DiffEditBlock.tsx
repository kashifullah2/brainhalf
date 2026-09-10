import React, { useState } from 'react';
import { Wrench, Check, Copy, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react';
import type { CodeEdit } from '../lib/message-parser';
import { appEvents } from '../lib/events';
import { normalizePath } from '../lib/utils';

interface DiffEditBlockProps {
  filePath: string;
  edits: CodeEdit[];
  isStreaming?: boolean;
}

export const DiffEditBlock: React.FC<DiffEditBlockProps> = ({ filePath, edits, isStreaming }) => {
  const [copied, setCopied] = useState(false);
  const [isExpanded, setIsExpanded] = useState(true);

  const handleCopy = () => {
    const diffText = edits.map(e => `// REMOVED:\n${e.search}\n\n// ADDED:\n${e.replace}`).join('\n\n---\n\n');
    navigator.clipboard.writeText(diffText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleOpenInEditor = () => {
    const cleanPath = normalizePath(filePath);
    appEvents.emit('open-file', { path: cleanPath });
  };

  return (
    <div className="diff-edit-artifact-card" style={{
      borderRadius: '8px',
      border: isStreaming ? '1px solid rgba(168, 85, 247, 0.4)' : '1px solid rgba(59, 130, 246, 0.3)',
      background: 'rgba(15, 17, 26, 0.75)',
      backdropFilter: 'blur(8px)',
      overflow: 'hidden',
      margin: '8px 0',
      transition: 'all 0.15s ease',
      boxShadow: '0 4px 12px rgba(0, 0, 0, 0.2)'
    }}>
      {/* Card Header Bar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 12px',
        background: isStreaming ? 'rgba(168, 85, 247, 0.08)' : 'rgba(59, 130, 246, 0.06)',
        borderBottom: isExpanded ? '1px solid rgba(255, 255, 255, 0.06)' : 'none',
        fontSize: '12px',
        gap: '8px'
      }}>
        {/* Left: Icon & File Path */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flex: 1 }}>
          <div style={{
            width: '24px',
            height: '24px',
            borderRadius: '5px',
            background: 'rgba(59, 130, 246, 0.15)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0
          }}>
            <Wrench size={13} color="#60a5fa" />
          </div>
          
          <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <span style={{ 
              fontFamily: 'var(--font-mono)', 
              fontWeight: 600, 
              color: 'var(--text-primary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              fontSize: '12.5px'
            }}>
              {filePath}
            </span>
            <span style={{ fontSize: '10px', color: '#93c5fd', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span>Targeted Fix Applied</span> • {edits.length} {edits.length === 1 ? 'replacement' : 'replacements'}
            </span>
          </div>
        </div>

        {/* Right: Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
          {isStreaming ? (
            <span style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
              fontSize: '11px',
              color: '#c084fc',
              background: 'rgba(168, 85, 247, 0.12)',
              padding: '3px 8px',
              borderRadius: '4px',
              fontWeight: 500
            }}>
              <span style={{
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                background: '#c084fc',
                animation: 'pulse 1.5s infinite'
              }} />
              Patching...
            </span>
          ) : (
            <span style={{
              fontSize: '10.5px',
              color: '#4ade80',
              background: 'rgba(34, 197, 94, 0.1)',
              padding: '2px 6px',
              borderRadius: '4px',
              fontWeight: 500
            }}>
              Patched
            </span>
          )}

          <button
            onClick={handleOpenInEditor}
            title="Inspect in Code Editor"
            style={{
              padding: '4px',
              background: 'transparent',
              border: 'none',
              borderRadius: '4px',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center'
            }}
          >
            <ExternalLink size={13} />
          </button>

          <button
            onClick={handleCopy}
            title="Copy Diff"
            style={{
              padding: '4px',
              background: 'transparent',
              border: 'none',
              borderRadius: '4px',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center'
            }}
          >
            {copied ? <Check size={13} color="#4ade80" /> : <Copy size={13} />}
          </button>

          <button
            onClick={() => setIsExpanded(!isExpanded)}
            title={isExpanded ? "Collapse Diff" : "Expand Diff"}
            style={{
              padding: '4px',
              background: 'transparent',
              border: 'none',
              borderRadius: '4px',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center'
            }}
          >
            {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>
      </div>

      {/* Diff Content Body */}
      {isExpanded && (
        <div style={{
          padding: '8px 12px',
          fontSize: '11.5px',
          fontFamily: 'var(--font-mono)',
          lineHeight: 1.5,
          maxHeight: '340px',
          overflowY: 'auto'
        }}>
          {edits.map((edit, idx) => (
            <div key={idx} style={{ marginBottom: idx < edits.length - 1 ? '10px' : 0 }}>
              {/* Removed / Buggy lines */}
              {edit.search && (
                <div style={{
                  background: 'rgba(239, 68, 68, 0.08)',
                  border: '1px solid rgba(239, 68, 68, 0.2)',
                  borderRadius: '5px',
                  padding: '6px 10px',
                  color: '#fca5a5',
                  marginBottom: '4px',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word'
                }}>
                  <div style={{ fontSize: '10px', fontWeight: 600, color: '#f87171', marginBottom: '2px', textTransform: 'uppercase' }}>
                    - Buggy Code Replaced
                  </div>
                  {edit.search}
                </div>
              )}

              {/* Added / Fixed lines */}
              {edit.replace && (
                <div style={{
                  background: 'rgba(34, 197, 94, 0.08)',
                  border: '1px solid rgba(34, 197, 94, 0.2)',
                  borderRadius: '5px',
                  padding: '6px 10px',
                  color: '#86efac',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word'
                }}>
                  <div style={{ fontSize: '10px', fontWeight: 600, color: '#4ade80', marginBottom: '2px', textTransform: 'uppercase' }}>
                    + Corrected Logic
                  </div>
                  {edit.replace}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default DiffEditBlock;
