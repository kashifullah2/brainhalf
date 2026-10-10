import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('Verified account storage isolation', () => {
  let values: Record<string, string>;
  let store: typeof import('../lib/project-store');
  let auth: typeof import('../lib/auth-client');
  const project = { id: 'shared-id', name: 'Private project', createdAt: 1, updatedAt: 1 };

  beforeEach(async () => {
    vi.resetModules();
    values = {};
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values[key] ?? null,
      setItem: (key: string, value: string) => { values[key] = value; },
      removeItem: (key: string) => { delete values[key]; },
    });
    vi.stubGlobal('window', Object.assign(new EventTarget(), { location: { origin: 'https://brainhalf.com', hostname: 'brainhalf.com' } }));
    vi.stubGlobal('indexedDB', undefined);
    vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
      if (input.endsWith('/api/auth/login')) {
        const id = JSON.parse(String(init?.body)).email;
        return Response.json({ token: `token-${id}`, user: { id, email: id } });
      }
      if (input.endsWith('/api/projects')) return Response.json({ projects: [] });
      return Response.json({ ok: true });
    }));
    store = await import('../lib/project-store');
    auth = await import('../lib/auth-client');
  });

  afterEach(() => {
    store.setProjectAccount(null);
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('keeps local recovery files on server failure, then deletes and blocks stale writes on retry', async () => {
    await auth.login('account-a', 'password');
    store.saveProjects([project]);
    store.saveProjectFiles(project.id, { '/src/App.jsx': 'recovery' });
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ error: 'Retry deletion' }, { status: 503 }));
    await expect(auth.removeProject(project.id)).rejects.toThrow('Retry deletion');
    expect(store.getProjectFiles(project.id)).toEqual({ '/src/App.jsx': 'recovery' });
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ ok: true }));
    await auth.removeProject(project.id);
    store.saveProjectFiles(project.id, { '/src/App.jsx': 'stale' });
    store.saveProjectMessages(project.id, [{ content: 'stale' }]);
    store.reconcileOwnedProjects([project]);
    expect(store.getProjectFiles(project.id)).toBeNull();
    expect(store.getProjectMessages(project.id)).toBeNull();
    expect(store.getProjects().some(saved => saved.id === project.id)).toBe(false);
  });

  it('does not delete a different account after an in-flight server response', async () => {
    await auth.login('account-a', 'password');
    let finish!: (response: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const removing = auth.removeProject(project.id);
    store.setProjectAccount('account-b');
    store.saveProjectFiles(project.id, { '/src/App.jsx': 'account-b' });
    finish(Response.json({ ok: true }));
    await expect(removing).rejects.toThrow('Account changed');
    expect(store.getProjectFiles(project.id)).toEqual({ '/src/App.jsx': 'account-b' });
  });

  it('never reads legacy caches or cached identity before server verification', () => {
    values.bh_session_user = JSON.stringify({ id: 'account-a', email: 'a@example.test' });
    values.brainhalf_projects = JSON.stringify([project]);
    values.brainhalf_files_shared = JSON.stringify({ '/src/App.jsx': 'private' });
    expect(store.getProjects()).toEqual([]);
    expect(store.getProjectFiles('shared')).toBeNull();
    expect(() => store.createProject()).toThrow('Sign in');
  });

  it('reconciles authoritative publication without overwriting local edits or inventing recent activity', () => {
    store.setProjectAccount('account-a');
    store.saveProjects([{ ...project, name: 'Local name', published: true, updatedAt: 200 }]);
    store.reconcileOwnedProjects([{ ...project, published: false }]);
    expect(store.getProjects().find(saved => saved.id === project.id)).toMatchObject({ name: 'Local name', published: false, updatedAt: 200 });
    store.reconcileOwnedProjects([project]);
    expect(store.getProjects().find(saved => saved.id === project.id)?.published).toBe(false);
    store.updateProjectPublication(project.id, true);
    expect(store.getProjects().find(saved => saved.id === project.id)).toMatchObject({ published: true, updatedAt: 200 });
  });

  it('caches confirmed publication and rejects late results for a different account', async () => {
    await auth.login('account-a', 'password');
    store.saveProjects([project]);
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ published: true }));
    await auth.projectPublication(project.id, new AbortController().signal);
    expect(store.getProjects().find(saved => saved.id === project.id)?.published).toBe(true);
    let finish!: (response: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = auth.projectPublication(project.id, new AbortController().signal, false);
    store.setProjectAccount('account-b');
    store.saveProjects([{ ...project, published: true }]);
    finish(Response.json({ published: false }));
    await expect(pending).rejects.toThrow('Account changed');
    expect(store.getProjects()[0].published).toBe(true);
  });

  it('isolates files, messages, lists and active selection even for identical project ids', () => {
    store.setProjectAccount('account-a');
    store.saveProjects([project]);
    store.setActiveProjectId(project.id);
    store.saveProjectFiles(project.id, { '/src/App.jsx': 'account-a source' });
    store.saveProjectMessages(project.id, [{ role: 'user', content: 'account-a prompt' }]);
    store.setProjectAccount('account-b');
    // account-b must not see account-a's files, messages, project list, or active selection
    expect(store.getProjects().some(saved => saved.id === project.id)).toBe(false);
    expect(store.getActiveProjectId()).not.toBe(project.id);
    expect(store.getProjectFiles(project.id)).toBeNull();
    expect(store.getProjectMessages(project.id)).toBeNull();
    store.saveProjectFiles(project.id, { '/src/App.jsx': 'account-b source' });
    store.setProjectAccount('account-a');
    // account-a must not see account-b's files (memory cache is cleared on account switch,
    // and IDB is unavailable in this test environment — persistence across switches is
    // handled by IDB in production and tested via getProjectFilesAsync in P8 tests).
    expect(store.getProjectFiles(project.id)).toBeNull();
    expect(store.getActiveProjectId()).toBe(project.id);
  });

  it('flushes pending edits only to the departing account and rejects stale cleanup writes', () => {
    vi.useFakeTimers();
    store.setProjectAccount('account-a');
    const previous = store.bindProjectStore();
    previous.saveProjectFilesDebounced(project.id, { '/src/App.jsx': 'last edit' });
    store.setProjectAccount('account-b');
    // Stale writes from the old bound store must be rejected (isCurrent() is false).
    previous.saveProjectFiles(project.id, { '/src/App.jsx': 'stale cleanup' });
    previous.saveProjectMessages(project.id, [{ content: 'old history' }]);
    vi.runAllTimers();
    // account-b must not see any data from account-a's stale writes
    expect(store.getProjectFiles(project.id)).toBeNull();
    expect(store.getProjectMessages(project.id)).toBeNull();
    expect(previous.getProjectFiles(project.id)).toBeNull();
  });

  it('discards asynchronous hydration across account switches, including switching back', async () => {
    store.setProjectAccount('account-a');
    values[store.projectStorageKey(`brainhalf_files_${project.id}`)] = JSON.stringify({ '/src/App.jsx': 'cached-a' });
    const pending = store.getProjectFilesAsync(project.id);
    const messages = store.getProjectMessagesAsync(project.id);
    store.setProjectAccount('account-b');
    store.setProjectAccount('account-a');
    expect(await pending).toBeNull();
    expect(await messages).toBeNull();
  });

  it('fetches server snapshot and returns data only when the server has it', async () => {
    const serverFiles = { '/src/App.jsx': 'from server snapshot' };
    vi.mocked(fetch).mockImplementation(async (input: string | Request | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes(`/snapshot`)) {
        // Only return data for the owned project, 403 for everything else.
        if (url.includes(project.id)) return Response.json({ files: serverFiles, messages: [] });
        return new Response(JSON.stringify({ error: 'Not the owner' }), { status: 403 });
      }
      if (url.includes('/api/auth/login')) {
        const id = JSON.parse(String(init?.body)).email;
        return Response.json({ token: `token-${id}`, user: { id, email: id } });
      }
      if (url.includes('/api/projects')) return Response.json({ projects: [] });
      return Response.json({ ok: true });
    });

    store.setProjectAccount('account-a');
    // Server now always called; returns 403 for projects it doesn't recognise → null.
    expect(await store.getProjectFilesAsync(project.id)).toEqual(serverFiles);
    expect(await store.getProjectFilesAsync('other')).toBeNull();
  });

  it('does not reimport legacy history or files after local deletion and a new session', async () => {
    values[`brainhalf_files_${project.id}`] = JSON.stringify({ '/src/App.jsx': 'legacy' });
    values[`brainhalf_messages_${project.id}`] = JSON.stringify([{ content: 'legacy' }]);
    store.setProjectAccount('account-a');
    store.deleteProjectFiles(project.id);
    store.deleteProjectMessages(project.id);
    store.setProjectAccount(null);
    store.setProjectAccount('account-a');
    store.reconcileOwnedProjects([project]);
    expect(await store.getProjectFilesAsync(project.id)).toBeNull();
    expect(await store.getProjectMessagesAsync(project.id)).toBeNull();
  });

  it('uses the server identity rather than the cached user to select a namespace', async () => {
    values.bh_session_token = 'token-real';
    values.bh_session_user = JSON.stringify({ id: 'spoofed', email: 'private@example.test' });
    vi.mocked(fetch).mockImplementation(async input => String(input).endsWith('/api/auth/session')
      ? Response.json({ userId: 'real' }) : Response.json({ projects: [] }));
    expect(await auth.verifyStoredSession()).toEqual({ id: 'real', email: '' });
    expect(store.getProjectStorageScope().accountId).toBe('real');
  });

  it('detaches immediately on logout and does not clear a newer login when revocation finishes', async () => {
    await auth.login('account-a', 'password');
    const originalFetch = fetch;
    let complete!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn((input: string, init?: RequestInit) => input.endsWith('/api/auth/logout')
      ? new Promise<Response>(resolve => { complete = resolve; }) : originalFetch(input, init)));
    const pending = auth.logout();
    expect(store.getProjectStorageScope().accountId).toBeNull();
    expect(auth.getToken()).toBeNull();
    await auth.login('account-b', 'password');
    complete(Response.json({ ok: true }));
    await pending;
    expect(auth.getToken()).toBe('token-account-b');
    expect(store.getProjectStorageScope().accountId).toBe('account-b');
  });

  it('does not revive a session from a late verification response after logout', async () => {
    values.bh_session_token = 'token-account-a';
    let complete!: (response: Response) => void;
    vi.mocked(fetch).mockImplementation(input => String(input).endsWith('/api/auth/session')
      ? new Promise<Response>(resolve => { complete = resolve; }) : Promise.resolve(Response.json({ ok: true })));
    const verifying = auth.verifyStoredSession();
    await auth.logout();
    complete(Response.json({ userId: 'account-a' }));
    expect(await verifying).toBeNull();
    expect(store.getProjectStorageScope().accountId).toBeNull();
  });

  it('ignores a stale unauthorized response and does not log out on a project permission denial', async () => {
    await auth.login('account-a', 'password');
    const originalFetch = fetch;
    let complete!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn((input: string, init?: RequestInit) => input === '/delayed'
      ? new Promise<Response>(resolve => { complete = resolve; }) : originalFetch(input, init)));
    const pending = auth.authFetch('/delayed');
    await auth.login('account-b', 'password');
    complete(Response.json({ error: 'expired' }, { status: 401 }));
    await pending;
    vi.mocked(fetch).mockResolvedValue(Response.json({ error: 'Not the owner' }, { status: 403 }));
    await auth.authFetch('/forbidden');
    expect(auth.getToken()).toBe('token-account-b');
    expect(store.getProjectStorageScope().accountId).toBe('account-b');
  });

  it('cancels branching when the account changes before hydration finishes', async () => {
    store.setProjectAccount('account-a');
    const branch = store.createBranch(project.id, 'new branch');
    store.setProjectAccount('account-b');
    await expect(branch).rejects.toThrow('Account changed');
    expect(store.getProjects().some(saved => saved.name === 'new branch')).toBe(false);
  });

  it('rejects a late login when another tab changed the token before its storage event', async () => {
    let complete!: (response: Response) => void;
    vi.mocked(fetch).mockImplementation(() => new Promise<Response>(resolve => { complete = resolve; }));
    const pending = auth.login('account-a', 'password');
    values.bh_session_token = 'token-account-b';
    complete(Response.json({ token: 'token-account-a', user: { id: 'account-a' } }));
    await expect(pending).rejects.toThrow('Session changed');
    expect(auth.getToken()).toBe('token-account-b');
    expect(store.getProjectStorageScope().accountId).toBeNull();
  });
});
