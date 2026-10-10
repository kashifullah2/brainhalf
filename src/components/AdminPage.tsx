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
  ArrowLeft,
  EyeOff,
  Zap,
  Power,
} from 'lucide-react';
import BrainHalfLogo from './BrainHalfLogo';
import SiteHeaderActions from './SiteHeaderActions';
import MobileNav from './MobileNav';
import { authFetch, getUser } from '../lib/auth-client';
import { PREVIEW_SANDBOX, PREVIEW_ALLOW } from '../lib/preview-isolation';
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

const BUILTIN_MODEL_META: Record<string, { label: string; badge: string; colorClass: string; desc: string }> = {
  '@cf/deepseek-ai/deepseek-v4-pro-0813': {
    label: 'DeepSeek V4 Pro',
    badge: 'Cloudflare',
    colorClass: 'admin-provider-cloudflare',
    desc: 'Flagship code & fullstack generation engine',
  },
  '@cf/deepseek-ai/deepseek-v4-flash-0731': {
    label: 'DeepSeek V4 Flash',
    badge: 'Cloudflare',
    colorClass: 'admin-provider-cloudflare',
    desc: 'Fast lightweight code generation model',
  },
  '@cf/openai/gpt-oss-120b': {
    label: 'GPT-OSS 120B',
    badge: 'Cloudflare',
    colorClass: 'admin-provider-cloudflare',
    desc: 'High-capacity reasoning & complex architectures',
  },
  '@cf/moonshotai/kimi-k2.7-code': {
    label: 'Kimi K2.7 Code',
    badge: 'Cloudflare',
    colorClass: 'admin-provider-cloudflare',
    desc: '200k extended context code generation model',
  },
  '@cf/qwen/qwen3.8-27b': {
    label: 'Qwen 3.8 27B',
    badge: 'Cloudflare',
    colorClass: 'admin-provider-cloudflare',
    desc: 'Fast instruction following and logic synthesis',
  },
  '@cf/meta/llama-4-scout-17b-16e-instruct': {
    label: 'Llama 4 Scout',
    badge: 'Cloudflare',
    colorClass: 'admin-provider-cloudflare',
    desc: 'Meta MoE model — fast coding and vision support',
  },
  '@cf/meta/llama-4-maverick-17b-128e-instruct': {
    label: 'Llama 4 Maverick',
    badge: 'Cloudflare',
    colorClass: 'admin-provider-cloudflare',
    desc: 'Meta 128-expert MoE — deep reasoning and generation',
  },
  '@cf/google/gemma-3-27b-it': {
    label: 'Gemma 3 27B',
    badge: 'Cloudflare',
    colorClass: 'admin-provider-cloudflare',
    desc: 'Google open model — fast instruction following',
  },
  '@cf/mistralai/mistral-small-3.1-24b-instruct': {
    label: 'Mistral Small 3.1',
    badge: 'Cloudflare',
    colorClass: 'admin-provider-cloudflare',
    desc: 'Mistral lightweight coder — low latency generation',
  },
  '@cf/qwen/qwen2.5-coder-32b-instruct': {
    label: 'Qwen 2.5 Coder 32B',
    badge: 'Cloudflare',
    colorClass: 'admin-provider-cloudflare',
    desc: 'Alibaba code-specialist — structured output & refactoring',
  },
  '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b': {
    label: 'DeepSeek R1 32B',
    badge: 'Cloudflare',
    colorClass: 'admin-provider-cloudflare',
    desc: 'Reasoning-distilled model — chain-of-thought coding',
  },
  'claude-sonnet-6': {
    label: 'Claude Sonnet 4.6',
    badge: 'AWS Bedrock',
    colorClass: 'admin-provider-aws',
    desc: 'High-precision engineering and structural reasoning',
  },
  'claude-opus-6': {
    label: 'Claude Opus 4.6',
    badge: 'AWS Bedrock',
    colorClass: 'admin-provider-aws',
    desc: 'Most capable Anthropic model — complex app generation',
  },
  'kimi-k3': {
    label: 'Kimi K3 v1',
    badge: 'AWS Bedrock',
    colorClass: 'admin-provider-aws',
    desc: '1M ultra-long context comprehension engine',
  },
  'minimax-m2.5': {
    label: 'MiniMax M2.5',
    badge: 'AWS Bedrock',
    colorClass: 'admin-provider-aws',
    desc: 'MiniMax flagship — strong coding and creative generation',
  },
  '@cf/zai-org/glm-5.3-flash': {
    label: 'GLM 5.3 Flash',
    badge: 'Cloudflare',
    colorClass: 'admin-provider-cloudflare',
    desc: 'Code generation model — currently disabled (timeouts)',
  },
  'Atria-Dawn-Preview': {
    label: 'Atria Dawn Preview',
    badge: 'Atria ASI',
    colorClass: 'admin-provider-atria',
    desc: 'Next-generation experimental agent model',
  },
};

