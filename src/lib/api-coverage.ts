/**
 * Post-generation check: every fetch('/api/...') call in /src/ has a matching
 * route handler in /worker/index.ts.
 *
 * The check normalises :param path segments before comparing so that
 * `fetch('/api/notes/123')` matches `app.get('/api/notes/:id', ...)`.
 */

const PARAM_SEGMENT = /\/:[a-zA-Z_][a-zA-Z0-9_]*/g;

/** Replace named route params with a canonical placeholder for comparison. */
export function normalizeApiPath(path: string): string {
  return path.replace(PARAM_SEGMENT, '/:param').replace(/\/\*$/, '');
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
 * Extract all /api/... route paths registered in a worker source file via
 * the standard chained-router pattern (.get, .post, .put, .patch, .delete, .all).
 */
export function extractWorkerRoutes(workerSource: string): string[] {
  const routes = new Set<string>();
  // String literal routes: app.get('/api/foo', ...)
  for (const m of workerSource.matchAll(/\.\s*(?:get|post|put|patch|delete|all)\s*\(\s*['"]\/api\/([^'"$\s]+)['"]/gi)) {
    routes.add('/api/' + m[1]);
  }
  // Template literal routes (less common): app.get(`/api/foo`, ...)
  for (const m of workerSource.matchAll(/\.\s*(?:get|post|put|patch|delete|all)\s*\(\s*`\/api\/([^`$\s]+)`/gi)) {
    routes.add('/api/' + m[1]);
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
 */
export function findUncoveredFetches(fetches: string[], routes: string[]): string[] {
  if (routes.some(r => /\/api\/\*/.test(r) || r === '/api/')) return [];
  return fetches.filter(f => !routes.some(r => isCoveredByRoute(f, r)));
}
