import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  setProjectAccount,
  projectStorageKey,
  getProjects,
  saveProjects,
  createProject,
  updateProjectName,
  deleteProject,
  formatRelativeTime,
  getActiveProjectId,
  setActiveProjectId,
  getProjectFiles,
  saveProjectFiles,
  saveProjectFilesDebounced,
  flushProjectFileWrites,
  getProjectMessages,
  saveProjectMessages,
  deleteProjectMessages,
  deleteProjectFiles,
  getProjectDisplayTitle
} from '../lib/project-store';

describe('Project Store & LocalStorage State Management', () => {
  let mockStorage: Record<string, string> = {};

  beforeEach(() => {
    setProjectAccount(null);
    mockStorage = {};
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => mockStorage[key] || null,
      setItem: (key: string, val: string) => { mockStorage[key] = val; },
      removeItem: (key: string) => { delete mockStorage[key]; },
      clear: () => { mockStorage = {}; }
    });
    setProjectAccount('test-account');
  });

  describe('getProjects', () => {
    it('seeds a uniquely-owned project when localStorage is empty', () => {
      const projects = getProjects();
      expect(projects).toHaveLength(1);
      // A hard-coded 'default' id would be shared by every brand-new visitor;
      // the first to connect would claim it server-side for everyone.
      expect(projects[0].id).toMatch(/^proj-/);
      expect(projects[0].name).toBe('Untitled Project');
    });

    it('seeds different ids for two fresh visitors (no shared land-grab)', () => {
      const first = getProjects()[0].id;
      mockStorage = {};
      const second = getProjects()[0].id;
      expect(first).not.toBe(second);
      expect(second).toMatch(/^proj-/);
    });

    it('recovers gracefully from corrupted JSON in localStorage', () => {
      mockStorage[projectStorageKey('brainhalf_projects')] = '{ invalid_json :::: ';
      const projects = getProjects();
      expect(projects).toHaveLength(1);
      expect(projects[0].id).toMatch(/^proj-/);
    });

    it('preserves an existing "default" project from older versions', () => {
      // Users who already have a claimed default project keep it; we migrate
      // nothing and never touch stored state.
      saveProjects([{ id: 'default', name: 'Legacy', createdAt: 1, updatedAt: 1 } as any]);
      expect(getProjects()[0].id).toBe('default');
    });
  });

  describe('createProject', () => {
    it('creates a new project and sets it as active', () => {
      const newProj = createProject('My Analytics App');
      expect(newProj.name).toBe('My Analytics App');
      expect(newProj.id).toMatch(/^proj-/);

      const all = getProjects();
      expect(all.some(p => p.id === newProj.id)).toBe(true);
    });
  });

  describe('updateProjectName', () => {
    it('updates project name by ID', () => {
      const proj = createProject('Old Name');
      updateProjectName(proj.id, 'New Polished Name');

      const updated = getProjects().find(p => p.id === proj.id);
      expect(updated?.name).toBe('New Polished Name');
    });
  });

  describe('deleteProject', () => {
    it('deletes a project and returns remaining list', () => {
      const p1 = createProject('Proj 1');
      const p2 = createProject('Proj 2');

      const remaining = deleteProject(p1.id);
      expect(remaining.some(p => p.id === p1.id)).toBe(false);
      expect(remaining.some(p => p.id === p2.id)).toBe(true);
    });

    it('re-seeds a uniquely-owned project if the last project is deleted', () => {
      const p1 = createProject('Sole Project');
      const remaining = deleteProject(p1.id);

      expect(remaining).toHaveLength(1);
      expect(remaining[0].id).toMatch(/^proj-/);
      expect(remaining[0].id).not.toBe(p1.id);
    });
  });

  describe('formatRelativeTime', () => {
    it('formats timestamps accurately', () => {
      const now = Date.now();
      expect(formatRelativeTime(now - 10000)).toBe('Just now');
      expect(formatRelativeTime(now - 5 * 60 * 1000)).toBe('5m ago');
      expect(formatRelativeTime(now - 3 * 3600 * 1000)).toBe('3h ago');
      expect(formatRelativeTime(now - 24 * 3600 * 1000)).toBe('Yesterday');
      expect(formatRelativeTime(now - 5 * 24 * 3600 * 1000)).toBe('5d ago');
      expect(formatRelativeTime(0)).toBe('Recently');
    });
  });

  describe('Active Project ID & Direct Save', () => {
    it('falls back to the seeded unique project, never a hard-coded id', () => {
      const seeded = getActiveProjectId();
      expect(seeded).toMatch(/^proj-/);
      setActiveProjectId('custom-proj-123');
      expect(getActiveProjectId()).toBe('custom-proj-123');
    });

    it('saves custom projects list directly', () => {
      const custom = [{ id: 'p99', name: 'Special App', updatedAt: Date.now() }];
      saveProjects(custom as any);
      const retrieved = getProjects();
      expect(retrieved[0].id).toBe('p99');
      expect(retrieved[0].name).toBe('Special App');
      expect(retrieved[0].framework).toBe('React 18 + Vite');
      expect(retrieved[0].status).toBe('ready');
    });
  });

  describe('Per-Project File & Message Isolation (Clean Sessions)', () => {
    it('returns null files and messages for brand new projects', () => {
      const p = createProject('Clean Test Proj');
      expect(getProjectFiles(p.id)).toBeNull();
      expect(getProjectMessages(p.id)).toBeNull();
    });

    it('saves and retrieves files independently between projects', () => {
      const p1 = createProject('Project 1');
      const p2 = createProject('Project 2');

      const p1Files = { '/src/App.jsx': '// Project 1 Code' };
      const p2Files = { '/src/App.jsx': '// Project 2 Code' };

      saveProjectFiles(p1.id, p1Files);
      saveProjectFiles(p2.id, p2Files);

      expect(getProjectFiles(p1.id)).toEqual(p1Files);
      expect(getProjectFiles(p2.id)).toEqual(p2Files);
    });

    it('saves and retrieves messages independently between projects', () => {
      const p1 = createProject('Chat Project 1');
      const p2 = createProject('Chat Project 2');

      const p1Msgs = [{ role: 'user' as const, content: 'Build Mario game' }];
      const p2Msgs = [{ role: 'user' as const, content: 'Build Weather app' }];

      saveProjectMessages(p1.id, p1Msgs);
      saveProjectMessages(p2.id, p2Msgs);

      expect(getProjectMessages(p1.id)).toEqual(p1Msgs);
      expect(getProjectMessages(p2.id)).toEqual(p2Msgs);
    });

    it('cleans up files and messages when project is deleted', () => {
      const p = createProject('Temporary Project');
      saveProjectFiles(p.id, { '/src/App.jsx': 'temp' });
      saveProjectMessages(p.id, [{ role: 'ai', content: 'temp' }]);

      expect(getProjectFiles(p.id)).not.toBeNull();
      expect(getProjectMessages(p.id)).not.toBeNull();

      deleteProject(p.id);

      expect(getProjectFiles(p.id)).toBeNull();
      expect(getProjectMessages(p.id)).toBeNull();
    });

    it('allows deleting project messages individually', () => {
      saveProjectMessages('test-del-msgs', [{ role: 'user', content: 'test' }]);
      expect(getProjectMessages('test-del-msgs')).toHaveLength(1);

      deleteProjectMessages('test-del-msgs');
      expect(getProjectMessages('test-del-msgs')).toBeNull();
    });
  });

  describe('getProjectDisplayTitle', () => {
    it('uses the full prompt for generic names so the layout can wrap it', () => {
      const proj = createProject('Project 1');
      saveProjectMessages(proj.id, [
        { role: 'ai', content: 'Hello! What would you like to build?' },
        { role: 'user', content: 'Build an interactive financial budget dashboard with charts and tables' }
      ]);

      const title = getProjectDisplayTitle(proj);
      expect(title).toBe('Build an interactive financial budget dashboard with charts and tables');
    });

    it('returns exact prompt without truncation if 30 chars or less', () => {
      const proj = createProject('Project 2');
      saveProjectMessages(proj.id, [
        { role: 'user', content: 'Create a chess game' }
      ]);

      const title = getProjectDisplayTitle(proj);
      expect(title).toBe('Create a chess game');
    });

    it('cleans internal newlines and excess whitespace from first prompt', () => {
      const proj = createProject('Project 3');
      saveProjectMessages(proj.id, [
        { role: 'user', content: 'Build a    calculator\nwith history\nfeature' }
      ]);

      const title = getProjectDisplayTitle(proj);
      expect(title).toBe('Build a calculator with history feature');
    });

    it('falls back to custom project name when no user prompt exists', () => {
      const proj = createProject('Custom Mobile App');
      expect(getProjectDisplayTitle(proj)).toBe('Custom Mobile App');
    });

    it('honors a renamed project even when an earlier prompt exists', () => {
      const proj = createProject('Weekly team planner');
      saveProjectMessages(proj.id, [{ role: 'user', content: 'Build a kanban board' }]);
      expect(getProjectDisplayTitle(proj)).toBe('Weekly team planner');
    });

    it('expands a legacy automatic prompt prefix', () => {
      const proj = createProject('Build an app: Real-time Chat...');
      saveProjectMessages(proj.id, [{ role: 'user', content: 'Build an app: Real-time Chat App with shared rooms' }]);
      expect(getProjectDisplayTitle(proj)).toBe('Build an app: Real-time Chat App with shared rooms');
    });

    it('falls back to generic Project N if no user prompt exists yet', () => {
      const proj = createProject('Project 4');
      expect(getProjectDisplayTitle(proj)).toBe('Project 4');
    });
  });
});

