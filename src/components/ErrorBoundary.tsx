import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Trash2 } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught runtime error caught by ErrorBoundary:', error, errorInfo);
  }

  private handleReload = () => {
    window.location.reload();
  };

  private handleHardReset = () => {
    try {
      if (typeof caches !== 'undefined') {
        caches.keys().then((names) => {
          names.forEach((name) => caches.delete(name));
        });
      }
    } catch {}
    window.location.href = window.location.origin + window.location.pathname + '?v=' + Date.now();
  };

  public render() {
    if (this.state.hasError) {
      const isChunkOrSyntax = 
        this.state.error?.message?.includes('chunk') || 
        this.state.error?.message?.includes('Prism') ||
        this.state.error?.message?.includes('Failed to fetch');

      return (
        <div style={{
          minHeight: '100vh',
          backgroundColor: 'var(--studio-paper)',
          color: 'var(--text-primary)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          fontFamily: 'var(--font-sans)'
        }}>
          <div style={{
            maxWidth: '520px',
            width: '100%',
            backgroundColor: 'var(--bg-card)',
            border: '1px solid var(--border-medium)',
            borderRadius: '16px',
            padding: '32px',
            boxShadow: '0 20px 40px rgba(0, 0, 0, 0.5)',
            textAlign: 'center'
          }}>
            <div style={{
              width: '56px',
              height: '56px',
              borderRadius: '50%',
              backgroundColor: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 20px auto',
              color: 'var(--color-error)'
            }}>
              <AlertTriangle size={28} />
            </div>

            <h2 style={{ fontSize: '20px', fontWeight: 600, margin: '0 0 8px 0', color: 'var(--text-primary)' }}>
              {isChunkOrSyntax ? 'New Version Available' : 'Something went wrong'}
            </h2>

            <p style={{ fontSize: '14px', color: 'var(--text-muted)', lineHeight: 1.5, margin: '0 0 24px 0' }}>
              {isChunkOrSyntax
                ? 'A new version of BrainHalf has been deployed. Please reload to load the latest code and assets.'
                : 'An unexpected runtime issue occurred. Your project files and settings are safely stored.'}
            </p>

            {this.state.error?.message && (
              <div style={{
                backgroundColor: 'var(--bg-surface)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '8px',
                padding: '12px 14px',
                fontSize: '12px',
                fontFamily: 'var(--font-mono)',
                color: 'var(--color-error)',
                textAlign: 'left',
                overflowX: 'auto',
                marginBottom: '24px',
                maxHeight: '90px'
              }}>
                {this.state.error.message}
              </div>
            )}

            <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
              <button
                onClick={this.handleReload}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  backgroundColor: 'var(--accent-primary)',
                  color: 'var(--text-on-accent)',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '10px 20px',
                  fontSize: '14px',
                  fontWeight: 500,
                  cursor: 'pointer',
                  transition: 'background-color 0.2s'
                }}
              >
                <RefreshCw size={16} />
                Reload Application
              </button>

              <button
                onClick={this.handleHardReset}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  backgroundColor: 'transparent',
                  color: 'var(--text-muted)',
                  border: '1px solid var(--border-medium)',
                  borderRadius: '8px',
                  padding: '10px 16px',
                  fontSize: '14px',
                  cursor: 'pointer'
                }}
              >
                <Trash2 size={16} />
                Clear Cache & Refresh
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
