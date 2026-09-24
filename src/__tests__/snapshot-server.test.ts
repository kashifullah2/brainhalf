import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AGENT_MIGRATIONS, runMigrations } from '../lib/migrations';
import { WriteEpoch } from '../lib/concurrency';

vi.mock('cloudflare:workers', () => ({ tracing: {} }));
vi.mock('agents', () => ({ Agent: class {} }));
import { ChatAgent } from '../agent';

describe('Workspace snapshots over real SQLite', () => {
  let database: DatabaseSync;
  let agent: any;
  const connection = { id: 'snapshot-connection', send: vi.fn() };

  beforeEach(() => {
    database = new DatabaseSync(':memory:');
    runMigrations(AGENT_MIGRATIONS, statement => database.prepare(statement).all() as Record<string, unknown>[], callback => {
      database.exec('BEGIN');
      try { const result = callback(); database.exec('COMMIT'); return result; }
      catch (error) { database.exec('ROLLBACK'); throw error; }
    });
    agent = Object.create(ChatAgent.prototype);
    agent.writeEpoch = new WriteEpoch();
    agent.sql = (strings: TemplateStringsArray, ...values: any[]) => database.prepare(strings.join('?')).all(...values);
    agent.ensureSchema = () => {};
    agent.connectionUserIds = new Map([[connection.id, 'owner']]);
  agent.authCache = new Map();
  agent.authorizeConnection = vi.fn(async () => true);
  agent.getConnections = () => [];
    connection.send.mockClear();
  });

  afterEach(() => database.close());

  function insert(path: string, content = 'content') {
    database.prepare('INSERT INTO project_files (path, content) VALUES (?, ?)').run(path, content);
  }

  async function request(data: Record<string, unknown> = {}) {
    await agent.onMessage(connection, JSON.stringify({ type: 'get_files', requestId: 'test-snapshot', ...data }));
    return JSON.parse(connection.send.mock.lastCall![0]);
  }

  it('advances across secret rows without repeating or revealing them', async () => {
    insert('/.env', 'secret');
    insert('/src/a.js', 'a');
    insert('/src/b.js', 'b');
    const first = await request({ limit: 2 });
    expect(first.files).toEqual({ '/src/a.js': 'a' });
    expect(first.nextOffset).toBe(2);
    expect(first.hasMore).toBe(true);
    const last = await request({ limit: 2, offset: first.nextOffset, revision: first.revision });
    expect(last.files).toEqual({ '/src/b.js': 'b' });
    expect(last.hasMore).toBe(false);
  });

  it.each(['INSERT', 'UPDATE', 'DELETE'])('invalidates a snapshot after %s, including across object recreation', async operation => {
    insert('/src/a.js');
    insert('/src/b.js');
    const first = await request({ limit: 1 });
    if (operation === 'INSERT') insert('/src/new.js');
    if (operation === 'UPDATE') database.exec("UPDATE project_files SET content = 'changed' WHERE path = '/src/a.js'");
    if (operation === 'DELETE') database.exec("DELETE FROM project_files WHERE path = '/src/a.js'");
    agent = Object.assign(Object.create(ChatAgent.prototype), { sql: agent.sql, authorizeConnection: agent.authorizeConnection, ensureSchema: agent.ensureSchema, connectionUserIds: agent.connectionUserIds, authCache: agent.authCache, writeEpoch: new WriteEpoch() });
    expect(await request({ offset: first.nextOffset, revision: first.revision })).toEqual({ type: 'files_snapshot_stale', requestId: 'test-snapshot' });
  });

  it('counts encoded bytes and assembles a complete workspace beyond one byte-limited page', () => {
    const content = '漢'.repeat(400_000);
    for (let index = 0; index < 10; index += 1) insert(`/src/file-${index}.txt`, content);
    const first = agent.readProjectFilesPage(200, 0);
    expect(first.hasMore).toBe(true);
    expect(first.truncated).toBe(true);
    expect(new TextEncoder().encode(JSON.stringify(first.files)).length).toBeLessThan(8 * 1024 * 1024);
    const second = agent.readProjectFilesPage(200, first.nextOffset);
    expect(Object.keys({ ...first.files, ...second.files })).toHaveLength(10);
    expect(Object.keys(agent.readAllProjectFiles())).toHaveLength(10);
  });

  it('pages beyond 200 files and preserves secrets only in backups', () => {
    insert('/.env', 'private');
    for (let index = 0; index < 410; index += 1) insert(`/src/file-${String(index).padStart(3, '0')}.js`);
    const first = agent.readProjectFilesPage(200, 0);
    expect(first.nextOffset).toBe(200);
    expect(first.hasMore).toBe(true);
    expect(Object.keys(agent.readAllProjectFiles())).toHaveLength(410);
    expect(agent.readAllProjectFiles()).not.toHaveProperty('/.env');
    expect(agent.readAllProjectFilesForBackup()['/.env']).toBe('private');
  });

  it('returns an explicit error for a single oversized encoded file', async () => {
    insert('/src/oversized.txt', '\u0001'.repeat(1_500_000));
    const result = await request();
    expect(result.type).toBe('files_snapshot_error');
    expect(result).not.toHaveProperty('files');
  });

  it('returns a complete empty snapshot', async () => {
    expect(await request()).toMatchObject({ protocol: 2, files: {}, offset: 0, nextOffset: 0, hasMore: false });
  });

  it('acknowledges only the revision persisted by file synchronization', async () => {
    agent.backupToR2 = async () => {};
    agent.ctx = { storage: { transactionSync: (callback: () => unknown) => callback() } };
    await agent.onMessage(connection, JSON.stringify({ type: 'sync_files', files: { '/src/App.tsx': 'export default () => null;' } }));
    expect(JSON.parse(connection.send.mock.lastCall![0])).toEqual({ type: 'files_synced', revision: agent.getFilesRevision() });
    expect(database.prepare('SELECT content FROM project_files').get()?.content).toBe('export default () => null;');
  });

  it('refuses an outdated local overwrite without deleting newer server files', async () => {
    insert('/src/App.tsx', 'newer server code');
    const revision = agent.getFilesRevision();
    await agent.onMessage(connection, JSON.stringify({ type: 'sync_files', expected_revision: revision - 1, replace_all: true, files: { '/src/old.tsx': 'stale local code' } }));
    expect(JSON.parse(connection.send.mock.lastCall![0])).toEqual({ type: 'files_sync_conflict', revision });
    expect(database.prepare('SELECT path, content FROM project_files').all()).toEqual([{ path: '/src/App.tsx', content: 'newer server code' }]);
  });

  it('preserves server-only secrets during an approved local-file overwrite', async () => {
    insert('/server/.env', 'DATABASE_URL=private');
    insert('/src/stale.tsx', 'old source');
    agent.backupToR2 = async () => {};
    agent.ctx = { storage: { transactionSync: (callback: () => unknown) => callback() } };
    await agent.onMessage(connection, JSON.stringify({ type: 'sync_files', expected_revision: agent.getFilesRevision(), preserve_secrets: true, replace_all: true, files: { '/src/App.tsx': 'new source' } }));
    expect(database.prepare('SELECT path, content FROM project_files ORDER BY path').all()).toEqual([
      { path: '/server/.env', content: 'DATABASE_URL=private' },
      { path: '/src/App.tsx', content: 'new source' },
    ]);
  });

  it.each([false, true])('uses server snapshots on connect and identifies an initially empty workspace (%s)', async empty => {
    if (!empty) insert('/src/App.tsx', 'server code');
    agent.restoreFromR2 = vi.fn(async () => {});
    agent.ctx = { storage: { transactionSync: (callback: () => unknown) => callback() } };
    await agent.onConnect({ ...connection, setState: vi.fn() }, { request: new Request('https://brainhalf.com/agents/chat/project?_sid=' + 'a'.repeat(64), { headers: { 'x-auth-user-id': 'owner' } }) });
    const events = connection.send.mock.calls.map(([message]) => JSON.parse(message));
    expect(events.find(event => event.type === 'history')).toMatchObject({ workspaceSync: 'snapshot-v2', workspaceEmpty: empty });
    expect(events.some(event => event.type === 'files_changed')).toBe(true);
    expect(events.some(event => event.type === 'request_sync')).toBe(false);
    if (!empty) expect(database.prepare('SELECT content FROM project_files').get()?.content).toBe('server code');
  });
});
