import { useEffect, useMemo, useState } from 'react';
import {
  Users,
  BadgeCheck,
  Activity,
  FolderKanban,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  AlertTriangle,
  X,
  Code2,
  Eye,
  FileCode2,
  Brain,
  Plus,
  Play,
  Loader2,
  ChevronLeft,
  ChevronRight,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Copy,
  Check,
  ExternalLink,
  Sparkles,
  ArrowLeft,
} from 'lucide-react';
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
type AccountFilter = 'all' | 'verified' | 'unverified' | 'active';
type ProjectStatusFilter = 'all' | 'live' | 'published' | 'gallery' | 'deleted';

type UserSortField = 'email' | 'createdAt' | 'lastLoginAt' | 'projects' | 'verified';
type ProjectSortField = 'name' | 'ownerEmail' | 'updatedAt' | 'status';
type SortDirection = 'asc' | 'desc';

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
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

function percent(value: number | null): string {
  return value === null || value === undefined || Number.isNaN(value) ? '—' : `${Math.round(value * 100)}%`;
}

function duration(ms: number | null): string {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return '—';
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
  const [accountFilter, setAccountFilter] = useState<AccountFilter>('all');
  const [statusFilter, setStatusFilter] = useState<ProjectStatusFilter>('all');

  // Sorting
  const [userSortField, setUserSortField] = useState<UserSortField>('createdAt');
  const [userSortDir, setUserSortDir] = useState<SortDirection>('desc');
  const [projectSortField, setProjectSortField] = useState<ProjectSortField>('updatedAt');
  const [projectSortDir, setProjectSortDir] = useState<SortDirection>('desc');

  // Pagination
  const [userPage, setUserPage] = useState(1);
  const [userPageSize, setUserPageSize] = useState(15);
  const [projectPage, setProjectPage] = useState(1);
  const [projectPageSize, setProjectPageSize] = useState(15);

  // Copy feedback
  const [copiedEmail, setCopiedEmail] = useState<string | null>(null);

  const switchTab = (next: Tab) => {
    setTab(next);
    setSearch('');
  };

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
        setDisabledModels(disabledModels);
      }
    } catch {
      setNotice({ kind: 'error', text: 'Could not save the model setting.' });
      setDisabledModels(disabledModels);
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
      let rawOutput = '';
      const stripThinking = (text: string) => text
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .replace(/<think>[\s\S]*$/i, '')
        .replace(/<\/?(?:t(?:h(?:i(?:n(?:k)?)?)?)?)?$/i, '')
        .replace(/^\s+/, '');
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
            const parsed = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string; reasoning_content?: string } }> };
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) { rawOutput += content; setTestOutput(stripThinking(rawOutput)); }
          } catch { /* ignore malformed chunks */ }
        }
      }
    } catch {
      setTestOutput('Error: Could not reach the model.');
    } finally {
      setTestRunning(false);
    }
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedEmail(text);
      setTimeout(() => setCopiedEmail(null), 2000);
    } catch {
      /* ignore */
    }
  };

  const weekAgo = useMemo(() => Date.now() - 7 * 86_400_000, []);

  // Filtered & Sorted Users
  const filteredUsers = useMemo(() => {
    let result = users;
    const query = search.trim().toLowerCase();
    if (query) {
      result = result.filter(u => u.email.toLowerCase().includes(query) || u.id.toLowerCase().includes(query));
    }
    if (accountFilter === 'verified') result = result.filter(u => u.verified);
    if (accountFilter === 'unverified') result = result.filter(u => !u.verified);
    if (accountFilter === 'active') result = result.filter(u => (u.lastLoginAt ?? 0) >= weekAgo);

    return [...result].sort((a, b) => {
      let comparison = 0;
      if (userSortField === 'email') comparison = a.email.localeCompare(b.email);
      else if (userSortField === 'createdAt') comparison = a.createdAt - b.createdAt;
      else if (userSortField === 'lastLoginAt') comparison = (a.lastLoginAt ?? 0) - (b.lastLoginAt ?? 0);
      else if (userSortField === 'projects') comparison = a.projects - b.projects;
      else if (userSortField === 'verified') comparison = (a.verified === b.verified ? 0 : a.verified ? 1 : -1);
      return userSortDir === 'asc' ? comparison : -comparison;
    });
  }, [users, search, accountFilter, userSortField, userSortDir, weekAgo]);

  // Paginated Users
  const totalUserPages = Math.max(1, Math.ceil(filteredUsers.length / userPageSize));
  const paginatedUsers = useMemo(() => {
    const start = (userPage - 1) * userPageSize;
    return filteredUsers.slice(start, start + userPageSize);
  }, [filteredUsers, userPage, userPageSize]);

  // Filtered & Sorted Projects
  const filteredProjects = useMemo(() => {
    let result = projects.filter(p => {
      if (statusFilter === 'live' && p.deleted) return false;
      if (statusFilter === 'deleted' && !p.deleted) return false;
      if (statusFilter === 'published' && (p.deleted || !p.published)) return false;
      if (statusFilter === 'gallery' && (p.deleted || !p.showcase)) return false;
      return true;
    });

    const query = search.trim().toLowerCase();
    if (query) {
      result = result.filter(p =>
        p.name.toLowerCase().includes(query) ||
        p.ownerEmail.toLowerCase().includes(query) ||
        p.id.toLowerCase().includes(query)
      );
    }

    return [...result].sort((a, b) => {
      let comparison = 0;
      if (projectSortField === 'name') comparison = a.name.localeCompare(b.name);
      else if (projectSortField === 'ownerEmail') comparison = a.ownerEmail.localeCompare(b.ownerEmail);
      else if (projectSortField === 'updatedAt') comparison = a.updatedAt - b.updatedAt;
      else if (projectSortField === 'status') {
        const statusVal = (p: AdminProject) => p.deleted ? 0 : p.published ? 2 : 1;
        comparison = statusVal(a) - statusVal(b);
      }
      return projectSortDir === 'asc' ? comparison : -comparison;
    });
  }, [projects, search, statusFilter, projectSortField, projectSortDir]);

  // Paginated Projects
  const totalProjectPages = Math.max(1, Math.ceil(filteredProjects.length / projectPageSize));
  const paginatedProjects = useMemo(() => {
    const start = (projectPage - 1) * projectPageSize;
    return filteredProjects.slice(start, start + projectPageSize);
  }, [filteredProjects, projectPage, projectPageSize]);

  const statusCounts = useMemo(() => ({
    all: projects.length,
    live: projects.filter(p => !p.deleted).length,
    published: projects.filter(p => !p.deleted && p.published).length,
    gallery: projects.filter(p => !p.deleted && p.showcase).length,
    deleted: projects.filter(p => p.deleted).length,
  }), [projects]);

  const stats = useMemo(() => ({
    total: users.length,
    verified: users.filter(user => user.verified).length,
    unverified: users.filter(user => !user.verified).length,
    activeWeek: users.filter(user => (user.lastLoginAt ?? 0) >= weekAgo).length,
    withProjects: users.filter(user => user.projects > 0).length,
    totalProjects: projects.length,
    liveProjects: projects.filter(p => !p.deleted).length,
  }), [users, projects, weekAgo]);

  const toggleUserSort = (field: UserSortField) => {
    if (userSortField === field) {
      setUserSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setUserSortField(field);
      setUserSortDir('desc');
    }
    setUserPage(1);
  };

  const toggleProjectSort = (field: ProjectSortField) => {
    if (projectSortField === field) {
      setProjectSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setProjectSortField(field);
      setProjectSortDir('desc');
    }
    setProjectPage(1);
  };

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

  return (
    <div className="admin-layout">
      {/* Sidebar Navigation */}
      <aside className="admin-sidebar">
        <div className="admin-sidebar-header">
          <a href="/" className="admin-brand" aria-label="BrainHalf home">
            <BrainHalfLogo size={28} />
            <div className="admin-brand-text">
              <strong>BrainHalf</strong>
              <span className="admin-operator-badge">Operator</span>
            </div>
          </a>
        </div>

        <nav className="admin-nav" aria-label="Admin sections">
          <div className="admin-nav-group-label">Analytics & Health</div>
          <a href="#overview" className="admin-nav-link">
            <Activity size={16} aria-hidden="true" />
            <span>Overview</span>
          </a>
          <a href="#health" className="admin-nav-link">
            <ShieldCheck size={16} aria-hidden="true" />
            <span>Product health</span>
          </a>

          <div className="admin-nav-group-label">Management</div>
          <a
            href="#manage"
            className={`admin-nav-link ${tab === 'accounts' ? 'active' : ''}`}
            onClick={() => switchTab('accounts')}
          >
            <Users size={16} aria-hidden="true" />
            <span>Accounts</span>
            <span className="admin-nav-count">{stats.total}</span>
          </a>
          <a
            href="#manage"
            className={`admin-nav-link ${tab === 'projects' ? 'active' : ''}`}
            onClick={() => switchTab('projects')}
          >
            <FolderKanban size={16} aria-hidden="true" />
            <span>Projects</span>
            <span className="admin-nav-count">{stats.totalProjects}</span>
          </a>
          <a
            href="#manage"
            className={`admin-nav-link ${tab === 'models' ? 'active' : ''}`}
            onClick={() => switchTab('models')}
          >
            <Brain size={16} aria-hidden="true" />
            <span>Models</span>
            <span className="admin-nav-count">{models.length}</span>
          </a>
        </nav>

        <div className="admin-sidebar-footer">
          <div className="admin-system-pulse">
            <span className="admin-pulse-dot" />
            <span>System Operational</span>
          </div>
          <a href="/dashboard" className="admin-return-link">
            <ArrowLeft size={13} aria-hidden="true" />
            <span>Return to App</span>
          </a>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="admin-main">
        {/* Top Navbar */}
        <header className="admin-header">
          <div className="admin-header-inner">
            <div className="admin-header-mobile-brand">
              <a href="/" className="admin-brand" aria-label="BrainHalf home">
                <BrainHalfLogo size={24} />
                <strong>BrainHalf</strong>
                <span className="admin-operator-badge">Operator</span>
              </a>
            </div>

            <div className="admin-header-right">
              <MobileNav
                links={[
                  { href: '#overview', label: 'Overview' },
                  { href: '#health', label: 'Product health' },
                  { href: '#manage', label: 'Manage' },
                ]}
              />
              <button
                type="button"
                className="admin-refresh-btn"
                onClick={() => void load()}
                disabled={state === 'loading' || working}
                title="Reload dashboard data"
              >
                <RefreshCw size={14} className={state === 'loading' ? 'admin-spin' : ''} aria-hidden="true" />
                <span>{state === 'loading' ? 'Refreshing…' : 'Refresh'}</span>
              </button>
              <SiteHeaderActions hideDashboard={true} />
            </div>
          </div>
        </header>

        <div className="admin-body">
          {/* Header Title Row */}
          <div className="admin-title-row">
            <div>
              <div className="admin-badge-row">
                <span className="studio-section-label">OPERATOR PLATFORM</span>
                <span className="admin-telemetry-badge">
                  <Sparkles size={11} aria-hidden="true" /> Live Telemetry
                </span>
              </div>
              <h1>Accounts &amp; product health</h1>
              <p className="admin-subtitle">
                Real-time insights across account growth, generation outcomes, and system administration.
              </p>
            </div>
          </div>

          {/* Notices */}
          {notice && (
            <div className={`admin-notice ${notice.kind === 'ok' ? 'admin-notice-ok' : 'admin-notice-err'}`} role="status">
              <p>{notice.text}</p>
              <button
                type="button"
                className="admin-notice-close"
                onClick={() => setNotice(null)}
                aria-label="Dismiss notice"
              >
                <X size={14} />
              </button>
            </div>
          )}

          {state === 'signed-out' && (
            <div className="admin-notice" role="status">
              <h2>Sign in required</h2>
              <p>Sign in with your operator account, then reopen this page.</p>
              <a className="admin-action" href="/">Go to BrainHalf to sign in</a>
            </div>
          )}

          {state === 'forbidden' && (
            <div className="admin-notice admin-notice-err" role="alert">
              <h2>Not an operator account</h2>
              <p>
                This account is not on the operator allowlist. Add your user ID to the{' '}
                <code>PRODUCT_METRICS_OWNER_IDS</code> secret and redeploy.
              </p>
            </div>
          )}

          {state === 'error' && (
            <div className="admin-notice admin-notice-err" role="alert">
              <h2>Could not load admin data</h2>
              <p>Check your connection and try again. If this persists, the endpoint may not be deployed yet.</p>
            </div>
          )}

          {/* Skeletons while loading */}
          {state === 'loading' && (
            <div className="admin-skeletons" aria-hidden="true">
              <div className="admin-skeleton admin-skeleton-stats" />
              <div className="admin-skeleton admin-skeleton-table" />
            </div>
          )}

          {state === 'ready' && (
            <>
              {/* Section 1: Overview Metric Cards */}
              <section className="admin-section" id="overview" aria-label="Account overview">
                <div className="admin-stats">
                  <div className="admin-stat">
                    <div className="admin-stat-top">
                      <span className="admin-stat-icon icon-users">
                        <Users size={17} aria-hidden="true" />
                      </span>
                      <span className="admin-stat-trend">Total</span>
                    </div>
                    <strong>{stats.total.toLocaleString()}</strong>
                    <span className="admin-stat-label">Registered accounts</span>
                    <span className="admin-stat-meta">{stats.withProjects} created projects</span>
                  </div>

                  <div className="admin-stat">
                    <div className="admin-stat-top">
                      <span className="admin-stat-icon icon-verified">
                        <BadgeCheck size={17} aria-hidden="true" />
                      </span>
                      <span className="admin-stat-trend success">
                        {stats.total > 0 ? `${Math.round((stats.verified / stats.total) * 100)}%` : '0%'}
                      </span>
                    </div>
                    <strong>{stats.verified.toLocaleString()}</strong>
                    <span className="admin-stat-label">Verified accounts</span>
                    <span className="admin-stat-meta">{stats.unverified} pending verification</span>
                  </div>

                  <div className="admin-stat">
                    <div className="admin-stat-top">
                      <span className="admin-stat-icon icon-activity">
                        <Activity size={17} aria-hidden="true" />
                      </span>
                      <span className="admin-stat-trend info">7 days</span>
                    </div>
                    <strong>{stats.activeWeek.toLocaleString()}</strong>
                    <span className="admin-stat-label">Active this week</span>
                    <span className="admin-stat-meta">
                      {stats.total > 0 ? `${Math.round((stats.activeWeek / stats.total) * 100)}% engagement` : '—'}
                    </span>
                  </div>

                  <div className="admin-stat">
                    <div className="admin-stat-top">
                      <span className="admin-stat-icon icon-projects">
                        <FolderKanban size={17} aria-hidden="true" />
                      </span>
                      <span className="admin-stat-trend accent">Live</span>
                    </div>
                    <strong>{stats.liveProjects.toLocaleString()}</strong>
                    <span className="admin-stat-label">Active projects</span>
                    <span className="admin-stat-meta">{stats.totalProjects} total across all time</span>
                  </div>
                </div>
              </section>

              {/* Section 2: Product Health Card */}
              {outcomes ? (
                <section className="admin-card admin-health-card" id="health" aria-label="Product health">
                  <div className="admin-card-head">
                    <span className="admin-stat-icon icon-shield">
                      <ShieldCheck size={18} aria-hidden="true" />
                    </span>
                    <div className="admin-card-head-content">
                      <div className="admin-card-title-row">
                        <h2>Product health</h2>
                        <span className="admin-badge admin-badge-ok">Monitored</span>
                      </div>
                      <p>
                        Measured {new Date(outcomes.measuredAt).toLocaleString()} — generation success, publishing
                        reliability, and user retention.
                      </p>
                    </div>
                  </div>

                  <div className="admin-stats admin-stats-tight">
                    <div className="admin-stat-sm">
                      <span className="admin-stat-sm-title">Generations started</span>
                      <strong>{outcomes.generations.toLocaleString()}</strong>
                      <span className="admin-stat-sm-meta">{outcomes.completedGenerations} completed</span>
                    </div>

                    <div className="admin-stat-sm">
                      <span className="admin-stat-sm-title">Verified working apps</span>
                      <strong className={outcomes.workingAppsPerGeneration && outcomes.workingAppsPerGeneration > 0.5 ? 'color-success' : ''}>
                        {percent(outcomes.workingAppsPerGeneration)}
                      </strong>
                      <span className="admin-stat-sm-meta">{outcomes.verifiedWorkingGenerations} verified builds</span>
                    </div>

                    <div className="admin-stat-sm">
                      <span className="admin-stat-sm-title">Publish success rate</span>
                      <strong className={outcomes.publishingSuccessRate && outcomes.publishingSuccessRate > 0.7 ? 'color-success' : ''}>
                        {percent(outcomes.publishingSuccessRate)}
                      </strong>
                      <span className="admin-stat-sm-meta">{outcomes.published} published / {outcomes.publishAttempts} attempts</span>
                    </div>

                    <div className="admin-stat-sm">
                      <span className="admin-stat-sm-title">Median time to first app</span>
                      <strong>{duration(outcomes.medianTimeToFirstLiveMs)}</strong>
                      <span className="admin-stat-sm-meta">{outcomes.firstLiveAccounts} first-time accounts</span>
                    </div>

                    <div className="admin-stat-sm">
                      <span className="admin-stat-sm-title">Week-one retention</span>
                      <strong>{percent(outcomes.weekOneRetention)}</strong>
                      <span className="admin-stat-sm-meta">
                        {outcomes.matureWeekOneAccounts > 0
                          ? `${outcomes.returnedWeekOneAccounts} returned / ${outcomes.matureWeekOneAccounts} mature`
                          : 'No mature cohorts yet'}
                      </span>
                    </div>
                  </div>
                </section>
              ) : outcomesFailed ? (
                <section className="admin-card" id="health" aria-label="Product health">
                  <div className="admin-card-head">
                    <span className="admin-stat-icon icon-shield">
                      <ShieldCheck size={18} aria-hidden="true" />
                    </span>
                    <div>
                      <h2>Product health</h2>
                      <p>
                        Telemetry metrics are temporarily unavailable. Other operator management tools remain active.
                      </p>
                    </div>
                  </div>
                </section>
              ) : null}

              {/* Section 3: Management Hub */}
              <section className="admin-section" id="manage" aria-label="Manage">
                {/* Modern Segmented Tabs */}
                <div className="admin-tabs-bar">
                  <div className="admin-tabs" role="tablist" aria-label="Management views">
                    <button
                      type="button"
                      role="tab"
                      aria-selected={tab === 'accounts'}
                      className={`admin-tab-btn ${tab === 'accounts' ? 'admin-tab-active' : ''}`}
                      onClick={() => switchTab('accounts')}
                    >
                      <Users size={15} aria-hidden="true" />
                      <span>Accounts</span>
                      <span className="admin-tab-count">{users.length}</span>
                    </button>

                    <button
                      type="button"
                      role="tab"
                      aria-selected={tab === 'projects'}
                      className={`admin-tab-btn ${tab === 'projects' ? 'admin-tab-active' : ''}`}
                      onClick={() => switchTab('projects')}
                    >
                      <FolderKanban size={15} aria-hidden="true" />
                      <span>Projects</span>
                      <span className="admin-tab-count">{projects.length}</span>
                    </button>

                    <button
                      type="button"
                      role="tab"
                      aria-selected={tab === 'models'}
                      className={`admin-tab-btn ${tab === 'models' ? 'admin-tab-active' : ''}`}
                      onClick={() => switchTab('models')}
                    >
                      <Brain size={15} aria-hidden="true" />
                      <span>Models</span>
                      <span className="admin-tab-count">{models.length}</span>
                    </button>
                  </div>
                </div>

                {/* TAB 1: ACCOUNTS */}
                {tab === 'accounts' && (
                  <div className="admin-tab-pane">
                    {/* Toolbar with Filter Pills, Search, and Danger Action */}
                    <div className="admin-toolbar">
                      <div className="admin-filter-group">
                        <button
                          type="button"
                          className={`admin-filter-pill ${accountFilter === 'all' ? 'active' : ''}`}
                          onClick={() => { setAccountFilter('all'); setUserPage(1); }}
                        >
                          All accounts <span className="admin-count-pill">{users.length}</span>
                        </button>
                        <button
                          type="button"
                          className={`admin-filter-pill ${accountFilter === 'verified' ? 'active' : ''}`}
                          onClick={() => { setAccountFilter('verified'); setUserPage(1); }}
                        >
                          Verified <span className="admin-count-pill">{stats.verified}</span>
                        </button>
                        <button
                          type="button"
                          className={`admin-filter-pill ${accountFilter === 'unverified' ? 'active' : ''}`}
                          onClick={() => { setAccountFilter('unverified'); setUserPage(1); }}
                        >
                          Unverified <span className="admin-count-pill">{stats.unverified}</span>
                        </button>
                        <button
                          type="button"
                          className={`admin-filter-pill ${accountFilter === 'active' ? 'active' : ''}`}
                          onClick={() => { setAccountFilter('active'); setUserPage(1); }}
                        >
                          Active this week <span className="admin-count-pill">{stats.activeWeek}</span>
                        </button>
                      </div>

                      <div className="admin-toolbar-right">
                        {stats.unverified > 0 && (
                          <button
                            type="button"
                            className="admin-subtle-danger-btn"
                            onClick={deleteUnverified}
                            disabled={working}
                            title="Remove all unverified accounts"
                          >
                            <Trash2 size={13} aria-hidden="true" />
                            <span>Delete {stats.unverified} unverified</span>
                          </button>
                        )}

                        <div className="admin-search-box">
                          <Search size={14} aria-hidden="true" className="admin-search-icon" />
                          <input
                            type="search"
                            placeholder="Search by email or ID…"
                            value={search}
                            onChange={e => { setSearch(e.target.value); setUserPage(1); }}
                            aria-label="Filter accounts by email"
                          />
                          {search && (
                            <button
                              type="button"
                              className="admin-search-clear"
                              onClick={() => { setSearch(''); setUserPage(1); }}
                              aria-label="Clear search"
                            >
                              <X size={12} />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Paginated Accounts Table */}
                    <div className="admin-table-wrap">
                      <table className="admin-table">
                        <thead>
                          <tr>
                            <th onClick={() => toggleUserSort('email')} className="sortable-th">
                              <div className="th-content">
                                <span>Account</span>
                                {userSortField === 'email' ? (
                                  userSortDir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />
                                ) : (
                                  <ArrowUpDown size={12} className="th-sort-icon" />
                                )}
                              </div>
                            </th>
                            <th onClick={() => toggleUserSort('createdAt')} className="sortable-th">
                              <div className="th-content">
                                <span>Signed Up</span>
                                {userSortField === 'createdAt' ? (
                                  userSortDir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />
                                ) : (
                                  <ArrowUpDown size={12} className="th-sort-icon" />
                                )}
                              </div>
                            </th>
                            <th onClick={() => toggleUserSort('lastLoginAt')} className="sortable-th">
                              <div className="th-content">
                                <span>Last Active</span>
                                {userSortField === 'lastLoginAt' ? (
                                  userSortDir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />
                                ) : (
                                  <ArrowUpDown size={12} className="th-sort-icon" />
                                )}
                              </div>
                            </th>
                            <th onClick={() => toggleUserSort('projects')} className="sortable-th">
                              <div className="th-content">
                                <span>Projects</span>
                                {userSortField === 'projects' ? (
                                  userSortDir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />
                                ) : (
                                  <ArrowUpDown size={12} className="th-sort-icon" />
                                )}
                              </div>
                            </th>
                            <th onClick={() => toggleUserSort('verified')} className="sortable-th">
                              <div className="th-content">
                                <span>Status</span>
                                {userSortField === 'verified' ? (
                                  userSortDir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />
                                ) : (
                                  <ArrowUpDown size={12} className="th-sort-icon" />
                                )}
                              </div>
                            </th>
                            <th className="th-actions">
                              <span className="admin-sr">Actions</span>
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {paginatedUsers.map(user => {
                            const initial = (user.email[0] || 'U').toUpperCase();
                            const isRecentlyActive = (user.lastLoginAt ?? 0) >= weekAgo;

                            return (
                              <tr key={user.id} className="admin-table-row">
                                <td>
                                  <div className="user-cell">
                                    <div className="user-avatar" aria-hidden="true">
                                      {initial}
                                    </div>
                                    <div className="user-details">
                                      <span className="user-email">{user.email}</span>
                                      <span className="user-id">{user.id}</span>
                                    </div>
                                    <button
                                      type="button"
                                      className="admin-copy-btn"
                                      onClick={() => void copyToClipboard(user.email)}
                                      title={copiedEmail === user.email ? 'Copied!' : 'Copy email'}
                                      aria-label={`Copy email ${user.email}`}
                                    >
                                      {copiedEmail === user.email ? <Check size={12} /> : <Copy size={12} />}
                                    </button>
                                  </div>
                                </td>
                                <td>
                                  <div className="date-cell">
                                    <span>{new Date(user.createdAt).toLocaleDateString()}</span>
                                    <span className="date-sub">{relativeTime(user.createdAt)}</span>
                                  </div>
                                </td>
                                <td>
                                  <div className="activity-cell">
                                    {isRecentlyActive && <span className="activity-indicator" title="Active recently" />}
                                    <span>{relativeTime(user.lastLoginAt)}</span>
                                  </div>
                                </td>
                                <td>
                                  <span className="project-count-badge">
                                    {user.projects} {user.projects === 1 ? 'app' : 'apps'}
                                  </span>
                                </td>
                                <td>
                                  {user.verified ? (
                                    <span className="admin-badge admin-badge-ok">
                                      <BadgeCheck size={11} aria-hidden="true" /> Verified
                                    </span>
                                  ) : (
                                    <span className="admin-badge admin-badge-muted">Unverified</span>
                                  )}
                                </td>
                                <td className="td-actions">
                                  <button
                                    type="button"
                                    className="admin-row-action-btn danger"
                                    onClick={() => deleteUser(user)}
                                    disabled={working}
                                    title={`Delete ${user.email}`}
                                    aria-label={`Delete ${user.email}`}
                                  >
                                    <Trash2 size={14} aria-hidden="true" />
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                          {filteredUsers.length === 0 && (
                            <tr>
                              <td colSpan={6} className="admin-empty">
                                <Users size={32} className="admin-empty-icon" aria-hidden="true" />
                                <p>No accounts match the current filter or search.</p>
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>

                    {/* Pagination Controls */}
                    {filteredUsers.length > 0 && (
                      <div className="admin-pagination">
                        <div className="pagination-info">
                          Showing{' '}
                          <strong>{(userPage - 1) * userPageSize + 1}</strong>–
                          <strong>{Math.min(userPage * userPageSize, filteredUsers.length)}</strong> of{' '}
                          <strong>{filteredUsers.length}</strong> accounts
                        </div>

                        <div className="pagination-controls">
                          <label className="page-size-selector">
                            <span>Per page</span>
                            <select
                              value={userPageSize}
                              onChange={e => { setUserPageSize(Number(e.target.value)); setUserPage(1); }}
                            >
                              <option value={10}>10</option>
                              <option value={15}>15</option>
                              <option value={25}>25</option>
                              <option value={50}>50</option>
                            </select>
                          </label>

                          <div className="pagination-buttons">
                            <button
                              type="button"
                              className="pagination-btn"
                              onClick={() => setUserPage(p => Math.max(1, p - 1))}
                              disabled={userPage <= 1}
                              aria-label="Previous page"
                            >
                              <ChevronLeft size={14} />
                            </button>
                            <span className="pagination-status">
                              {userPage} / {totalUserPages}
                            </span>
                            <button
                              type="button"
                              className="pagination-btn"
                              onClick={() => setUserPage(p => Math.min(totalUserPages, p + 1))}
                              disabled={userPage >= totalUserPages}
                              aria-label="Next page"
                            >
                              <ChevronRight size={14} />
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* TAB 2: PROJECTS */}
                {tab === 'projects' && (
                  <div className="admin-tab-pane">
                    {/* Status Filter Row */}
                    <div className="admin-toolbar">
                      <div className="admin-filter-group" role="group" aria-label="Filter projects by status">
                        {(['all', 'live', 'published', 'gallery', 'deleted'] as ProjectStatusFilter[]).map(f => (
                          <button
                            key={f}
                            type="button"
                            className={`admin-filter-pill ${statusFilter === f ? 'active' : ''}`}
                            onClick={() => { setStatusFilter(f); setProjectPage(1); }}
                            aria-pressed={statusFilter === f}
                          >
                            {f === 'all'
                              ? 'All'
                              : f === 'live'
                              ? 'Live'
                              : f === 'published'
                              ? 'Published'
                              : f === 'gallery'
                              ? 'Gallery'
                              : 'Deleted'}
                            <span className="admin-count-pill">{statusCounts[f]}</span>
                          </button>
                        ))}
                      </div>

                      <div className="admin-toolbar-right">
                        <div className="admin-search-box">
                          <Search size={14} aria-hidden="true" className="admin-search-icon" />
                          <input
                            type="search"
                            placeholder="Filter by name, owner, or ID…"
                            value={search}
                            onChange={e => { setSearch(e.target.value); setProjectPage(1); }}
                            aria-label="Filter projects"
                          />
                          {search && (
                            <button
                              type="button"
                              className="admin-search-clear"
                              onClick={() => { setSearch(''); setProjectPage(1); }}
                              aria-label="Clear search"
                            >
                              <X size={12} />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Paginated Projects Table */}
                    <div className="admin-table-wrap">
                      <table className="admin-table">
                        <thead>
                          <tr>
                            <th onClick={() => toggleProjectSort('name')} className="sortable-th">
                              <div className="th-content">
                                <span>Project</span>
                                {projectSortField === 'name' ? (
                                  projectSortDir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />
                                ) : (
                                  <ArrowUpDown size={12} className="th-sort-icon" />
                                )}
                              </div>
                            </th>
                            <th onClick={() => toggleProjectSort('ownerEmail')} className="sortable-th">
                              <div className="th-content">
                                <span>Owner</span>
                                {projectSortField === 'ownerEmail' ? (
                                  projectSortDir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />
                                ) : (
                                  <ArrowUpDown size={12} className="th-sort-icon" />
                                )}
                              </div>
                            </th>
                            <th onClick={() => toggleProjectSort('updatedAt')} className="sortable-th">
                              <div className="th-content">
                                <span>Last Updated</span>
                                {projectSortField === 'updatedAt' ? (
                                  projectSortDir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />
                                ) : (
                                  <ArrowUpDown size={12} className="th-sort-icon" />
                                )}
                              </div>
                            </th>
                            <th onClick={() => toggleProjectSort('status')} className="sortable-th">
                              <div className="th-content">
                                <span>Status</span>
                                {projectSortField === 'status' ? (
                                  projectSortDir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />
                                ) : (
                                  <ArrowUpDown size={12} className="th-sort-icon" />
                                )}
                              </div>
                            </th>
                            <th className="th-actions">
                              <span className="admin-sr">Actions</span>
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {paginatedProjects.map(project => (
                            <tr key={project.id} className="admin-table-row">
                              <td>
                                <div className="project-cell">
                                  <strong>{project.name}</strong>
                                  <span className="project-sub-id">{project.id}</span>
                                </div>
                              </td>
                              <td>
                                <div className="user-details">
                                  <span className="user-email">{project.ownerEmail}</span>
                                </div>
                              </td>
                              <td>
                                <span className="date-sub">{relativeTime(project.updatedAt)}</span>
                              </td>
                              <td>
                                <div className="badge-group">
                                  {project.deleted ? (
                                    <span className="admin-badge admin-badge-danger">Deleted</span>
                                  ) : (
                                    <>
                                      <span className="admin-badge admin-badge-ok">Live</span>
                                      {project.published && <span className="admin-badge admin-badge-info">Published</span>}
                                      {project.showcase && <span className="admin-badge admin-badge-accent">Gallery</span>}
                                    </>
                                  )}
                                </div>
                              </td>
                              <td className="td-actions">
                                <div className="admin-row-actions">
                                  {!project.deleted && (
                                    <>
                                      <button
                                        type="button"
                                        className="admin-row-action-btn"
                                        onClick={() => void viewCode(project)}
                                        disabled={codeLoading}
                                        title={`View code of "${project.name}"`}
                                        aria-label={`View code of "${project.name}"`}
                                      >
                                        <Code2 size={14} aria-hidden="true" />
                                      </button>
                                      <button
                                        type="button"
                                        className="admin-row-action-btn"
                                        onClick={() => setPreviewProject(project)}
                                        title={`Preview "${project.name}"`}
                                        aria-label={`Preview "${project.name}"`}
                                      >
                                        <Eye size={14} aria-hidden="true" />
                                      </button>
                                    </>
                                  )}
                                  <button
                                    type="button"
                                    className="admin-row-action-btn danger"
                                    onClick={() => deleteProject(project)}
                                    disabled={working}
                                    title={`Delete "${project.name}" forever`}
                                    aria-label={`Delete "${project.name}" forever`}
                                  >
                                    <Trash2 size={14} aria-hidden="true" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                          {filteredProjects.length === 0 && (
                            <tr>
                              <td colSpan={5} className="admin-empty">
                                <FolderKanban size={32} className="admin-empty-icon" aria-hidden="true" />
                                <p>No projects match.</p>
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>

                    {/* Pagination Controls */}
                    {filteredProjects.length > 0 && (
                      <div className="admin-pagination">
                        <div className="pagination-info">
                          Showing{' '}
                          <strong>{(projectPage - 1) * projectPageSize + 1}</strong>–
                          <strong>{Math.min(projectPage * projectPageSize, filteredProjects.length)}</strong> of{' '}
                          <strong>{filteredProjects.length}</strong> projects
                        </div>

                        <div className="pagination-controls">
                          <label className="page-size-selector">
                            <span>Per page</span>
                            <select
                              value={projectPageSize}
                              onChange={e => { setProjectPageSize(Number(e.target.value)); setProjectPage(1); }}
                            >
                              <option value={10}>10</option>
                              <option value={15}>15</option>
                              <option value={25}>25</option>
                              <option value={50}>50</option>
                            </select>
                          </label>

                          <div className="pagination-buttons">
                            <button
                              type="button"
                              className="pagination-btn"
                              onClick={() => setProjectPage(p => Math.max(1, p - 1))}
                              disabled={projectPage <= 1}
                              aria-label="Previous page"
                            >
                              <ChevronLeft size={14} />
                            </button>
                            <span className="pagination-status">
                              {projectPage} / {totalProjectPages}
                            </span>
                            <button
                              type="button"
                              className="pagination-btn"
                              onClick={() => setProjectPage(p => Math.min(totalProjectPages, p + 1))}
                              disabled={projectPage >= totalProjectPages}
                              aria-label="Next page"
                            >
                              <ChevronRight size={14} />
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* TAB 3: MODELS */}
                {tab === 'models' && (
                  <div className="admin-models-grid">
                    {/* Built-in Models Switch & List */}
                    <div className="admin-card" aria-label="Built-in BrainHalf models">
                      <div className="admin-card-head">
                        <span className="admin-stat-icon icon-brain">
                          <Brain size={17} aria-hidden="true" />
                        </span>
                        <div>
                          <h2>Built-in models</h2>
                          <p>
                            Control built-in model availability platform-wide. When the master switch is off, generations
                            using integrated models are blocked. Custom models are unaffected.
                          </p>
                        </div>
                      </div>

                      <div className="admin-toggle-row admin-master-toggle">
                        <button
                          type="button"
                          role="switch"
                          aria-checked={integratedEnabled}
                          className={`admin-toggle ${integratedEnabled ? 'admin-toggle-on' : ''}`}
                          onClick={toggleIntegrated}
                          disabled={integratedToggling}
                        >
                          <span className="admin-toggle-knob" />
                        </button>
                        <span className="admin-toggle-label">
                          All integrated models {integratedEnabled ? 'enabled' : 'disabled'}
                        </span>
                      </div>

                      <div className="admin-model-list">
                        {CLIENT_SELECTABLE_MODELS.map(m => {
                          const key = `${m.provider}:${m.name}`;
                          const isOff = disabledModels.includes(key);
                          return (
                            <div key={key} className="admin-model-row">
                              <div className="admin-model-meta">
                                <span className="admin-model-name">{m.name}</span>
                                <span className="admin-model-provider">({m.provider})</span>
                              </div>
                              <button
                                type="button"
                                role="switch"
                                aria-checked={!isOff}
                                aria-label={`Turn ${m.name} ${isOff ? 'on' : 'off'}`}
                                className={`admin-toggle admin-toggle-sm ${!isOff ? 'admin-toggle-on' : ''}`}
                                onClick={() => toggleSingleModel(key)}
                              >
                                <span className="admin-toggle-knob" />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Test Integrated Model Workbench */}
                    <div className="admin-card" aria-label="Test a built-in model">
                      <div className="admin-card-head">
                        <span className="admin-stat-icon icon-play">
                          <Play size={17} aria-hidden="true" />
                        </span>
                        <div>
                          <h2>Integrated model playground</h2>
                          <p>Run latency, throughput, and generation benchmarks directly against live models.</p>
                        </div>
                      </div>

                      <div className="admin-form-grid">
                        <label>
                          Target model
                          <select
                            value={builtinTestModel}
                            onChange={e => setBuiltinTestModel(e.target.value)}
                          >
                            <option value="">Select an integrated model…</option>
                            {CLIENT_SELECTABLE_MODELS.map(m => (
                              <option key={`${m.provider}:${m.name}`} value={m.name}>
                                {m.name} ({m.provider})
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>

                      <label className="admin-test-label">
                        Test prompt
                        <textarea
                          value={builtinTestPrompt}
                          onChange={e => setBuiltinTestPrompt(e.target.value)}
                          placeholder="Describe a component or logic to generate…"
                          rows={3}
                        />
                      </label>

                      <button
                        type="button"
                        className="admin-btn admin-btn-primary"
                        onClick={testBuiltinModel}
                        disabled={builtinTestRunning || !integratedEnabled}
                      >
                        {builtinTestRunning ? (
                          <Loader2 size={14} className="admin-spin" aria-hidden="true" />
                        ) : (
                          <Play size={14} aria-hidden="true" />
                        )}
                        <span>{builtinTestRunning ? 'Executing test…' : 'Run benchmark'}</span>
                      </button>

                      {!integratedEnabled && (
                        <p className="admin-hint">Turn on integrated models to run playground tests.</p>
                      )}

                      {builtinTestOutput && (
                        <pre className="admin-test-output" aria-live="polite">
                          {builtinTestOutput}
                        </pre>
                      )}
                    </div>

                    {/* Add Custom Model */}
                    <div className="admin-card" aria-label="Add a custom model">
                      <div className="admin-card-head">
                        <span className="admin-stat-icon icon-plus">
                          <Plus size={17} aria-hidden="true" />
                        </span>
                        <div>
                          <h2>Connect custom model</h2>
                          <p>
                            Plug in any OpenAI-compatible inference endpoint. Keys are encrypted at rest with unlimited
                            test tokens.
                          </p>
                        </div>
                      </div>

                      <div className="admin-form-grid">
                        <label>
                          Display name
                          <input
                            type="text"
                            value={modelForm.name}
                            onChange={e => setModelForm(f => ({ ...f, name: e.target.value }))}
                            placeholder="e.g. DeepSeek V3 (Local)"
                          />
                        </label>
                        <label>
                          Base URL
                          <input
                            type="url"
                            value={modelForm.baseUrl}
                            onChange={e => setModelForm(f => ({ ...f, baseUrl: e.target.value }))}
                            placeholder="https://api.openai.com/v1"
                          />
                        </label>
                        <label>
                          Model ID
                          <input
                            type="text"
                            value={modelForm.modelId}
                            onChange={e => setModelForm(f => ({ ...f, modelId: e.target.value }))}
                            placeholder="gpt-4o or custom identifier"
                          />
                        </label>
                        <label>
                          API key
                          <input
                            type="password"
                            value={modelForm.apiKey}
                            onChange={e => setModelForm(f => ({ ...f, apiKey: e.target.value }))}
                            placeholder="sk-…"
                            autoComplete="off"
                          />
                        </label>
                      </div>

                      <button
                        type="button"
                        className="admin-btn admin-btn-primary"
                        onClick={saveModel}
                        disabled={modelSaving}
                      >
                        {modelSaving ? (
                          <Loader2 size={14} className="admin-spin" aria-hidden="true" />
                        ) : (
                          <Plus size={14} aria-hidden="true" />
                        )}
                        <span>Save model configuration</span>
                      </button>
                    </div>

                    {/* Custom Models Table */}
                    <div className="admin-models-table-wrap">
                      <div className="admin-table-bar admin-models-table-bar">
                        <h2>
                          Custom models <span className="admin-count-pill">{models.length}</span>
                        </h2>
                      </div>
                      <div className="admin-table-wrap">
                        <table className="admin-table">
                          <thead>
                            <tr>
                              <th>Model</th>
                              <th>Base URL</th>
                              <th>Model ID</th>
                              <th className="th-actions">
                                <span className="admin-sr">Actions</span>
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {models.map(m => (
                              <tr key={m.id} className="admin-table-row">
                                <td>
                                  <strong>{m.name}</strong>
                                </td>
                                <td className="admin-mono">{m.baseUrl}</td>
                                <td className="admin-mono">{m.modelId}</td>
                                <td className="td-actions">
                                  <div className="admin-actions">
                                    <button
                                      type="button"
                                      className="admin-row-action-btn"
                                      title={`Test ${m.name}`}
                                      aria-label={`Test ${m.name}`}
                                      onClick={() => { setTestModelId(m.id); setTestOutput(''); }}
                                    >
                                      <Play size={14} aria-hidden="true" />
                                    </button>
                                    <button
                                      type="button"
                                      className="admin-row-action-btn danger"
                                      title={`Remove ${m.name}`}
                                      aria-label={`Remove ${m.name}`}
                                      onClick={() => deleteModel(m.id)}
                                      disabled={working}
                                    >
                                      <Trash2 size={14} aria-hidden="true" />
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                            {models.length === 0 && (
                              <tr>
                                <td colSpan={4} className="admin-empty">
                                  No custom models configured yet. Add one above.
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {/* Custom Model Playground */}
                    {testModelId && (() => {
                      const model = models.find(m => m.id === testModelId);
                      return model ? (
                        <div className="admin-card" aria-label={`Test ${model.name}`}>
                          <div className="admin-card-head">
                            <span className="admin-stat-icon icon-play">
                              <Play size={17} aria-hidden="true" />
                            </span>
                            <div>
                              <h2>Test {model.name}</h2>
                              <p>Direct unthrottled streaming generation test.</p>
                            </div>
                          </div>
                          <label className="admin-test-label">
                            Prompt
                            <textarea
                              value={testPrompt}
                              onChange={e => setTestPrompt(e.target.value)}
                              placeholder="Describe what to generate…"
                              rows={3}
                            />
                          </label>
                          <button
                            type="button"
                            className="admin-btn admin-btn-primary"
                            onClick={() => testModel(model.id)}
                            disabled={testRunning}
                          >
                            {testRunning ? (
                              <Loader2 size={14} className="admin-spin" aria-hidden="true" />
                            ) : (
                              <Play size={14} aria-hidden="true" />
                            )}
                            <span>{testRunning ? 'Generating response…' : 'Stream generation'}</span>
                          </button>
                          {testOutput && (
                            <pre className="admin-test-output" aria-live="polite">
                              {testOutput}
                            </pre>
                          )}
                        </div>
                      ) : null;
                    })()}
                  </div>
                )}

                {/* Warning note for destructive actions (keeps .admin-warning-box intact for test) */}
                <div className="admin-hint admin-warning-box" role="note">
                  <AlertTriangle size={15} className="admin-warning-icon" aria-hidden="true" />
                  <span>
                    Deleting a project erases it completely — app files, backend, backups, and the registry entry.
                    Deleting an account removes the account and all of its projects. Neither can be undone.
                  </span>
                </div>
              </section>
            </>
          )}

          {/* Code Viewer Modal */}
          {codeView && (
            <div className="admin-modal-backdrop admin-modal-wide-backdrop" onClick={() => setCodeView(null)}>
              <div
                className="admin-modal admin-modal-wide"
                role="dialog"
                aria-modal="true"
                aria-labelledby="admin-code-title"
                onClick={e => e.stopPropagation()}
              >
                <div className="admin-modal-head">
                  <div>
                    <h2 id="admin-code-title">
                      <FileCode2 size={16} aria-hidden="true" /> {codeView.project.name}
                    </h2>
                    <p className="admin-sub">{codeView.project.ownerEmail} · {codeView.project.id}</p>
                  </div>
                  <button
                    type="button"
                    className="admin-icon-btn"
                    onClick={() => setCodeView(null)}
                    aria-label="Close code viewer"
                  >
                    <X size={16} />
                  </button>
                </div>
                <div className="admin-code-layout">
                  <nav className="admin-file-tree" aria-label="Project files">
                    {Object.keys(codeView.files).sort().map(path => (
                      <button
                        key={path}
                        type="button"
                        className={`admin-file-btn ${codeView.selectedFile === path ? 'admin-file-active' : ''}`}
                        onClick={() => setCodeView({ ...codeView, selectedFile: path })}
                      >
                        {path}
                      </button>
                    ))}
                    {Object.keys(codeView.files).length === 0 && (
                      <p className="admin-empty">This project has no saved files.</p>
                    )}
                  </nav>
                  <div className="admin-code-pane">
                    {codeView.selectedFile ? (
                      <pre className="admin-code">
                        <code>{codeView.files[codeView.selectedFile]}</code>
                      </pre>
                    ) : (
                      <p className="admin-empty">Select a file to view its code.</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Preview Project Modal */}
          {previewProject && (
            <div className="admin-modal-backdrop admin-modal-wide-backdrop" onClick={() => setPreviewProject(null)}>
              <div
                className="admin-modal admin-modal-wide"
                role="dialog"
                aria-modal="true"
                aria-labelledby="admin-preview-title"
                onClick={e => e.stopPropagation()}
              >
                <div className="admin-modal-head">
                  <div>
                    <h2 id="admin-preview-title">
                      <Eye size={16} aria-hidden="true" /> {previewProject.name}
                    </h2>
                    <p className="admin-sub">{previewProject.ownerEmail} · live preview sandbox</p>
                  </div>
                  <div className="modal-head-actions">
                    <a
                      href={`/api/admin/projects/${encodeURIComponent(previewProject.id)}/preview/`}
                      target="_blank"
                      rel="noreferrer"
                      className="admin-icon-btn"
                      title="Open in new window"
                    >
                      <ExternalLink size={15} />
                    </a>
                    <button
                      type="button"
                      className="admin-icon-btn"
                      onClick={() => setPreviewProject(null)}
                      aria-label="Close preview"
                    >
                      <X size={16} />
                    </button>
                  </div>
                </div>
                <iframe
                  title={`Preview of ${previewProject.name}`}
                  className="admin-preview-frame"
                  src={`/api/admin/projects/${encodeURIComponent(previewProject.id)}/preview/`}
                  sandbox={PREVIEW_SANDBOX}
                />
              </div>
            </div>
          )}

          {/* Confirmation Modal */}
          {confirm && (
            <div className="admin-modal-backdrop" onClick={() => !working && setConfirm(null)}>
              <div
                className="admin-modal"
                role="alertdialog"
                aria-modal="true"
                aria-labelledby="admin-confirm-title"
                onClick={e => e.stopPropagation()}
              >
                <div className="admin-modal-icon">
                  <AlertTriangle size={22} aria-hidden="true" />
                </div>
                <h2 id="admin-confirm-title">{confirm.title}</h2>
                <p>{confirm.message}</p>
                <div className="admin-modal-actions">
                  <button
                    type="button"
                    className="admin-cancel-btn"
                    onClick={() => setConfirm(null)}
                    disabled={working}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="admin-danger-btn"
                    onClick={() => void confirm.onConfirm()}
                    disabled={working}
                  >
                    {working ? 'Processing…' : confirm.confirmLabel}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
