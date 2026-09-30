import { describe, expect, it } from 'vitest';
import { cleanupJobStatus, sortCleanupStatus, type CleanupStatus } from '../components/DashboardPage';

/** L13: the dashboard polls deletion cleanup status and must render it. */
function job(partial: Partial<CleanupStatus> & { project_id: string }): CleanupStatus {
  return { step: 0, attempts: 0, next_at: 1, completed_at: null, ...partial };
}

describe('cleanupJobStatus', () => {
  it('reports a pending cleanup in plain language', () => {
    expect(cleanupJobStatus(job({ project_id: 'a' }))).toBe('Finishing deletion…');
  });

  it('reports a finished cleanup in plain language', () => {
    expect(cleanupJobStatus(job({ project_id: 'a', completed_at: Date.now() }))).toBe('Deletion finished');
  });
});

describe('sortCleanupStatus', () => {
  it('lists pending cleanups before completed ones', () => {
    const done = job({ project_id: 'done', completed_at: 200 });
    const pending = job({ project_id: 'pending', next_at: 100 });
    expect(sortCleanupStatus([done, pending]).map(j => j.project_id)).toEqual(['pending', 'done']);
  });

  it('orders completed cleanups most-recent-first', () => {
    const older = job({ project_id: 'older', completed_at: 100 });
    const newer = job({ project_id: 'newer', completed_at: 300 });
    expect(sortCleanupStatus([older, newer]).map(j => j.project_id)).toEqual(['newer', 'older']);
  });
});
