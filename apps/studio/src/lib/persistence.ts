import { useStudioStore, FileNode } from "@stores/studio-store";
import { apiUrl } from "./api";
import { webContainerManager } from "./webcontainer";

/** Maps a file path to a coarse MIME-ish type for storage. */
function fileTypeFor(path: string): string {
  if (path.endsWith(".html")) return "text/html";
  if (path.endsWith(".css")) return "text/css";
  if (path.endsWith(".json")) return "application/json";
  if (/\.(js|mjs|ts|jsx|tsx)$/.test(path)) return "text/javascript";
  return "text/plain";
}

/**
 * Ensures a backend project exists for the current studio session.
 * Creates one on first save and pins it to the URL so a refresh reloads it.
 * Guarded by a module-level promise so concurrent callers share one create.
 * Returns null when the user is unauthenticated (anonymous sessions can't persist).
 */
let ensureProjectPromise: Promise<string | null> | null = null;

export function ensureProject(): Promise<string | null> {
  const existing = useStudioStore.getState().projectId;
  if (existing) return Promise.resolve(existing);
  if (ensureProjectPromise) return ensureProjectPromise;

  ensureProjectPromise = (async () => {
    const store = useStudioStore.getState();
    const is3d = store.gameType === "3D";
    try {
      const res = await fetch(apiUrl("/api/projects"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          title: store.projectTitle || "Untitled Game",
          gameType: is3d ? "3d" : "2d",
          engine: is3d ? "threejs" : "phaser",
        }),
      });
      if (!res.ok) return null;
      const project = (await res.json()) as { id?: string };
      if (!project.id) return null;

      useStudioStore.getState().setProjectId(project.id);
      // Pin to URL so a refresh re-hydrates this project.
      try {
        const url = new URL(window.location.href);
        url.searchParams.set("projectId", project.id);
        window.history.replaceState({}, "", url.toString());
      } catch {
        /* non-fatal */
      }
      return project.id;
    } catch {
      return null;
    } finally {
      ensureProjectPromise = null;
    }
  })();

  return ensureProjectPromise;
}

