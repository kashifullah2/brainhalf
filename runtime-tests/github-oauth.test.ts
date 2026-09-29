import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { token } from '../src/runtime/integrations';
import { ManagedAuth } from '../src/runtime/managed-auth';
import { ManagedMail } from '../src/runtime/managed-mail';
import { ensureManagedSchema, ManagedStore } from '../src/runtime/managed-store';
import { digest } from '../src/runtime/source';

const credentials = { github: { clientId: 'Ov23liTESTCLIENT123', clientSecret: 'github-client-secret' } };
const databases: DatabaseSync[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); vi.unstubAllGlobals(); });

function harness(integration: unknown = credentials) {
  const database = new DatabaseSync(':memory:'); databases.push(database);
  database.exec('CREATE TABLE sessions (token TEXT PRIMARY KEY, kind TEXT NOT NULL, environment TEXT NOT NULL, data TEXT NOT NULL, expires INTEGER NOT NULL)');
  // Execute at exec time, just like Durable Object SQLite.
  const sql: any = { exec: (query: string, ...values: unknown[]) => { const stmt = database.prepare(query); const rows = stmt.columns().length ? stmt.all(...values as never[]) : (stmt.run(...values as never[]), []); return { toArray: () => rows }; } };
  ensureManagedSchema(sql);
  const store = new ManagedStore({
    storage: { sql } as never,
    env: {} as never,
    scope: { projectId: 'project', ownerId: 'owner' },
    origin: (environment: string) => `https://${environment}.apps.example.com`,
    integration: async () => integration as never,
    createSession: async (kind: string, environment: string, data: unknown, seconds: number) => {
      const raw = token();
      sql.exec('INSERT INTO sessions VALUES (?,?,?,?,?)', await digest(raw), kind, environment, JSON.stringify(data), Date.now() + seconds * 1000);
      return raw;
    },
    session: async (value: string | undefined, kind: string, environment: string, consume?: boolean) => {
      if (!value || value.length !== 64) return null;
      const hashed = await digest(value);
      const rows = sql.exec('SELECT data FROM sessions WHERE token=? AND kind=? AND environment=? AND expires>?', hashed, kind, environment, Date.now()).toArray();
      if (consume) sql.exec('DELETE FROM sessions WHERE token=?', hashed);
      return rows[0] ? JSON.parse(rows[0].data) : null;
    },
    consumeEmail: async () => {},
    schedule: async () => {},
  });
  const auth = new ManagedAuth(store, new ManagedMail(store));
  return { database, sql, store, auth };
}

function githubApi() {
  return vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes('login/oauth/access_token')) return Response.json({ access_token: 'github-access-token' });
    if (url.endsWith('api.github.com/user')) return Response.json({ id: 424242, name: 'Test Person', login: 'testperson' });
    return Response.json([{ email: 'Person@Example.com', primary: true, verified: true }]);
  });
}

