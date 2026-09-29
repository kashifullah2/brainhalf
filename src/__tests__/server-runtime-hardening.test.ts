import { describe, it, expect } from 'vitest';
import {
  matchApiRoute,
  loadServerEntry,
  splitSqlStatements,
  assertAllowedServerSql,
  assertSafeServerSchema,
  createGuardedServerDb,
  type ServerDb,
} from '../lib/server-runtime';

function memDb(): ServerDb & { tables: Set<string> } {
  const tables = new Set<string>();
  const db: ServerDb = {
    query: (sql: string) => [{ sql }],
    exec: () => ({ changes: 1, lastRowId: 1 }),
  };
  return Object.assign(db, { tables });
}

describe('matchApiRoute robustness', () => {
  it('does not throw on malformed percent-encoding', () => {
    expect(() => matchApiRoute('GET /api/files/:name', 'GET', '/api/files/%E0%A4%A')).not.toThrow();
    const params = matchApiRoute('GET /api/files/:name', 'GET', '/api/files/%E0%A4%A');
    expect(params).toEqual({ name: '%E0%A4%A' });
  });

  it('still decodes valid sequences', () => {
    expect(matchApiRoute('GET /api/files/:name', 'GET', '/api/files/hello%20world')).toEqual({
      name: 'hello world',
    });
  });
});

describe('splitSqlStatements', () => {
  it('splits simple statements', () => {
    expect(splitSqlStatements('CREATE TABLE a (x); CREATE TABLE b (y);')).toEqual([
      'CREATE TABLE a (x)',
      'CREATE TABLE b (y)',
    ]);
  });

  it('ignores semicolons inside string literals', () => {
    const sql = `INSERT INTO t (v) VALUES ('a;b'); CREATE TRIGGER tr AFTER INSERT ON t BEGIN UPDATE t SET v = 'x;y'; END;`;
    const parts = splitSqlStatements(sql);
    expect(parts).toHaveLength(2);
    expect(parts[0]).toBe(`INSERT INTO t (v) VALUES ('a;b')`);
    expect(parts[1]).toContain(`'x;y'`);
  });

  it('ignores semicolons inside comments', () => {
    const sql = `-- comment; with semicolon\nSELECT 1; /* block; comment */ SELECT 2`;
    expect(splitSqlStatements(sql)).toHaveLength(2);
  });

  it('handles escaped quotes', () => {
    expect(splitSqlStatements(`SELECT 'it''s; fine'; SELECT 2`)).toHaveLength(2);
  });

  it('drops empty statements', () => {
    expect(splitSqlStatements(';; SELECT 1;;')).toEqual(['SELECT 1']);
  });
});

describe('guarded server db', () => {
  it('allows normal DML on app tables', () => {
    const db = createGuardedServerDb(memDb());
    expect(() => db.query('SELECT * FROM todos WHERE id = ?', 1)).not.toThrow();
    expect(() => db.exec("INSERT INTO todos (title) VALUES ('x')")).not.toThrow();
    expect(() => db.exec('UPDATE todos SET done = 1')).not.toThrow();
    expect(() => db.exec('DELETE FROM todos')).not.toThrow();
    expect(() => db.exec('REPLACE INTO todos (id, title) VALUES (1, \'x\')')).not.toThrow();
  });

  it('blocks DDL and dangerous verbs', () => {
    const db = createGuardedServerDb(memDb());
    for (const sql of [
      'DROP TABLE todos',
      'ALTER TABLE todos ADD COLUMN x TEXT',
      'CREATE TABLE evil (x)',
      'ATTACH DATABASE \'/tmp/x\' AS e',
      'PRAGMA journal_mode=WAL',
      'VACUUM',
    ]) {
      expect(() => db.exec(sql), sql).toThrow(/not allowed/i);
    }
  });

  it.each(['messages', 'project_files', 'project_meta', 'sqlite_master'])(
    'blocks system table %s',
    (table) => {
      const db = createGuardedServerDb(memDb());
      expect(() => db.query(`SELECT * FROM ${table}`)).toThrow(new RegExp(table));
    }
  );

  it('does not false-positive on app tables sharing a prefix', () => {
    const db = createGuardedServerDb(memDb());
    // `messages_log` must NOT be blocked by the `messages` rule
    expect(() => db.query('SELECT * FROM messages_log')).not.toThrow();
    expect(() => db.query('SELECT * FROM project_files_archive')).not.toThrow();
  });

  it('blocks stacked multi-statements', () => {
    const db = createGuardedServerDb(memDb());
    expect(() => db.query('SELECT 1; DROP TABLE todos')).toThrow(/one SQL statement/i);
  });

  it('rejects empty input', () => {
    const db = createGuardedServerDb(memDb());
    expect(() => db.query('   ')).toThrow();
  });
});

