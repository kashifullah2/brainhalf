import type { AssetSearchHit } from './types';

function slugifyPrompt(text: string): string {
  return text
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9_,-]/g, '')
    .slice(0, 120) || 'game_texture';
}

/** Builds a Pollinations.ai image URL (free, no API key). */
export function buildPollinationsUrl(query: string, style?: string, width = 512, height = 512): string {
  const stylePrefix = style ? `${style}_` : '';
  const prompt = encodeURIComponent(`${stylePrefix}${query}`.replace(/\s+/g, '_'));
  return `https://image.pollinations.ai/prompt/${prompt}?width=${width}&height=${height}&nologo=true`;
}

export function searchPollinations(query: string, style?: string): AssetSearchHit[] {
  const url = buildPollinationsUrl(query, style);
  return [
    {
      source: 'pollinations',
      title: `AI texture: ${query}`,
      url,
      score: 1,
      assetKind: 'texture',
      license: 'generated',
      ext: 'png',
    },
  ];
}
