import type { AssetKind, AssetSearchHit } from './types';

const GH = 'https://raw.githubusercontent.com/KenneyNL';

/** Curated CC0 Kenney assets with direct raw GitHub URLs (no scraping). */
export const KENNEY_CATALOG: {
  name: string;
  tags: string[];
  url: string;
  assetKind: AssetKind;
  ext: string;
}[] = [
  // Space Shooter Redux — 2D sprites
  { name: 'Player Ship Blue', tags: ['ship', 'spaceship', 'player', 'space', 'shooter'], url: `${GH}/Space-Shooter-Redux/master/PNG/playerShip1_blue.png`, assetKind: 'sprite', ext: 'png' },
  { name: 'Player Ship Green', tags: ['ship', 'spaceship', 'player', 'space'], url: `${GH}/Space-Shooter-Redux/master/PNG/playerShip2_green.png`, assetKind: 'sprite', ext: 'png' },
  { name: 'Player Ship Orange', tags: ['ship', 'spaceship', 'player', 'space'], url: `${GH}/Space-Shooter-Redux/master/PNG/playerShip3_orange.png`, assetKind: 'sprite', ext: 'png' },
  { name: 'Enemy UFO Red', tags: ['ufo', 'enemy', 'ship', 'space', 'alien'], url: `${GH}/Space-Shooter-Redux/master/PNG/ufoRed.png`, assetKind: 'sprite', ext: 'png' },
  { name: 'Enemy UFO Green', tags: ['ufo', 'enemy', 'ship', 'space'], url: `${GH}/Space-Shooter-Redux/master/PNG/ufoGreen.png`, assetKind: 'sprite', ext: 'png' },
  { name: 'Laser Blue', tags: ['laser', 'bullet', 'projectile', 'weapon'], url: `${GH}/Space-Shooter-Redux/master/PNG/laserBlue01.png`, assetKind: 'sprite', ext: 'png' },
  { name: 'Meteor Brown', tags: ['meteor', 'asteroid', 'rock', 'space', 'obstacle'], url: `${GH}/Space-Shooter-Redux/master/PNG/meteorBrown_big1.png`, assetKind: 'sprite', ext: 'png' },
  { name: 'Starfield Background', tags: ['star', 'starfield', 'space', 'background', 'sky'], url: `${GH}/Space-Shooter-Redux/master/Backgrounds/black.png`, assetKind: 'texture', ext: 'png' },
  { name: 'Space Background Purple', tags: ['space', 'background', 'nebula', 'sky'], url: `${GH}/Space-Shooter-Redux/master/Backgrounds/purple.png`, assetKind: 'texture', ext: 'png' },
  // Platformer Starter Kit — 3D GLB
  { name: 'Platform Grass Block', tags: ['platform', 'grass', 'block', '3d', 'tile'], url: `${GH}/Starter-Kit-3D-Platformer/main/models/gltf/platform-grass.glb`, assetKind: 'model', ext: 'glb' },
  { name: 'Player Character', tags: ['character', 'player', '3d', 'humanoid'], url: `${GH}/Starter-Kit-3D-Platformer/main/models/gltf/character-player.glb`, assetKind: 'model', ext: 'glb' },
  { name: 'Coin', tags: ['coin', 'pickup', 'collectible', '3d'], url: `${GH}/Starter-Kit-3D-Platformer/main/models/gltf/coin.glb`, assetKind: 'model', ext: 'glb' },
  { name: 'Spike Block', tags: ['spike', 'hazard', 'trap', '3d'], url: `${GH}/Starter-Kit-3D-Platformer/main/models/gltf/spike-block.glb`, assetKind: 'model', ext: 'glb' },
  { name: 'Grass Block', tags: ['block', 'grass', 'cube', '3d'], url: `${GH}/Starter-Kit-3D-Platformer/main/models/gltf/block-grass.glb`, assetKind: 'model', ext: 'glb' },
  // UI / generic
  { name: 'UI Button Blue', tags: ['ui', 'button', 'menu'], url: `${GH}/UI-pack/Game-Icons/PNG/Blue/buttonLong_blue.png`, assetKind: 'sprite', ext: 'png' },
  { name: 'Crosshair', tags: ['crosshair', 'aim', 'ui', 'shooter'], url: `${GH}/Crosshair-Pack/master/PNG/White/crosshair001.png`, assetKind: 'sprite', ext: 'png' },
];

function tokenize(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 1);
}

function scoreMatch(queryTokens: string[], name: string, tags: string[]): number {
  const hay = `${name} ${tags.join(' ')}`.toLowerCase();
  let score = 0;
  for (const t of queryTokens) {
    if (hay.includes(t)) score += 2;
    if (tags.some((tag) => tag.includes(t) || t.includes(tag))) score += 3;
    if (name.toLowerCase().includes(t)) score += 2;
  }
  return score;
}

export function searchKenney(query: string, assetType: AssetKind, limit = 5): AssetSearchHit[] {
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];

  const hits: AssetSearchHit[] = [];
  for (const item of KENNEY_CATALOG) {
    if (assetType !== 'any' && item.assetKind !== assetType && !(assetType === 'texture' && item.assetKind === 'sprite')) {
      continue;
    }
    const score = scoreMatch(tokens, item.name, item.tags);
    if (score <= 0) continue;
    hits.push({
      source: 'kenney',
      title: item.name,
      url: item.url,
      score,
      assetKind: item.assetKind,
      license: 'CC0',
      ext: item.ext,
    });
  }

  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}
