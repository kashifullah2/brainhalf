interface CleanupSql { exec(query: string, ...values: (string | number | null)[]): { toArray(): Record<string, unknown>[] } }
interface CleanupStorage { sql: CleanupSql; setAlarm(time: number): Promise<void> }
export interface CleanupJob { project_id: string; user_id: string; step: number; attempts: number; next_at: number; completed_at: number | null }
interface CleanupDependencies {
  removeRuntime(projectId: string, ownerId: string): Promise<void>;
  eraseAgent(projectId: string, ownerId: string): Promise<void>;
  removeBackups(projectId: string): Promise<void>;
}
export class ProjectCleanup {
  constructor(private storage: CleanupStorage, private dependencies: CleanupDependencies) {
    storage.sql.exec('CREATE TABLE IF NOT EXISTS project_cleanup (project_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, step INTEGER NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0, next_at INTEGER NOT NULL, completed_at INTEGER)');
    storage.sql.exec('CREATE INDEX IF NOT EXISTS project_cleanup_due ON project_cleanup(completed_at,next_at)');
  }
  enqueue(projectId: string, ownerId: string) {
    this.storage.sql.exec('INSERT OR IGNORE INTO project_cleanup(project_id,user_id,next_at) VALUES (?,?,?)', projectId, ownerId, Date.now());
  }
  list(ownerId: string): CleanupJob[] {
    return this.storage.sql.exec('SELECT project_id,user_id,step,attempts,next_at,completed_at FROM project_cleanup WHERE user_id=? ORDER BY next_at DESC LIMIT 50', ownerId).toArray() as unknown as CleanupJob[];
  }
  async schedule() {
    const row = this.storage.sql.exec('SELECT MIN(next_at) AS next FROM project_cleanup WHERE completed_at IS NULL').toArray()[0];
    if (typeof row?.next === 'number') await this.storage.setAlarm(Math.max(Date.now() + 100, row.next));
  }
  async run() {
    // Schedule before network I/O: interrupted requests remain retryable.
    await this.schedule();
    const jobs = this.storage.sql.exec('SELECT project_id,user_id,step,attempts,next_at,completed_at FROM project_cleanup WHERE completed_at IS NULL AND next_at<=? ORDER BY next_at LIMIT 5', Date.now()).toArray() as unknown as CleanupJob[];
    for (const job of jobs) {
      try {
        if (job.step === 0) { await this.dependencies.removeRuntime(job.project_id, job.user_id); this.advance(job, 1); }
        if (job.step === 1) { await this.dependencies.eraseAgent(job.project_id, job.user_id); this.advance(job, 2); }
        if (job.step === 2) { await this.dependencies.removeBackups(job.project_id); this.advance(job, 3); }
        this.storage.sql.exec('UPDATE project_cleanup SET completed_at=? WHERE project_id=?', Date.now(), job.project_id);
      } catch {
        this.storage.sql.exec('UPDATE project_cleanup SET attempts=attempts+1,next_at=? WHERE project_id=?', Date.now() + Math.min(3_600_000, 30_000 * 2 ** Math.min(job.attempts, 7)), job.project_id);
      }
    }
    this.storage.sql.exec('DELETE FROM project_cleanup WHERE completed_at<?', Date.now() - 30 * 86400_000);
    await this.schedule();
  }
  private advance(job: CleanupJob, step: number) { this.storage.sql.exec('UPDATE project_cleanup SET step=? WHERE project_id=?', step, job.project_id); job.step = step; }
}
