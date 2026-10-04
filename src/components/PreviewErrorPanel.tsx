import React from 'react';
import { plainLanguageError } from '../lib/verification-copy';

export function classifyError(message: string): { title: string; layer: 'frontend' | 'backend' } {
  const isBackend = message.includes('[Backend Error]');
  return {
    title: isBackend ? 'A data feature ran into a problem' : 'This preview ran into a problem',
    layer: isBackend ? 'backend' : 'frontend',
  };
}

export function PreviewErrorPanel({
  title,
  message,
  layer,
}: {
  title: string;
  message: string;
  layer: 'frontend' | 'backend';
}) {
  const requestAutoFix = () => {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage(
        { type: 'preview-auto-fix', layer, error: message },
        '*'
      );
    }
  };

  return (
    <div
      style={{
        padding: '24px',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        color: '#b44a4e',
        background: '#edf3f7',
        height: '100%',
        minHeight: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          background: '#ffffff',
          border: '1px solid #dfe6eb',
          borderRadius: '12px',
          padding: '24px',
          maxWidth: '500px',
        }}
      >
        <h3 style={{ fontSize: '20px', fontWeight: 500, color: '#243c4b', marginBottom: '8px' }}>
          {title}
        </h3>
        <p
          style={{
            color: '#657580',
            fontSize: '13px',
            lineHeight: 1.5,
            marginBottom: '16px',
            wordBreak: 'break-word',
          }}
        >
          {message ? plainLanguageError(message) : 'Something went wrong while showing your app.'}{' '}
          The builder can usually fix this — ask it to take a look.
        </p>
        {message && (
          <details style={{ marginBottom: '16px', textAlign: 'left', fontSize: '12px', color: '#657580' }}>
            <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Technical details</summary>
            <code style={{ display: 'block', marginTop: '6px', padding: '8px', background: '#f4f7f9', borderRadius: '6px', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{message}</code>
          </details>
        )}
        <button
          onClick={requestAutoFix}
          style={{
            padding: '11px 16px',
            minHeight: '40px',
            background: '#294b61',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
            fontSize: '12px',
            fontWeight: 500,
          }}
        >
          Ask the builder to fix it
        </button>
      </div>
    </div>
  );
}
