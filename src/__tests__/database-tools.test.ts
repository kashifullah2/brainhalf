import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';
import { CloudflareAPI } from '../runtime/cloudflare-api';
import { prepareRowImport, readDatabaseTable } from '../runtime/database-tools';
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
    try { const page = await readDatabaseTable(api, 'own-db', 'items'); expect(page.rows).toHaveLength(50); expect(page.hasMore).toBe(true); expect(page.rows[0].title).toContain('exceeds'); expect(page.rows[0].bytes).toBe('[binary value]'); expect((await readDatabaseTable(api, 'own-db', 'items', 50)).rows).toHaveLength(2); }
    finally { db.close(); }
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
