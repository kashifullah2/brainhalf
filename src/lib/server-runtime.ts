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
      // A malformed percent-sequence must not turn into a 500: fall back to
      // the raw segment so matching simply continues/fails cleanly.
      let value: string = pathSegs[i];
      try {
        value = decodeURIComponent(pathSegs[i]);
      } catch {
        // keep raw
      }
      params[rs.slice(1)] = value;
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
    // Security: `new Function` still closes over the ambient global scope, so
    // every dangerous global is shadowed here as an explicit `undefined`
    // parameter. Generated backend code keeps the useful surface (Request,
    // Response, URL, timers, console, binary helpers) but cannot reach the
    // network (fetch/WebSocket/EventSource), spin forever on intervals or
    // microtasks, touch process/env, or escape via globalThis/self.
    //
    // NOTE: a synchronous `while(true){}` cannot be preempted in JS. Async
    // handlers are additionally raced against a timeout by the caller; sync
    // spins are bounded by the platform's per-request CPU limit.
    const fn = new Function(
      'module', 'exports', 'require', 'db',
      'Request', 'Response', 'URL', 'URLSearchParams', 'TextEncoder', 'TextDecoder',
      'atob', 'btoa', 'structuredClone', 'Blob', 'FormData', 'Headers', 'ReadableStream',
      'console', 'setTimeout', 'clearTimeout',
      // --- everything below is shadowed as undefined ---
      'fetch', 'WebSocket', 'EventSource',
      'setInterval', 'clearInterval', 'queueMicrotask',
      'crypto', 'process', 'globalThis', 'self', 'navigator', 'performance',
      'caches', 'indexedDB', 'localStorage', 'sessionStorage',
      js
    );
    const undef: undefined = undefined;
    fn(
      module, module.exports, localRequire, db,
      Request, Response, URL, URLSearchParams, TextEncoder, TextDecoder,
      atob, btoa, structuredClone, Blob, FormData, Headers, ReadableStream,
      console, setTimeout, clearTimeout,
      undef, undef, undef,
      undef, undef, undef,
      undef, undef, undef, undef, undef, undef,
      undef, undef, undef, undef
    );
    return module.exports;
  };

  return loadModule(entryPath);
}

/**
 * Splits a SQL script into individual statements on `;`, ignoring semicolons
 * inside string literals (', ", `), inside line (--) / block comments, and
 * inside CREATE TRIGGER bodies (BEGIN...END blocks). The naive
 * `schema.split(';')` broke on triggers and defaults containing semicolons;
 * this keeps schema execution correct.
 */
