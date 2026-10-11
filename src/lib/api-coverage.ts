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
 * Platform-provided routes are excluded — the worker never implements them.
 */
export function findUncoveredFetches(fetches: string[], routes: string[]): string[] {
  if (routes.some(r => /\/api\/\*/.test(r) || r === '/api/')) return [];
  return fetches.filter(f => {
    const normalized = normalizeApiPath(f);
    if (PLATFORM_PROVIDED_ROUTES.has(normalized)) return false;
    // /api/auth/* variants (e.g. /api/auth/:param from fetch(`/api/auth/${token}`))
    if (normalized.startsWith('/api/auth/')) return false;
    return !routes.some(r => isCoveredByRoute(f, r));
  });
}
