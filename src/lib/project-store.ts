import { appEvents } from './events';
import { isSystemContinuation } from './chat-transcript';
import { stripPoisonedTail } from './assistant-response';
import { authFetch } from './auth-client';
import { apiOrigin } from './api-origin';

export interface Project {
  id: string;
  name: string;
  framework?: string;
  status?: 'draft' | 'building' | 'ready' | 'error';
  published?: boolean;
  productionPublished?: boolean;
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
let accountScope: Readonly<{ accountId: string | null }> = { accountId: null };
let legacyProjectIds = new Set<string>();
let deletedProjectIds = new Set<string>();
const projectSubmissionKeys = new Map<string, string>();

// localStorage writes for project files and messages are disabled. All project
// data goes to IndexedDB (the durable store). localStorage remains only for
// metadata: project list, active project ID, and deletion markers.
const localStorageWriteFailed = true;

// In-flight server snapshot promises, keyed by projectId. Prevents redundant
// HTTP calls when files and messages are both requested during the same
// cold-start hydration before IndexedDB has been populated.
const snapshotInFlight = new Map<string, Promise<{ files: Record<string, string>; messages: any[] } | null>>();

function projectDeleted(projectId: string): boolean {
  if (deletedProjectIds.has(projectId)) return true;
  try { return localStorage.getItem(projectStorageKey(`deleted:project:${projectId}`)) === 'true'; } catch { return false; }
}

export function getProjectStorageScope() {
  return accountScope;
}

export function projectStorageKey(key: string): string {
  return `brainhalf_account:${encodeURIComponent(accountScope.accountId || '')}:${key}`;
}

export function setProjectAccount(accountId: string | null): void {
  if (accountScope.accountId === accountId) return;
  flushProjectFileWrites();
  accountScope = { accountId };
  legacyProjectIds = new Set();
  deletedProjectIds = new Set();
  projectSubmissionKeys.clear();
  for (const key of Object.keys(memoryCache)) delete memoryCache[key];
  storageRevisions.clear();
  try { sessionStorage.removeItem('brainhalf_github_pat'); } catch {}
  appEvents.emit('project-account-changed');
}

export function reconcileOwnedProjects(owned: Project[]): void {
  if (!accountScope.accountId) return;
  legacyProjectIds = new Set(owned.map(project => project.id));
  let legacy: Project[] = [];
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    if (Array.isArray(parsed)) legacy = parsed.filter(project => project && legacyProjectIds.has(project.id));
  } catch {}
  const current = getProjects();
  const merged = new Map(current.map(project => [project.id, project]));
  for (const project of owned) {
    // A server-confirmed project that has a localStorage deletion marker but was
    // NOT deleted in this session was likely a false-positive purge from a prior
    // session (quota exceeded → status stayed 'draft' → purge fired). Restore it.
    // We do NOT restore projects that were explicitly deleted this session
    // (deletedProjectIds tracks those) even if the server hasn't caught up yet.
    if (projectDeleted(project.id) && !deletedProjectIds.has(project.id)) {
      try { localStorage.removeItem(projectStorageKey(`deleted:project:${project.id}`)); } catch {}
      try { localStorage.removeItem(projectStorageKey(`deleted:purge_ts:${project.id}`)); } catch {}
    }
    if (projectDeleted(project.id)) continue;
    const saved = merged.get(project.id) || legacy.find(saved => saved.id === project.id) || project;
    merged.set(project.id, {
      ...saved,
      ...(typeof project.published === 'boolean' ? { published: project.published } : {}),
    });
  }
  saveProjects([...merged.values()]);
  appEvents.emit('project-account-changed');
}

export function isProjectClaimed(id: string): boolean {
  return legacyProjectIds.has(id);
}

// A hard-coded project id would be shared by every brand-new visitor, and the
// server claims a project on the first authenticated connection. So the first
// person to open the app would permanently own "default" for everyone, and
// every other newcomer's preview iframe would 403. Always mint a unique id.
function newProjectId(): string {
  return 'proj-' + crypto.randomUUID();
}

