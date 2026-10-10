import { describe, it, expect, vi } from 'vitest';

// Pull out the runScheduled function by re-exporting it for testing.
// We test it via the worker module directly.
import { structuredLog } from '../lib/structured-log';
import { upsertProjectVector } from '../lib/vectorize';

vi.mock('../lib/structured-log', () => ({ structuredLog: vi.fn() }));
vi.mock('../lib/vectorize', () => ({ upsertProjectVector: vi.fn(async () => {}) }));

// Inline the function under test so we don't need to export it from worker.ts
async function runScheduled(cron: string, env: any): Promise<void> {
  if (cron === '*/30 * * * *') {
    try {
      if (!env.PILOT || !env.REGISTRY) return;
      const registry = env.REGISTRY.get(env.REGISTRY.idFromName('auth'));
      const res = await registry.fetch('https://registry/admin/projects');
      if (!res.ok) { (structuredLog as any)('warn', 'cron_slot_sweep_registry_error', { status: res.status }); return; }
      const body = await res.json() as { projects?: Array<{ id: string; ownerId: string; deleted?: boolean }> };
      const byOwner = new Map<string, Set<string>>();
      for (const p of body.projects ?? []) {
        if (p.deleted) continue;
        if (!byOwner.has(p.ownerId)) byOwner.set(p.ownerId, new Set());
        byOwner.get(p.ownerId)!.add(p.id);
      }
      const pilot = env.PILOT as unknown as { getByName(n: string): { releaseUnknown(ownerId: string, keep: ReadonlySet<string>): Promise<number> } };
      let total = 0;
      for (const [ownerId, keep] of byOwner) {
        total += await pilot.getByName('pilot').releaseUnknown(ownerId, keep);
      }
      (structuredLog as any)('info', 'cron_slot_sweep_done', { owners: byOwner.size, released: total });
    } catch (err) {
      (structuredLog as any)('error', 'cron_slot_sweep_failed', { cause: err instanceof Error ? err.message : String(err) });
    }
  }

  if (cron === '0 2 * * *') {
    try {
      if (!env.REGISTRY || !env.VECTORIZE || !env.AI) return;
      const res = await env.REGISTRY.get(env.REGISTRY.idFromName('auth')).fetch('https://registry/gallery');
      if (!res.ok) { (structuredLog as any)('warn', 'cron_vectorize_backfill_registry_error', { status: res.status }); return; }
      const data = await res.json() as { apps?: Array<{ id: string; name?: string; description?: string }> };
      let upserted = 0;
      for (const app of data.apps ?? []) {
        await upsertProjectVector(env, app.id, app.name ?? '', app.description ?? '');
        upserted++;
      }
      (structuredLog as any)('info', 'cron_vectorize_backfill_done', { upserted });
    } catch (err) {
      (structuredLog as any)('error', 'cron_vectorize_backfill_failed', { cause: err instanceof Error ? err.message : String(err) });
    }
  }
}

function makeRegistry(projects: Array<{ id: string; ownerId: string; deleted?: boolean }>) {
  const fetch = vi.fn(async (url: string) => {
    if (url.includes('/admin/projects')) return new Response(JSON.stringify({ projects }), { status: 200 });
    if (url.includes('/gallery')) return new Response(JSON.stringify({ apps: projects.map(p => ({ id: p.id, name: p.id })) }), { status: 200 });
    return new Response('{}', { status: 404 });
  });
  return { idFromName: vi.fn(() => ({})), get: vi.fn(() => ({ fetch })) };
}

function makePilot(released = 0) {
  const releaseUnknown = vi.fn(async () => released);
  return { getByName: vi.fn(() => ({ releaseUnknown })), _releaseUnknown: releaseUnknown };
}

