import { useEffect, useRef, useState } from 'react';
import { X, Clock, FileCode2, Wrench, AlertCircle, CheckCircle2, Zap, Bug, Eye, RotateCcw } from 'lucide-react';
import { appEvents } from '../lib/events';
import { getGenerationTimings, type GenerationTiming } from '../lib/generation-timing';
import { authFetch } from '../lib/auth-client';
import './AgentTracker.css';

interface TrackEvent {
  id: string;
  time: number;
  type: 'thinking' | 'tool' | 'file_write' | 'file_delete' | 'error' | 'preview' | 'status' | 'issue';
  label: string;
  detail?: string;
  severity: 'info' | 'warn' | 'error';
}

interface GenerationRow {
  model: string;
  started_at: number;
  finished_at: number | null;
  status: string;
  input_tokens: number | null;
  output_tokens: number | null;
  first_response_at?: number | null;
  provider_calls?: number | null;
}

type TrackerTab = 'live' | 'history' | 'issues';

const BAD_PATTERNS: Array<{ test: (s: string) => boolean; label: string; severity: 'warn' | 'error'; description: string }> = [
  { test: s => /DSML/i.test(s), label: 'DSML-format output', severity: 'warn', description: 'Model used internal tool-call syntax. An auto-retry was triggered.' },
  { test: s => /AUTO-RETRY-FULL-APP/i.test(s), label: 'Full-app auto-retry', severity: 'warn', description: 'Initial generation produced no files — a second pass was triggered automatically.' },
  { test: s => /Provider unavailable|503|overloaded/i.test(s), label: 'Provider unavailable', severity: 'error', description: 'The LLM provider returned a server error. Generation failed or retried.' },
  { test: s => /token.*limit|context.*window|too.*long/i.test(s), label: 'Token limit hit', severity: 'warn', description: 'Response was truncated by the token cap. Output may be partial.' },
  { test: s => /preview.*error|iframe.*error/i.test(s), label: 'Preview error', severity: 'error', description: 'The generated app has a runtime error. Check the console.' },
];