describe('Managed GitHub sign-in', () => {
  beforeEach(() => vi.stubGlobal('fetch', githubApi()));

  async function startFlow(context: ReturnType<typeof harness>) {
    const response = await context.auth.handle(new Request('https://development.apps.example.com/api/auth/github/start'), 'development');
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get('Location')!);
    return { location, state: location.searchParams.get('state')!, cookie: response.headers.get('Set-Cookie')!.split(';')[0] };
  }
  async function finishFlow(context: ReturnType<typeof harness>, flow: Awaited<ReturnType<typeof startFlow>>, query = `code=code&state=${flow.state}`) {
    return context.auth.handle(new Request(`https://development.apps.example.com/api/auth/github/callback?${query}`, { headers: { Cookie: flow.cookie } }), 'development');
  }

  it('redirects to GitHub with a browser-bound state and completes sign-in once', async () => {
    const context = harness();
    context.store.saveSettings('development', { githubEnabled: true });
    const flow = await startFlow(context);
    expect(flow.location.origin + flow.location.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(flow.location.searchParams.get('client_id')).toBe('Ov23liTESTCLIENT123');
    expect(flow.location.searchParams.get('redirect_uri')).toBe('https://development.apps.example.com/api/auth/github/callback');
    expect(flow.location.searchParams.get('scope')).toBe('read:user user:email');
    expect(flow.location.searchParams.has('client_secret')).toBe(false);
    const result = await finishFlow(context, flow);
    expect(result.status).toBe(303);
    expect(result.headers.get('Location')).toBe('/');
    expect(result.headers.getSetCookie().join(';')).toContain('__Host-bh_app=');
    const user = context.database.prepare('SELECT * FROM managed_users').get() as Record<string, unknown>;
    expect(user.id).toBe('github:424242');
    expect(user.email).toBe('person@example.com');
    expect(user.verified).toBe(1);
    await expect(finishFlow(context, flow)).rejects.toThrow('invalid or expired');
  });

  it('rejects missing and mismatched state before contacting GitHub', async () => {
    const context = harness();
    context.store.saveSettings('development', { githubEnabled: true });
    const flow = await startFlow(context);
    await expect(context.auth.handle(new Request('https://development.apps.example.com/api/auth/github/callback?code=code&state=' + flow.state), 'development')).rejects.toThrow('invalid or expired');
    await expect(finishFlow(context, flow, `code=code&state=${'a'.repeat(43)}`)).rejects.toThrow('invalid or expired');
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    expect(context.database.prepare('SELECT COUNT(*) AS count FROM sessions').get()).toMatchObject({ count: 1 });
  });

  it('reuses the GitHub identity for returning users and links a verified password account by email', async () => {
    const context = harness();
    context.store.saveSettings('development', { githubEnabled: true });
    await finishFlow(context, await startFlow(context));
    await finishFlow(context, await startFlow(context));
    expect(context.database.prepare('SELECT COUNT(*) AS count FROM managed_users').get()).toMatchObject({ count: 1 });

    const linked = harness();
    linked.store.saveSettings('development', { githubEnabled: true });
    linked.sql.exec("INSERT INTO managed_users (environment,id,email,name,password_hash,verified,created) VALUES ('development','app_existing','person@example.com','Existing','password-hash',1,1)");
    await finishFlow(linked, await startFlow(linked));
    const user = linked.database.prepare('SELECT * FROM managed_users').get() as Record<string, unknown>;
    expect(user.id).toBe('app_existing');
    expect(user.github_id).toBe('424242');
    expect(user.password_hash).toBe('password-hash');
  });

  it('stays disabled until enabled and configured, and reports readiness in config', async () => {
    const off = harness();
    await expect(off.auth.handle(new Request('https://development.apps.example.com/api/auth/github/start'), 'development')).rejects.toMatchObject({ status: 403 });
    const missing = harness({});
    missing.store.saveSettings('development', { githubEnabled: true });
    await expect(missing.auth.handle(new Request('https://development.apps.example.com/api/auth/github/start'), 'development')).rejects.toMatchObject({ status: 503 });
    const config = await (await missing.auth.handle(new Request('https://development.apps.example.com/api/auth/config'), 'development')).json() as Record<string, unknown>;
    expect(config).toMatchObject({ githubEnabled: true, githubReady: false });
    const ready = harness();
    ready.store.saveSettings('development', { githubEnabled: true });
    const readyConfig = await (await ready.auth.handle(new Request('https://development.apps.example.com/api/auth/config'), 'development')).json() as Record<string, unknown>;
    expect(readyConfig.githubReady).toBe(true);
  });

  it('migrates databases created before the github_id column existed', () => {
    const database = new DatabaseSync(':memory:'); databases.push(database);
    database.exec("CREATE TABLE managed_users (environment TEXT NOT NULL,id TEXT NOT NULL,email TEXT NOT NULL,name TEXT NOT NULL,password_hash TEXT,google_sub TEXT,verified INTEGER NOT NULL DEFAULT 0,disabled INTEGER NOT NULL DEFAULT 0,role TEXT NOT NULL DEFAULT 'user',revision INTEGER NOT NULL DEFAULT 0,created INTEGER NOT NULL,last_login INTEGER,PRIMARY KEY(environment,id),UNIQUE(environment,email),UNIQUE(environment,google_sub))");
    const sql: any = { exec: (query: string, ...values: unknown[]) => { const stmt = database.prepare(query); const rows = stmt.columns().length ? stmt.all(...values as never[]) : (stmt.run(...values as never[]), []); return { toArray: () => rows }; } };
    ensureManagedSchema(sql);
    sql.exec("INSERT INTO managed_users (environment,id,email,name,verified,created) VALUES ('development','github:1','user@example.com','User',1,1)");
    expect(database.prepare('SELECT github_id FROM managed_users').get()).toMatchObject({ github_id: null });
  });
});
