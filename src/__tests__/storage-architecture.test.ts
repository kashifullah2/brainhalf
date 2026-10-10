/**
 * Storage architecture invariants (items 1–5 from the server-first refactor).
 *
 * 1. Quota / IDB error never loses data: memory cache is authoritative in-session.
 * 2. Migration survives a failed IDB read-back: LS entry is preserved for retry.
 * 3. Reload keeps the project: getProjectFilesAsync reads from IDB after resetModules.
 * 4. Purge refuses when server has content (fileCount > 0).
 * 5. Stale-revision writes from a second tab do not overwrite newer in-memory state.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Shared fake IDB factory
// ---------------------------------------------------------------------------
type Store = 'files' | 'messages';
type FakeBag = Record<Store, Record<string, unknown>>;

function makeFakeIDB(bag: FakeBag, opts: { failRead?: boolean; failWrite?: boolean } = {}) {
  const fakeStore = (storeName: Store, pendingOps: Promise<void>[]) => ({
    get(key: string) {
      const req: any = { result: undefined };
      const p = Promise.resolve().then(() => {
        if (opts.failRead) { req.onerror?.(); return; }
        req.result = bag[storeName]?.[key];
        req.onsuccess?.();
      });
      pendingOps.push(p);
      return req;
    },
    put(value: unknown, key: string) {
      const req: any = {};
      const p = Promise.resolve().then(() => {
        if (opts.failWrite) { req.onerror?.(); return; }
        (bag[storeName] ??= {})[key] = value;
        req.onsuccess?.();
      });
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
    transaction(storeName: Store) {
      const pendingOps: Promise<void>[] = [];
      const store = fakeStore(storeName, pendingOps);
      const tx: any = { objectStore: () => store };
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

// ---------------------------------------------------------------------------
// 1. IDB write failure never loses in-session data
// ---------------------------------------------------------------------------
describe('1 — IDB write failure never loses in-session data', () => {
  let cached: Record<string, string>;

  beforeEach(() => {
    vi.resetModules();
    cached = {};
    vi.stubGlobal('window', globalThis);
    vi.stubGlobal('localStorage', {
      getItem:    (k: string) => cached[k] ?? null,
      setItem:    (k: string, v: string) => { cached[k] = v; },
      removeItem: (k: string) => { delete cached[k]; },
    });
    // IDB that rejects writes
    const bag: FakeBag = { files: {}, messages: {} };
    vi.stubGlobal('indexedDB', makeFakeIDB(bag, { failWrite: true }));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('memory cache retains files even when IDB write rejects', async () => {
    const store = await import('../lib/project-store');
    store.setProjectAccount('u1');
    const proj = store.createProject('My App');

    store.saveProjectFiles(proj.id, { '/src/App.tsx': 'hello' });
    store.saveProjectMessages(proj.id, [{ role: 'user', content: 'Build me something' }]);

    // IDB write failed (fire-and-forget), but memory cache must still have the data.
    expect(store.getProjectFiles(proj.id)).toEqual({ '/src/App.tsx': 'hello' });
    expect(store.getProjectMessages(proj.id)).toEqual([{ role: 'user', content: 'Build me something' }]);
  });

  it('subsequent writes supersede earlier ones in the memory cache', async () => {
    const store = await import('../lib/project-store');
    store.setProjectAccount('u1');
    const proj = store.createProject('Editor');

    store.saveProjectFiles(proj.id, { '/src/App.tsx': 'v1' });
    store.saveProjectFiles(proj.id, { '/src/App.tsx': 'v2' });
    expect(store.getProjectFiles(proj.id)).toEqual({ '/src/App.tsx': 'v2' });
  });
});

// ---------------------------------------------------------------------------
// 2. Migration preserves LS entry when IDB read-back returns nothing
// ---------------------------------------------------------------------------
describe('2 — migrateLocalStorageToIdb: LS entry preserved when read-back fails', () => {
  let cached: Record<string, string>;
  let readShouldFail: boolean;

  beforeEach(() => {
    vi.resetModules();
    cached = {};
    readShouldFail = false;
    vi.stubGlobal('window', globalThis);
    vi.stubGlobal('localStorage', {
      getItem:    (k: string) => cached[k] ?? null,
      setItem:    (k: string, v: string) => { cached[k] = v; },
      removeItem: (k: string) => { delete cached[k]; },
      get length() { return Object.keys(cached).length; },
      key:        (i: number) => Object.keys(cached)[i] ?? null,
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('removes LS entry when IDB read-back succeeds', async () => {
    const bag: FakeBag = { files: {}, messages: {} };
    vi.stubGlobal('indexedDB', makeFakeIDB(bag));

    const store = await import('../lib/project-store');
    store.setProjectAccount('u1');
    const projId = 'proj-migrate-001';
    const lsKey = store.projectStorageKey(`brainhalf_files_${projId}`);
    const files = { '/src/App.tsx': 'legacy content' };
    cached[lsKey] = JSON.stringify(files);

    await store.migrateLocalStorageToIdb();

    expect(cached[lsKey]).toBeUndefined();
    const scopedKey = store.projectStorageKey(projId);
    expect(bag.files[scopedKey]).toEqual(files);
  });

  it('keeps LS entry when IDB read-back returns nothing', async () => {
    // Write succeeds but subsequent reads return undefined (simulates a partial-write failure).
    let writeCount = 0;
    const bag: FakeBag = { files: {}, messages: {} };
    const idb = makeFakeIDB(bag);
    const origOpen = idb.open.bind(idb);
    // Intercept: after write, zero out the bag so read-back finds nothing.
    vi.stubGlobal('indexedDB', {
      open() {
        const req = origOpen();
        const origOnsuccess = req.onsuccess;
        req.onsuccess = origOnsuccess;
        Promise.resolve().then(() => {
          const origTx = (req.result as any).transaction.bind(req.result);
          (req.result as any).transaction = (storeName: Store) => {
            const tx = origTx(storeName);
            const origObjStore = tx.objectStore.bind(tx);
            tx.objectStore = () => {
              const s = origObjStore();
              const origPut = s.put.bind(s);
              const origGet = s.get.bind(s);
              s.put = (value: unknown, key: string) => {
                const r = origPut(value, key);
                writeCount++;
                // After write lands, zero out so read-back sees nothing.
                Promise.resolve().then(() => { bag.files[key] = undefined as any; });
                return r;
              };
              s.get = origGet;
              return s;
            };
            return tx;
          };
        });
        return req;
      },
    });

    const store = await import('../lib/project-store');
    store.setProjectAccount('u1');
    const projId = 'proj-migrate-002';
    const lsKey = store.projectStorageKey(`brainhalf_files_${projId}`);
    cached[lsKey] = JSON.stringify({ '/src/App.tsx': 'must survive' });

    await store.migrateLocalStorageToIdb();

    // Read-back found nothing → LS key must be preserved for the next session to retry.
    expect(cached[lsKey]).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 3. Reload keeps the project — getProjectFilesAsync reads from IDB
// ---------------------------------------------------------------------------
describe('3 — Reload keeps the project: getProjectFilesAsync reads from IDB', () => {
  let cached: Record<string, string>;
  const bag: FakeBag = { files: {}, messages: {} };

  beforeEach(() => {
    vi.resetModules();
    cached = {};
    bag.files = {};
    bag.messages = {};
    vi.stubGlobal('window', globalThis);
    vi.stubGlobal('localStorage', {
      getItem:    (k: string) => cached[k] ?? null,
      setItem:    (k: string, v: string) => { cached[k] = v; },
      removeItem: (k: string) => { delete cached[k]; },
    });
    vi.stubGlobal('indexedDB', makeFakeIDB(bag));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('returns IDB data after a simulated page reload (resetModules)', async () => {
    // Session 1: save files (goes to IDB via fire-and-forget).
    const s1 = await import('../lib/project-store');
    s1.setProjectAccount('u1');
    const proj = s1.createProject('My App');
    s1.saveProjectFiles(proj.id, { '/src/App.tsx': 'persisted content' });

    // Wait a tick so the IDB write (fire-and-forget) settles.
    await new Promise(r => setTimeout(r, 10));

    // Session 2: resetModules wipes the memory cache and module state.
    vi.resetModules();
    const s2 = await import('../lib/project-store');
    s2.setProjectAccount('u1');

    const files = await s2.getProjectFilesAsync(proj.id);
    expect(files).toEqual({ '/src/App.tsx': 'persisted content' });
  });
});

// ---------------------------------------------------------------------------
// 4. Purge refuses when server reports fileCount > 0
// ---------------------------------------------------------------------------
describe('4 — purgeEmptyDrafts: refuses when server has content', () => {
  let cached: Record<string, string>;

  beforeEach(() => {
    vi.resetModules();
    cached = {};
    vi.stubGlobal('window', Object.assign(new EventTarget(), {
      location: { origin: 'https://brainhalf.com', hostname: 'brainhalf.com' },
    }));
    vi.stubGlobal('localStorage', {
      getItem:    (k: string) => cached[k] ?? null,
      setItem:    (k: string, v: string) => { cached[k] = v; },
      removeItem: (k: string) => { delete cached[k]; },
    });
    vi.stubGlobal('indexedDB', undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('does not purge a draft when the server reports fileCount > 0', async () => {
    const store = await import('../lib/project-store');
    const auth  = await import('../lib/auth-client');

    vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
      if (String(input).endsWith('/api/auth/login'))
        return Response.json({ token: 'tok', user: { id: 'u1', email: 'u1@x.test' } });
      if (String(input).endsWith('/api/projects'))
        return Response.json({ projects: [] });
      if (String(input).includes('/is-empty'))
        return Response.json({ empty: false, fileCount: 3, messageCount: 0 });
      return Response.json({ ok: true });
    }));

    await auth.login('u1', 'pw');

    const cutoff = Date.now() - 25 * 60 * 60 * 1000;
    const draft = store.createProject('Orphan');
    // Backdate so the 24h cutoff triggers.
    store.saveProjects(store.getProjects().map(p =>
      p.id === draft.id ? { ...p, updatedAt: cutoff, status: 'draft' } : p
    ));

    await auth.purgeEmptyDrafts();

    // Server said not empty → project must still be in the list.
    expect(store.getProjects().some(p => p.id === draft.id)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5. Stale-revision writes from a second tab do not clobber newer state
// ---------------------------------------------------------------------------
describe('5 — concurrent tabs: stale bound-store writes are rejected', () => {
  let cached: Record<string, string>;

  beforeEach(() => {
    vi.resetModules();
    cached = {};
    vi.stubGlobal('window', globalThis);
    vi.stubGlobal('localStorage', {
      getItem:    (k: string) => cached[k] ?? null,
      setItem:    (k: string, v: string) => { cached[k] = v; },
      removeItem: (k: string) => { delete cached[k]; },
    });
    vi.stubGlobal('indexedDB', undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('rejects writes from a stale bound store after account switch', async () => {
    vi.useFakeTimers();
    const store = await import('../lib/project-store');
    store.setProjectAccount('account-a');
    const bound = store.bindProjectStore();
    const proj = { id: 'shared', name: 'P', createdAt: 1, updatedAt: 1 };
    store.saveProjects([proj]);

    // "account-b" takes over (simulates another tab logging in via storage event).
    store.setProjectAccount('account-b');

    // Old tab tries to write under account-a — must be silently rejected.
    bound.saveProjectFiles(proj.id, { '/src/App.tsx': 'stale-a-write' });
    bound.saveProjectMessages(proj.id, [{ content: 'stale-a-msg' }]);

    // account-b must see no trace of account-a's stale writes.
    expect(store.getProjectFiles(proj.id)).toBeNull();
    expect(store.getProjectMessages(proj.id)).toBeNull();
    vi.useRealTimers();
  });
});