const PRESET_PROVIDERS = [
  { name: 'OpenAI', url: 'https://api.openai.com/v1', model: 'gpt-4o' },
  { name: 'Gemini', url: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.0-flash' },
  { name: 'Cohere', url: 'https://api.cohere.com/compatibility/v1', model: 'command-a-03-2025' },
  { name: 'DeepSeek', url: 'https://api.deepseek.com', model: 'deepseek-chat' },
  { name: 'Groq', url: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile' },
  { name: 'OpenRouter', url: 'https://openrouter.ai/api/v1', model: 'anthropic/claude-3.5-sonnet' },
  { name: 'Ollama (Local)', url: 'http://localhost:11434/v1', model: 'llama3' },
];

const BENCHMARK_PROMPTS = [
  { label: '⚡ Counter App', text: 'Build an interactive React counter component with increment, decrement, reset, and step size controls.' },
  { label: '📝 Todo List', text: 'Build a fullstack Todo list with filter tabs (All, Active, Completed), local persistence, and badges.' },
  { label: '🌐 REST API', text: 'Create an Express or Hono REST API handler with error handling, validation, and JSON responses.' },
  { label: '🎨 Hero Banner', text: 'Design a high-converting landing page hero section with gradient badges and call-to-action buttons.' },
];


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

function SortHeader<T extends string>({ label, field, currentField, direction, onToggle }: {
  label: string;
  field: T;
  currentField: T;
  direction: SortDirection;
  onToggle: (field: T) => void;
}) {
  return (
    <th onClick={() => onToggle(field)} className="sortable-th">
      <div className="th-content">
        <span>{label}</span>
        {currentField === field ? (
          direction === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />
        ) : (
          <ArrowUpDown size={12} className="th-sort-icon" />
        )}
      </div>
    </th>
  );
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
  const [modelForm, setModelForm] = useState({ baseUrl: '', apiKey: '', entries: [{ name: '', modelId: '' }] });
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
  const [modelSearch, setModelSearch] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [copiedModelUrl, setCopiedModelUrl] = useState<string | null>(null);
  const [emailStatus, setEmailStatus] = useState<{ configured: boolean; fromEmail: string | null; hint: string } | null>(null);

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

  useEffect(() => { if (state === 'ready') void loadIntegratedSetting(); }, [state, tab]);

  useEffect(() => {
    if (state !== 'ready') return;
    authFetch('/api/admin/email-status')
      .then(async res => {
        if (!res.ok) return;
        const body = await res.json() as { configured?: boolean; fromEmail?: string | null; hint?: string };
        setEmailStatus({ configured: body.configured === true, fromEmail: body.fromEmail ?? null, hint: body.hint ?? '' });
      })
      .catch(() => {});
  }, [state]);

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

  const enableAllBuiltinModels = async () => {
    setNotice(null);
    setDisabledModels([]);
    try {
      const response = await authFetch('/api/admin/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ disabledModels: [] }),
      });
      if (!response.ok) {
        setNotice({ kind: 'error', text: 'Could not update model settings.' });
        void loadIntegratedSetting();
      } else {
        setNotice({ kind: 'ok', text: 'All integrated models are enabled.' });
      }
    } catch {
      setNotice({ kind: 'error', text: 'Could not update model settings.' });
      void loadIntegratedSetting();
    }
  };

  const disableAllBuiltinModels = async () => {
    setNotice(null);
    const allKeys = CLIENT_SELECTABLE_MODELS.map(m => `${m.provider}:${m.name}`);
    setDisabledModels(allKeys);
    try {
      const response = await authFetch('/api/admin/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ disabledModels: allKeys }),
      });
      if (!response.ok) {
        setNotice({ kind: 'error', text: 'Could not update model settings.' });
        void loadIntegratedSetting();
      } else {
        setNotice({ kind: 'ok', text: 'All individual built-in models paused.' });
      }
    } catch {
      setNotice({ kind: 'error', text: 'Could not update model settings.' });
      void loadIntegratedSetting();
    }
  };

  const applyProviderPreset = (preset: typeof PRESET_PROVIDERS[number]) => {
    setModelForm(prev => ({
      ...prev,
      baseUrl: preset.url,
      entries: prev.entries.map((e, i) => i === 0
        ? { name: e.name || `${preset.name} Model`, modelId: e.modelId || preset.model }
        : e
      ),
    }));
  };

  const filteredBuiltinModels = useMemo(() => {
    if (!modelSearch.trim()) return CLIENT_SELECTABLE_MODELS;
    const q = modelSearch.toLowerCase();
    return CLIENT_SELECTABLE_MODELS.filter(m => {
      const meta = BUILTIN_MODEL_META[m.name];
      return (
        m.name.toLowerCase().includes(q) ||
        m.provider.toLowerCase().includes(q) ||
        (meta && (meta.label.toLowerCase().includes(q) || meta.badge.toLowerCase().includes(q) || meta.desc.toLowerCase().includes(q)))
      );
    });
  }, [modelSearch]);

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
    if (!modelForm.baseUrl.trim() || !modelForm.apiKey.trim()) {
      setNotice({ kind: 'error', text: 'Base URL and API key are required.' });
      return;
    }
    const validEntries = modelForm.entries.filter(e => e.name.trim() && e.modelId.trim());
    if (validEntries.length === 0) {
      setNotice({ kind: 'error', text: 'Add at least one model with a display name and model ID.' });
      return;
    }
    setModelSaving(true);
    setNotice(null);
    try {
      const errors: string[] = [];
      for (const entry of validEntries) {
        const response = await authFetch('/api/admin/models', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: entry.name.trim(), baseUrl: modelForm.baseUrl.trim(), modelId: entry.modelId.trim(), apiKey: modelForm.apiKey.trim() }),
        });
        const body = await response.json() as { error?: string };
        if (!response.ok) errors.push(body.error || `Failed to add "${entry.name}"`);
      }
      if (errors.length) {
        setNotice({ kind: 'error', text: errors.join(' · ') });
      } else {
        setNotice({ kind: 'ok', text: validEntries.length === 1 ? 'Model added.' : `${validEntries.length} models added.` });
        setModelForm({ baseUrl: '', apiKey: '', entries: [{ name: '', modelId: '' }] });
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

  const [weekAgo] = useState(() => Date.now() - 7 * 86_400_000);

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
          <div className="admin-title-row">
            <h1>{tab === 'accounts' ? 'Accounts' : tab === 'projects' ? 'Projects' : 'Models'}</h1>
            <p className="admin-subtitle">
              {tab === 'accounts'
                ? `${stats.total} registered accounts, ${stats.activeWeek} active this week`
                : tab === 'projects'
                  ? `${stats.liveProjects} live projects, ${stats.totalProjects} total`
                  : `${CLIENT_SELECTABLE_MODELS.length} built-in models, ${models.length} custom`}
            </p>
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

          {state === 'ready' && !integratedEnabled && (
            <div className="admin-notice admin-notice-warning admin-notice-warning-content" role="alert">
              <div>
                <strong className="admin-notice-warning-title">Built-in models are turned off</strong>
                <p className="admin-notice-warning-text">
                  Generations using integrated models are blocked. Turn them on to allow users to build apps.
                </p>
              </div>
              <button
                type="button"
                className="admin-btn admin-btn-primary"
                onClick={toggleIntegrated}
                disabled={integratedToggling}
              >
                {integratedToggling ? 'Turning on…' : 'Turn on integrated models'}
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
              {getUser()?.id && (
                <p>
                  Your user ID: <code>{getUser()!.id}</code>
                </p>
              )}
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

              {/* Email service health badge */}
              {emailStatus && (
                <div className="admin-email-status-bar" role="status" title={emailStatus.hint}>
                  <span className={`admin-badge ${emailStatus.configured ? 'admin-badge-ok' : 'admin-badge-danger'}`}>
                    {emailStatus.configured ? 'Email configured' : 'Email misconfigured'}
                  </span>
                  {emailStatus.fromEmail && (
                    <span className="admin-email-from">from {emailStatus.fromEmail}</span>
                  )}
                  {!emailStatus.configured && (
                    <span className="admin-email-hint">{emailStatus.hint}</span>
                  )}
                </div>
              )}

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
                            <SortHeader label="Account" field="email" currentField={userSortField} direction={userSortDir} onToggle={toggleUserSort} />
                            <SortHeader label="Signed Up" field="createdAt" currentField={userSortField} direction={userSortDir} onToggle={toggleUserSort} />
                            <SortHeader label="Last Active" field="lastLoginAt" currentField={userSortField} direction={userSortDir} onToggle={toggleUserSort} />
                            <SortHeader label="Projects" field="projects" currentField={userSortField} direction={userSortDir} onToggle={toggleUserSort} />
                            <SortHeader label="Status" field="verified" currentField={userSortField} direction={userSortDir} onToggle={toggleUserSort} />
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
                            <SortHeader label="Project" field="name" currentField={projectSortField} direction={projectSortDir} onToggle={toggleProjectSort} />
                            <SortHeader label="Owner" field="ownerEmail" currentField={projectSortField} direction={projectSortDir} onToggle={toggleProjectSort} />
                            <SortHeader label="Last Updated" field="updatedAt" currentField={projectSortField} direction={projectSortDir} onToggle={toggleProjectSort} />
                            <SortHeader label="Status" field="status" currentField={projectSortField} direction={projectSortDir} onToggle={toggleProjectSort} />
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

                      {/* Hero Master Status Card */}
                      <div className={`admin-master-card ${integratedEnabled ? 'is-active' : 'is-paused'}`}>
                        <div className="admin-master-top">
                          <span className={`admin-master-status ${integratedEnabled ? 'status-active' : 'status-paused'}`}>
                            <span className="admin-status-dot" aria-hidden="true" />
                            {integratedEnabled ? 'Platform Active' : 'Platform Paused'}
                          </span>
                          <button
                            type="button"
                            role="switch"
                            aria-checked={integratedEnabled}
                            className={`admin-master-toggle-btn ${integratedEnabled ? 'btn-active' : 'btn-paused'}`}
                            onClick={toggleIntegrated}
                            disabled={integratedToggling}
                          >
                            <Power size={13} aria-hidden="true" />
                            <span>
                              {integratedToggling
                                ? 'Updating…'
                                : integratedEnabled
                                  ? 'Turn off master switch'
                                  : 'Turn on master switch'}
                            </span>
                          </button>
                        </div>
                        <p className="admin-master-desc">
                          {integratedEnabled
                            ? 'All allowed built-in models are accessible in Agent Studio. Turn off to pause all integrated AI generation platform-wide.'
                            : 'Built-in model generations are paused platform-wide. Agent Studio users will see a friendly notice until turned on.'}
                        </p>
                      </div>

                      {/* Filter & Bulk Actions Bar */}
                      <div className="admin-models-toolbar">
                        <div className="admin-models-search">
                          <Search size={13} className="admin-models-search-icon" aria-hidden="true" />
                          <input
                            type="text"
                            value={modelSearch}
                            onChange={e => setModelSearch(e.target.value)}
                            placeholder="Filter models by name or provider…"
                            aria-label="Filter models by name or provider"
                          />
                        </div>
                        <div className="admin-bulk-actions">
                          <button
                            type="button"
                            className="admin-bulk-btn"
                            onClick={enableAllBuiltinModels}
                            title="Turn on all individual models"
                          >
                            Enable all
                          </button>
                          <button
                            type="button"
                            className="admin-bulk-btn"
                            onClick={disableAllBuiltinModels}
                            title="Pause all individual models"
                          >
                            Pause all
                          </button>
                        </div>
                      </div>

                      {/* Models List */}
                      <div className="admin-model-list" role="list" aria-label="Integrated model list">
                        {filteredBuiltinModels.map(m => {
                          const key = `${m.provider}:${m.name}`;
                          const isOff = disabledModels.includes(key);
                          const meta = BUILTIN_MODEL_META[m.name] || {
                            label: m.name,
                            badge: m.provider,
                            colorClass: `admin-provider-${m.provider}`,
                            desc: `${m.provider} model endpoint`,
                          };

                          return (
                            <div key={key} className={`admin-model-row ${isOff || !integratedEnabled ? 'is-disabled' : ''}`} role="listitem">
                              <div className="admin-model-meta">
                                <div className="admin-model-title-line">
                                  <span className="admin-model-name">{meta.label}</span>
                                  <span className={`admin-provider-pill ${meta.colorClass}`}>
                                    {meta.badge}
                                  </span>
                                </div>
                                <span className="admin-model-desc-line">{meta.desc}</span>
                                <span className="admin-model-id-mono">{m.name}</span>
                              </div>
                              <button
                                type="button"
                                role="switch"
                                aria-checked={!isOff}
                                aria-label={`Turn ${meta.label} ${isOff ? 'on' : 'off'}`}
                                className={`admin-toggle admin-toggle-sm ${!isOff ? 'admin-toggle-on' : ''}`}
                                onClick={() => toggleSingleModel(key)}
                                title={isOff ? `Enable ${meta.label}` : `Pause ${meta.label}`}
                              >
                                <span className="admin-toggle-knob" />
                              </button>
                            </div>
                          );
                        })}
                        {filteredBuiltinModels.length === 0 && (
                          <div className="admin-empty" style={{ padding: '24px 10px' }}>
                            <p style={{ margin: 0, fontSize: '13px' }}>No models match "{modelSearch}".</p>
                          </div>
                        )}
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

                      <div className="admin-form-grid admin-form-grid-top">
                        <label>
                          Target model
                          <select
                            value={builtinTestModel}
                            onChange={e => setBuiltinTestModel(e.target.value)}
                            aria-label="Target model"
                          >
                            <option value="">Select an integrated model…</option>
                            {CLIENT_SELECTABLE_MODELS.map(m => {
                              const meta = BUILTIN_MODEL_META[m.name];
                              const label = meta ? `${meta.label} (${meta.badge})` : `${m.name} (${m.provider})`;
                              return (
                                <option key={`${m.provider}:${m.name}`} value={m.name}>
                                  {label}
                                </option>
                              );
                            })}
                          </select>
                        </label>
                      </div>

                      {/* Quick Prompt Chips */}
                      <span className="admin-chips-label">Quick benchmark prompts:</span>
                      <div className="admin-preset-chips">
                        {BENCHMARK_PROMPTS.map(p => (
                          <button
                            key={p.label}
                            type="button"
                            className="admin-chip-btn"
                            onClick={() => setBuiltinTestPrompt(p.text)}
                          >
                            {p.label}
                          </button>
                        ))}
                      </div>

                      <label className="admin-test-label">
                        Prompt
                        <textarea
                          value={builtinTestPrompt}
                          onChange={e => setBuiltinTestPrompt(e.target.value)}
                          placeholder="Describe a component or logic to benchmark…"
                          rows={3}
                        />
                      </label>

                      <button
                        type="button"
                        className="admin-btn admin-btn-primary admin-btn-start"
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
                        <div className="admin-playground-disabled">
                          <span>Turn on integrated models to run playground tests.</span>
                          <button
                            type="button"
                            className="admin-btn admin-btn-primary admin-btn-sm"
                            onClick={toggleIntegrated}
                          >
                            Turn on
                          </button>
                        </div>
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

                      {/* Quick Presets */}
                      <span className="admin-chips-label admin-chips-label-spaced">Fill from provider preset:</span>
                      <div className="admin-preset-chips">
                        {PRESET_PROVIDERS.map(preset => (
                          <button
                            key={preset.name}
                            type="button"
                            className="admin-chip-btn"
                            onClick={() => applyProviderPreset(preset)}
                          >
                            <Zap size={11} aria-hidden="true" /> {preset.name}
                          </button>
                        ))}
                      </div>

                      {/* Form with autofill prevention */}
                      <form
                        onSubmit={e => { e.preventDefault(); void saveModel(); }}
                        autoComplete="off"
                        style={{ display: 'contents' }}
                      >
                        <div className="admin-form-grid">
                          <label>
                            Base URL
                            <input
                              type="url"
                              name="bh_custom_model_endpoint_url"
                              autoComplete="off"
                              value={modelForm.baseUrl}
                              onChange={e => setModelForm(f => ({ ...f, baseUrl: e.target.value }))}
                              placeholder="https://api.openai.com/v1"
                            />
                          </label>
                          <label>
                            API key
                            <div className="admin-input-with-action">
                              <input
                                type={showApiKey ? 'text' : 'password'}
                                name="bh_custom_model_secret_key"
                                autoComplete="new-password"
                                value={modelForm.apiKey}
                                onChange={e => setModelForm(f => ({ ...f, apiKey: e.target.value }))}
                                placeholder="sk-…"
                              />
                              <button
                                type="button"
                                className="admin-input-inline-btn"
                                onClick={() => setShowApiKey(v => !v)}
                                title={showApiKey ? 'Hide API key' : 'Show API key'}
                                aria-label={showApiKey ? 'Hide API key' : 'Show API key'}
                              >
                                {showApiKey ? <EyeOff size={14} /> : <Eye size={14} />}
                              </button>
                            </div>
                          </label>
                        </div>

                        {/* Per-model entries: multiple models can share one base URL + API key */}
                        <div className="admin-model-entries">
                          <p className="admin-model-entries-label">Models on this endpoint</p>
                          {modelForm.entries.map((entry, idx) => (
                            <div key={idx} className="admin-model-entry-row">
                              <input
                                type="text"
                                name={`bh_model_name_${idx}`}
                                autoComplete="off"
                                value={entry.name}
                                onChange={e => setModelForm(f => ({ ...f, entries: f.entries.map((en, i) => i === idx ? { ...en, name: e.target.value } : en) }))}
                                placeholder="Display name (e.g. GPT-4o)"
                              />
                              <input
                                type="text"
                                name={`bh_model_id_${idx}`}
                                autoComplete="off"
                                value={entry.modelId}
                                onChange={e => setModelForm(f => ({ ...f, entries: f.entries.map((en, i) => i === idx ? { ...en, modelId: e.target.value } : en) }))}
                                placeholder="Model ID (e.g. gpt-4o)"
                              />
                              {modelForm.entries.length > 1 && (
                                <button
                                  type="button"
                                  className="admin-input-inline-btn"
                                  onClick={() => setModelForm(f => ({ ...f, entries: f.entries.filter((_, i) => i !== idx) }))}
                                  title="Remove this model"
                                  aria-label="Remove model entry"
                                >
                                  <X size={13} />
                                </button>
                              )}
                            </div>
                          ))}
                          <button
                            type="button"
                            className="admin-btn-ghost"
                            onClick={() => setModelForm(f => ({ ...f, entries: [...f.entries, { name: '', modelId: '' }] }))}
                          >
                            <Plus size={13} aria-hidden="true" /> Add another model
                          </button>
                        </div>

                        <button
                          type="button"
                          className="admin-btn admin-btn-primary admin-btn-start"
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
                      </form>
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
                                  <div className="admin-model-cell-name">
                                    <strong>{m.name}</strong>
                                    <span className="admin-provider-pill admin-provider-custom">Custom</span>
                                  </div>
                                </td>
                                <td>
                                  <div className="admin-model-cell-url">
                                    <span className="admin-mono">{m.baseUrl}</span>
                                    <button
                                      type="button"
                                      className="admin-copy-btn"
                                      onClick={() => {
                                        void copyToClipboard(m.baseUrl);
                                        setCopiedModelUrl(m.id);
                                        setTimeout(() => setCopiedModelUrl(null), 2000);
                                      }}
                                      title={copiedModelUrl === m.id ? 'Copied URL!' : 'Copy base URL'}
                                      aria-label={`Copy URL for ${m.name}`}
                                    >
                                      {copiedModelUrl === m.id ? <Check size={12} /> : <Copy size={12} />}
                                    </button>
                                  </div>
                                </td>
                                <td className="admin-mono">{m.modelId}</td>
                                <td className="td-actions">
                                  <div className="admin-actions">
                                    <button
                                      type="button"
                                      className={`admin-action-pill-btn ${disabledModels.includes(m.id) ? '' : 'active-btn'}`}
                                      title={disabledModels.includes(m.id) ? `Enable ${m.name}` : `Disable ${m.name}`}
                                      aria-label={disabledModels.includes(m.id) ? `Enable ${m.name}` : `Disable ${m.name}`}
                                      onClick={() => void toggleSingleModel(m.id)}
                                    >
                                      <Power size={12} aria-hidden="true" />
                                      <span>{disabledModels.includes(m.id) ? 'Off' : 'On'}</span>
                                    </button>
                                    <button
                                      type="button"
                                      className="admin-action-pill-btn test-btn"
                                      title={`Test ${m.name}`}
                                      aria-label={`Test ${m.name}`}
                                      onClick={() => { setTestModelId(m.id); setTestOutput(''); }}
                                    >
                                      <Play size={12} aria-hidden="true" />
                                      <span>Test</span>
                                    </button>
                                    <button
                                      type="button"
                                      className="admin-action-pill-btn danger-btn"
                                      title={`Remove ${m.name}`}
                                      aria-label={`Remove ${m.name}`}
                                      onClick={() => deleteModel(m.id)}
                                      disabled={working}
                                    >
                                      <Trash2 size={12} aria-hidden="true" />
                                      <span>Remove</span>
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                            {models.length === 0 && (
                              <tr>
                                <td colSpan={4} className="admin-empty">
                                  No custom models configured yet. Connect one using the form above.
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
                        <div className="admin-card admin-card-full" aria-label={`Test ${model.name}`}>
                          <div className="admin-card-head">
                            <span className="admin-stat-icon icon-play">
                              <Play size={17} aria-hidden="true" />
                            </span>
                            <div>
                              <h2>Test {model.name}</h2>
                              <p>Direct unthrottled streaming generation test against custom endpoint.</p>
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
                          <div className="admin-playground-actions">
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
                            <button
                              type="button"
                              className="admin-btn admin-btn-ghost"
                              onClick={() => { setTestModelId(null); setTestOutput(''); }}
                            >
                              Close playground
                            </button>
                          </div>
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
                {(tab === 'accounts' || tab === 'projects') && (
                  <div className="admin-hint admin-warning-box" role="note">
                    <AlertTriangle size={15} className="admin-warning-icon" aria-hidden="true" />
                    <span>
                      Deleting a project erases it completely — app files, backend, backups, and the registry entry.
                      Deleting an account removes the account and all of its projects. Neither can be undone.
                    </span>
                  </div>
                )}
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
                      href={`https://${previewProject.id}.apps.brainhalf.com`}
                      target="_blank"
                      rel="noreferrer"
                      className="admin-icon-btn"
                      title="Open live app in new window"
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
                  allow={PREVIEW_ALLOW}
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
