import type { AssetSearchHit } from './types';

/** Scrape OpenGameArt search results for direct file download links. */
export async function searchOpenGameArt(query: string, limit = 5): Promise<AssetSearchHit[]> {
  const q = encodeURIComponent(query.trim());
  const res = await fetch(`https://opengameart.org/art-search-advanced?keys=${q}`, {
    headers: { Accept: 'text/html', 'User-Agent': 'BrainHalf-AssetBot/1.0' },
  });
  if (!res.ok) return [];

  const html = await res.text();
  const hits: AssetSearchHit[] = [];
  const seen = new Set<string>();

  // Match content pages linked from search results
  const linkRe = /href="(\/content\/[^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(html)) && hits.length < limit * 2) {
    const path = m[1];
    if (seen.has(path)) continue;
    seen.add(path);
    const titleMatch = html.match(new RegExp(`href="${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>([^<]+)`));
    const title = titleMatch?.[1]?.trim() || query;
    hits.push({
      source: 'opengameart',
      title,
      url: `https://opengameart.org${path}`,
      score: 1,
      assetKind: 'any',
      license: 'OGA',
    });
  }

  return hits.slice(0, limit);
}

/** Fetch an OGA content page and find the first downloadable file URL. */
export async function resolveOpenGameArtDownload(pageUrl: string): Promise<{ fileUrl: string; ext: string; assetKind: 'texture' | 'sprite' | 'model' | 'sound' }> {
  const res = await fetch(pageUrl, {
    headers: { Accept: 'text/html', 'User-Agent': 'BrainHalf-AssetBot/1.0' },
  });
  if (!res.ok) throw new Error(`OpenGameArt page fetch failed (${res.status})`);

  const html = await res.text();
  const fileRe = /href="(https:\/\/opengameart\.org\/sites\/default\/files\/[^"]+\.(png|jpg|jpeg|gif|webp|wav|ogg|mp3|glb|gltf|obj|zip))"/i;
  const match = fileRe.exec(html);
  if (!match) throw new Error('No downloadable file found on OpenGameArt page');

  const fileUrl = match[1];
  const ext = match[2].toLowerCase();
  let assetKind: 'texture' | 'sprite' | 'model' | 'sound' = 'texture';
  if (['wav', 'ogg', 'mp3'].includes(ext)) assetKind = 'sound';
  else if (['glb', 'gltf', 'obj', 'zip'].includes(ext)) assetKind = 'model';
  else if (['png', 'gif', 'webp'].includes(ext)) assetKind = 'sprite';

  return { fileUrl, ext, assetKind };
}

export async function downloadOpenGameArtHit(hit: AssetSearchHit): Promise<{ url: string; data: Uint8Array; contentType: string; ext: string; assetKind: string }> {
  const { fileUrl, ext, assetKind } = await resolveOpenGameArtDownload(hit.url);
  const res = await fetch(fileUrl);
  if (!res.ok) throw new Error(`OpenGameArt file download failed (${res.status})`);

  const buf = await res.arrayBuffer();
  const ct =
    ext === 'png' ? 'image/png'
    : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
    : ext === 'wav' ? 'audio/wav'
    : ext === 'ogg' ? 'audio/ogg'
    : ext === 'glb' ? 'model/gltf-binary'
    : 'application/octet-stream';

  return { url: fileUrl, data: new Uint8Array(buf), contentType: ct, ext, assetKind };
}
