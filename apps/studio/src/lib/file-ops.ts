import { useStudioStore, FileNode } from "@stores/studio-store";
import { webContainerManager } from "./webcontainer";
import { persistAgentFile } from "./persistence";
import { syncPreviewAfterHtmlWrite } from "./preview-sync";

function buildPath(files: FileNode[], parentId: string | null, name: string): string {
  if (!parentId) return name;
  const parent = files.find((f) => f.id === parentId);
  if (!parent?.path) return name;
  return `${parent.path}/${name}`;
}

function uniqueName(files: FileNode[], parentId: string | null, baseName: string): string {
  const siblings = files.filter((f) => f.parentId === parentId);
  if (!siblings.some((s) => s.name === baseName)) return baseName;

  const dot = baseName.lastIndexOf(".");
  const hasExt = dot > 0;
  const stem = hasExt ? baseName.slice(0, dot) : baseName;
  const ext = hasExt ? baseName.slice(dot) : "";

  let i = 2;
  while (siblings.some((s) => s.name === `${stem}-${i}${ext}`)) i++;
  return `${stem}-${i}${ext}`;
}

function collectDescendantIds(files: FileNode[], rootId: string): Set<string> {
  const ids = new Set<string>([rootId]);
  let added = true;
  while (added) {
    added = false;
    for (const f of files) {
      if (f.parentId && ids.has(f.parentId) && !ids.has(f.id)) {
        ids.add(f.id);
        added = true;
      }
    }
  }
  return ids;
}

function repathSubtree(files: FileNode[], folderId: string, newFolderPath: string): FileNode[] {
  const folder = files.find((f) => f.id === folderId);
  if (!folder?.path) return files;
  const oldPrefix = folder.path;

  return files.map((f) => {
    if (f.id === folderId) {
      return { ...f, path: newFolderPath, name: newFolderPath.split("/").pop() || f.name };
    }
    if (f.path?.startsWith(`${oldPrefix}/`)) {
      const suffix = f.path.slice(oldPrefix.length);
      return { ...f, path: `${newFolderPath}${suffix}` };
    }
    return f;
  });
}

/** Creates a new file in the tree + WebContainer. Returns the new node id. */
export async function createProjectFile(
  parentId: string | null,
  suggestedName = "untitled.js",
): Promise<string | null> {
  const store = useStudioStore.getState();
  const files = store.projectFiles;
  const name = uniqueName(files, parentId, suggestedName);
  const path = buildPath(files, parentId, name);
  const content = name.endsWith(".html")
    ? "<!DOCTYPE html>\n<html>\n<body></body>\n</html>\n"
    : name.endsWith(".css")
      ? "/* styles */\n"
      : name.endsWith(".json")
        ? "{}\n"
        : "// new file\n";

  const id = `file-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const node: FileNode = {
    id,
    name,
    type: "file",
    parentId,
    path,
    content,
    isDirty: true,
  };

  try {
    await webContainerManager.writeFiles({ [path]: content });
  } catch (err) {
    console.error("[file-ops] createProjectFile:", err);
    return null;
  }

  store.setProjectFiles([...files, node]);
  store.setSaveStatus("Unsaved changes");
  store.openFile(id);
  void persistAgentFile(path, content);

  if (path.endsWith(".html")) {
    void syncPreviewAfterHtmlWrite(path, content);
  }

  if (parentId) {
    // Ensure parent folder stays expanded — caller can handle via expandedFolders
  }

  return id;
}

/** Creates a new folder in the tree + WebContainer. */
export async function createProjectFolder(
  parentId: string | null,
  suggestedName = "new-folder",
): Promise<string | null> {
  const store = useStudioStore.getState();
  const files = store.projectFiles;
  const name = uniqueName(files, parentId, suggestedName);
  const path = buildPath(files, parentId, name);

  const id = `folder-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const node: FileNode = {
    id,
    name,
    type: "folder",
    parentId,
    path,
  };

  try {
    await webContainerManager.mkdir(path);
  } catch (err) {
    console.error("[file-ops] createProjectFolder:", err);
    return null;
  }

  store.setProjectFiles([...files, node]);
  return id;
}

/** Deletes a file or folder (and descendants) from the tree + WebContainer. */
export async function deleteProjectNode(id: string): Promise<boolean> {
  const store = useStudioStore.getState();
  const files = store.projectFiles;
  const target = files.find((f) => f.id === id);
  if (!target?.path) return false;

  const toRemove = collectDescendantIds(files, id);
  const paths = files.filter((f) => toRemove.has(f.id) && f.path).map((f) => f.path!);

  try {
    for (const p of paths.sort((a, b) => b.length - a.length)) {
      await webContainerManager.removePath(p);
    }
  } catch (err) {
    console.error("[file-ops] deleteProjectNode:", err);
    return false;
  }

  const remaining = files.filter((f) => !toRemove.has(f.id));
  store.setProjectFiles(remaining);

  for (const openId of [...store.openFiles]) {
    if (toRemove.has(openId)) store.closeFile(openId);
  }

  store.setSaveStatus(remaining.some((f) => f.isDirty) ? "Unsaved changes" : "Saved");
  return true;
}

/** Renames a file or folder and updates descendant paths. */
export async function renameProjectNode(id: string, newName: string): Promise<boolean> {
  const trimmed = newName.trim();
  if (!trimmed || trimmed.includes("/") || trimmed.includes("..")) return false;

  const store = useStudioStore.getState();
  const files = store.projectFiles;
  const target = files.find((f) => f.id === id);
  if (!target?.path) return false;

  const siblingConflict = files.some(
    (f) => f.parentId === target.parentId && f.id !== id && f.name === trimmed,
  );
  if (siblingConflict) return false;

  const parentPath = target.path.includes("/")
    ? target.path.slice(0, target.path.lastIndexOf("/"))
    : "";
  const newPath = parentPath ? `${parentPath}/${trimmed}` : trimmed;

  try {
    await webContainerManager.renamePath(target.path, newPath);
  } catch (err) {
    console.error("[file-ops] renameProjectNode:", err);
    return false;
  }

  let updated = files.map((f) =>
    f.id === id ? { ...f, name: trimmed, path: newPath, isDirty: f.type === "file" ? true : f.isDirty } : f,
  );

  if (target.type === "folder") {
    updated = repathSubtree(updated, id, newPath);
  }

  store.setProjectFiles(updated);
  if (target.type === "file") store.setSaveStatus("Unsaved changes");
  return true;
}

/** Resolves the parent folder id for context-menu targets (folder → self, file → parent). */
export function parentFolderIdForNode(files: FileNode[], nodeId: string): string | null {
  const node = files.find((f) => f.id === nodeId);
  if (!node) return null;
  if (node.type === "folder") return node.id;
  return node.parentId;
}
