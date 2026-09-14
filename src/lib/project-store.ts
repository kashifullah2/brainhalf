import { appEvents } from './events';

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
  const id = 'proj-' + Math.random().toString(36).substring(2, 8) + '-' + Date.now().toString(36);
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

export async function createBranch(sourceId: string, branchName: string): Promise<Project> {
  const newProj = createProject(branchName);
  
  // Clone files
  const sourceFiles = await getProjectFilesAsync(sourceId);
  if (sourceFiles) {
    saveProjectFiles(newProj.id, JSON.parse(JSON.stringify(sourceFiles)));
  }

  // Clone messages
  const sourceMsgs = await getProjectMessagesAsync(sourceId);
  if (sourceMsgs) {
    saveProjectMessages(newProj.id, JSON.parse(JSON.stringify(sourceMsgs)));
  }
  
  return newProj;
}

export interface MergeResult {
  success: boolean;
  hasConflict: boolean;
  conflicts: string[];
  mergedFiles: Record<string, string>;
}

export async function mergeBranches(targetProjectId: string, sourceProjectId: string): Promise<MergeResult> {
  const targetFiles = (await getProjectFilesAsync(targetProjectId)) || {};
  const sourceFiles = (await getProjectFilesAsync(sourceProjectId)) || {};

  const merged: Record<string, string> = { ...targetFiles };
  const conflicts: string[] = [];

  for (const [filePath, sourceContent] of Object.entries(sourceFiles)) {
    if (!(filePath in targetFiles)) {
      merged[filePath] = sourceContent;
    } else if (targetFiles[filePath] === sourceContent) {
      continue;
    } else {
      conflicts.push(filePath);
      const conflictBlock = `<<<<<<< HEAD (${targetProjectId})\n${targetFiles[filePath]}\n=======\n${sourceContent}\n>>>>>>> INCOMING (${sourceProjectId})`;
      merged[filePath] = conflictBlock;
    }
  }

  saveProjectFiles(targetProjectId, merged);
  appEvents.emit('workspace-files-changed', { projectId: targetProjectId, files: merged });

  return {
    success: true,
    hasConflict: conflicts.length > 0,
    conflicts,
    mergedFiles: merged
  };
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

// In-memory cache for fast synchronous access
const memoryCache: Record<string, any> = {};

// Zero-dependency native IndexedDB persistence for large files and history
const DB_NAME = 'BrainHalfStorage';
const DB_VERSION = 1;
let dbPromise: Promise<IDBDatabase> | null = null;

function getDb(): Promise<IDBDatabase> | null {
  if (typeof window === 'undefined' || typeof indexedDB === 'undefined') return null;
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      try {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('files')) {
            db.createObjectStore('files');
          }
          if (!db.objectStoreNames.contains('messages')) {
            db.createObjectStore('messages');
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      } catch (err) {
        reject(err);
      }
    });
  }
  return dbPromise;
}

export async function idbGet<T>(storeName: 'files' | 'messages', key: string): Promise<T | null> {
  const dbPromiseLocal = getDb();
  if (!dbPromiseLocal) return null;
  try {
    const db = await dbPromiseLocal;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const req = store.get(key);
        req.onsuccess = () => resolve(req.result ?? null);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  } catch {
    return null;
  }
}

export async function idbSet(storeName: 'files' | 'messages', key: string, value: any): Promise<void> {
  const dbPromiseLocal = getDb();
  if (!dbPromiseLocal) return;
  try {
    const db = await dbPromiseLocal;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        store.put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  } catch {
    // Graceful no-op if IDB fails
  }
}

export async function idbDelete(storeName: 'files' | 'messages', key: string): Promise<void> {
  const dbPromiseLocal = getDb();
  if (!dbPromiseLocal) return;
  try {
    const db = await dbPromiseLocal;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        store.delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  } catch {
    // Graceful no-op if IDB fails
  }
}