function formatElapsed(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

const MILESTONES = ['sent', 'accepted', 'model', 'activity', 'preview'] as const;
type Milestone = typeof MILESTONES[number];

export default function AgentTracker({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const [events, setEvents] = useState<TrackEvent[]>([]);
  const [generations, setGenerations] = useState<GenerationRow[]>([]);
  const [timings, setTimings] = useState<GenerationTiming[]>([]);
  const [genError, setGenError] = useState('');
  const [tab, setTab] = useState<TrackerTab>('live');
  const [issues, setIssues] = useState<Array<{ label: string; severity: 'warn' | 'error'; description: string }>>([]);
  const alive = useRef(true);
  const eventsRef = useRef<TrackEvent[]>([]);
  const counter = useRef(0);

  const addEvent = (partial: Omit<TrackEvent, 'id' | 'time'>) => {
    const e: TrackEvent = { ...partial, id: String(counter.current++), time: Date.now() };
    eventsRef.current = [e, ...eventsRef.current].slice(0, 200);
    setEvents([...eventsRef.current]);
  };

  const recordIssue = (label: string, severity: 'warn' | 'error', description: string) => {
    setIssues(prev => prev.some(i => i.label === label) ? prev : [...prev, { label, severity, description }]);
  };

  const checkForBadPatterns = (text: string) => {
    for (const bp of BAD_PATTERNS) {
      if (bp.test(text)) recordIssue(bp.label, bp.severity, bp.description);
    }
  };

  const loadHistory = () => {
    const origin = ['localhost', '127.0.0.1'].includes(location.hostname) ? (import.meta.env.VITE_BACKEND_HOST || '') : '';
    setGenError('');
    void authFetch(`${origin}/agents/chat-agent/${encodeURIComponent(projectId)}/usage`)
      .then(async response => {
        const data = await response.json();
        if (!response.ok || !Array.isArray(data.generations)) throw new Error('Generation history unavailable.');
        if (alive.current) setGenerations(data.generations as GenerationRow[]);
      })
      .catch(cause => { if (alive.current) setGenError(cause instanceof Error ? cause.message : 'Failed to load history.'); });
    setTimings(getGenerationTimings(projectId));
  };

  useEffect(() => {
    alive.current = true;
    loadHistory();

    const unsubs = [
      appEvents.on('generation-status', payload => {
        const { status, detail, error } = payload;
        if (status === 'Generating') {
          if (detail?.includes('Reading') || detail?.includes('files')) {
            addEvent({ type: 'tool', label: 'Reading project files', detail, severity: 'info' });
          } else if (detail?.includes('tools') || detail?.includes('Using')) {
            addEvent({ type: 'tool', label: 'Using project tools', detail, severity: 'info' });
          } else if (detail?.includes('Updated') || detail?.includes('Deleted') || detail?.includes('Writing')) {
            addEvent({ type: 'file_write', label: detail, severity: 'info' });
          } else if (detail) {
            addEvent({ type: 'thinking', label: 'Agent thinking', detail, severity: 'info' });
          } else {
            addEvent({ type: 'thinking', label: 'Agent generating…', severity: 'info' });
          }
        } else if (status === 'Error') {
          const msg = error || 'Generation failed';
          addEvent({ type: 'error', label: msg, severity: 'error' });
          checkForBadPatterns(msg);
        } else if (status === 'Stopped') {
          addEvent({ type: 'status', label: 'Generation stopped by user', severity: 'warn' });
        } else if (status === 'Ready') {
          addEvent({ type: 'status', label: 'Generation complete', detail, severity: 'info' });
          loadHistory();
        } else if (status === 'Connecting') {
          addEvent({ type: 'status', label: 'Connecting to agent…', severity: 'info' });
        }
      }),

      appEvents.on('file-generated', payload => {
        addEvent({ type: 'file_write', label: `Written: ${payload.path}`, severity: 'info' });
      }),

      appEvents.on('file-deleted', payload => {
        addEvent({ type: 'file_delete', label: `Deleted: ${payload.path}`, severity: 'warn' });
      }),

      appEvents.on('preview-state', payload => {
        if (payload.state === 'error') {
          const msg = payload.error || 'Preview failed to load';
          addEvent({ type: 'issue', label: `Preview error: ${msg}`, severity: 'error' });
          recordIssue('Preview load failed', 'error', msg);
        } else if (payload.state === 'ready') {
          addEvent({ type: 'preview', label: 'Preview loaded successfully', severity: 'info' });
        } else if (payload.state === 'loading') {
          addEvent({ type: 'preview', label: 'Preview loading…', severity: 'info' });
        }
      }),

      appEvents.on('auto-fix-error', payload => {
        const msg = payload.error || 'Auto-fix triggered';
        addEvent({ type: 'issue', label: `Auto-fix: ${payload.file || 'project'}`, detail: msg, severity: 'warn' });
        recordIssue('Auto-fix triggered', 'warn', msg);
      }),
    ];

    return () => {
      alive.current = false;
      for (const u of unsubs) u();
    };
  }, [projectId]);

  const eventIcon = (type: TrackEvent['type']) => {
    switch (type) {
      case 'thinking': return <Zap size={12} />;
      case 'tool': return <Wrench size={12} />;
      case 'file_write': return <FileCode2 size={12} />;
      case 'file_delete': return <FileCode2 size={12} />;
      case 'error': return <AlertCircle size={12} />;
      case 'preview': return <Eye size={12} />;
      case 'issue': return <Bug size={12} />;
      default: return <CheckCircle2 size={12} />;
    }
  };

  const latestGen = generations[0] ?? null;
  const latestTiming = timings[0] ?? null;

  return (
    <div className="agent-tracker-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="agent-tracker" role="dialog" aria-modal="true" aria-labelledby="agent-tracker-title">
        <header className="agent-tracker-header">
          <div>
            <span className="agent-tracker-eyebrow">OBSERVABILITY</span>
            <h2 id="agent-tracker-title">Agent Tracker</h2>
            <p>Live LLM behavior, generation phases, code changes, and issue detection.</p>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close agent tracker"><X size={20} /></button>
        </header>

        {latestGen && (
          <div className="agent-tracker-stats">
            <div className="tracker-stat">
              <span className="tracker-stat-label">Model</span>
              <span className="tracker-stat-value">{latestGen.model === 'claude-sonnet-6' ? 'Claude Sonnet 4.6' : latestGen.model}</span>
            </div>
            <div className="tracker-stat">
              <span className="tracker-stat-label">Status</span>
              <span className={`tracker-stat-value tracker-badge-${latestGen.status}`}>{latestGen.status}</span>
            </div>
            <div className="tracker-stat">
              <span className="tracker-stat-label">TTFB</span>
              <span className="tracker-stat-value">{latestGen.first_response_at != null ? formatElapsed(latestGen.first_response_at - latestGen.started_at) : '—'}</span>
            </div>
            <div className="tracker-stat">
              <span className="tracker-stat-label">Total time</span>
              <span className="tracker-stat-value">{latestGen.finished_at ? formatElapsed(latestGen.finished_at - latestGen.started_at) : '—'}</span>
            </div>
            <div className="tracker-stat">
              <span className="tracker-stat-label">Tokens in/out</span>
              <span className="tracker-stat-value">{latestGen.input_tokens?.toLocaleString() ?? '—'} / {latestGen.output_tokens?.toLocaleString() ?? '—'}</span>
            </div>
            <div className="tracker-stat">
              <span className="tracker-stat-label">LLM calls</span>
              <span className="tracker-stat-value">{latestGen.provider_calls ?? '—'}</span>
            </div>
          </div>
        )}

        {latestTiming && (
          <div className="agent-tracker-pipeline" aria-label="Generation pipeline milestones">
            {MILESTONES.map((m, i) => {
              const elapsed = latestTiming.elapsed[m as Milestone];
              const done = elapsed != null;
              return (
                <div key={m} className={`pipeline-step ${done ? 'pipeline-done' : 'pipeline-pending'}`}>
                  {i > 0 && <div className={`pipeline-connector ${done ? 'pipeline-connector-done' : ''}`} />}
                  <div className="pipeline-dot" />
                  <span className="pipeline-label">{m}</span>
                  {done && <span className="pipeline-time">{formatElapsed(elapsed!)}</span>}
                </div>
              );
            })}
          </div>
        )}

        <nav className="agent-tracker-nav" aria-label="Tracker views">
          {(['live', 'history', 'issues'] as TrackerTab[]).map(t => (
            <button key={t} aria-pressed={tab === t} onClick={() => setTab(t)}>
              {t === 'live' ? `Live (${events.length})` : t === 'history' ? `History (${generations.length})` : `Issues${issues.length > 0 ? ` (${issues.length})` : ''}`}
            </button>
          ))}
          <button className="tracker-refresh-btn" onClick={loadHistory} aria-label="Refresh history"><RotateCcw size={13} /></button>
        </nav>

        <div className="agent-tracker-body">
          {tab === 'live' && (
            <div className="tracker-events">
              {events.length === 0 && (
                <p className="tracker-empty">No events yet. Start a generation to see real-time agent activity here.</p>
              )}
              {events.map(event => (
                <div key={event.id} className={`tracker-event tracker-event-${event.severity} tracker-event-${event.type}`}>
                  <span className="tracker-event-icon" aria-hidden="true">{eventIcon(event.type)}</span>
                  <div className="tracker-event-body">
                    <span className="tracker-event-label">{event.label}</span>
                    {event.detail && <span className="tracker-event-detail">{event.detail}</span>}
                  </div>
                  <time className="tracker-event-time" dateTime={new Date(event.time).toISOString()}>{formatTime(event.time)}</time>
                </div>
              ))}
            </div>
          )}

          {tab === 'history' && (
            <div className="tracker-history">
              {genError && <p className="tracker-alert" role="alert">{genError}</p>}
              {!genError && generations.length === 0 && (
                <p className="tracker-empty">No generation history for this project yet.</p>
              )}
              {generations.map((gen, i) => (
                <div key={i} className="tracker-history-row">
                  <div className="tracker-history-top">
                    <span className="tracker-history-model">{gen.model === 'claude-sonnet-6' ? 'Claude Sonnet 4.6' : gen.model}</span>
                    <span className={`tracker-badge tracker-badge-${gen.status}`}>{gen.status}</span>
                  </div>
                  <div className="tracker-history-meta">
                    <span><Clock size={10} aria-hidden="true" />{formatTime(gen.started_at)}</span>
                    <span>TTFB: {gen.first_response_at != null ? formatElapsed(gen.first_response_at - gen.started_at) : '—'}</span>
                    <span>Duration: {gen.finished_at ? formatElapsed(gen.finished_at - gen.started_at) : 'running…'}</span>
                    <span>Calls: {gen.provider_calls ?? '—'}</span>
                    <span>Tokens: {gen.input_tokens?.toLocaleString() ?? '—'} / {gen.output_tokens?.toLocaleString() ?? '—'}</span>
                  </div>
                  {gen.provider_calls != null && gen.provider_calls > 3 && (
                    <p className="tracker-row-hint">⚠ {gen.provider_calls} LLM calls — may indicate a tool loop or unclear prompt</p>
                  )}
                  {gen.first_response_at != null && (gen.first_response_at - gen.started_at) > 10_000 && (
                    <p className="tracker-row-hint">⚠ High TTFB ({formatElapsed(gen.first_response_at - gen.started_at)}) — provider may be under load</p>
                  )}
                </div>
              ))}
            </div>
          )}

          {tab === 'issues' && (
            <div className="tracker-issues">
              {issues.length === 0 && (
                <p className="tracker-empty">No issues detected in this session. Issues appear when the agent encounters errors, retries, or the preview fails.</p>
              )}
              {issues.map((issue, i) => (
                <div key={i} className={`tracker-issue tracker-issue-${issue.severity}`}>
                  <div className="tracker-issue-header">
                    {issue.severity === 'error' ? <AlertCircle size={14} aria-hidden="true" /> : <Bug size={14} aria-hidden="true" />}
                    <strong>{issue.label}</strong>
                    <span className={`tracker-badge tracker-badge-${issue.severity}`}>{issue.severity}</span>
                  </div>
                  <p className="tracker-issue-desc">{issue.description}</p>
                </div>
              ))}

              <section className="tracker-guide">
                <h4>Agent behavior guide</h4>
                <ul>
                  <li><strong>DSML output</strong> — model used raw internal tool syntax; an auto-retry fires; switch to a more reliable model if it recurs</li>
                  <li><strong>More than 3 LLM calls</strong> — suggests tool loop or ambiguous prompt; add specificity to the request</li>
                  <li><strong>TTFB {'>'} 10s</strong> — provider latency or cold start; retry or switch model</li>
                  <li><strong>Empty response</strong> — model returned nothing; check token budget and provider availability</li>
                  <li><strong>Preview error</strong> — generated code has a runtime error; check the Console tab for details</li>
                  <li><strong>Partial file</strong> — generation was truncated by the token cap; increase max tokens or simplify the request</li>
                  <li><strong>Auto-fix triggered</strong> — code had a detectable error; the agent attempted a repair</li>
                </ul>
              </section>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
