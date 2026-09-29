import type { RuntimeEnv } from './env';
import { RuntimeError, type IntegrationConfig, type ProjectEnvironment, type ProjectScope } from './types';
import { MANAGED_DEFAULTS, type ManagedSettings, type ManagedUser, type ProviderReadiness } from './managed-types';
import { readStreamJson } from './integrations';

export interface ManagedDependencies {
  storage: DurableObjectStorage; env: RuntimeEnv; scope: ProjectScope;
  origin(environment: ProjectEnvironment): string;
  integration(environment: ProjectEnvironment): Promise<IntegrationConfig>;
  createSession(kind: string, environment: ProjectEnvironment, data: object, seconds: number): Promise<string>;
  session(value: string | undefined, kind: string, environment: ProjectEnvironment, consume?: boolean): Promise<Record<string, unknown> | null>;
  consumeEmail(key: string): Promise<void>;
  schedule(at: number): Promise<void>;
}
export interface StoredUser extends Record<string, SqlStorageValue> {
  id: string; environment: ProjectEnvironment; email: string; name: string;
  password_hash: string | null; google_sub: string | null; github_id: string | null; verified: number; disabled: number;
  role: 'user' | 'admin'; revision: number; created: number; last_login: number | null;
}
export const MANAGED_SCHEMA = [
  'CREATE TABLE IF NOT EXISTS managed_settings (environment TEXT PRIMARY KEY, data TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS managed_users (environment TEXT NOT NULL,id TEXT NOT NULL,email TEXT NOT NULL,name TEXT NOT NULL,password_hash TEXT,google_sub TEXT,github_id TEXT,verified INTEGER NOT NULL DEFAULT 0,disabled INTEGER NOT NULL DEFAULT 0,role TEXT NOT NULL DEFAULT \'user\',revision INTEGER NOT NULL DEFAULT 0,created INTEGER NOT NULL,last_login INTEGER,PRIMARY KEY(environment,id),UNIQUE(environment,email),UNIQUE(environment,google_sub))',
  'CREATE UNIQUE INDEX IF NOT EXISTS managed_users_github ON managed_users(environment,github_id)',
  'CREATE TABLE IF NOT EXISTS managed_actions (hash TEXT PRIMARY KEY,environment TEXT NOT NULL,user_id TEXT NOT NULL,kind TEXT NOT NULL,expires INTEGER NOT NULL)',
  'CREATE INDEX IF NOT EXISTS managed_actions_expiry ON managed_actions(expires)',
  'CREATE TABLE IF NOT EXISTS managed_limits (key TEXT PRIMARY KEY,reset INTEGER NOT NULL,count INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS managed_templates (environment TEXT NOT NULL,kind TEXT NOT NULL,subject TEXT NOT NULL,text TEXT NOT NULL,PRIMARY KEY(environment,kind))',
  'CREATE TABLE IF NOT EXISTS managed_emails (id TEXT PRIMARY KEY,environment TEXT NOT NULL,kind TEXT NOT NULL,recipient TEXT NOT NULL,subject TEXT NOT NULL,status TEXT NOT NULL,sealed TEXT NOT NULL,idempotency_key TEXT NOT NULL,request_hash TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,polls INTEGER NOT NULL DEFAULT 0,provider_id TEXT,next_at INTEGER,created INTEGER NOT NULL,updated INTEGER NOT NULL,error TEXT,UNIQUE(environment,idempotency_key))',
  'CREATE INDEX IF NOT EXISTS managed_emails_due ON managed_emails(next_at)',
];

/** Runs the managed schema and upgrades databases created before the GitHub sign-in column existed. */
export function ensureManagedSchema(sql: SqlStorage) {
  const existing = sql.exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' AND name='managed_users'").toArray();
  if (existing.length) {
    const columns = sql.exec<{ name: string }>('PRAGMA table_info(managed_users)').toArray().map(column => column.name);
    if (!columns.includes('github_id')) sql.exec('ALTER TABLE managed_users ADD COLUMN github_id TEXT');
  }
  for (const statement of MANAGED_SCHEMA) sql.exec(statement);
}

