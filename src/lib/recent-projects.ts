import type { Project } from './project-store';
import type { PlatformStatus } from './status-store';

export const PROJECT_DATE_GROUPS = ['Today', 'Yesterday', 'This week', 'Older'] as const;
export type ProjectDateGroup = typeof PROJECT_DATE_GROUPS[number];
export type ProjectCardStatus = 'draft' | 'building' | 'deployed' | 'error';
export type ProjectSort = 'updated' | 'name' | 'status';
export const PROJECT_PAGE_SIZE = 8;

export function isUntitledProject(name: string): boolean {
  return !name.trim() || /^(untitled(?: project)?|new project|project \d+|draft\s*[—–-]\s*continue building\.?)$/i.test(name.trim());
}

export function projectDateGroup(timestamp: number, now: number): ProjectDateGroup {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const weekStart = new Date(today);
  weekStart.setDate(weekStart.getDate() - (weekStart.getDay() + 6) % 7);
  if (timestamp >= today.getTime()) return 'Today';
  if (timestamp >= yesterday.getTime()) return 'Yesterday';
  if (timestamp >= weekStart.getTime()) return 'This week';
  return 'Older';
}

export function projectCardStatus(project: Project, runtime: PlatformStatus): ProjectCardStatus {
  if (runtime === 'Building') return 'building';
  if (runtime === 'Error') return 'error';
  if (project.status === 'building') return 'building';
  if (project.status === 'error') return 'error';
  // A successful build alone does not mean the app has been published.
  return project.productionPublished === true || project.published === true ? 'deployed' : 'draft';
}

export function projectCategory(title: string, description: string) {
  const text = `${isUntitledProject(title) ? '' : title} ${description}`.toLowerCase();
  if (/\b(portal|client area|member area)\b/.test(text)) return 'portal';
  if (/\b(dashboard|analytics|charts?|metrics|reports?)\b/.test(text)) return 'dashboard';
  if (/\b(shop|store|storefront|cart|checkout|e-commerce|ecommerce|commerce)\b/.test(text)) return 'storefront';
  if (/\b(portfolio|gallery|photographer)\b/.test(text)) return 'portfolio';
  if (/\b(kanban|tasks?|todo|board|workflow|tracker)\b/.test(text)) return 'workflow';
  if (/\b(chat|assistant|messaging|inbox|support|helpdesk)\b/.test(text)) return 'chat';
  if (/\b(forms?|booking|survey|questionnaire|reservations?)\b/.test(text)) return 'forms';
  return 'app';
}

export interface RecentProjectEntry {
  project: Project;
  title: string;
  description: string;
  untitled: boolean;
  status: ProjectCardStatus;
  category: ReturnType<typeof projectCategory>;
  dateGroup: ProjectDateGroup;
}

export function selectRecentProjects(entries: RecentProjectEntry[], search: string, status: ProjectCardStatus | 'all', sort: ProjectSort) {
  const query = search.trim().toLocaleLowerCase();
  const statusOrder: Record<ProjectCardStatus, number> = { building: 0, error: 1, draft: 2, deployed: 3 };
  return entries.filter(entry => (status === 'all' || entry.status === status) &&
    `${entry.title} ${entry.description} ${entry.category} ${entry.project.id}`.toLocaleLowerCase().includes(query))
    .sort((a, b) => {
      const group = PROJECT_DATE_GROUPS.indexOf(a.dateGroup) - PROJECT_DATE_GROUPS.indexOf(b.dateGroup);
      if (group) return group;
      const primary = sort === 'name' ? a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' }) :
        sort === 'status' ? statusOrder[a.status] - statusOrder[b.status] : b.project.updatedAt - a.project.updatedAt;
      return primary || a.title.localeCompare(b.title) || a.project.id.localeCompare(b.project.id);
    });
}
