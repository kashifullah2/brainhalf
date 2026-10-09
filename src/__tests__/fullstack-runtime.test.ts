import { describe, expect, it, vi, afterEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { sourceSnapshot, assertSafeMigration } from '../runtime/source';
import { sealSecret, openSecret, validateIntegration } from '../runtime/secrets';
import { validateArtifact } from '../runtime/artifact';
import { addWorkersBackend } from '../lib/workers-starter';
import { createTypeScriptStarter } from '../lib/project-starters';
import { contactInput } from '../runtime/integrations';
import { CloudflareAPI } from '../runtime/cloudflare-api';

const execute = promisify(execFile);

afterEach(() => vi.unstubAllGlobals());
describe('Full-stack runtime boundaries', () => {
  it.each([204, 404])('treats an empty DELETE response (%s) as completed cleanup', async status => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status })));
    await expect(new CloudflareAPI('account', 'platform-token').remove('/d1/database/removed')).resolves.toBeUndefined();
  });
  it('hashes normalized source deterministically and excludes private environment files', async () => {
    const first = await sourceSnapshot({ '/package.json': '{}', '/src/App.tsx': 'hello', '/.env': 'SECRET=hidden' });
    const second = await sourceSnapshot({ 'src/App.tsx': 'hello', 'package.json': '{}' });
    expect(first).toEqual(second); expect(first.files).not.toHaveProperty('.env');
    expect(await sourceSnapshot({ '/src/App.tsx': 'hello', 'package.json': '{}' })).toEqual(second);
    expect(await sourceSnapshot(first.files)).toEqual(first);
    await expect(sourceSnapshot({ 'package.json': '{}', '../escape': 'bad' })).rejects.toThrow('unsafe');
    await expect(sourceSnapshot({ '/package.json': '{}', 'package.json': '{}' })).rejects.toThrow('duplicate');
  });
  it('drops model-authored lockfiles so dependency resolution always runs fresh', async () => {
    const snapshot = await sourceSnapshot({
      'package.json': '{"scripts":{"build":"build"}}',
      'package-lock.json': '{"lockfileVersion":3}',
      '/npm-shrinkwrap.json': '{}',
      'yarn.lock': '# yarn',
      'pnpm-lock.yaml': 'lockfileVersion: 9',
      '/src/App.tsx': 'hello',
    });
    expect(Object.keys(snapshot.files).sort()).toEqual(['package.json', 'src/App.tsx']);
    // Nested paths with the same name are real project files and must survive.
    const nested = await sourceSnapshot({ 'package.json': '{}', 'packages/app/package-lock.json': 'kept' });
    expect(nested.files['packages/app/package-lock.json']).toBe('kept');
  });
  it('keeps revision ordering independent of host and browser locales', async () => {
    const snapshot = await sourceSnapshot({ 'ä.ts': '1', 'a.ts': '2', 'Z.ts': '3', 'package.json': '{}' });
    expect(Object.keys(snapshot.files)).toEqual(['Z.ts', 'a.ts', 'package.json', 'ä.ts']);
  });
  it('authenticates encrypted credentials to their project and environment', async () => {
    const key = btoa('x'.repeat(32)); const value = { apiKey: 're_test_credential' };
    const sealed = await sealSecret(value, key, 'project:development');
    expect(sealed).not.toContain(value.apiKey);
    expect(await openSecret(sealed, key, 'project:development')).toEqual(value);
    await expect(openSecret(sealed, key, 'project:production')).rejects.toThrow();
    await expect(openSecret(sealed, key, 'other:development')).rejects.toThrow();
    expect(await sealSecret(value, key, 'project:development')).not.toBe(sealed);
  });
  it('preserves an existing secret only when valid public fields are submitted', () => {
    expect(validateIntegration('resend', { apiKey: '', from: 'sender@example.com', contactTo: 'owner@example.com' }, { apiKey: 're_old', from: 'old@example.com', contactTo: 'old@example.com' })).toMatchObject({ apiKey: 're_old', contactTo: 'owner@example.com' });
    expect(() => validateIntegration('google', { clientId: 'bad', clientSecret: 'secret' })).toThrow();
    expect(() => contactInput({ name: 'Me', email: 'bad', message: 'Hello' })).toThrow();
  });
  it('rejects unsafe artifacts and destructive pilot migrations', () => {
    expect(() => validateArtifact({ worker: 'export default {}', assets: { '/../secret': { content: '', type: 'text/plain' } } })).toThrow();
    expect(() => assertSafeMigration('DROP TABLE users')).toThrow();
    expect(() => assertSafeMigration('ALTER TABLE users RENAME TO gone')).toThrow();
    expect(() => assertSafeMigration('CREATE TABLE items(id TEXT PRIMARY KEY)')).not.toThrow();
  });
  describe('assertSafeMigration bypass attempts', () => {
    it('allows legitimate additive migrations', () => {
      expect(() => assertSafeMigration('CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT NOT NULL)')).not.toThrow();
      expect(() => assertSafeMigration('CREATE TABLE IF NOT EXISTS items (id INTEGER PRIMARY KEY)')).not.toThrow();
      expect(() => assertSafeMigration('CREATE INDEX idx_name ON users(name)')).not.toThrow();
      expect(() => assertSafeMigration('CREATE UNIQUE INDEX idx_email ON users(email)')).not.toThrow();
      expect(() => assertSafeMigration("ALTER TABLE users ADD COLUMN bio TEXT DEFAULT ''")).not.toThrow();
      expect(() => assertSafeMigration("INSERT INTO settings(key,value) VALUES ('version','2')")).not.toThrow();
      expect(() => assertSafeMigration("CREATE TABLE x(id TEXT);\nINSERT INTO x(id) VALUES ('seed')")).not.toThrow();
    });
    it("blocks backslash-quote SQLite escape mismatch: \\' does not escape in SQLite", () => {
      expect(() => assertSafeMigration("SELECT 'a\\'; DROP TABLE x; SELECT ''")).toThrow();
      expect(() => assertSafeMigration("INSERT INTO t VALUES('a\\'); DROP TABLE x; --")).toThrow();
    });
    it('blocks uppercase, mixed case, and unicode tricks', () => {
      expect(() => assertSafeMigration('DROP TABLE users')).toThrow();
      expect(() => assertSafeMigration('drop table users')).toThrow();
      expect(() => assertSafeMigration('DrOp TaBlE users')).toThrow();
      expect(() => assertSafeMigration('TRUNCATE TABLE items')).toThrow();
      expect(() => assertSafeMigration('DELETE FROM users WHERE 1=1')).toThrow();
      expect(() => assertSafeMigration('PRAGMA journal_mode=OFF')).toThrow();
      expect(() => assertSafeMigration('ATTACH DATABASE ":memory:" AS stolen')).toThrow();
      expect(() => assertSafeMigration('VACUUM')).toThrow();
    });
    it('blocks stacked statements hiding destructive SQL after safe prefix', () => {
      expect(() => assertSafeMigration('CREATE TABLE x(id TEXT); DROP TABLE users')).toThrow();
      expect(() => assertSafeMigration('CREATE TABLE x(id TEXT);\nDELETE FROM users')).toThrow();
      expect(() => assertSafeMigration('INSERT INTO x VALUES(1); UPDATE users SET admin=1')).toThrow();
    });
    it('blocks WITH ... DELETE (CTE-wrapped destructive operations)', () => {
      expect(() => assertSafeMigration('WITH deleted AS (DELETE FROM users RETURNING id) SELECT * FROM deleted')).toThrow();
      expect(() => assertSafeMigration('WITH x AS (SELECT 1) DELETE FROM users')).toThrow();
    });
    it('blocks nested comments that could hide SQL', () => {
      expect(() => assertSafeMigration('/* outer /* inner */ DROP TABLE users; */')).toThrow();
      expect(() => assertSafeMigration('CREATE TABLE x(id TEXT); /* safe */ DROP TABLE y')).toThrow();
    });
    it('does not false-positive on banned keywords inside SQL string literals', () => {
      expect(() => assertSafeMigration("CREATE TABLE x(status TEXT DEFAULT 'DO NOT DELETE')")).not.toThrow();
      expect(() => assertSafeMigration("CREATE TABLE x(note TEXT CHECK(note <> 'VACUUM'))")).not.toThrow();
      expect(() => assertSafeMigration("INSERT INTO x(status) VALUES ('PRAGMA mode')")).not.toThrow();
    });
    it('handles SQLite doubled-quote escaping correctly', () => {
      expect(() => assertSafeMigration("CREATE TABLE x(name TEXT DEFAULT 'it''s fine')")).not.toThrow();
      expect(() => assertSafeMigration("INSERT INTO x VALUES('value with ''quotes''')")).not.toThrow();
    });
    it('rejects bare SELECT, UPDATE, REPLACE as non-additive statements', () => {
      expect(() => assertSafeMigration('SELECT * FROM users')).toThrow();
      expect(() => assertSafeMigration('UPDATE users SET admin=1')).toThrow();
      expect(() => assertSafeMigration('REPLACE INTO users VALUES(1,"admin")')).toThrow();
    });
    it('blocks ALTER TABLE DROP COLUMN and ALTER TABLE RENAME', () => {
      expect(() => assertSafeMigration('ALTER TABLE users DROP COLUMN bio')).toThrow();
      expect(() => assertSafeMigration('ALTER TABLE users RENAME TO deleted_users')).toThrow();
      expect(() => assertSafeMigration('ALTER TABLE users RENAME COLUMN old TO new')).toThrow();
    });
    it('blocks INSERT INTO ... SELECT from reserved tables', () => {
      expect(() => assertSafeMigration('INSERT INTO leaked SELECT * FROM _bh_migrations')).toThrow('reserved');
      expect(() => assertSafeMigration('INSERT INTO leaked SELECT name FROM _cf_KV')).toThrow('reserved');
      expect(() => assertSafeMigration('INSERT INTO leaked SELECT * FROM sqlite_master')).toThrow('reserved');
      expect(() => assertSafeMigration('CREATE TABLE x AS SELECT * FROM _bh_migrations')).toThrow('reserved');
    });
    it('allows BEGIN/COMMIT and a stray COMMIT, blocks BEGIN without matching scope', () => {
      expect(() => assertSafeMigration('BEGIN; CREATE TABLE x(id TEXT); COMMIT')).not.toThrow();
      expect(() => assertSafeMigration('COMMIT')).not.toThrow();
      expect(() => assertSafeMigration('BEGIN')).not.toThrow();
      expect(() => assertSafeMigration('BEGIN; DROP TABLE users; COMMIT')).toThrow();
    });
    it('blocks multi-statement strings mixing allowed and banned', () => {
      expect(() => assertSafeMigration('CREATE TABLE a(id TEXT); SELECT 1; CREATE TABLE b(id TEXT)')).toThrow();
      expect(() => assertSafeMigration("INSERT INTO x VALUES(1); ATTACH ':memory:' AS stolen")).toThrow();
      expect(() => assertSafeMigration('CREATE INDEX idx ON t(col); PRAGMA table_info(t)')).toThrow();
    });
  });
  it('uploads only the tenant D1 binding and managed marker; no platform secrets', async () => {
    const mock = vi.fn(async (_input: string, _init: RequestInit) => Response.json({ success: true, result: {} })); vi.stubGlobal('fetch', mock);
    await new CloudflareAPI('account', 'platform-token').upload('projects', 'release', 'export default {}', 'tenant-db');
    const init = mock.mock.calls[0][1] as RequestInit;
    const metadata = JSON.parse((init.body as FormData).get('metadata') as string);
    expect(metadata.bindings).toEqual([{ name: 'DB', type: 'd1', id: 'tenant-db' }, { name: 'BRAINHALF_MANAGED', type: 'plain_text', text: 'true' }]);
    expect(JSON.stringify(metadata)).not.toContain('platform-token');
  });
});

