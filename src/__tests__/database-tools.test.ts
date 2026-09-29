import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';
import { CloudflareAPI } from '../runtime/cloudflare-api';
import { prepareAddColumn, prepareCreateIndex, prepareCreateTable, prepareDropColumn, prepareDropTable, prepareRowDelete, prepareRowImport, prepareRowUpdate, readDatabaseSchema, readDatabaseTable } from '../runtime/database-tools';
import { monitoredRoute, recordAppRequest, REQUEST_MONITOR_SCHEMA } from '../runtime/request-monitor';

describe('database tools and private monitoring', () => {
  it('uses the Workers-supported manual redirect policy and refuses upstream redirects', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 302, headers: { Location: 'https://untrusted.test' } }));
    try {
      await expect(new CloudflareAPI('account', 'server-only-token').query('db', 'SELECT 1')).rejects.toThrow('302');
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(fetch.mock.calls[0][1]?.redirect).toBe('manual');
    } finally { fetch.mockRestore(); }
  });
  it('imports records atomically and treats SQL-looking cell values as data', () => {
    const db = new DatabaseSync(':memory:'); db.exec('CREATE TABLE items(id TEXT PRIMARY KEY, title TEXT)');
    try {
      const prepared = prepareRowImport('items', [{ id: '1', title: "'); DROP TABLE items; --" }], ['id', 'title']);
      db.prepare(prepared.sql).run(...prepared.params);
      expect(db.prepare('SELECT title FROM items').get()?.title).toContain('DROP TABLE');
      const duplicate = prepareRowImport('items', [{ id: '2', title: 'new' }, { id: '1', title: 'duplicate' }], ['id', 'title']);
      expect(() => db.prepare(duplicate.sql).run(...duplicate.params)).toThrow();
      expect(db.prepare('SELECT count(*) AS count FROM items').get()?.count).toBe(1);
      expect(() => prepareRowImport('items; DELETE', [], [])).toThrow();
      expect(() => prepareRowImport('items', [{ id: { invalid: true } }], ['id'])).toThrow();
    } finally { db.close(); }
  });
  it('pages records and keeps giant text and binary values out of table previews', async () => {
    const db = new DatabaseSync(':memory:'); db.exec('CREATE TABLE items(id INTEGER PRIMARY KEY, title TEXT, bytes BLOB)');
    for (let i = 0; i < 52; i++) db.prepare('INSERT INTO items VALUES (?,?,?)').run(i, 'x'.repeat(i ? 2 : 9000), new Uint8Array([1, 2]));
    const api: any = { query: async (_id: string, sql: string, params: any[] = []) => db.prepare(sql).all(...params) };
    try { const page = await readDatabaseTable(api, 'own-db', 'items'); expect(page.rows).toHaveLength(50); expect(page.hasMore).toBe(true); expect(page.rows[0].title).toContain('exceeds'); expect(page.rows[0].bytes).toBe('[binary value]'); expect(page.rowIds).toBe(true); expect(page.rows[1].__bh_rowid).toBe(1); expect((await readDatabaseTable(api, 'own-db', 'items', 50)).rows).toHaveLength(2); }
    finally { db.close(); }
  });
  it('falls back to read-only rows for WITHOUT ROWID tables', async () => {
    const db = new DatabaseSync(':memory:'); db.exec('CREATE TABLE pairs(id TEXT PRIMARY KEY, note TEXT) WITHOUT ROWID');
    db.prepare('INSERT INTO pairs VALUES (?,?)').run('a', 'first');
    const api: any = {
      query: async (_id: string, sql: string, params: any[] = []) => {
        if (/rowid/i.test(sql)) throw new Error('no such column: rowid');
        return db.prepare(sql).all(...params);
      },
    };
    try {
      const page = await readDatabaseTable(api, 'own-db', 'pairs');
      expect(page.rowIds).toBe(false);
      expect(page.rows).toHaveLength(1);
      expect(page.rows[0].note).toBe('first');
    } finally { db.close(); }
  });
  it('updates and deletes single rows by id with validated values', () => {
    const db = new DatabaseSync(':memory:'); db.exec('CREATE TABLE items(id INTEGER PRIMARY KEY, title TEXT, qty INTEGER)');
    db.prepare('INSERT INTO items VALUES (1,?,?)').run('old', 2);
    try {
      const update = prepareRowUpdate('items', 1, { title: "x'); DROP TABLE items; --", qty: 5 }, ['id', 'title', 'qty']);
      db.prepare(update.sql).run(...update.params);
      expect(db.prepare('SELECT title, qty FROM items WHERE id = 1').get()).toMatchObject({ title: "x'); DROP TABLE items; --", qty: 5 });
      const remove = prepareRowDelete('items', 1);
      db.prepare(remove.sql).run(...remove.params);
      expect(db.prepare('SELECT count(*) AS count FROM items').get()?.count).toBe(0);
      expect(() => prepareRowUpdate('items', 1, { missing: 1 }, ['id'])).toThrow();
      expect(() => prepareRowUpdate('items', 1, {}, ['id'])).toThrow();
      expect(() => prepareRowUpdate('items', 1, { id: { nested: true } }, ['id'])).toThrow();
      expect(() => prepareRowDelete('items', 'not-a-number')).toThrow();
      expect(() => prepareRowDelete('items; DROP', 1)).toThrow();
      expect(() => prepareRowDelete('items', 0)).toThrow();
    } finally { db.close(); }
  });
  it('reports schema with column constraints and row counts', async () => {
    const db = new DatabaseSync(':memory:');
    db.exec("CREATE TABLE items(id INTEGER PRIMARY KEY, title TEXT NOT NULL DEFAULT 'untitled', qty REAL)");
    db.exec('CREATE TABLE _bh_internal(id INTEGER)');
    db.prepare('INSERT INTO items(title, qty) VALUES (?,?)').run('a', 1.5);
    db.prepare('INSERT INTO items(title, qty) VALUES (?,?)').run('b', null);
    const api: any = { query: async (_id: string, sql: string, params: any[] = []) => db.prepare(sql).all(...params) };
    try {
      const { tables } = await readDatabaseSchema(api, 'own-db');
      expect(tables).toHaveLength(1);
      expect(tables[0].name).toBe('items');
      expect(tables[0].rowCount).toBe(2);
      expect(tables[0].columns).toEqual([
        { name: 'id', type: 'INTEGER', notNull: false, primaryKey: true, defaultValue: null },
        { name: 'title', type: 'TEXT', notNull: true, primaryKey: false, defaultValue: "'untitled'" },
        { name: 'qty', type: 'REAL', notNull: false, primaryKey: false, defaultValue: null },
      ]);
    } finally { db.close(); }
  });
  it('creates tables from column definitions with constraints and safe defaults', () => {
    const db = new DatabaseSync(':memory:');
    try {
      const created = prepareCreateTable('products', [
        { name: 'id', type: 'integer', primaryKey: true },
        { name: 'title', type: 'TEXT', notNull: true, defaultValue: "it's here" },
        { name: 'price', type: 'REAL' },
      ]);
      db.exec(created.sql);
      db.prepare("INSERT INTO products(price) VALUES (9.5)").run();
      expect(db.prepare('SELECT title FROM products').get()?.title).toBe("it's here");
      expect(() => prepareCreateTable('bad; DROP TABLE x', [{ name: 'id', type: 'TEXT' }])).toThrow();
      expect(() => prepareCreateTable('t', [])).toThrow();
      expect(() => prepareCreateTable('t', [{ name: 'id', type: 'TEXT', primaryKey: true }, { name: 'b', type: 'TEXT', primaryKey: true }])).toThrow();
      expect(() => prepareCreateTable('t', [{ name: 'a', type: 'TEXT' }, { name: 'a', type: 'TEXT' }])).toThrow();
      expect(() => prepareCreateTable('t', [{ name: 'a', type: 'JSON' }])).toThrow();
    } finally { db.close(); }
  });
  it('adds and drops columns following SQLite rules', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE items(id INTEGER PRIMARY KEY, title TEXT)');
    db.prepare('INSERT INTO items VALUES (1, ?)').run('first');
    try {
      const added = prepareAddColumn('items', { name: 'qty', type: 'INTEGER', notNull: true, defaultValue: 0 });
      db.exec(added.sql);
      expect(db.prepare('SELECT qty FROM items WHERE id = 1').get()?.qty).toBe(0);
      const dropped = prepareDropColumn('items', 'qty');
      db.exec(dropped.sql);
      expect(db.prepare('PRAGMA table_info("items")').all().map(column => column.name)).toEqual(['id', 'title']);
      expect(() => prepareAddColumn('items', { name: 'x', type: 'TEXT', notNull: true })).toThrow(/default/);
      expect(() => prepareAddColumn('items', { name: 'x', type: 'TEXT', primaryKey: true })).toThrow(/primary key/);
      expect(() => prepareDropColumn('items', 'bad name;')).toThrow();
    } finally { db.close(); }
  });
  it('creates foreign keys, indexes and drops whole tables safely', async () => {
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    try {
      db.exec(prepareCreateTable('users', [{ name: 'id', type: 'INTEGER', primaryKey: true }]).sql);
      db.exec(prepareCreateTable('orders', [
        { name: 'id', type: 'INTEGER', primaryKey: true },
        { name: 'user_id', type: 'INTEGER', notNull: true, references: 'users.id' },
      ]).sql);
      db.prepare('INSERT INTO users(id) VALUES (1)').run();
      db.prepare('INSERT INTO orders(id, user_id) VALUES (10, 1)').run();
      expect(() => db.prepare('INSERT INTO orders(id, user_id) VALUES (11, 99)').run()).toThrow();
      db.exec(prepareCreateIndex('orders', 'orders_user', ['user_id'], false).sql);
      db.exec(prepareCreateIndex('orders', 'orders_unique', ['id'], true).sql);
      const api: any = { query: async (_id: string, sql: string, params: any[] = []) => db.prepare(sql).all(...params) };
      const { tables } = await readDatabaseSchema(api, 'own-db');
      const orders = tables.find(table => table.name === 'orders')!;
      expect(orders.indexes.map(index => index.name).sort()).toEqual(['orders_unique', 'orders_user']);
      expect(orders.indexes.find(index => index.name === 'orders_unique')?.unique).toBe(true);
      db.exec(prepareDropTable('orders').sql);
      expect(db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name='orders'").get()).toBeUndefined();
      expect(() => prepareDropTable('users; DROP TABLE users')).toThrow();
      expect(() => prepareCreateIndex('orders', 'x', ['a', 'a'], false)).toThrow();
      expect(() => prepareCreateTable('t', [{ name: 'x', type: 'INTEGER', references: 'not-a-ref' }])).toThrow();
    } finally { db.close(); }
  });
  it('retains only bounded request metadata with no URL secrets or arbitrary paths', () => {
    const db = new DatabaseSync(':memory:'); for (const sql of REQUEST_MONITOR_SCHEMA) db.exec(sql);
    const sql: any = { exec: (statement: string, ...params: any[]) => db.prepare(statement).run(...params) };
    try {
      for (let i = 0; i < 210; i++) recordAppRequest(sql, 'production', new Request('https://app.test/api/private/person@example.com?token=secret'), 503, Date.now() - 10);
      expect(db.prepare('SELECT count(*) AS count FROM app_request_events').get()?.count).toBe(200);
      expect(db.prepare('SELECT requests,errors FROM app_request_metrics').get()).toMatchObject({ requests: 210, errors: 210 });
      expect(monitoredRoute('/api/private/person@example.com')).toBe('/api/*');
      expect(JSON.stringify(db.prepare('SELECT * FROM app_request_events').all())).not.toMatch(/secret|person@/);
    } finally { db.close(); }
  });
});
