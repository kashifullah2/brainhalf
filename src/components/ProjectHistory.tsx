import { useEffect, useState } from 'react';
import { History, RotateCcw, Save } from 'lucide-react';
import { authFetch } from '../lib/auth-client';
import type { SourceCheckpoint } from '../lib/source-history';
import ConfirmModal from './ConfirmModal';

export default function ProjectHistory({ projectId }: { projectId: string }) {
  const [items, setItems] = useState<SourceCheckpoint[]>([]); const [revision, setRevision] = useState<number | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [label, setLabel] = useState('');
  const [review, setReview] = useState<{ id: string; revision: number; changes: Array<{ path: string; change: string; before: number; after: number }> } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const origin = ['localhost', '127.0.0.1'].includes(location.hostname) ? import.meta.env.VITE_BACKEND_HOST || '' : '';
  const base = `${origin}/agents/chat-agent/${encodeURIComponent(projectId)}/checkpoints`;
  async function request(path = '', init: RequestInit = {}) {
    const response = await authFetch(base + path, { ...init, signal: init.signal || AbortSignal.timeout(15_000), headers: { 'Content-Type': 'application/json' } });
    const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Source history is unavailable.'); return data;
  }
  async function refresh(signal?: AbortSignal) { const data = await request('', { signal }); if (!Array.isArray(data.checkpoints) || typeof data.revision !== 'number') throw new Error('History could not be loaded. Refresh and try again.'); setItems(data.checkpoints); setRevision(data.revision); }
  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'History unavailable.'); });
    return () => controller.abort();
  }, [projectId]);
  async function perform(action: () => Promise<void>) { setBusy(true); setError(''); try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Action failed.'); } finally { setBusy(false); } }
  return <section className="settings-card source-history"><h3><History size={17} />Source history</h3>
    <p>Save a working version before trying something new. The agent also saves a checkpoint before changing code.</p>
    <form className="settings-actions" onSubmit={event => { event.preventDefault(); void perform(async () => { await request('', { method: 'POST', body: JSON.stringify({ label, revision }) }); setLabel(''); await refresh(); }); }}>
      <input aria-label="Checkpoint name" maxLength={120} placeholder="e.g. Working checkout" value={label} onChange={event => setLabel(event.target.value)} />
      <button disabled={busy || revision === null}><Save size={14} />Save checkpoint</button>
      <button type="button" disabled={busy} onClick={() => void perform(() => refresh())}>Refresh history</button>
    </form>
    {error && <p role="alert" className="settings-error">{error}</p>}
    {!items.length && revision !== null && <p className="settings-muted">Your first saved version will appear here.</p>}
    {items.map(item => <div className="settings-job" key={item.id}><span><strong>{item.label}</strong><small>{new Date(item.createdAt).toLocaleString()} · {item.fileCount} files</small></span><button disabled={busy} onClick={() => void perform(async () => { const data = await request(`?id=${encodeURIComponent(item.id)}`); setReview({ ...data, id: item.id }); })}>Review changes</button></div>)}
    {review && <div className="source-history-review"><h4>Changes when restored</h4>{review.changes.length ? <><ul>{review.changes.map(change => <li key={change.path}><code>{change.path}</code><span>{change.change} · {change.before.toLocaleString()} → {change.after.toLocaleString()} characters</span></li>)}</ul><button disabled={busy} onClick={() => setConfirm(true)}><RotateCcw size={14} />Restore this version</button></> : <p>These source files already match the current project.</p>}<button onClick={() => setReview(null)}>Close review</button></div>}
    <p className="settings-muted">Up to 12 versions within 20 MB. Restoring saves the current source first. Secrets, database records and deployed releases are separate.</p>
    <ConfirmModal isOpen={confirm} title="Restore this source version?" message="This replaces the files shown in the review. Your current source will be saved as a recovery checkpoint. Database records and deployed releases stay as they are." confirmLabel="Restore source" isDestructive error={error || undefined} onCancel={() => setConfirm(false)} onConfirm={() => void perform(async () => { if (!review) return; await request('/restore', { method: 'POST', body: JSON.stringify({ id: review.id, revision: review.revision }) }); setConfirm(false); setReview(null); await refresh(); })} />
  </section>;
}
