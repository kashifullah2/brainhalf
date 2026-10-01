import { useEffect, useMemo, useState } from 'react';
import { Users, BadgeCheck, Activity, FolderKanban, RefreshCw, Search, ShieldCheck, Trash2, AlertTriangle, X, Code2, Eye, FileCode2, Brain, Plus, Play, Loader2 } from 'lucide-react';
import BrainHalfLogo from './BrainHalfLogo';
import SiteHeaderActions from './SiteHeaderActions';
import MobileNav from './MobileNav';
import { authFetch } from '../lib/auth-client';
import { PREVIEW_SANDBOX } from '../lib/preview-isolation';
import { CLIENT_SELECTABLE_MODELS } from '../lib/models';
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
type Tab = 'accounts' | 'projects' | 'models';
type ProjectStatusFilter = 'all' | 'live' | 'published' | 'gallery' | 'deleted';

interface CustomModel {
  id: string;
  name: string;
  baseUrl: string;
  modelId: string;
  createdAt: number;
  updatedAt: number;
}

interface ConfirmState {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => Promise<void>;
}

interface CodeViewState {
  project: AdminProject;
  files: Record<string, string>;
  selectedFile: string;
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
  const [outcomesFailed, setOutcomesFailed] = useState(false);
  const [search, setSearch] = useState('');
  // Search is per-tab: switching tabs clears it so a query typed for accounts
  // never silently filters the projects list (or vice versa).
  const switchTab = (next: Tab) => {
    setTab(next);
    setSearch('');
  };
  const [statusFilter, setStatusFilter] = useState<ProjectStatusFilter>('all');
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [codeView, setCodeView] = useState<CodeViewState | null>(null);
  const [codeLoading, setCodeLoading] = useState(false);
  const [previewProject, setPreviewProject] = useState<AdminProject | null>(null);
  const [models, setModels] = useState<CustomModel[]>([]);
  const [modelForm, setModelForm] = useState({ name: '', baseUrl: '', modelId: '', apiKey: '' });
  const [modelSaving, setModelSaving] = useState(false);
  const [testModelId, setTestModelId] = useState<string | null>(null);
  const [testPrompt, setTestPrompt] = useState('');
  const [testOutput, setTestOutput] = useState('');
  const [testRunning, setTestRunning] = useState(false);
  const [integratedEnabled, setIntegratedEnabled] = useState(true);
  const [integratedToggling, setIntegratedToggling] = useState(false);
  const [builtinTestModel, setBuiltinTestModel] = useState('');
  const [builtinTestPrompt, setBuiltinTestPrompt] = useState('');
  const [builtinTestOutput, setBuiltinTestOutput] = useState('');
  const [builtinTestRunning, setBuiltinTestRunning] = useState(false);
  const [disabledModels, setDisabledModels] = useState<string[]>([]);

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
      if (outcomesResponse.ok) {
        setOutcomes(await outcomesResponse.json() as OutcomeReport);
        setOutcomesFailed(false);
      } else {
        setOutcomesFailed(true);
      }
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

  const loadModels = async () => {
    try {
      const response = await authFetch('/api/admin/models');
      if (response.ok) {
        const body = await response.json() as { models?: CustomModel[] };
        setModels(Array.isArray(body.models) ? body.models : []);
      }
    } catch { /* non-fatal */ }
  };

  useEffect(() => { if (state === 'ready') void loadModels(); }, [state]);

  const loadIntegratedSetting = async () => {
    try {
      const response = await authFetch('/api/admin/settings');
      if (response.ok) {
        const body = await response.json() as { integratedModelsEnabled?: boolean; disabledModels?: string[] };
        setIntegratedEnabled(body.integratedModelsEnabled !== false);
        setDisabledModels(Array.isArray(body.disabledModels) ? body.disabledModels : []);
      }
    } catch { /* non-fatal */ }
  };

