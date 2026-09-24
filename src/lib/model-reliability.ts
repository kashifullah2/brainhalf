export type ModelOutcome = 'success' | 'failure';

export type ModelReliabilityStats = {
  attempts: number;
  successes: number;
  failures: number;
  lastUsedAt?: number;
  lastError?: string;
};

const RELIABILITY_KEY = 'brainhalf_model_reliability_v2';

type ReliabilityStore = Record<string, ModelReliabilityStats>;

function scopedKey(scope?: string): string {
  const normalized = String(scope || 'guest').trim().toLowerCase().replace(/[^a-z0-9:_-]+/g, '_');
  return `${RELIABILITY_KEY}:${normalized || 'guest'}`;
}

function readStore(scope?: string): ReliabilityStore {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(scopedKey(scope));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeStore(store: ReliabilityStore, scope?: string): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(scopedKey(scope), JSON.stringify(store));
  } catch {
    // ignore quota/transient storage errors
  }
}

export function getModelReliabilityStats(modelId: string, scope?: string): ModelReliabilityStats {
  const store = readStore(scope);
  return store[modelId] || { attempts: 0, successes: 0, failures: 0 };
}

export function recordModelOutcome(modelId: string, outcome: ModelOutcome, error?: string, scope?: string): void {
  if (!modelId) return;
  const store = readStore(scope);
  const current = store[modelId] || { attempts: 0, successes: 0, failures: 0 };
  const next: ModelReliabilityStats = {
    attempts: current.attempts + 1,
    successes: current.successes + (outcome === 'success' ? 1 : 0),
    failures: current.failures + (outcome === 'failure' ? 1 : 0),
    lastUsedAt: Date.now(),
    lastError: outcome === 'failure' ? (error || current.lastError) : undefined,
  };
  store[modelId] = next;
  writeStore(store, scope);
}

export function getModelReliabilityScore(modelId: string, scope?: string): number {
  const stats = getModelReliabilityStats(modelId, scope);
  if (stats.attempts === 0) return 0.5;
  const successRate = stats.successes / Math.max(1, stats.attempts);
  const confidenceBoost = Math.min(0.2, Math.log10(stats.attempts + 1) * 0.1);
  return Math.max(0, Math.min(1, successRate + confidenceBoost));
}

export function rankModelsByReliability<T extends { id: string; name?: string }>(models: readonly T[], scope?: string): T[] {
  return [...models].sort((left, right) => {
    const leftScore = getModelReliabilityScore(left.id, scope);
    const rightScore = getModelReliabilityScore(right.id, scope);
    if (rightScore !== leftScore) return rightScore - leftScore;
    return String(left.name || left.id).localeCompare(String(right.name || right.id));
  });
}

export function formatModelReliability(modelId: string, scope?: string): string {
  const stats = getModelReliabilityStats(modelId, scope);
  if (stats.attempts === 0) return 'No runs yet';
  const rate = Math.round((stats.successes / Math.max(1, stats.attempts)) * 100);
  return `${rate}% responses completed (${stats.successes}/${stats.attempts}); app verification is separate`;
}
