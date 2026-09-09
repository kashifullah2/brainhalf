import React, { useEffect, useState } from 'react';
import { Terminal, Loader2, CheckCircle2 } from 'lucide-react';
import { appEvents } from '../lib/events';

interface CommandBlockProps {
  command: string;
  isStreaming: boolean;
}

const CommandBlock: React.FC<CommandBlockProps> = ({ command, isStreaming }) => {
  const [status, setStatus] = useState<'pending' | 'running' | 'completed'>('pending');

  useEffect(() => {
    // Only execute when the command has fully streamed
    if (!isStreaming && status === 'pending' && command.trim().length > 0) {
      setStatus('running');
      
      const reqId = Math.random().toString(36).substring(7);
      
      const handleResult = (payload: { output: string }) => {
        setStatus('completed');
        appEvents.off(`command-result-${reqId}`, handleResult);
      };
      
      appEvents.on(`command-result-${reqId}`, handleResult);
      appEvents.emit('execute-command', { command: command.trim(), requestId: reqId });
    }
  }, [isStreaming, command, status]);

  return (
    <div style={{
      background: 'var(--bg-code-editor)',
      border: '1px solid var(--border-subtle)',
      borderRadius: '8px',
      padding: '10px 14px',
      margin: '8px 0',
      fontFamily: 'var(--font-mono)',
      fontSize: '13px',
      color: 'var(--text-secondary)'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
        <Terminal size={14} color="var(--accent-primary)" />
        <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>Terminal</span>
        <div style={{ marginLeft: 'auto' }}>
          {status === 'running' ? (
            <Loader2 size={14} className="lucide-spin" style={{ color: 'var(--accent-secondary)' }} />
          ) : status === 'completed' ? (
            <CheckCircle2 size={14} color="#22c55e" />
          ) : null}
        </div>
      </div>
      <div style={{ color: '#a855f7' }}>
        $ {command}
      </div>
    </div>
  );
};

export default CommandBlock;
