import { describe, expect, it } from 'vitest';
import { extractApiFetches, extractWorkerRoutes, findUncoveredFetches, normalizeApiPath, PLATFORM_PROVIDED_ROUTES } from '../lib/api-coverage';

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

  // ── if/else pathname dispatch (baseline workers-starter template) ────────

  it('extracts routes from url.pathname === "/api/..." dispatch', () => {
    const src = `
      if (url.pathname === '/api/items' && request.method === 'GET') { return json({ items }); }
      if (url.pathname === '/api/items' && request.method === 'POST') { return json(item, 201); }
    `;
    expect(extractWorkerRoutes(src).sort()).toEqual(['/api/items']);
  });

  it('extracts routes when method check comes first', () => {
    const src = `if (request.method === 'GET' && url.pathname === '/api/products') { return json(products); }`;
    expect(extractWorkerRoutes(src).sort()).toEqual(['/api/products']);
  });

  it('extracts routes from double-quoted pathname checks', () => {
    const src = `if (url.pathname === "/api/orders") { return json(orders); }`;
    expect(extractWorkerRoutes(src)).toEqual(['/api/orders']);
  });

  it('extracts routes from pathname check without method guard', () => {
    const src = `if (url.pathname === '/api/health') return json({ ok: true });`;
    expect(extractWorkerRoutes(src)).toEqual(['/api/health']);
  });

  // ── regex pathname match (baseline template parametric routes) ───────────

  it('extracts routes from url.pathname.match regex', () => {
    const src = String.raw`const match = url.pathname.match(/^\/api\/items\/([a-zA-Z0-9-]+)$/);`;
    expect(extractWorkerRoutes(src)).toEqual(['/api/items/:param']);
  });

  it('extracts routes from url.pathname.match with named groups', () => {
    const src = String.raw`const m = url.pathname.match(/^\/api\/products\/(?<id>[^/]+)\/adjust$/);`;
    expect(extractWorkerRoutes(src)).toEqual(['/api/products/:param/adjust']);
  });

  // ── switch/case on pathname ──────────────────────────────────────────────

  it('extracts routes from switch/case dispatch', () => {
    const src = `
      switch (url.pathname) {
        case '/api/items': return handleItems(request);
        case '/api/health': return json({ ok: true });
        default: return json({ error: 'Not found' }, 404);
      }
    `;
    expect(extractWorkerRoutes(src).sort()).toEqual(['/api/health', '/api/items']);
  });

  // ── startsWith for parametric prefixes ──────────────────────────────────

  it('extracts routes from url.pathname.startsWith for param prefixes', () => {
    const src = `if (url.pathname.startsWith('/api/items/')) { const id = url.pathname.split('/')[3]; }`;
    expect(extractWorkerRoutes(src)).toEqual(['/api/items/:param']);
  });

  // ── Hono-style app.method (identical to chained-router but exercises
  //    that the combination of patterns works) ──────────────────────────────

  it('extracts Hono-style routes with path params', () => {
    const src = `
      app.get('/api/products', listProducts)
      app.post('/api/products', createProduct)
      app.get('/api/products/:id', getProduct)
      app.put('/api/products/:id', updateProduct)
      app.delete('/api/products/:id', deleteProduct)
      app.patch('/api/products/:id/adjust', adjustStock)
    `;
    expect(extractWorkerRoutes(src).sort()).toEqual([
      '/api/products',
      '/api/products/:id',
      '/api/products/:id/adjust',
    ]);
  });

  // ── Full baseline template (real source from workers-starter.ts) ─────────

  it('extracts all routes from the baseline workers-starter template', () => {
    const baselineWorker = `import type { BrainHalfServices } from './brainhalf';
interface Env extends BrainHalfServices { DB: D1Database; BRAINHALF_MANAGED?: string }
const json = (body: unknown, status = 200) => Response.json(body, { status });
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/api/health') return json({ ok: true, runtime: 'workers', database: !!env.DB });
    const userId = env.BRAINHALF_MANAGED === 'true' ? request.headers.get('x-bh-user-id') : null;
    if (!userId) return json({ error: 'Sign in to use this feature.' }, 401);
    if (url.pathname === '/api/items' && request.method === 'GET') {
      const result = await env.DB.prepare('SELECT id,title FROM items WHERE user_id=?').bind(userId).all();
      return json({ items: result.results });
    }
    if (url.pathname === '/api/items' && request.method === 'POST') {
      return json({ item: { id: '1', title: 'test' } }, 201);
    }
    const match = url.pathname.match(/^\\/api\\/items\\/([a-zA-Z0-9-]+)$/);
    if (match && request.method === 'DELETE') {
      return json({ ok: true });
    }
    return json({ error: 'Route not found' }, 404);
  }
};`;
    const routes = extractWorkerRoutes(baselineWorker).sort();
    expect(routes).toEqual(['/api/health', '/api/items', '/api/items/:param']);
  });

  // ── Inventory tracker (common generated pattern) ─────────────────────────

  it('extracts all routes from an inventory-tracker worker', () => {
    const inventoryWorker = `const items = [];
const json = (body, status = 200) => Response.json(body, { status });
export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/api/items' && request.method === 'GET') return json(items);
    if (url.pathname === '/api/items' && request.method === 'POST') {
      const body = await request.json();
      items.push({ id: crypto.randomUUID(), ...body });
      return json(items[items.length - 1], 201);
    }
    return json({ error: 'Not found' }, 404);
  }
};`;
    expect(extractWorkerRoutes(inventoryWorker).sort()).toEqual(['/api/items']);
  });

  // ── Products worker with parametric adjust route ─────────────────────────

  it('extracts routes from a products worker with regex param routes', () => {
    const productsWorker = String.raw`export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/products' && request.method === 'GET') return json(products);
    if (url.pathname === '/api/products' && request.method === 'POST') return json(newProduct, 201);
    const detailMatch = url.pathname.match(/^\/api\/products\/([a-zA-Z0-9-]+)$/);
    if (detailMatch && request.method === 'GET') return json(product);
    if (detailMatch && request.method === 'DELETE') return json({ ok: true });
    const adjustMatch = url.pathname.match(/^\/api\/products\/(?<id>[^/]+)\/adjust$/);
    if (adjustMatch && request.method === 'PATCH') return json(adjusted);
    return json({ error: 'Not found' }, 404);
  }
};`;
    expect(extractWorkerRoutes(productsWorker).sort()).toEqual([
      '/api/products',
      '/api/products/:param',
      '/api/products/:param/adjust',
    ]);
  });

  // ── Chained-router worker (existing syntax — no regression) ──────────────

  it('extracts all routes from a chained-router worker', () => {
    const chainedWorker = `
      import { Hono } from 'hono';
      const app = new Hono();
      app.get('/api/notes', listNotes)
      app.post('/api/notes', createNote)
      app.get('/api/notes/:id', getNote)
      app.put('/api/notes/:id', updateNote)
      app.delete('/api/notes/:id', deleteNote)
      export default app;
    `;
    expect(extractWorkerRoutes(chainedWorker).sort()).toEqual([
      '/api/notes',
      '/api/notes/:id',
    ]);
  });

  // ── Zero false positives: findUncoveredFetches with the baseline template ─

  it('reports zero false positives against the baseline template', () => {
    const baselineWorker = `
    if (url.pathname === '/api/health') return json({ ok: true });
    if (url.pathname === '/api/items' && request.method === 'GET') return json({ items });
    if (url.pathname === '/api/items' && request.method === 'POST') return json({ item }, 201);
    const match = url.pathname.match(/^\\/api\\/items\\/([a-zA-Z0-9-]+)$/);
    if (match && request.method === 'DELETE') return json({ ok: true });
    `;
    const fetches = ['/api/health', '/api/items', '/api/items/:param'];
    const routes = extractWorkerRoutes(baselineWorker);
    const uncovered = findUncoveredFetches(fetches, routes);
    expect(uncovered).toEqual([]);
  });

  // ── Genuinely missing route IS still reported ────────────────────────────

  it('still reports a genuinely missing route', () => {
    const src = `if (url.pathname === '/api/items' && request.method === 'GET') return json(items);`;
    const routes = extractWorkerRoutes(src);
    const uncovered = findUncoveredFetches(['/api/items', '/api/orders'], routes);
    expect(uncovered).toEqual(['/api/orders']);
  });

  // ── Fail-safe: unparseable dispatch produces no false positives ──────────

  it('returns no routes from a worker that stores paths in variables', () => {
    const src = `
const ITEMS_PATH = '/api/items';
const HEALTH_PATH = '/api/health';
export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === ITEMS_PATH && request.method === 'GET') return json(items);
    if (url.pathname === ITEMS_PATH && request.method === 'POST') return json(item, 201);
    if (url.pathname === HEALTH_PATH) return json({ ok: true });
    return json({ error: 'Not found' }, 404);
  }
};`;
    expect(extractWorkerRoutes(src)).toEqual([]);
  });

  it('findUncoveredFetches skips the check when worker has /api/ dispatch but no parseable routes', () => {
    const workerSource = `
const ITEMS_PATH = '/api/items';
if (url.pathname === ITEMS_PATH) return json(items);`;
    const routes = extractWorkerRoutes(workerSource);
    const uncovered = findUncoveredFetches(
      ['/api/items', '/api/health'],
      routes,
      workerSource,
    );
    expect(uncovered).toEqual([]);
  });
});

