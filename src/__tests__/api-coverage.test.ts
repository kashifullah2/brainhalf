import { describe, expect, it } from 'vitest';
import { extractApiFetches, extractWorkerRoutes, findUncoveredFetches, normalizeApiPath } from '../lib/api-coverage';

describe('normalizeApiPath', () => {
  it('replaces named :param segments', () => {
    expect(normalizeApiPath('/api/notes/:id')).toBe('/api/notes/:param');
    expect(normalizeApiPath('/api/users/:userId/posts/:postId')).toBe('/api/users/:param/posts/:param');
  });
  it('strips trailing wildcard', () => {
    expect(normalizeApiPath('/api/*')).toBe('/api');
    expect(normalizeApiPath('/api/notes/*')).toBe('/api/notes');
  });
  it('leaves clean paths unchanged', () => {
    expect(normalizeApiPath('/api/notes')).toBe('/api/notes');
  });
});

describe('extractApiFetches', () => {
  const files = (entries: Record<string, string>) =>
    new Map(Object.entries(entries).map(([k, v]) => [k.startsWith('/') ? k : '/' + k, v]));

  it('extracts single-quoted and double-quoted fetch calls', () => {
    const f = files({ '/src/App.tsx': "fetch('/api/notes'); fetch(\"/api/users\")" });
    expect(extractApiFetches(f).sort()).toEqual(['/api/notes', '/api/users']);
  });

  it('extracts template literal fetch calls (no variables)', () => {
    const f = files({ '/src/App.tsx': 'fetch(`/api/notes`)' });
    expect(extractApiFetches(f)).toEqual(['/api/notes']);
  });

  it('extracts static prefix from template literals with dynamic segments', () => {
    const f = files({ '/src/App.tsx': 'fetch(`/api/notes/${noteId}`)' });
    expect(extractApiFetches(f)).toEqual(['/api/notes/:param']);
  });

  it('strips query strings from extracted paths', () => {
    const f = files({ '/src/App.tsx': "fetch('/api/notes?active=true')" });
    expect(extractApiFetches(f)).toEqual(['/api/notes']);
  });

  it('ignores non-src files', () => {
    const f = files({ '/worker/index.ts': "fetch('/api/notes')", '/src/App.tsx': '' });
    expect(extractApiFetches(f)).toEqual([]);
  });

  it('ignores non-JS/TS files', () => {
    const f = files({ '/src/README.md': "fetch('/api/notes')" });
    expect(extractApiFetches(f)).toEqual([]);
  });

  it('deduplicates repeated fetch calls', () => {
    const f = files({ '/src/App.tsx': "fetch('/api/notes'); fetch('/api/notes')" });
    expect(extractApiFetches(f)).toEqual(['/api/notes']);
  });
});

describe('extractWorkerRoutes', () => {
  it('extracts chained .get/.post/.put/.patch/.delete route paths (deduplicated)', () => {
    const src = `
      app.get('/api/notes', handler)
      app.post('/api/notes', handler)
      app.put('/api/notes/:id', handler)
      app.delete('/api/notes/:id', handler)
    `;
    // Routes are deduplicated — GET and POST to the same path yield one entry.
    expect(extractWorkerRoutes(src).sort()).toEqual(['/api/notes', '/api/notes/:id'].sort());
  });

  it('handles .all() catch-all routes', () => {
    const src = "router.all('/api/*', handler)";
    expect(extractWorkerRoutes(src)).toEqual(['/api/*']);
  });

  it('is case-insensitive for the HTTP method', () => {
    const src = "app.GET('/api/health', handler)";
    expect(extractWorkerRoutes(src)).toEqual(['/api/health']);
  });

  it('ignores non-/api/ routes', () => {
    const src = "app.get('/health', handler); app.get('/api/users', handler)";
    expect(extractWorkerRoutes(src)).toEqual(['/api/users']);
  });
});

describe('findUncoveredFetches', () => {
  it('returns empty when all fetches are covered', () => {
    expect(findUncoveredFetches(['/api/notes'], ['/api/notes'])).toEqual([]);
  });

  it('matches after normalising :param segments', () => {
    expect(findUncoveredFetches(['/api/notes/:param'], ['/api/notes/:id'])).toEqual([]);
    expect(findUncoveredFetches(['/api/notes/123'], ['/api/notes/:id'])).toEqual([]);
  });

  it('returns uncovered fetches', () => {
    const uncovered = findUncoveredFetches(['/api/notes', '/api/users'], ['/api/notes']);
    expect(uncovered).toEqual(['/api/users']);
  });

  it('treats a wildcard route as covering everything', () => {
    expect(findUncoveredFetches(['/api/notes', '/api/users/123'], ['/api/*'])).toEqual([]);
  });

  it('returns empty when fetch list is empty', () => {
    expect(findUncoveredFetches([], ['/api/notes'])).toEqual([]);
  });

  it('returns all fetches when route list is empty', () => {
    expect(findUncoveredFetches(['/api/notes'], [])).toEqual(['/api/notes']);
  });
});