export function getProjectFiles(projectId: string): Record<string, string> | null {
  const cacheKey = `files_${projectId}`;
  if (memoryCache[cacheKey]) {
    return memoryCache[cacheKey];
  }

  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(`${PROJECT_FILES_PREFIX}${projectId}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) {
        memoryCache[cacheKey] = parsed;
        return parsed;
      }
    }
  } catch (e) {
    console.error('Error reading project files:', e);
  }
  return null;
}

export async function getProjectFilesAsync(projectId: string): Promise<Record<string, string> | null> {
  const syncResult = getProjectFiles(projectId);
  if (syncResult) return syncResult;

  // Fallback to IndexedDB for large projects that exceeded localStorage quota
  const idbResult = await idbGet<Record<string, string>>('files', projectId);
  if (idbResult) {
    memoryCache[`files_${projectId}`] = idbResult;
    return idbResult;
  }
  return null;
}

export function saveProjectFiles(projectId: string, files: Record<string, string>) {
  if (!projectId || !files || Object.keys(files).length === 0) return;
  memoryCache[`files_${projectId}`] = files;

  // 1. Asynchronously persist to high-capacity IndexedDB
  void idbSet('files', projectId, files);

  // 2. Synchronously cache to localStorage if within quota
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(`${PROJECT_FILES_PREFIX}${projectId}`, JSON.stringify(files));
    }
  } catch (e) {
    // QuotaExceededError: IndexedDB has already persisted the state safely
    console.warn('localStorage quota exceeded for files, persisted via IndexedDB:', e);
  }
}

export function deleteProjectFiles(projectId: string) {
  delete memoryCache[`files_${projectId}`];
  void idbDelete('files', projectId);

  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(`${PROJECT_FILES_PREFIX}${projectId}`);
    }
  } catch {}
}

export function getProjectMessages(projectId: string): any[] | null {
  const cacheKey = `messages_${projectId}`;
  if (memoryCache[cacheKey]) {
    return memoryCache[cacheKey];
  }

  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(`${PROJECT_MESSAGES_PREFIX}${projectId}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        memoryCache[cacheKey] = parsed;
        return parsed;
      }
    }
  } catch (e) {
    console.error('Error reading project messages:', e);
  }
  return null;
}

export async function getProjectMessagesAsync(projectId: string): Promise<any[] | null> {
  const syncResult = getProjectMessages(projectId);
  if (syncResult) return syncResult;

  // Fallback to IndexedDB for large conversation histories
  const idbResult = await idbGet<any[]>('messages', projectId);
  if (idbResult) {
    memoryCache[`messages_${projectId}`] = idbResult;
    return idbResult;
  }
  return null;
}

export function getProjectDisplayTitle(proj: Project): string {
  if (!proj) return 'Untitled Project';

  // 1. Check stored messages for the first user prompt
  const msgs = getProjectMessages(proj.id);
  if (msgs && Array.isArray(msgs)) {
    const firstUserMsg = msgs.find(
      m => m && m.role === 'user' && typeof m.content === 'string' && m.content.trim().length > 0
    );
    if (firstUserMsg && firstUserMsg.content) {
      const cleaned = firstUserMsg.content.trim().replace(/\s+/g, ' ');
      return cleaned.length > 30 ? `${cleaned.slice(0, 30)}…` : cleaned;
    }
  }

  // 2. If project name is custom (not generic "Project N" or "Untitled Project"), use it truncated to ~30 chars
  if (proj.name && !/^Project \d+$/i.test(proj.name) && proj.name !== 'Untitled Project') {
    const cleaned = proj.name.trim().replace(/\s+/g, ' ');
    return cleaned.length > 30 ? `${cleaned.slice(0, 30)}…` : cleaned;
  }

  // 3. Fallback to generic name or default
  return proj.name || 'New project';
}

export function saveProjectMessages(projectId: string, messages: any[]) {
  if (!projectId || !messages) return;
  memoryCache[`messages_${projectId}`] = messages;

  // 1. Asynchronously persist to high-capacity IndexedDB
  void idbSet('messages', projectId, messages);

  // 2. Synchronously cache to localStorage if within quota
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(`${PROJECT_MESSAGES_PREFIX}${projectId}`, JSON.stringify(messages));
    }
  } catch (e) {
    console.warn('localStorage quota exceeded for messages, persisted via IndexedDB:', e);
  }
}

export function deleteProjectMessages(projectId: string) {
  delete memoryCache[`messages_${projectId}`];
  void idbDelete('messages', projectId);

  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(`${PROJECT_MESSAGES_PREFIX}${projectId}`);
    }
  } catch {}
}

