import type { OutcomeEvent } from '../lib/product-outcomes';
import { DurableObject } from 'cloudflare:workers';
import { getSandbox } from '@cloudflare/sandbox';
import { launch, connect, sessions } from '@cloudflare/playwright';
import type { RuntimeEnv } from './env';
import { CloudflareAPI } from './cloudflare-api';
import { requireAdmission } from './pilot';
import { runtimeAvailability } from './availability';
import { verificationPlan, runVerificationPlan } from './verification';
import { ProjectUploads } from './uploads';
import { ensureManagedSchema, ManagedStore } from './managed-store';
import { ManagedMail } from './managed-mail';
import { ManagedAuth } from './managed-auth';
import { MANAGED_DEFAULTS } from './managed-types';
import { authPage } from './auth-page';
import { serviceCapability } from './managed-capability';
import { databaseIdentifier, prepareAddColumn, prepareCreateIndex, prepareCreateTable, prepareDropColumn, prepareDropTable, prepareRowDelete, prepareRowImport, prepareRowUpdate, readDatabaseSchema, readDatabaseTable } from './database-tools';
import { REQUEST_MONITOR_SCHEMA, recordAppRequest } from './request-monitor';
import { COLLECT_ARTIFACT, COLLECT_STATIC_ARTIFACT, validateArtifact, type BuildArtifact } from './artifact';
import { publicationTarget, assertProductionServices, productionHealthPath, hasWorkerEntry } from './publication';
import { digest, sourceSnapshot, projectManifest, migrationFiles, assertSafeMigration } from './source';
import { openSecret, sealSecret, validateIntegration, redactSecrets } from './secrets';
import { contactInput, token, cookie, secureCookie, embeddedPreviewCookie, readJson, readStreamJson } from './integrations';
import { PILOT_LIMITS, RuntimeError, environmentFrom, runtimeHost, type ProjectScope, type ProjectEnvironment, type RuntimeJob, type DatabaseResource, type MigrationReceipt, type ProjectRelease, type IntegrationConfig, type IntegrationProvider, type IntegrationStatus, type RuntimeStatus, type SourceSnapshot, type VerificationReport, type RuntimeUsageKind } from './types';

