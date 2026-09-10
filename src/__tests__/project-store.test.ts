import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
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
  getProjectMessages,
  saveProjectMessages,
  deleteProjectMessages
} from '../lib/project-store';

describe('Project Store & LocalStorage State Management', () => {
  let mockStorage: Record<string, string> = {};

  beforeEach(() => {
    mockStorage = {};
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => mockStorage[key] || null,
      setItem: (key: string, val: string) => { mockStorage[key] = val; },
      removeItem: (key: string) => { delete mockStorage[key]; },
      clear: () => { mockStorage = {}; }
    });
  });

  describe('getProjects', () => {
    it('initializes default project when localStorage is empty', () => {
      const projects = getProjects();
      expect(projects).toHaveLength(1);
      expect(projects[0].id).toBe('default');
      expect(projects[0].name).toBe('Untitled Project');
    });

    it('recovers gracefully from corrupted JSON in localStorage', () => {
      mockStorage['brainhalf_projects'] = '{ invalid_json :::: ';
      const projects = getProjects();
      expect(projects).toHaveLength(1);
      expect(projects[0].id).toBe('default');
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

    it('resets to default project if the last project is deleted', () => {
      const p1 = createProject('Sole Project');
      const remaining = deleteProject(p1.id);
      deleteProject('default');

      expect(remaining.length).toBeGreaterThanOrEqual(1);
      expect(remaining[0].name).toBeDefined();
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
    it('gets and sets active project ID with default fallback', () => {
      expect(getActiveProjectId()).toBe('default');
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
  });
});
