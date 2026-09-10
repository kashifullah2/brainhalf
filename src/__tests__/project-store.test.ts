import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getProjects,
  saveProjects,
  createProject,
  updateProjectName,
  deleteProject,
  formatRelativeTime,
  getActiveProjectId,
  setActiveProjectId
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
});
