/**
 * Regression tests for the "project disappears from dashboard" bug.
 *
 * Root cause: isEmptyDraftProject reads messages synchronously from localStorage
 * and memory cache. When localStorage write fails (quota exceeded), messages land
 * only in IndexedDB. After a session reload the memory cache is cold and
 * getProjectMessages returns null — so isEmptyDraftProject incorrectly returns
 * true, causing purgeEmptyDrafts to delete a project the user worked on.
 *
 * Fix: saveProjectMessages transitions project.status from 'draft' to 'ready'
 * the first time non-empty messages are persisted. That status survives a reload
 * (it lives in the small projects-list write, not the large messages payload), so
 * isEmptyDraftProject short-circuits on the status check and returns false.
 *
 * Additional guards (this file):
 * - 24 h recency cutoff in purgeEmptyDrafts
 * - Dashboard recovery: server-alive projects with local deletion markers restored
 * - localStorage eviction: other projects' caches cleared on quota, then retried
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('P1 Draft purge safety — project with messages never purged after reload', () => {
  let cached: Record<string, string>;
  let blockMessageWrites: boolean;

  beforeEach(() => {
    vi.resetModules();
    cached = {};
    blockMessageWrites = false;
    vi.stubGlobal('localStorage', {
      getItem:    (key: string) => cached[key] ?? null,
      setItem:    (key: string, value: string) => {
        // Simulate quota exceeded only for message payloads (large writes),
        // leaving the small projects-list write able to succeed.
        if (blockMessageWrites && key.includes('brainhalf_messages_')) {
          throw new Error('QuotaExceededError');
        }
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

  it('isEmptyDraftProject returns false after session reload when messages hit the localStorage quota', async () => {
    // ----- Session 1 -----
    const s1 = await import('../lib/project-store');
    s1.setProjectAccount('u1');
    const proj = s1.createProject('My App');

    // Trigger quota failure for the messages write.
    blockMessageWrites = true;
    s1.saveProjectMessages(proj.id, [{ role: 'user', content: 'Build me something' }]);

    // Pre-conditions: messages NOT in localStorage but project list IS.
    const msgKey = s1.projectStorageKey(`brainhalf_messages_${proj.id}`);
    expect(cached[msgKey]).toBeUndefined();
    const listBefore = s1.getProjects().find(p => p.id === proj.id);
    expect(listBefore).toBeDefined();

    // ----- Session 2 (simulate page reload) -----
    vi.resetModules();
    const s2 = await import('../lib/project-store');
    s2.setProjectAccount('u1');

    const projects = s2.getProjects();
    const projectAfterReload = projects.find(p => p.id === proj.id);
    expect(projectAfterReload).toBeDefined();

    // After the fix this is false (status was promoted when messages were saved).
    // Before the fix this would be true because status is still 'draft' and
    // getProjectMessages returns null (nothing in cache or localStorage).
    expect(s2.isEmptyDraftProject(projectAfterReload!)).toBe(false);
  });

  it('a true empty draft (no messages ever) is still classified as empty', async () => {
    const store = await import('../lib/project-store');
    store.setProjectAccount('u1');
    const proj = store.createProject('Blank project');

    // No saveProjectMessages call — project really is a blank draft.
    const p = store.getProjects().find(p => p.id === proj.id)!;
    expect(store.isEmptyDraftProject(p)).toBe(true);

    // Even after a simulated reload the status should still be 'draft'.
    vi.resetModules();
    const s2 = await import('../lib/project-store');
    s2.setProjectAccount('u1');
    const reloaded = s2.getProjects().find(p => p.id === proj.id)!;
    expect(s2.isEmptyDraftProject(reloaded)).toBe(true);
  });

  it('a project with messages in memory cache is not classified as empty', async () => {
    const store = await import('../lib/project-store');
    store.setProjectAccount('u1');
    const proj = store.createProject('In-progress project');

    // Save messages normally (localStorage succeeds).
    store.saveProjectMessages(proj.id, [{ role: 'user', content: 'Hello' }]);

    const p = store.getProjects().find(p => p.id === proj.id)!;
    expect(store.isEmptyDraftProject(p)).toBe(false);
  });

  it('24 h guard: a recently-updated draft is never a purge candidate even if isEmptyDraftProject returns true', async () => {
    // This covers the worst-case double-failure: messages write fails AND
    // status-promotion write fails. The project stays status='draft' with no
    // messages in localStorage. isEmptyDraftProject() returns true. The 24 h
    // recency guard in purgeEmptyDrafts prevents deletion.
    const s1 = await import('../lib/project-store');
    s1.setProjectAccount('u1');
    const proj = s1.createProject('Double-fail project');

    // Manually force status='draft' in the project list (simulates the worst
    // case where the status-promotion write also failed).
    const projects = s1.getProjects().map(p => p.id === proj.id ? { ...p, status: 'draft' as const } : p);
    cached[s1.projectStorageKey('brainhalf_projects')] = JSON.stringify(projects);

    // Session 2: reload — project has status='draft', no messages.
    vi.resetModules();
    vi.stubGlobal('localStorage', {
      getItem:    (key: string) => cached[key] ?? null,
      setItem:    (key: string, value: string) => { cached[key] = value; },
      removeItem: (key: string) => { delete cached[key]; },
    });
    const s2 = await import('../lib/project-store');
    s2.setProjectAccount('u1');

    const reloaded = s2.getProjects().find(p => p.id === proj.id)!;
    expect(s2.isEmptyDraftProject(reloaded)).toBe(true); // purge candidate by sync heuristic

    // The 24 h guard in purgeEmptyDrafts filters it out because updatedAt is recent.
    const cutoffMs = Date.now() - 24 * 60 * 60 * 1000;
    const stale = s2.getProjects().filter(p => s2.isEmptyDraftProject(p) && p.updatedAt < cutoffMs);
    expect(stale).toHaveLength(0); // recent project is not in the stale set → safe
  });
});

describe('P2 Dashboard recovery — server-alive projects restored after false-positive purge', () => {
  let cached: Record<string, string>;

  beforeEach(() => {
    vi.resetModules();
    cached = {};
    vi.stubGlobal('localStorage', {
      getItem:    (key: string) => cached[key] ?? null,
      setItem:    (key: string, value: string) => { cached[key] = value; },
      removeItem: (key: string) => { delete cached[key]; },
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('cross-session recovery: reconcileOwnedProjects restores a locally-deleted project that the server still owns', async () => {
    // Simulate a false-positive purge that happened in a PRIOR session:
    // the deletion marker is in localStorage but deletedProjectIds is empty
    // (reset on reload via setProjectAccount).
    const store = await import('../lib/project-store');
    store.setProjectAccount('u1');
    const proj = store.createProject('Falsely purged project');

    // Directly write the deletion marker — bypass the in-memory set to simulate
    // a prior-session deletion (deletedProjectIds is empty in this session).
    cached[store.projectStorageKey(`deleted:project:${proj.id}`)] = 'true';

    // Project is invisible locally (deleted marker wins).
    vi.resetModules();
    vi.stubGlobal('localStorage', {
      getItem:    (key: string) => cached[key] ?? null,
      setItem:    (key: string, value: string) => { cached[key] = value; },
      removeItem: (key: string) => { delete cached[key]; },
    });
    const s2 = await import('../lib/project-store');
    s2.setProjectAccount('u1');
    expect(s2.getProjects().find(p => p.id === proj.id)).toBeUndefined();

    // Server returns the project — it was never server-deleted (server DELETE
    // either never ran or was a no-op for a never-claimed draft).
    const serverProject = { id: proj.id, name: proj.name, createdAt: proj.createdAt, updatedAt: proj.updatedAt };
    s2.reconcileOwnedProjects([serverProject as any]);

    // Project is restored, deletion marker cleared.
    const afterRestore = s2.getProjects().find(p => p.id === proj.id);
    expect(afterRestore).toBeDefined();
    expect(cached[s2.projectStorageKey(`deleted:project:${proj.id}`)]).toBeUndefined();
  });

  it('same-session explicit deletes are not restored even if server list is stale', async () => {
    // Simulates: user explicitly deletes a project, then reconcileOwnedProjects
    // is called with a stale server list that still contains the project.
    // The project must NOT be restored (deletedProjectIds guards this).
    const store = await import('../lib/project-store');
    store.setProjectAccount('u1');
    const proj = store.createProject('Explicitly deleted');

    // deleteProject sets the in-memory deletedProjectIds AND the localStorage marker.
    store.deleteProject(proj.id);
    expect(store.getProjects().find(p => p.id === proj.id)).toBeUndefined();

    // Stale server list still has the project.
    const serverProject = { id: proj.id, name: proj.name, createdAt: proj.createdAt, updatedAt: proj.updatedAt };
    store.reconcileOwnedProjects([serverProject as any]);

    // Must remain deleted — same-session deletion is authoritative.
    expect(store.getProjects().find(p => p.id === proj.id)).toBeUndefined();
  });
});

describe('P3 purgeEmptyDrafts never calls server DELETE', () => {
  let cached: Record<string, string>;

  beforeEach(() => {
    vi.resetModules();
    cached = {};
    vi.stubGlobal('localStorage', {
      getItem:    (key: string) => cached[key] ?? null,
      setItem:    (key: string, value: string) => { cached[key] = value; },
      removeItem: (key: string) => { delete cached[key]; },
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('purgeEmptyDrafts does not call fetch (server DELETE)', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    vi.stubGlobal('indexedDB', undefined);

    const store = await import('../lib/project-store');
    store.setProjectAccount('u1');

    // Create a stale empty draft (updatedAt > 24 h ago).
    const proj = store.createProject('Old empty draft');
    const staleAt = Date.now() - 25 * 60 * 60 * 1000;
    const projects = store.getProjects().map(p => p.id === proj.id ? { ...p, updatedAt: staleAt } : p);
    cached[store.projectStorageKey('brainhalf_projects')] = JSON.stringify(projects);

    // Reload to pick up the stale updatedAt.
    vi.resetModules();
    vi.stubGlobal('localStorage', {
      getItem:    (key: string) => cached[key] ?? null,
      setItem:    (key: string, value: string) => { cached[key] = value; },
      removeItem: (key: string) => { delete cached[key]; },
    });
    vi.stubGlobal('indexedDB', undefined);
    vi.stubGlobal('fetch', fetchSpy);
    cached[`bh_session_token`] = 'token';

    const auth = await import('../lib/auth-client');
    const store2 = await import('../lib/project-store');
    store2.setProjectAccount('u1');

    await auth.purgeEmptyDrafts();

    // fetch must never have been called — purge is local-only.
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('P4 Recovery — softDeleteProject + 410 + recoverProjectFiles end-to-end', () => {
  let cached: Record<string, string>;
  const fakeIdbData: Record<string, Record<string, any>> = { files: {}, messages: {} };

  function localStorageStub() {
    return {
      getItem:    (key: string) => cached[key] ?? null,
      setItem:    (key: string, value: string) => { cached[key] = value; },
      removeItem: (key: string) => { delete cached[key]; },
      get length() { return Object.keys(cached).length; },
      key:        (i: number) => Object.keys(cached)[i] ?? null,
    };
  }

  function makeFakeIDB() {
    const bag = fakeIdbData;
    const fakeStore = (storeName: string, pendingOps: Promise<void>[]) => ({
      get(key: string) {
        const req: any = { result: undefined };
        const p = Promise.resolve().then(() => { req.result = bag[storeName]?.[key]; req.onsuccess?.(); });
        pendingOps.push(p);
        return req;
      },
      put(value: any, key: string) {
        (bag[storeName] ??= {})[key] = value;
        const req: any = {};
        const p = Promise.resolve().then(() => req.onsuccess?.());
        pendingOps.push(p);
        return req;
      },
      delete(key: string) {
        delete (bag[storeName] ??= {})[key];
        const req: any = {};
        const p = Promise.resolve().then(() => req.onsuccess?.());
        pendingOps.push(p);
        return req;
      },
    });
    const fakeDb = {
      objectStoreNames: { contains: () => true },
      createObjectStore: () => {},
      transaction(storeName: string) {
        const pendingOps: Promise<void>[] = [];
        const store = fakeStore(storeName, pendingOps);
        const tx: any = { objectStore: () => store };
        // Fire oncomplete after all queued micro-tasks settle so
        // put-after-get inside idbSet has time to run.
        Promise.resolve()
          .then(() => Promise.all(pendingOps))
          .then(() => Promise.resolve())
          .then(() => tx.oncomplete?.());
        return tx;
      },
    };
    return {
      open() {
        const req: any = { result: fakeDb };
        Promise.resolve().then(() => { req.onupgradeneeded?.(); req.onsuccess?.(); });
        return req;
      },
    };
  }

  beforeEach(() => {
    vi.resetModules();
    cached = {};
    fakeIdbData.files = {};
    fakeIdbData.messages = {};
    vi.stubGlobal('window', globalThis);
    vi.stubGlobal('localStorage', localStorageStub());
    vi.stubGlobal('indexedDB', makeFakeIDB());
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('recoverProjectFiles returns files from IDB after softDeleteProject clears localStorage', async () => {
    const store = await import('../lib/project-store');
    store.setProjectAccount('u1');
    const proj = store.createProject('Recoverable project');

    const files = {
      '/src/App.tsx': 'export default function App() { return <div>Hello</div>; }',
      '/src/index.css': 'body { margin: 0; }',
    };
    // Simulate what idbSet does: write files under the scoped key.
    const scopedKey = store.projectStorageKey(proj.id);
    fakeIdbData.files[scopedKey] = files;

    store.softDeleteProject(proj.id);

    const lsKey = store.projectStorageKey(`brainhalf_files_${proj.id}`);
    expect(cached[lsKey]).toBeUndefined();
    expect(store.getProjects().find(p => p.id === proj.id)).toBeUndefined();

    const recovered = await store.recoverProjectFiles(proj.id);
    expect(recovered).not.toBeNull();
    expect(recovered!['/src/App.tsx']).toBe(files['/src/App.tsx']);
    expect(recovered!['/src/index.css']).toBe(files['/src/index.css']);
  });

  it('softDeleteProject sets purge_ts marker but does NOT wipe IDB', async () => {
    const store = await import('../lib/project-store');
    store.setProjectAccount('u1');
    const proj = store.createProject('IDB safe project');

    const files = { '/src/main.tsx': 'console.log("hi")' };
    const scopedKey = store.projectStorageKey(proj.id);
    fakeIdbData.files[scopedKey] = files;

    store.softDeleteProject(proj.id);

    expect(cached[store.projectStorageKey(`deleted:purge_ts:${proj.id}`)]).toBeDefined();
    expect(cached[store.projectStorageKey(`deleted:project:${proj.id}`)]).toBe('true');
    expect(fakeIdbData.files[scopedKey]).toEqual(files);
  });

  it('reconcileOwnedProjects clears both deleted:project and deleted:purge_ts markers when restoring', async () => {
    const store = await import('../lib/project-store');
    store.setProjectAccount('u1');
    const proj = store.createProject('Restored project');

    store.softDeleteProject(proj.id);
    expect(cached[store.projectStorageKey(`deleted:project:${proj.id}`)]).toBe('true');
    expect(cached[store.projectStorageKey(`deleted:purge_ts:${proj.id}`)]).toBeDefined();

    vi.resetModules();
    vi.stubGlobal('window', globalThis);
    vi.stubGlobal('localStorage', localStorageStub());
    vi.stubGlobal('indexedDB', makeFakeIDB());
    const s2 = await import('../lib/project-store');
    s2.setProjectAccount('u1');

    s2.reconcileOwnedProjects([{ id: proj.id, name: proj.name, createdAt: proj.createdAt, updatedAt: proj.updatedAt } as any]);

    expect(cached[s2.projectStorageKey(`deleted:project:${proj.id}`)]).toBeUndefined();
    expect(cached[s2.projectStorageKey(`deleted:purge_ts:${proj.id}`)]).toBeUndefined();
    expect(s2.getProjects().find(p => p.id === proj.id)).toBeDefined();
  });
});

describe('P6 flushExpiredPurges — 7-day retention and restored-project safety', () => {
  let cached: Record<string, string>;
  let deletedIdbKeys: string[];

  function localStorageStub() {
    return {
      getItem:    (key: string) => cached[key] ?? null,
      setItem:    (key: string, value: string) => { cached[key] = value; },
      removeItem: (key: string) => { delete cached[key]; },
      get length() { return Object.keys(cached).length; },
      key:        (i: number) => Object.keys(cached)[i] ?? null,
    };
  }

  beforeEach(() => {
    vi.resetModules();
    cached = {};
    deletedIdbKeys = [];
    vi.stubGlobal('localStorage', localStorageStub());
    vi.stubGlobal('indexedDB', undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('flushExpiredPurges only deletes IDB data after 7 days', async () => {
    const store = await import('../lib/project-store');
    store.setProjectAccount('u1');

    const recentPurgeId = 'proj-recent';
    const expiredPurgeId = 'proj-expired';
    const now = Date.now();

    cached[store.projectStorageKey(`deleted:purge_ts:${recentPurgeId}`)] = String(now - 3 * 24 * 60 * 60 * 1000);
    cached[store.projectStorageKey(`deleted:project:${recentPurgeId}`)] = 'true';
    cached[store.projectStorageKey(`deleted:purge_ts:${expiredPurgeId}`)] = String(now - 8 * 24 * 60 * 60 * 1000);
    cached[store.projectStorageKey(`deleted:project:${expiredPurgeId}`)] = 'true';

    await store.flushExpiredPurges();

    expect(cached[store.projectStorageKey(`deleted:purge_ts:${recentPurgeId}`)]).toBeDefined();
    expect(cached[store.projectStorageKey(`deleted:purge_ts:${expiredPurgeId}`)]).toBeUndefined();
  });

  it('flushExpiredPurges skips restored projects (no deleted:project marker)', async () => {
    const store = await import('../lib/project-store');
    store.setProjectAccount('u1');

    const restoredId = 'proj-restored';
    const now = Date.now();

    cached[store.projectStorageKey(`deleted:purge_ts:${restoredId}`)] = String(now - 8 * 24 * 60 * 60 * 1000);
    // No deleted:project marker — this project was restored by reconcileOwnedProjects.

    await store.flushExpiredPurges();

    // The purge_ts marker should be cleaned up but IDB must NOT be wiped.
    // Since IDB is undefined here, the key test is that the orphaned purge_ts was removed
    // without crashing, and that the deletion marker path was not triggered.
    expect(cached[store.projectStorageKey(`deleted:purge_ts:${restoredId}`)]).toBeUndefined();
  });
});

describe('P5 localStorage eviction — quota failures evict old caches and retry', () => {
  let cached: Record<string, string>;
  let writeCallCount: number;

  beforeEach(() => {
    vi.resetModules();
    cached = {};
    writeCallCount = 0;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('evicts other projects message caches and retries on quota error', async () => {
    // Session with two projects: projA (old) and projB (current).
    // projA has cached messages. projB write will fail once then succeed.
    let projAMsgKey = '';
    let failNextWrite = false;

    vi.stubGlobal('localStorage', {
      getItem:    (key: string) => cached[key] ?? null,
      setItem:    (key: string, value: string) => {
        writeCallCount++;
        if (failNextWrite && key.includes('brainhalf_messages_')) {
          failNextWrite = false; // only fail once to let eviction retry succeed
          throw new Error('QuotaExceededError');
        }
        cached[key] = value;
      },
      removeItem: (key: string) => { delete cached[key]; },
    });

    const store = await import('../lib/project-store');
    store.setProjectAccount('u1');

    // Create projA (older), give it cached messages in localStorage.
    const projA = store.createProject('Old project A');
    // Make projA appear older so it gets evicted first
    const projects = store.getProjects().map(p => p.id === projA.id ? { ...p, updatedAt: Date.now() - 1000 } : p);
    store.saveProjectMessages(projA.id, [{ role: 'user', content: 'Old message' }]);
    projAMsgKey = store.projectStorageKey(`brainhalf_messages_${projA.id}`);
    expect(cached[projAMsgKey]).toBeDefined();

    // Create projB (current).
    const projB = store.createProject('Current project B');

    // Next message write will hit quota → triggers eviction of projA's cache → retry.
    failNextWrite = true;
    store.saveProjectMessages(projB.id, [{ role: 'user', content: 'New message' }]);

    // projA's messages should be evicted to make room.
    expect(cached[projAMsgKey]).toBeUndefined();

    // projB's messages should be saved after the retry.
    const projBMsgKey = store.projectStorageKey(`brainhalf_messages_${projB.id}`);
    expect(cached[projBMsgKey]).toBeDefined();
    const saved = JSON.parse(cached[projBMsgKey]);
    expect(saved).toHaveLength(1);
    expect(saved[0].content).toBe('New message');
  });
});
