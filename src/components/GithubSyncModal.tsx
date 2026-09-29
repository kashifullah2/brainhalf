import { useCallback, useEffect, useRef, useState, type ReactElement, type RefObject } from 'react';
import { FolderCode, Loader2 } from 'lucide-react';
import { appEvents } from '../lib/events';
import { exportToGitHub, importFromGitHub, type GitHubImport } from '../lib/github-export';

type FileMap = Record<string, string>;
type BuildLogType = 'info' | 'success' | 'warn' | 'error';

interface GithubSyncOptions {
  activeProjectId: string | null;
  isCurrent: () => boolean;
  filesRef: RefObject<FileMap>;
  commitFiles: (next: FileMap, opts?: { replaceAll?: boolean; persist?: boolean; debounce?: boolean; sync?: boolean }) => void;
  addBuildLog: (text: string, type?: BuildLogType) => void;
}

export interface GithubSync {
  open: boolean;
  syncing: boolean;
  savedRepo: string;
  hasToken: boolean;
  openModal: () => void;
  closeModal: () => void;
  autoSync: () => Promise<void>;
  modalElement: ReactElement | null;
}

interface ModalStatus { loading: boolean; error?: string; success?: string }

/** GitHub two-way sync: export, auto-sync after generation, and repository import. */
export function useGithubSync({ activeProjectId, isCurrent, filesRef, commitFiles, addBuildLog }: GithubSyncOptions): GithubSync {
  const [showModal, setShowModal] = useState(false);
  const [repo, setRepo] = useState('');
  const [token, setToken] = useState('');
  // Repo name persisted per project; token stays in React state only (never on disk)
  const [savedRepo, setSavedRepo] = useState('');
  const [owner, setOwner] = useState('');
  const [pendingImport, setPendingImport] = useState<GitHubImport | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [lastSynced, setLastSynced] = useState<Date | null>(null);
  const [status, setStatus] = useState<ModalStatus>({ loading: false });
  const triggerRef = useRef<HTMLElement | null>(null);
  const modalRef = useRef<HTMLDivElement | null>(null);

  // Clear legacy keys that accidentally stored the PAT
  useEffect(() => { try { sessionStorage.removeItem('brainhalf_github_pat'); localStorage.removeItem('brainhalf_github_pat'); } catch {} }, []);

  // On project switch: load persisted repo name, clear session token
  useEffect(() => {
    if (!activeProjectId) return;
    setToken('');
    setLastSynced(null);
    setSyncing(false);
    try {
      const saved = localStorage.getItem(`bh_github_repo:${activeProjectId}`) || '';
      setSavedRepo(saved);
      setRepo(saved);
      setOwner(localStorage.getItem(`bh_github_owner:${activeProjectId}`) || '');
    } catch { setSavedRepo(''); setRepo(''); setOwner(''); }
  }, [activeProjectId]);

  useEffect(() => { if (showModal) setStatus({ loading: false }); }, [showModal]);

  const openModal = useCallback(() => {
    triggerRef.current = document.activeElement as HTMLElement;
    setShowModal(true);
  }, []);
  const closeModal = useCallback(() => {
    setShowModal(false);
    setStatus({ loading: false });
    setPendingImport(null);
  }, []);

  useEffect(() => {
    const unsub = appEvents.on('open-github-modal', () => openModal());
    return () => unsub();
  }, [openModal]);

  // Escape closes the dialog without tearing down the rest of the UI.
  useEffect(() => {
    if (!showModal) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); closeModal(); }
    };
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [showModal, closeModal]);

  // Restore focus to the control that opened the dialog.
  useEffect(() => { if (!showModal) triggerRef.current?.focus?.(); }, [showModal]);

  const handleExport = useCallback(async () => {
    if (!repo.trim() || !token.trim()) return;
    setStatus({ loading: true });
    try {
      await exportToGitHub(filesRef.current, repo.trim(), token.trim(), owner.trim() || undefined);
      try { localStorage.setItem(`bh_github_repo:${activeProjectId}`, repo.trim()); } catch {}
      setSavedRepo(repo.trim());
      setLastSynced(new Date());
      setStatus({ loading: false, success: `Synced to ${repo.trim()} — auto-sync enabled for this session.` });
      addBuildLog(`Pushed codebase to GitHub: ${repo.trim()}`, 'success');
    } catch (err: any) {
      setStatus({ loading: false, error: err?.message || 'Failed to export to GitHub' });
      addBuildLog(`GitHub export failed: ${err?.message || err}`, 'error');
    }
  }, [repo, token, owner, addBuildLog, activeProjectId, filesRef]);

  const handleImport = useCallback(async () => {
    if (!repo.trim() || !token.trim()) return;
    setStatus({ loading: true });
    setPendingImport(null);
    try {
      const input = repo.trim();
      const slash = input.indexOf('/');
      const parsedOwner = slash > 0 ? input.slice(0, slash) : undefined;
      const repoName = slash > 0 ? input.slice(slash + 1) : input;
      const result = await importFromGitHub(repoName, token.trim(), parsedOwner);
      setPendingImport(result);
      setStatus({ loading: false });
    } catch (err: any) {
      setStatus({ loading: false, error: err?.message || 'Failed to import from GitHub' });
      addBuildLog(`GitHub import failed: ${err?.message || err}`, 'error');
    }
  }, [repo, token, addBuildLog]);

  const confirmImport = useCallback(() => {
    if (!pendingImport) return;
    commitFiles(pendingImport.files, { replaceAll: true });
    const input = repo.trim();
    const slash = input.indexOf('/');
    const parsedOwner = slash > 0 ? input.slice(0, slash) : '';
    const repoName = slash > 0 ? input.slice(slash + 1) : input;
    try {
      localStorage.setItem(`bh_github_repo:${activeProjectId}`, repoName);
      if (parsedOwner) localStorage.setItem(`bh_github_owner:${activeProjectId}`, parsedOwner);
      else localStorage.removeItem(`bh_github_owner:${activeProjectId}`);
    } catch {}
    setSavedRepo(repoName);
    setRepo(repoName);
    setOwner(parsedOwner);
    setLastSynced(new Date());
    const count = Object.keys(pendingImport.files).length;
    addBuildLog(`Imported ${count} files from GitHub: ${pendingImport.repoUrl} (${pendingImport.branch})`, 'success');
    setPendingImport(null);
    setStatus({ loading: false, success: `Imported ${count} files from ${repoName} — auto-sync enabled for this session.` });
  }, [pendingImport, repo, activeProjectId, commitFiles, addBuildLog]);

  const autoSync = useCallback(async () => {
    if (!token || !savedRepo || !isCurrent()) return;
    setSyncing(true);
    try {
      await exportToGitHub(filesRef.current, savedRepo, token, owner.trim() || undefined);
      setLastSynced(new Date());
      addBuildLog(`Auto-synced to GitHub: ${savedRepo}`, 'success');
    } catch (err: any) {
      addBuildLog(`GitHub auto-sync failed: ${err?.message || err}`, 'warn');
    } finally {
      setSyncing(false);
    }
  }, [token, savedRepo, owner, addBuildLog, isCurrent, filesRef]);

  const disconnect = useCallback(() => {
    try { localStorage.removeItem(`bh_github_repo:${activeProjectId}`); } catch {}
    try { localStorage.removeItem(`bh_github_owner:${activeProjectId}`); } catch {}
    setSavedRepo('');
    setOwner('');
    setRepo('');
    setToken('');
    setPendingImport(null);
    setLastSynced(null);
    setShowModal(false);
  }, [activeProjectId]);

  const modalElement = showModal ? (
    <GithubSyncModal
      modalRef={modalRef}
      repo={repo}
      token={token}
      savedRepo={savedRepo}
      lastSynced={lastSynced}
      status={status}
      pendingImport={pendingImport}
      onRepoChange={setRepo}
      onTokenChange={setToken}
      onExport={handleExport}
      onImport={handleImport}
      onConfirmImport={confirmImport}
      onCancelImport={() => setPendingImport(null)}
      onDisconnect={disconnect}
      onClose={closeModal}
    />
  ) : null;

  return { open: showModal, syncing, savedRepo, hasToken: Boolean(token), openModal, closeModal, autoSync, modalElement };
}