/** Upserts a single file into the backend project store. */
export async function saveFile(projectId: string, filePath: string, content: string): Promise<boolean> {
  try {
    const res = await fetch(apiUrl(`/api/projects/${projectId}/files`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        filePath,
        fileContent: content,
        fileType: fileTypeFor(filePath),
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Persists every dirty file, then clears their dirty flags on success. */
export async function saveDirtyFiles(): Promise<void> {
  const state = useStudioStore.getState();
  const dirty = state.projectFiles.filter(
    (f) => f.type === "file" && f.isDirty && f.content != null,
  );
  if (dirty.length === 0) return;

  const projectId = await ensureProject();
  if (!projectId) return; // unauthenticated — keep local edits, don't lose them

  const persisted: string[] = [];
  for (const f of dirty) {
    const ok = await saveFile(projectId, f.path || f.name, f.content ?? "");
    if (ok) persisted.push(f.id);
  }
  if (persisted.length > 0) {
    useStudioStore.getState().markFilesPersisted(persisted);
  }
}

/** Persists a single file the agent just wrote (fire-and-forget friendly). */
export async function persistAgentFile(filePath: string, content: string): Promise<void> {
  const projectId = await ensureProject();
  if (!projectId) return;
  await saveFile(projectId, filePath, content);
}

interface StoredFile {
  filePath: string;
  fileContent: string | null;
}

/** Rebuilds a nested FileNode tree (with folder nodes) from flat stored paths. */
export function buildTreeFromFlat(files: StoredFile[]): FileNode[] {
  const nodes: FileNode[] = [];
  const folderByPath = new Map<string, FileNode>();
  let counter = 0;
  const nextId = () => `load-${counter++}`;

  const ensureFolder = (path: string): FileNode | null => {
    if (!path) return null;
    const found = folderByPath.get(path);
    if (found) return found;
    const parts = path.split("/");
    const name = parts.pop() as string;
    const parentPath = parts.join("/");
    const parent = ensureFolder(parentPath);
    const node: FileNode = {
      id: nextId(),
      name,
      type: "folder",
      parentId: parent?.id ?? null,
      path,
    };
    folderByPath.set(path, node);
    nodes.push(node);
    return node;
  };

  for (const f of files) {
    const parts = f.filePath.split("/");
    const name = parts.pop() as string;
    const parentPath = parts.join("/");
    const parent = ensureFolder(parentPath);
    nodes.push({
      id: nextId(),
      name,
      type: "file",
      parentId: parent?.id ?? null,
      path: f.filePath,
      content: f.fileContent ?? "",
    });
  }

  return nodes;
}

export interface CheckpointMeta {
  id: string;
  label: string;
  fileCount: number;
  createdAt: number | string;
}

/** Snapshots the current file set as a named, restorable checkpoint. */
export async function createCheckpoint(label: string): Promise<CheckpointMeta | null> {
  const projectId = await ensureProject();
  if (!projectId) return null;

  const files = useStudioStore.getState().projectFiles
    .filter((f) => f.type === "file" && f.content != null && f.path)
    .map((f) => ({ filePath: f.path as string, fileContent: f.content ?? "", fileType: fileTypeFor(f.path as string) }));
  if (files.length === 0) return null;

  try {
    const res = await fetch(apiUrl(`/api/projects/${projectId}/checkpoints`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ label: label.slice(0, 200), files }),
    });
    if (!res.ok) return null;
    return (await res.json()) as CheckpointMeta;
  } catch {
    return null;
  }
}

/** Lists existing checkpoints (newest first), metadata only. */
export async function listCheckpoints(): Promise<CheckpointMeta[]> {
  const projectId = useStudioStore.getState().projectId;
  if (!projectId) return [];
  try {
    const res = await fetch(apiUrl(`/api/projects/${projectId}/checkpoints`), {
      credentials: "include",
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { checkpoints?: CheckpointMeta[] };
    return data.checkpoints ?? [];
  } catch {
    return [];
  }
}

/** Restores a checkpoint: rewinds backend files, store tree, and WebContainer. */
export async function restoreCheckpoint(checkpointId: string): Promise<boolean> {
  const projectId = useStudioStore.getState().projectId;
  if (!projectId) return false;

  let stored: StoredFile[];
  try {
    const res = await fetch(apiUrl(`/api/projects/${projectId}/checkpoints/${checkpointId}/restore`), {
      method: "POST",
      credentials: "include",
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { files?: StoredFile[] };
    stored = data.files ?? [];
  } catch {
    return false;
  }

  const tree = buildTreeFromFlat(stored);
  useStudioStore.getState().setProjectFiles(tree);
  useStudioStore.getState().setSaveStatus("Saved");

  try {
    const fileMap: Record<string, string> = {};
    for (const f of tree) {
      if (f.type === "file" && f.path) fileMap[f.path] = f.content ?? "";
    }
    await webContainerManager.writeFiles(fileMap);
  } catch (err) {
    console.warn("[persistence] Could not mount restored files into WebContainer:", err);
  }

  return true;
}

/**
 * Loads a project's files from the backend, hydrates the store tree, and mounts
 * them into the WebContainer so the preview reflects saved work after a refresh.
 * Returns true when files were loaded.
 */
export async function loadProjectFiles(projectId: string): Promise<boolean> {
  let stored: StoredFile[];
  try {
    const res = await fetch(apiUrl(`/api/projects/${projectId}/files`), {
      credentials: "include",
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { files?: StoredFile[] };
    stored = data.files ?? [];
  } catch {
    return false;
  }

  if (stored.length === 0) return false;

  const tree = buildTreeFromFlat(stored);
  useStudioStore.getState().setProjectFiles(tree);
  useStudioStore.getState().setSaveStatus("Saved");

  // Open the entry file (prefer an index.html) so the user lands on something.
  const entry =
    tree.find((f) => f.type === "file" && f.path?.endsWith("index.html")) ||
    tree.find((f) => f.type === "file");
  if (entry) useStudioStore.getState().openFile(entry.id);

  // Mount into the WebContainer for live preview.
  try {
    const fileMap: Record<string, string> = {};
    for (const f of tree) {
      if (f.type === "file" && f.path) fileMap[f.path] = f.content ?? "";
    }
    await webContainerManager.writeFiles(fileMap);
  } catch (err) {
    console.warn("[persistence] Could not mount loaded files into WebContainer:", err);
  }

  return true;
}
