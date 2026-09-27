import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ChevronDown, LogOut, Plus } from 'lucide-react';
import { authFetch, getToken, removeProject } from '../lib/auth-client';
import { appEvents } from '../lib/events';
import { getProjects, type Project, updateProjectName } from '../lib/project-store';
import { useModalFocus } from '../lib/use-modal-focus';
import { BrainHalfLogo } from './BrainHalfLogo';
import ConfirmModal from './ConfirmModal';
import RecentProjects from './RecentProjects';
import ThemeToggle from './ThemeToggle';
import './LandingPage.css';
import './DashboardPage.css';

interface DashboardPageProps {
  currentUser: { email?: string; name?: string };
  onOpenProject: (projectId: string) => void;
  onCreateProject: () => void;
  creatingProject?: boolean;
  onGoHome: () => void;
  onLogout: () => void | Promise<void>;
}

interface AccountAiUsage {
  day: string;
  calls: number;
  reservedOutputTokens: number;
  activeGenerations: number;
  limits: { dailyCalls: number; dailyOutputTokens: number; concurrentGenerations: number };
}

function dedupe(projects: Project[]) {
  const seen = new Set<string>();
  return projects.filter(project => {
    if (seen.has(project.id)) return false;
    seen.add(project.id);
    return true;
  });
}

