/**
 * Post-generation check: every fetch('/api/...') call in /src/ has a matching
 * route handler in /worker/index.ts.
 *
 * The check normalises :param path segments before comparing so that
 * `fetch('/api/notes/123')` matches `app.get('/api/notes/:id', ...)`.
 */

const PARAM_SEGMENT = /\/:[a-zA-Z_][a-zA-Z0-9_]*/g;

/**
 * Routes served by the BrainHalf platform dispatcher in front of the worker.
 * The AI is explicitly told to call these but never re-implement them, so
 * they must not count as missing handlers in the coverage check.
 */
export const PLATFORM_PROVIDED_ROUTES = new Set<string>([
  '/api/auth/config',
  '/api/auth/session',
  '/api/auth/signup',
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/forgot-password',
  '/api/auth/resend-verification',
  '/api/auth/magic-link',
  '/api/auth/google/start',
  '/api/auth/github/start',
  '/api/contact',
  '/api/storage',
  '/api/storage/:param',
]);

/** Replace named route params with a canonical placeholder for comparison. */
export function normalizeApiPath(path: string): string {
  return path
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '')
    .replace(PARAM_SEGMENT, '/:param')
    .replace(/\/\*$/, '');
}

/**
 * Extract all /api/... paths called via fetch() in /src/ TypeScript/TSX files.
 * Template literals with dynamic segments contribute their static prefix plus /:param.
 */
export function extractApiFetches(files: Map<string, string>): string[] {
  const fetches = new Set<string>();
  for (const [filePath, content] of files) {
    const resolved = filePath.startsWith('/') ? filePath : '/' + filePath;
    if (!/^\/src\//i.test(resolved)) continue;
    if (!/\.(tsx?|jsx?)$/.test(resolved)) continue;

    // fetch('/api/foo') or fetch("/api/foo")
    for (const m of content.matchAll(/\bfetch\s*\(\s*['"]\/api\/([^'"\s?#]+)/g)) {
      fetches.add('/api/' + m[1]);
    }
    // fetch(`/api/foo`) — template literal, fully static
    for (const m of content.matchAll(/\bfetch\s*\(\s*`\/api\/([^`?#$]+)`/g)) {
      fetches.add('/api/' + m[1]);
    }
    // fetch(`/api/foo/${id}`) — extract static prefix before the first ${
    for (const m of content.matchAll(/\bfetch\s*\(\s*`\/api\/([^`?#$]*)\$\{/g)) {
      const prefix = m[1].replace(/\/$/, '');
      if (prefix) fetches.add('/api/' + prefix + '/:param');
    }
  }
  return [...fetches];
}

/**
 * Extract all /api/... route paths registered in a worker source file.
 *
 * Recognises five dispatch patterns (including aliased pathname/path variables):
 *   1. Chained-router / Hono:  app.get('/api/foo', handler)
 *   2. Pathname equality:      url.pathname === '/api/foo' or pathname === '/api/foo'
 *   3. Pathname regex match:   url.pathname.match(/^\/api\/foo\/([^/]+)$/) or /^\/api\/.../.test(...)
 *   4. Switch/case dispatch:   case '/api/foo':
 *   5. Pathname startsWith:    url.pathname.startsWith('/api/foo/')
 */
export function extractWorkerRoutes(workerSource: string): string[] {
  const routes = new Set<string>();

  // 1. Chained-router: app.get('/api/foo', ...) / app.get(`/api/foo`, ...)
  for (const m of workerSource.matchAll(/\.\s*(?:get|post|put|patch|delete|all)\s*\(\s*['"]\/api\/([^'"$\s]+)['"]/gi)) {
    routes.add('/api/' + m[1]);
  }
  for (const m of workerSource.matchAll(/\.\s*(?:get|post|put|patch|delete|all)\s*\(\s*`\/api\/([^`$\s]+)`/gi)) {
    routes.add('/api/' + m[1]);
  }

  // 2. Pathname equality: url.pathname / pathname / path / route === '/api/foo' or "/api/foo"
  for (const m of workerSource.matchAll(/(?:url\.pathname|\bpathname|\bpath|\broute)\s*===\s*['"]\/api\/([^'"?#\s]+)['"]/g)) {
    routes.add('/api/' + m[1]);
  }

  // 3. Regex match or .test(): any regex literal anchored at /^\/api\/.../
  //    Convert capture groups to :param segments.
  const REGEX_MATCH = /\/\^\\\/api\\\/(.+?)\$?\//g;
  const NAMED_GROUP = new RegExp(String.raw`\(\?<[a-zA-Z_]\w*>\[[^\]]*\]\+\)`, 'g');
  for (const m of workerSource.matchAll(REGEX_MATCH)) {
    const raw = m[1];
    const path = '/api/' + raw
      .replace(/\\\//g, '/')
      .replace(NAMED_GROUP, ':param')
      .replace(/\([^)]*\)/g, ':param')
      .replace(/\$$/, '');
    routes.add(path);
  }

  // 4. Switch/case: case '/api/foo':
  for (const m of workerSource.matchAll(/case\s+['"]\/api\/([^'"?#\s]+)['"]\s*:/g)) {
    routes.add('/api/' + m[1]);
  }

  // 5. startsWith: (url.pathname|pathname|path).startsWith('/api/foo/')
  for (const m of workerSource.matchAll(/(?:url\.pathname|\bpathname|\bpath|\broute)\.startsWith\s*\(\s*['"]\/api\/([^'"?#\s]+)['"]\s*\)/g)) {
    if (m[1].endsWith('/')) {
      routes.add('/api/' + m[1] + ':param');
    } else {
      routes.add('/api/' + m[1]);
      routes.add('/api/' + m[1] + '/:param');
    }
  }

  return [...routes];
}

/**
 * Return whether a fetch path is covered by a route.
 *
 * Matches are done segment-by-segment after normalising both sides:
 * - Named route params (:id, :slug) match any literal segment in the fetch path.
 * - A wildcard route (/api/*) covers all /api/ paths.
 */
function isCoveredByRoute(fetchPath: string, route: string): boolean {
  if (/\/api\/\*/.test(route)) return true;
  const rSegs = normalizeApiPath(route).split('/');
  const fSegs = normalizeApiPath(fetchPath).split('/');
  if (rSegs.length !== fSegs.length) return false;
  return rSegs.every((seg, i) => seg === fSegs[i] || seg === ':param');
}

/**
 * Return the fetch paths that have no matching route.
 * A wildcard route (/api/*) is treated as covering everything.
 * Platform-provided routes are excluded — the worker never implements them.
 */
export function findUncoveredFetches(fetches: string[], routes: string[], workerSource?: string): string[] {
  if (routes.some(r => /\/api\/\*/.test(r) || r === '/api/')) return [];
  if (routes.length === 0 && workerSource && /\/api\//.test(workerSource)) return [];
  return fetches.filter(f => {
    if (PLATFORM_PROVIDED_ROUTES.has(normalizeApiPath(f))) return false;
    return !routes.some(r => isCoveredByRoute(f, r));
  });
}
