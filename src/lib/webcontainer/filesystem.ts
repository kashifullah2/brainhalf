import type { WebContainer, FileSystemTree } from '@webcontainer/api';

export function filesToFileSystemTree(files: Record<string, string>): FileSystemTree {
  const tree: FileSystemTree = {};
  for (const [path, content] of Object.entries(files)) {
    const clean = path.startsWith('/') ? path.slice(1) : path;
    if (!clean) continue;
    const parts = clean.split('/');
    let current: any = tree;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!current[parts[i]]) current[parts[i]] = { directory: {} };
      current = current[parts[i]].directory;
    }
    current[parts[parts.length - 1]] = { file: { contents: content } };
  }
  return tree;
}

export async function mountFiles(container: WebContainer, files: Record<string, string>): Promise<void> {
  const tree = filesToFileSystemTree(files);
  await container.mount(tree);
}

export async function writeFile(container: WebContainer, path: string, content: string): Promise<void> {
  const clean = path.startsWith('/') ? path.slice(1) : path;
  const dir = clean.split('/').slice(0, -1).join('/');
  if (dir) await container.fs.mkdir(dir, { recursive: true });
  await container.fs.writeFile(clean, content);
}

export async function removeFile(container: WebContainer, path: string): Promise<void> {
  const clean = path.startsWith('/') ? path.slice(1) : path;
  try {
    await container.fs.rm(clean);
  } catch {
    // File may already be gone
  }
}

export async function syncDelta(
  container: WebContainer,
  changed: Record<string, string>,
  removed: string[],
): Promise<void> {
  const writes = Object.entries(changed).map(([p, c]) => writeFile(container, p, c));
  const deletes = removed.map(p => removeFile(container, p));
  await Promise.all([...writes, ...deletes]);
}