interface StoredJob extends RuntimeJob { step: number; sandboxId: string; sourceKey: string; artifactKey?: string; node?: boolean; static?: boolean; installRetried?: boolean; devServerPids?: { vite: string; backend: string } }
interface StoredIntegration { sealed: string; updatedAt: number }
interface DatabaseRecoveryPoint { id: string; label: string; bookmark: string; databaseId: string; createdAt: number; migrations: MigrationReceipt[] }
const authPath = (value: string) => /^\/__brainhalf\/auth(?:\?mode=(?:verify|reset|magic)#token=[A-Za-z0-9_-]{43})?$/.test(value);
const active = <T extends RuntimeJob>(job?: T): job is T => !!job && ['queued', 'running', 'stopping'].includes(job.status);

/**
 * N3: an expired single-use preview ticket used to return a JSON error, which
 * the embed iframe rendered as a document — firing onLoad and looking like a
 * successful preview. For embed loads, return an HTML page that reports the
 * failure to the parent frame (which shows its retry UI) instead.
 */
export function embedPreviewErrorPage(message: string): Response {
  const safe = message.replace(/[<>&"]/g, character => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[character]!));
  // Escape `<` so a message containing `</script>` cannot break out of the script block; JSON.parse revives \u003c.
  const payload = JSON.stringify({ type: 'preview-error', error: message }).replace(/</g, '\\u003c');
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Preview unavailable</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f4f7fa;color:#142334;font:16px/1.5 system-ui,sans-serif;padding:24px}p{max-width:440px;text-align:center}</style></head><body><p>${safe}</p><script>try{window.parent.postMessage(${payload},'*')}catch(e){}</script></body></html>`;
  return new Response(html, {
    status: 401,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Cross-Origin-Resource-Policy': 'cross-origin',
      'Access-Control-Allow-Origin': '*',
      'Content-Security-Policy': "frame-ancestors 'self' https://brainhalf.com https://*.brainhalf.com https://*.apps.brainhalf.com http://localhost:* http://127.0.0.1:*",
    },
  });
}

/** Pulls the actionable lines out of a failed job command's output so the job
 *  message names the real cause (bad dependency version, TypeScript error,
 *  unresolved import) instead of a bare exit code. Covers npm, tsc, and
 *  Vite/Rollup output. */
export function commandFailureSummary(stdout: string, stderr: string): string {
  const lines = `${stderr}\n${stdout}`.split('\n')
    .map(line => line.replace(/^npm (?:error|warn)\s*/i, '').trim())
    .filter(line => /^(?:code\s+\w+|ERR!|ETARGET|ERESOLVE|EACCES|ENOENT|EPERM|404|Not Found|No matching version|notarget|Could not resolve|network|fetch failed|request to)/i.test(line)
      || /\berror TS\d+\b|\bType error:|error during build|\[vite\]|RollupError|is not exported by|Failed to resolve import|Transform failed/i.test(line));
  const summary = [...new Set(lines)].slice(-3).join(' — ').replace(/\s+/g, ' ').slice(0, 280).trim();
  return summary ? ` Build output: ${summary}` : '';
}

export class ProjectRuntime extends DurableObject<RuntimeEnv> {
  private scope!: ProjectScope;
  private alias = '';
  private pendingStarts = new Set<Promise<unknown>>();
  private pendingUploads = new Set<Promise<Response>>();
  private advancing?: Promise<void>;
  private stopping?: Promise<void>;
  private mailing?: Promise<void>;
  private databaseOperation?: Promise<Response>;
  private controlQueue: Promise<void> = Promise.resolve();
  constructor(ctx: DurableObjectState, env: RuntimeEnv) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.scope = (await ctx.storage.get<ProjectScope>('scope'))!;
      this.alias = await ctx.storage.get<string>('alias') || '';
      ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, kind TEXT NOT NULL, environment TEXT NOT NULL, data TEXT NOT NULL, expires INTEGER NOT NULL)');
      ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS inbox (id TEXT PRIMARY KEY, environment TEXT NOT NULL, data TEXT NOT NULL, created INTEGER NOT NULL)');
      ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS logs (id INTEGER PRIMARY KEY AUTOINCREMENT, job TEXT NOT NULL, text TEXT NOT NULL, created INTEGER NOT NULL)');
      ensureManagedSchema(ctx.storage.sql);
      for (const sql of REQUEST_MONITOR_SCHEMA) ctx.storage.sql.exec(sql);
    });
  }
  async initialize(scope: ProjectScope, alias?: string) {
    if (this.scope && (this.scope.ownerId !== scope.ownerId || this.scope.projectId !== scope.projectId)) throw new RuntimeError('Project ownership mismatch.', 403);
    this.scope = scope;
    // The stored alias is the source of truth. A passed alias is adopted only
    // on first initialize (fresh DO with nothing stored); later calls must
    // never clobber a custom slug back to the digest alias.
    if (!this.alias) this.alias = alias || (await this.ctx.storage.get<string>('alias')) || '';
    await this.ctx.storage.put({ scope, alias: this.alias });
    return !await this.ctx.storage.get<boolean>('deleted');
  }
  /** This project's current alias, read from storage. Never mutates state. */
  async currentAlias(): Promise<string> {
    return this.alias || (await this.ctx.storage.get<string>('alias')) || '';
  }
  /** Whether /delete has run for this project. Never mutates state. */
  async isDeleted(): Promise<boolean> {
    return (await this.ctx.storage.get<boolean>('deleted')) === true;
  }
  private api() { return new CloudflareAPI(this.env.CF_ACCOUNT_ID, this.env.CF_API_TOKEN, this.env.CF_ZONE_ID); }
  private url(environment: ProjectEnvironment) { return `https://${runtimeHost(this.alias, environment, this.env.RUNTIME_DOMAIN)}`; }
  private pilot() { return this.env.PILOT.getByName('pilot'); }
  private ownerUsage() { return this.env.PILOT.getByName(`usage:${this.scope.ownerId}`); }
  private async consumeUsage(kind: RuntimeUsageKind, jobId?: string): Promise<void> {
    if (this.scope.unlimited) return;
    requireAdmission(await this.ownerUsage().consumeUsage(kind, jobId));
  }
  private services() {
    const store = new ManagedStore({
      storage: this.ctx.storage, env: this.env, scope: this.scope, origin: environment => this.url(environment), integration: environment => this.config(environment),
      createSession: (kind, environment, data, seconds) => this.createSession(kind, environment, data, seconds),
      session: (value, kind, environment, consume) => this.session(value, kind, environment, consume),
      consumeEmail: async key => { await this.consumeUsage('emails', key); },
      schedule: at => this.scheduleAlarm(at),
    });
    const mail = new ManagedMail(store);
    return { store, mail, auth: new ManagedAuth(store, mail) };
  }
  private async prepareServices(environment: ProjectEnvironment) {
    if (this.ctx.storage.sql.exec('SELECT environment FROM managed_settings WHERE environment=?', environment).toArray().length) return;
    const config = await this.config(environment);
    this.ctx.storage.sql.exec('INSERT OR IGNORE INTO managed_settings VALUES (?,?)', environment, JSON.stringify({ ...MANAGED_DEFAULTS, googleMode: config.google ? 'custom' : 'managed', emailMode: config.resend ? 'custom' : 'managed' }));
  }
  private async scheduleAlarm(at: number) {
    const previous = await this.ctx.storage.getAlarm?.();
    const email = this.services().mail.nextDue();
    await this.ctx.storage.setAlarm(Math.max(Date.now() + 50, Math.min(at, previous && previous > Date.now() ? previous : Infinity, email ?? Infinity)));
  }
  private async serviceBindings(environment: ProjectEnvironment) {
    return this.env.RUNTIME_SERVICE_NAME ? { service: this.env.RUNTIME_SERVICE_NAME, capability: await serviceCapability(this.scope, environment, this.env.PROJECT_SECRETS_KEY || '') } : undefined;
  }
  private uploads() { return new ProjectUploads(this.ctx.storage, this.env.ARTIFACTS, this.ownerUsage(), this.alias, this.scope.projectId); }
  /** Moves every stored object from one alias prefix to another, then repoints
   *  stored release records at the moved artifacts, so a slug rename never
   *  orphans uploads, sources, artifacts, or screenshots. */
  private async migrateAliasPrefix(previous: string, next: string): Promise<void> {
    let cursor: string | undefined;
    for (;;) {
      const listed = await this.env.ARTIFACTS.list({ prefix: `${previous}/`, limit: 1000, ...(cursor ? { cursor } : {}) });
      for (const object of listed.objects) {
        const target = `${next}/${object.key.slice(previous.length + 1)}`;
        const source = await this.env.ARTIFACTS.get(object.key);
        if (source) {
          const bytes = new Uint8Array(await new Response(source.body).arrayBuffer());
          await this.env.ARTIFACTS.put(target, bytes, source.httpMetadata ? { httpMetadata: source.httpMetadata } : undefined);
        }
        await this.env.ARTIFACTS.delete(object.key);
      }
      if (!listed.truncated) break;
      cursor = listed.cursor;
    }
    // Release records pin their artifact keys; repoint them at the moved objects.
    const updates: Record<string, ProjectRelease> = {};
    for (const [key, release] of await this.ctx.storage.list<ProjectRelease>({ prefix: 'release:' })) {
      if (release?.artifactKey?.startsWith(`${previous}/`)) updates[key] = { ...release, artifactKey: `${next}/${release.artifactKey.slice(previous.length + 1)}` };
    }
    for (const environment of ['development', 'production'] as const) {
      const activeKey = `active:${environment}` as const;
      const current = await this.ctx.storage.get<ProjectRelease>(activeKey);
      if (current?.artifactKey?.startsWith(`${previous}/`)) updates[activeKey] = { ...current, artifactKey: `${next}/${current.artifactKey.slice(previous.length + 1)}` };
    }
    if (Object.keys(updates).length) await this.ctx.storage.put(updates);
  }
  private async uploadRequest(request: Request, environment: ProjectEnvironment, userId: string | null, admin = false): Promise<Response> {
    if (this.pendingUploads.size >= PILOT_LIMITS.parallelUploads) throw new RuntimeError('Other file operations are in progress. Retry shortly.', 429);
    const work = this.uploads().handle(request, environment, userId, admin);
    this.pendingUploads.add(work);
    try { return await work; } finally { this.pendingUploads.delete(work); }
  }
  private sandbox(job: StoredJob) { return getSandbox(this.env.Sandbox, job.sandboxId, { sleepAfter: '5m' }); }
  private async config(environment: ProjectEnvironment): Promise<IntegrationConfig> {
    const stored = await this.ctx.storage.get<StoredIntegration>(`integration:${environment}`);
    return stored ? openSecret(stored.sealed, this.env.PROJECT_SECRETS_KEY || '', `${this.scope.projectId}:${environment}`) : {};
  }
  private async integrations(environment: ProjectEnvironment): Promise<IntegrationStatus[]> {
    const config = await this.config(environment);
    const stored = await this.ctx.storage.get<StoredIntegration>(`integration:${environment}`);
    return [
      { provider: 'resend', configured: !!config.resend, updatedAt: stored?.updatedAt, fields: config.resend ? { from: config.resend.from, contactTo: config.resend.contactTo } : {} },
      { provider: 'google', configured: !!config.google, updatedAt: stored?.updatedAt, fields: config.google ? { clientId: config.google.clientId } : {}, callbackUrl: `${this.url(environment)}/api/auth/google/callback` },
      { provider: 'github', configured: !!config.github, updatedAt: stored?.updatedAt, fields: config.github ? { clientId: config.github.clientId } : {}, callbackUrl: `${this.url(environment)}/api/auth/github/callback` },
    ];
  }
  private log(job: string, message: string) {
    this.ctx.storage.sql.exec('INSERT INTO logs(job,text,created) VALUES (?,?,?)', job, redactSecrets(message).slice(0, 8_000), Date.now());
    this.ctx.storage.sql.exec('DELETE FROM logs WHERE id NOT IN (SELECT id FROM logs ORDER BY id DESC LIMIT 8)');
  }
  async status(environment: ProjectEnvironment): Promise<RuntimeStatus> {
    // Older versions reserved a hosted slot just by opening a workspace.
    // Release only never-used reservations; retain all source and runtime data.
    // Job admission uses the same concurrency boundary, so it cannot race this.
    await this.withControlLock(async () => {
      const jobs = await this.ctx.storage.list<StoredJob>({ prefix: 'job:' });
      const current = await this.ctx.storage.get<StoredJob>('current');
      // An installation failure never hosted an app. Terminal status is only
      // saved after sandbox cleanup succeeds; keep the source and job history.
      const unusedAttempt = (job: StoredJob) => ['build', 'preview', 'dev'].includes(job.kind)
        && ['failed', 'stopped'].includes(job.status) && Number.isFinite(job.finishedAt)
        && Number.isInteger(job.step) && job.step >= 0 && job.step <= 1 && !job.previewReady && !job.artifactKey;
      const unusedJobs = [...jobs.values()].every(unusedAttempt) && (!current || unusedAttempt(current));
      const releases = await this.ctx.storage.list({ prefix: 'release:' });
      const databases = await this.ctx.storage.list({ prefix: 'db:' });
      const serviceData = this.ctx.storage.sql.exec<{ used: number }>('SELECT EXISTS(SELECT 1 FROM sessions WHERE expires>?) OR EXISTS(SELECT 1 FROM managed_users) OR EXISTS(SELECT 1 FROM managed_emails) OR EXISTS(SELECT 1 FROM inbox) AS used', Date.now()).toArray()[0]?.used;
      if (!serviceData && unusedJobs && !releases.size && !databases.size
        && !await this.ctx.storage.get('active:development') && !await this.ctx.storage.get('active:production')) {
        await this.pilot().unregister(this.alias, this.scope);
      }
    });
    const availability = runtimeAvailability(this.env, this.scope.ownerId);
    const jobs = [...(await this.ctx.storage.list<StoredJob>({ prefix: 'job:' })).values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, 20);
    const releases = [...(await this.ctx.storage.list<ProjectRelease>({ prefix: `release:${environment}:` })).values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, 20);
    return {
      enabled: availability.state === 'ready', projectId: this.scope.projectId, environment, availability,
      usage: await this.ownerUsage().usageStatus(),
      capabilities: { sandbox: !!this.env.Sandbox, database: !!this.env.CF_API_TOKEN && !!this.env.CF_ACCOUNT_ID, deployment: !!this.env.CF_API_TOKEN && !!this.env.CF_ACCOUNT_ID, browser: !!this.env.BROWSER, secrets: !!this.env.PROJECT_SECRETS_KEY },
      database: await this.ctx.storage.get<DatabaseResource>(`db:${environment}`) || null,
      migrations: await this.ctx.storage.get<MigrationReceipt[]>(`migrations:${environment}`) || [],
      jobs: jobs.map(({ step: _step, sandboxId: _sandboxId, sourceKey: _sourceKey, artifactKey: _artifactKey, node: _node, static: _static, ...job }) => job),
      releases, activeRelease: await this.ctx.storage.get<ProjectRelease>(`active:${environment}`) || null,
      verification: await this.ctx.storage.get<VerificationReport>(`verification:${environment}`) || null,
      integrations: await this.integrations(environment), previewUrl: this.url('development'), productionUrl: this.url('production'),
    };
  }
  async control(request: Request): Promise<Response> {
    try { return await this.handleControl(request); }
    catch (error) { return Response.json({ error: error instanceof RuntimeError ? error.message : 'Something went wrong on our end. Please try again.' }, { status: error instanceof RuntimeError ? error.status : 503 }); }
  }
  private async withControlLock<T>(action: () => Promise<T>): Promise<T> {
    // Serialize admission and recovery without holding the object's global
    // input gate across registry/R2 I/O or resetting it on expected quota errors.
    const result = this.controlQueue.then(action);
    this.controlQueue = result.then(() => {}, () => {});
    return result;
  }
  private async handleControl(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const environment = environmentFrom(url.searchParams.get('environment') || 'development');
    const path = url.pathname;
    // Owner-level hosted-slot management. Slots are accounting records in the
    // pilot coordinator; orphaned slots (project deleted without cleanup, or
    // pre-cleanup-era projects) block new jobs until released. Releasing a
    // slot never deletes a deployment, but releasing a LIVE project's slot
    // takes its app offline (public routing 404s) until the project's next
    // job re-registers it — /hosted/release refuses live slots without
    // explicit force.
    if (path === '/hosted' && request.method === 'GET') {
      const hosted = await this.pilot().listOwnerProjects(this.scope.ownerId);
      // Annotate each slot with whether its project is still live, so the UI
      // can tell orphaned slots apart from ones whose release would take an
      // app offline. Liveness checks are best-effort; unknown reads as live.
      const withLiveness = await Promise.all(hosted.map(async entry => {
        let live = true;
        try { live = !(await this.env.PROJECTS.getByName(entry.projectId).isDeleted()); }
        catch { live = true; }
        return { ...entry, live };
      }));
      return Response.json({ hosted: withLiveness });
    }
    if (path === '/hosted/release' && request.method === 'POST') {
      const body = await readJson(request, 2_000) as { alias?: unknown; force?: unknown };
      if (typeof body?.alias !== 'string' || !/^([a-f0-9]{32}|[a-z][a-z0-9-]{2,38}[a-z0-9])$/.test(body.alias)) throw new RuntimeError('A valid app space id is required.', 400);
      const registered = await this.pilot().lookup(body.alias).catch(() => null);
      if (!registered || registered.ownerId !== this.scope.ownerId) throw new RuntimeError('App space not found on your account.', 404);
      // Releasing a live project's slot takes its app offline (public routing
      // 404s) until the project's next build re-registers it. Refuse without
      // explicit confirmation; orphaned (deleted-project) slots release freely.
      let live = true;
      try { live = !(await this.env.PROJECTS.getByName(registered.projectId).isDeleted()); }
      catch { live = true; }
      if (live && body?.force !== true) throw new RuntimeError('This app space belongs to a live app — removing it would take the app offline until its next publish. Confirm to remove it anyway.', 409);
      const result = await this.pilot().forceRelease(body.alias, this.scope.ownerId);
      if (!result.released) throw new RuntimeError('App space not found on your account.', 404);
      return Response.json(result);
    }
    if (path === '/delete' && request.method === 'POST') {
      await this.ctx.storage.put('deleted', true);
      this.ctx.storage.sql.exec('UPDATE managed_emails SET next_at=NULL');
      if (this.mailing) await Promise.allSettled([this.mailing]);
      await this.pilot().unregister(this.alias, this.scope);
      await this.stop();
      if (this.databaseOperation) await Promise.allSettled([this.databaseOperation]);
      await Promise.allSettled([...this.pendingUploads]);
      // Release the custom domain before the blanket key wipe below, or the
      // Cloudflare hostname and pilot routing survive deletion forever and the
      // domain can never be re-attached (register → 409 already-registered).
      const customDomain = await this.ctx.storage.get<{ hostname: string; cfId: string }>('custom-domain');
      if (customDomain) {
        await this.api().deleteCustomHostname(customDomain.cfId).catch(() => {});
        await this.pilot().unregisterCustomHostname(customDomain.hostname, this.scope).catch(() => {});
      }
      await this.uploads().removeAll();
      for (const env of ['development', 'production']) {
        const releases = await this.ctx.storage.list<ProjectRelease>({ prefix: `release:${env}:` });
        for (const release of releases.values()) await this.api().remove(`/workers/dispatch/namespaces/${encodeURIComponent(this.env.DISPATCH_NAMESPACE)}/scripts/${release.scriptName}`);
        const db = await this.ctx.storage.get<DatabaseResource>(`db:${env}`);
        if (db) await this.api().remove(`/d1/database/${db.id}`);
      }
      for (let pass = 0; pass < 50; pass++) {
        const objects = await this.env.ARTIFACTS.list({ prefix: `${this.alias}/`, limit: 100 });
        if (!objects.objects.length) break;
        await this.env.ARTIFACTS.delete(objects.objects.map(object => object.key));
      }
      const keys = [...(await this.ctx.storage.list()).keys()].filter(key => !['scope', 'alias', 'deleted'].includes(key));
      for (const key of keys) await this.ctx.storage.delete(key);
      this.ctx.storage.sql.exec('DELETE FROM sessions'); this.ctx.storage.sql.exec('DELETE FROM inbox'); this.ctx.storage.sql.exec('DELETE FROM logs');
      this.ctx.storage.sql.exec('DELETE FROM app_request_metrics'); this.ctx.storage.sql.exec('DELETE FROM app_request_events');
      for (const table of ['managed_settings', 'managed_users', 'managed_actions', 'managed_limits', 'managed_templates', 'managed_emails']) this.ctx.storage.sql.exec(`DELETE FROM ${table}`);
      return Response.json({ ok: true });
    }
    if (path !== '/stop' && await this.ctx.storage.get<boolean>('deleted')) throw new RuntimeError('This project has been deleted.', 410);
    if (environment === 'production' && !['GET', 'HEAD'].includes(request.method) && (path === '/services' || path.startsWith('/integrations/'))) {
      await this.assertServiceChangesAllowed(environment);
    }
    if (path === '/services' || path.startsWith('/services/')) return this.servicesControl(request, environment);
    if (path === '/status' && request.method === 'GET') return Response.json(await this.status(environment));
    if (path === '/repair-evidence' && request.method === 'POST') {
      const snapshot = await sourceSnapshot((await readJson(request, 8_000_000) as { files: SourceSnapshot['files'] }).files);
      const report = await this.ctx.storage.get<VerificationReport>(`verification:${environment}`);
      if (!report || report.passed || report.revision !== snapshot.revision) throw new RuntimeError('Run verification on the current source before requesting a repair.', 409);
      return Response.json({ revision: report.revision, checks: report.checks.filter(check => !check.passed).map(check => ({ name: check.name.slice(0, 160), detail: redactSecrets(check.detail).slice(0, 1800) })).slice(0, 10) });
    }
    if (path === '/monitor' && request.method === 'GET') return Response.json({
      daily: this.ctx.storage.sql.exec('SELECT day,requests,errors,total_ms FROM app_request_metrics WHERE environment=? ORDER BY day DESC LIMIT 7', environment).toArray(),
      recent: this.ctx.storage.sql.exec('SELECT method,route,status,duration_ms,created_at FROM app_request_events WHERE environment=? ORDER BY id DESC LIMIT 100', environment).toArray(),
    });
    if (path.startsWith('/database')) {
      if (this.databaseOperation) throw new RuntimeError('A database action is already running. Try again shortly.', 409);
      if (request.method === 'GET') return this.databaseControl(request, environment);
      if (this.pendingStarts.size || this.advancing || this.stopping) throw new RuntimeError('Wait for the running build or release before changing the database.', 409);
      const operation = this.databaseControl(request, environment);
      this.databaseOperation = operation;
      try { return await operation; } finally { if (this.databaseOperation === operation) this.databaseOperation = undefined; }
    }
    if (this.databaseOperation && request.method !== 'GET' && path !== '/stop') throw new RuntimeError('Wait for the database action to finish.', 409);
    if (path === '/uploads' || path.startsWith('/uploads/')) return this.uploadRequest(request, environment, null, true);
    if (path === '/screenshot' && request.method === 'GET') {
      const report = await this.ctx.storage.get<VerificationReport>(`verification:${environment}`);
      const screenshot = report?.screenshotKey && await this.env.ARTIFACTS.get(report.screenshotKey);
      if (!screenshot) throw new RuntimeError('No screenshot is available yet.', 404);
      return new Response(screenshot.body, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' } });
    }
    if (path === '/email-test' && request.method === 'POST') {
      const providers = await this.services().store.readiness(environment);
      const inbox = providers.ownerEmail;
      if (!providers.ownerVerified || !inbox) throw new RuntimeError('Verify your BrainHalf account email before sending a test.', 403);
      return this.integrationRequest(new Request(`${this.url(environment)}/api/contact`, { method: 'POST', body: JSON.stringify({ name: 'BrainHalf integration test', email: inbox, message: '[BrainHalf integration test] This verifies your project email configuration. Provider acceptance does not confirm inbox delivery.' }) }), environment, inbox);
    }
    if (path === '/logs' && request.method === 'GET') {
      const jobId = new URL(request.url).searchParams.get('job');
      if (!jobId) return Response.json({ logs: this.ctx.storage.sql.exec('SELECT id,job,text,created FROM logs ORDER BY id DESC LIMIT 60').toArray().reverse() });
      const report = await this.ctx.storage.get<VerificationReport>('verification:development');
      return Response.json({
        logs: this.ctx.storage.sql.exec('SELECT id,job,text,created FROM logs WHERE job=? ORDER BY id DESC LIMIT 60', jobId).toArray().reverse(),
        verification: report?.jobId === jobId ? report : null,
      });
    }
    if (path === '/inbox' && request.method === 'GET') return Response.json({ messages: this.ctx.storage.sql.exec<{ id: string; data: string; created: number }>('SELECT id,data,created FROM inbox WHERE environment=? ORDER BY created DESC LIMIT 50', environment).toArray().map(row => ({ id: row.id, createdAt: row.created, ...JSON.parse(row.data) })) });
    if (path.startsWith('/integrations/')) {
      const provider = path.slice('/integrations/'.length) as IntegrationProvider;
      if (!['resend', 'google', 'github'].includes(provider)) throw new RuntimeError('Unknown integration.', 404);
      if (request.method !== 'PUT' && request.method !== 'DELETE') throw new RuntimeError('Method not allowed.', 405);
      // Serialize edits so simultaneous provider saves cannot overwrite each other.
      const value = request.method === 'PUT' ? await readJson(request) as Record<string, unknown> : null;
      if (request.method === 'PUT' && (!value || typeof value !== 'object' || Array.isArray(value))) throw new RuntimeError('Enter valid connection fields.');
      await this.prepareServices(environment);
      await this.ctx.blockConcurrencyWhile(async () => {
        await this.assertServiceChangesAllowed(environment);
        const config = await this.config(environment);
        if (value) Object.assign(config, { [provider]: validateIntegration(provider, value, config[provider]) });
        else delete config[provider];
        await this.ctx.storage.put(`integration:${environment}`, { sealed: await sealSecret(config, this.env.PROJECT_SECRETS_KEY || '', `${this.scope.projectId}:${environment}`), updatedAt: Date.now() });
        this.services().store.saveSettings(environment, provider === 'github' ? { githubEnabled: !!value } : { [provider === 'google' ? 'googleMode' : 'emailMode']: value ? 'custom' : 'managed' });
      });
      return Response.json({ integrations: await this.integrations(environment) });
    }
    if (path === '/domain' && request.method === 'GET') {
      const stored = await this.ctx.storage.get<{ hostname: string; cfId: string; status?: string; verificationRecord?: { type: string; name: string; value: string } }>('custom-domain');
      if (!stored) return Response.json({ domain: null });
      try {
        const info = await this.api().getCustomHostname(stored.cfId);
        const domain = { hostname: stored.hostname, cfId: stored.cfId, status: info.status, ssl: info.ssl?.status, verificationRecord: info.ownership_verification, verificationErrors: info.verification_errors };
        await this.ctx.storage.put('custom-domain', { ...stored, status: info.status });
        return Response.json({ domain });
      } catch {
        return Response.json({ domain: { hostname: stored.hostname, cfId: stored.cfId, status: 'unknown' } });
      }
    }
    if (path === '/domain' && request.method === 'POST') {
      const body = await readJson(request) as { hostname: string };
      const hostname = typeof body?.hostname === 'string' ? body.hostname.trim().toLowerCase() : '';
      if (!hostname || !/^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(hostname)) throw new RuntimeError('Enter a valid domain name (e.g. myapp.example.com).', 400);
      if (hostname === this.env.RUNTIME_DOMAIN || hostname.endsWith('.' + this.env.RUNTIME_DOMAIN)) throw new RuntimeError(`That domain is already a ${this.env.RUNTIME_DOMAIN} address.`, 400);
      const existing = await this.ctx.storage.get<{ hostname: string; cfId: string }>('custom-domain');
      if (existing?.hostname === hostname) {
        const info = await this.api().getCustomHostname(existing.cfId);
        return Response.json({ domain: { hostname, cfId: existing.cfId, status: info.status, ssl: info.ssl?.status, verificationRecord: info.ownership_verification, verificationErrors: info.verification_errors } });
      }
      if (existing) {
        await this.api().deleteCustomHostname(existing.cfId).catch(() => {});
        await this.pilot().unregisterCustomHostname(existing.hostname, this.scope).catch(() => {});
        await this.ctx.storage.delete('custom-domain');
      }
      const fallbackOrigin = `${this.alias || this.scope.projectId}.${this.env.RUNTIME_DOMAIN}`;
      const info = await this.api().addCustomHostname(hostname, fallbackOrigin);
      await this.ctx.storage.put('custom-domain', { hostname, cfId: info.id, status: info.status });
      await this.pilot().registerCustomHostname(hostname, this.scope);
      return Response.json({ domain: { hostname, cfId: info.id, status: info.status, ssl: info.ssl?.status, verificationRecord: info.ownership_verification } });
    }
    if (path === '/domain' && request.method === 'DELETE') {
      const stored = await this.ctx.storage.get<{ hostname: string; cfId: string }>('custom-domain');
      if (stored) {
        await this.api().deleteCustomHostname(stored.cfId).catch(() => {});
        await this.pilot().unregisterCustomHostname(stored.hostname, this.scope).catch(() => {});
        await this.ctx.storage.delete('custom-domain');
      }
      return Response.json({ ok: true });
    }
    if (path === '/slug' && request.method === 'POST') {
      const body = await readJson(request) as { slug: string };
      const slug = typeof body?.slug === 'string' ? body.slug.toLowerCase().trim() : '';
      if (!/^[a-z][a-z0-9-]{2,38}[a-z0-9]$/.test(slug)) throw new RuntimeError('App name must be 4–40 lowercase letters, numbers, or hyphens, and start with a letter.', 400);
      if (slug === this.alias) return Response.json({ slug, url: this.url('production') });
      await this.withControlLock(async () => {
        // Renaming mid-build would skew the in-flight job's stored R2 keys, so
        // it waits like the other mutating operations do.
        if (active(await this.ctx.storage.get<StoredJob>('current'))) throw new RuntimeError('Wait for the running build or release before renaming the app.', 409);
        const taken = await this.pilot().lookup(slug);
        if (taken && (taken.ownerId !== this.scope.ownerId || taken.projectId !== this.scope.projectId)) throw new RuntimeError('That name is already taken. Try a different one.', 409);
        const previous = this.alias;
        // Free the previous slot first so a rename at the 10-project cap can
        // succeed. Only persist the new alias after registration succeeds, and
        // roll the old registration back if the new one fails — a failed
        // rename must never leave the project aliased to a dead slug.
        if (previous && previous !== slug) await this.pilot().unregister(previous, this.scope).catch(() => {});
        try {
          requireAdmission(await this.pilot().register(slug, this.scope));
        } catch (error) {
          if (previous && previous !== slug) await this.pilot().register(previous, this.scope).catch(() => {});
          throw error;
        }
        this.alias = slug;
        await this.ctx.storage.put('alias', slug);
        // Move already-stored objects (uploads, sources, artifacts,
        // screenshots) under the new alias. Per-row deletes, serving, and the
        // delete-time sweep all address the live alias, so objects left under
        // the old prefix would 404 after the rename and survive project
        // deletion as orphans.
        if (previous && previous !== slug) await this.migrateAliasPrefix(previous, slug);
      });
      return Response.json({ slug, url: this.url('production') });
    }
    if (path === '/slug/check' && request.method === 'GET') {
      const slug = (url.searchParams.get('slug') || '').toLowerCase().trim();
      if (!/^[a-z][a-z0-9-]{2,38}[a-z0-9]$/.test(slug)) return Response.json({ available: false, reason: 'Invalid format.' });
      if (slug === this.alias) return Response.json({ available: true });
      const taken = await this.pilot().lookup(slug);
      return Response.json({ available: !taken || (taken.ownerId === this.scope.ownerId && taken.projectId === this.scope.projectId) });
    }
    if (path === '/preview-ticket' && request.method === 'POST') {
      const body = await request.json().catch(() => ({})) as { path?: string; embed?: boolean; autoSignIn?: boolean };
      const next = body.path === '/__brainhalf/auth' ? body.path : '/';
      // autoSignIn: true lets the workspace "Open app preview" button land the
      // project owner inside the app already signed in — no auth screen to dismiss.
      const autoSignIn = body.autoSignIn === true && environment === 'development';
      const ticket = await this.withControlLock(async () => {
        requireAdmission(await this.pilot().register(this.alias, this.scope));
        return this.createSession('ticket', 'development', { next, autoSignIn: autoSignIn ? '1' : '' }, 60);
      });
      const params = `ticket=${ticket}${body.embed ? '&embed=1' : ''}`;
      return Response.json({ url: `${this.url('development')}/__brainhalf/open?${params}` });
    }
    if (path === '/heartbeat' && request.method === 'POST') {
      await this.ctx.storage.transaction(async txn => {
        const job = await txn.get<StoredJob>('current');
        if (active(job) && job.status !== 'stopping') {
          job.leaseUntil = Date.now() + PILOT_LIMITS.leaseMs;
          await txn.put({ current: job, [`job:${job.id}`]: job });
      const outcome = this.jobOutcome(job);
      if (outcome) await txn.put(`outcome:${outcome.id}:${outcome.kind}`, outcome);
        }
      });
      return Response.json({ ok: true });
    }
    if (path === '/stop' && request.method === 'POST') {
      // A bodyless POST can cross a service binding as an empty readable stream.
      // Read it with the same size limit; only zero bytes count as no options.
      const value = await readJson(request, 256, { allowEmpty: true });
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RuntimeError('Stop options must be a JSON object.');
      const body = value as { expectedJobId?: unknown };
      if (body.expectedJobId !== undefined && (typeof body.expectedJobId !== 'string' || body.expectedJobId.length > 128)) throw new RuntimeError('Invalid job identifier.');
      await this.stop(body.expectedJobId as string | undefined); return Response.json({ ok: true });
    }
    if (path === '/unpublish' && request.method === 'POST') {
      if (environment !== 'production') throw new RuntimeError('Only production releases can be unpublished.');
      await this.ctx.storage.transaction(async txn => {
        if (active(await txn.get<StoredJob>('current'))) throw new RuntimeError('Wait for the running job before taking the app offline.', 409);
        await txn.delete('active:production');
      });
      return Response.json({ ok: true });
    }
    if (path === '/rollback' && request.method === 'POST') {
      if (active(await this.ctx.storage.get<StoredJob>('current'))) throw new RuntimeError('Wait for the running job before rolling back.', 409);
      const body = await readJson(request) as { releaseId: string };
      const release = await this.ctx.storage.get<ProjectRelease>(`release:${environment}:${body.releaseId}`);
      if (!release) throw new RuntimeError('Release not found.', 404);
      const migrations = await this.ctx.storage.get<MigrationReceipt[]>(`migrations:${environment}`) || [];
      if (JSON.stringify(migrations) !== JSON.stringify(release.migrations)) throw new RuntimeError('This release uses a different database schema. Rollback requires a reviewed database restore.', 409);
      await this.ctx.storage.put(`active:${environment}`, release);
      return Response.json({ release });
    }
    if (path === '/jobs' && request.method === 'POST') {
      const body = await readJson(request, 5_000_000) as { kind: RuntimeJob['kind']; files: Record<string, string>; retryJobId?: string };
      if (!['build', 'preview', 'dev', 'verify', 'deploy', 'migrate', 'publish'].includes(body.kind)) throw new RuntimeError('Unknown job kind.');
      if (body.kind === 'publish' && environment !== 'production') throw new RuntimeError('Publish creates a production release.');
      if (body.kind === 'verify' && environment !== 'development') throw new RuntimeError('Run destructive verification against development only.');
      if (body.kind === 'dev' && environment !== 'development') throw new RuntimeError('Dev preview runs against development only.');
      let inputFiles = body.files;
      if (body.retryJobId) {
        const previous = await this.ctx.storage.get<StoredJob>(`job:${body.retryJobId}`);
        if (!previous || previous.environment !== environment || previous.kind !== body.kind) throw new RuntimeError('Saved job not found in this environment.', 404);
        const saved = await this.env.ARTIFACTS.get(previous.sourceKey);
        if (!saved) throw new RuntimeError('Saved job source is unavailable.', 404);
        inputFiles = (await saved.json<SourceSnapshot>()).files;
      }
      const snapshot = await sourceSnapshot(inputFiles);
      if (environment === 'production' && body.kind === 'deploy') {
        const report = await this.ctx.storage.get<VerificationReport>('verification:development');
        if (!report?.passed || report.revision !== snapshot.revision) throw new RuntimeError('Verify this exact revision in development before publishing production.', 409);
      }
      const manifest = projectManifest(snapshot.files);
      const isWorkers = manifest.brainhalf?.runtime === 'workers';
      if (hasWorkerEntry(snapshot.files) && !isWorkers) {
        throw new RuntimeError('Set package.json "brainhalf": { "runtime": "workers" } for Cloudflare Workers full-stack apps.');
      }
      const staticApp = body.kind === 'publish' && publicationTarget(snapshot.files) === 'static';
      const node = !staticApp && !isWorkers;
      if (node && !['build', 'preview', 'dev'].includes(body.kind)) throw new RuntimeError('This Node project supports Sandbox builds and development preview. Use the Workers starter for D1 and production releases.');
      if (body.kind === 'dev' && !node) throw new RuntimeError('Dev preview is only supported for Node projects.');
      if (!manifest.scripts.build) throw new RuntimeError('Add a build script to package.json.');
      if ((body.kind === 'verify' || (body.kind === 'publish' && !staticApp)) && !manifest.scripts.test) throw new RuntimeError('Verification requires a test script.');
      if (body.kind === 'verify' || body.kind === 'publish') verificationPlan(snapshot.files);
      if (body.kind === 'publish' && !staticApp) {
        productionHealthPath(snapshot.files);
        await this.prepareServices('production');
        const services = this.services().store;
        assertProductionServices(services.settings('production'), await services.readiness('production'));
      }
      const job: StoredJob = { id: crypto.randomUUID(), kind: body.kind, environment, revision: snapshot.revision, status: 'queued', createdAt: Date.now(), updatedAt: Date.now(), leaseUntil: Date.now() + (body.kind === 'publish' ? PILOT_LIMITS.commandTimeoutMs : PILOT_LIMITS.leaseMs), processIds: [], message: 'Queued', step: 0, sandboxId: '', sourceKey: '', node, static: staticApp, ...(body.kind === 'publish' ? { publishStage: 'build' } : {}) };
      job.sandboxId = `job-${job.id}`; job.sourceKey = `${this.alias}/sources/${snapshot.revision}.json`;
      await this.withControlLock(async () => {
        if (this.databaseOperation) throw new RuntimeError('Wait for the database action to finish.', 409);
        if (active(await this.ctx.storage.get<StoredJob>('current'))) throw new RuntimeError('A runtime job is already running. Stop it first.', 409);
        requireAdmission(await this.pilot().register(this.alias, this.scope));
        requireAdmission(await this.pilot().acquire(job.id, 'sandbox', this.scope.projectId));
        try { await this.consumeUsage('jobs', job.id); await this.env.ARTIFACTS.put(job.sourceKey, JSON.stringify(snapshot)); await this.saveJob(job); await this.scheduleAlarm(Date.now() + 100); }
        catch (error) { await this.pilot().release(job.id); throw error; }
      });
      return Response.json({ job }, { status: 202 });
    }
    if (path === '/live-files' && request.method === 'POST') {
      const body = await readJson(request) as { path: string; content: string };
      if (typeof body.path !== 'string' || typeof body.content !== 'string') throw new RuntimeError('Invalid request body.', 400);
      const safePath = body.path.replace(/^\/+/, '');
      if (!safePath || safePath.includes('..') || /^(?:node_modules|\.git|dist)\//.test(safePath)) throw new RuntimeError('Path not allowed.', 400);
      const job = await this.ctx.storage.get<StoredJob>('current');
      if (!job || job.status !== 'running' || !job.previewReady || !['preview', 'dev'].includes(job.kind)) throw new RuntimeError('No running dev server to push to.', 409);
      await this.sandbox(job).writeFile(`/workspace/project/${safePath}`, body.content);
      return Response.json({ ok: true });
    }
    throw new RuntimeError('That page or action was not found. Try refreshing, or go back to your project.', 404);
  }
  private jobOutcome(job: StoredJob): OutcomeEvent | null {
    if (job.kind !== 'publish') return null;
    const kind = job.status === 'queued' ? 'publish_started' : job.status === 'passed' ? 'publish_passed' : ['failed', 'stopped'].includes(job.status) ? 'publish_failed' : null;
    return kind ? { ...this.scope, id: job.id, kind, at: kind === 'publish_started' ? job.createdAt : job.finishedAt || job.updatedAt, revision: job.revision } : null;
  }
  private async drainOutcomes() {
    if (!this.env.PLATFORM) return;
    const events = await this.ctx.storage.list<OutcomeEvent>({ prefix: 'outcome:', limit: 20 });
    for (const [key, event] of events) {
      try {
        const response = await this.env.PLATFORM.fetch(new Request('https://platform/outcomes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...this.scope, environment: 'production', event }), signal: AbortSignal.timeout(5000) }));
        if (!response.ok) break;
        await this.ctx.storage.delete(key);
      } catch { break; }
    }
    if ((await this.ctx.storage.list({ prefix: 'outcome:', limit: 1 })).size) await this.scheduleAlarm(Date.now() + 60_000);
  }
  private async saveJob(job: StoredJob) {
    await this.ctx.storage.transaction(async txn => {
      const current = await txn.get<StoredJob>('current');
      if (current?.id === job.id) {
        if (!active(current) || (current.status === 'stopping' && !['stopping', 'stopped', 'failed'].includes(job.status))) throw new RuntimeError('Job stopped.', 409);
        // Alarm snapshots must preserve heartbeats received during external I/O.
        job.leaseUntil = Math.max(job.leaseUntil, current.leaseUntil);
      } else if (current && (active(current) || job.status !== 'queued')) throw new RuntimeError('Job superseded.', 409);
      job.updatedAt = Date.now();
      await txn.put({ current: job, [`job:${job.id}`]: job });
      const outcome = this.jobOutcome(job);
      if (outcome) await txn.put(`outcome:${outcome.id}:${outcome.kind}`, outcome);
    });
  }
  private async assertRunning(job: StoredJob) {
    const current = await this.ctx.storage.get<StoredJob>('current');
    if (!current || current.id !== job.id || !active(current) || current.status === 'stopping') throw new RuntimeError('Job stopped.', 409);
    job.leaseUntil = current.leaseUntil;
    if (job.kind !== 'publish' && job.leaseUntil < Date.now()) throw new RuntimeError('Workspace disconnected; job stopped. Reopen and run it again.', 409);
    if (Date.now() - job.createdAt > PILOT_LIMITS.commandTimeoutMs) throw new RuntimeError('Pilot job time limit reached.');
  }
  async stop(expectedJobId?: string) {
    if (this.stopping) return this.stopping;
    const work = this.stopCurrent(expectedJobId);
    this.stopping = work;
    try { await work; } finally { this.stopping = undefined; }
  }
  private async stopCurrent(expectedJobId?: string) {
    const job = await this.ctx.storage.get<StoredJob>('current');
    if (!active(job)) return;
    if (expectedJobId && job.id !== expectedJobId) throw new RuntimeError('The running job changed. Refresh before retrying.', 409);
    job.previewReady = false;
    job.status = 'stopping'; job.message = 'Stopping processes'; await this.saveJob(job);
    await this.scheduleAlarm(Date.now() + 5_000);
    // Drain provisioning, uploads, browser starts and filesystem work as well as
    // process starts. Nothing may create new resources after shutdown is acknowledged.
    if (this.advancing) await Promise.allSettled([this.advancing]);
    await this.cleanup(job);
    job.status = 'stopped'; job.message = 'Stopped'; job.finishedAt = Date.now(); await this.saveJob(job);
  }
  private async cleanup(job: StoredJob, preserveCandidate = false) {
    // Admission may still be returning a process handle. Wait until its cancellation
    // guard has run before destroying the container and releasing its quota slot.
    await Promise.allSettled([...this.pendingStarts]);
    const browserId = await this.ctx.storage.get<string>('browser');
    if (browserId) {
      let browser: Awaited<ReturnType<typeof connect>> | undefined;
      try {
        browser = await connect(this.env.BROWSER, browserId);
        // Closing a reconnected Playwright client only disconnects its transport.
        // Explicitly terminate Chrome, then confirm the remote session is gone.
        await (await browser.newBrowserCDPSession()).send('Browser.close');
      } catch { /* A closed/expired session can reject either connect or Browser.close. */ }
      finally { try { await browser?.close(); } catch { /* check remote state below */ } }
      if ((await sessions(this.env.BROWSER)).some(session => session.sessionId === browserId)) throw new RuntimeError('Browser termination is still pending. Retry shutdown.', 503);
      await this.ctx.storage.delete('browser');
    }
    await this.sandbox(job).destroy();
    await Promise.allSettled([...this.pendingUploads]);
    await this.uploads().removeForUsers([`test:${job.id}`, `other-test:${job.id}`]);
    for (const id of [`test:${job.id}`, `other-test:${job.id}`]) { this.services().store.revoke('development', id); this.ctx.storage.sql.exec('DELETE FROM managed_users WHERE environment=? AND id=?', 'development', id); }
    const test = await this.ctx.storage.get<ProjectRelease>(`test:${job.id}`);
    if (test) {
      await this.api().remove(`/workers/dispatch/namespaces/${encodeURIComponent(this.env.DISPATCH_NAMESPACE)}/scripts/${test.scriptName}`);
      await this.api().remove(`/d1/database/${test.databaseId}`);
      await this.ctx.storage.delete(`test:${job.id}`);
    }
    const pending = await this.ctx.storage.get<ProjectRelease>(`pending-release:${job.id}`);
    if (pending && !preserveCandidate) {
      await this.api().remove(`/workers/dispatch/namespaces/${encodeURIComponent(this.env.DISPATCH_NAMESPACE)}/scripts/${pending.scriptName}`);
      await this.ctx.storage.delete(`pending-release:${job.id}`);
    }
    await this.pilot().release(job.id);
    await this.pilot().release(`browser-${job.id}`);
  }
  private async drainMail() {
    if (this.mailing) return this.mailing;
    const work = this.services().mail.drain(); this.mailing = work;
    try { await work; } finally { this.mailing = undefined; }
  }
  async alarm() {
    // Provider latency must not delay a build's lease or shutdown recovery.
    const results = await Promise.allSettled([this.drainMail(), this.advanceJobAlarm(), this.drainOutcomes()]);
    const next = this.services().mail.nextDue();
    if (next !== null && !await this.ctx.storage.get('deleted')) await this.scheduleAlarm(next);
    const failure = results.find(result => result.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
  }
  private async advanceJobAlarm() {
    if (this.advancing) return this.advancing;
    const job = await this.ctx.storage.get<StoredJob>('current');
    if (!active(job)) return;
    // Always leave a recovery alarm before external work. A Worker restart cannot strand the job.
    await this.scheduleAlarm(Date.now() + 10_000);
    if (job.status === 'stopping' || (job.kind !== 'publish' && job.leaseUntil < Date.now())) {
      try { await this.stop(); } catch { /* recovery alarm retries cleanup */ }
      return;
    }
    const work = this.runAdvance(job);
    this.advancing = work;
    try { await work; } finally { this.advancing = undefined; }
  }
  private async runAdvance(job: StoredJob) {
    try {
      await this.advance(job);
    } catch (error) {
      const latest = await this.ctx.storage.get<StoredJob>('current');
      if (!latest || latest.id !== job.id || !active(latest)) return;
      if (latest.status === 'stopping') return;
      this.log(job.id, error instanceof Error ? error.message : 'Runtime failed');
      job.status = 'stopping';
      job.message = (error && typeof (error as any).message === 'string' && (error as any).message.trim())
        ? (error as any).message.trim()
        : 'Runtime failed. Check the build logs.';
      await this.saveJob(job);
      try { await this.cleanup(job); job.status = 'failed'; job.finishedAt = Date.now(); await this.saveJob(job); } catch { /* alarm retries termination */ }
    }
  }
  private async advance(job: StoredJob) {
    const box = this.sandbox(job);
    const source = await this.env.ARTIFACTS.get(job.sourceKey);
    if (!source) throw new RuntimeError('Saved source snapshot is missing.', 503);
    const snapshot = await source.json<SourceSnapshot>();
    await this.assertRunning(job);
    if (job.step === 0) {
      const entries = Object.entries(snapshot.files);
      const directories = new Set<string>();
      for (const [path] of entries) {
        const lastSlash = path.lastIndexOf('/');
        if (lastSlash > 0) directories.add(path.slice(0, lastSlash));
      }
      await box.mkdir('/workspace/project', { recursive: true });
      await Promise.all([...directories].map(dir => box.mkdir(`/workspace/project/${dir}`, { recursive: true })));
      await this.assertRunning(job);
      await Promise.all(entries.map(([path, content]) => box.writeFile(`/workspace/project/${path}`, content)));
      job.status = 'running'; job.startedAt = Date.now();
      // Lockfiles are stripped by sourceSnapshot(), so npm ci is never reachable.
      await this.startProcess(job, ['npm', 'install']);
      job.step = 1; job.message = 'Installing dependencies'; await this.saveJob(job); return;
    }
    if (job.step <= 4) {
      if (job.kind === 'dev' && job.step === 4) { await this.advanceDevStep4(job, snapshot); return; }
      const process = await box.getProcess(job.processIds[job.processIds.length - 1]);
      if (!process) throw new RuntimeError('The container was replaced. Source is saved; start a new job to recover.');
      const state = await process.status();
      if (job.node && job.step === 4 && state.state === 'running') {
        const backend = await box.getProcess(job.processIds[job.processIds.length - 2]);
        if (!backend || (await backend.status()).state !== 'running') {
          // The frontend staying up masks a dead API: /api 404s while the UI
          // claims "running". Capture the backend's own output so the crash
          // is diagnosable from the job logs.
          if (backend) {
            try {
              const backendOutput = await backend.output({ encoding: 'utf8', maxBytes: PILOT_LIMITS.logBytes });
              this.log(job.id, `Node API server exited.\n${backendOutput.stdout}\n${backendOutput.stderr}`);
            } catch { /* best effort; the throw below still reports the exit */ }
          }
          throw new RuntimeError('The Node API server exited. Review the job logs and retry.');
        }
        // Ready means BOTH servers accept connections — probing only the
        // frontend port told users "running" while the API behind /api was
        // still booting. A timeout here is not a failure: the recovery alarm
        // re-checks within seconds, so slow-booting backends (migrations,
        // seed data) get time instead of a failed job after 1 second.
        try {
          await process.waitForPort(3000, { timeout: 10_000 });
          await backend.waitForPort(3001, { timeout: 10_000 });
        } catch {
          job.message = 'Waiting for the app servers to accept connections';
          await this.assertRunning(job); await this.saveJob(job); return;
        }
        job.previewReady = true; job.message = 'Node development server running'; await this.assertRunning(job); await this.saveJob(job); return;
      }
      if (state.state === 'running') return;
      const output = await process.output({ encoding: 'utf8', maxBytes: PILOT_LIMITS.logBytes });
      this.log(job.id, `${job.message}\n${output.stdout}\n${output.stderr}`);
      await this.assertRunning(job);
      if (output.exitCode !== 0 || output.timedOut) {
        // Dependency installation gets one fresh retry with plain `npm install`:
        // it recovers old snapshots carrying a mismatched model-authored lockfile
        // (`npm ci` hard-fails on those) and transient registry flakes. Timeouts
        // are not retried — a second attempt would stall for the same duration.
        if (job.step === 1 && !job.installRetried && !output.timedOut) {
          job.installRetried = true;
          // Model-authored manifests can mix versions whose declared peer ranges
          // disagree (e.g. a plugin built for an older Vite next to the current
          // one) even though the combination runs fine. ERESOLVE is npm being
          // strict — retry with --legacy-peer-deps so the package resolves.
          const peerConflict = /\bERESOLVE\b/i.test(`${output.stdout}\n${output.stderr}`);
          await this.startProcess(job, peerConflict
            ? ['npm', 'install', '--legacy-peer-deps']
            : ['npm', 'install']);
          job.message = 'Installing dependencies'; await this.saveJob(job); return;
        }
        throw new RuntimeError(`${job.message} failed (exit ${output.exitCode}).${commandFailureSummary(output.stdout, output.stderr)}`);
      }
      if (job.step === 1) {
        if (job.kind === 'dev') {
          const scripts = projectManifest(snapshot.files).scripts;
          if (!scripts.server || !scripts.dev) throw new RuntimeError('Dev preview requires a server script (PORT env) and a dev script (Vite) in package.json.');
          await this.startProcess(job, ['npm', 'run', 'server'], { PORT: '3001', APP_ORIGIN: this.url('development') });
          const backendPid = job.processIds[job.processIds.length - 1];
          await this.startProcess(job, ['npm', 'run', 'dev', '--', '--host', '0.0.0.0', '--port', '3000', '--strictPort'], { __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS: new URL(this.url('development')).hostname });
          const vitePid = job.processIds[job.processIds.length - 1];
          job.devServerPids = { vite: vitePid, backend: backendPid };
          job.step = 4; job.message = 'Starting dev servers'; await this.saveJob(job); return;
        }
        await this.startProcess(job, ['npm', 'run', 'build']); job.step = 2; job.message = 'Building application'; await this.saveJob(job); return;
      }
      if (job.step === 2 && job.kind !== 'preview' && job.kind !== 'dev' && projectManifest(snapshot.files).scripts.test) { await this.startProcess(job, ['npm', 'test']); job.step = 3; job.message = 'Running project tests'; await this.saveJob(job); return; }
      if (job.node) {
        if (job.step === 4) throw new RuntimeError('Node preview server exited. Start a new preview job.');
        if (job.kind === 'preview') {
          const scripts = projectManifest(snapshot.files).scripts;
          if (!scripts.server || !scripts.dev) throw new RuntimeError('Node preview needs a server script honoring PORT and a Vite dev script proxying /api to port 3001.');
          await this.startProcess(job, ['npm', 'run', 'server'], { PORT: '3001', APP_ORIGIN: this.url('development') });
          await this.startProcess(job, ['npm', 'run', 'dev', '--', '--host', '0.0.0.0', '--port', '3000', '--strictPort'], { __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS: new URL(this.url('development')).hostname });
          job.step = 4; job.message = 'Starting Node API and frontend'; await this.saveJob(job); return;
        }
        await this.finish(job, 'Build passed'); return;
      }
      if (job.step < 4) { await this.startProcess(job, ['node', '-e', job.static ? COLLECT_STATIC_ARTIFACT : COLLECT_ARTIFACT]); job.step = 4; job.message = 'Collecting deployment artifacts'; await this.saveJob(job); return; }
      const file = await box.readFile('/workspace/artifact.json', { encoding: 'none' });
      const artifact = validateArtifact(await readStreamJson(file.content, PILOT_LIMITS.artifactBytes * 1.5));
      job.artifactKey = `${this.alias}/artifacts/${job.id}.json`;
      await this.env.ARTIFACTS.put(job.artifactKey, JSON.stringify(artifact));
      await this.assertRunning(job); job.step = 5; job.message = 'Build complete'; await this.saveJob(job); return;
    }
    if (job.kind === 'build') { await this.finish(job, 'Build and configured tests passed'); return; }
    if (job.kind === 'verify') { await this.verifyWithInfraRetry(job, snapshot); await this.finish(job, 'Verification passed'); return; }
    if (job.kind === 'publish' && job.step === 5) {
      job.publishStage = 'verify'; job.message = 'Checking your app in an isolated test environment'; await this.saveJob(job);
      await this.verifyWithInfraRetry(job, snapshot);
      // Promote the same artifact that passed, never a second, potentially different build.
      await this.assertRunning(job); job.step = 6; job.publishStage = 'services';
      job.message = 'Preparing production services'; await this.saveJob(job); return;
    }
    if (job.kind === 'publish' && !job.static) {
      await this.prepareServices('production');
      const services = this.services().store;
      assertProductionServices(services.settings('production'), await services.readiness('production'));
    }
    if (job.kind === 'publish') {
      job.publishStage = 'deploy'; job.message = 'Deploying your frontend, backend, and production database'; await this.saveJob(job);
    }
    const database = await this.database(job.environment);
    await this.assertRunning(job);
    const migrations = await this.migrate(database.id, snapshot, job);
    await this.ctx.storage.put(`migrations:${job.environment}`, migrations);
    await this.assertRunning(job);
    if (job.kind === 'migrate') { await this.finish(job, 'Migrations applied'); return; }
    const artifact = await this.artifact(job.artifactKey!);
    const release: ProjectRelease = { id: job.id, revision: job.revision, environment: job.environment, scriptName: `bh-${this.alias.slice(0, 16)}-${job.id}`, createdAt: Date.now(), databaseId: database.id, migrations, artifactKey: job.artifactKey! };
    await this.assertRunning(job);
    // Persist upload intent so a stopped upload or isolate restart can be cleaned up.
    await this.ctx.storage.put(`pending-release:${job.id}`, release);
    await this.api().upload(this.env.DISPATCH_NAMESPACE, release.scriptName, artifact.worker, database.id, await this.serviceBindings(job.environment));
    await this.assertRunning(job);
    if (job.kind === 'publish') {
      job.publishStage = 'check'; job.message = 'Checking the production deployment before making it public'; await this.saveJob(job);
      if (!job.static) {
        await this.api().query(database.id, 'SELECT 1 AS ready');
        const response = await this.env.DISPATCHER.get(release.scriptName, {}, { limits: { cpuMs: 50, subRequests: 20 } }).fetch(new Request(this.url('production') + productionHealthPath(snapshot.files), { signal: AbortSignal.timeout(15_000), redirect: 'manual' }));
        const healthy = response.ok;
        await response.body?.cancel();
        if (!healthy) throw new RuntimeError(`The deployed backend failed its health check (HTTP ${response.status}). The previous production release is still active.`, 502);
      }
      // Clean temporary resources before the atomic publication commit. A failed
      // or cancelled candidate must never replace the user's current live app.
      await this.cleanup(job, true);
      await this.assertRunning(job);
      await this.ctx.storage.transaction(async txn => {
        const current = await txn.get<StoredJob>('current');
        if (current?.id !== job.id || current.status !== 'running') throw new RuntimeError('Job stopped.', 409);
        job.releaseId = release.id; job.status = 'passed'; job.publishStage = 'live';
        job.message = 'Your app is live'; job.finishedAt = Date.now(); job.updatedAt = Date.now();
        await txn.put({ [`release:production:${release.id}`]: release, 'active:production': release, current: job, [`job:${job.id}`]: job });
        const outcome = this.jobOutcome(job);
        if (outcome) await txn.put(`outcome:${outcome.id}:${outcome.kind}`, outcome);
        await txn.delete(`pending-release:${job.id}`);
      });
      return;
    }
    await this.ctx.storage.transaction(async txn => {
      const current = await txn.get<StoredJob>('current');
      if (current?.id !== job.id || current.status !== 'running') throw new RuntimeError('Job stopped.', 409);
      await txn.put({ [`release:${job.environment}:${release.id}`]: release, [`active:${job.environment}`]: release });
      await txn.delete(`pending-release:${job.id}`);
    });
    job.releaseId = release.id; await this.finish(job, `${job.environment === 'production' ? 'Production' : 'Development'} release ready`);
  }
  private async advanceDevStep4(job: StoredJob, snapshot: SourceSnapshot) {
    const box = this.sandbox(job);
    const { vite: vitePid, backend: backendPid } = job.devServerPids!;
    const [viteProc, backendProc] = await Promise.all([box.getProcess(vitePid), box.getProcess(backendPid)]);
    const [viteState, backendState] = await Promise.all([viteProc?.status(), backendProc?.status()]);
    const viteCrashed = !viteProc || viteState?.state !== 'running';
    const backendCrashed = !backendProc || backendState?.state !== 'running';
    if (viteCrashed || backendCrashed) {
      if (viteCrashed && viteProc) {
        try { const out = await viteProc.output({ encoding: 'utf8', maxBytes: PILOT_LIMITS.logBytes }); this.log(job.id, `Dev Vite server exited.\n${out.stdout}\n${out.stderr}`); } catch { /* best effort */ }
      }
      if (backendCrashed && backendProc) {
        try { const out = await backendProc.output({ encoding: 'utf8', maxBytes: PILOT_LIMITS.logBytes }); this.log(job.id, `Dev backend exited.\n${out.stdout}\n${out.stderr}`); } catch { /* best effort */ }
      }
      await this.assertRunning(job);
      await this.startProcess(job, ['npm', 'run', 'server'], { PORT: '3001', APP_ORIGIN: this.url('development') });
      const newBackendPid = job.processIds[job.processIds.length - 1];
      await this.startProcess(job, ['npm', 'run', 'dev', '--', '--host', '0.0.0.0', '--port', '3000', '--strictPort'], { __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS: new URL(this.url('development')).hostname });
      const newVitePid = job.processIds[job.processIds.length - 1];
      job.devServerPids = { vite: newVitePid, backend: newBackendPid };
      job.previewReady = false; job.message = 'Dev server restarting after crash';
      await this.saveJob(job); return;
    }
    if (!job.previewReady) {
      try {
        await viteProc!.waitForPort(3000, { timeout: 10_000 });
        await backendProc!.waitForPort(3001, { timeout: 10_000 });
      } catch {
        job.message = 'Waiting for dev servers to accept connections';
        await this.assertRunning(job); await this.saveJob(job); return;
      }
      job.previewReady = true; job.message = 'Dev server running';
      await this.assertRunning(job); await this.saveJob(job);
    }
  }
  private async startProcess(job: StoredJob, argv: [string, ...string[]], environment: Record<string, string> = {}) {
    await this.assertRunning(job);
    const start = (async () => {
      const process = await this.sandbox(job).exec(argv, { cwd: '/workspace/project', env: { NODE_ENV: 'development', PORT: '3000', CI: 'true', ...environment }, timeout: Math.max(1, PILOT_LIMITS.commandTimeoutMs - (Date.now() - job.createdAt)) });
      try { await this.assertRunning(job); } catch (error) { await process.kill(9); throw error; }
      job.processIds.push(process.id);
    })();
    this.pendingStarts.add(start);
    try { await start; } finally { this.pendingStarts.delete(start); }
  }
  private async finish(job: StoredJob, message: string) { await this.assertRunning(job); await this.cleanup(job); await this.assertRunning(job); job.status = 'passed'; job.message = message; job.finishedAt = Date.now(); await this.saveJob(job); }
  private async artifact(key: string): Promise<BuildArtifact> { const object = await this.env.ARTIFACTS.get(key); if (!object) throw new RuntimeError('Release artifact unavailable.', 503); return validateArtifact(await object.json()); }
  private async database(environment: ProjectEnvironment): Promise<DatabaseResource> {
    const existing = await this.ctx.storage.get<DatabaseResource>(`db:${environment}`); if (existing) return existing;
    const created = await this.api().createDatabase(`bh-${this.alias}-${environment}`);
    const db = { id: created.uuid, name: created.name, createdAt: Date.now() };
    await this.ctx.storage.put(`db:${environment}`, db); return db;
  }
  private async migrate(databaseId: string, snapshot: SourceSnapshot, job: StoredJob): Promise<MigrationReceipt[]> {
    await this.assertRunning(job);
    await this.api().query(databaseId, 'CREATE TABLE IF NOT EXISTS _bh_migrations(name TEXT PRIMARY KEY, checksum TEXT NOT NULL, appliedAt INTEGER NOT NULL)');
    const receipts = await this.api().query(databaseId, 'SELECT name,checksum,appliedAt FROM _bh_migrations ORDER BY name') as unknown as MigrationReceipt[];
    for (const receipt of receipts) if (!snapshot.files[receipt.name]) throw new RuntimeError(`Applied migration ${receipt.name} is missing from this revision.`);
    for (const { name, sql } of migrationFiles(snapshot.files)) {
      await this.assertRunning(job);
      const checksum = await digest(sql); const old = receipts.find(receipt => receipt.name === name);
      if (old) { if (old.checksum !== checksum) throw new RuntimeError(`Applied migration ${name} changed. Add a new migration instead.`); continue; }
      // Always guard — the database may hold user data even with zero receipts
      // (via /database/import, /database/schema/*, or runtime CREATE TABLE).
      assertSafeMigration(sql);
      if (/_bh_migrations/i.test(sql)) throw new RuntimeError('Migration metadata is reserved.');
      const receipt = { name, checksum, appliedAt: Date.now() };
      await this.api().query(databaseId, sql);
      await this.api().query(databaseId, 'INSERT INTO _bh_migrations(name,checksum,appliedAt) VALUES (?,?,?)', [name, checksum, receipt.appliedAt]);
      receipts.push(receipt);
    }
    return receipts;
  }
  private async createSession(kind: string, environment: ProjectEnvironment, data: unknown, seconds: number): Promise<string> {
    const raw = token();
    this.ctx.storage.sql.exec('DELETE FROM sessions WHERE expires < ?', Date.now());
    this.ctx.storage.sql.exec('INSERT INTO sessions(token,kind,environment,data,expires) VALUES (?,?,?,?,?)', await digest(raw), kind, environment, JSON.stringify(data), Date.now() + seconds * 1000);
    return raw;
  }
  private async session(raw: string | undefined, kind: string, environment: ProjectEnvironment, consume = false): Promise<Record<string, string> | null> {
    if (!raw || raw.length !== 64) return null;
    const hashed = await digest(raw);
    const rows = this.ctx.storage.sql.exec<{ data: string }>('SELECT data FROM sessions WHERE token=? AND kind=? AND environment=? AND expires>?', hashed, kind, environment, Date.now()).toArray();
    if (consume) this.ctx.storage.sql.exec('DELETE FROM sessions WHERE token=?', hashed);
    return rows[0] ? JSON.parse(rows[0].data) : null;
  }
  private async databaseControl(request: Request, environment: ProjectEnvironment): Promise<Response> {
    const url = new URL(request.url); const db = await this.ctx.storage.get<DatabaseResource>(`db:${environment}`);
    if (!db) throw new RuntimeError('Create a release in this environment to provision a database.', 404);
    const api = this.api();
    if (url.pathname === '/database' && request.method === 'GET') {
      const table = url.searchParams.get('table');
      return Response.json(table ? await readDatabaseTable(api, db.id, table, Number(url.searchParams.get('offset') || 0)) : await readDatabaseSchema(api, db.id));
    }
    const prefix = `db-recovery:${environment}:`;
    if (url.pathname === '/database/recovery' && request.method === 'GET') {
      const points = [...(await this.ctx.storage.list<DatabaseRecoveryPoint>({ prefix })).values()].filter(point => point.databaseId === db.id && point.createdAt > Date.now() - 7 * 86400_000).sort((a, b) => b.createdAt - a.createdAt);
      return Response.json({ points: points.map(({ id, label, createdAt }) => ({ id, label, createdAt })) });
    }
    if (request.method !== 'POST') throw new RuntimeError('Method not allowed.', 405);
    if (active(await this.ctx.storage.get<StoredJob>('current'))) throw new RuntimeError('Wait for the running build or release before changing the database.', 409);
    const body = await readJson(request, 256_000) as { label?: string; id?: string; confirm?: string; table?: string; rows?: unknown; rowId?: unknown; values?: unknown; columns?: unknown; column?: unknown; name?: unknown; unique?: unknown };
    const migrations = await this.ctx.storage.get<MigrationReceipt[]>(`migrations:${environment}`) || [];
    const savePoint = async (label: string) => {
      const result = await api.request<{ bookmark: string }>(`/d1/database/${encodeURIComponent(db.id)}/time_travel/bookmark`);
      if (typeof result.bookmark !== 'string' || !/^[a-f0-9-]{16,128}$/.test(result.bookmark)) throw new RuntimeError('Cloudflare did not return a recovery bookmark.', 502);
      const point: DatabaseRecoveryPoint = { id: crypto.randomUUID(), label: label.slice(0, 100), bookmark: result.bookmark, databaseId: db.id, createdAt: Date.now(), migrations };
      if (await this.ctx.storage.get('deleted')) throw new RuntimeError('Project deleted.', 410);
      await this.ctx.storage.put(prefix + point.id, point);
      const points = [...(await this.ctx.storage.list<DatabaseRecoveryPoint>({ prefix })).values()].sort((a, b) => b.createdAt - a.createdAt);
      for (const old of points.slice(12)) await this.ctx.storage.delete(prefix + old.id);
      return point;
    };
    if (url.pathname === '/database/recovery') {
      const point = await savePoint(typeof body.label === 'string' && body.label.trim() ? body.label.trim() : 'Saved recovery point');
      return Response.json({ point: { id: point.id, label: point.label, createdAt: point.createdAt } }, { status: 201 });
    }
    if (url.pathname === '/database/import') {
      if (typeof body.table !== 'string') throw new RuntimeError('Choose an application table.');
      const schema = await api.query(db.id, `PRAGMA table_info(${databaseIdentifier(body.table)})`);
      const prepared = prepareRowImport(body.table, body.rows, schema.map(column => String(column.name)));
      await savePoint('Before record import');
      await api.query(db.id, prepared.sql, prepared.params);
      await this.ctx.storage.delete(`verification:${environment}`);
      return Response.json({ imported: prepared.count });
    }
    if (url.pathname === '/database/rows/update' || url.pathname === '/database/rows/delete') {
      if (typeof body.table !== 'string') throw new RuntimeError('Choose an application table.');
      const schema = await api.query(db.id, `PRAGMA table_info(${databaseIdentifier(body.table)})`);
      if (!schema.length) throw new RuntimeError('Table no longer exists.', 404);
      const prepared = url.pathname.endsWith('/update')
        ? prepareRowUpdate(body.table, body.rowId, body.values, schema.map(column => String(column.name)))
        : prepareRowDelete(body.table, body.rowId);
      await savePoint(url.pathname.endsWith('/update') ? 'Before record update' : 'Before record delete');
      await api.query(db.id, prepared.sql, prepared.params);
      await this.ctx.storage.delete(`verification:${environment}`);
      return Response.json({ changed: true });
    }
    if (url.pathname.startsWith('/database/schema/')) {
      if (typeof body.table !== 'string') throw new RuntimeError('Choose an application table.');
      const action = url.pathname.slice('/database/schema/'.length);
      let prepared: { sql: string };
      if (action === 'create') {
        prepared = prepareCreateTable(body.table, body.columns);
      } else {
        const schema = await api.query(db.id, `PRAGMA table_info(${databaseIdentifier(body.table)})`);
        if (!schema.length) throw new RuntimeError('Table no longer exists.', 404);
        if (action === 'add-column') {
          const name = body.column && typeof body.column === 'object' && !Array.isArray(body.column) ? String((body.column as Record<string, unknown>).name ?? '') : '';
          if (schema.some(column => String(column.name) === name)) throw new RuntimeError('A column with this name already exists.');
          prepared = prepareAddColumn(body.table, body.column);
        } else if (action === 'drop-column') {
          const target = typeof body.column === 'string' ? body.column : '';
          const existing = schema.find(column => String(column.name) === target);
          if (!existing) throw new RuntimeError('Column no longer exists.', 404);
          if (Number(existing.pk) > 0) throw new RuntimeError('The primary key column cannot be removed.');
          if (schema.length <= 1) throw new RuntimeError('A table must keep at least one column.');
          prepared = prepareDropColumn(body.table, target);
        } else if (action === 'add-index') {
          if (typeof body.name !== 'string') throw new RuntimeError('Name the index.');
          const columns = Array.isArray(body.columns) ? body.columns.map(String) : [];
          const known = schema.map(column => String(column.name));
          if (columns.some(column => !known.includes(column))) throw new RuntimeError('Indexes can only use existing columns.');
          prepared = prepareCreateIndex(body.table, body.name, columns, body.unique);
        } else if (action === 'drop-table') {
          if (body.confirm !== `DROP ${body.table}`) throw new RuntimeError(`Type DROP ${body.table} to remove the whole table and its records.`);
          prepared = prepareDropTable(body.table);
        } else {
          throw new RuntimeError('Unknown schema action.', 404);
        }
      }
      await savePoint('Before schema change');
      await api.query(db.id, prepared.sql);
      await this.ctx.storage.delete(`verification:${environment}`);
      return Response.json({ changed: true }, { status: action === 'create' ? 201 : 200 });
    }
    if (url.pathname === '/database/restore') {
      if (body.confirm !== `RESTORE ${environment}` || typeof body.id !== 'string' || !/^[a-f0-9-]{36}$/.test(body.id)) throw new RuntimeError(`Type RESTORE ${environment} to confirm.`);
      const point = await this.ctx.storage.get<DatabaseRecoveryPoint>(prefix + body.id);
      if (!point || point.databaseId !== db.id || point.createdAt < Date.now() - 7 * 86400_000) throw new RuntimeError('This recovery point is unavailable or expired.', 404);
      if (JSON.stringify(point.migrations) !== JSON.stringify(migrations)) throw new RuntimeError('This recovery point uses a different schema. Restore requires a reviewed migration plan.', 409);
      const undo = await savePoint('Before database restore');
      const result = await api.request<{ bookmark: string; previous_bookmark: string }>(`/d1/database/${encodeURIComponent(db.id)}/time_travel/restore?bookmark=${encodeURIComponent(point.bookmark)}`, 'POST');
      // Cloudflare returns the exact pre-restore position, including writes that
      // arrived after our safety point. Keep that position for a precise undo.
      if (typeof result.previous_bookmark === 'string' && /^[a-f0-9-]{16,128}$/.test(result.previous_bookmark)) await this.ctx.storage.put(prefix + undo.id, { ...undo, bookmark: result.previous_bookmark });
      await this.ctx.storage.delete(`verification:${environment}`);
      return Response.json({ restored: true, undoId: undo.id });
    }
    throw new RuntimeError('Database action not found.', 404);
  }

  async appRequest(request: Request, environment: ProjectEnvironment): Promise<Response> {
    const startedAt = Date.now(); let response: Response;
    try {
      if (this.databaseOperation) throw new RuntimeError('Database maintenance in progress. Please retry shortly.', 503);
      response = await this.handleAppRequest(request, environment);
    } catch (error) { response = Response.json({ error: error instanceof RuntimeError ? error.message : 'Your app ran into a problem. Try refreshing the page. If it keeps happening, ask the builder to fix it.' }, { status: error instanceof RuntimeError ? error.status : 503 }); }
    try { if (!await this.ctx.storage.get('deleted')) recordAppRequest(this.ctx.storage.sql, environment, request, response.status, startedAt); }
    catch { console.warn('Request metrics unavailable'); }
    return response;
  }
  private async handleAppRequest(request: Request, environment: ProjectEnvironment): Promise<Response> {
    if (await this.ctx.storage.get<boolean>('deleted')) throw new RuntimeError('App not found.', 404);
    // Removing the production release also disables hosted auth, mail and storage routes.
    if (environment === 'production' && !await this.ctx.storage.get('active:production')) throw new RuntimeError('No app release is available.', 404);
    await this.consumeUsage('requests');
    const url = new URL(request.url);
    if (url.pathname === '/__brainhalf/open' && request.method === 'HEAD' && environment === 'development') {
      return new Response(null, { status: 200, headers: { 'Cross-Origin-Resource-Policy': 'cross-origin', 'Access-Control-Allow-Origin': '*' } });
    }
    if (url.pathname === '/__brainhalf/open' && request.method === 'GET' && environment === 'development') {
      const ticket = await this.session(url.searchParams.get('ticket') || undefined, 'ticket', environment, true);
      const embed = url.searchParams.get('embed') === '1';
      if (!ticket) {
        const message = 'Preview link expired. Use Open running app in your workspace to get a new link.';
        if (embed) return embedPreviewErrorPage(message);
        throw new RuntimeError(message, 401);
      }
      let next = ticket.next === '/__brainhalf/auth' ? ticket.next : '/';
      if (typeof ticket.mailId === 'string') next = this.emailActionPath((await this.services().mail.detail(environment, ticket.mailId)).text, environment);
      const session = await this.createSession('preview', environment, {}, 3600);
      const cookieValue = embed
        ? embeddedPreviewCookie('__Host-bh_preview', session, 3600)
        : secureCookie('__Host-bh_preview', session, 3600);
      let targetLocation = next;
      if (embed) {
        targetLocation += (targetLocation.includes('?') ? '&' : '?') + `bh_preview=${encodeURIComponent(session)}`;
      }
      const responseHeaders: Record<string, string | string[]> = {
        Location: targetLocation,
        'Set-Cookie': cookieValue,
        'Cross-Origin-Resource-Policy': 'cross-origin',
        'Access-Control-Allow-Origin': '*',
        'Content-Security-Policy': "frame-ancestors 'self' https://brainhalf.com https://*.brainhalf.com https://*.apps.brainhalf.com http://localhost:* http://127.0.0.1:*",
      };
      // autoSignIn: create/retrieve the owner's app account and issue an app
      // session so the project owner lands inside the app already signed in.
      // The owner account is keyed by their BrainHalf userId — it is created
      // once and reused on every subsequent open, so no duplicate accounts pile up.
      if (ticket.autoSignIn === '1' && !embed) {
        try {
          await this.prepareServices(environment);
          const store = this.services().store;
          const ownerId = this.scope.ownerId;
          const ownerAppId = `owner:${ownerId}`;
          const ownerEmail = `_owner_${ownerId.slice(0, 12)}@brainhalf.internal`;
          // Upsert the owner's app account — INSERT OR IGNORE keeps it idempotent.
          store.sql.exec(
            `INSERT OR IGNORE INTO managed_users
              (environment,id,email,name,password_hash,google_sub,github_id,verified,disabled,role,revision,created)
             VALUES (?,?,?,?,NULL,NULL,NULL,1,0,'admin',0,?)`,
            environment, ownerAppId, ownerEmail, 'App Owner', Date.now()
          );
          const ownerUser = store.user(environment, ownerAppId);
          if (ownerUser && !ownerUser.disabled) {
            const identity = store.publicUser(ownerUser);
            const appSession = await this.createSession('app', environment, identity, 3600);
            const appCookie = secureCookie('__Host-bh_app', appSession, 3600);
            // Append as a second Set-Cookie header value.
            responseHeaders['Set-Cookie'] = [cookieValue, appCookie];
          }
        } catch {
          // Auto sign-in is best-effort: if it fails the owner still gets
          // the normal preview experience and can sign in manually.
        }
      }
      const headers = new Headers();
      for (const [key, value] of Object.entries(responseHeaders)) {
        if (Array.isArray(value)) { for (const v of value) headers.append(key, v); }
        else headers.set(key, value);
      }
      return new Response(null, { status: 303, headers });
    }
    const previewSessionToken = cookie(request, '__Host-bh_preview') || url.searchParams.get('bh_preview');
    let hasPreviewSession = Boolean(previewSessionToken && await this.session(previewSessionToken, 'preview', environment));
    if (!hasPreviewSession && url.searchParams.get('ticket') && environment === 'development' && request.method !== 'HEAD') {
      const ticketSession = await this.session(url.searchParams.get('ticket') || undefined, 'ticket', environment, true);
      if (ticketSession) {
        hasPreviewSession = true;
      }
    }
    if (environment === 'development' && !hasPreviewSession) {
      const isEmbed = url.searchParams.get('embed') === '1' || request.headers.get('Sec-Fetch-Dest') === 'iframe';
      if (isEmbed) {
        return embedPreviewErrorPage('Use Open running app in your BrainHalf workspace to access this private preview.');
      }
      throw new RuntimeError('Use Open running app in your BrainHalf workspace to access this private preview.', 401);
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && request.headers.get('Origin') !== url.origin) throw new RuntimeError('Untrusted app request origin.', 403);
    await this.prepareServices(environment);
    if (url.pathname === '/__brainhalf/auth' && request.method === 'GET') return authPage(this.services().store.settings(environment).appName);
    if (url.pathname === '/api/storage' || url.pathname.startsWith('/api/storage/')) {
      const user = await this.services().auth.user(request, environment);
      return this.uploadRequest(request, environment, typeof user?.id === 'string' ? user.id : null);
    }
    if (url.pathname.startsWith('/api/auth/') || url.pathname === '/api/contact') return this.integrationRequest(request, environment);
    const current = await this.ctx.storage.get<StoredJob>('current');
    if (environment === 'development' && current?.node && (current.kind === 'preview' || current.kind === 'dev') && current.status === 'running' && current.step === 4) {
      const headers = new Headers(request.headers);
      for (const key of [...headers.keys()]) if (/^(?:x-bh-|x-brainhalf-|x-auth-|cf-access-)/i.test(key) || key === 'authorization') headers.delete(key);
      const appCookies = headers.get('cookie')?.split(';').filter(value => !/^(?:__Host-bh_|bh_session)/.test(value.trim())).join(';');
      headers.delete('cookie'); if (appCookies) headers.set('cookie', appCookies);
      return this.sandbox(current).containerFetch(new Request(request, { headers }), 3000);
    }
    let release = await this.ctx.storage.get<ProjectRelease>(`active:${environment}`);
    const verification = await this.session(cookie(request, '__Host-bh_verify'), 'verify', environment);
    if (verification) release = await this.ctx.storage.get<ProjectRelease>(`test:${verification.jobId}`);
    const headers = new Headers(request.headers);
    for (const key of [...headers.keys()]) if (/^(?:x-bh-|x-brainhalf-|cf-access-)/i.test(key) || ['authorization', 'cookie'].includes(key)) headers.delete(key);
    const user = await this.services().auth.user(request, environment);
    if (typeof user?.id === 'string') headers.set('x-bh-user-id', user.id);
    if (user?.role === 'user' || user?.role === 'admin') headers.set('x-bh-user-role', user.role);
    const forwarded = new Request(request, { headers });
    if (!release) {
      const isEmbed = url.searchParams.get('embed') === '1' || request.headers.get('Sec-Fetch-Dest') === 'iframe';
      if (isEmbed) {
        return embedPreviewErrorPage('App is building — your live preview will appear shortly.');
      }
      throw new RuntimeError('No app release is available.', 404);
    }
    if (url.pathname.startsWith('/api/')) {
      const response = await this.env.DISPATCHER.get(release.scriptName, {}, { limits: { cpuMs: 50, subRequests: 20 } }).fetch(forwarded);
      const safe = new Response(response.body, response); safe.headers.delete('Set-Cookie'); return safe;
    }
    if (!['GET', 'HEAD'].includes(request.method)) throw new RuntimeError('Method not allowed.', 405);
    const artifact = await this.artifact(release.artifactKey);
    const asset = artifact.assets[url.pathname] || (!url.pathname.split('/').pop()?.includes('.') ? artifact.assets['/index.html'] : undefined);
    if (!asset) throw new RuntimeError('File not found.', 404);
    return new Response(request.method === 'HEAD' ? null : Uint8Array.from(atob(asset.content), character => character.charCodeAt(0)), { headers: { 'Content-Type': asset.type } });
  }
  private emailActionPath(text: string, environment: ProjectEnvironment): string {
    const link = text.match(/https:\/\/[^\s]+\/__brainhalf\/auth\?mode=(?:verify|reset|magic)#token=[A-Za-z0-9_-]{43}/)?.[0];
    if (!link) throw new RuntimeError('This message has no sign-in action.');
    const target = new URL(link); const next = target.pathname + target.search + target.hash;
    if (target.origin !== this.url(environment) || !authPath(next)) throw new RuntimeError('Invalid authentication link.');
    return next;
  }
  private async assertServiceChangesAllowed(environment: ProjectEnvironment): Promise<void> {
    if (environment !== 'production') return;
    const job = await this.ctx.storage.get<StoredJob>('current');
    if (active(job) && job.kind === 'publish') throw new RuntimeError('Wait for publishing to finish before changing production services.', 409);
  }
  private async servicesControl(request: Request, environment: ProjectEnvironment): Promise<Response> {
    await this.prepareServices(environment);
    const { store, mail, auth } = this.services(); const path = new URL(request.url).pathname;
    const input = async () => {
      const value = await readJson(request);
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RuntimeError('Invalid settings.');
      return value as Record<string, unknown>;
    };
    if (path === '/services' && ['GET', 'PUT'].includes(request.method)) {
      if (request.method === 'PUT') {
        const value = await input();
        await this.ctx.blockConcurrencyWhile(async () => {
          await this.assertServiceChangesAllowed(environment);
          store.saveSettings(environment, value);
        });
      }
      return Response.json({ settings: store.settings(environment), providers: await store.readiness(environment),
        userCount: store.sql.exec<{ count: number }>('SELECT COUNT(*) AS count FROM managed_users WHERE environment=?', environment).toArray()[0].count,
        mailCounts: mail.counts(environment), dailyEmailLimit: PILOT_LIMITS.dailyEmails });
    }
    if (path === '/services/users' && request.method === 'GET') return Response.json({ users: auth.users(environment) });
    if (path.startsWith('/services/users/') && request.method === 'PATCH') return Response.json({ user: auth.updateUser(environment, decodeURIComponent(path.slice('/services/users/'.length)), await input()) });
    if (path === '/services/templates' && request.method === 'GET') return Response.json({ templates: mail.templates(environment) });
    if (path.startsWith('/services/templates/') && request.method === 'PUT') {
      mail.saveTemplate(environment, path.slice('/services/templates/'.length), await input()); return Response.json({ templates: mail.templates(environment) });
    }
    if (path === '/services/messages' && request.method === 'GET') return Response.json({ messages: mail.list(environment) });
    const message = path.match(/^\/services\/messages\/([a-zA-Z0-9-]+)(\/(?:retry|open))?$/);
    if (message && request.method === 'GET' && !message[2]) return Response.json(await mail.detail(environment, message[1]));
    if (message && request.method === 'POST' && message[2] === '/open' && environment === 'development') {
      const detail = await mail.detail(environment, message[1]);
      this.emailActionPath(detail.text, environment);
      const ticket = await this.createSession('ticket', environment, { mailId: message[1] }, 60);
      return Response.json({ url: `${this.url(environment)}/__brainhalf/open?ticket=${ticket}` });
    }
    if (message && request.method === 'POST' && message[2] === '/retry') { await mail.retry(environment, message[1]); return Response.json({ ok: true }); }
    throw new RuntimeError('Service settings route not found.', 404);
  }
  async backendService(request: Request, environment: ProjectEnvironment): Promise<Response> {
    if (await this.ctx.storage.get('deleted')) throw new RuntimeError('App not found.', 404);
    if (request.method !== 'POST' || new URL(request.url).pathname !== '/email') throw new RuntimeError('Backend service route not found.', 404);
    await this.prepareServices(environment);
    const body = await readJson(request) as Record<string, unknown>;
    if (!body || typeof body !== 'object' || !['welcome', 'order_receipt'].includes(String(body.template)) || typeof body.userId !== 'string' || typeof body.idempotencyKey !== 'string') throw new RuntimeError('Provide a verified app user, email template, and event key.');
    const { store, mail } = this.services();
    const user = store.user(environment, body.userId);
    if (!user || !user.verified || user.disabled) throw new RuntimeError('A verified, active app user is required.', 403);
    const input = body.variables;
    if (input !== undefined && (!input || typeof input !== 'object' || Array.isArray(input))) throw new RuntimeError('Invalid email fields.');
    const fields: Record<string, string> = { name: user.name || user.email };
    for (const [key, value] of Object.entries(input || {})) {
      if (!['orderId', 'amount', 'details'].includes(key) || typeof value !== 'string' || value.length > (key === 'details' ? 3000 : 200)) throw new RuntimeError('Invalid email fields.');
      fields[key] = value;
    }
    const message = await mail.enqueue(environment, body.template as 'welcome' | 'order_receipt', user.email, fields, 'event:' + body.idempotencyKey);
    return Response.json({ id: message.id, status: message.status }, { status: 202 });
  }
  private async integrationRequest(request: Request, environment: ProjectEnvironment, testDestination?: string): Promise<Response> {
    await this.prepareServices(environment);
    const { store, mail, auth } = this.services();
    if (new URL(request.url).pathname.startsWith('/api/auth/')) return auth.handle(request, environment);
    if (new URL(request.url).pathname !== '/api/contact' || request.method !== 'POST') throw new RuntimeError('Integration route not found.', 404);
    const input = contactInput(await readJson(request));
    store.limit(`contact:${environment}:${await digest(request.headers.get('CF-Connecting-IP') || 'unknown')}`, 5, 60_000);
    const settings = store.settings(environment);
    const config = settings.emailMode === 'custom' ? (await this.config(environment)).resend : undefined;
    const providers = await store.readiness(environment);
    const destination = testDestination || config?.contactTo || providers.ownerEmail || (environment === 'development' ? 'test@example.com' : '');
    const key = request.headers.get('Idempotency-Key') || crypto.randomUUID();
    const message = await mail.enqueue(environment, 'contact', destination, input, 'contact:' + key, input.email);
    this.ctx.storage.sql.exec('INSERT OR IGNORE INTO inbox(id,environment,data,created) VALUES (?,?,?,?)', message.id, environment, JSON.stringify({ ...input, status: message.status }), Date.now());
    this.ctx.storage.sql.exec('DELETE FROM inbox WHERE id NOT IN (SELECT id FROM inbox ORDER BY created DESC LIMIT 100)');
    return Response.json({ ok: true, id: message.id, status: message.status, message: environment === 'development' ? 'Test message captured in the project inbox. No email was sent.' : 'Your message has been queued for delivery.' }, { status: 201 });
  }
  /**
   * Verification can fail for two very different reasons: the app failed one
   * of its checks (must block publishing), or the test infrastructure itself
   * could not run — browser launch failure, disposable database provisioning,
   * network flake (a transient error must not block a working app). Retry the
   * whole run once when no app-level check has failed.
   */
  private async verifyWithInfraRetry(job: StoredJob, snapshot: SourceSnapshot) {
    try {
      await this.verify(job, snapshot);
    } catch (firstError) {
      const report = await this.ctx.storage.get<VerificationReport>('verification:development');
      const appCheckFailed = !!report && report.jobId === job.id
        && report.checks.some(check => !check.passed && check.name !== 'Verification execution');
      if (appCheckFailed) throw firstError;
      await this.verify(job, snapshot);
    }
  }

  private async verify(job: StoredJob, snapshot: SourceSnapshot) {
    const plan = verificationPlan(snapshot.files);
    await this.assertRunning(job);
    requireAdmission(await this.pilot().acquire(`browser-${job.id}`, 'browser', this.scope.projectId));
    const artifact = await this.artifact(job.artifactKey!);
    const database = await this.api().createDatabase(`bh-test-${job.id}`);
    const release: ProjectRelease = { id: job.id, revision: job.revision, environment: 'development', scriptName: `bh-test-${job.id}`, createdAt: Date.now(), databaseId: database.uuid, migrations: [], artifactKey: job.artifactKey! };
    await this.ctx.storage.put(`test:${job.id}`, release);
    let browser: Awaited<ReturnType<typeof launch>> | undefined;
    const report: VerificationReport = { jobId: job.id, revision: job.revision, environment: 'development', at: Date.now(), passed: false, checks: [] };
    try {
      await this.migrate(database.uuid, snapshot, job);
      await this.assertRunning(job);
      await this.api().upload(this.env.DISPATCH_NAMESPACE, release.scriptName, artifact.worker, database.uuid, await this.serviceBindings('development'));
      await this.assertRunning(job);
      const hostname = new URL(this.url('development')).hostname;
      browser = await launch(this.env.BROWSER, { keep_alive: 60_000, guardrails: { allowedDomains: [hostname] } });
      await this.ctx.storage.put('browser', browser.sessionId());
      await this.assertRunning(job);
      const context = await browser.newContext();
      const sessionSeconds = Math.max(1, Math.ceil((PILOT_LIMITS.commandTimeoutMs - (Date.now() - job.createdAt)) / 1000));
      const preview = await this.createSession('preview', 'development', {}, sessionSeconds);
      const verify = await this.createSession('verify', 'development', { jobId: job.id }, sessionSeconds);
      for (const prefix of ['test', 'other-test']) this.ctx.storage.sql.exec('INSERT OR IGNORE INTO managed_users (environment,id,email,name,verified,created) VALUES (?,?,?,?,1,?)', 'development', `${prefix}:${job.id}`, `${prefix}+${job.id}@example.invalid`, 'Verification user', Date.now());
      const app = await this.createSession('app', 'development', { id: `test:${job.id}` }, sessionSeconds);
      await context.addCookies([{ name: '__Host-bh_preview', value: preview, domain: hostname, path: '/', secure: true, httpOnly: true, sameSite: 'Lax' }, { name: '__Host-bh_verify', value: verify, domain: hostname, path: '/', secure: true, httpOnly: true, sameSite: 'Lax' }, { name: '__Host-bh_app', value: app, domain: hostname, path: '/', secure: true, httpOnly: true, sameSite: 'Lax' }]);
      const page = await context.newPage(); const errors: string[] = [];
      const resourceErrors: string[] = [];
      // Cloudflare injects this optional analytics script; its availability is
      // independent of the application's own scripts and deployment health.
      const optionalAnalytics = (value: string) => { const url = new URL(value); return url.hostname === 'static.cloudflareinsights.com' && /^\/beacon\.min\.js(?:\/|$)/.test(url.pathname); };
      page.on('pageerror', error => errors.push(error.message));
      page.on('response', response => {
        if (optionalAnalytics(response.url())) return;
        if (response.status() >= 400 && (['document', 'script', 'stylesheet'].includes(response.request().resourceType()) || (job.static && new URL(response.url()).pathname.startsWith('/api/')))) resourceErrors.push(`HTTP ${response.status()}: ${new URL(response.url()).pathname}`);
      });
      page.on('requestfailed', request => {
        if (optionalAnalytics(request.url())) return;
        if (['document', 'script', 'stylesheet'].includes(request.resourceType()) || (job.static && new URL(request.url()).pathname.startsWith('/api/'))) resourceErrors.push(`Request failed: ${new URL(request.url()).pathname}`);
      });
      const response = await page.goto(this.url('development'), { waitUntil: 'networkidle', timeout: 25_000 });
      await this.assertRunning(job);
      report.checks.push({ name: 'Page loads', passed: !!response?.ok(), detail: `HTTP ${response?.status()}` });
      // Apps that wire managed authentication must expose a healthy auth
      // config — a generated login page that cannot reach it signs nobody in.
      const usesManagedAuth = Object.values(snapshot.files).some(content => typeof content === 'string' && content.includes('/api/auth/'));
      if (usesManagedAuth) {
        const authConfig = await this.appRequest(new Request(this.url('development') + '/api/auth/config', { headers: { Cookie: `__Host-bh_preview=${preview}` }, signal: AbortSignal.timeout(15_000) }), 'development');
        const authOk = authConfig.ok;
        await authConfig.body?.cancel();
        report.checks.push({ name: 'Authentication ready', passed: authOk, detail: authOk ? 'The app exposes its hosted sign-in configuration.' : `Sign-in configuration failed (HTTP ${authConfig.status}).` });
      }
      if (plan) {
        const otherUser = await this.createSession('app', 'development', { id: `other-test:${job.id}` }, sessionSeconds);
        const origin = this.url('development');
        report.checks.push(...await runVerificationPlan(plan, {
          assertRunning: () => this.assertRunning(job),
          request: async step => {
            const appToken = step.as === 'user' ? app : step.as === 'otherUser' ? otherUser : '';
            const cookies = `__Host-bh_preview=${preview}; __Host-bh_verify=${verify}${appToken ? `; __Host-bh_app=${appToken}` : ''}`;
            // Go through the real runtime identity boundary and the disposable Worker.
            // Generated page JavaScript cannot fake these responses or inspect test tokens.
            return this.appRequest(new Request(origin + step.path, {
              method: step.method, headers: { Cookie: cookies, Origin: origin, 'Content-Type': 'application/json' },
              body: step.body === undefined ? undefined : JSON.stringify(step.body), signal: AbortSignal.timeout(15_000),
            }), 'development');
          },
          query: (sql, params) => this.api().query(database.uuid, sql, params),
          browser: async step => {
            if (step.action === 'goto') {
              const result = await page.goto(origin + step.path!, { waitUntil: 'domcontentloaded', timeout: 10_000 });
              if (!result?.ok()) throw new RuntimeError('The requested app page failed to load.');
              return;
            }
            const locator = page.locator(step.selector!);
            if (step.action === 'click') await locator.click({ timeout: 5_000 });
            if (step.action === 'fill') await locator.fill(step.value!, { timeout: 5_000 });
            if (step.action === 'expectVisible') await locator.waitFor({ state: 'visible', timeout: 5_000 });
            if (step.action === 'expectText') await locator.filter({ hasText: step.value! }).waitFor({ state: 'visible', timeout: 5_000 });
          },
        }));
      } else if (!job.static) {
      const checks = await page.evaluate(async () => {
        const signal = AbortSignal.timeout(15_000);
        const health = await fetch('/api/health', { signal });
        const created = await fetch('/api/items', { signal, method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'BrainHalf verification item' }) });
        const item = await created.json() as { item?: { id: string } };
        const read = await fetch('/api/items', { signal }); const data = await read.json() as { items?: { id: string }[] };
        const found = Array.isArray(data.items) && data.items.some((entry: { id: string }) => entry.id === item.item?.id);
        const contact = await fetch('/api/contact', { signal, method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'BrainHalf verification', email: 'test@example.com', message: 'Development contact form integration check.' }) });
        const mail = await contact.json() as { status?: string };
        return { itemId: item.item?.id, checks: [{ name: 'Backend health', passed: health.ok, detail: `HTTP ${health.status}` }, { name: 'API create and read', passed: created.ok && found, detail: 'Test record created and read back through the real app API.' }, { name: 'Contact API', passed: contact.ok && mail.status === 'captured', detail: 'Development message captured; no provider email sent.' }] };
      });
      await this.assertRunning(job);
      const persisted = checks.itemId ? await this.api().query(database.uuid, 'SELECT id FROM items WHERE id=?', [checks.itemId]) : [];
      const removed = checks.itemId ? await page.evaluate(async id => (await fetch(`/api/items/${encodeURIComponent(id)}`, { method: 'DELETE', signal: AbortSignal.timeout(15_000) })).ok, checks.itemId) : false;
      const remaining = checks.itemId ? await this.api().query(database.uuid, 'SELECT id FROM items WHERE id=?', [checks.itemId]) : [];
      report.checks.push(...checks.checks, { name: 'D1 persistence and deletion', passed: persisted.length === 1 && removed && remaining.length === 0, detail: 'Direct database inspection verifies the API wrote and removed the test record in disposable D1.' }, { name: 'Browser errors', passed: errors.length === 0, detail: errors.join('\n').slice(0, 2000) || 'No uncaught browser errors.' });
      }
      if (plan || job.static) report.checks.push({ name: 'Browser errors', passed: errors.length === 0, detail: errors.join('\n').slice(0, 2000) || 'No uncaught browser errors.' });
      report.checks.push({ name: 'Frontend resources', passed: resourceErrors.length === 0, detail: resourceErrors.join('\n').slice(0, 2000) || 'The tested pages and their scripts loaded successfully.' });
      report.screenshotKey = `${this.alias}/verification/${job.id}.png`;
      await this.env.ARTIFACTS.put(report.screenshotKey, await page.screenshot({ fullPage: true }));
      report.passed = report.checks.every(check => check.passed);
    } catch (error) { report.checks.push({ name: 'Verification execution', passed: false, detail: error instanceof RuntimeError ? error.message : 'Browser verification could not finish.' }); }
    finally {
      await browser?.close(); await this.ctx.storage.delete('browser');
      await Promise.allSettled([...this.pendingUploads]);
      await this.uploads().removeForUsers([`test:${job.id}`, `other-test:${job.id}`]);
    for (const id of [`test:${job.id}`, `other-test:${job.id}`]) { this.services().store.revoke('development', id); this.ctx.storage.sql.exec('DELETE FROM managed_users WHERE environment=? AND id=?', 'development', id); }
      await this.ctx.storage.transaction(async txn => {
        const current = await txn.get<StoredJob>('current');
        if (current?.id === job.id && current.status === 'running') {
          await txn.put('verification:development', report);
          if (report.passed) await txn.put(`outcome:${job.id}:verification_passed`, { ...this.scope, id: job.id, kind: 'verification_passed', at: report.at, revision: job.revision } satisfies OutcomeEvent);
        }
      });
      await this.pilot().release(`browser-${job.id}`);
      await this.api().remove(`/workers/dispatch/namespaces/${encodeURIComponent(this.env.DISPATCH_NAMESPACE)}/scripts/${release.scriptName}`);
      await this.api().remove(`/d1/database/${database.uuid}`);
      await this.ctx.storage.delete(`test:${job.id}`);
    }
    if (!report.passed) throw new RuntimeError('Verification failed. Review the runtime check results before publishing.');
  }
}