export function splitSqlStatements(script: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quote: string | null = null;
  let lineComment = false;
  let blockComment = false;
  let beginDepth = 0; // CREATE TRIGGER ... BEGIN ... END nesting
  let word = ''; // current identifier-ish token, for BEGIN/END detection

  const flushWord = () => {
    if (word && !quote && !lineComment && !blockComment) {
      const upper = word.toUpperCase();
      if (upper === 'BEGIN') beginDepth++;
      else if (upper === 'END' && beginDepth > 0) beginDepth--;
    }
    word = '';
  };

  for (let i = 0; i < script.length; i++) {
    const c = script[i];
    const next = i + 1 < script.length ? script[i + 1] : '';
    if (lineComment) {
      cur += c;
      if (c === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (c === '*' && next === '/') {
        cur += '*/';
        i++;
        blockComment = false;
      } else {
        cur += c;
      }
      continue;
    }
    if (quote) {
      cur += c;
      if (c === quote) {
        if (next === quote) {
          cur += next; // escaped quote ('')
          i++;
        } else {
          quote = null;
        }
      }
      continue;
    }
    if (c === '-' && next === '-') {
      flushWord();
      lineComment = true;
      cur += c;
      continue;
    }
    if (c === '/' && next === '*') {
      flushWord();
      blockComment = true;
      cur += '/*';
      i++;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      flushWord();
      quote = c;
      cur += c;
      continue;
    }
    if (c === ';' && beginDepth === 0) {
      flushWord();
      if (cur.trim()) out.push(cur.trim());
      cur = '';
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      word += c;
    } else {
      flushWord();
    }
    cur += c;
  }
  flushWord();
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/**
 * System tables the generated backend must never touch. Word-boundary matched
 * so an app table named e.g. `messages_log` is NOT blocked by `messages`.
 */
const GUARDED_SYSTEM_TABLES = [
  'messages',
  'project_files',
  'project_meta',
  'sqlite_master',
  'sqlite_sequence',
  'sqlite_stat1',
];

/** DML statement types generated handlers are allowed to run. No DDL, ever. */
const ALLOWED_SQL_VERBS = new Set(['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'REPLACE', 'WITH']);

function mentionsTable(sqlLowerPadded: string, table: string): boolean {
  return new RegExp(`(^|[^a-z0-9_])${table}([^a-z0-9_]|$)`).test(sqlLowerPadded);
}

/**
 * Throws when a SQL string is not safe for generated backend code:
 * non-DML verbs (CREATE/DROP/ALTER/ATTACH/PRAGMA/...), references to system
 * tables, or stacked multi-statements.
 */
export function assertAllowedServerSql(sqlText: string): void {
  if (typeof sqlText !== 'string' || !sqlText.trim()) {
    throw new Error('SQL must be a non-empty string.');
  }
  const verb = sqlText
    .trim()
    .split(/\s+/, 1)[0]
    .replace(/[^a-zA-Z]/g, '')
    .toUpperCase();
  if (!ALLOWED_SQL_VERBS.has(verb)) {
    throw new Error(
      `SQL "${verb || '?'}" statements are not allowed in generated backend code (SELECT/INSERT/UPDATE/DELETE only).`
    );
  }
  const padded = ` ${sqlText.toLowerCase()} `;
  for (const t of GUARDED_SYSTEM_TABLES) {
    if (mentionsTable(padded, t)) {
      throw new Error(`Access to system table "${t}" is not allowed in generated backend code.`);
    }
  }
  if (splitSqlStatements(sqlText).length > 1) {
    throw new Error('Only one SQL statement per db call is allowed.');
  }
}

/** DDL verbs a generated schema must never contain (runs on the raw connection). */
const BLOCKED_SCHEMA_VERBS = /^\s*(DROP|ALTER|ATTACH|DETACH|PRAGMA|VACUUM|REINDEX|ANALYZE)\b/i;

/**
 * Validates one schema statement from a generated `/server/routes.js` schema
 * export. The schema runs on the raw project connection (CREATE TABLE is
 * legitimate there), so this blocklist is the guardrail: no destructive DDL
 * and no touching the IDE's own tables.
 */
export function assertSafeServerSchema(statement: string): void {
  if (typeof statement !== 'string' || !statement.trim()) {
    throw new Error('Schema statement must be a non-empty string.');
  }
  if (BLOCKED_SCHEMA_VERBS.test(statement)) {
    const verb = statement.trim().split(/\s+/, 1)[0].toUpperCase();
    throw new Error(`Schema statement "${verb}" is not allowed in generated backend code.`);
  }
  const padded = ` ${statement.toLowerCase()} `;
  for (const t of GUARDED_SYSTEM_TABLES) {
    if (mentionsTable(padded, t)) {
      throw new Error(`Schema may not reference system table "${t}".`);
    }
  }
}

/**
 * Wraps a raw ServerDb so generated handlers get a least-privilege surface:
 * DML only, single statements, no system tables. Schema application keeps
 * using the raw connection (it legitimately runs CREATE TABLE).
 */
export function createGuardedServerDb(db: ServerDb): ServerDb {
  return {
    query: (sqlText: string, ...params: any[]) => {
      assertAllowedServerSql(sqlText);
      return db.query(sqlText, ...params);
    },
    exec: (sqlText: string, ...params: any[]) => {
      assertAllowedServerSql(sqlText);
      return db.exec(sqlText, ...params);
    },
  };
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
