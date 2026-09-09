import React, { useState, useMemo } from 'react';
import { FileCode, Check, Copy, ExternalLink, Code2, ChevronDown, ChevronUp, Sparkles } from 'lucide-react';
import { getLanguageFromPath, highlightCodeToLines } from '../lib/prism-loader';
import { appEvents } from '../lib/events';

interface CodeFileBlockProps {
  filePath: string;
  content: string;
  isStreaming?: boolean;
}

const CodeFileBlock: React.FC<CodeFileBlockProps> = ({ filePath, content, isStreaming }) => {
  const [copied, setCopied] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

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
    const cleanPath = filePath.startsWith('/') ? filePath : `/${filePath}`;
    appEvents.emit('open-file', { path: cleanPath });
  };

  return (
    <div className="code-artifact-card" style={{
      borderRadius: '8px',
      border: isStreaming ? '1px solid rgba(168, 85, 247, 0.4)' : '1px solid var(--border-subtle)',
      background: 'rgba(18, 21, 30, 0.7)',
      overflow: 'hidden',
      margin: '6px 0',
      boxShadow: '0 2px 12px rgba(0, 0, 0, 0.2)',
      transition: 'all 0.2s ease'
    }}>
      {/* File Card Header Bar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 12px',
        background: isStreaming ? 'rgba(168, 85, 247, 0.08)' : 'rgba(255, 255, 255, 0.02)',
        fontSize: '12px',
        gap: '8px'
      }}>
        {/* Left: Icon & File Path */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flex: 1 }}>
          <div style={{
            width: '24px',
            height: '24px',
            borderRadius: '5px',
            background: 'rgba(168, 85, 247, 0.15)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0
          }}>
            <FileCode size={13} color="var(--accent-light)" />
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
              color: '#c084fc',
              background: 'rgba(168, 85, 247, 0.12)',
              padding: '3px 8px',
              borderRadius: '4px',
              fontWeight: 500
            }}>
              <span className="status-dot generating" style={{ width: '5px', height: '5px' }} />
              Writing...
            </span>
          ) : (
            <>
              <button
                onClick={() => setIsExpanded(!isExpanded)}
                title={isExpanded ? "Collapse inline preview" : "Expand inline preview"}
                style={{
                  background: 'rgba(255, 255, 255, 0.04)',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text-secondary)',
                  cursor: 'pointer',
                  padding: '3px 7px',
                  borderRadius: '5px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  fontSize: '11px',
                  transition: 'all 0.15s'
                }}
                className="hover-bright"
              >
                {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                <span>{isExpanded ? 'Hide' : 'Code'}</span>
              </button>

              <button
                onClick={handleCopy}
                title="Copy code"
                style={{
                  background: 'rgba(255, 255, 255, 0.04)',
                  border: '1px solid var(--border-subtle)',
                  color: copied ? '#34d399' : 'var(--text-secondary)',
                  cursor: 'pointer',
                  padding: '3px 7px',
                  borderRadius: '5px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  fontSize: '11px',
                  transition: 'all 0.15s'
                }}
                className="hover-bright"
              >
                {copied ? <Check size={12} color="#34d399" /> : <Copy size={12} />}
                <span>{copied ? 'Copied' : 'Copy'}</span>
              </button>

              <button
                onClick={handleOpenInEditor}
                title="Open and edit this file in the full editor"
                style={{
                  background: 'rgba(168, 85, 247, 0.18)',
                  border: '1px solid rgba(168, 85, 247, 0.35)',
                  color: '#ffffff',
                  cursor: 'pointer',
                  padding: '3px 8px',
                  borderRadius: '5px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  fontSize: '11px',
                  fontWeight: 500,
                  transition: 'all 0.15s'
                }}
                className="hover-bright"
              >
                <Code2 size={12} color="var(--accent-light)" />
                <span>Editor ↗</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Collapsible Inline Code Area (Only shown when expanded or streaming) */}
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
