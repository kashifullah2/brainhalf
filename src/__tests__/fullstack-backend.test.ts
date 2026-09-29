import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { transform } from 'sucrase';
import {
  matchApiRoute,
  loadServerEntry,
  dispatchServerApi,
  type ServerDb,
} from '../lib/server-runtime';
import { fullStackStarterTemplate } from '../lib/templates';

function makeDb(): ServerDb {
  const sqlite = new DatabaseSync(':memory:');
  return {
    query: (sql: string, ...params: any[]) =>
      sqlite.prepare(sql).all(...params) as any[],
    exec: (sql: string, ...params: any[]) => {
      const info = sqlite.prepare(sql).run(...params);
      return {
        changes: Number(info.changes ?? 0),
        lastRowId:
          typeof info.lastInsertRowid === 'number'
            ? Number(info.lastInsertRowid)
            : null,
      };
    },
  };
}

function applySchema(db: ServerDb, schema: string) {
  for (const stmt of schema.split(';').map(s => s.trim()).filter(Boolean)) {
    db.exec(stmt);
  }
}

describe('matchApiRoute', () => {
  it('matches exact method + path', () => {
    expect(matchApiRoute('GET /api/todos', 'GET', '/api/todos')).toEqual({});
  });

  it('rejects method mismatch', () => {
    expect(matchApiRoute('POST /api/todos', 'GET', '/api/todos')).toBeNull();
  });

  it('extracts :params and decodes them', () => {
    expect(matchApiRoute('DELETE /api/todos/:id', 'DELETE', '/api/todos/42')).toEqual({ id: '42' });
    expect(
      matchApiRoute('GET /api/users/:userId/posts/:postId', 'GET', '/api/users/a%20b/posts/7')
    ).toEqual({ userId: 'a b', postId: '7' });
  });

  it('supports wildcard method', () => {
    expect(matchApiRoute('* /api/ping', 'HEAD', '/api/ping')).toEqual({});
  });

  it('ignores query strings when matching', () => {
    expect(matchApiRoute('GET /api/todos', 'GET', '/api/todos?limit=10')).toEqual({});
  });

  it('rejects segment count mismatch and missing method', () => {
    expect(matchApiRoute('GET /api/todos', 'GET', '/api/todos/1')).toBeNull();
    expect(matchApiRoute('/api/todos', 'GET', '/api/todos')).toBeNull();
    expect(matchApiRoute('GET /api/other', 'GET', '/api/todos')).toBeNull();
  });
});

describe('loadServerEntry', () => {
  const db = makeDb();

  it('loads ESM exports and strips TypeScript types', () => {
    const entry = loadServerEntry(
      '/server/routes.ts',
      {
        '/server/routes.ts': `
          export const schema: string = 'CREATE TABLE t(id INTEGER);';
          export const routes: Record<string, any> = {
            'GET /api/t': async ({ db }: any) => Response.json({ ok: true }),
          };
        `,
      },
      db
    );
    expect(entry.schema).toContain('CREATE TABLE t');
    expect(typeof entry.routes['GET /api/t']).toBe('function');
  });

  it('resolves relative imports between /server files', () => {
    const entry = loadServerEntry(
      '/server/routes.js',
      {
        '/server/routes.js': `
          import { greeting } from './helpers.js';
          export const routes = {
            'GET /api/hi': async () => Response.json({ msg: greeting() }),
          };
        `,
        '/server/helpers.js': `export function greeting() { return 'hello'; }`,
      },
      db
    );
    expect(typeof entry.routes['GET /api/hi']).toBe('function');
  });

  it('reports syntax errors with the file name', () => {
    expect(() =>
      loadServerEntry('/server/routes.js', { '/server/routes.js': 'export const = ;;;' }, db)
    ).toThrow(/Syntax error in \/server\/routes\.js/);
  });

  it('rejects missing modules and bare imports', () => {
    expect(() => loadServerEntry('/server/nope.js', {}, db)).toThrow(/not found/);
    // Bare (non-relative) require is blocked by the sandbox at load time.
    expect(() =>
      loadServerEntry(
        '/server/routes.js',
        { '/server/routes.js': `const fs = require('fs');\nexport const routes = {};` },
        db
      )
    ).toThrow(/only relative \/server\/\* imports are allowed/);
  });
});

describe('dispatchServerApi', () => {
  it('returns 404 no-api-route when nothing matches', async () => {
    const res = await dispatchServerApi(
      { routes: {} },
      'GET',
      '/api/missing',
      new Request('https://x/api/missing'),
      makeDb()
    );
    expect(res.status).toBe(404);
    const body: any = await res.json();
    expect(body.error).toBe('no-api-route');
  });

  it('returns plain objects as JSON', async () => {
    const res = await dispatchServerApi(
      { routes: { 'GET /api/ping': async () => ({ pong: true }) } },
      'GET',
      '/api/ping',
      new Request('https://x/api/ping'),
      makeDb()
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ pong: true });
  });
});

describe('fullStackStarterTemplate (real backend contract)', () => {
  const routesJs: string =
    fullStackStarterTemplate['server'].directory['routes.js'].file.contents;
  const appJsx: string =
    fullStackStarterTemplate['src'].directory['App.jsx'].file.contents;

  it('ships a syntactically valid backend and frontend', () => {
    expect(() =>
      transform(routesJs, { transforms: ['imports', 'typescript'] })
    ).not.toThrow();
    expect(() =>
      transform(appJsx, { transforms: ['jsx', 'typescript'] })
    ).not.toThrow();
  });

  it('runs the full todo lifecycle against real SQLite', async () => {
    const db = makeDb();
    const entry = loadServerEntry('/server/routes.js', { '/server/routes.js': routesJs }, db);
    applySchema(db, entry.schema);

    const call = (method: string, path: string, body?: any) =>
      dispatchServerApi(
        entry,
        method,
        path,
        new Request(`https://preview.local${path}`, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: body !== undefined ? JSON.stringify(body) : undefined,
        }),
        db
      );

    // First GET seeds starter content
    let res = await call('GET', '/api/todos');
    let todos: any[] = await res.json();
    expect(todos.length).toBe(3);

    // Second GET does not duplicate seeds
    res = await call('GET', '/api/todos');
    todos = await res.json();
    expect(todos.length).toBe(3);

    // POST creates
    res = await call('POST', '/api/todos', { title: 'Write tests' });
    expect(res.status).toBe(200);
    const created: any = await res.json();
    expect(created.id).toBeGreaterThan(0);
    expect(created.title).toBe('Write tests');

    // POST validates
    res = await call('POST', '/api/todos', { title: '   ' });
    expect(res.status).toBe(400);

    // PATCH toggles via :id param
    res = await call('PATCH', `/api/todos/${created.id}`, { done: true });
    expect(res.status).toBe(200);
    res = await call('GET', '/api/todos');
    todos = await res.json();
    expect(todos.find(t => t.id === created.id).done).toBe(1);

    // DELETE removes via :id param
    res = await call('DELETE', `/api/todos/${created.id}`);
    expect(res.status).toBe(200);
    res = await call('GET', '/api/todos');
    todos = await res.json();
    expect(todos.some(t => t.id === created.id)).toBe(false);
  });
});
