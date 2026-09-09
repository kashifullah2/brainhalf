import React, { useState, useMemo } from 'react';
import { FileCode, Check, Copy, ExternalLink, Code2 } from 'lucide-react';
import { getLanguageFromPath, highlightCodeToLines } from '../lib/prism-loader';
import { appEvents } from '../lib/events';

interface CodeFileBlockProps {
  filePath: string;
  content: string;
  isStreaming?: boolean;
}

const CodeFileBlock: React.FC<CodeFileBlockProps> = ({ filePath, content, isStreaming }) => {
  const [copied, setCopied] = useState(false);

  const language = useMemo(() => getLanguageFromPath(filePath), [filePath]);
  
  const highlightedLines = useMemo(() => {
    return highlightCodeToLines(content || '', language);
  }, [content, language]);

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
    <div className="code-file-card" style={{
      borderRadius: '8px',
      border: '1px solid var(--border-subtle)',
      background: '#12141a',
      overflow: 'hidden',
      margin: '8px 0',
      boxShadow: '0 4px 16px rgba(0, 0, 0, 0.25)'
    }}>
      {/* File Card Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 12px',
        background: 'rgba(255, 255, 255, 0.03)',
        borderBottom: '1px solid var(--border-subtle)',
        fontSize: '12px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
          <FileCode size={14} color="var(--accent-secondary)" style={{ flexShrink: 0 }} />
          <span style={{ 
            fontFamily: 'var(--font-mono)', 
            fontWeight: 600, 
            color: 'var(--text-primary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
          }}>
            {filePath}
          </span>
          <span style={{
            fontSize: '10px',
            padding: '1px 6px',
            borderRadius: '4px',
            background: 'rgba(99, 102, 241, 0.15)',
            color: 'var(--accent-primary)',
            fontWeight: 600,
            textTransform: 'uppercase',
            flexShrink: 0
          }}>
            {language}
          </span>
          {isStreaming && (
            <span style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              fontSize: '11px',
              color: '#c084fc',
              flexShrink: 0
            }}>
              <span className="status-dot generating" style={{ width: '5px', height: '5px' }} />
              Streaming...
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
          <button
            onClick={handleOpenInEditor}
            title="Open in Code Editor"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              padding: '4px 6px',
              borderRadius: '4px',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              fontSize: '11px',
              transition: 'all 0.15s'
            }}
            className="hover-bright"
          >
            <Code2 size={12} /> Editor
          </button>
          <button
            onClick={handleCopy}
            title="Copy code"
            style={{
              background: 'transparent',
              border: 'none',
              color: copied ? '#34d399' : 'var(--text-secondary)',
              cursor: 'pointer',
              padding: '4px 6px',
              borderRadius: '4px',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              fontSize: '11px',
              transition: 'all 0.15s'
            }}
            className="hover-bright"
          >
            {copied ? <Check size={12} color="#34d399" /> : <Copy size={12} />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>

      {/* Code with Line Numbers */}
      <div style={{
        maxHeight: '420px',
        overflowY: 'auto',
        fontFamily: 'var(--font-mono)',
        fontSize: '12px',
        lineHeight: 1.5,
        padding: '8px 0',
        background: '#0d0f14'
      }}>
        <div style={{ display: 'table', width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
          {highlightedLines.map((lineHtml, idx) => (
            <div 
              key={idx} 
              style={{ 
                display: 'table-row',
                backgroundColor: 'transparent'
              }}
              className="code-line-row"
            >
              {/* Line number gutter */}
              <span style={{
                display: 'table-cell',
                textAlign: 'right',
                paddingRight: '12px',
                paddingLeft: '10px',
                color: '#4b5563',
                userSelect: 'none',
                width: '36px',
                verticalAlign: 'top',
                fontSize: '11px'
              }}>
                {idx + 1}
              </span>

              {/* Code content with proper wrapping */}
              <span 
                style={{
                  display: 'table-cell',
                  paddingRight: '12px',
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
    </div>
  );
};

export default CodeFileBlock;