export default function DashboardPage({ currentUser, onOpenProject, onCreateProject, creatingProject = false, onGoHome, onLogout }: DashboardPageProps) {
  const [projects, setProjects] = useState<Project[]>(() => dedupe(getProjects()));
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => { setHydrated(true); }, []);
  const [projectToDelete, setProjectToDelete] = useState<string | null>(null);
  const [projectToRename, setProjectToRename] = useState<Project | null>(null);
  const [renamedName, setRenamedName] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [_cleanupStatus, setCleanupStatus] = useState<Array<{ project_id: string; completed_at: number | null; attempts: number }>>([]);
  const [cleanupError, setCleanupError] = useState('');
  useEffect(() => {
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const origin = ['localhost', '127.0.0.1'].includes(location.hostname) ? import.meta.env.VITE_BACKEND_HOST || '' : '';
        const response = await authFetch(`${origin}/api/account/deletions`, { signal: controller.signal });
        const body = await response.json();
        if (!response.ok || !Array.isArray(body.deletions)) throw new Error('Cleanup status is unavailable.');
        if (!controller.signal.aborted) { setCleanupStatus(body.deletions); setCleanupError(''); }
      } catch { if (!controller.signal.aborted) setCleanupError('Cleanup status could not be loaded. It will retry automatically.'); }
      if (!controller.signal.aborted) timer = setTimeout(refresh, 15_000);
    };
    void refresh(); return () => { controller.abort(); clearTimeout(timer); };
  }, [projects.length]);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [accountAiUsage, setAccountAiUsage] = useState<AccountAiUsage | null>(null);
  const [accountAiUsageError, setAccountAiUsageError] = useState('');
  const deletionPending = useRef(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const renameDialogRef = useModalFocus(!!projectToRename, () => setProjectToRename(null));
  const refreshProjects = useCallback(() => setProjects(dedupe(getProjects())), []);

  useEffect(() => {
    const subscriptions = ['project-renamed', 'project-messages-updated', 'project-account-changed', 'project-list-updated'].map(event => appEvents.on(event, refreshProjects));
    return () => subscriptions.forEach(unsubscribe => unsubscribe());
  }, [refreshProjects]);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!userMenuRef.current?.contains(event.target as Node)) setShowUserMenu(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  useEffect(() => {
    if (!showUserMenu) return;
    const controller = new AbortController();
    const loadUsage = async () => {
      try {
        const origin = ['localhost', '127.0.0.1'].includes(location.hostname) ? import.meta.env.VITE_BACKEND_HOST || '' : '';
        const token = getToken();
        const response = await fetch(`${origin}/api/account/ai-usage`, {
          signal: controller.signal,
          credentials: 'include',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const body = await response.json();
        if (!response.ok || !body?.limits) throw new Error('Account usage is unavailable.');
        if (!controller.signal.aborted) {
          setAccountAiUsage(body as AccountAiUsage);
          setAccountAiUsageError('');
        }
      } catch {
        if (!controller.signal.aborted) setAccountAiUsageError('AI usage is unavailable right now.');
      }
    };
    if (!accountAiUsage && !accountAiUsageError) void loadUsage();
    return () => controller.abort();
  }, [showUserMenu, accountAiUsage, accountAiUsageError]);

  const handleDelete = async () => {
    if (!projectToDelete || deletionPending.current) return;
    deletionPending.current = true;
    setDeleting(true);
    setDeleteError('');
    try {
      setProjects(dedupe(await removeProject(projectToDelete)));
      setProjectToDelete(null);
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : 'Deletion failed. Try again.');
    } finally {
      deletionPending.current = false;
      setDeleting(false);
    }
  };

  const saveRename = () => {
    if (projectToRename && renamedName.trim()) updateProjectName(projectToRename.id, renamedName.trim());
    setProjectToRename(null);
    refreshProjects();
  };

  const userInitial = (currentUser.name || currentUser.email || 'U').trim()[0].toUpperCase();

  return <div className="dashboard-page landing-container">
    <a className="studio-skip-link" href="#dashboard-main">Skip to content</a>
    <header className="dashboard-header">
      <button className="landing-brand-group" type="button" onClick={onGoHome} aria-label="BrainHalf home">
        <span className="landing-brand-logo"><BrainHalfLogo size={27} strokeWidth={1.6} color="currentColor" /></span>
        <span className="landing-brand-text">BrainHalf</span>
      </button>
      <div className="dashboard-header-actions">
        <ThemeToggle />
        <div className="landing-user-menu-anchor" ref={userMenuRef}>
          <button className="landing-user-menu-trigger" type="button" onClick={() => setShowUserMenu(value => !value)} aria-label="User profile and menu" aria-haspopup="menu" aria-expanded={showUserMenu}>
            <span className="landing-user-avatar" aria-hidden="true">{userInitial}</span>
            <span className="landing-user-menu-email">{currentUser.email || 'Your account'}</span>
            <ChevronDown size={13} aria-hidden="true" />
          </button>
          {showUserMenu && <div className="landing-user-dropdown" role="menu">
            <div className="landing-user-dropdown-info dashboard-user-dropdown-info" role="status">
              <p className="user-email">{currentUser.email || 'Your account'}</p>
              {accountAiUsage && <p className="dashboard-account-usage">AI usage today ({accountAiUsage.day} UTC): {accountAiUsage.calls}/{accountAiUsage.limits.dailyCalls} calls · {accountAiUsage.reservedOutputTokens.toLocaleString()}/{accountAiUsage.limits.dailyOutputTokens.toLocaleString()} tokens · {accountAiUsage.activeGenerations}/{accountAiUsage.limits.concurrentGenerations} active</p>}
              {!accountAiUsage && accountAiUsageError && <p className="dashboard-account-usage dashboard-account-usage-error">{accountAiUsageError}</p>}
            </div>
            <button className="landing-dropdown-item" type="button" role="menuitem" onClick={() => { setShowUserMenu(false); void onLogout(); }}><LogOut size={14} />Sign out</button>
          </div>}
        </div>
      </div>
    </header>
    <main className="dashboard-main" id="dashboard-main">
      <button className="dashboard-back" type="button" onClick={onGoHome}><ArrowLeft size={15} /> Back to home</button>
      <section className="dashboard-welcome" aria-labelledby="dashboard-title">
        <div><p className="studio-section-label">YOUR WORKSPACE</p><h1 id="dashboard-title">Projects</h1><p>Start something new or continue where you left off.</p></div>
        <button className="dashboard-new-project" type="button" onClick={onCreateProject} disabled={creatingProject}><Plus size={18} /> {creatingProject ? 'Creating…' : 'New project'}</button>
      </section>
      {cleanupError && <p className="dashboard-notice" role="status">{cleanupError}</p>}
      {!hydrated ? (
        <div className="dashboard-skeleton-grid" aria-busy="true" aria-label="Loading projects">
          {[0, 1, 2, 3].map(i => <div key={i} className="dashboard-skeleton-card" />)}
        </div>
      ) : projects.length > 0 ? (
        <RecentProjects projects={projects} onOpenProject={onOpenProject} onRenameProject={project => { setProjectToRename(project); setRenamedName(project.name); }} onDeleteProject={setProjectToDelete} />
      ) : (
        <section className="dashboard-empty"><span><Plus size={22} /></span><h2>Create your first project</h2><p>Open a blank workspace and describe the app you want to make.</p><button type="button" onClick={onCreateProject} disabled={creatingProject}>{creatingProject ? 'Creating…' : 'Create new project'}</button></section>
      )}
    </main>
    {projectToDelete && <ConfirmModal isOpen title="Delete Project" message="Delete this project, its app deployments, and databases? Access is revoked immediately. Local files and conversation history are removed after the request is accepted; server source, attachments, credentials and backups are erased by an automatically retried cleanup job. Track completion on the dashboard." confirmLabel={deleting ? 'Deleting…' : 'Delete Project'} pending={deleting} error={deleteError} isDestructive onConfirm={handleDelete} onCancel={() => { if (!deletionPending.current) { setProjectToDelete(null); setDeleteError(''); } }} />}
    {projectToRename && <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="rename-title" ref={renameDialogRef} tabIndex={-1} onClick={() => setProjectToRename(null)}><div className="modal-card dashboard-rename" onClick={event => event.stopPropagation()}><h2 id="rename-title">Rename project</h2><label htmlFor="project-rename-input">Project name</label><input id="project-rename-input" className="text-input" value={renamedName} onChange={event => setRenamedName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') saveRename(); }} /><div><button className="button-secondary" type="button" onClick={() => setProjectToRename(null)}>Cancel</button><button className="button-primary" type="button" onClick={saveRename}>Save</button></div></div></div>}
  </div>;
}
