import React, { useEffect, useState } from 'react';
import { Check, Loader2 } from 'lucide-react';

interface Step {
  label: string;
  sublabel: string;
  keywords: RegExp;
}

const BUILD_STEPS: Step[] = [
  { label: 'Installing dependencies', sublabel: 'npm install', keywords: /install|depend/i },
  { label: 'Building application',    sublabel: 'vite build + esbuild', keywords: /build|compil/i },
  { label: 'Running tests',           sublabel: 'node --test', keywords: /test/i },
  { label: 'Deploying app',           sublabel: 'Cloudflare Workers + D1', keywords: /deploy|collect|artifact|publish|service|migrat/i },
];

function resolveStep(message: string): number {
  const lower = (message || '').toLowerCase();
  // Walk backwards — the first step whose keywords match is the active one
  for (let i = BUILD_STEPS.length - 1; i >= 0; i--) {
    if (BUILD_STEPS[i].keywords.test(lower)) return i;
  }
  return 0;
}

function ElapsedTime({ startedAt }: { startedAt: number }) {
  const [elapsed, setElapsed] = useState(Math.floor((Date.now() - startedAt) / 1000));
  useEffect(() => {
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(id);
  }, [startedAt]);
  const min = Math.floor(elapsed / 60);
  const sec = elapsed % 60;
  return <>{min > 0 ? `${min}m ${sec}s` : `${sec}s`}</>;
}

/**
 * Full-height build progress card shown in the preview pane while the managed
 * backend is building (npm install → build → test → deploy). Replaces the
 * unhelpful in-browser preview / auth gate during the build wait.
 */
export default function BackendBuildProgress({ message, startedAt }: { message: string; startedAt?: number }) {
  const activeIdx = resolveStep(message);
  const mountedAt = React.useRef(startedAt ?? Date.now());
  // Freeze the start time on mount so ticks don't reset when message changes
  const effectiveStart = startedAt ?? mountedAt.current;

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100%',
      width: '100%',
      padding: '32px 24px',
      background: 'var(--bg-workspace)',
      gap: '28px',
    }}>
      {/* Icon + heading */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
        <div style={{
          width: '52px',
          height: '52px',
          borderRadius: '14px',
          background: 'linear-gradient(135deg, rgba(54,89,217,0.18) 0%, rgba(99,102,241,0.10) 100%)',
          border: '1px solid rgba(54,89,217,0.25)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <Loader2 size={24} style={{ color: 'var(--accent-light)' }} className="lucide-spin" />
        </div>
        <div style={{ textAlign: 'center' }}>
          <h3 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
            Building your app
          </h3>
          <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '4px 0 0', lineHeight: 1.5 }}>
            {message || 'Starting the build pipeline…'}
          </p>
        </div>
      </div>

      {/* Step list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%', maxWidth: '320px' }}>
        {BUILD_STEPS.map((step, idx) => {
          const done = idx < activeIdx;
          const active = idx === activeIdx;
          return (
            <div
              key={step.label}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                padding: '10px 14px',
                borderRadius: '10px',
                background: active
                  ? 'var(--bg-card)'
                  : done
                    ? 'transparent'
                    : 'transparent',
                border: active
                  ? '1px solid rgba(54,89,217,0.2)'
                  : done
                    ? '1px solid rgba(34,197,94,0.15)'
                    : '1px solid var(--border-subtle)',
                opacity: !done && !active ? 0.45 : 1,
                transition: 'opacity 300ms, background 300ms, border-color 300ms',
              }}
            >
              {/* Step icon */}
              <div style={{
                width: '22px',
                height: '22px',
                borderRadius: '50%',
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: done
                  ? 'rgba(34,197,94,0.15)'
                  : active
                    ? 'rgba(54,89,217,0.15)'
                    : 'var(--bg-surface)',
                border: done
                  ? '1px solid rgba(34,197,94,0.3)'
                  : active
                    ? '1px solid rgba(54,89,217,0.3)'
                    : '1px solid var(--border-subtle)',
              }}>
                {done ? (
                  <Check size={12} style={{ color: '#22c55e' }} />
                ) : active ? (
                  <Loader2 size={12} style={{ color: 'var(--accent-light)' }} className="lucide-spin" />
                ) : (
                  <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--text-muted)', display: 'block' }} />
                )}
              </div>
              {/* Step text */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '12.5px', fontWeight: active ? 600 : 500, color: active ? 'var(--text-primary)' : done ? 'var(--text-secondary)' : 'var(--text-muted)' }}>
                  {step.label}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '1px' }}>
                  {step.sublabel}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Elapsed time */}
      <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '6px' }}>
        <span style={{ opacity: 0.6 }}>⏱</span>
        <ElapsedTime startedAt={effectiveStart} />
        <span style={{ opacity: 0.6 }}>elapsed · usually 2–4 minutes</span>
      </div>
    </div>
  );
}
