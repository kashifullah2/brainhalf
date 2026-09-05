import { apiUrl } from './api';
import { webContainerManager } from './webcontainer';
import { persistAgentFile } from './persistence';
import { useStudioStore } from '@stores/studio-store';
import { generateAsset, AssetType } from './asset-generator';

export type AssetSourcePreference =
  | 'auto'
  | 'kenney'
  | 'opengameart'
  | 'polypizza'
  | 'polyhaven'
  | 'pollinations'
  | 'procedural';

export interface SearchAssetParams {
  query: string;
  asset_type?: 'texture' | 'sprite' | 'model' | 'sound' | 'any';
  source?: AssetSourcePreference;
  style?: string;
  filename?: string;
}

export interface SearchAssetResult {
  path: string | null;
  note: string;
  source?: string;
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function registerFileInStore(path: string) {
  const store = useStudioStore.getState();
  const currentFiles = store.projectFiles;
  if (currentFiles.some((f) => f.type === 'file' && f.path === path)) return;

  const parts = path.split('/');
  const fileName = parts.pop() || 'asset';
  const parentPath = parts.join('/');
  const parentNode = currentFiles.find((f) => f.type === 'folder' && f.path === parentPath);

  store.setProjectFiles([
    ...currentFiles,
    {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: fileName,
      type: 'file' as const,
      parentId: parentNode?.id || null,
      path,
    },
  ]);
}

/**
 * Searches free asset libraries via the workers API, downloads the file,
 * and writes it into the WebContainer project for offline preview.
 */
export async function searchAndDownloadAsset(params: SearchAssetParams): Promise<SearchAssetResult> {
  try {
    const res = await fetch(apiUrl('/api/assets/search-and-download'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(params),
    });

    const data = (await res.json()) as {
      success?: boolean;
      error?: string;
      source?: string;
      title?: string;
      localPath?: string;
      dataBase64?: string;
      usageHint?: string;
    };

    if (!res.ok || !data.success || !data.localPath || !data.dataBase64) {
      const fallback = await generateAsset(
        (params.asset_type === 'model' ? 'model' : params.asset_type === 'sound' ? 'sound' : 'texture') as AssetType,
        params.query,
      );
      return {
        path: fallback.path,
        note: `${data.error || 'Library search failed'} — ${fallback.note}`,
        source: 'procedural',
      };
    }

    const bytes = base64ToBytes(data.dataBase64);
    await webContainerManager.writeBinaryFile(data.localPath, bytes);
    registerFileInStore(data.localPath);
    void persistAgentFile(data.localPath, `[binary ${bytes.length} bytes from ${data.source}]`);

    return {
      path: data.localPath,
      source: data.source,
      note:
        `Downloaded "${data.title}" from ${data.source} → ${data.localPath} (${bytes.length} bytes). ` +
        `${data.usageHint} Reference it in code with the local path — do NOT use external URLs.`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const fallback = await generateAsset('texture', params.query);
    return {
      path: fallback.path,
      note: `Asset API error (${msg}). ${fallback.note}`,
      source: 'procedural',
    };
  }
}