describe('Debounced file persistence (editor keystroke path)', () => {
  let mockStorage: Record<string, string> = {};

  beforeEach(() => {
    setProjectAccount(null);
    mockStorage = {};
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => (key in mockStorage ? mockStorage[key] : null),
      setItem: (key: string, val: string) => { mockStorage[key] = val; },
      removeItem: (key: string) => { delete mockStorage[key]; },
      clear: () => { mockStorage = {}; }
    });
    setProjectAccount('test-account');
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const read = (projectId: string) =>
    mockStorage[projectStorageKey(`brainhalf_files_${projectId}`)] ?? null;

  it('does not touch localStorage synchronously, only the memory cache', () => {
    saveProjectFilesDebounced('proj-deb-1', { '/src/App.jsx': 'a' });
    expect(read('proj-deb-1')).toBeNull();
    expect(getProjectFiles('proj-deb-1')).toEqual({ '/src/App.jsx': 'a' });
  });

  it('collapses a burst of edits into the last write only', () => {
    for (let i = 0; i < 50; i++) {
      saveProjectFilesDebounced('proj-deb-2', { '/src/App.jsx': `line ${i}` });
    }
    expect(read('proj-deb-2')).toBeNull();

    vi.advanceTimersByTime(400);
    expect(JSON.parse(read('proj-deb-2'))).toEqual({ '/src/App.jsx': 'line 49' });
  });

  it('writes immediately when flushed', () => {
    saveProjectFilesDebounced('proj-deb-3', { '/src/App.jsx': 'flushed' });
    flushProjectFileWrites();
    expect(JSON.parse(read('proj-deb-3'))).toEqual({ '/src/App.jsx': 'flushed' });
  });

  it('does not resurrect deleted files with a late debounced write', () => {
    saveProjectFilesDebounced('proj-deb-4', { '/src/App.jsx': 'doomed' });
    deleteProjectFiles('proj-deb-4');

    // The pending timer would otherwise fire now and restore the files.
    vi.advanceTimersByTime(400);
    expect(read('proj-deb-4')).toBeNull();
  });

  it('lets an explicit synchronous save win over a pending debounced one', () => {
    // Keystroke, then the agent emits a completed file before the debounce fires.
    saveProjectFilesDebounced('proj-deb-5', { '/src/App.jsx': 'stale typing' });
    saveProjectFiles('proj-deb-5', { '/src/App.jsx': 'generated', '/src/Other.jsx': 'new' });

    vi.advanceTimersByTime(400);
    expect(JSON.parse(read('proj-deb-5'))).toEqual({
      '/src/App.jsx': 'generated',
      '/src/Other.jsx': 'new'
    });
  });
});
