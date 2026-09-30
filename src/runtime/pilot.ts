import { DurableObject } from 'cloudflare:workers';
import type { RuntimeEnv } from './env';
import { OWNER_RUNTIME_LIMITS, PILOT_LIMITS, RuntimeError, type ProjectScope, type RuntimeUsage, type RuntimeUsageKind } from './types';

interface DailyUsage { day: string; used: Record<RuntimeUsageKind, number>; jobs: string[]; emails?: string[] }
interface StoredBytes { bytes: number; objects: Record<string, number> }
function dailyUsage(previous?: DailyUsage): DailyUsage {
  const day = new Date().toISOString().slice(0, 10);
  return previous?.day === day ? previous : { day, used: { jobs: 0, requests: 0, emails: 0 }, jobs: [] };
}

export type PilotAdmission = { ok: true } | { ok: false; error: string; status: number };
export function requireAdmission(result: PilotAdmission): void {
  if (!result.ok) throw new RuntimeError(result.error, result.status);
}
async function admit(action: () => Promise<void>): Promise<PilotAdmission> {
  try { await action(); return { ok: true }; }
  catch (error) {
    // RPC serializes Error without custom fields/prototypes. Return expected
    // admission failures as data so clients retain quota messages and HTTP status.
    if (error instanceof RuntimeError) return { ok: false, error: error.message, status: error.status };
    throw error;
  }
}
export class PilotCoordinator extends DurableObject<RuntimeEnv> {
  /** Called on an owner-specific instance, separate from the pilot admission instance. */
  async consumeUsage(kind: RuntimeUsageKind, jobId?: string): Promise<PilotAdmission> {
    return admit(() => this.ctx.storage.transaction(async txn => {
      if (!['jobs', 'requests', 'emails'].includes(kind)) throw new RuntimeError('Invalid usage category.');
      if (kind === 'jobs' && (!jobId || jobId.length > 128)) throw new RuntimeError('A job identity is required.');
      const usage = dailyUsage(await txn.get<DailyUsage>('owner:daily'));
      if (kind === 'jobs' && usage.jobs.includes(jobId!)) return;
      if (kind === 'emails' && jobId && (usage.emails || []).includes(jobId)) return;
      if (usage.used[kind] >= OWNER_RUNTIME_LIMITS[kind]) throw new RuntimeError(`Daily account ${kind} limit reached. Limits reset at midnight UTC.`, 429);
      usage.used[kind]++;
      if (kind === 'jobs') usage.jobs.push(jobId!);
      if (kind === 'emails' && jobId) { usage.emails ||= []; usage.emails.push(jobId); }
      await txn.put('owner:daily', usage);
    }));
  }
  async usageStatus(): Promise<RuntimeUsage> {
    const daily = dailyUsage(await this.ctx.storage.get<DailyUsage>('owner:daily'));
    const storage = await this.ctx.storage.get<StoredBytes>('owner:storage');
    return { day: daily.day, used: daily.used, limits: { jobs: OWNER_RUNTIME_LIMITS.jobs, requests: OWNER_RUNTIME_LIMITS.requests, emails: OWNER_RUNTIME_LIMITS.emails }, storageBytes: storage?.bytes || 0, storageLimitBytes: OWNER_RUNTIME_LIMITS.storageBytes };
  }
  async reserveStorage(id: string, bytes: number): Promise<PilotAdmission> {
    return admit(() => this.ctx.storage.transaction(async txn => {
      if (!/^[a-zA-Z0-9:/_-]{1,180}$/.test(id) || !Number.isSafeInteger(bytes) || bytes < 1) throw new RuntimeError('Invalid storage reservation.');
      const storage = await txn.get<StoredBytes>('owner:storage') || { bytes: 0, objects: {} };
      if (Object.prototype.hasOwnProperty.call(storage.objects, id)) {
        if (storage.objects[id] !== bytes) throw new RuntimeError('Storage reservation does not match.', 409);
        return;
      }
      if (storage.bytes + bytes > OWNER_RUNTIME_LIMITS.storageBytes) throw new RuntimeError('Account upload storage limit reached. Delete unused files to make space.', 429);
      Object.defineProperty(storage.objects, id, { value: bytes, enumerable: true, configurable: true, writable: true });
      storage.bytes += bytes;
      await txn.put('owner:storage', storage);
    }));
  }
  async releaseStorage(id: string): Promise<void> {
    await this.ctx.storage.transaction(async txn => {
      const storage = await txn.get<StoredBytes>('owner:storage');
      if (!storage || !Object.prototype.hasOwnProperty.call(storage.objects, id)) return;
      storage.bytes -= storage.objects[id]; delete storage.objects[id];
      await txn.put('owner:storage', storage);
    });
  }
  async register(alias: string, scope: ProjectScope): Promise<PilotAdmission> {
    return admit(() => this.ctx.storage.transaction(async txn => {
      // Index existing registrations once, then count only this owner's projects.
      if (!await txn.get<boolean>('owner-project-index:v1')) {
        for (const [key, existing] of await txn.list<ProjectScope>({ prefix: 'project:' })) {
          await txn.put(`owner-project:${encodeURIComponent(existing.ownerId)}:${key.slice('project:'.length)}`, true);
        }
        await txn.put('owner-project-index:v1', true);
      }
      const ownerPrefix = `owner-project:${encodeURIComponent(scope.ownerId)}:`;
      const previous = await txn.get<ProjectScope>(`project:${alias}`);
      if (previous) {
        if (previous.ownerId !== scope.ownerId || previous.projectId !== scope.projectId) throw new RuntimeError('Project scope mismatch.', 403);
        return;
      }
      if ((await txn.list({ prefix: ownerPrefix })).size >= PILOT_LIMITS.projects) throw new RuntimeError(`Your account has reached its hosted app limit (${PILOT_LIMITS.projects} apps). Remove an app you no longer use to make room.`, 429);
      await txn.put(`project:${alias}`, scope);
      await txn.put(ownerPrefix + alias, true);
    }));
  }
  lookup(alias: string) { return this.ctx.storage.get<ProjectScope>(`project:${alias}`); }
  lookupCustomHostname(hostname: string) { return this.ctx.storage.get<ProjectScope>(`custom-hostname:${hostname}`); }
  async registerCustomHostname(hostname: string, scope: ProjectScope): Promise<void> {
    await this.ctx.storage.transaction(async txn => {
      const existing = await txn.get<ProjectScope>(`custom-hostname:${hostname}`);
      if (existing) {
        if (existing.ownerId === scope.ownerId && existing.projectId === scope.projectId) return; // idempotent
        throw new RuntimeError('This domain is already registered to another project.', 409);
      }
      await txn.put(`custom-hostname:${hostname}`, scope);
    });
  }
  async unregisterCustomHostname(hostname: string, scope: ProjectScope): Promise<void> {
    const existing = await this.ctx.storage.get<ProjectScope>(`custom-hostname:${hostname}`);
    if (existing && existing.ownerId === scope.ownerId && existing.projectId === scope.projectId) {
      await this.ctx.storage.delete(`custom-hostname:${hostname}`);
    }
  }
  async unregister(alias: string, scope: ProjectScope) {
    await this.ctx.storage.transaction(async txn => {
      const existing = await txn.get<ProjectScope>(`project:${alias}`);
      if (existing && (existing.ownerId !== scope.ownerId || existing.projectId !== scope.projectId)) throw new RuntimeError('Project scope mismatch.', 403);
      await txn.delete(`project:${alias}`);
      await txn.delete(`owner-project:${encodeURIComponent(scope.ownerId)}:${alias}`);
    });
  }
  /** All hosted-slot registrations for one account — including orphans whose
   *  projects no longer exist (deletion cleanup is best-effort and old clients
   *  removed projects locally without server cleanup). Slots are accounting
   *  only: releasing one never tears down a deployment, and a live project
   *  simply re-registers on its next job. */
  async listOwnerProjects(ownerId: string): Promise<Array<{ alias: string; projectId: string }>> {
    const prefix = `owner-project:${encodeURIComponent(ownerId)}:`;
    const rows = await this.ctx.storage.list({ prefix });
    const hosted: Array<{ alias: string; projectId: string }> = [];
    for (const [key] of rows) {
      const alias = key.slice(prefix.length);
      const scope = await this.ctx.storage.get<ProjectScope>(`project:${alias}`);
      if (scope?.ownerId === ownerId) hosted.push({ alias, projectId: scope.projectId });
    }
    return hosted.sort((a, b) => a.projectId.localeCompare(b.projectId));
  }
  async forceRelease(alias: string, ownerId: string): Promise<{ released: boolean }> {
    return this.ctx.storage.transaction(async txn => {
      const existing = await txn.get<ProjectScope>(`project:${alias}`);
      if (!existing || existing.ownerId !== ownerId) return { released: false };
      await txn.delete(`project:${alias}`);
      await txn.delete(`owner-project:${encodeURIComponent(ownerId)}:${alias}`);
      return { released: true };
    });
  }
  async acquire(id: string, kind: 'sandbox' | 'browser', projectId: string): Promise<PilotAdmission> {
    return admit(() => this.ctx.storage.transaction(async txn => {
      const now = Date.now();
      const leases = await txn.list<{ kind: string; expires: number }>({ prefix: 'lease:' });
      let active = 0;
      for (const [key, lease] of leases) {
        if (lease.expires <= now) await txn.delete(key);
        else if (lease.kind === kind && key !== `lease:${id}`) active++;
      }
      if (active >= (kind === 'sandbox' ? PILOT_LIMITS.sandboxes : PILOT_LIMITS.browsers)) throw new RuntimeError(`All pilot ${kind} slots are busy. Try again shortly.`, 429);
      const day = new Date(now).toISOString().slice(0, 10);
      const key = `usage:${projectId}`;
      const usage = await txn.get<{ day: string; count: number }>(key);
      const count = usage?.day === day ? usage.count : 0;
      if (kind === 'sandbox' && !leases.has(`lease:${id}`)) {
        if (count >= PILOT_LIMITS.dailyJobs) throw new RuntimeError('Daily pilot job limit reached.', 429);
        await txn.put(key, { day, count: count + 1 });
      }
      await txn.put(`lease:${id}`, { kind, expires: now + PILOT_LIMITS.commandTimeoutMs + PILOT_LIMITS.idleTimeoutMs });
    }));
  }
  async release(id: string) { await this.ctx.storage.delete(`lease:${id}`); }
}
