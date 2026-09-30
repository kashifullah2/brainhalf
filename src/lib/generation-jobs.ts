/**
 * Durable record of app generations for resumability.
 *
 * The ChatAgent Durable Object already saves every generated file to
 * `project_files` as it streams, but nothing durable recorded *which* files
 * belonged to an in-flight generation. When a stream died mid-way (the
 * "No response received" case), the remaining work was lost and the user had
 * to start over from scratch.
 *
 * A generation job tracks the prompt, the model, the files completed so far,
 * and the terminal state. A failed or interrupted job can be resumed: the
 * resume prompt tells the model which files already exist so it writes only
 * the missing ones.
 *
 * Safety rules:
 * - Only interruptions are resumable (stream death, timeout, disconnect).
 *   Hard failures (auth, quota, billing, unknown model) are never resumed.
 * - Resume depth is capped (MAX_RESUMES) so a poisoned prompt cannot burn
 *   the AI budget in a loop.
 * - One job per project is resumable at a time: the newest failed/interrupted
 *   job. Older ones are superseded.
 */

type Query = (sql: string, ...params: (string | number | null)[]) => Array<Record<string, any>>;

export type GenerationJobStatus = 'running' | 'failed' | 'interrupted' | 'complete';

export interface GenerationJob {
  id: string;
  prompt: string;
  model: string;
  status: GenerationJobStatus;
  completedFiles: string[];
  error: string | null;
  resumeCount: number;
  parentJobId: string | null;
  startedAt: number;
  updatedAt: number;
}

/** How many times one job chain may be resumed before it must start over. */
export const MAX_RESUMES = 3;

/** Cap on stored jobs per project; older rows are pruned. */
export const MAX_STORED_JOBS = 50;

const isStatus = (value: unknown): value is GenerationJobStatus =>
  value === 'running' || value === 'failed' || value === 'interrupted' || value === 'complete';

function parseFiles(raw: unknown): string[] {
  if (typeof raw !== 'string') return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === 'string') : [];
  } catch { return []; }
}

function rowToJob(row: Record<string, any>): GenerationJob {
  return {
    id: String(row.id),
    prompt: String(row.prompt ?? ''),
    model: String(row.model ?? ''),
    status: isStatus(row.status) ? row.status : 'failed',
    completedFiles: parseFiles(row.completed_files),
    error: typeof row.error === 'string' ? row.error : null,
    resumeCount: Number(row.resume_count ?? 0),
    parentJobId: typeof row.parent_job_id === 'string' ? row.parent_job_id : null,
    startedAt: Number(row.started_at ?? 0),
    updatedAt: Number(row.updated_at ?? 0),
  };
}

export class GenerationJobs {
  constructor(private query: Query) {}

  create(input: { id: string; prompt: string; model: string; parentJobId?: string | null; resumeCount?: number; initialFiles?: string[] }): GenerationJob {
    const now = Date.now();
    const initial = [...new Set((input.initialFiles ?? []).filter(p => typeof p === 'string'))];
    this.query(
      `INSERT INTO generation_jobs (id, prompt, model, status, completed_files, error, resume_count, parent_job_id, started_at, updated_at)
       VALUES (?, ?, ?, 'running', ?, NULL, ?, ?, ?, ?)`,
      input.id, input.prompt, input.model, JSON.stringify(initial), input.resumeCount ?? 0, input.parentJobId ?? null, now, now,
    );
    // A new attempt supersedes older interrupted jobs — only the latest build
    // is ever resumable. The resume parent is kept so the chain stays intact.
    if (input.parentJobId) {
      this.query(`DELETE FROM generation_jobs WHERE id != ? AND id != ? AND status IN ('failed','interrupted')`, input.id, input.parentJobId);
    } else {
      this.query(`DELETE FROM generation_jobs WHERE id != ? AND status IN ('failed','interrupted')`, input.id);
    }
    this.query(
      `DELETE FROM generation_jobs WHERE id NOT IN (SELECT id FROM generation_jobs ORDER BY updated_at DESC LIMIT ?)`,
      MAX_STORED_JOBS,
    );
    const job = this.get(input.id);
    if (!job) throw new Error('Generation job could not be created.');
    return job;
  }

  get(id: string): GenerationJob | null {
    const rows = this.query(`SELECT * FROM generation_jobs WHERE id = ?`, id);
    return rows.length > 0 ? rowToJob(rows[0]) : null;
  }

  /** Record one more file as durably written for this job. Idempotent. */
  markFileComplete(id: string, path: string): void {
    const job = this.get(id);
    if (!job || job.status !== 'running') return;
    if (job.completedFiles.includes(path)) return;
    const next = [...job.completedFiles, path];
    this.query(`UPDATE generation_jobs SET completed_files = ?, updated_at = ? WHERE id = ?`, JSON.stringify(next), Date.now(), id);
  }

  complete(id: string): void {
    this.query(`UPDATE generation_jobs SET status = 'complete', updated_at = ? WHERE id = ? AND status = 'running'`, Date.now(), id);
  }

  /** Terminal failure that must never auto-resume (auth, quota, billing, bad model). */
  fail(id: string, error: string): void {
    this.query(`UPDATE generation_jobs SET status = 'failed', error = ?, updated_at = ? WHERE id = ? AND status = 'running'`, error, Date.now(), id);
  }

  /** Interruption that may be resumed (stream death, timeout, disconnect, eviction). */
  interrupt(id: string, error: string): void {
    this.query(`UPDATE generation_jobs SET status = 'interrupted', error = ?, updated_at = ? WHERE id = ? AND status = 'running'`, error, Date.now(), id);
  }

  /**
   * Jobs that died while marked running but have no live generation behind
   * them (isolate restart, DO eviction, crashed worker). Call on wake/reconnect
   * so they surface as resumable instead of vanishing silently.
   */
  markOrphanedRunning(error: string): number {
    const rows = this.query(`SELECT id FROM generation_jobs WHERE status = 'running'`);
    for (const row of rows) {
      this.query(`UPDATE generation_jobs SET status = 'interrupted', error = ?, updated_at = ? WHERE id = ?`, error, Date.now(), String(row.id));
    }
    return rows.length;
  }

  /** The newest interrupted job that may still be resumed, if any. Hard-failed
   * jobs (auth, quota, billing, concurrency, context-length) are never
   * resumable: retrying them would just hit the same wall. */
  latestResumable(): GenerationJob | null {
    // rowid DESC breaks updated_at ties deterministically: two interrupts in
    // the same millisecond still resolve to the most recently created job.
    const rows = this.query(
      `SELECT * FROM generation_jobs WHERE status = 'interrupted' ORDER BY updated_at DESC, rowid DESC LIMIT 1`,
    );
    if (rows.length === 0) return null;
    const job = rowToJob(rows[0]);
    return job.resumeCount < MAX_RESUMES ? job : null;
  }

  /** True while this job chain still has resume budget left. */
  canResume(job: GenerationJob): boolean {
    return job.status === 'interrupted' && job.resumeCount < MAX_RESUMES;
  }
}
