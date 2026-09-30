import { useEffect, useMemo, useState } from 'react';
import { Users, BadgeCheck, Activity, FolderKanban, RefreshCw, Search, ShieldCheck, Trash2, AlertTriangle, X } from 'lucide-react';
import BrainHalfLogo from './BrainHalfLogo';
import SiteHeaderActions from './SiteHeaderActions';
import MobileNav from './MobileNav';
import { authFetch } from '../lib/auth-client';
import './AdminPage.css';

interface AdminUser {
  id: string;
  email: string;
  createdAt: number;
  lastLoginAt: number | null;
  projects: number;
  verified: boolean;
}

interface AdminProject {
  id: string;
  ownerId: string;
  ownerEmail: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  deleted: boolean;
  published: boolean;
  showcase: boolean;
}

interface OutcomeReport {
  measuredAt: number;
  generations: number;
  completedGenerations: number;
  verifiedWorkingGenerations: number;
  workingAppsPerGeneration: number | null;
  publishAttempts: number;
  published: number;
  failedPublishes: number;
  publishingSuccessRate: number | null;
  medianTimeToFirstLiveMs: number | null;
  firstLiveAccounts: number;
  matureWeekOneAccounts: number;
  returnedWeekOneAccounts: number;
  weekOneRetention: number | null;
}

type LoadState = 'loading' | 'signed-out' | 'forbidden' | 'error' | 'ready';
type Tab = 'accounts' | 'projects';

interface ConfirmState {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => Promise<void>;
}

