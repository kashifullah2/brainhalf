import type { AssetSearchHit } from './types';

/** Hugging Face Inference API — optional AI texture generation. */
export async function generateHuggingFaceTexture(
  query: string,
  apiKey: string,
  style?: string,
): Promise<{ data: Uint8Array; contentType: string }> {
  const prompt = style ? `${style}, ${query}` : query;
  const model = 'stabilityai/stable-diffusion-xl-base-1.0';
  const res = await fetch(`https://api-inference.huggingface.co/models/${model}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'image/png',
    },
    body: JSON.stringify({ inputs: prompt }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    throw new Error(`Hugging Face inference failed (${res.status}): ${errText.slice(0, 200)}`);
  }

  const ct = res.headers.get('content-type') || 'image/png';
  return { data: new Uint8Array(await res.arrayBuffer()), contentType: ct };
}

export function searchHuggingFace(query: string, style?: string): AssetSearchHit[] {
  return [
    {
      source: 'huggingface',
      title: `HF texture: ${query}`,
      url: `huggingface://${encodeURIComponent(style ? `${style} ${query}` : query)}`,
      score: 0.5,
      assetKind: 'texture',
      license: 'model-dependent',
      ext: 'png',
    },
  ];
}

export async function downloadHuggingFaceHit(
  hit: AssetSearchHit,
  apiKey: string,
): Promise<{ data: Uint8Array; contentType: string }> {
  const prompt = decodeURIComponent(hit.url.replace('huggingface://', ''));
  return generateHuggingFaceTexture(prompt, apiKey);
}
