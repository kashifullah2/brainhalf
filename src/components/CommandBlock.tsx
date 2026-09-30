import React, { useEffect, useState } from 'react';
import { Terminal, Loader2, CheckCircle2 } from 'lucide-react';
import { appEvents } from '../lib/events';

interface CommandBlockProps {
  command: string;
  isStreaming: boolean;
}

const CommandBlock: React.FC<CommandBlockProps> = ({ command, isStreaming }) => {
  const [status, setStatus] = useState<'pending' | 'running' | 'completed'>('pending');
  const hasTriggeredRef = React.useRef(false);

  useEffect(() => {
    // Only execute when the command has fully streamed
    if (!isStreaming && !hasTriggeredRef.current && command.trim().length > 0) {
      hasTriggeredRef.current = true;
      const reqId = Math.random().toString(36).substring(7);
      
      const handleResult = () => {
        setStatus('completed');
      };
      
      appEvents.on(`command-result-${reqId}`, handleResult);
      appEvents.emit('execute-command', { command: command.trim(), requestId: reqId });
      setStatus('running');

      return () => {
        appEvents.off(`command-result-${reqId}`, handleResult);
      };
    }
  }, [isStreaming, command]);

  return (
    <div style={{
      background: 'var(--bg-surface)',
      border: 'none',
      borderLeft: '2px solid var(--accent-primary)',
      borderRadius: '4px',
      padding: '10px 14px',
      margin: '8px 0',
      fontFamily: 'var(--font-mono)',
      fontSize: '13px',
      color: 'var(--text-secondary)'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
        <Terminal size={16} strokeWidth={1.75} color="var(--accent-primary)" />
        <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>Command</span>
        <div role="status" aria-live="polite" style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span>{status === 'completed' ? 'Completed' : status === 'running' ? 'Running' : 'Pending'}</span>
          {status === 'running' ? (
            <Loader2 size={16} strokeWidth={1.75} className="lucide-spin" style={{ color: 'var(--accent-secondary)' }} />
          ) : status === 'completed' ? (
            <CheckCircle2 size={16} strokeWidth={1.75} color="var(--color-success)" />
          ) : null}
        </div>
      </div>
      <div style={{ color: 'var(--color-code-violet)' }}>
        $ {command}
      </div>
    </div>
  );
};

export default CommandBlock;
