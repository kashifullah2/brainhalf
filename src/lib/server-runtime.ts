import { transform } from 'sucrase';

/**
 * BrainHalf full-stack server runtime.
 *
 * Generated backend code lives under /server/ (entry: /server/routes.js|ts).
 * This module compiles it (ESM/TS -> CJS via Sucrase) and executes it with a
 * tiny relative-require system plus a `db` helper. In production
 * (ChatAgent.serveProjectApi) the db is bound to the project's own Durable
 * Object SQLite; in tests it can be any ServerDb implementation.
 *
 * Contract the agent follows:
 *   export const schema = `CREATE TABLE IF NOT EXISTS ...; ...`;
 *   export const routes = {
 *     'GET /api/todos': async ({ db }) => Response.json(db.query('SELECT * FROM todos')),
 *     'POST /api/todos': async ({ db, req }) => { ... },
 *     'DELETE /api/todos/:id': async ({ db, params }) => { ... },
 *   };
 */

/** Minimal DB surface exposed to generated backend code. */
export interface ServerDb {
  query: (sql: string, ...params: any[]) => any[];
  exec: (sql: string, ...params: any[]) => { changes: number; lastRowId: number | null };
}

/**
 * Pure route matcher for generated backend routes ("METHOD /api/path" keys,
 * with :param segments). Returns extracted params on match, null otherwise.
 */
export function matchApiRoute(routeKey: string, method: string, apiPath: string): Record<string, string> | null {
  const spaceIdx = routeKey.indexOf(' ');
  if (spaceIdx === -1) return null;
  const routeMethod = routeKey.slice(0, spaceIdx).trim().toUpperCase();
  const routePath = routeKey.slice(spaceIdx + 1).trim();
  if (routeMethod !== '*' && routeMethod !== method) return null;
  const routeSegs = routePath.split('/').filter(Boolean);
  const pathSegs = apiPath.split('?')[0].split('/').filter(Boolean);
  if (routeSegs.length !== pathSegs.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < routeSegs.length; i++) {
    const rs = routeSegs[i];
    if (rs.startsWith(':')) {
      params[rs.slice(1)] = decodeURIComponent(pathSegs[i]);
    } else if (rs !== pathSegs[i]) {
      return null;
    }
  }
  return params;
}

function normalizeServerKey(p: string): string {
  const segs = p.trim().replace(/\\/g, '/').split('/').filter(s => s && s !== '.' && s !== '..');
  return '/' + segs.join('/');
}

/**
 * Compiles and executes a generated /server/* entry module with a tiny
 * relative-require system and the project's `db` helper. Returns the module's
 * exports (expected: { schema?, routes }).
 */
export function loadServerEntry(entryPath: string, serverFiles: Record<string, string>, db: ServerDb): any {
  const normalized: Record<string, string> = {};
  for (const [k, v] of Object.entries(serverFiles)) normalized[normalizeServerKey(k)] = v;

  const cache = new Map<string, { exports: any }>();
  const resolveRelative = (from: string, reqPath: string): string => {
    const fromDir = from.split('/').slice(0, -1);
    const parts: string[] = [];
    for (const seg of [...fromDir, ...reqPath.split('/')]) {
      if (!seg || seg === '.') continue;
      if (seg === '..') parts.pop();
      else parts.push(seg);
    }
    let resolved = '/' + parts.join('/');
    if (normalized[resolved] == null) {
      for (const ext of ['.js', '.ts', '.jsx', '.tsx']) {
        if (normalized[resolved + ext] != null) { resolved = resolved + ext; break; }
      }
    }
    return resolved;
  };

  const loadModule = (modPath: string): any => {
    const norm = normalizeServerKey(modPath);
    const cached = cache.get(norm);
    if (cached) return cached.exports;
    const content = normalized[norm];
    if (content == null) throw new Error(`Server module not found: ${modPath}`);
    let js: string;
    try {
      js = transform(content, { transforms: ['imports', 'typescript'] }).code;
    } catch (e: any) {
      throw new Error(`Syntax error in ${norm}: ${e.message}`);
    }
    const module = { exports: {} as any };
    cache.set(norm, module);
    const localRequire = (reqPath: string) => {
      if (typeof reqPath === 'string' && reqPath.startsWith('.')) {
        return loadModule(resolveRelative(norm, reqPath));
      }
      throw new Error(`Cannot require '${reqPath}' in server code — only relative /server/* imports are allowed.`);
    };
    const fn = new Function(
      'module', 'exports', 'require', 'db', 'Request', 'Response', 'URL', 'URLSearchParams', 'console', 'setTimeout', 'clearTimeout',
      js
    );
    fn(module, module.exports, localRequire, db, Request, Response, URL, URLSearchParams, console, setTimeout, clearTimeout);
    return module.exports;
  };

  return loadModule(entryPath);
}

/**
 * Dispatches one API request against a loaded entry's routes, mirroring
 * ChatAgent.serveProjectApi. Returns the Response (or a no-api-route 404).
 */
export async function dispatchServerApi(
  entry: any,
  method: string,
  apiPath: string,
  request: Request,
  db: ServerDb
): Promise<Response> {
  const routes = (entry && entry.routes) || {};
  const upperMethod = method.toUpperCase();
  for (const routeKey of Object.keys(routes)) {
    const params = matchApiRoute(routeKey, upperMethod, apiPath);
    if (params) {
      const handler = routes[routeKey];
      if (typeof handler !== 'function') continue;
      const result = await handler({ db, req: request, request, params });
      if (result instanceof Response) return result;
      return Response.json(result ?? { ok: true });
    }
  }
  return Response.json(
    { error: 'no-api-route', message: `No backend route matched ${upperMethod} ${apiPath}.` },
    { status: 404 }
  );
}
