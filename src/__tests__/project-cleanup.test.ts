import { describe, expect, it, vi } from 'vitest';
import { ProjectCleanup } from '../lib/project-cleanup';
import { sqliteStorage } from './helpers/storage';

describe('durable project erasure', () => {
  it('persists progress and retries failed backups after object reconstruction', async () => {
    const storage = sqliteStorage(); storage.setAlarm = vi.fn(async () => {});
    const deps = { removeRuntime: vi.fn(async () => {}), eraseAgent: vi.fn(async () => {}), removeBackups: vi.fn().mockRejectedValueOnce(new Error('R2 unavailable')).mockResolvedValue(undefined) };
    let cleanup = new ProjectCleanup(storage, deps); cleanup.enqueue('project', 'owner');
    await cleanup.run();
    expect(cleanup.list('owner')[0]).toMatchObject({ step: 2, attempts: 1, completed_at: null });
    expect(cleanup.list('other')).toEqual([]);
    storage.sql.exec('UPDATE project_cleanup SET next_at=0');
    cleanup = new ProjectCleanup(storage, deps); await cleanup.run();
    expect(deps.removeRuntime).toHaveBeenCalledOnce(); expect(deps.eraseAgent).toHaveBeenCalledOnce();
    expect(deps.removeBackups).toHaveBeenCalledTimes(2);
    expect(cleanup.list('owner')[0].completed_at).toEqual(expect.any(Number));
    expect(storage.setAlarm).toHaveBeenCalled();
  });
  it('never acknowledges completion or erases source while runtime cleanup fails', async () => {
    const storage = sqliteStorage(); const deps = { removeRuntime: vi.fn(async () => { throw new Error('Still stopping'); }), eraseAgent: vi.fn(), removeBackups: vi.fn() };
    const cleanup = new ProjectCleanup(storage, deps); cleanup.enqueue('project', 'owner'); cleanup.enqueue('project', 'owner'); await cleanup.run();
    expect(cleanup.list('owner')).toHaveLength(1); expect(cleanup.list('owner')[0].completed_at).toBeNull();
    expect(deps.eraseAgent).not.toHaveBeenCalled(); expect(deps.removeBackups).not.toHaveBeenCalled();
  });
});
