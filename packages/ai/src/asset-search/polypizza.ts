import type { AssetSearchHit, AssetSearchEnv } from './types';

interface PolyPizzaModel {
  ID?: string;
  Title?: string;
  Tags?: string[];
  License?: string;
}

interface PolyPizzaSearchResponse {
  data?: PolyPizzaModel[];
  results?: PolyPizzaModel[];
}

/** Search Poly Pizza (low-poly GLB models). Requires POLY_PIZZA_API_KEY. */
export async function searchPolyPizza(
  query: string,
  env: AssetSearchEnv,
  limit = 5,
): Promise<AssetSearchHit[]> {
  const apiKey = env.polyPizzaApiKey?.trim();
  if (!apiKey) return [];

  const q = encodeURIComponent(query.trim());
  const res = await fetch(`https://api.poly.pizza/v1.1/search?q=${q}&limit=${limit}`, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
  });
  if (!res.ok) return [];

  const body = (await res.json()) as PolyPizzaSearchResponse;
  const models = body.data ?? body.results ?? [];

  return models.map((m, i) => ({
    source: 'polypizza' as const,
    title: m.Title || m.ID || 'Poly Pizza model',
    url: m.ID ? `https://static.poly.pizza/${m.ID}.glb` : '',
    score: limit - i,
    assetKind: 'model' as const,
    license: m.License || 'CC0',
    ext: 'glb',
  })).filter((h) => h.url);
}

export async function downloadPolyPizzaHit(hit: AssetSearchHit): Promise<{ url: string; data: Uint8Array; contentType: string }> {
  const res = await fetch(hit.url);
  if (!res.ok) throw new Error(`Poly Pizza download failed (${res.status}): ${hit.url}`);
  const buf = await res.arrayBuffer();
  return { url: hit.url, data: new Uint8Array(buf), contentType: 'model/gltf-binary' };
}
