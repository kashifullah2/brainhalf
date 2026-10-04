import { useCallback, useEffect, useState, type JSX } from 'react';
import { ChevronDown, ChevronRight, Clock, FileMinus, FilePlus, FileText, History, RotateCcw, Save, Zap } from 'lucide-react';
import { authFetch } from '../lib/auth-client';
import { apiOrigin } from '../lib/api-origin';
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

export function isAutoSave(label: string) {
  return label === 'Before agent changes' || label === 'Before restore';
}

export function displayLabel(label: string) {
  return label.replace('Before agent changes', 'Auto-saved before builder change').replace('Before restore', 'Auto-saved before restore');
}

export type ReviewLoadAction = 'collapse' | 'ensure';

/**
 * Decide what a history-row click should do with the review panel.
 * "See changes" toggles the panel open/closed. "Restore" must never collapse
 * it: collapsing clears the review, so the confirm dialog would open with no
 * review and its confirm button would silently do nothing.
 */
export function resolveReviewLoad(expandedId: string | null, targetId: string, forRestore: boolean): ReviewLoadAction {
  if (!forRestore && expandedId === targetId) return 'collapse';
  return 'ensure';
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

  const base = `${apiOrigin()}/agents/chat-agent/${encodeURIComponent(projectId)}/checkpoints`;

  async function request(path = '', init: RequestInit = {}) {
    const response = await authFetch(base + path, {
      ...init,
      signal: init.signal || AbortSignal.timeout(15_000),
      headers: { 'Content-Type': 'application/json' },
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Version history is unavailable.');
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

  async function loadReview(id: string, opts?: { forRestore?: boolean }) {
    if (resolveReviewLoad(expandedId, id, opts?.forRestore ?? false) === 'collapse') { setExpandedId(null); setReview(null); return; }
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
      <div key={item.id} className="history-item">
        <div className="history-item-row">
          <span className="history-item-icon" style={{ color: auto ? 'var(--text-muted)' : 'var(--accent-primary)' }}>
            {auto ? <Zap size={14} strokeWidth={2} /> : <Save size={14} strokeWidth={2} />}
          </span>
          <span className="history-item-main">
            <strong className="history-item-title">{displayLabel(item.label)}</strong>
            <span className="history-item-meta">
              <span title={absTime(item.createdAt)}><Clock size={10} />{relativeTime(item.createdAt)}</span>
              <span>·</span>
              <span>{item.fileCount} file{item.fileCount === 1 ? '' : 's'}</span>
              {item.bytes > 0 && <><span>·</span><span>{Math.round(item.bytes / 1024)} KB</span></>}
            </span>
          </span>
          <span className="history-item-actions">
            <button
              type="button"
              className="button-ghost"
              disabled={busy}
              onClick={() => void loadReview(item.id)}
            >
              {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              {expanded ? 'Hide changes' : 'See changes'}
            </button>
            <button
              type="button"
              className="button-secondary"
              disabled={busy}
              onClick={() => { void loadReview(item.id, { forRestore: true }).then(() => setConfirm(true)); }}
              title="Restore this version"
            >
              <RotateCcw size={12} />Restore
            </button>
          </span>
        </div>

        {expandedReview && (
          <div className="history-diff">
            {expandedReview.changes.length === 0 ? (
              <span className="settings-muted">No differences — these files already match the current project.</span>
            ) : (
              <ul>
                {expandedReview.changes.map(ch => (
                  <li key={ch.path}>
                    {CHANGE_ICON[ch.change] ?? CHANGE_ICON.modify}
                    <code>{ch.path}</code>
                    <span className="history-diff-tag">
                      {ch.change}
                      {ch.change === 'modify' && ` ${ch.before > ch.after ? '▼' : '▲'} ${Math.abs(ch.after - ch.before).toLocaleString()} chars`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <div className="history-diff-actions">
              <button
                type="button"
                className="button-primary"
                disabled={busy}
                onClick={() => setConfirm(true)}
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
      <h3><History size={17} />App versions</h3>
      <p>Save a named version before trying something new. The builder automatically saves one before every change.</p>

      <form className="settings-actions" onSubmit={e => {
        e.preventDefault();
        void perform(async () => {
          await request('', { method: 'POST', body: JSON.stringify({ label: label.trim() || 'Manual version', revision }) });
          setLabel('');
          await refresh();
        });
      }}>
        <input
          aria-label="Version name"
          maxLength={120}
          placeholder="e.g. Working login flow"
          value={label}
          onChange={e => setLabel(e.target.value)}
        />
        <button type="submit" className="button-primary" disabled={busy || revision === null}>
          <Save size={14} />Save version
        </button>
        <button type="button" className="button-secondary" disabled={busy} onClick={() => void perform(() => refresh())}>
          Refresh
        </button>
      </form>

      {error && <p role="alert" className="settings-error">{error}</p>}

      {items.length === 0 && revision !== null && (
        <p className="settings-muted">No saved versions yet. The builder saves one automatically before its next change.</p>
      )}

      {userSaves.length > 0 && (
        <div>
          <div className="history-group-label">Saved by you</div>
          {userSaves.map(renderItem)}
        </div>
      )}

      {autoSaves.length > 0 && (
        <div>
          <div className="history-group-label">Automatic saves</div>
          {autoSaves.map(renderItem)}
        </div>
      )}

      <p className="settings-muted" style={{ marginTop: '14px', fontSize: '12px' }}>
        Keeps up to 12 versions. Restoring first saves your current files as a new version. Saved data and live releases are not included.
      </p>

      <ConfirmModal
        isOpen={confirm}
        title="Go back to this version?"
        message="This replaces all your app's files with the saved version. Your current files are saved as a new version first. Saved data and live releases are not affected."
        confirmLabel="Restore version"
        isDestructive
        error={error || undefined}
        onCancel={() => setConfirm(false)}
        onConfirm={() => void perform(async () => {
          if (!review) { setConfirm(false); return; }
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
