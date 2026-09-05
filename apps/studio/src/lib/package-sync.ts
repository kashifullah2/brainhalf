import { useStudioStore } from '@stores/studio-store';
import { webContainerManager } from './webcontainer';

/** Mirrors WebContainer package.json into the editor file tree. */
export async function syncPackageJsonToStore(): Promise<void> {
  let raw: string;
  try {
    raw = await webContainerManager.readFile('package.json');
  } catch {
    return;
  }

  const store = useStudioStore.getState();
  const existing = store.projectFiles.find((f) => f.path === 'package.json');

  if (existing) {
    if (existing.content === raw) return;
    store.setProjectFiles(
      store.projectFiles.map((f) => (f.id === existing.id ? { ...f, content: raw } : f)),
    );
    return;
  }

  store.setProjectFiles([
    ...store.projectFiles,
    {
      id: `pkg-${Date.now()}`,
      name: 'package.json',
      type: 'file',
      parentId: null,
      path: 'package.json',
      content: raw,
    },
  ]);
}
