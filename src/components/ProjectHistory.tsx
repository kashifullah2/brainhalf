import { useCallback, useEffect, useState, type JSX } from 'react';
import { ChevronDown, ChevronRight, Clock, FileMinus, FilePlus, FileText, History, RotateCcw, Save, Zap } from 'lucide-react';
import { authFetch } from '../lib/auth-client';
import type { SourceCheckpoint } from '../lib/source-history';
import ConfirmModal from './ConfirmModal';

interface ReviewData {
  id: string;
  revision: number;
  changes: Array<{ path: string; change: string; before: number; after: number }>;
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const s = Math.floor(diff / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} day${d === 1 ? '' : 's'} ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d > 180 ? 'numeric' : undefined });
}

function absTime(ts: number): string {
  return new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function isAutoSave(label: string) {
  return label === 'Before agent changes' || label === 'Before restore';
}

const CHANGE_ICON: Record<string, JSX.Element> = {
  modify:  <FileText size={11} style={{ flexShrink: 0, color: 'var(--color-info)' }} />,
  restore: <FilePlus  size={11} style={{ flexShrink: 0, color: 'var(--color-success)' }} />,
  remove:  <FileMinus size={11} style={{ flexShrink: 0, color: 'var(--color-error)' }} />,
};

export default function ProjectHistory({ projectId }: { projectId: string }) {
  const [items, setItems] = useState<SourceCheckpoint[]>([]);
  const [revision, setRevision] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [label, setLabel] = useState('');
  const [review, setReview] = useState<ReviewData | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);

  const origin = ['localhost', '127.0.0.1'].includes(location.hostname) ? import.meta.env.VITE_BACKEND_HOST || '' : '';
  const base = `${origin}/agents/chat-agent/${encodeURIComponent(projectId)}/checkpoints`;

  async function request(path = '', init: RequestInit = {}) {
    const response = await authFetch(base + path, {
      ...init,
      signal: init.signal || AbortSignal.timeout(15_000),
      headers: { 'Content-Type': 'application/json' },
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Source history is unavailable.');
    return data;
  }

  const refresh = useCallback(async (signal?: AbortSignal) => {
    const data = await request('', { signal });
    if (!Array.isArray(data.checkpoints) || typeof data.revision !== 'number')
      throw new Error('History could not be loaded. Refresh and try again.');
    setItems(data.checkpoints);
    setRevision(data.revision);
  }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const ctrl = new AbortController();
    void refresh(ctrl.signal).catch(cause => {
      if (!ctrl.signal.aborted) setError(cause instanceof Error ? cause.message : 'History unavailable.');
    });
    return () => ctrl.abort();
  }, [refresh]);

  async function perform(action: () => Promise<void>) {
    setBusy(true); setError('');
    try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Action failed.'); } finally { setBusy(false); }
  }

  async function loadReview(id: string) {
    if (expandedId === id) { setExpandedId(null); setReview(null); return; }
    await perform(async () => {
      const data = await request(`?id=${encodeURIComponent(id)}`);
      setReview({ ...data, id });
      setExpandedId(id);
    });
  }

  const autoSaves = items.filter(it => isAutoSave(it.label));
  const userSaves = items.filter(it => !isAutoSave(it.label));

  function renderItem(item: SourceCheckpoint) {
    const expanded = expandedId === item.id;
    const auto = isAutoSave(item.label);
    const expandedReview = expanded && review?.id === item.id ? review : null;

    return (
      <div key={item.id} style={{ borderBottom: '1px solid var(--border-subtle)', paddingBottom: '1px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 0', flexWrap: 'wrap' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0, color: auto ? 'var(--text-muted)' : 'var(--accent-primary)' }}>
            {auto ? <Zap size={13} strokeWidth={2} /> : <Save size={13} strokeWidth={2} />}
          </span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <strong style={{ fontSize: '13px', color: 'var(--text-primary)', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {auto ? item.label.replace('Before agent changes', 'Auto-save before generation').replace('Before restore', 'Auto-save before restore') : item.label}
            </strong>
            <span style={{ display: 'flex', gap: '8px', fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px', flexWrap: 'wrap' }}>
              <span title={absTime(item.createdAt)} style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                <Clock size={10} />{relativeTime(item.createdAt)}
              </span>
              <span>·</span>
              <span>{item.fileCount} file{item.fileCount === 1 ? '' : 's'}</span>
              {item.bytes > 0 && <><span>·</span><span>{Math.round(item.bytes / 1024)} KB</span></>}
            </span>
          </span>
          <span style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
            <button
              type="button"
              disabled={busy}
              onClick={() => void loadReview(item.id)}
              style={{ background: 'transparent', border: '1px solid var(--border-subtle)', borderRadius: '6px', padding: '4px 9px', fontSize: '11px', color: 'var(--text-secondary)', cursor: busy ? 'default' : 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
            >
              {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              {expanded ? 'Hide diff' : 'View diff'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => { void loadReview(item.id).then(() => setConfirm(true)); }}
              title="Restore this checkpoint"
              style={{ background: 'transparent', border: '1px solid var(--border-subtle)', borderRadius: '6px', padding: '4px 9px', fontSize: '11px', color: 'var(--text-secondary)', cursor: busy ? 'default' : 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
            >
              <RotateCcw size={12} />Restore
            </button>
          </span>
        </div>

        {expandedReview && (
          <div style={{ marginBottom: '10px', background: 'var(--bg-surface)', borderRadius: '8px', padding: '10px 12px', fontSize: '12px' }}>
            {expandedReview.changes.length === 0 ? (
              <span style={{ color: 'var(--text-muted)' }}>No differences — these files already match the current project.</span>
            ) : (
              <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '5px' }}>
                {expandedReview.changes.map(ch => (
                  <li key={ch.path} style={{ display: 'flex', alignItems: 'center', gap: '7px', flexWrap: 'wrap' }}>
                    {CHANGE_ICON[ch.change] ?? CHANGE_ICON.modify}
                    <code style={{ fontSize: '11px', color: 'var(--text-primary)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {ch.path}
                    </code>
                    <span style={{ fontSize: '10px', color: 'var(--text-muted)', flexShrink: 0, background: 'rgba(0,0,0,0.06)', padding: '1px 6px', borderRadius: '4px', textTransform: 'capitalize' }}>
                      {ch.change}
                      {ch.change === 'modify' && ` ${ch.before > ch.after ? '▼' : '▲'} ${Math.abs(ch.after - ch.before).toLocaleString()} chars`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <div style={{ marginTop: '10px', display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button
                type="button"
                disabled={busy}
                onClick={() => setConfirm(true)}
                style={{ background: 'var(--accent-primary)', border: 'none', borderRadius: '6px', padding: '6px 12px', fontSize: '12px', color: '#fff', cursor: busy ? 'default' : 'pointer', display: 'flex', alignItems: 'center', gap: '5px', fontWeight: 500 }}
              >
                <RotateCcw size={13} />Restore this version
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <section className="settings-card source-history">
      <h3><History size={17} />Source history</h3>
      <p>Save named checkpoints before experimenting. The agent auto-saves before every code change.</p>

      <form className="settings-actions" onSubmit={e => {
        e.preventDefault();
        void perform(async () => {
          await request('', { method: 'POST', body: JSON.stringify({ label: label.trim() || 'Manual checkpoint', revision }) });
          setLabel('');
          await refresh();
        });
      }}>
        <input
          aria-label="Checkpoint name"
          maxLength={120}
          placeholder="e.g. Working login flow"
          value={label}
          onChange={e => setLabel(e.target.value)}
        />
        <button type="submit" disabled={busy || revision === null}>
          <Save size={14} />Save checkpoint
        </button>
        <button type="button" disabled={busy} onClick={() => void perform(() => refresh())}>
          Refresh
        </button>
      </form>

      {error && <p role="alert" className="settings-error">{error}</p>}

      {items.length === 0 && revision !== null && (
        <p className="settings-muted" style={{ padding: '12px 0' }}>No checkpoints yet. The agent will save one automatically before the next generation.</p>
      )}

      {userSaves.length > 0 && (
        <div style={{ marginBottom: '8px' }}>
          <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', padding: '8px 0 4px' }}>
            Saved by you
          </div>
          {userSaves.map(renderItem)}
        </div>
      )}

      {autoSaves.length > 0 && (
        <div>
          <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', padding: '8px 0 4px' }}>
            Auto-saves
          </div>
          {autoSaves.map(renderItem)}
        </div>
      )}

      <p className="settings-muted" style={{ marginTop: '14px', fontSize: '11px' }}>
        Up to 12 versions · max 20 MB. Restoring pre-saves your current files first. Database records and deployed releases are not versioned.
      </p>

      <ConfirmModal
        isOpen={confirm}
        title="Restore this source version?"
        message="This replaces all project files with the checkpoint snapshot. Your current source will be saved as a recovery checkpoint first. Database records and deployed releases are not affected."
        confirmLabel="Restore source"
        isDestructive
        error={error || undefined}
        onCancel={() => setConfirm(false)}
        onConfirm={() => void perform(async () => {
          if (!review) return;
          await request('/restore', { method: 'POST', body: JSON.stringify({ id: review.id, revision: review.revision }) });
          setConfirm(false);
          setReview(null);
          setExpandedId(null);
          await refresh();
        })}
      />
    </section>
  );
}
