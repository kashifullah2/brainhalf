export interface Project {
  id: string;
  name: string;
  framework?: string;
  status?: 'draft' | 'building' | 'ready';
  createdAt: number;
  updatedAt: number;
}

export function formatRelativeTime(timestamp: number): string {
  if (!timestamp) return 'Recently';
  const now = Date.now();
  const diffMs = now - timestamp;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHours = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSec < 45) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return 'Yesterday';
  return `${diffDays}d ago`;
}

const STORAGE_KEY = 'brainhalf_projects';
const ACTIVE_PROJECT_KEY = 'brainhalf_active_project';

export function getProjects(): Project[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const list = JSON.parse(raw);
      if (Array.isArray(list) && list.length > 0) {
        return list.map(p => ({
          framework: 'React 18 + Vite',
          status: 'ready',
          ...p
        }));
      }
    }
  } catch (e) {
    console.error('Error reading projects:', e);
  }

  const defaultProj: Project = {
    id: 'default',
    name: 'Untitled Project',
    framework: 'React 18 + Vite',
    status: 'ready',
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  saveProjects([defaultProj]);
  return [defaultProj];
}

export function saveProjects(projects: Project[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
  } catch {}
}

export function getActiveProjectId(): string {
  // Check URL parameter first (?project=...)
  if (typeof window !== 'undefined' && window.location?.search) {
    const params = new URLSearchParams(window.location.search);
    const urlProj = params.get('project');
    if (urlProj && /^[a-zA-Z0-9_-]+$/.test(urlProj)) {
      return urlProj;
    }
  }

  if (typeof localStorage !== 'undefined') {
    const saved = localStorage.getItem(ACTIVE_PROJECT_KEY);
    if (saved) return saved;
  }

  return 'default';
}

export function setActiveProjectId(id: string) {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(ACTIVE_PROJECT_KEY, id);
  }

  if (typeof window !== 'undefined' && window.location && window.history?.replaceState) {
    try {
      const url = new URL(window.location.href);
      if (id === 'default') {
        url.searchParams.delete('project');
      } else {
        url.searchParams.set('project', id);
      }
      window.history.replaceState({}, '', url.toString());
    } catch {}
  }
}

export function createProject(name: string = 'Untitled Project'): Project {
  const id = 'proj-' + Math.random().toString(36).substring(2, 9);
  const newProj: Project = {
    id,
    name,
    framework: 'React 18 + Vite',
    status: 'draft',
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  const projects = [newProj, ...getProjects().filter(p => p.id !== id)];
  saveProjects(projects);
  setActiveProjectId(id);
  return newProj;
}

export function updateProjectName(id: string, name: string) {
  const projects = getProjects().map(p => {
    if (p.id === id) {
      return { ...p, name, updatedAt: Date.now() };
    }
    return p;
  });
  saveProjects(projects);
}

export function updateProjectMeta(id: string, meta: Partial<Project>) {
  const projects = getProjects().map(p => {
    if (p.id === id) {
      return { ...p, ...meta, updatedAt: Date.now() };
    }
    return p;
  });
  saveProjects(projects);
}

export function deleteProject(id: string): Project[] {
  let projects = getProjects().filter(p => p.id !== id);
  if (projects.length === 0) {
    projects = [{
      id: 'default',
      name: 'Untitled Project',
      createdAt: Date.now(),
      updatedAt: Date.now()
    }];
  }
  saveProjects(projects);
  deleteProjectFiles(id);
  deleteProjectMessages(id);
  if (getActiveProjectId() === id) {
    setActiveProjectId(projects[0].id);
  }
  return projects;
}

const PROJECT_FILES_PREFIX = 'brainhalf_files_';
const PROJECT_MESSAGES_PREFIX = 'brainhalf_messages_';

export function getProjectFiles(projectId: string): Record<string, string> | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(`${PROJECT_FILES_PREFIX}${projectId}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) {
        return parsed;
      }
    }
  } catch (e) {
    console.error('Error reading project files:', e);
  }
  return null;
}

export function saveProjectFiles(projectId: string, files: Record<string, string>) {
  try {
    if (typeof localStorage === 'undefined' || !projectId || !files || Object.keys(files).length === 0) return;
    localStorage.setItem(`${PROJECT_FILES_PREFIX}${projectId}`, JSON.stringify(files));
  } catch (e) {
    console.warn('Error saving project files:', e);
  }
}

export function deleteProjectFiles(projectId: string) {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(`${PROJECT_FILES_PREFIX}${projectId}`);
    }
  } catch {}
}

export function getProjectMessages(projectId: string): any[] | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(`${PROJECT_MESSAGES_PREFIX}${projectId}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch (e) {
    console.error('Error reading project messages:', e);
  }
  return null;
}

export function saveProjectMessages(projectId: string, messages: any[]) {
  try {
    if (typeof localStorage === 'undefined' || !projectId || !messages) return;
    localStorage.setItem(`${PROJECT_MESSAGES_PREFIX}${projectId}`, JSON.stringify(messages));
  } catch (e) {
    console.warn('Error saving project messages:', e);
  }
}

export function deleteProjectMessages(projectId: string) {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(`${PROJECT_MESSAGES_PREFIX}${projectId}`);
    }
  } catch {}
}

