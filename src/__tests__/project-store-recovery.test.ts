import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('Persistence recovery', () => {
  let cached: Record<string, string>;
  let rejectWrites: boolean;

  beforeEach(() => {
    vi.resetModules();
    cached = {};
    rejectWrites = false;
    vi.stubGlobal('window', undefined);
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => cached[key] ?? null,
      setItem: (key: string, value: string) => {
        if (rejectWrites) throw new Error('QuotaExceededError');
        cached[key] = value;
      },
      removeItem: (key: string) => { delete cached[key]; },
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('removes stale file cache when a newer write exceeds localStorage quota', async () => {
    const store = await import('../lib/project-store');
    store.setProjectAccount('test-account');
    store.saveProjectFiles('quota', { '/src/App.jsx': 'old' });
    rejectWrites = true;
    store.saveProjectFiles('quota', { '/src/App.jsx': 'new' });
    expect(cached[store.projectStorageKey('brainhalf_files_quota')]).toBeUndefined();
    expect(store.getProjectFiles('quota')).toEqual({ '/src/App.jsx': 'new' });
  });

  it('removes stale history cache when a newer write exceeds localStorage quota', async () => {
    const store = await import('../lib/project-store');
    store.setProjectAccount('test-account');
    store.saveProjectMessages('quota', [{ role: 'user', content: 'old' }]);
    rejectWrites = true;
    store.saveProjectMessages('quota', [{ role: 'user', content: 'new' }]);
    expect(cached[store.projectStorageKey('brainhalf_messages_quota')]).toBeUndefined();
    expect(store.getProjectMessages('quota')).toEqual([{ role: 'user', content: 'new' }]);
  });

  it('keeps an edit made while asynchronous hydration is pending', async () => {
    const store = await import('../lib/project-store');
    store.setProjectAccount('test-account');
    cached[store.projectStorageKey('brainhalf_files_race')] = JSON.stringify({ '/src/App.jsx': 'old' });
    const hydration = store.getProjectFilesAsync('race');
    store.saveProjectFiles('race', { '/src/App.jsx': 'edited' });
    expect(await hydration).toEqual({ '/src/App.jsx': 'edited' });
  });

  it('does not resurrect a project deleted during hydration', async () => {
    const store = await import('../lib/project-store');
    store.setProjectAccount('test-account');
    cached[store.projectStorageKey('brainhalf_files_deleted')] = JSON.stringify({ '/src/App.jsx': 'old' });
    const hydration = store.getProjectFilesAsync('deleted');
    store.deleteProjectFiles('deleted');
    expect(await hydration).toBeNull();
  });
});