describe('Generated Workers application', () => {
  it('refreshes stale dependency locks and declares the backend compiler', () => {
    const original = { ...createTypeScriptStarter(), '/package-lock.json': '{"lockfileVersion":3}', '/npm-shrinkwrap.json': '{}' };
    const files = addWorkersBackend(original);
    expect(files['/package-lock.json']).toBeUndefined(); expect(files['/npm-shrinkwrap.json']).toBeUndefined();
    expect(original['/package-lock.json']).toBeDefined();
    expect(JSON.parse(files['/package.json']).devDependencies.typescript).toBeTruthy();
    expect(() => addWorkersBackend({ ...original, '/server/index.js': 'existing backend' })).toThrow('already has a backend');
    expect(() => addWorkersBackend({ '/package.json': '[]' })).toThrow('Fix package.json');
  });
  it('builds TypeScript and executes real SQLite CRUD tests', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'brainhalf-workers-'));
    const environment = { ...process.env };
    delete environment.NODE_TEST_CONTEXT;
    try {
      const original = createTypeScriptStarter(); const files = addWorkersBackend(original);
      expect(files['/src/App.tsx']).toBe(original['/src/App.tsx']);
      for (const [path, content] of Object.entries(files)) { const destination = join(directory, path.replace(/^\//, '')); mkdirSync(dirname(destination), { recursive: true }); writeFileSync(destination, content); }
      symlinkSync(resolve('node_modules'), join(directory, 'node_modules'), 'dir');
      for (const args of [['run', 'build'], ['test']]) {
        await execute('npm', args, { cwd: directory, env: environment, timeout: 60_000 });
      }
      const database = new DatabaseSync(':memory:');
      try { database.exec(files['/migrations/0001_items.sql']); expect(database.prepare("SELECT name FROM sqlite_schema WHERE name='items'").get()).toBeTruthy(); }
      finally { database.close(); }
    } finally { rmSync(directory, { recursive: true, force: true }); }
  }, 90_000);
});