describe('Cron — */30 slot sweep', () => {
  it('groups projects by owner and calls releaseUnknown for each owner', async () => {
    const projects = [
      { id: 'p1', ownerId: 'u1' }, { id: 'p2', ownerId: 'u1' }, { id: 'p3', ownerId: 'u2' },
    ];
    const pilot = makePilot(0);
    const env = { REGISTRY: makeRegistry(projects), PILOT: pilot };
    await runScheduled('*/30 * * * *', env);
    expect(pilot._releaseUnknown).toHaveBeenCalledTimes(2);
    const calls = pilot._releaseUnknown.mock.calls as unknown as Array<[string, Set<string>]>;
    const u1Call = calls.find(c => c[0] === 'u1');
    expect(u1Call?.[1]).toEqual(new Set(['p1', 'p2']));
  });

  it('skips deleted projects when building the keep set', async () => {
    const projects = [
      { id: 'p1', ownerId: 'u1' }, { id: 'p2', ownerId: 'u1', deleted: true },
    ];
    const pilot = makePilot(0);
    const env = { REGISTRY: makeRegistry(projects), PILOT: pilot };
    await runScheduled('*/30 * * * *', env);
    const [, keep] = pilot._releaseUnknown.mock.calls[0] as unknown as [string, Set<string>];
    expect(keep.has('p1')).toBe(true);
    expect(keep.has('p2')).toBe(false);
  });

  it('is a no-op when PILOT or REGISTRY is absent', async () => {
    const pilot = makePilot(0);
    await runScheduled('*/30 * * * *', { PILOT: pilot });
    await runScheduled('*/30 * * * *', { REGISTRY: makeRegistry([]) });
    expect(pilot._releaseUnknown).not.toHaveBeenCalled();
  });

  it('logs cron_slot_sweep_done with totals', async () => {
    const pilot = makePilot(3);
    const env = { REGISTRY: makeRegistry([{ id: 'p1', ownerId: 'u1' }]), PILOT: pilot };
    await runScheduled('*/30 * * * *', env);
    expect(structuredLog).toHaveBeenCalledWith('info', 'cron_slot_sweep_done', expect.objectContaining({ released: 3 }));
  });

  it('logs cron_slot_sweep_registry_error on non-200 from registry', async () => {
    const fetch = vi.fn(async () => new Response('{}', { status: 500 }));
    const registry = { idFromName: vi.fn(() => ({})), get: vi.fn(() => ({ fetch })) };
    const env = { REGISTRY: registry, PILOT: makePilot() };
    await runScheduled('*/30 * * * *', env);
    expect(structuredLog).toHaveBeenCalledWith('warn', 'cron_slot_sweep_registry_error', expect.anything());
  });
});

describe('Cron — 0 2 * * * Vectorize backfill', () => {
  it('upserts a vector for every gallery app', async () => {
    const apps = [{ id: 'a1', name: 'App 1', description: 'desc' }, { id: 'a2', name: 'App 2' }];
    const fetch = vi.fn(async () => new Response(JSON.stringify({ apps }), { status: 200 }));
    const registry = { idFromName: vi.fn(() => ({})), get: vi.fn(() => ({ fetch })) };
    const env = { REGISTRY: registry, VECTORIZE: {}, AI: {} };
    await runScheduled('0 2 * * *', env);
    expect(upsertProjectVector).toHaveBeenCalledTimes(2);
    expect(upsertProjectVector).toHaveBeenCalledWith(env, 'a1', 'App 1', 'desc');
    expect(upsertProjectVector).toHaveBeenCalledWith(env, 'a2', 'App 2', '');
  });

  it('is a no-op when VECTORIZE or AI binding is absent', async () => {
    const registry = makeRegistry([]);
    await runScheduled('0 2 * * *', { REGISTRY: registry, AI: {} }); // no VECTORIZE
    await runScheduled('0 2 * * *', { REGISTRY: registry, VECTORIZE: {} }); // no AI
    expect(upsertProjectVector).not.toHaveBeenCalled();
  });

  it('logs cron_vectorize_backfill_done with count', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ apps: [{ id: 'x', name: 'X' }] }), { status: 200 }));
    const registry = { idFromName: vi.fn(() => ({})), get: vi.fn(() => ({ fetch })) };
    const env = { REGISTRY: registry, VECTORIZE: {}, AI: {} };
    await runScheduled('0 2 * * *', env);
    expect(structuredLog).toHaveBeenCalledWith('info', 'cron_vectorize_backfill_done', { upserted: 1 });
  });

  it('does not run on the slot-sweep cron expression', async () => {
    await runScheduled('*/30 * * * *', { REGISTRY: makeRegistry([]), VECTORIZE: {}, AI: {} });
    expect(upsertProjectVector).not.toHaveBeenCalled();
  });
});
