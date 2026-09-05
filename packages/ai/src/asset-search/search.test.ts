import { describe, it, expect } from 'vitest';
import { searchKenney, KENNEY_CATALOG } from './kenney-catalog';
import { buildPollinationsUrl } from './pollinations';

describe('asset-search', () => {
  it('finds Kenney spaceship sprites by query', () => {
    const hits = searchKenney('spaceship player space', 'sprite');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].source).toBe('kenney');
    expect(hits[0].url).toContain('KenneyNL');
  });

  it('catalog has CC0 Kenney entries', () => {
    expect(KENNEY_CATALOG.length).toBeGreaterThan(10);
  });

  it('builds Pollinations URL from prompt', () => {
    const url = buildPollinationsUrl('pixel art stone texture seamless', 'pixel_art');
    expect(url).toContain('pollinations.ai');
    expect(url).toContain('width=512');
  });
});
