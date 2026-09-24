import { projectStorageKey } from './project-store';
import { normalizeReliabilityControls } from './generation-controls';
import type { ReliabilityControls } from './generation-controls';
export type { ReliabilityControls } from './generation-controls';

export interface PromptVersion {
  id: string;
  prompt: string;
  model: string;
  createdAt: number;
  tags: string[];
}

export interface OnboardingState {
  createdFirstProject: boolean;
  sentFirstPrompt: boolean;
  publishedFirstRelease: boolean;
  invitedTeammate: boolean;
  connectedService: boolean;
}

export interface UsageEvent {
  id: string;
  day: string;
  type: 'prompt' | 'publish' | 'verification';
  model?: string;
  tokensReserved?: number;
  createdAt: number;
}

const nowDay = () => new Date().toISOString().slice(0, 10);
const rid = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(projectStorageKey(key));
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return (parsed ?? fallback) as T;
  } catch {
    return fallback;
  }
}

function write<T>(key: string, value: T): void {
  try {
    localStorage.setItem(projectStorageKey(key), JSON.stringify(value));
  } catch {}
}

export function getPromptVersions(projectId: string): PromptVersion[] {
  return read<PromptVersion[]>(`growth:prompts:${projectId}`, []);
}

export function savePromptVersion(projectId: string, prompt: string, model: string, tags: string[] = []): PromptVersion[] {
  const cleaned = prompt.trim();
  if (!cleaned) return getPromptVersions(projectId);
  const versions = getPromptVersions(projectId);
  const next: PromptVersion = { id: rid('pv'), prompt: cleaned, model, createdAt: Date.now(), tags };
  const merged = [next, ...versions].slice(0, 80);
  write(`growth:prompts:${projectId}`, merged);
  return merged;
}

export function removePromptVersion(projectId: string, versionId: string): PromptVersion[] {
  const versions = getPromptVersions(projectId).filter(item => item.id !== versionId);
  write(`growth:prompts:${projectId}`, versions);
  return versions;
}

export function getReliabilityControls(projectId: string): ReliabilityControls {
  return normalizeReliabilityControls(read<unknown>(`growth:reliability:${projectId}`, null));
}

export function setReliabilityControls(projectId: string, patch: Partial<ReliabilityControls>): ReliabilityControls {
  const next = { ...getReliabilityControls(projectId), ...patch };
  const normalized = normalizeReliabilityControls(next);
  write(`growth:reliability:${projectId}`, normalized);
  return normalized;
}

export function getOnboardingState(projectId: string): OnboardingState {
  return read<OnboardingState>(`growth:onboarding:${projectId}`, {
    createdFirstProject: true,
    sentFirstPrompt: false,
    publishedFirstRelease: false,
    invitedTeammate: false,
    connectedService: false,
  });
}

export function setOnboardingState(projectId: string, patch: Partial<OnboardingState>): OnboardingState {
  const next = { ...getOnboardingState(projectId), ...patch };
  write(`growth:onboarding:${projectId}`, next);
  return next;
}

export function pushUsageEvent(projectId: string, event: Omit<UsageEvent, 'id' | 'day' | 'createdAt'>): UsageEvent[] {
  const existing = read<UsageEvent[]>(`growth:usage:${projectId}`, []);
  const next: UsageEvent = { id: rid('ue'), day: nowDay(), createdAt: Date.now(), ...event };
  const merged = [next, ...existing].slice(0, 500);
  write(`growth:usage:${projectId}`, merged);
  return merged;
}

export function getUsageEvents(projectId: string): UsageEvent[] {
  return read<UsageEvent[]>(`growth:usage:${projectId}`, []);
}

export function usageByDay(projectId: string, days = 7): Array<{ day: string; prompts: number; publishes: number; verifications: number; tokensReserved: number }> {
  const rows = getUsageEvents(projectId);
  const map = new Map<string, { day: string; prompts: number; publishes: number; verifications: number; tokensReserved: number }>();
  for (const row of rows) {
    if (!map.has(row.day)) map.set(row.day, { day: row.day, prompts: 0, publishes: 0, verifications: 0, tokensReserved: 0 });
    const bucket = map.get(row.day)!;
    if (row.type === 'prompt') bucket.prompts++;
    if (row.type === 'publish') bucket.publishes++;
    if (row.type === 'verification') bucket.verifications++;
    bucket.tokensReserved += row.tokensReserved || 0;
  }
  return [...map.values()].sort((a, b) => b.day.localeCompare(a.day)).slice(0, days).reverse();
}