describe('assertSafeServerSchema', () => {
  it('allows ordinary CREATE TABLE / INDEX / TRIGGER statements', () => {
    expect(() =>
      assertSafeServerSchema('CREATE TABLE IF NOT EXISTS todos (id INTEGER PRIMARY KEY, title TEXT)')
    ).not.toThrow();
    expect(() => assertSafeServerSchema('CREATE INDEX IF NOT EXISTS idx ON todos (title)')).not.toThrow();
    expect(() =>
      assertSafeServerSchema(`CREATE TRIGGER trg AFTER INSERT ON todos BEGIN UPDATE todos SET title = 'x'; END`)
    ).not.toThrow();
  });

  it.each([
    'DROP TABLE todos',
    'ALTER TABLE todos ADD COLUMN x TEXT',
    "ATTACH DATABASE '/tmp/x.db' AS evil",
    'PRAGMA journal_mode = WAL',
    'VACUUM',
  ])('blocks destructive DDL: %s', (stmt) => {
    expect(() => assertSafeServerSchema(stmt)).toThrow(/not allowed/i);
  });

  it.each([
    'CREATE TABLE messages (id INTEGER)',
    'DROP TABLE project_files',
    'CREATE TABLE project_meta (k TEXT)',
  ])('blocks references to IDE system tables: %s', (stmt) => {
    expect(() => assertSafeServerSchema(stmt)).toThrow(/not allowed|system table/i);
  });

  it('rejects empty input', () => {
    expect(() => assertSafeServerSchema('  ')).toThrow();
  });
});

describe('sandboxed module globals', () => {
  const entry = (body: string) =>
    loadServerEntry(
      '/server/routes.js',
      {
        '/server/routes.js': `
          export const routes = {
            'GET /api/probe': async () => Response.json({ ${body} }),
          };`,
      },
      memDb()
    );

  it('shadows network globals as undefined', async () => {
    const mod = entry(`
      fetchType: typeof fetch,
      wsType: typeof WebSocket,
      esType: typeof EventSource
    `);
    const res = await mod.routes['GET /api/probe']({ db: memDb(), req: new Request('https://x/'), params: {} });
    const body: any = await res.json();
    expect(body.fetchType).toBe('undefined');
    expect(body.wsType).toBe('undefined');
    expect(body.esType).toBe('undefined');
  });

  it('shadows timer/microtask re-arming and escape hatches', async () => {
    const mod = entry(`
      si: typeof setInterval,
      qm: typeof queueMicrotask,
      gt: typeof globalThis,
      proc: typeof process,
      cry: typeof crypto,
      slf: typeof self
    `);
    const res = await mod.routes['GET /api/probe']({ db: memDb(), req: new Request('https://x/'), params: {} });
    const body: any = await res.json();
    expect(body).toEqual({ si: 'undefined', qm: 'undefined', gt: 'undefined', proc: 'undefined', cry: 'undefined', slf: 'undefined' });
  });

  it('keeps the useful surface available', async () => {
    const mod = entry(`
      req: typeof Request,
      res: typeof Response,
      url: typeof URL,
      st: typeof setTimeout,
      con: typeof console,
      te: typeof TextEncoder
    `);
    const res = await mod.routes['GET /api/probe']({ db: memDb(), req: new Request('https://x/'), params: {} });
    const body: any = await res.json();
    expect(body).toEqual({ req: 'function', res: 'function', url: 'function', st: 'function', con: 'object', te: 'function' });
  });
});

describe('assertAllowedServerSql', () => {
  it('allows plain DML', () => {
    expect(() => assertAllowedServerSql('SELECT 1')).not.toThrow();
    expect(() => assertAllowedServerSql("INSERT INTO t (a) VALUES ('x')")).not.toThrow();
    expect(() => assertAllowedServerSql('WITH x AS (SELECT 1) SELECT * FROM x')).not.toThrow();
  });

  it('rejects multiple statements in one call', () => {
    expect(() => assertAllowedServerSql('SELECT 1; SELECT 2')).toThrow(/one SQL statement/i);
  });

  it('rejects DDL and pragmas', () => {
    expect(() => assertAllowedServerSql('DROP TABLE t')).toThrow();
    expect(() => assertAllowedServerSql('ALTER TABLE t ADD COLUMN x')).toThrow();
    expect(() => assertAllowedServerSql('CREATE TABLE t (id)')).toThrow();
    expect(() => assertAllowedServerSql('PRAGMA journal_mode = WAL')).toThrow();
  });

  it('rejects access to protected tables', () => {
    expect(() => assertAllowedServerSql('SELECT * FROM messages')).toThrow(/not allowed/);
    expect(() => assertAllowedServerSql('SELECT * FROM project_meta')).toThrow(/not allowed/);
    expect(() => assertAllowedServerSql('SELECT * FROM project_files')).toThrow(/not allowed/);
    expect(() => assertAllowedServerSql("DELETE FROM sqlite_master WHERE type='table'")).toThrow();
  });
});
