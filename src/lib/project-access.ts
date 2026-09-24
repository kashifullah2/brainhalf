import type { RegistryEnv } from './auth.ts';
import { isValidProjectId } from './crypto.ts';

export const PREVIEW_ACCESS_HEADER = 'x-brainhalf-preview-access';

export function isPublicPreviewFile(path: string): boolean {
  const normalized = '/' + path.replace(/^\/+/, '');
  if (normalized.includes('\\') || normalized.includes('%')) return false;
  if (normalized.split('/').some(segment => segment.startsWith('.') || /^(server|backend|secrets|credentials)$/i.test(segment))) return false;
  if (/\.(pem|key|p12|pfx|sql|sqlite|db|map)$/i.test(normalized)) return false;
  return /^\/(src|public|assets)\//.test(normalized)
    || /^\/(index\.html|(?:App|main|index)\.(jsx?|tsx?)|(?:styles?|index)\.css|favicon\.ico)$/.test(normalized);
}

export function isPublicPreviewRead(path: string): boolean {
  if (/\/api\/(files|sync)\/?$/.test(path)) return false;
  return path === '/' || path === '' || path.startsWith('/api/') || isPublicPreviewFile(path);
}

export async function checkPreviewAccess(
  env: RegistryEnv,
  projectId: string,
  userId: string | undefined,
  method: string,
  path: string,
  target: 'preview' | 'deployment' = 'preview',
): Promise<{ ok: true; owner: boolean } | { ok: false; status: number }> {
  if (!isValidProjectId(projectId)) return { ok: false, status: 400 };
  try {
    const registry = env.REGISTRY.get(env.REGISTRY.idFromName('auth'));
    const query = new URLSearchParams({ projectId, userId: userId || '' });
    const response = await registry.fetch(`https://registry/projects/access?${query}`);
    if (!response.ok) return { ok: false, status: response.status === 404 ? 404 : 503 };
    const access = await response.json() as { owner?: boolean; published?: boolean };
    if (userId && access.owner === true) return { ok: true, owner: true };
    if (access.published === true && (method === 'GET' || method === 'HEAD') && (target === 'deployment' || isPublicPreviewRead(path))) {
      return { ok: true, owner: false };
    }
    return { ok: false, status: userId ? 403 : 401 };
  } catch (error) {
    console.error('Preview authorization unavailable:', error);
    return { ok: false, status: 503 };
  }
}
