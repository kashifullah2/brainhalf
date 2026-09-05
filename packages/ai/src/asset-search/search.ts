import { searchKenney } from './kenney-catalog';
import { searchPollinations } from './pollinations';
import { searchPolyHaven, downloadPolyHavenHit } from './polyhaven';
import { searchPolyPizza, downloadPolyPizzaHit } from './polypizza';
import { searchOpenGameArt, downloadOpenGameArtHit } from './opengameart';
import { searchHuggingFace, downloadHuggingFaceHit } from './huggingface';
import type {
  AssetDownloadResult,
  AssetKind,
  AssetSearchEnv,
  AssetSearchHit,
  AssetSearchRequest,
  AssetSourceName,
  AssetSourcePreference,
} from './types';

export * from './types';
export { KENNEY_CATALOG } from './kenney-catalog';
export { buildPollinationsUrl } from './pollinations';

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'asset';
}

function folderForKind(kind: AssetKind, ext: string): string {
  if (kind === 'model' || ext === 'glb' || ext === 'gltf') return 'assets/models';
  if (kind === 'sound' || ext === 'wav' || ext === 'ogg') return 'assets/sounds';
  if (kind === 'sprite') return 'assets/sprites';
  return 'assets/textures';
}

function usageHint(localPath: string, kind: AssetKind): string {
  const p = `/${localPath}`;
  if (kind === 'model') {
    return `Load with GLTFLoader: loader.load('${p}', (gltf) => scene.add(gltf.scene)). Scale as needed.`;
  }
  if (kind === 'sound') {
    return `Play with new Audio('${p}') or your engine's audio loader.`;
  }
  if (kind === 'sprite') {
    return `Use as Phaser image key or THREE.TextureLoader / CSS background-image url('${p}').`;
  }
  return `Use as texture: new THREE.TextureLoader().load('${p}') or Phaser this.load.image('tex', '${p}').`;
}

async function downloadUrl(url: string): Promise<{ data: Uint8Array; contentType: string }> {
  const res = await fetch(url, { headers: { Accept: '*/*' } });
  if (!res.ok) throw new Error(`Download failed (${res.status}): ${url}`);
  const ct = res.headers.get('content-type') || 'application/octet-stream';
  return { data: new Uint8Array(await res.arrayBuffer()), contentType: ct };
}

async function gatherHits(
  req: AssetSearchRequest,
  env: AssetSearchEnv,
): Promise<AssetSearchHit[]> {
  const assetType = req.asset_type ?? 'any';
  const query = `${req.query} ${req.style ?? ''}`.trim();
  const source = req.source ?? 'auto';
  const all: AssetSearchHit[] = [];

  const trySource = async (name: AssetSourcePreference, fn: () => Promise<AssetSearchHit[]> | AssetSearchHit[]) => {
    if (source !== 'auto' && source !== name) return;
    try {
      const hits = await fn();
      all.push(...hits);
    } catch (err) {
      console.warn(`[asset-search] ${name} search failed:`, err);
    }
  };

  if (assetType === 'model' || assetType === 'any') {
    await trySource('kenney', () => searchKenney(query, 'model'));
    await trySource('polypizza', () => searchPolyPizza(query, env));
    await trySource('polyhaven', () => searchPolyHaven(query));
    await trySource('opengameart', () => searchOpenGameArt(query));
  }

  if (assetType === 'texture' || assetType === 'sprite' || assetType === 'any') {
    await trySource('kenney', () => searchKenney(query, assetType === 'any' ? 'any' : assetType));
    await trySource('pollinations', () => searchPollinations(query, req.style));
    if (env.huggingFaceApiKey) {
      await trySource('pollinations', () => searchHuggingFace(query, req.style));
    }
    await trySource('opengameart', () => searchOpenGameArt(query));
  }

  if (assetType === 'sound' || assetType === 'any') {
    await trySource('opengameart', () => searchOpenGameArt(`${query} sound effect`));
  }

  return all.sort((a, b) => b.score - a.score);
}

async function downloadHit(hit: AssetSearchHit, env: AssetSearchEnv): Promise<{ data: Uint8Array; contentType: string; ext: string; assetKind: AssetKind }> {
  if (hit.source === 'polyhaven') {
    const d = await downloadPolyHavenHit(hit);
    return { ...d, ext: 'glb', assetKind: 'model' };
  }
  if (hit.source === 'polypizza') {
    const d = await downloadPolyPizzaHit(hit);
    return { ...d, ext: 'glb', assetKind: 'model' };
  }
  if (hit.source === 'opengameart') {
    const d = await downloadOpenGameArtHit(hit);
    return { data: d.data, contentType: d.contentType, ext: d.ext, assetKind: d.assetKind as AssetKind };
  }
  if (hit.source === 'huggingface' && env.huggingFaceApiKey) {
    const d = await downloadHuggingFaceHit(hit, env.huggingFaceApiKey);
    return { ...d, ext: 'png', assetKind: 'texture' };
  }

  const d = await downloadUrl(hit.url);
  const ext = hit.ext || hit.url.split('.').pop()?.split('?')[0] || 'bin';
  return { ...d, ext, assetKind: hit.assetKind === 'any' ? 'texture' : hit.assetKind };
}

/** Search free asset libraries and download the best match into memory. */
export async function searchAndDownloadAsset(
  req: AssetSearchRequest,
  env: AssetSearchEnv = {},
): Promise<AssetDownloadResult> {
  const query = req.query?.trim();
  if (!query) {
    return {
      success: false,
      source: 'procedural',
      title: '',
      localPath: '',
      contentType: '',
      data: new Uint8Array(),
      usageHint: '',
      error: 'query is required',
    };
  }

  const hits = await gatherHits(req, env);
  if (hits.length === 0) {
    return {
      success: false,
      source: 'procedural' as AssetSourceName,
      title: query,
      localPath: '',
      contentType: '',
      data: new Uint8Array(),
      usageHint: '',
      error: `No assets found for "${query}". Try fetch_asset for procedural generation, or refine the query.`,
    };
  }

  const errors: string[] = [];
  for (const hit of hits.slice(0, 6)) {
    try {
      const { data, contentType, ext, assetKind } = await downloadHit(hit, env);
      const stem = req.filename ? slugify(req.filename) : slugify(hit.title || query);
      const localPath = `${folderForKind(assetKind, ext)}/${stem}.${ext}`;

      return {
        success: true,
        source: hit.source,
        title: hit.title,
        localPath,
        contentType,
        data,
        usageHint: usageHint(localPath, assetKind),
      };
    } catch (err) {
      errors.push(`${hit.source}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return {
    success: false,
    source: hits[0].source,
    title: hits[0].title,
    localPath: '',
    contentType: '',
    data: new Uint8Array(),
    usageHint: '',
    error: `Found matches but download failed:\n${errors.join('\n')}`,
  };
}
