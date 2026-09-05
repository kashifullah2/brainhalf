import { useStudioStore } from '@stores/studio-store';
import { webContainerManager } from './webcontainer';

let syncedOnce = false;

/** Writes the Zustand file tree into WebContainer so preview matches the editor. */
export async function syncStoreFilesToWebContainer(force = false): Promise<void> {
  if (syncedOnce && !force) return;

  const files = useStudioStore.getState().projectFiles;
  const map: Record<string, string> = {};
  for (const f of files) {
    if (f.type === 'file' && f.path && f.content != null) {
      map[f.path] = f.content;
    }
  }
  if (Object.keys(map).length === 0) return;

  try {
    await webContainerManager.writeFiles(map);
    syncedOnce = true;
    useStudioStore.getState().bumpPreviewReload();
  } catch (err) {
    console.warn('[sync-store] Could not sync files to WebContainer:', err);
  }
}

export function resetStoreSyncFlag(): void {
  syncedOnce = false;
}