interface GithubSyncModalProps {
  modalRef: RefObject<HTMLDivElement | null>;
  repo: string;
  token: string;
  savedRepo: string;
  lastSynced: Date | null;
  status: ModalStatus;
  pendingImport: GitHubImport | null;
  onRepoChange: (value: string) => void;
  onTokenChange: (value: string) => void;
  onExport: () => void;
  onImport: () => void;
  onConfirmImport: () => void;
  onCancelImport: () => void;
  onDisconnect: () => void;
  onClose: () => void;
}

function GithubSyncModal(props: GithubSyncModalProps) {
  const { modalRef, repo, token, savedRepo, lastSynced, status, pendingImport } = props;
  const busy = status.loading;
  const ready = repo.trim().length > 0 && token.trim().length > 0;

  // Focus management: move focus in on open and keep Tab inside the dialog.
  useEffect(() => {
    const node = modalRef.current;
    if (!node) return;
    const focusables = node.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), [href], select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    focusables[0]?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    node.addEventListener('keydown', onKeyDown);
    return () => node.removeEventListener('keydown', onKeyDown);
  }, [modalRef]);

  return (
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget) props.onClose(); }}
      style={{
        position: 'fixed', inset: 0, background: 'var(--overlay)',
        backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center',
        justifyContent: 'center', zIndex: 100000, padding: '16px'
      }}
    >
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="github-export-title"
        style={{
          background: 'var(--bg-panel)', border: '1px solid var(--border-color)',
          borderRadius: '12px', width: '420px', maxWidth: '100%',
          // maxHeight + scroll: at 375px with the keyboard up, the fixed
          // layout put the submit button below the fold and unreachable.
          maxHeight: '90vh', overflowY: 'auto',
          padding: '24px', boxShadow: '0 20px 40px rgba(0,0,0,0.5)',
          display: 'flex', flexDirection: 'column', gap: '16px'
        }}
      >
        <h3 id="github-export-title" style={{ margin: 0, fontSize: '18px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <FolderCode size={20} />
          {savedRepo && token ? 'GitHub auto-sync' : 'Export to GitHub'}
        </h3>

        <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>
          {savedRepo && token
            ? `Auto-syncing to ${savedRepo} after each generation.${lastSynced ? ` Last synced ${lastSynced.toLocaleTimeString()}.` : ''}`
            : 'New repositories are private. Existing repositories keep their default branch and newer commits are protected. Enter owner/repo to pull from another account with Import.'}
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <label htmlFor="gh-repo" style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>
            Repository name
          </label>
          <input
            id="gh-repo"
            type="text"
            value={repo}
            onChange={e => props.onRepoChange(e.target.value)}
            placeholder="brainhalf-app"
            autoComplete="off"
            style={{
              background: 'var(--bg-surface)', border: '1px solid var(--border-color)',
              borderRadius: '6px', padding: '10px 12px', color: 'var(--text-primary)',
              fontSize: '13px', outline: 'none', fontFamily: 'inherit', minHeight: '44px'
            }}
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <label htmlFor="gh-token" style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>
            Personal access token
          </label>
          <input
            id="gh-token"
            type="password"
            value={token}
            onChange={e => props.onTokenChange(e.target.value)}
            placeholder="ghp_..."
            autoComplete="off"
            style={{
              background: 'var(--bg-surface)', border: '1px solid var(--border-color)',
              borderRadius: '6px', padding: '10px 12px', color: 'var(--text-primary)',
              fontSize: '13px', outline: 'none', fontFamily: 'inherit', minHeight: '44px'
            }}
          />
          <span style={{ fontSize: '11px', color: 'var(--text-muted)', lineHeight: 1.5 }}>
            Use a fine-grained token with Contents read/write, or a classic token with repo scope. Kept in memory this session only — never written to disk — to enable auto-sync after generation.
          </span>
        </div>

        {status.error && (
          <div role="alert" style={{ padding: '10px', background: 'rgba(239, 68, 68, 0.1)', color: 'var(--color-error)', border: '1px solid rgba(239, 68, 68, 0.2)', borderRadius: '6px', fontSize: '12px', lineHeight: 1.5 }}>
            {status.error}
          </div>
        )}

        {status.success && (
          <div role="status" style={{ padding: '10px', background: 'rgba(34, 197, 94, 0.1)', color: 'var(--color-success)', border: '1px solid rgba(34, 197, 94, 0.2)', borderRadius: '6px', fontSize: '12px', lineHeight: 1.5 }}>
            {status.success}
          </div>
        )}

        {pendingImport && (
          <div role="alertdialog" aria-label="Confirm GitHub import" style={{ padding: '12px', background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: '8px', fontSize: '12px', lineHeight: 1.6, display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <span>
              Import <strong>{Object.keys(pendingImport.files).length} files</strong> from <strong>{pendingImport.repoUrl}</strong> ({pendingImport.branch})?
              This replaces the current project files.
            </span>
            {pendingImport.skipped.length > 0 && (
              <span style={{ color: 'var(--text-muted)' }}>
                Skipped: {pendingImport.skipped.slice(0, 4).join(', ')}{pendingImport.skipped.length > 4 ? ` and ${pendingImport.skipped.length - 4} more` : ''}
              </span>
            )}
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button
                onClick={props.onCancelImport}
                style={{ padding: '8px 14px', minHeight: '44px', background: 'transparent', border: '1px solid var(--border-color)', color: 'var(--text-primary)', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}
              >
                Cancel import
              </button>
              <button
                onClick={props.onConfirmImport}
                style={{ padding: '8px 14px', minHeight: '44px', background: 'var(--color-warning, #d97706)', border: 'none', color: '#fff', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: 600 }}
              >
                Replace project files
              </button>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '8px', flexWrap: 'wrap' }}>
          {savedRepo && (
            <button
              onClick={props.onDisconnect}
              style={{
                padding: '10px 16px', minHeight: '44px', background: 'transparent',
                border: '1px solid var(--border-color)', color: 'var(--color-error, #ef4444)',
                borderRadius: '6px', cursor: 'pointer', fontSize: '13px', marginRight: 'auto'
              }}
            >
              Disconnect
            </button>
          )}
          <button
            onClick={props.onClose}
            style={{
              padding: '10px 16px', minHeight: '44px', background: 'transparent',
              border: '1px solid var(--border-color)', color: 'var(--text-primary)',
              borderRadius: '6px', cursor: 'pointer', fontSize: '13px'
            }}
          >
            Cancel
          </button>
          <button
            onClick={props.onImport}
            disabled={busy || !!pendingImport || !ready}
            style={{
              padding: '10px 16px', minHeight: '44px', background: 'transparent',
              border: '1px solid var(--color-primary, #3b82f6)', color: 'var(--color-primary, #3b82f6)',
              borderRadius: '6px', cursor: 'pointer', fontSize: '13px',
              opacity: (busy || !!pendingImport || !ready) ? 0.5 : 1
            }}
          >
            {busy ? 'Working…' : 'Import'}
          </button>
          <button
            onClick={props.onExport}
            disabled={busy || !ready}
            style={{
              padding: '10px 16px', minHeight: '44px', background: 'var(--brand-primary)',
              border: 'none', color: 'var(--text-on-accent)', borderRadius: '6px',
              cursor: (busy || !ready) ? 'not-allowed' : 'pointer',
              opacity: (busy || !ready) ? 0.6 : 1,
              display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', fontWeight: 500
            }}
          >
            {busy && <Loader2 size={14} className="lucide-spin" />}
            {busy ? 'Syncing...' : savedRepo ? 'Sync now' : 'Export & enable auto-sync'}
          </button>
        </div>
      </div>
    </div>
  );
}
