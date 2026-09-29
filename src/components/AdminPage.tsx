import { useEffect, useMemo, useState } from 'react';
import { Users, BadgeCheck, Activity, FolderKanban, RefreshCw, Search, ShieldCheck } from 'lucide-react';
import BrainHalfLogo from './BrainHalfLogo';
import SiteHeaderActions from './SiteHeaderActions';
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
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [outcomes, setOutcomes] = useState<OutcomeReport | null>(null);
  const [search, setSearch] = useState('');

  const load = async (signal?: AbortSignal) => {
    setState('loading');
    try {
      const [usersResponse, outcomesResponse] = await Promise.all([
        authFetch('/api/admin/users', { signal }),
        authFetch('/api/admin/outcomes', { signal }),
      ]);
      if (usersResponse.status === 401 || outcomesResponse.status === 401) return setState('signed-out');
      if (usersResponse.status === 403 || outcomesResponse.status === 403) return setState('forbidden');
      if (!usersResponse.ok) return setState('error');
      const body = await usersResponse.json() as { users?: AdminUser[] };
      setUsers(Array.isArray(body.users) ? body.users : []);
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

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return query ? users.filter(user => user.email.toLowerCase().includes(query)) : users;
  }, [users, search]);

  const weekAgo = Date.now() - 7 * 86_400_000;
  const stats = useMemo(() => ({
    total: users.length,
    verified: users.filter(user => user.verified).length,
    activeWeek: users.filter(user => (user.lastLoginAt ?? 0) >= weekAgo).length,
    withProjects: users.filter(user => user.projects > 0).length,
  }), [users]);

  return <main className="admin-page">
    <header className="admin-header">
      <a href="/" aria-label="BrainHalf home"><BrainHalfLogo size={34} /><strong>BrainHalf</strong></a>
      <SiteHeaderActions />
    </header>
    <div className="admin-body">
      <p className="studio-section-label">OPERATOR</p>
      <div className="admin-title-row">
        <div>
          <h1>Accounts &amp; product health</h1>
          <p className="admin-subtitle">Private operator view — who is here, and how the product is performing.</p>
        </div>
        <button type="button" className="admin-refresh" onClick={() => void load()} disabled={state === 'loading'}>
          <RefreshCw size={14} className={state === 'loading' ? 'admin-spin' : ''} aria-hidden="true" />
          {state === 'loading' ? 'Loading…' : 'Refresh'}
        </button>
      </div>

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
        <section className="admin-stats" aria-label="Account overview">
          <div className="admin-stat"><span className="admin-stat-icon"><Users size={17} aria-hidden="true" /></span><strong>{stats.total}</strong><span>Total accounts</span></div>
          <div className="admin-stat"><span className="admin-stat-icon"><BadgeCheck size={17} aria-hidden="true" /></span><strong>{stats.verified}</strong><span>Verified</span></div>
          <div className="admin-stat"><span className="admin-stat-icon"><Activity size={17} aria-hidden="true" /></span><strong>{stats.activeWeek}</strong><span>Active this week</span></div>
          <div className="admin-stat"><span className="admin-stat-icon"><FolderKanban size={17} aria-hidden="true" /></span><strong>{stats.withProjects}</strong><span>With projects</span></div>
        </section>

        {outcomes && <section className="admin-card" aria-label="Product health">
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

        <section aria-label="Accounts">
          <div className="admin-table-bar">
            <h2>Accounts</h2>
            <label className="admin-search">
              <Search size={15} aria-hidden="true" />
              <input
                type="search"
                placeholder="Filter by email…"
                value={search}
                onChange={event => setSearch(event.target.value)}
                aria-label="Filter accounts by email"
              />
            </label>
          </div>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead><tr><th>Email</th><th>Signed up</th><th>Last active</th><th>Projects</th><th>Status</th></tr></thead>
              <tbody>
                {filtered.map(user => <tr key={user.id}>
                  <td>{user.email}</td>
                  <td>{new Date(user.createdAt).toLocaleDateString()}</td>
                  <td>{relativeTime(user.lastLoginAt)}</td>
                  <td>{user.projects}</td>
                  <td>{user.verified
                    ? <span className="admin-badge admin-badge-ok">Verified</span>
                    : <span className="admin-badge">Unverified</span>}</td>
                </tr>)}
                {filtered.length === 0 && <tr><td colSpan={5} className="admin-empty">No accounts match.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      </>}
    </div>
  </main>;
}
