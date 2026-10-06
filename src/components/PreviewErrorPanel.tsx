import React, { useEffect } from 'react';
import { plainLanguageError } from '../lib/verification-copy';

// Injected into the preview iframe's <head> — CSS vars from the parent BrainHalf
// page don't cross iframe boundaries, so we use explicit colors + a dark-mode
// media query here instead.
const PANEL_CSS = `
.preview-error-root{padding:24px;font-family:system-ui,-apple-system,sans-serif;background:#edf3f7;color:#b44a4e;height:100%;min-height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;box-sizing:border-box}
.preview-error-card{background:#ffffff;border:1px solid #dfe6eb;border-radius:12px;padding:24px;max-width:500px}
.preview-error-title{font-size:20px;font-weight:500;color:#243c4b;margin-bottom:8px;margin-top:0}
.preview-error-body{color:#657580;font-size:13px;line-height:1.5;margin-bottom:16px;word-break:break-word}
.preview-error-details{margin-bottom:16px;text-align:left;font-size:12px;color:#657580}
.preview-error-details summary{cursor:pointer;font-weight:600}
.preview-error-code{display:block;margin-top:6px;padding:8px;background:#f4f7f9;border-radius:6px;white-space:pre-wrap;word-break:break-word;font:inherit}
.preview-error-btn{padding:11px 16px;min-height:40px;background:#294b61;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:12px;font-weight:500;font-family:inherit}
@media(prefers-color-scheme:dark){
  .preview-error-root{background:#131c27;color:#f87171}
  .preview-error-card{background:#1c2a3a;border-color:#2d4055}
  .preview-error-title{color:#dce8f0}
  .preview-error-body{color:#7fa0b8}
  .preview-error-details{color:#7fa0b8}
  .preview-error-code{background:#0e1820}
  .preview-error-btn{background:#3b6580}
}
`;

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
  useEffect(() => {
    const id = '__preview-error-styles';
    if (!document.getElementById(id)) {
      const el = document.createElement('style');
      el.id = id;
      el.textContent = PANEL_CSS;
      document.head.appendChild(el);
    }
  }, []);

  const requestAutoFix = () => {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage(
        { type: 'preview-auto-fix', layer, error: message },
        '*'
      );
    }
  };

  return (
    <div className="preview-error-root">
      <div className="preview-error-card">
        <h3 className="preview-error-title">{title}</h3>
        <p className="preview-error-body">
          {message ? plainLanguageError(message) : 'Something went wrong while showing your app.'}{' '}
          The builder can usually fix this — ask it to take a look.
        </p>
        {message && (
          <details className="preview-error-details">
            <summary>Technical details</summary>
            <code className="preview-error-code">{message}</code>
          </details>
        )}
        <button className="preview-error-btn" onClick={requestAutoFix}>
          Ask the builder to fix it
        </button>
      </div>
    </div>
  );
}
