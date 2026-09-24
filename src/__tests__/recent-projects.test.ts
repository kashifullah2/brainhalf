import { describe, expect, it } from 'vitest';
import { isUntitledProject, projectCardStatus, projectCategory, projectDateGroup, selectRecentProjects, type RecentProjectEntry } from '../lib/recent-projects';

describe('Recent project organization', () => {
  const local = (year: number, month: number, day: number, hour = 0) => new Date(year, month - 1, day, hour).getTime();

  it('uses local calendar boundaries with Yesterday taking precedence over the week', () => {
    const thursday = local(2026, 9, 24, 12);
    expect(projectDateGroup(local(2026, 9, 24), thursday)).toBe('Today');
    expect(projectDateGroup(local(2026, 9, 23, 23), thursday)).toBe('Yesterday');
    expect(projectDateGroup(local(2026, 9, 21), thursday)).toBe('This week');
    expect(projectDateGroup(local(2026, 9, 20, 23), thursday)).toBe('Older');
    expect(projectDateGroup(local(2026, 9, 20), local(2026, 9, 21))).toBe('Yesterday');
    expect(projectDateGroup(local(2026, 9, 19), local(2026, 9, 21))).toBe('Older');
    expect(projectDateGroup(local(2025, 12, 31, 23), local(2026, 1, 1))).toBe('Yesterday');
  });

  it('requires confirmed publication for Deployed and surfaces ongoing builds and errors', () => {
    const project = { id: 'app', name: 'App', createdAt: 1, updatedAt: 1, status: 'ready' as const };
    expect(projectCardStatus(project, 'Ready')).toBe('draft');
    expect(projectCardStatus({ ...project, published: true }, 'Ready')).toBe('deployed');
    expect(projectCardStatus({ ...project, published: false }, 'Ready')).toBe('draft');
    expect(projectCardStatus({ ...project, published: false, productionPublished: true }, 'Ready')).toBe('deployed');
    expect(projectCardStatus({ ...project, published: false, productionPublished: false }, 'Ready')).toBe('draft');
    expect(projectCardStatus({ ...project, published: true }, 'Building')).toBe('building');
    expect(projectCardStatus({ ...project, published: true }, 'Error')).toBe('error');
    expect(projectCardStatus({ ...project, status: 'error' }, 'Ready')).toBe('error');
    expect(projectCardStatus({ ...project, status: 'error' }, 'Building')).toBe('building');
    expect(projectCardStatus({ ...project, status: 'building' }, 'Error')).toBe('error');
  });

  it('separates generic draft names and derives meaningful app categories', () => {
    for (const name of ['', 'Untitled Project', 'New project', 'Project 23', 'Draft — continue building.']) expect(isUntitledProject(name)).toBe(true);
    expect(isUntitledProject('Project Atlas')).toBe(false);
    expect(projectCategory('Customer portal', 'View tasks and messages')).toBe('portal');
    expect(projectCategory('Weekend storefront', 'Sell ceramics online')).toBe('storefront');
    expect(projectCategory('Untitled project', 'Make an analytics dashboard')).toBe('dashboard');
    expect(projectCategory('Project Atlas', '')).toBe('app');
  });

  it('searches the entire collection, filters status and sorts within chronological groups', () => {
    const entries: RecentProjectEntry[] = Array.from({ length: 32 }, (_, index) => ({
      project: { id: `p${index}`, name: `App ${index}`, createdAt: 1, updatedAt: 100 - index },
      title: index === 31 ? 'Orchid' : `App ${index}`, description: index === 31 ? 'Private inventory' : '',
      category: 'app', untitled: false, status: index % 2 ? 'deployed' : 'draft', dateGroup: index < 2 ? 'Today' : 'Older',
    }));
    expect(selectRecentProjects(entries, ' inventory ', 'all', 'updated').map(entry => entry.project.id)).toEqual(['p31']);
    expect(selectRecentProjects(entries, 'Orchid', 'draft', 'name')).toEqual([]);
    expect(selectRecentProjects(entries, '', 'deployed', 'updated')).toHaveLength(16);
    expect(selectRecentProjects(entries, '', 'all', 'name').slice(0, 4).map(entry => entry.title)).toEqual(['App 0', 'App 1', 'App 2', 'App 3']);
    expect(entries[31].title).toBe('Orchid');
  });
});