export class ManagedStore {
  constructor(readonly deps: ManagedDependencies) {}
  get sql() { return this.deps.storage.sql; }
  settings(environment: ProjectEnvironment): ManagedSettings {
    const row = this.sql.exec<{ data: string }>('SELECT data FROM managed_settings WHERE environment=?', environment).toArray()[0];
    return row ? { ...MANAGED_DEFAULTS, ...JSON.parse(row.data) } : { ...MANAGED_DEFAULTS };
  }
  saveSettings(environment: ProjectEnvironment, value: Record<string, unknown>) {
    const result = this.settings(environment);
    for (const key of ['passwordEnabled', 'magicLinkEnabled', 'googleEnabled', 'githubEnabled', 'emailEnabled', 'welcomeEnabled'] as const) {
      if (key in value) { if (typeof value[key] !== 'boolean') throw new RuntimeError('Use true or false for enabled services.'); result[key] = value[key]; }
    }
    if ('appName' in value) {
      if (typeof value.appName !== 'string' || !value.appName.trim() || value.appName.length > 60 || /[\r\n<>]/.test(value.appName)) throw new RuntimeError('Enter an app name up to 60 characters.');
      result.appName = value.appName.trim();
    }
    for (const key of ['googleMode', 'emailMode'] as const) {
      if (key in value) { if (value[key] !== 'managed' && value[key] !== 'custom') throw new RuntimeError('Choose BrainHalf or your own provider.'); result[key] = value[key]; }
    }
    this.sql.exec('INSERT INTO managed_settings VALUES (?,?) ON CONFLICT(environment) DO UPDATE SET data=excluded.data', environment, JSON.stringify(result));
    return result;
  }
  limit(key: string, count: number, windowMs: number) {
    const now = Date.now();
    this.sql.exec('DELETE FROM managed_limits WHERE reset<=?', now);
    const previous = this.sql.exec<{ count: number }>('SELECT count FROM managed_limits WHERE key=?', key).toArray()[0];
    if (previous && previous.count >= count) throw new RuntimeError('Too many requests. Try again later.', 429);
    this.sql.exec('INSERT INTO managed_limits VALUES (?,?,1) ON CONFLICT(key) DO UPDATE SET count=count+1', key, now + windowMs);
  }
  user(environment: ProjectEnvironment, id: string) {
    return this.sql.exec<StoredUser>('SELECT * FROM managed_users WHERE environment=? AND id=?', environment, id).toArray()[0];
  }
  byEmail(environment: ProjectEnvironment, email: string) {
    return this.sql.exec<StoredUser>('SELECT * FROM managed_users WHERE environment=? AND email=?', environment, email).toArray()[0];
  }
  publicUser(user: StoredUser): ManagedUser {
    return { id: user.id, email: user.email, name: user.name, role: user.role, verified: !!user.verified, disabled: !!user.disabled, createdAt: user.created, lastLoginAt: user.last_login };
  }
  revoke(environment: ProjectEnvironment, id: string) {
    this.sql.exec('UPDATE managed_users SET revision=revision+1 WHERE environment=? AND id=?', environment, id);
    this.sql.exec("DELETE FROM sessions WHERE environment=? AND kind='app' AND json_extract(data,'$.id')=?", environment, id);
    this.sql.exec('DELETE FROM managed_actions WHERE environment=? AND user_id=?', environment, id);
  }
  async platform<T>(path: string, environment: ProjectEnvironment, body: Record<string, unknown> = {}): Promise<T> {
    if (!this.deps.env.PLATFORM) throw new RuntimeError('BrainHalf managed services are not configured.', 503);
    let response: Response;
    try {
      response = await this.deps.env.PLATFORM.fetch(new Request('https://platform' + path, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, ...this.deps.scope, environment }), signal: AbortSignal.timeout(20_000),
      }));
    } catch { throw new RuntimeError('BrainHalf managed service is temporarily unavailable.', 503); }
    const data = await readStreamJson(response.body, 64_000) as T & { error?: string; retryable?: boolean };
    if (!response.ok) {
      const error = new RuntimeError(typeof data.error === 'string' ? data.error.slice(0, 200) : 'Managed service failed.', response.status);
      Object.assign(error, { retryable: data.retryable !== false });
      throw error;
    }
    return data;
  }
  async readiness(environment: ProjectEnvironment): Promise<ProviderReadiness> {
    const settings = this.settings(environment);
    const custom = await this.deps.integration(environment);
    let platform: ProviderReadiness = { emailReady: false, googleReady: false, githubReady: false, ownerVerified: false, ownerEmail: '', from: '', googleCallback: '', githubCallback: '' };
    try { platform = await this.platform<ProviderReadiness>('/config', environment); } catch { /* Show unavailable services without hiding settings or test inboxes. */ }
    return {
      ...platform,
      emailReady: settings.emailEnabled && (environment === 'development' || (settings.emailMode === 'custom' ? !!custom.resend : platform.emailReady)),
      googleReady: settings.googleEnabled && (settings.googleMode === 'custom' ? !!custom.google : platform.googleReady),
      githubReady: settings.githubEnabled && !!custom.github,
      from: settings.emailMode === 'custom' ? custom.resend?.from || '' : platform.from,
      googleCallback: settings.googleMode === 'custom' ? this.deps.origin(environment) + '/api/auth/google/callback' : platform.googleCallback,
      githubCallback: this.deps.origin(environment) + '/api/auth/github/callback',
    };
  }
}