function seedProject(): Project {
  return {
    id: newProjectId(),
    name: 'Untitled Project',
    framework: 'React 18 + Vite',
    status: 'ready',
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
}

export function getProjects(): Project[] {
  if (!accountScope.accountId) return [];
  try {
    const raw = localStorage.getItem(projectStorageKey(STORAGE_KEY));
    if (raw) {
      const list = JSON.parse(raw);
      if (Array.isArray(list) && list.length > 0) {
        return list.filter(project => !projectDeleted(project.id)).map(p => ({
          framework: 'React 18 + Vite',
          status: 'ready',
          ...p
        }));
      }
    }
  } catch (e) {
    console.error('Error reading projects:', e);
  }

  const seeded = seedProject();
  saveProjects([seeded]);
  return [seeded];
}

export function saveProjects(projects: Project[]) {
  if (!accountScope.accountId) return;
  try {
    localStorage.setItem(projectStorageKey(STORAGE_KEY), JSON.stringify(projects));
  } catch {}
}

export function getActiveProjectId(): string {
  // Check URL parameter first (?project=...)
  if (typeof window !== 'undefined' && window.location?.search) {
    const params = new URLSearchParams(window.location.search);
    const urlProj = params.get('project');
    if (urlProj && /^[a-zA-Z0-9_-]+$/.test(urlProj) && !projectDeleted(urlProj)) {
      return urlProj;
    }
  }

  if (typeof localStorage !== 'undefined') {
    const saved = accountScope.accountId ? localStorage.getItem(projectStorageKey(ACTIVE_PROJECT_KEY)) : null;
    if (saved && !projectDeleted(saved)) return saved;
  }

  // Never fall back to a hard-coded id: getProjects() has already seeded a
  // uniquely-owned project for first-time visitors, so this is either that id
  // or an existing project the user chose earlier.
  return accountScope.accountId ? (getProjects()[0]?.id ?? newProjectId()) : '';
}

export function setActiveProjectId(id: string) {
  if (!accountScope.accountId) return;
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(projectStorageKey(ACTIVE_PROJECT_KEY), id);
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
  if (!accountScope.accountId) throw new Error('Sign in before creating a project');
  const id = newProjectId();
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
  projectSubmissionKeys.set(id, crypto.randomUUID());
  setActiveProjectId(id);
  return newProj;
}

/**
 * Builds a short, readable project title from the user's prompt: the first
 * few words, cut at a word boundary, instead of a raw character slice of the
 * full prompt text.
 */
export function shortTitleFromPrompt(prompt: string, maxWords = 6, maxChars = 48): string {
  const words = prompt.trim().split(/\s+/).filter(Boolean).slice(0, maxWords).join(' ');
  if (!words) return 'Untitled Project';
  if (words.length <= maxChars) return words;
  const cut = words.slice(0, maxChars);
  const boundary = cut.lastIndexOf(' ');
  return (boundary > 0 ? cut.slice(0, boundary) : cut).trimEnd() + '…';
}

/**
 * True for a project that was created but never received a first message —
 * an abandoned blank draft. purgeEmptyDrafts() removes these so they never
 * pile up against the 50-project limit.
 */
export function isEmptyDraftProject(project: Project): boolean {
  if (project.status !== 'draft') return false;
  const messages = getProjectMessages(project.id);
  return !messages || messages.length === 0;
}

export function setProjectSubmissionKey(projectId: string, submissionKey: string) {
  if (!projectId || !submissionKey) return;
  projectSubmissionKeys.set(projectId, submissionKey);
}

export function getProjectSubmissionKey(projectId: string): string {
  const existing = projectSubmissionKeys.get(projectId);
  if (existing) return existing;
  const fallback = `proj-${projectId}`;
  projectSubmissionKeys.set(projectId, fallback);
  return fallback;
}

export async function createBranch(sourceId: string, branchName: string): Promise<Project> {
  const scope = accountScope;
  const newProj = createProject(branchName);
  
  // Clone files (check local cache/IndexedDB, falling back to edge preview API)
  let sourceFiles = await getProjectFilesAsync(sourceId);
  if (scope !== accountScope) throw new Error('Account changed during branch creation');
  if (!sourceFiles || Object.keys(sourceFiles).length === 0) {
    try {
      const res = await fetch(`/preview/${sourceId}/api/files`);
      if (res.ok) {
        const fetched = await res.json();
        if (fetched && typeof fetched === 'object' && Object.keys(fetched).length > 0) {
          sourceFiles = fetched;
        }
      }
    } catch {}
  }

  if (sourceFiles && Object.keys(sourceFiles).length > 0) {
    if (scope !== accountScope) throw new Error('Account changed during branch creation');
    saveProjectFiles(newProj.id, JSON.parse(JSON.stringify(sourceFiles)));
  }

  // Clone messages
  const sourceMsgs = await getProjectMessagesAsync(sourceId);
  if (scope !== accountScope) throw new Error('Account changed during branch creation');
  if (sourceMsgs) {
    saveProjectMessages(newProj.id, JSON.parse(JSON.stringify(sourceMsgs)));
  }
  
  return newProj;
}

export async function forkProject(sourceId: string, customName?: string): Promise<Project> {
  const currentProjects = getProjects();
  const sourceProj = currentProjects.find(p => p.id === sourceId);
  const name = customName || (sourceProj ? `Fork of ${sourceProj.name}` : `Fork of ${sourceId}`);
  return createBranch(sourceId, name);
}

export interface MergeResult {
  success: boolean;
  hasConflict: boolean;
  conflicts: string[];
  mergedFiles: Record<string, string>;
}

export async function mergeBranches(targetProjectId: string, sourceProjectId: string): Promise<MergeResult> {
  const scope = accountScope;
  const targetFiles = (await getProjectFilesAsync(targetProjectId)) || {};
  if (scope !== accountScope) throw new Error('Account changed during merge');
  const sourceFiles = (await getProjectFilesAsync(sourceProjectId)) || {};
  if (scope !== accountScope) throw new Error('Account changed during merge');

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
  // Sync the rename to the server so the admin project list (and any other
  // server-side view) shows the new name. Fire-and-forget: the local rename
  // must succeed even if the network call fails.
  try {
    void authFetch(`/api/projects/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
      signal: AbortSignal.timeout(15_000),
    }, { clearOnUnauthorized: false }).catch(() => {});
  } catch { /* never break local rename */ }
}

export function updateProjectMeta(id: string, meta: Partial<Project>) {
  const projects = getProjects().map(p => {
    if (p.id === id) {
      return { ...p, ...meta, updatedAt: Date.now() };
    }
    return p;
  });
  saveProjects(projects);
  appEvents.emit('project-list-updated');
}

/** Cache confirmed publication without making a status read look like an edit. */
export function updateProjectPublication(id: string, published: boolean) {
  if (!accountScope.accountId) return;
  const projects = getProjects();
  if (!projects.some(project => project.id === id && project.published !== published)) return;
  saveProjects(projects.map(project => project.id === id ? { ...project, published } : project));
  appEvents.emit('project-list-updated');
}

/** Last confirmed hosted release, separate from legacy preview-link visibility. */
export function updateProjectDeployment(id: string, published: boolean) {
  if (!accountScope.accountId || projectDeleted(id)) return;
  const projects = getProjects();
  if (!projects.some(project => project.id === id && project.productionPublished !== published)) return;
  saveProjects(projects.map(project => project.id === id ? { ...project, productionPublished: published } : project));
  appEvents.emit('project-list-updated');
}

export function deleteProject(id: string): Project[] {
  const wasActive = getActiveProjectId() === id;
  deletedProjectIds.add(id);
  projectSubmissionKeys.delete(id);
  try { localStorage.setItem(projectStorageKey(`deleted:project:${id}`), 'true'); } catch {}
  let projects = getProjects().filter(p => p.id !== id);
  if (projects.length === 0) {
    projects = [seedProject()];
  }
  saveProjects(projects);
  deleteProjectFiles(id);
  deleteProjectMessages(id);
  if (wasActive) {
    setActiveProjectId(projects[0].id);
  }
  return projects;
}

export async function deleteProjectDurably(id: string): Promise<Project[]> {
  const scope = accountScope;
  if (!scope.accountId) throw new Error('Sign in before deleting a project');
  const key = projectStorageKey(id);
  const marker = projectStorageKey(`deleted:project:${id}`);
  const legacyMarker = projectStorageKey(`deleted:${id}`);
  const remaining = deleteProject(id);
  // Remove any legacy localStorage file/message entries that may have been
  // written by older sessions before the localStorage-to-IDB migration.
  try {
    localStorage.removeItem(projectStorageKey(`${PROJECT_FILES_PREFIX}${id}`));
    localStorage.removeItem(projectStorageKey(`${PROJECT_MESSAGES_PREFIX}${id}`));
    localStorage.removeItem(`brainhalf_files_${id}`);
    localStorage.removeItem(`brainhalf_messages_${id}`);
    localStorage.removeItem(`brainhalf_${id}`);
  } catch { /* best-effort; IDB cleanup below is the critical path */ }
  const database = await getDb();
  if (!database) {
    if (scope !== accountScope) throw new Error('Account changed during deletion');
    return remaining;
  }
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(['files', 'messages'], 'readwrite');
    for (const name of ['files', 'messages']) {
      transaction.objectStore(name).put(true, marker);
      transaction.objectStore(name).put(true, legacyMarker);
      transaction.objectStore(name).delete(key);
      transaction.objectStore(name).delete(id);
    }
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(new Error('Server deletion succeeded, but browser cleanup failed. Retry to finish cleanup.'));
    transaction.onabort = () => reject(new Error('Server deletion succeeded, but browser cleanup was interrupted. Retry to finish cleanup.'));
  });
  if (scope !== accountScope) throw new Error('Account changed during deletion');
  return remaining;
}

/**
 * Soft-delete used by purgeEmptyDrafts. Removes the project from the list and
 * clears localStorage caches, but preserves IndexedDB file/message data for 7
 * days so recoverProjectFiles() can still return them. This is the only safe
 * way to purge: a false-positive hard-delete is unrecoverable.
 */
export function softDeleteProject(id: string): Project[] {
  const wasActive = getActiveProjectId() === id;
  deletedProjectIds.add(id);
  projectSubmissionKeys.delete(id);
  try { localStorage.setItem(projectStorageKey(`deleted:project:${id}`), 'true'); } catch {}
  try { localStorage.setItem(projectStorageKey(`deleted:purge_ts:${id}`), String(Date.now())); } catch {}
  let projects = getProjects().filter(p => p.id !== id);
  if (projects.length === 0) projects = [seedProject()];
  saveProjects(projects);
  delete memoryCache[`files_${id}`];
  delete memoryCache[`messages_${id}`];
  markStorageWrite(`files_${id}`);
  markStorageWrite(`messages_${id}`);
  // Remove any legacy localStorage entries from older sessions.
  try { localStorage.removeItem(projectStorageKey(`${PROJECT_FILES_PREFIX}${id}`)); } catch {}
  try { localStorage.removeItem(projectStorageKey(`${PROJECT_MESSAGES_PREFIX}${id}`)); } catch {}
  if (wasActive) setActiveProjectId(projects[0].id);
  return projects;
}

export const PURGE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Flush IDB data for projects that were soft-deleted more than 7 days ago.
 * Called lazily during purgeEmptyDrafts.
 */
export async function flushExpiredPurges(): Promise<void> {
  if (!accountScope.accountId) return;
  const now = Date.now();
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !key.includes(':deleted:purge_ts:')) continue;
    const ts = Number(localStorage.getItem(key));
    if (!ts || now - ts < PURGE_RETENTION_MS) continue;
    const projectId = key.slice(key.lastIndexOf(':deleted:purge_ts:') + ':deleted:purge_ts:'.length);
    if (!projectId) continue;
    if (!projectDeleted(projectId)) {
      try { localStorage.removeItem(key); } catch {}
      continue;
    }
    try { localStorage.removeItem(key); } catch {}
    void idbDelete('files', projectId);
    void idbDelete('messages', projectId);
  }
}

const PROJECT_FILES_PREFIX = 'brainhalf_files_';
const PROJECT_MESSAGES_PREFIX = 'brainhalf_messages_';

// In-memory cache for fast synchronous access
const memoryCache: Record<string, any> = {};
const storageRevisions = new Map<string, number>();

function markStorageWrite(key: string) {
  storageRevisions.set(key, (storageRevisions.get(key) || 0) + 1);
}

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
        req.onerror = () => { dbPromise = null; reject(req.error); };
      } catch (err) {
        reject(err);
      }
    });
  }
  return dbPromise;
}

async function readIdbKey<T>(storeName: 'files' | 'messages', key: string): Promise<T | null> {
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

export async function idbGet<T>(storeName: 'files' | 'messages', key: string): Promise<T | null> {
  const scope = accountScope;
  if (!scope.accountId) return null;
  const result = await readIdbKey<T>(storeName, projectStorageKey(key));
  return scope === accountScope ? result : null;
}

export async function idbSet(storeName: 'files' | 'messages', key: string, value: any): Promise<void> {
  if (!accountScope.accountId) return;
  const scopedKey = projectStorageKey(key);
  const markerKey = projectStorageKey(`deleted:project:${key}`);
  const dbPromiseLocal = getDb();
  if (!dbPromiseLocal) return;
  try {
    const db = await dbPromiseLocal;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        if (key.startsWith('deleted:')) {
          store.put(value, scopedKey);
        } else {
          const marker = store.get(markerKey);
          marker.onsuccess = () => { if (!marker.result) store.put(value, scopedKey); };
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
      } catch {
        resolve();
      }
    });
  } catch {
    // Graceful no-op if IDB fails
  }
}

export async function idbDelete(storeName: 'files' | 'messages', key: string): Promise<void> {
  if (!accountScope.accountId) return;
  const scopedKey = projectStorageKey(key);
  const dbPromiseLocal = getDb();
  if (!dbPromiseLocal) return;
  try {
    const db = await dbPromiseLocal;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        store.delete(scopedKey);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
      } catch {
        resolve();
      }
    });
  } catch {
    // Graceful no-op if IDB fails
  }
}

/**
 * Fetch files + messages from the Durable Object's /snapshot endpoint and
 * cache both in IndexedDB. Returns null on auth failure or network error.
 * Deduplicates concurrent calls via snapshotInFlight.
 */
function fetchProjectSnapshot(projectId: string): Promise<{ files: Record<string, string>; messages: any[] } | null> {
  const existing = snapshotInFlight.get(projectId);
  if (existing) return existing;
  const scope = accountScope;
  const promise = (async () => {
    try {
      const origin = typeof window !== 'undefined' ? apiOrigin() : '';
      const res = await authFetch(`${origin}/agents/chat-agent/${encodeURIComponent(projectId)}/snapshot`, {
        signal: AbortSignal.timeout(15_000),
      }, { clearOnUnauthorized: false });
      if (!res.ok) return null;
      const body = await res.json().catch(() => null) as { files?: unknown; messages?: unknown } | null;
      if (!body || typeof body.files !== 'object' || !body.files) return null;
      const files = body.files as Record<string, string>;
      const messages = Array.isArray(body.messages) ? body.messages : [];
      if (scope !== accountScope || projectDeleted(projectId)) return null;
      // Cache both in IDB so subsequent reads hit the local store.
      void idbSet('files', projectId, files);
      void idbSet('messages', projectId, messages);
      memoryCache[`files_${projectId}`] = files;
      memoryCache[`messages_${projectId}`] = messages;
      markStorageWrite(`files_${projectId}`);
      markStorageWrite(`messages_${projectId}`);
      return { files, messages };
    } catch {
      return null;
    } finally {
      snapshotInFlight.delete(projectId);
    }
  })();
  snapshotInFlight.set(projectId, promise);
  return promise;
}

/**
 * One-time migration: reads file and message data written by older sessions into
 * localStorage, writes it to IndexedDB, then removes the localStorage entries.
 * Safe to call on every startup — reads are no-ops once the keys are gone.
 */
export async function migrateLocalStorageToIdb(): Promise<void> {
  if (!accountScope.accountId) return;
  if (typeof localStorage === 'undefined') return;
  const toMigrate: Array<{ store: 'files' | 'messages'; lsKey: string; idbKey: string }> = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      if (key.includes(':brainhalf_files_')) {
        const projectId = key.slice(key.lastIndexOf(':brainhalf_files_') + ':brainhalf_files_'.length);
        if (projectId) toMigrate.push({ store: 'files', lsKey: key, idbKey: projectId });
      } else if (key.includes(':brainhalf_messages_')) {
        const projectId = key.slice(key.lastIndexOf(':brainhalf_messages_') + ':brainhalf_messages_'.length);
        if (projectId) toMigrate.push({ store: 'messages', lsKey: key, idbKey: projectId });
      }
    }
  } catch { return; }
  for (const { store, lsKey, idbKey } of toMigrate) {
    try {
      const raw = localStorage.getItem(lsKey);
      if (!raw) { try { localStorage.removeItem(lsKey); } catch {} continue; }
      const parsed = JSON.parse(raw);
      // Only migrate if IDB doesn't already have a newer copy.
      const existing = await idbGet(store, idbKey);
      if (!existing) await idbSet(store, idbKey, parsed);
      try { localStorage.removeItem(lsKey); } catch {}
    } catch { /* skip entries that fail to parse or write */ }
  }
}

export function getProjectFiles(projectId: string): Record<string, string> | null {
  if (!accountScope.accountId || projectDeleted(projectId)) return null;
  const cacheKey = `files_${projectId}`;
  if (memoryCache[cacheKey]) {
    return memoryCache[cacheKey];
  }

  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(projectStorageKey(`${PROJECT_FILES_PREFIX}${projectId}`));
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
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
  const scope = accountScope;
  if (!scope.accountId || projectDeleted(projectId)) return null;
  const cacheKey = `files_${projectId}`;
  const revision = storageRevisions.get(cacheKey) || 0;
  if (revision > 0) return getProjectFiles(projectId);
  const idbResult = await idbGet<Record<string, string>>('files', projectId);
  if (scope !== accountScope || projectDeleted(projectId)) return null;
  if ((storageRevisions.get(cacheKey) || 0) !== revision) return getProjectFiles(projectId);
  if (idbResult) {
    memoryCache[cacheKey] = idbResult;
    return idbResult;
  }
  const cached = getProjectFiles(projectId);
  if (cached) return cached;
  // IDB, memory cache, and localStorage are all empty. Fetch from the
  // Durable Object — the canonical source of truth for project data.
  const snapshot = await fetchProjectSnapshot(projectId);
  if (scope !== accountScope || projectDeleted(projectId)) return null;
  if (snapshot?.files && Object.keys(snapshot.files).length > 0) return snapshot.files;
  return null;
}

async function readLegacy<T>(store: 'files' | 'messages', projectId: string): Promise<T | null> {
  const scope = accountScope;
  if (await idbGet<boolean>(store, `deleted:${projectId}`)) return null;
  if (scope !== accountScope) return null;
  try { if (localStorage.getItem(projectStorageKey(`deleted:${store}:${projectId}`))) return null; } catch {}
  const stored = await readIdbKey<T>(store, projectId);
  if (scope !== accountScope) return null;
  if (stored) return stored;
  try { return JSON.parse(localStorage.getItem(`brainhalf_${store}_${projectId}`) || 'null'); } catch { return null; }
}

export function saveProjectFiles(projectId: string, files: Record<string, string>) {
  if (!projectId || !files) return;
  persistFiles(projectId, files);
}

/**
 * Writes `files` for `projectId` to the memory cache, IndexedDB, and
 * localStorage. Split out of saveProjectFiles() so the debounced path below
 * can share one implementation.
 */
function persistFiles(projectId: string, files: Record<string, string>) {
  if (!accountScope.accountId || projectDeleted(projectId)) return;
  // A write still in the debounce window holds an older snapshot and would
  // overwrite this one when it fires. Any newer state being persisted
  // explicitly supersedes it.
  const pending = pendingFileWrites.get(projectId);
  if (pending) {
    clearTimeout(pending);
    pendingFileWrites.delete(projectId);
  }
  memoryCache[`files_${projectId}`] = files;
  markStorageWrite(`files_${projectId}`);
  // IndexedDB is the sole durable store for project file data.
  void idbSet('files', projectId, files);
}

// Monaco calls the change handler on every keystroke. Each call used to
// JSON.stringify() the whole file map and write it to localStorage
// synchronously, which is real main-thread cost on a multi-file project and
// none of those intermediate states are worth keeping -- only the latest one
// is. The debounce collapses a burst of edits into a single write.
const EDITOR_SAVE_DEBOUNCE_MS = 400;
const pendingFileWrites = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Persists files on a trailing debounce. The memory cache is updated
 * immediately, so reads between the edit and the write still see the editor's
 * current content rather than the last persisted snapshot.
 */
export function saveProjectFilesDebounced(projectId: string, files: Record<string, string>) {
  if (projectDeleted(projectId)) return;
  if (!accountScope.accountId || !projectId || !files) return;
  memoryCache[`files_${projectId}`] = files;
  markStorageWrite(`files_${projectId}`);

  const pending = pendingFileWrites.get(projectId);
  if (pending) clearTimeout(pending);
  pendingFileWrites.set(projectId, setTimeout(() => {
    pendingFileWrites.delete(projectId);
    persistFiles(projectId, files);
  }, EDITOR_SAVE_DEBOUNCE_MS));
}

/**
 * Writes anything still inside the debounce window. Call on pagehide /
 * visibilitychange so an edit made less than EDITOR_SAVE_DEBOUNCE_MS before
 * the tab is closed or hidden is not lost.
 */
export function flushProjectFileWrites(): void {
  for (const [projectId, timer] of pendingFileWrites) {
    clearTimeout(timer);
    pendingFileWrites.delete(projectId);
    const pendingFiles = memoryCache[`files_${projectId}`];
    if (pendingFiles) persistFiles(projectId, pendingFiles);
  }
}

export function deleteProjectFiles(projectId: string) {
  if (!accountScope.accountId) return;
  void idbSet('files', `deleted:${projectId}`, true);
  // A write still in the debounce window would otherwise land after the
  // delete and resurrect the files the user just got rid of.
  const pending = pendingFileWrites.get(projectId);
  if (pending) {
    clearTimeout(pending);
    pendingFileWrites.delete(projectId);
  }
  delete memoryCache[`files_${projectId}`];
  markStorageWrite(`files_${projectId}`);
  void idbDelete('files', projectId);
  // Remove any legacy localStorage copy so old data can't resurface through
  // the synchronous getProjectFiles fallback path.
  try { localStorage.removeItem(projectStorageKey(`${PROJECT_FILES_PREFIX}${projectId}`)); } catch {}
}

export function getProjectMessages(projectId: string): any[] | null {
  if (!accountScope.accountId || projectDeleted(projectId)) return null;
  const cacheKey = `messages_${projectId}`;
  if (memoryCache[cacheKey]) {
    return memoryCache[cacheKey];
  }

  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(projectStorageKey(`${PROJECT_MESSAGES_PREFIX}${projectId}`));
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
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
  const scope = accountScope;
  if (!scope.accountId || projectDeleted(projectId)) return null;
  const cacheKey = `messages_${projectId}`;
  const revision = storageRevisions.get(cacheKey) || 0;
  if (revision > 0) return getProjectMessages(projectId);
  const idbResult = await idbGet<any[]>('messages', projectId);
  if (scope !== accountScope || projectDeleted(projectId)) return null;
  if ((storageRevisions.get(cacheKey) || 0) !== revision) return getProjectMessages(projectId);
  if (idbResult) {
    memoryCache[cacheKey] = idbResult;
    return idbResult;
  }
  const cached = getProjectMessages(projectId);
  if (cached) return cached;
  // IDB, memory cache, and localStorage are all empty. Fetch from the
  // Durable Object — the canonical source of truth. The snapshot call is
  // deduped so getProjectFilesAsync and this both share one HTTP request.
  const snapshot = await fetchProjectSnapshot(projectId);
  if (scope !== accountScope || projectDeleted(projectId)) return null;
  if (Array.isArray(snapshot?.messages)) return snapshot.messages;
  return null;
}

/**
 * Recovery export: read project files from IndexedDB even if the project has a
 * local deletion marker or the server returns 410. This bypasses the normal
 * projectDeleted() guard so the user can salvage work.
 */
export async function recoverProjectFiles(projectId: string): Promise<Record<string, string> | null> {
  if (!accountScope.accountId) return null;
  const scopedKey = projectStorageKey(projectId);
  const result = await readIdbKey<Record<string, string>>('files', scopedKey);
  if (result && typeof result === 'object' && !Array.isArray(result)) return result;
  const legacy = await readIdbKey<Record<string, string>>('files', projectId);
  if (legacy && typeof legacy === 'object' && !Array.isArray(legacy)) return legacy;
  try {
    const raw = localStorage.getItem(projectStorageKey(`${PROJECT_FILES_PREFIX}${projectId}`));
    if (raw) { const parsed = JSON.parse(raw); if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed; }
  } catch {}
  return null;
}

export function getProjectDisplayTitle(proj: Project): string {
  if (!proj) return 'Untitled Project';

  // A chosen name must survive subsequent messages and landing-page reloads.
  const name = (proj.name || '').trim().replace(/\s+/g, ' ');
  const customName = name && !/^Project \d+$/i.test(name) && !['Untitled Project', 'New project'].includes(name);
  const msgs = getProjectMessages(proj.id);
  if (msgs && Array.isArray(msgs)) {
    const firstUserMsg = msgs.find(
      m => m && m.role === 'user' && !m.internal && typeof m.content === 'string' && m.content.trim().length > 0 && !isSystemContinuation(m.content)
    );
    if (firstUserMsg && firstUserMsg.content) {
      const cleaned = firstUserMsg.content.trim().replace(/\s+/g, ' ');
      // Older project creation stored only a prompt prefix as the name.
      // Expand that prefix for display; CSS handles the available line length.
      const automaticPrefix = /(?:…|\.\.\.)$/.test(name) && cleaned.startsWith(name.replace(/(?:…|\.\.\.)$/, ''));
      return customName && !automaticPrefix ? name : cleaned;
    }
  }

  return name || 'New project';
}

export function saveProjectMessages(projectId: string, messages: any[]) {
  if (!accountScope.accountId || !projectId || !messages || projectDeleted(projectId)) return;
  // B1: never persist poisoned turns (empty/placeholder AI replies from failed
  // attempts). The live conversation keeps them for display; storage only ever
  // sees real turns, so a reload can never resurrect the failure loop.
  const clean = stripPoisonedTail(messages);
  memoryCache[`messages_${projectId}`] = clean;
  markStorageWrite(`messages_${projectId}`);
  // IndexedDB is the sole durable store for project message data.
  void idbSet('messages', projectId, clean);

  // Once a project has real messages, promote it out of 'draft' status so
  // isEmptyDraftProject() cannot false-positive on the next session reload.
  if (clean.length > 0) {
    const projects = getProjects();
    const proj = projects.find(p => p.id === projectId);
    if (proj?.status === 'draft') {
      saveProjects(projects.map(p => p.id === projectId ? { ...p, status: 'ready' } : p));
    }
  }
}

export function deleteProjectMessages(projectId: string) {
  if (!accountScope.accountId) return;
  void idbSet('messages', `deleted:${projectId}`, true);
  delete memoryCache[`messages_${projectId}`];
  markStorageWrite(`messages_${projectId}`);
  void idbDelete('messages', projectId);
  try { localStorage.removeItem(projectStorageKey(`${PROJECT_MESSAGES_PREFIX}${projectId}`)); } catch {}
}

export function bindProjectStore() {
  const scope = accountScope;
  const current = () => scope === accountScope;
  return {
    isCurrent: current,
    getProjects: () => current() ? getProjects() : [],
    getProjectFiles: (id: string) => current() ? getProjectFiles(id) : null,
    getProjectMessages: (id: string) => current() ? getProjectMessages(id) : null,
    getProjectFilesAsync: (id: string) => current() ? getProjectFilesAsync(id) : Promise.resolve(null),
    getProjectMessagesAsync: (id: string) => current() ? getProjectMessagesAsync(id) : Promise.resolve(null),
    saveProjectFiles: (id: string, files: Record<string, string>) => { if (current()) saveProjectFiles(id, files); },
    saveProjectFilesDebounced: (id: string, files: Record<string, string>) => { if (current()) saveProjectFilesDebounced(id, files); },
    saveProjectMessages: (id: string, messages: any[]) => { if (current()) saveProjectMessages(id, messages); },
    deleteProjectMessages: (id: string) => { if (current()) deleteProjectMessages(id); },
    deleteProject: (id: string) => current() ? deleteProject(id) : [],
    updateProjectName: (id: string, name: string) => { if (current()) updateProjectName(id, name); },
    setActiveProjectId: (id: string) => { if (current()) setActiveProjectId(id); },
    flushProjectFileWrites: () => { if (current()) flushProjectFileWrites(); },
    forkProject: (id: string, name?: string) => current() ? forkProject(id, name) : Promise.reject(new Error('Account changed')),
  };
}
