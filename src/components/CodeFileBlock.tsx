import React, { useState, useMemo } from 'react';
import { FileCode, Check, Copy, Code2, ChevronDown } from 'lucide-react';
import { getLanguageFromPath, highlightCodeToLines } from '../lib/prism-loader';
import { appEvents } from '../lib/events';
import { normalizePath } from '../lib/utils';

interface CodeFileBlockProps {
  filePath: string;
  content: string;
  isStreaming?: boolean;
}

const CodeFileBlock: React.FC<CodeFileBlockProps> = ({ filePath, content, isStreaming }) => {
  const [copied, setCopied] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [viewDropdownOpen, setViewDropdownOpen] = useState(false);

  const language = useMemo(() => getLanguageFromPath(filePath), [filePath]);

  const lineCount = useMemo(() => {
    return (content || '').split('\n').length;
  }, [content]);

  const highlightedLines = useMemo(() => {
    if (!isExpanded && !isStreaming) return [];
    return highlightCodeToLines(content || '', language);
  }, [content, language, isExpanded, isStreaming]);

  const handleCopy = () => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleOpenInEditor = () => {
    const cleanPath = normalizePath(filePath);
    appEvents.emit('open-file', { path: cleanPath });
  };

  return (
    <div className="code-artifact-card" style={{
      borderRadius: 'var(--radius-asym-sm, 10px 4px 10px 4px)',
      border: isStreaming ? '1px solid var(--border-accent)' : '1px solid var(--border-subtle)',
      background: 'rgba(255, 255, 255, 0.025)',
      overflow: 'hidden',
      margin: '6px 0',
      transition: 'all 0.15s ease'
    }}>
      {/* File Card Header Bar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 12px',
        background: isStreaming ? 'var(--color-ai-bg)' : 'rgba(255, 255, 255, 0.02)',
        fontSize: '12px',
        gap: '8px'
      }}>
        {/* Left: Icon & File Path */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flex: 1 }}>
          <div style={{
            width: '24px',
            height: '24px',
            borderRadius: '5px',
            background: 'var(--color-ai-bg)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0
          }}>
            <FileCode size={16} strokeWidth={1.75} color="var(--accent-light)" />
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
            <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
              {lineCount} lines • {language.toUpperCase()}
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
              color: 'var(--accent-light)',
              background: 'var(--color-ai-bg)',
              padding: '3px 8px',
              borderRadius: '4px',
              fontWeight: 500
            }}>
              <span className="status-dot generating" style={{ width: '5px', height: '5px' }} />
              Writing...
            </span>
          ) : (
            <>
              {/* Copy — icon only */}
              <button
                onClick={handleCopy}
                title={copied ? 'Copied!' : 'Copy code'}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: copied ? '#34d399' : 'var(--text-secondary)',
                  cursor: 'pointer',
                  padding: '4px 6px',
                  borderRadius: '4px',
                  display: 'flex',
                  alignItems: 'center',
                  transition: 'all 0.15s'
                }}
                className="hover-bright"
              >
                {copied
                  ? <Check size={15} strokeWidth={1.75} color="#34d399" />
                  : <Copy size={15} strokeWidth={1.75} />
                }
              </button>

              {/* Open in Editor split-button */}
              <div style={{ position: 'relative', display: 'flex' }}>
                {/* Primary segment */}
                <button
                  onClick={handleOpenInEditor}
                  title="Open and edit this file in the full editor"
                  style={{
                    background: 'rgba(255, 255, 255, 0.08)',
                    border: '1px solid rgba(255, 255, 255, 0.12)',
                    borderRight: 'none',
                    borderRadius: '4px 0 0 4px',
                    color: '#ffffff',
                    cursor: 'pointer',
                    padding: '4px 8px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '5px',
                    fontSize: '11px',
                    fontWeight: 500,
                    transition: 'all 0.15s',
                    whiteSpace: 'nowrap'
                  }}
                  className="hover-bright"
                >
                  <Code2 size={13} strokeWidth={1.75} color="var(--accent-light)" />
                  Open in Editor
                </button>

                {/* Chevron / dropdown segment */}
                <button
                  onClick={() => setViewDropdownOpen(o => !o)}
                  title="View options"
                  aria-expanded={viewDropdownOpen}
                  style={{
                    background: 'rgba(255, 255, 255, 0.08)',
                    border: '1px solid rgba(255, 255, 255, 0.12)',
                    borderLeft: '1px solid rgba(255, 255, 255, 0.18)',
                    borderRadius: '0 4px 4px 0',
                    color: 'var(--text-secondary)',
                    cursor: 'pointer',
                    padding: '4px 5px',
                    display: 'flex',
                    alignItems: 'center',
                    transition: 'all 0.15s'
                  }}
                  className="hover-bright"
                >
                  <ChevronDown
                    size={13}
                    strokeWidth={2}
                    style={{
                      transform: viewDropdownOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                      transition: 'transform 0.15s'
                    }}
                  />
                </button>

                {/* Dropdown */}
                {viewDropdownOpen && (
                  <>
                    <div
                      style={{ position: 'fixed', inset: 0, zIndex: 99 }}
                      onClick={() => setViewDropdownOpen(false)}
                    />
                    <div style={{
                      position: 'absolute',
                      top: 'calc(100% + 4px)',
                      right: 0,
                      zIndex: 100,
                      background: 'var(--bg-surface, #1a1d27)',
                      border: '1px solid rgba(255, 255, 255, 0.1)',
                      borderRadius: '6px',
                      padding: '3px',
                      minWidth: '140px',
                      boxShadow: '0 6px 24px rgba(0,0,0,0.5)'
                    }}>
                      <button
                        onClick={() => {
                          setIsExpanded(e => !e);
                          setViewDropdownOpen(false);
                        }}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '7px',
                          width: '100%',
                          padding: '6px 9px',
                          background: 'transparent',
                          border: 'none',
                          borderRadius: '4px',
                          color: 'rgba(255,255,255,0.8)',
                          fontSize: '11.5px',
                          fontWeight: 500,
                          cursor: 'pointer',
                          textAlign: 'left',
                          transition: 'background 0.1s',
                          whiteSpace: 'nowrap'
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.07)'; }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                      >
                        <ChevronDown
                          size={12}
                          strokeWidth={2}
                          style={{
                            transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                            transition: 'transform 0.15s',
                            flexShrink: 0
                          }}
                        />
                        {isExpanded ? 'Hide inline code' : 'View inline code'}
                      </button>
                    </div>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Collapsible Inline Code Area */}
      {(isExpanded || isStreaming) && (
        <div style={{
          maxHeight: isStreaming ? '140px' : '280px',
          overflowY: 'auto',
          fontFamily: 'var(--font-mono)',
          fontSize: '11.5px',
          lineHeight: 1.5,
          padding: '8px 0',
          background: '#090b10',
          borderTop: '1px solid var(--border-subtle)'
        }}>
          <div style={{ display: 'table', width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
            {highlightedLines.map((lineHtml, idx) => (
              <div
                key={idx}
                style={{ display: 'table-row', backgroundColor: 'transparent' }}
                className="code-line-row"
              >
                <span style={{
                  display: 'table-cell',
                  textAlign: 'right',
                  paddingRight: '10px',
                  paddingLeft: '8px',
                  color: '#4b5563',
                  userSelect: 'none',
                  width: '32px',
                  verticalAlign: 'top',
                  fontSize: '10.5px'
                }}>
                  {idx + 1}
                </span>
                <span
                  style={{
                    display: 'table-cell',
                    paddingRight: '10px',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    verticalAlign: 'top',
                    color: '#e2e8f0'
                  }}
                  dangerouslySetInnerHTML={{ __html: lineHtml || '&nbsp;' }}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default CodeFileBlock;
