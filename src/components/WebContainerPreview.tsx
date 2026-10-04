import { Loader2, RefreshCw, AlertCircle, Terminal as TerminalIcon } from 'lucide-react';
import type { ContainerStatus } from '../lib/use-webcontainer';

interface WebContainerPreviewProps {
  status: ContainerStatus;
  previewUrl: string | null;
  error: string | null;
  onRestart: () => void;
  onOpenTerminal?: () => void;
}

const STATUS_MESSAGES: Record<ContainerStatus, string> = {
  unsupported: 'WebContainers are not available in this browser.',
  booting: 'Booting runtime environment…',
  mounting: 'Mounting project files…',
  installing: 'Installing dependencies (npm install)…',
  starting: 'Starting dev server…',
  ready: '',
  error: 'Something went wrong.',
};

export default function WebContainerPreview({
  status,
  previewUrl,
  error,
  onRestart,
  onOpenTerminal,
}: WebContainerPreviewProps) {
  if (status === 'ready' && previewUrl) {
    return (
      <iframe
        src={previewUrl}
        style={{
          width: '100%',
          height: '100%',
          border: 'none',
          display: 'block',
          background: '#fff',
        }}
        title="Application Preview"
        allow="cross-origin-isolated"
      />
    );
  }

  if (status === 'error') {
    return (
      <div className="wc-preview-status wc-preview-error">
        <AlertCircle size={28} />
        <h3>Runtime Error</h3>
        <p>{error || 'An unexpected error occurred.'}</p>
        <div className="wc-preview-actions">
          <button type="button" onClick={onRestart}>
            <RefreshCw size={14} /> Restart Runtime
          </button>
          {onOpenTerminal && (
            <button type="button" className="wc-preview-secondary" onClick={onOpenTerminal}>
              <TerminalIcon size={14} /> View Terminal
            </button>
          )}
        </div>
      </div>
    );
  }

  if (status === 'unsupported') {
    return (
      <div className="wc-preview-status wc-preview-unsupported">
        <AlertCircle size={28} />
        <h3>Runtime Unavailable</h3>
        <p>Your browser doesn't support the required APIs (SharedArrayBuffer). Use Chrome, Edge, or another Chromium-based browser with cross-origin isolation enabled.</p>
      </div>
    );
  }

  return (
    <div className="wc-preview-status wc-preview-loading">
      <Loader2 size={28} className="lucide-spin" />
      <h3>{STATUS_MESSAGES[status]}</h3>
      <p className="wc-preview-hint">
        {status === 'installing'
          ? 'This may take a moment for the first build.'
          : 'Setting up your development environment…'}
      </p>
      {onOpenTerminal && (
        <button type="button" className="wc-preview-terminal-link" onClick={onOpenTerminal}>
          <TerminalIcon size={13} /> Watch progress in terminal
        </button>
      )}
    </div>
  );
}