function relativeTime(timestamp: number | null): string {
  if (!timestamp) return 'Never';
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} d ago`;
  return new Date(timestamp).toLocaleDateString();
}

function percent(value: number | null): string {
  return value === null ? '—' : `${Math.round(value * 100)}%`;
}

function duration(ms: number | null): string {
  if (ms === null) return '—';
  const minutes = ms / 60_000;
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const hours = minutes / 60;
  if (hours < 24) return `${hours.toFixed(1)} h`;
  return `${Math.round(hours / 24)} d`;
}

export default function AdminPage() {
  const [state, setState] = useState<LoadState>('loading');
  const [tab, setTab] = useState<Tab>('accounts');
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [projects, setProjects] = useState<AdminProject[]>([]);
  const [outcomes, setOutcomes] = useState<OutcomeReport | null>(null);
  const [search, setSearch] = useState('');
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const load = async (signal?: AbortSignal) => {
    setState('loading');
    setNotice(null);
    try {
      const [usersResponse, projectsResponse, outcomesResponse] = await Promise.all([
        authFetch('/api/admin/users', { signal }),
        authFetch('/api/admin/projects', { signal }),
        authFetch('/api/admin/outcomes', { signal }),
      ]);
      if (usersResponse.status === 401) return setState('signed-out');
      if (usersResponse.status === 403) return setState('forbidden');
      if (!usersResponse.ok) return setState('error');
      const usersBody = await usersResponse.json() as { users?: AdminUser[] };
      setUsers(Array.isArray(usersBody.users) ? usersBody.users : []);
      if (projectsResponse.ok) {
        const projectsBody = await projectsResponse.json() as { projects?: AdminProject[] };
        setProjects(Array.isArray(projectsBody.projects) ? projectsBody.projects : []);
      }
      if (outcomesResponse.ok) setOutcomes(await outcomesResponse.json() as OutcomeReport);
      setState('ready');
    } catch {
      if (!signal?.aborted) setState('error');
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, []);

  const filteredUsers = useMemo(() => {
    const query = search.trim().toLowerCase();
    return query ? users.filter(user => user.email.toLowerCase().includes(query)) : users;
  }, [users, search]);

  const filteredProjects = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return projects;
    return projects.filter(p =>
      p.name.toLowerCase().includes(query) ||
      p.ownerEmail.toLowerCase().includes(query) ||
      p.id.toLowerCase().includes(query));
  }, [projects, search]);

  const weekAgo = Date.now() - 7 * 86_400_000;
  const stats = useMemo(() => ({
    total: users.length,
    verified: users.filter(user => user.verified).length,
    unverified: users.filter(user => !user.verified).length,
    activeWeek: users.filter(user => (user.lastLoginAt ?? 0) >= weekAgo).length,
    withProjects: users.filter(user => user.projects > 0).length,
    totalProjects: projects.length,
    liveProjects: projects.filter(p => !p.deleted).length,
  }), [users, projects]);

  const runConfirmed = async (fn: () => Promise<void>) => {
    setWorking(true);
    try {
      await fn();
      await load();
    } finally {
      setWorking(false);
      setConfirm(null);
    }
  };

  const deleteProject = (project: AdminProject) => {
    setConfirm({
      title: 'Delete this project forever?',
      message: `"${project.name}" by ${project.ownerEmail} will be erased completely — app files, backend, backups, and the registry entry. This cannot be undone.`,
      confirmLabel: 'Delete forever',
      onConfirm: () => runConfirmed(async () => {
        const res = await authFetch(`/api/admin/projects/${encodeURIComponent(project.id)}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('delete failed');
        setNotice({ kind: 'ok', text: `Project "${project.name}" deleted completely.` });
      }),
    });
  };

  const deleteUser = (user: AdminUser) => {
    setConfirm({
      title: `Delete ${user.email}?`,
      message: `This removes the account and all ${user.projects} of their projects — everything erased completely. This cannot be undone.`,
      confirmLabel: 'Delete account',
      onConfirm: () => runConfirmed(async () => {
        const res = await authFetch(`/api/admin/users/${encodeURIComponent(user.id)}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('delete failed');
        const body = await res.json() as { deletedProjects?: number };
        setNotice({ kind: 'ok', text: `${user.email} deleted along with ${body.deletedProjects ?? 0} projects.` });
      }),
    });
  };

  const deleteUnverified = () => {
    const targets = users.filter(u => !u.verified);
    if (!targets.length) return;
    setConfirm({
      title: `Delete ${targets.length} unverified accounts?`,
      message: `This removes every account that never verified their email, plus all of their projects. Verified accounts are kept. This cannot be undone.`,
      confirmLabel: `Delete ${targets.length} accounts`,
      onConfirm: () => runConfirmed(async () => {
        let deleted = 0;
        let failed = 0;
        for (const target of targets) {
          try {
            const res = await authFetch(`/api/admin/users/${encodeURIComponent(target.id)}`, { method: 'DELETE' });
            if (res.ok) deleted++; else failed++;
          } catch { failed++; }
        }
        setNotice(failed
          ? { kind: 'error', text: `Deleted ${deleted} accounts, ${failed} failed. Refresh to see the current list.` }
          : { kind: 'ok', text: `Deleted ${deleted} unverified accounts. Only verified accounts remain.` });
      }),
    });
  };

  return <main className="admin-page">
    <header className="admin-header">
      <div className="admin-header-inner">
        <a href="/" className="admin-brand" aria-label="BrainHalf home">
          <BrainHalfLogo size={30} />
          <strong>BrainHalf</strong>
          <span className="admin-operator-badge">Operator</span>
        </a>
        <nav className="admin-nav" aria-label="Admin sections">
          <a href="#overview">Overview</a>
          <a href="#health">Product health</a>
          <a href="#manage">Manage</a>
        </nav>
        <MobileNav links={[
          { href: '#overview', label: 'Overview' },
          { href: '#health', label: 'Product health' },
          { href: '#manage', label: 'Manage' },
        ]} />
        <SiteHeaderActions />
      </div>
    </header>
    <div className="admin-body">
      <p className="studio-section-label">OPERATOR</p>
      <div className="admin-title-row">
        <div>
          <h1>Accounts &amp; product health</h1>
          <p className="admin-subtitle">Private operator view — who is here, how the product is performing, and cleanup tools.</p>
        </div>
        <button type="button" className="admin-refresh" onClick={() => void load()} disabled={state === 'loading' || working}>
          <RefreshCw size={14} className={state === 'loading' ? 'admin-spin' : ''} aria-hidden="true" />
          {state === 'loading' ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {notice && <div className={`admin-notice ${notice.kind === 'ok' ? 'admin-notice-ok' : ''}`} role="status">
        <p>{notice.text}</p>
        <button type="button" className="admin-notice-close" onClick={() => setNotice(null)} aria-label="Dismiss"><X size={14} /></button>
      </div>}

      {state === 'signed-out' && <div className="admin-notice" role="status">
        <h2>Sign in required</h2>
        <p>Sign in with your operator account, then reopen this page.</p>
        <a className="admin-action" href="/">Go to BrainHalf to sign in</a>
      </div>}
      {state === 'forbidden' && <div className="admin-notice" role="alert">
        <h2>Not an operator account</h2>
        <p>This account is not on the operator allowlist. Add your user ID to the <code>PRODUCT_METRICS_OWNER_IDS</code> secret and redeploy.</p>
      </div>}
      {state === 'error' && <div className="admin-notice" role="alert">
        <h2>Could not load the admin data</h2>
        <p>Check your connection and try again. If this persists, the endpoint may not be deployed yet.</p>
      </div>}

      {state === 'loading' && <div className="admin-skeletons" aria-hidden="true">
        <div className="admin-skeleton admin-skeleton-stats" />
        <div className="admin-skeleton admin-skeleton-table" />
      </div>}

      {state === 'ready' && <>
        <section className="admin-stats" id="overview" aria-label="Account overview">
          <div className="admin-stat"><span className="admin-stat-icon"><Users size={17} aria-hidden="true" /></span><strong>{stats.total}</strong><span>Total accounts</span></div>
          <div className="admin-stat"><span className="admin-stat-icon"><BadgeCheck size={17} aria-hidden="true" /></span><strong>{stats.verified}</strong><span>Verified</span></div>
          <div className="admin-stat"><span className="admin-stat-icon"><Activity size={17} aria-hidden="true" /></span><strong>{stats.activeWeek}</strong><span>Active this week</span></div>
          <div className="admin-stat"><span className="admin-stat-icon"><FolderKanban size={17} aria-hidden="true" /></span><strong>{stats.liveProjects}</strong><span>Live projects ({stats.totalProjects} total)</span></div>
        </section>

        {outcomes && <section className="admin-card" id="health" aria-label="Product health">
          <div className="admin-card-head">
            <span className="admin-stat-icon"><ShieldCheck size={17} aria-hidden="true" /></span>
            <div>
              <h2>Product health</h2>
              <p>Measured {new Date(outcomes.measuredAt).toLocaleString()} — generations, publishes and retention.</p>
            </div>
          </div>
          <div className="admin-stats admin-stats-tight">
            <div className="admin-stat"><strong>{outcomes.generations}</strong><span>Generations started</span></div>
            <div className="admin-stat"><strong>{percent(outcomes.workingAppsPerGeneration)}</strong><span>Verified working apps</span></div>
            <div className="admin-stat"><strong>{percent(outcomes.publishingSuccessRate)}</strong><span>Publish success ({outcomes.published}/{outcomes.publishAttempts})</span></div>
            <div className="admin-stat"><strong>{duration(outcomes.medianTimeToFirstLiveMs)}</strong><span>Median time to first live app</span></div>
            <div className="admin-stat"><strong>{percent(outcomes.weekOneRetention)}</strong><span>Week-one retention ({outcomes.returnedWeekOneAccounts}/{outcomes.matureWeekOneAccounts})</span></div>
          </div>
        </section>}

        <section id="manage" aria-label="Manage">
          <div className="admin-tabs" role="tablist" aria-label="Management views">
            <button type="button" role="tab" aria-selected={tab === 'accounts'} className={tab === 'accounts' ? 'admin-tab-active' : ''} onClick={() => setTab('accounts')}>
              <Users size={14} aria-hidden="true" /> Accounts <span className="admin-count">{filteredUsers.length}</span>
            </button>
            <button type="button" role="tab" aria-selected={tab === 'projects'} className={tab === 'projects' ? 'admin-tab-active' : ''} onClick={() => setTab('projects')}>
              <FolderKanban size={14} aria-hidden="true" /> Projects <span className="admin-count">{filteredProjects.length}</span>
            </button>
          </div>

          <div className="admin-table-bar">
            <div className="admin-table-actions">
              {tab === 'accounts' && stats.unverified > 0 && (
                <button type="button" className="admin-danger-btn" onClick={deleteUnverified} disabled={working}>
                  <Trash2 size={14} aria-hidden="true" />
                  Delete {stats.unverified} unverified account{stats.unverified === 1 ? '' : 's'}
                </button>
              )}
            </div>
            <label className="admin-search">
              <Search size={15} aria-hidden="true" />
              <input
                type="search"
                placeholder={tab === 'accounts' ? 'Filter by email…' : 'Filter by name, owner, or id…'}
                value={search}
                onChange={event => setSearch(event.target.value)}
                aria-label={tab === 'accounts' ? 'Filter accounts by email' : 'Filter projects'}
              />
            </label>
          </div>

          {tab === 'accounts' && <div className="admin-table-wrap">
            <table className="admin-table">
              <thead><tr><th>Email</th><th>Signed up</th><th>Last active</th><th>Projects</th><th>Status</th><th><span className="admin-sr">Actions</span></th></tr></thead>
              <tbody>
                {filteredUsers.map(user => <tr key={user.id}>
                  <td>{user.email}</td>
                  <td>{new Date(user.createdAt).toLocaleDateString()}</td>
                  <td>{relativeTime(user.lastLoginAt)}</td>
                  <td>{user.projects}</td>
                  <td>{user.verified
                    ? <span className="admin-badge admin-badge-ok">Verified</span>
                    : <span className="admin-badge">Unverified</span>}</td>
                  <td>
                    <button type="button" className="admin-row-btn admin-row-btn-danger" onClick={() => deleteUser(user)} disabled={working} title={`Delete ${user.email} and all their projects`}>
                      <Trash2 size={14} aria-hidden="true" /><span className="admin-sr">Delete</span>
                    </button>
                  </td>
                </tr>)}
                {filteredUsers.length === 0 && <tr><td colSpan={6} className="admin-empty">No accounts match.</td></tr>}
              </tbody>
            </table>
          </div>}

          {tab === 'projects' && <div className="admin-table-wrap">
            <table className="admin-table">
              <thead><tr><th>Project</th><th>Owner</th><th>Updated</th><th>Status</th><th><span className="admin-sr">Actions</span></th></tr></thead>
              <tbody>
                {filteredProjects.map(project => <tr key={project.id}>
                  <td>{project.name}<div className="admin-sub">{project.id}</div></td>
                  <td>{project.ownerEmail}</td>
                  <td>{relativeTime(project.updatedAt)}</td>
                  <td>
                    {project.deleted
                      ? <span className="admin-badge">Deleted</span>
                      : <><span className="admin-badge admin-badge-ok">Live</span>{' '}
                        {project.published && <span className="admin-badge">Published</span>}{' '}
                        {project.showcase && <span className="admin-badge">Gallery</span>}</>}
                  </td>
                  <td>
                    <button type="button" className="admin-row-btn admin-row-btn-danger" onClick={() => deleteProject(project)} disabled={working} title={`Delete "${project.name}" completely`}>
                      <Trash2 size={14} aria-hidden="true" /><span className="admin-sr">Delete</span>
                    </button>
                  </td>
                </tr>)}
                {filteredProjects.length === 0 && <tr><td colSpan={5} className="admin-empty">No projects match.</td></tr>}
              </tbody>
            </table>
          </div>}
          <p className="admin-hint">Deleting a project erases it completely — app files, backend, backups, and the registry entry. Deleting an account removes the account and all of its projects. Neither can be undone.</p>
        </section>
      </>}

      {confirm && <div className="admin-modal-backdrop" onClick={() => !working && setConfirm(null)}>
        <div className="admin-modal" role="alertdialog" aria-modal="true" aria-labelledby="admin-confirm-title" onClick={event => event.stopPropagation()}>
          <div className="admin-modal-icon"><AlertTriangle size={20} aria-hidden="true" /></div>
          <h2 id="admin-confirm-title">{confirm.title}</h2>
          <p>{confirm.message}</p>
          <div className="admin-modal-actions">
            <button type="button" className="admin-refresh" onClick={() => setConfirm(null)} disabled={working}>Cancel</button>
            <button type="button" className="admin-danger-btn" onClick={() => void confirm.onConfirm()} disabled={working}>
              {working ? 'Working…' : confirm.confirmLabel}
            </button>
          </div>
        </div>
      </div>}
    </div>
  </main>;
}
