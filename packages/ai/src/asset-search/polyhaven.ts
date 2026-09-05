import type { AssetSearchHit, AssetSearchEnv } from './types';

interface PolyHavenAsset {
  name?: string;
  type?: number;
  tags?: string[];
  categories?: string[];
}

/** Search Poly Haven (free CC0 3D models & HDRIs, no API key). */
export async function searchPolyHaven(query: string, limit = 5): Promise<AssetSearchHit[]> {
  const q = encodeURIComponent(query.trim());
  const res = await fetch(`https://api.polyhaven.com/assets?t=models&q=${q}`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) return [];

  const data = (await res.json()) as Record<string, PolyHavenAsset>;
  const tokens = query.toLowerCase().split(/\W+/).filter(Boolean);

  const hits: AssetSearchHit[] = [];
  for (const [id, meta] of Object.entries(data)) {
    const hay = `${meta.name ?? ''} ${(meta.tags ?? []).join(' ')} ${(meta.categories ?? []).join(' ')}`.toLowerCase();
    let score = 0;
    for (const t of tokens) {
      if (hay.includes(t)) score += 2;
    }
    if (score === 0 && tokens.length > 0) continue;
    hits.push({
      source: 'polyhaven',
      title: meta.name || id,
      url: `polyhaven://${id}`,
      score: score || 1,
      assetKind: 'model',
      license: 'CC0',
      ext: 'glb',
    });
  }

  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** Resolve polyhaven://id to a downloadable GLB URL and fetch bytes. */
export async function downloadPolyHavenModel(assetId: string): Promise<{ url: string; data: Uint8Array; contentType: string }> {
  const filesRes = await fetch(`https://api.polyhaven.com/files/${assetId}`);
  if (!filesRes.ok) throw new Error(`Poly Haven files API ${filesRes.status} for ${assetId}`);

  const files = (await filesRes.json()) as Record<string, unknown>;
  const gltf = files.gltf as Record<string, Record<string, { url?: string }>> | undefined;
  const glb = files.glb as Record<string, { url?: string }> | undefined;

  let downloadUrl: string | undefined;

  if (glb) {
    const sizes = Object.keys(glb).sort();
    downloadUrl = glb[sizes[0]]?.url;
  }
  if (!downloadUrl && gltf) {
    const sizes = Object.keys(gltf).sort();
    const entry = gltf[sizes[0]];
    downloadUrl = entry?.gltf?.url ?? entry?.glb?.url;
  }

  if (!downloadUrl) throw new Error(`No GLB/GLTF download for Poly Haven asset ${assetId}`);

  const binRes = await fetch(downloadUrl);
  if (!binRes.ok) throw new Error(`Poly Haven download failed (${binRes.status})`);

  const buf = await binRes.arrayBuffer();
  return {
    url: downloadUrl,
    data: new Uint8Array(buf),
    contentType: downloadUrl.endsWith('.glb') ? 'model/gltf-binary' : 'model/gltf+json',
  };
}

export async function downloadPolyHavenHit(hit: AssetSearchHit): Promise<{ url: string; data: Uint8Array; contentType: string }> {
  const id = hit.url.replace('polyhaven://', '');
  return downloadPolyHavenModel(id);
}
