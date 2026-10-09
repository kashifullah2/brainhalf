import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

import { InMemoryDataStore } from '../lib/backend-runner';
import { applyPreviewCappedHeader, evaluateStoreCaps, orphanedTableNames, computeNextHydratedNames } from '../lib/preview-store-utils';
import { runMigrations, AGENT_MIGRATIONS } from '../lib/migrations';

// ---------------------------------------------------------------------------
// InMemoryDataStore unit tests
// ---------------------------------------------------------------------------

describe('InMemoryDataStore.serialize / loadTable', () => {
  it('round-trips tables and autoIds', () => {
    const store = new InMemoryDataStore();
    store.create('users', { name: 'Alice' });   // auto-id 1
    store.create('users', { name: 'Bob' });     // auto-id 2
    store.create('sessions', { token: 'abc', userId: 1 });

    const snapshot = store.serialize();
    expect(snapshot).toHaveLength(2);
    const usersEntry = snapshot.find(t => t.name === 'users')!;
    expect(usersEntry.rows).toHaveLength(2);
    expect(usersEntry.nextId).toBe(3);

    const fresh = new InMemoryDataStore();
    for (const { name, rows, nextId } of snapshot) fresh.loadTable(name, rows, nextId);

    expect(fresh.findAll('users')).toHaveLength(2);
    expect(fresh.findById('users', 1)).toMatchObject({ name: 'Alice' });
    // Auto-id continues from where it left off.
    const charlie = fresh.create('users', { name: 'Charlie' });
    expect(charlie.id).toBe(3);
  });

  it('serialize on an empty store returns an empty array', () => {
    expect(new InMemoryDataStore().serialize()).toEqual([]);
  });

  it('loadTable bypasses the MAX_TABLES guard', () => {
    // Manually populate 65 tables in the snapshot (one over the limit).
    // loadTable must not throw — the guard only applies to create().
    const target = new InMemoryDataStore();
    for (let i = 0; i < 65; i++) {
      target.loadTable(`table_${i}`, [{ id: 1, v: i }], 2);
    }
    expect(target.findAll('table_64')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Helpers to build a minimal agent-like object over a real SQLite database
// ---------------------------------------------------------------------------

function makeAgent(db: DatabaseSync) {
  const agent: any = {
    erasing: false,
    previewStore: new InMemoryDataStore(),
    previewStoreLoaded: false,
    previewStoreCapped: false,
    previewCappedReason: null as 'rows' | 'bytes' | null,
    hydratedTableNames: new Set<string>(),
    // Override these to test cap behaviour without inserting thousands of rows.
    _maxPreviewRows: 5_000,
    _maxPreviewTableBytes: 256 * 1024,
    ctx: { storage: { transactionSync: <R,>(fn: () => R): R => fn() } },
    sql: (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = Array.isArray(strings) ? (strings as unknown as string[]).join('?') : String(strings);
      return db.prepare(sql).all(...(values as any[]));
    },
  };

  // Bind prototype methods that reference `this`.
  const proto: any = {
    runSql(this: any, strings: TemplateStringsArray | string, ...values: unknown[]) {
      if (this.erasing) throw new Error('Project deleted');
      const sql = typeof strings === 'string'
        ? strings
        : Array.from(strings).join('?');
      return [...this.sql(typeof strings === 'string' ? [strings] as unknown as TemplateStringsArray : strings, ...values)];
    },
    transact(this: any, fn: () => unknown) {
      return this.ctx.storage.transactionSync(fn);
    },
    hydratePreviewStore(this: any) {
      if (this.previewStoreLoaded) return;
      this.previewStoreLoaded = true;
      this.hydratedTableNames = new Set<string>();
      let rows: Array<{ table_name: string; rows_json: string; next_id: number }>;
      try {
        rows = this.runSql`SELECT table_name, rows_json, next_id FROM preview_store` as Array<{ table_name: string; rows_json: string; next_id: number }>;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!/no such table/i.test(msg)) console.warn('Preview store could not be read:', msg);
        return;
      }
      for (const row of rows) {
        try {
          const items: unknown = JSON.parse(row.rows_json);
          if (!Array.isArray(items)) throw new Error('rows_json is not an array');
          this.previewStore.loadTable(row.table_name, items, row.next_id);
          this.hydratedTableNames.add(row.table_name.toLowerCase());
        } catch {
          // corrupt row; not added to hydratedTableNames so it is never deleted
        }
      }
      const capReason = evaluateStoreCaps(this.previewStore.serialize(), this._maxPreviewRows, this._maxPreviewTableBytes);
      if (capReason !== null) { this.previewStoreCapped = true; this.previewCappedReason = capReason; }
    },
    persistPreviewStore(this: any) {
      const MAX_ROWS: number = this._maxPreviewRows;
      const MAX_BYTES: number = this._maxPreviewTableBytes;
      try {
        const tables: Array<{ name: string; rows: any[]; nextId: number }> = this.previewStore.serialize();
        const totalRows = tables.reduce((sum: number, t: { rows: any[] }) => sum + t.rows.length, 0);
        if (totalRows > MAX_ROWS) {
          this.previewStoreCapped = true;
          this.previewCappedReason = 'rows';
          return;
        }
        const inMemoryNames = new Set(tables.map((t: { name: string }) => t.name.toLowerCase()));
        const byteCappedNames = new Set<string>();
        this.transact(() => {
          for (const { name, rows, nextId } of tables) {
            const blob = JSON.stringify(rows);
            if (blob.length > MAX_BYTES) { byteCappedNames.add(name.toLowerCase()); continue; }
            this.runSql`INSERT OR REPLACE INTO preview_store (table_name, rows_json, next_id) VALUES (${name}, ${blob}, ${nextId})`;
          }
          for (const name of orphanedTableNames(this.hydratedTableNames as Set<string>, inMemoryNames)) {
            this.runSql`DELETE FROM preview_store WHERE table_name = ${name}`;
          }
        });
        this.hydratedTableNames = computeNextHydratedNames(this.hydratedTableNames as Set<string>, inMemoryNames, byteCappedNames);
        const byteCapped = byteCappedNames.size > 0;
        this.previewStoreCapped = byteCapped;
        this.previewCappedReason = byteCapped ? 'bytes' : null;
      } catch { /* auxiliary */ }
    },
  };

  // Bind methods so `this` resolves correctly.
  for (const [key, fn] of Object.entries(proto)) {
    agent[key] = (fn as Function).bind(agent);
  }
  return agent;
}

// ---------------------------------------------------------------------------
// Persistence integration tests
// ---------------------------------------------------------------------------

describe('previewStore SQLite persistence', () => {
  it('persists rows and autoIds and restores them in a fresh agent', () => {
    const db = new DatabaseSync(':memory:');
    runMigrations(
      AGENT_MIGRATIONS,
      s => db.prepare(s).all() as Array<Record<string, unknown>>,
      <R,>(fn: () => R) => fn(),
    );

    // Agent A: write data and persist.
    const agentA = makeAgent(db);
    agentA.previewStore.create('users', { name: 'Alice', email: 'alice@example.com' });
    agentA.previewStore.create('users', { name: 'Bob', email: 'bob@example.com' });
    agentA.previewStore.create('sessions', { token: 'tok1', userId: 1 });
    agentA.persistPreviewStore();

    // Agent B: fresh instance over the same DB (simulates DO wake after hibernation).
    const agentB = makeAgent(db);
    expect(agentB.previewStore.findAll('users')).toHaveLength(0); // not loaded yet
    agentB.hydratePreviewStore();

    expect(agentB.previewStore.findAll('users')).toHaveLength(2);
    expect(agentB.previewStore.findById('users', 1)).toMatchObject({ name: 'Alice' });
    expect(agentB.previewStore.findAll('sessions')).toHaveLength(1);

    // autoId must continue from 3 so the next user doesn't collide.
    const charlie = agentB.previewStore.create('users', { name: 'Charlie' });
    expect(charlie.id).toBe(3);
  });

  it('hydratePreviewStore is idempotent — does not double-load on multiple calls', () => {
    const db = new DatabaseSync(':memory:');
    runMigrations(
      AGENT_MIGRATIONS,
      s => db.prepare(s).all() as Array<Record<string, unknown>>,
      <R,>(fn: () => R) => fn(),
    );

    const agentA = makeAgent(db);
    agentA.previewStore.create('items', { label: 'x' });
    agentA.persistPreviewStore();

    const agentB = makeAgent(db);
    agentB.hydratePreviewStore();
    agentB.hydratePreviewStore(); // second call must be a no-op
    expect(agentB.previewStore.findAll('items')).toHaveLength(1);
  });

  it('successive persists overwrite earlier snapshots', () => {
    const db = new DatabaseSync(':memory:');
    runMigrations(
      AGENT_MIGRATIONS,
      s => db.prepare(s).all() as Array<Record<string, unknown>>,
      <R,>(fn: () => R) => fn(),
    );

    const agent = makeAgent(db);
    agent.previewStore.create('todos', { text: 'first' });
    agent.persistPreviewStore();

    agent.previewStore.create('todos', { text: 'second' });
    agent.persistPreviewStore();

    const fresh = makeAgent(db);
    fresh.hydratePreviewStore();
    expect(fresh.previewStore.findAll('todos')).toHaveLength(2);
  });

  it('erase (delete from preview_store) leaves nothing for a subsequent agent', () => {
    const db = new DatabaseSync(':memory:');
    runMigrations(
      AGENT_MIGRATIONS,
      s => db.prepare(s).all() as Array<Record<string, unknown>>,
      <R,>(fn: () => R) => fn(),
    );

    const agent = makeAgent(db);
    agent.previewStore.create('notes', { body: 'keep me' });
    agent.persistPreviewStore();

    // Simulate erase: deleteAll() wipes all DO storage, including preview_store.
    db.exec('DELETE FROM preview_store');

    const afterErase = makeAgent(db);
    afterErase.hydratePreviewStore();
    expect(afterErase.previewStore.findAll('notes')).toHaveLength(0);
  });

  it('does not persist when total rows exceed MAX_PREVIEW_PERSIST_ROWS', () => {
    const db = new DatabaseSync(':memory:');
    runMigrations(
      AGENT_MIGRATIONS,
      s => db.prepare(s).all() as Array<Record<string, unknown>>,
      <R,>(fn: () => R) => fn(),
    );

    // Write a small snapshot first so the DB has a baseline.
    const agentA = makeAgent(db);
    agentA.previewStore.create('small', { v: 1 });
    agentA.persistPreviewStore();

    // Agent B grows beyond a tiny cap.
    const agentB = makeAgent(db);
    agentB.hydratePreviewStore();
    agentB._maxPreviewRows = 2; // use a tiny cap to avoid inserting 5 001 real rows

    agentB.previewStore.create('big', { v: 1 });
    agentB.previewStore.create('big', { v: 2 });
    agentB.previewStore.create('big', { v: 3 }); // 3 rows total > cap of 2
    agentB.persistPreviewStore(); // should skip

    // previewStoreCapped must be set.
    expect(agentB.previewStoreCapped).toBe(true);
    // The DB still reflects Agent A's snapshot, not B's oversized state.
    const check = db.prepare("SELECT rows_json FROM preview_store WHERE table_name = 'big'").get() as any;
    expect(check).toBeUndefined();
  });

  it('corrupt rows_json is skipped during hydration and the DB row is not overwritten until a real mutation', () => {
    const db = new DatabaseSync(':memory:');
    runMigrations(
      AGENT_MIGRATIONS,
      s => db.prepare(s).all() as Array<Record<string, unknown>>,
      <R,>(fn: () => R) => fn(),
    );

    // Manually insert a corrupt row and a valid row.
    db.prepare(`INSERT INTO preview_store (table_name, rows_json, next_id) VALUES (?, ?, ?)`)
      .run('corrupt_table', 'NOT VALID JSON', 1);
    db.prepare(`INSERT INTO preview_store (table_name, rows_json, next_id) VALUES (?, ?, ?)`)
      .run('good_table', JSON.stringify([{ id: 1, v: 'ok' }]), 2);

    const agent = makeAgent(db);
    agent.hydratePreviewStore();

    // Corrupt table is not loaded; valid table is.
    expect(agent.previewStore.findAll('corrupt_table')).toHaveLength(0);
    expect(agent.previewStore.findAll('good_table')).toHaveLength(1);

    // A mutation to good_table triggers persist.
    agent.previewStore.create('good_table', { v: 'new' });
    agent.persistPreviewStore();

    // corrupt_table's DB row must still contain the corrupt string — INSERT OR
    // REPLACE only writes tables that are in memory, and corrupt_table is not.
    const corruptRow = db.prepare(`SELECT rows_json FROM preview_store WHERE table_name = 'corrupt_table'`).get() as any;
    expect(corruptRow?.rows_json).toBe('NOT VALID JSON');

    // good_table is updated with both rows.
    const goodRow = db.prepare(`SELECT rows_json FROM preview_store WHERE table_name = 'good_table'`).get() as any;
    expect(JSON.parse(goodRow.rows_json)).toHaveLength(2);
  });

  it('previewStoreCapped clears when rows drop back below the cap', () => {
    const db = new DatabaseSync(':memory:');
    runMigrations(
      AGENT_MIGRATIONS,
      s => db.prepare(s).all() as Array<Record<string, unknown>>,
      <R,>(fn: () => R) => fn(),
    );

    const agent = makeAgent(db);
    agent._maxPreviewRows = 2;

    // Trip the cap.
    agent.previewStore.create('t', { v: 1 });
    agent.previewStore.create('t', { v: 2 });
    agent.previewStore.create('t', { v: 3 });
    agent.persistPreviewStore();
    expect(agent.previewStoreCapped).toBe(true);
    // Nothing written to DB while capped.
    expect(db.prepare(`SELECT COUNT(*) AS n FROM preview_store`).get() as any).toMatchObject({ n: 0 });

    // Delete one row so count drops to 2 (≤ cap).
    agent.previewStore.delete('t', 3);
    agent.persistPreviewStore();
    expect(agent.previewStoreCapped).toBe(false);
    expect(agent.previewCappedReason).toBeNull();
    // Now data is in the DB.
    const row = db.prepare(`SELECT rows_json FROM preview_store WHERE table_name = 't'`).get() as any;
    expect(JSON.parse(row.rows_json)).toHaveLength(2);

    // A fresh agent restores the correct snapshot.
    const fresh = makeAgent(db);
    fresh.hydratePreviewStore();
    expect(fresh.previewStore.findAll('t')).toHaveLength(2);
  });

  it('hydrate and persist are no-ops when the preview_store table does not exist', () => {
    // Use a DB without running migrations (no preview_store table).
    const db = new DatabaseSync(':memory:');
    // Create schema_version so runSql does not throw on that lookup — but omit
    // the preview_store table to simulate a pre-v15 deploy.
    db.exec(`CREATE TABLE schema_version (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)`);

    const agent = makeAgent(db);
    expect(() => agent.hydratePreviewStore()).not.toThrow();
    // Store is empty after failed hydration.
    expect(agent.previewStore.serialize()).toHaveLength(0);

    // A mutation is safe; persist silently swallows the missing-table error.
    agent.previewStore.create('items', { name: 'x' });
    expect(() => agent.persistPreviewStore()).not.toThrow();
    // previewStoreCapped must NOT be set by a DB error (only by the row cap).
    expect(agent.previewStoreCapped).toBe(false);
  });

  it('applyPreviewCappedHeader adds X-BH-Preview-Capped when capped and omits it when not', () => {
    const notCapped = applyPreviewCappedHeader(new Response('{}', { status: 200 }), false);
    expect(notCapped.headers.get('X-BH-Preview-Capped')).toBeNull();

    const capped = applyPreviewCappedHeader(new Response('{}', { status: 201 }), true);
    expect(capped.headers.get('X-BH-Preview-Capped')).toBe('true');
    expect(capped.status).toBe(201);
  });

  it('previewStoreCapped and previewCappedReason clear when rows drop back below the cap', () => {
    const db = new DatabaseSync(':memory:');
    runMigrations(AGENT_MIGRATIONS, s => db.prepare(s).all() as Array<Record<string, unknown>>, <R,>(fn: () => R) => fn());

    const agent = makeAgent(db);
    agent._maxPreviewRows = 2;

    agent.previewStore.create('t', { v: 1 });
    agent.previewStore.create('t', { v: 2 });
    agent.previewStore.create('t', { v: 3 }); // over cap
    agent.persistPreviewStore();

    expect(agent.previewStoreCapped).toBe(true);
    expect(agent.previewCappedReason).toBe('rows');
    expect(applyPreviewCappedHeader(new Response('{}', { status: 200 }), agent.previewStoreCapped).headers.get('X-BH-Preview-Capped')).toBe('true');

    // Recovery: delete a row so count drops to 2 (≤ cap).
    agent.previewStore.delete('t', 3);
    agent.persistPreviewStore();

    expect(agent.previewStoreCapped).toBe(false);
    expect(agent.previewCappedReason).toBeNull();
    expect(applyPreviewCappedHeader(new Response('{}', { status: 200 }), agent.previewStoreCapped).headers.get('X-BH-Preview-Capped')).toBeNull();
  });

  it('hydratePreviewStore re-evaluates caps so a fresh instance knows it is capped after wake', () => {
    const db = new DatabaseSync(':memory:');
    runMigrations(AGENT_MIGRATIONS, s => db.prepare(s).all() as Array<Record<string, unknown>>, <R,>(fn: () => R) => fn());

    // Insert rows directly — simulates data that was written when the cap was
    // higher (or a different DO instance), now exceeding the current cap limit.
    const rows = [{ id: 1, v: 'a' }, { id: 2, v: 'b' }, { id: 3, v: 'c' }];
    db.prepare('INSERT INTO preview_store (table_name, rows_json, next_id) VALUES (?, ?, ?)').run('t', JSON.stringify(rows), 4);

    const agent = makeAgent(db);
    agent._maxPreviewRows = 2; // tiny cap: 3 loaded rows trips it
    expect(agent.previewStoreCapped).toBe(false); // starts false before hydration

    agent.hydratePreviewStore();

    expect(agent.previewStoreCapped).toBe(true);
    expect(agent.previewCappedReason).toBe('rows');
    // A history frame sent by this instance would carry previewStoreCapped: true.
    const historyPayload = { previewStoreCapped: agent.previewStoreCapped, previewCappedReason: agent.previewCappedReason };
    expect(historyPayload).toEqual({ previewStoreCapped: true, previewCappedReason: 'rows' });
  });

  it('a table removed from memory after hydration does not reappear after simulated wake', () => {
    const db = new DatabaseSync(':memory:');
    runMigrations(AGENT_MIGRATIONS, s => db.prepare(s).all() as Array<Record<string, unknown>>, <R,>(fn: () => R) => fn());

    // Agent A: persist three tables.
    const agentA = makeAgent(db);
    agentA.hydratePreviewStore();
    agentA.previewStore.create('alpha', { v: 1 });
    agentA.previewStore.create('beta', { v: 1 });
    agentA.previewStore.create('gamma', { v: 1 });
    agentA.persistPreviewStore();

    // Agent B: wakes, hydrates all three, then the app resets and only uses alpha+gamma.
    const agentB = makeAgent(db);
    agentB.hydratePreviewStore();
    expect(agentB.hydratedTableNames.size).toBe(3); // alpha, beta, gamma

    // Simulate an app schema reset: clear memory and re-populate only alpha + gamma.
    agentB.previewStore.reset();
    agentB.previewStore.create('alpha', { v: 2 });
    agentB.previewStore.create('gamma', { v: 2 });
    agentB.persistPreviewStore();

    // DB must not contain beta anymore.
    const betaRow = db.prepare(`SELECT * FROM preview_store WHERE table_name = 'beta'`).get();
    expect(betaRow).toBeUndefined();

    // Agent C: wakes and hydrates — beta must not reappear.
    const agentC = makeAgent(db);
    agentC.hydratePreviewStore();
    expect(agentC.previewStore.findAll('alpha')).toHaveLength(1);
    expect(agentC.previewStore.findAll('gamma')).toHaveLength(1);
    expect(agentC.previewStore.serialize().map((t: { name: string }) => t.name)).not.toContain('beta');
  });
});
