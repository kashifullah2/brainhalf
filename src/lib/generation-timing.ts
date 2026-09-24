import { projectStorageKey } from './project-store';

export type GenerationMilestone = 'sent' | 'accepted' | 'model' | 'activity' | 'preview';
export interface GenerationTiming {
  id: string;
  startedAt: number;
  elapsed: Partial<Record<GenerationMilestone, number>>;
  outcome?: 'completed' | 'failed' | 'stopped';
  durationMs?: number;
}
const key = (projectId: string) => projectStorageKey(`generation-timing:${projectId}`);
export function getGenerationTimings(projectId: string): GenerationTiming[] {
  try { const rows = JSON.parse(localStorage.getItem(key(projectId)) || '[]'); return Array.isArray(rows) ? rows.filter(row => row && typeof row.id === 'string' && Number.isFinite(row.startedAt) && row.elapsed && typeof row.elapsed === 'object').slice(0, 20) : []; }
  catch { return []; }
}

/** Browser-observed elapsed times; no prompts, source, credentials or server clock arithmetic. */
export class GenerationClock {
  readonly record: GenerationTiming;
  private readonly storageKey: string;
  private readonly start: number;
  constructor(private readonly projectId: string, id: string, private readonly now = () => performance.now()) {
    this.start = now();
    this.storageKey = key(projectId);
    this.record = { id, startedAt: Date.now(), elapsed: {} };
    this.save();
  }
  mark(milestone: GenerationMilestone) {
    if (this.record.elapsed[milestone] !== undefined || (this.record.outcome && milestone !== 'preview')) return;
    if (milestone === 'preview' && (this.record.elapsed.activity === undefined || this.record.outcome === 'failed' || this.record.outcome === 'stopped')) return;
    this.record.elapsed[milestone] = Math.max(0, Math.round(this.now() - this.start));
    this.save();
  }
  finish(outcome: NonNullable<GenerationTiming['outcome']>) {
    if (this.record.outcome) return;
    this.record.outcome = outcome;
    this.record.durationMs = Math.max(0, Math.round(this.now() - this.start));
    this.save();
  }
  private save() {
    if (key(this.projectId) !== this.storageKey) return;
    try { localStorage.setItem(this.storageKey, JSON.stringify([this.record, ...getGenerationTimings(this.projectId).filter(row => row.id !== this.record.id)].slice(0, 20))); }
    catch { /* Diagnostics must never block generation. */ }
  }
}
