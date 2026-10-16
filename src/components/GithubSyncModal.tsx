import { useCallback, useEffect, useRef, useState, type ReactElement, type RefObject } from 'react';
import { FolderCode, Loader2, CheckCircle2 } from 'lucide-react';
import { authFetch, startGithubSignIn } from '../lib/auth-client';
import { apiOrigin } from '../lib/api-origin';
import { appEvents } from '../lib/events';
import { exportToGitHub, importFromGitHub, type GitHubImport } from '../lib/github-export';

type FileMap = Record<string, string>;
type BuildLogType = 'info' | 'success' | 'warn' | 'error';

export function parseGithubRepoInput(rawInput: string, fallbackOwner?: string): { repoName: string; owner?: string } {
  let cleaned = (rawInput || '').trim();
  cleaned = cleaned
    .replace(/^https?:\/\/(?:www\.)?github\.com\//i, '')
    .replace(/^git@github\.com:/i, '')
    .replace(/\.git$/i, '')
    .replace(/^\/+|\/+$/g, '');
  const parts = cleaned.split('/').filter(Boolean);
  if (parts.length >= 2 && parts[0] !== '.' && parts[0] !== '..') {
    return { owner: parts[0], repoName: parts[1] };
  }
  const cleanOwner = fallbackOwner?.trim() || undefined;
  return { repoName: cleaned, owner: cleanOwner };
}

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
interface GithubRepoItem { full_name: string; name: string; owner?: { login?: string }; private?: boolean }

/** GitHub one-click OAuth connection, repository picker, push, pull, and auto-sync. */
export function useGithubSync({ activeProjectId, isCurrent, filesRef, commitFiles, addBuildLog }: GithubSyncOptions): GithubSync {
  const [showModal, setShowModal] = useState(false);
  const [repo, setRepo] = useState('');
  const [token, setToken] = useState('');
  const [connectedLogin, setConnectedLogin] = useState('');
  const [userRepos, setUserRepos] = useState<GithubRepoItem[]>([]);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [connectingOAuth, setConnectingOAuth] = useState(false);
  const [savedRepo, setSavedRepo] = useState('');
  const [owner, setOwner] = useState('');
  const [pendingImport, setPendingImport] = useState<GitHubImport | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [lastSynced, setLastSynced] = useState<Date | null>(null);
  const [status, setStatus] = useState<ModalStatus>({ loading: false });
  const triggerRef = useRef<HTMLElement | null>(null);
  const modalRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => { try { sessionStorage.removeItem('brainhalf_github_pat'); localStorage.removeItem('brainhalf_github_pat'); } catch {} }, []);

  // Load connected GitHub OAuth account from the server
  const loadConnectedGithub = useCallback((signal?: AbortSignal) => {
    authFetch(`${apiOrigin()}/api/account/github-token`, { signal })
      .then(async res => {
        if (!res.ok) return;
        const data = await res.json() as { connected?: boolean; login?: string; token?: string };
        if (data?.connected && data.token) {
          setToken(data.token);
          if (data.login) setConnectedLogin(data.login);
        }
      })
      .catch(() => { /* ignore */ });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    loadConnectedGithub(controller.signal);
    return () => controller.abort();
  }, [activeProjectId, loadConnectedGithub]);

  // Fetch user's GitHub repositories automatically when modal opens and connected
  useEffect(() => {
    if (!showModal || !token) return;
    let cancelled = false;
    setLoadingRepos(true);
    fetch('https://api.github.com/user/repos?sort=updated&per_page=50', {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    })
      .then(async res => {
        if (!res.ok) return;
        const list = await res.json() as GithubRepoItem[];
        if (!cancelled && Array.isArray(list)) {
          setUserRepos(list);
        }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoadingRepos(false); });
    return () => { cancelled = true; };
  }, [showModal, token]);

  useEffect(() => {
    if (!activeProjectId) return;
    setLastSynced(null);
    setSyncing(false);
    try {
      const saved = localStorage.getItem(`bh_github_repo:${activeProjectId}`) || '';
      const savedOwner = localStorage.getItem(`bh_github_owner:${activeProjectId}`) || '';
      setSavedRepo(saved);
      setRepo(savedOwner && saved ? `${savedOwner}/${saved}` : saved);
      setOwner(savedOwner);
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

  useEffect(() => {
    if (!showModal) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); closeModal(); }
    };
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [showModal, closeModal]);

  useEffect(() => { if (!showModal) triggerRef.current?.focus?.(); }, [showModal]);

  const handleConnectGithubButton = useCallback(async () => {
    setConnectingOAuth(true);
    setStatus({ loading: false });
    try {
      await startGithubSignIn('connect', activeProjectId);
    } catch (err: any) {
      setConnectingOAuth(false);
      setStatus({ loading: false, error: err?.message || 'Could not start GitHub connection.' });
    }
  }, [activeProjectId]);

  const handleExport = useCallback(async () => {
    if (!repo.trim() || !token.trim()) return;
    setStatus({ loading: true });
    try {
      const { repoName, owner: parsedOwner } = parseGithubRepoInput(repo, owner || connectedLogin);
      const repoUrl = await exportToGitHub(filesRef.current, repoName, token.trim(), parsedOwner);
      const urlParts = repoUrl.replace(/^https?:\/\/github\.com\//i, '').split('/');
      const resolvedOwner = urlParts[0] || parsedOwner || '';
      const resolvedRepo = urlParts[1] || repoName;
      try {
        localStorage.setItem(`bh_github_repo:${activeProjectId}`, resolvedRepo);
        if (resolvedOwner) localStorage.setItem(`bh_github_owner:${activeProjectId}`, resolvedOwner);
      } catch {}
      setSavedRepo(resolvedRepo);
      setOwner(resolvedOwner);
      if (resolvedOwner) setConnectedLogin(resolvedOwner);
      setLastSynced(new Date());
      setStatus({ loading: false, success: `Synced to ${resolvedOwner ? `${resolvedOwner}/${resolvedRepo}` : resolvedRepo}.` });
      addBuildLog(`Pushed codebase to GitHub: ${repoUrl}`, 'success');
    } catch (err: any) {
      setStatus({ loading: false, error: err?.message || 'Failed to push to GitHub' });
      addBuildLog(`GitHub push failed: ${err?.message || err}`, 'error');
    }
  }, [repo, token, owner, connectedLogin, addBuildLog, activeProjectId, filesRef]);

  const handleImport = useCallback(async () => {
    if (!repo.trim() || !token.trim()) return;
    setStatus({ loading: true });
    setPendingImport(null);
    try {
      const { repoName, owner: parsedOwner } = parseGithubRepoInput(repo, owner || connectedLogin);
      const result = await importFromGitHub(repoName, token.trim(), parsedOwner);
      setPendingImport(result);
      setStatus({ loading: false });
    } catch (err: any) {
      setStatus({ loading: false, error: err?.message || 'Failed to pull from GitHub' });
      addBuildLog(`GitHub pull failed: ${err?.message || err}`, 'error');
    }
  }, [repo, token, owner, connectedLogin, addBuildLog]);

  const confirmImport = useCallback(() => {
    if (!pendingImport) return;
    commitFiles(pendingImport.files, { replaceAll: true });
    const { repoName, owner: parsedOwner } = parseGithubRepoInput(repo, owner || connectedLogin);
    const resolvedOwner = parsedOwner || '';
    try {
      localStorage.setItem(`bh_github_repo:${activeProjectId}`, repoName);
      if (resolvedOwner) localStorage.setItem(`bh_github_owner:${activeProjectId}`, resolvedOwner);
      else localStorage.removeItem(`bh_github_owner:${activeProjectId}`);
    } catch {}
    setSavedRepo(repoName);
    setRepo(resolvedOwner ? `${resolvedOwner}/${repoName}` : repoName);
    setOwner(resolvedOwner);
    setLastSynced(new Date());
    const count = Object.keys(pendingImport.files).length;
    addBuildLog(`Imported ${count} files from GitHub: ${pendingImport.repoUrl} (${pendingImport.branch})`, 'success');
    setPendingImport(null);
    setStatus({ loading: false, success: `Imported ${count} files from ${repoName}.` });
  }, [pendingImport, repo, owner, connectedLogin, activeProjectId, commitFiles, addBuildLog]);

  const autoSync = useCallback(async () => {
    if (!token || !savedRepo || !isCurrent()) return;
    setSyncing(true);
    try {
      const { repoName, owner: parsedOwner } = parseGithubRepoInput(savedRepo, owner || connectedLogin);
      await exportToGitHub(filesRef.current, repoName, token, parsedOwner);
      setLastSynced(new Date());
      addBuildLog(`Auto-synced to GitHub: ${parsedOwner ? `${parsedOwner}/${repoName}` : repoName}`, 'success');
    } catch (err: any) {
      addBuildLog(`GitHub auto-sync failed: ${err?.message || err}`, 'warn');
    } finally {
      setSyncing(false);
    }
  }, [token, savedRepo, owner, connectedLogin, addBuildLog, isCurrent, filesRef]);

  const disconnect = useCallback(async () => {
    try {
      const res = await authFetch(`${apiOrigin()}/api/account/github-token`, { method: 'DELETE' });
      if (!res.ok) {
        setStatus({ loading: false, error: 'Could not revoke GitHub token. Please try again.' });
        return;
      }
    } catch {
      setStatus({ loading: false, error: 'Could not reach the server to revoke the GitHub token.' });
      return;
    }
    try { localStorage.removeItem(`bh_github_repo:${activeProjectId}`); } catch {}
    try { localStorage.removeItem(`bh_github_owner:${activeProjectId}`); } catch {}
    setSavedRepo('');
    setOwner('');
    setRepo('');
    setToken('');
    setConnectedLogin('');
    setUserRepos([]);
    setPendingImport(null);
    setLastSynced(null);
    setShowModal(false);
  }, [activeProjectId]);

  const modalElement = showModal ? (
    <GithubSyncModal
      modalRef={modalRef}
      repo={repo}
      hasToken={Boolean(token)}
      connectedLogin={connectedLogin}
      userRepos={userRepos}
      loadingRepos={loadingRepos}
      connectingOAuth={connectingOAuth}
      savedRepo={savedRepo}
      lastSynced={lastSynced}
      status={status}
      pendingImport={pendingImport}
      onRepoChange={setRepo}
      onConnectGithub={() => void handleConnectGithubButton()}
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
  hasToken: boolean;
  connectedLogin: string;
  userRepos: GithubRepoItem[];
  loadingRepos: boolean;
  connectingOAuth: boolean;
  savedRepo: string;
  lastSynced: Date | null;
  status: ModalStatus;
  pendingImport: GitHubImport | null;
  onRepoChange: (value: string) => void;
  onConnectGithub: () => void;
  onExport: () => void;
  onImport: () => void;
  onConfirmImport: () => void;
  onCancelImport: () => void;
  onDisconnect: () => void;
  onClose: () => void;
}

function GithubSyncModal(props: GithubSyncModalProps) {
  const { modalRef, repo, hasToken, connectedLogin, userRepos, loadingRepos, connectingOAuth, savedRepo, lastSynced, status, pendingImport } = props;
  const busy = status.loading || connectingOAuth;
  const ready = hasToken && repo.trim().length > 0;

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
          maxHeight: '90vh', overflowY: 'auto',
          padding: '24px', boxShadow: '0 20px 40px rgba(0,0,0,0.5)',
          display: 'flex', flexDirection: 'column', gap: '16px'
        }}
      >
        <h3 id="github-export-title" style={{ margin: 0, fontSize: '18px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <FolderCode size={20} />
          GitHub
        </h3>

        {!hasToken ? (
          <>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>
              Connect your GitHub account with one click to push this project to a repository or import an existing repository.
            </p>
            <button
              type="button"
              disabled={connectingOAuth}
              onClick={props.onConnectGithub}
              style={{
                width: '100%', minHeight: '44px', padding: '10px 16px',
                background: '#24292f', color: '#ffffff', border: '1px solid rgba(255,255,255,0.14)',
                borderRadius: '8px', cursor: connectingOAuth ? 'wait' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px',
                fontSize: '14px', fontWeight: 600
              }}
            >
              {connectingOAuth ? (
                <Loader2 size={18} className="lucide-spin" />
              ) : (
                <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" width="18" height="18">
                  <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/>
                </svg>
              )}
              <span>{connectingOAuth ? 'Opening GitHub…' : 'Connect with GitHub'}</span>
            </button>
          </>
        ) : (
          <>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '10px 12px', background: 'rgba(34, 197, 94, 0.08)',
              border: '1px solid rgba(34, 197, 94, 0.25)', borderRadius: '8px', fontSize: '13px'
            }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-primary)', fontWeight: 500 }}>
                <CheckCircle2 size={16} color="var(--color-success, #22c55e)" />
                Connected{connectedLogin ? ` as @${connectedLogin}` : ' to GitHub'}
              </span>
              <button
                type="button"
                onClick={props.onDisconnect}
                style={{
                  background: 'transparent', border: 'none', color: 'var(--color-error, #ef4444)',
                  fontSize: '12px', fontWeight: 600, cursor: 'pointer', padding: '4px 6px'
                }}
              >
                Disconnect
              </button>
            </div>

            <p style={{ fontSize: '12.5px', color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>
              {savedRepo
                ? `Linked to ${savedRepo}.${lastSynced ? ` Last synced ${lastSynced.toLocaleTimeString()}.` : ''}`
                : 'Choose an existing repository below or enter a new repository name to create one.'}
            </p>

            {userRepos.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label htmlFor="gh-repo-select" style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                  Your GitHub repositories {loadingRepos ? '(loading…)' : ''}
                </label>
                <select
                  id="gh-repo-select"
                  value={userRepos.some(r => r.full_name === repo || r.name === repo) ? repo : ''}
                  onChange={e => { if (e.target.value) props.onRepoChange(e.target.value); }}
                  style={{
                    background: 'var(--bg-surface)', border: '1px solid var(--border-color)',
                    borderRadius: '6px', padding: '10px 12px', color: 'var(--text-primary)',
                    fontSize: '13px', outline: 'none', fontFamily: 'inherit', minHeight: '42px'
                  }}
                >
                  <option value="">Select an existing repository…</option>
                  {userRepos.map(r => (
                    <option key={r.full_name} value={r.full_name}>
                      {r.full_name} {r.private ? '(Private)' : '(Public)'}
                    </option>
                  ))}
                </select>
              </div>
            )}

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
                  fontSize: '13px', outline: 'none', fontFamily: 'inherit', minHeight: '42px'
                }}
              />
            </div>
          </>
        )}

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
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button
                onClick={props.onCancelImport}
                style={{ padding: '8px 14px', minHeight: '40px', background: 'transparent', border: '1px solid var(--border-color)', color: 'var(--text-primary)', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}
              >
                Cancel
              </button>
              <button
                onClick={props.onConfirmImport}
                style={{ padding: '8px 14px', minHeight: '40px', background: 'var(--color-warning, #d97706)', border: 'none', color: '#fff', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: 600 }}
              >
                Replace project files
              </button>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '4px', flexWrap: 'wrap' }}>
          <button
            onClick={props.onClose}
            style={{
              padding: '10px 16px', minHeight: '42px', background: 'transparent',
              border: '1px solid var(--border-color)', color: 'var(--text-primary)',
              borderRadius: '6px', cursor: 'pointer', fontSize: '13px'
            }}
          >
            Close
          </button>
          {hasToken && (
            <>
              <button
                onClick={props.onImport}
                disabled={busy || !!pendingImport || !ready}
                style={{
                  padding: '10px 16px', minHeight: '42px', background: 'transparent',
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
                  padding: '10px 16px', minHeight: '42px', background: 'var(--brand-primary)',
                  border: 'none', color: 'var(--text-on-accent)', borderRadius: '6px',
                  cursor: (busy || !ready) ? 'not-allowed' : 'pointer',
                  opacity: (busy || !ready) ? 0.6 : 1,
                  display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', fontWeight: 500
                }}
              >
                {busy && <Loader2 size={14} className="lucide-spin" />}
                {busy ? 'Syncing…' : savedRepo ? 'Sync now' : 'Push to GitHub'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