describe('normalizeApiPath — trailing slashes and query strings', () => {
  it('strips trailing slashes', () => {
    expect(normalizeApiPath('/api/notes/')).toBe('/api/notes');
  });

  it('strips query strings', () => {
    expect(normalizeApiPath('/api/notes?active=true')).toBe('/api/notes');
  });

  it('strips both trailing slash and query string', () => {
    expect(normalizeApiPath('/api/notes/?active=true')).toBe('/api/notes');
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

  it('matches :id, :slug, :param and ${id} as the same param segment', () => {
    expect(findUncoveredFetches(['/api/notes/:param'], ['/api/notes/:id'])).toEqual([]);
    expect(findUncoveredFetches(['/api/notes/:id'], ['/api/notes/:slug'])).toEqual([]);
    expect(findUncoveredFetches(['/api/notes/:param'], ['/api/notes/:slug'])).toEqual([]);
  });

  it('matches routes with trailing slashes stripped', () => {
    expect(findUncoveredFetches(['/api/notes/'], ['/api/notes'])).toEqual([]);
    expect(findUncoveredFetches(['/api/notes'], ['/api/notes/'])).toEqual([]);
  });

  it('matches routes with query strings stripped', () => {
    expect(findUncoveredFetches(['/api/notes?page=1'], ['/api/notes'])).toEqual([]);
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

  it('never flags platform-provided auth routes as missing', () => {
    // The worker intentionally has no handlers for these — platform serves them.
    const platformFetches = [
      '/api/auth/session', '/api/auth/logout', '/api/auth/config',
      '/api/auth/signup', '/api/auth/login', '/api/auth/forgot-password',
      '/api/auth/resend-verification', '/api/auth/magic-link',
      '/api/auth/google/start', '/api/auth/github/start',
    ];
    expect(findUncoveredFetches(platformFetches, [])).toEqual([]);
  });

  it('never flags /api/contact or /api/storage as missing', () => {
    expect(findUncoveredFetches(['/api/contact', '/api/storage', '/api/storage/:param'], [])).toEqual([]);
  });

  it('flags /api/auth/:param when it is not in the explicit platform set', () => {
    // A custom auth endpoint the app implements itself should still be checked.
    // Only the explicit PLATFORM_PROVIDED_ROUTES set is excluded.
    expect(findUncoveredFetches(['/api/auth/:param'], [])).toEqual(['/api/auth/:param']);
  });

  it('still flags genuinely missing app routes even when platform routes are present', () => {
    const fetches = ['/api/auth/session', '/api/game', '/api/game/new'];
    const uncovered = findUncoveredFetches(fetches, []);
    expect(uncovered).toEqual(['/api/game', '/api/game/new']);
  });

  it('PLATFORM_PROVIDED_ROUTES covers all managed auth paths', () => {
    expect(PLATFORM_PROVIDED_ROUTES.has('/api/auth/session')).toBe(true);
    expect(PLATFORM_PROVIDED_ROUTES.has('/api/auth/logout')).toBe(true);
    expect(PLATFORM_PROVIDED_ROUTES.has('/api/contact')).toBe(true);
    expect(PLATFORM_PROVIDED_ROUTES.has('/api/storage')).toBe(true);
  });
});