  useEffect(() => { if (state === 'ready') void loadIntegratedSetting(); }, [state]);

  const toggleIntegrated = async () => {
    setIntegratedToggling(true);
    setNotice(null);
    try {
      const response = await authFetch('/api/admin/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ integratedModelsEnabled: !integratedEnabled }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) {
        setNotice({ kind: 'error', text: body.error || 'Could not change the setting.' });
      } else {
        setIntegratedEnabled(!integratedEnabled);
        setNotice({ kind: 'ok', text: !integratedEnabled ? 'Built-in models turned on.' : 'Built-in models turned off.' });
      }
    } catch {
      setNotice({ kind: 'error', text: 'Could not change the setting.' });
    } finally {
      setIntegratedToggling(false);
    }
  };

  const toggleSingleModel = async (modelKey: string) => {
    const next = disabledModels.includes(modelKey)
      ? disabledModels.filter(k => k !== modelKey)
      : [...disabledModels, modelKey];
    setDisabledModels(next);
    try {
      const response = await authFetch('/api/admin/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ disabledModels: next }),
      });
      if (!response.ok) {
        setNotice({ kind: 'error', text: 'Could not save the model setting.' });
        setDisabledModels(disabledModels); // revert on failure
      }
    } catch {
      setNotice({ kind: 'error', text: 'Could not save the model setting.' });
      setDisabledModels(disabledModels); // revert on failure
    }
  };

  const testBuiltinModel = async () => {
    if (!builtinTestModel) {
      setNotice({ kind: 'error', text: 'Choose a built-in model to test.' });
      return;
    }
    if (!builtinTestPrompt.trim()) {
      setNotice({ kind: 'error', text: 'Type a prompt to test the model.' });
      return;
    }
    setBuiltinTestRunning(true);
    setBuiltinTestOutput('');
    try {
      const response = await authFetch('/api/test/simple', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: builtinTestModel, prompt: builtinTestPrompt.trim() }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string; codeSnippet?: string; durationMs?: number; tokensPerSec?: number };
      if (!response.ok) {
        setBuiltinTestOutput(`Error: ${body.error || `Request failed (${response.status})`}`);
      } else {
        setBuiltinTestOutput(`${body.codeSnippet || '(no output)'}\n\n— ${body.durationMs}ms, ${body.tokensPerSec?.toFixed(1)} tokens/sec`);
      }
    } catch {
      setBuiltinTestOutput('Error: Could not reach the model.');
    } finally {
      setBuiltinTestRunning(false);
    }
  };

  const saveModel = async () => {
    if (!modelForm.name.trim() || !modelForm.baseUrl.trim() || !modelForm.modelId.trim() || !modelForm.apiKey.trim()) {
      setNotice({ kind: 'error', text: 'Fill in all fields: name, base URL, model ID, and API key.' });
      return;
    }
    setModelSaving(true);
    setNotice(null);
    try {
      const response = await authFetch('/api/admin/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(modelForm),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) {
        setNotice({ kind: 'error', text: body.error || 'Could not add the model.' });
      } else {
        setNotice({ kind: 'ok', text: 'Model added.' });
        setModelForm({ name: '', baseUrl: '', modelId: '', apiKey: '' });
        await loadModels();
      }
    } catch {
      setNotice({ kind: 'error', text: 'Could not add the model.' });
    } finally {
      setModelSaving(false);
    }
  };

  const deleteModel = async (id: string) => {
    setWorking(true);
    try {
      const response = await authFetch(`/api/admin/models/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (response.ok) {
        setNotice({ kind: 'ok', text: 'Model removed.' });
        await loadModels();
      } else {
        setNotice({ kind: 'error', text: 'Could not remove the model.' });
      }
    } catch {
      setNotice({ kind: 'error', text: 'Could not remove the model.' });
    } finally {
      setWorking(false);
    }
  };

  const testModel = async (id: string) => {
    if (!testPrompt.trim()) {
      setNotice({ kind: 'error', text: 'Type a prompt to test the model.' });
      return;
    }
    setTestRunning(true);
    setTestOutput('');
    setTestModelId(id);
    try {
      const response = await authFetch(`/api/admin/models/${encodeURIComponent(id)}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: testPrompt.trim() }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string };
        setTestOutput(`Error: ${body.error || `Request failed (${response.status})`}`);
        return;
      }
      const reader = response.body?.getReader();
      if (!reader) { setTestOutput('Error: No response stream.'); return; }
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const data = trimmed.slice(5).trim();
          if (data === '[DONE]') continue;
          try {
            const parsed = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string } }> };
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) setTestOutput(prev => prev + content);
          } catch { /* ignore malformed chunks */ }
        }
      }
    } catch {
      setTestOutput('Error: Could not reach the model.');
    } finally {
      setTestRunning(false);
    }
  };

  const filteredUsers = useMemo(() => {
    const query = search.trim().toLowerCase();
    return query ? users.filter(user => user.email.toLowerCase().includes(query)) : users;
  }, [users, search]);

  const filteredProjects = useMemo(() => {
    const query = search.trim().toLowerCase();
    return projects.filter(p => {
      if (statusFilter === 'live' && p.deleted) return false;
      if (statusFilter === 'deleted' && !p.deleted) return false;
      if (statusFilter === 'published' && (p.deleted || !p.published)) return false;
      if (statusFilter === 'gallery' && (p.deleted || !p.showcase)) return false;
      if (!query) return true;
      return p.name.toLowerCase().includes(query) ||
        p.ownerEmail.toLowerCase().includes(query) ||
        p.id.toLowerCase().includes(query);
    });
  }, [projects, search, statusFilter]);

  const statusCounts = useMemo(() => ({
    all: projects.length,
    live: projects.filter(p => !p.deleted).length,
    published: projects.filter(p => !p.deleted && p.published).length,
    gallery: projects.filter(p => !p.deleted && p.showcase).length,
    deleted: projects.filter(p => p.deleted).length,
  }), [projects]);

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

  const viewCode = async (project: AdminProject) => {
    setCodeLoading(true);
    setNotice(null);
    try {
      const res = await authFetch(`/api/admin/projects/${encodeURIComponent(project.id)}/files`);
      if (!res.ok) throw new Error('files unavailable');
      const body = await res.json() as { files?: Record<string, string> };
      const files = body.files && typeof body.files === 'object' ? body.files : {};
      const paths = Object.keys(files).sort();
      setCodeView({ project, files, selectedFile: paths[0] || '' });
    } catch {
      setNotice({ kind: 'error', text: `Could not load the code for "${project.name}". The project's app storage may be unavailable.` });
    } finally {
      setCodeLoading(false);
    }
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

        {outcomes ? <section className="admin-card" id="health" aria-label="Product health">
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
        </section> : outcomesFailed ? <section className="admin-card" id="health" aria-label="Product health">
          <div className="admin-card-head">
            <span className="admin-stat-icon"><ShieldCheck size={17} aria-hidden="true" /></span>
            <div>
              <h2>Product health</h2>
              <p>These metrics are currently unavailable — the data could not be loaded. Everything else on this page still works.</p>
            </div>
          </div>
        </section> : null}

        <section id="manage" aria-label="Manage">
          <div className="admin-tabs" role="tablist" aria-label="Management views">
            <button type="button" role="tab" aria-selected={tab === 'accounts'} className={tab === 'accounts' ? 'admin-tab-active' : ''} onClick={() => switchTab('accounts')}>
              <Users size={14} aria-hidden="true" /> Accounts <span className="admin-count">{filteredUsers.length}</span>
            </button>
            <button type="button" role="tab" aria-selected={tab === 'projects'} className={tab === 'projects' ? 'admin-tab-active' : ''} onClick={() => switchTab('projects')}>
              <FolderKanban size={14} aria-hidden="true" /> Projects <span className="admin-count">{filteredProjects.length}</span>
            </button>
            <button type="button" role="tab" aria-selected={tab === 'models'} className={tab === 'models' ? 'admin-tab-active' : ''} onClick={() => switchTab('models')}>
              <Brain size={14} aria-hidden="true" /> Models <span className="admin-count">{models.length}</span>
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

          {tab === 'projects' && <>
            <div className="admin-filter-row" role="group" aria-label="Filter projects by status">
              {(['all', 'live', 'published', 'gallery', 'deleted'] as ProjectStatusFilter[]).map(f => (
                <button
                  key={f}
                  type="button"
                  className={`admin-filter-btn${statusFilter === f ? ' admin-filter-active' : ''}`}
                  onClick={() => setStatusFilter(f)}
                  aria-pressed={statusFilter === f}
                >
                  {f === 'all' ? 'All' : f === 'live' ? 'Live' : f === 'published' ? 'Published' : f === 'gallery' ? 'Gallery' : 'Deleted'}
                  <span className="admin-count">{statusCounts[f]}</span>
                </button>
              ))}
            </div>
            <div className="admin-table-wrap">
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
                    <div className="admin-row-actions">
                      {!project.deleted && <>
                        <button type="button" className="admin-row-btn" onClick={() => void viewCode(project)} disabled={codeLoading} title={`View the code of "${project.name}"`}>
                          <Code2 size={14} aria-hidden="true" /><span className="admin-sr">View code</span>
                        </button>
                        <button type="button" className="admin-row-btn" onClick={() => setPreviewProject(project)} title={`Preview "${project.name}"`}>
                          <Eye size={14} aria-hidden="true" /><span className="admin-sr">Preview</span>
                        </button>
                      </>}
                      <button type="button" className="admin-row-btn admin-row-btn-danger" onClick={() => deleteProject(project)} disabled={working} title={`Delete "${project.name}" completely`}>
                        <Trash2 size={14} aria-hidden="true" /><span className="admin-sr">Delete</span>
                      </button>
                    </div>
                  </td>
                </tr>)}
                {filteredProjects.length === 0 && <tr><td colSpan={5} className="admin-empty">No projects match.</td></tr>}
              </tbody>
            </table>
          </div>
          </>}
          {tab === 'models' && <>
            <div className="admin-card" aria-label="Built-in BrainHalf models">
              <h3>BrainHalf integrated models</h3>
              <p className="admin-hint">Turn the built-in models on or off for everyone. When off, new generations and model tests are refused. Custom models you add below are unaffected.</p>
              <div className="admin-toggle-row">
                <button
                  type="button"
                  role="switch"
                  aria-checked={integratedEnabled}
                  className={`admin-toggle${integratedEnabled ? ' admin-toggle-on' : ''}`}
                  onClick={toggleIntegrated}
                  disabled={integratedToggling}
                >
                  <span className="admin-toggle-knob" />
                </button>
                <span className="admin-toggle-label">{integratedEnabled ? 'On' : 'Off'}</span>
              </div>
            </div>
            <div className="admin-card" aria-label="Turn individual models on or off">
              <h3>Individual models</h3>
              <p className="admin-hint">Turn specific built-in models on or off. Models you turn off disappear from the model picker and cannot be used for new generations.</p>
              <div className="admin-model-list">
                {CLIENT_SELECTABLE_MODELS.map(m => {
                  const key = `${m.provider}:${m.name}`;
                  const isOff = disabledModels.includes(key);
                  return (
                    <div key={key} className="admin-model-row">
                      <span className="admin-model-name">{m.name} <span className="admin-model-provider">({m.provider})</span></span>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={!isOff}
                        aria-label={`Turn ${m.name} ${isOff ? 'on' : 'off'}`}
                        className={`admin-toggle admin-toggle-sm${!isOff ? ' admin-toggle-on' : ''}`}
                        onClick={() => toggleSingleModel(key)}
                      >
                        <span className="admin-toggle-knob" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="admin-card" aria-label="Test a built-in model">
              <h3>Test a built-in model</h3>
              <p className="admin-hint">Runs the standard speed test against the selected integrated model.</p>
              <div className="admin-form-grid">
                <label>Model
                  <select value={builtinTestModel} onChange={e => setBuiltinTestModel(e.target.value)}>
                    <option value="">Choose a model…</option>
                    {CLIENT_SELECTABLE_MODELS.map(m => (
                      <option key={`${m.provider}:${m.name}`} value={m.name}>{m.name} ({m.provider})</option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="admin-test-label">Prompt
                <textarea value={builtinTestPrompt} onChange={e => setBuiltinTestPrompt(e.target.value)} placeholder="Describe what to build…" rows={3} />
              </label>
              <button type="button" className="admin-btn admin-btn-primary" onClick={testBuiltinModel} disabled={builtinTestRunning || !integratedEnabled}>
                {builtinTestRunning ? <Loader2 size={14} className="admin-spin" aria-hidden="true" /> : <Play size={14} aria-hidden="true" />} {builtinTestRunning ? 'Testing…' : 'Run test'}
              </button>
              {!integratedEnabled && <p className="admin-hint">Turn the integrated models on to run tests.</p>}
              {builtinTestOutput && <pre className="admin-test-output" aria-live="polite">{builtinTestOutput}</pre>}
            </div>
            <div className="admin-card" aria-label="Add a custom model">
              <h3>Add a model</h3>
              <p className="admin-hint">Connect any OpenAI-compatible API. The API key is encrypted before it is stored. Test generations are unlimited — no token cap is applied.</p>
              <div className="admin-form-grid">
                <label>Display name
                  <input type="text" value={modelForm.name} onChange={e => setModelForm(f => ({ ...f, name: e.target.value }))} placeholder="My custom model" />
                </label>
                <label>Base URL
                  <input type="url" value={modelForm.baseUrl} onChange={e => setModelForm(f => ({ ...f, baseUrl: e.target.value }))} placeholder="https://api.example.com/v1" />
                </label>
                <label>Model ID
                  <input type="text" value={modelForm.modelId} onChange={e => setModelForm(f => ({ ...f, modelId: e.target.value }))} placeholder="model-name" />
                </label>
                <label>API key
                  <input type="password" value={modelForm.apiKey} onChange={e => setModelForm(f => ({ ...f, apiKey: e.target.value }))} placeholder="sk-…" autoComplete="off" />
                </label>
              </div>
              <button type="button" className="admin-btn admin-btn-primary" onClick={saveModel} disabled={modelSaving}>
                {modelSaving ? <Loader2 size={14} className="admin-spin" aria-hidden="true" /> : <Plus size={14} aria-hidden="true" />} Add model
              </button>
            </div>
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead><tr><th>Model</th><th>Base URL</th><th>Model ID</th><th><span className="admin-sr">Actions</span></th></tr></thead>
                <tbody>
                  {models.map(m => (
                    <tr key={m.id}>
                      <td>{m.name}</td>
                      <td className="admin-mono">{m.baseUrl}</td>
                      <td className="admin-mono">{m.modelId}</td>
                      <td>
                        <div className="admin-actions">
                          <button type="button" className="admin-icon-btn" title="Test this model" aria-label={`Test ${m.name}`} onClick={() => { setTestModelId(m.id); setTestOutput(''); }}>
                            <Play size={14} aria-hidden="true" />
                          </button>
                          <button type="button" className="admin-icon-btn admin-icon-btn-danger" title="Remove model" aria-label={`Remove ${m.name}`} onClick={() => deleteModel(m.id)} disabled={working}>
                            <Trash2 size={14} aria-hidden="true" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {models.length === 0 && <tr><td colSpan={4} className="admin-empty">No custom models yet. Add one above.</td></tr>}
                </tbody>
              </table>
            </div>
            {testModelId && (() => {
              const model = models.find(m => m.id === testModelId);
              return model ? (
                <div className="admin-card" aria-label={`Test ${model.name}`}>
                  <h3>Test {model.name}</h3>
                  <p className="admin-hint">Unlimited generation — the model writes until it stops on its own.</p>
                  <label className="admin-test-label">Prompt
                    <textarea value={testPrompt} onChange={e => setTestPrompt(e.target.value)} placeholder="Write a story about…" rows={3} />
                  </label>
                  <button type="button" className="admin-btn admin-btn-primary" onClick={() => testModel(model.id)} disabled={testRunning}>
                    {testRunning ? <Loader2 size={14} className="admin-spin" aria-hidden="true" /> : <Play size={14} aria-hidden="true" />} {testRunning ? 'Generating…' : 'Generate'}
                  </button>
                  {testOutput && <pre className="admin-test-output" aria-live="polite">{testOutput}</pre>}
                </div>
              ) : null;
            })()}
          </>}
          <p className="admin-hint admin-warning-box" role="note">Deleting a project erases it completely — app files, backend, backups, and the registry entry. Deleting an account removes the account and all of its projects. Neither can be undone.</p>
        </section>
      </>}

      {codeView && <div className="admin-modal-backdrop admin-modal-wide-backdrop" onClick={() => setCodeView(null)}>
        <div className="admin-modal admin-modal-wide" role="dialog" aria-modal="true" aria-labelledby="admin-code-title" onClick={event => event.stopPropagation()}>
          <div className="admin-modal-head">
            <div>
              <h2 id="admin-code-title"><FileCode2 size={16} aria-hidden="true" /> {codeView.project.name}</h2>
              <p className="admin-sub">{codeView.project.ownerEmail} · {codeView.project.id}</p>
            </div>
            <button type="button" className="admin-row-btn" onClick={() => setCodeView(null)} aria-label="Close code viewer"><X size={16} /></button>
          </div>
          <div className="admin-code-layout">
            <nav className="admin-file-tree" aria-label="Project files">
              {Object.keys(codeView.files).sort().map(path => (
                <button
                  key={path}
                  type="button"
                  className={`admin-file-btn${codeView.selectedFile === path ? ' admin-file-active' : ''}`}
                  onClick={() => setCodeView({ ...codeView, selectedFile: path })}
                >
                  {path}
                </button>
              ))}
              {Object.keys(codeView.files).length === 0 && <p className="admin-empty">This project has no saved files.</p>}
            </nav>
            <div className="admin-code-pane">
              {codeView.selectedFile
                ? <pre className="admin-code"><code>{codeView.files[codeView.selectedFile]}</code></pre>
                : <p className="admin-empty">Select a file to view its code.</p>}
            </div>
          </div>
        </div>
      </div>}

      {previewProject && <div className="admin-modal-backdrop admin-modal-wide-backdrop" onClick={() => setPreviewProject(null)}>
        <div className="admin-modal admin-modal-wide" role="dialog" aria-modal="true" aria-labelledby="admin-preview-title" onClick={event => event.stopPropagation()}>
          <div className="admin-modal-head">
            <div>
              <h2 id="admin-preview-title"><Eye size={16} aria-hidden="true" /> {previewProject.name}</h2>
              <p className="admin-sub">{previewProject.ownerEmail} · live preview of their app</p>
            </div>
            <button type="button" className="admin-row-btn" onClick={() => setPreviewProject(null)} aria-label="Close preview"><X size={16} /></button>
          </div>
          <iframe
            title={`Preview of ${previewProject.name}`}
            className="admin-preview-frame"
            src={`/api/admin/projects/${encodeURIComponent(previewProject.id)}/preview/`}
            sandbox={PREVIEW_SANDBOX}
          />
        </div>
      </div>}

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
