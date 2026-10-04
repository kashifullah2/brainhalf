import { describe, it, expect, vi } from 'vitest';

vi.mock('cloudflare:workers', () => ({
  WorkerEntrypoint: class { constructor(public ctx: any, public env: any) {} },
  DurableObject: class { constructor(public ctx: any, public env: any) {} },
}));
vi.mock('@cloudflare/sandbox', () => ({ getSandbox: vi.fn(), Sandbox: class MockSandbox {} }));
vi.mock('@cloudflare/playwright', () => ({ launch: vi.fn(), connect: vi.fn(), sessions: vi.fn() }));

import { RuntimeControl } from '../src/runtime/worker';
import { digest } from '../src/runtime/source';

function control(env: unknown) {
  return new RuntimeControl({} as any, env as any);
}

function unregisterRequest(projectId: string | null, ownerId: string | null, method = 'POST') {
  const headers: Record<string, string> = {};
  if (projectId !== null) headers['x-bh-project'] = projectId;
  if (ownerId !== null) headers['x-bh-owner'] = ownerId;
  return new Request('https://runtime/unregister', { method, headers });
}

/** Env stub: the project's DO reports no stored alias, so /unregister falls
 *  back to the digest alias. Pass a slug for currentAlias to simulate a
 *  slug-renamed project. */
function slotEnv(unregister: unknown, storedAlias = '') {
  return {
    PILOT: { getByName: () => ({ unregister }) },
    PROJECTS: { getByName: () => ({ currentAlias: async () => storedAlias }) },
  };
}

describe('RuntimeControl /unregister (hosted slot release)', () => {
  it('releases the pilot slot for the project alias without touching project state', async () => {
    const unregister = vi.fn().mockResolvedValue(undefined);
    const getByName = vi.fn().mockReturnValue({ unregister });
    const res = await control({ PILOT: { getByName }, PROJECTS: { getByName: () => ({ currentAlias: async () => '' }) } }).fetch(unregisterRequest('proj-123', 'owner-1'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(getByName).toHaveBeenCalledWith('pilot');
    const expectedAlias = (await digest('proj-123')).slice(0, 32);
    expect(unregister).toHaveBeenCalledTimes(1);
    expect(unregister).toHaveBeenCalledWith(expectedAlias, { projectId: 'proj-123', ownerId: 'owner-1', unlimited: false });
  });

  it('uses the same alias formula as registration so the slot actually frees', async () => {
    // register() in project.ts uses this.alias = digest(projectId).slice(0, 32);
    // — if /unregister used a different alias the count would never drop.
    const unregister = vi.fn().mockResolvedValue(undefined);
    const env = slotEnv(unregister);
    await control(env).fetch(unregisterRequest('some-project-id', 'owner-9'));
    const alias = unregister.mock.calls[0][0] as string;
    expect(alias).toBe((await digest('some-project-id')).slice(0, 32));
    expect(alias).toHaveLength(32);
  });

  it('releases the live slug alias for a slug-renamed project, not the digest alias', async () => {
    const unregister = vi.fn().mockResolvedValue(undefined);
    const env = slotEnv(unregister, 'my-app');
    const res = await control(env).fetch(unregisterRequest('proj-123', 'owner-1'));
    expect(res.status).toBe(200);
    expect(unregister).toHaveBeenCalledWith('my-app', { projectId: 'proj-123', ownerId: 'owner-1', unlimited: false });
  });

  it('rejects a missing scope instead of unregistering anything', async () => {
    const unregister = vi.fn();
    const env = { PILOT: { getByName: () => ({ unregister }) } };
    const res = await control(env).fetch(unregisterRequest(null, null));
    expect(res.status).toBe(400);
    expect(unregister).not.toHaveBeenCalled();
  });

  it('rejects an invalid project id instead of unregistering anything', async () => {
    const unregister = vi.fn();
    const env = slotEnv(unregister);
    const res = await control(env).fetch(unregisterRequest('bad id!!', 'owner-1'));
    expect(res.status).toBe(400);
    expect(unregister).not.toHaveBeenCalled();
  });

  it('does not unregister on non-POST methods', async () => {
    const unregister = vi.fn();
    const env = { PILOT: { getByName: () => ({ unregister }) } };
    await control(env).fetch(unregisterRequest('proj-123', 'owner-1', 'GET'));
    expect(unregister).not.toHaveBeenCalled();
  });

  it('surfaces pilot failures instead of claiming success', async () => {
    const unregister = vi.fn().mockRejectedValue(new Error('pilot down'));
    const env = slotEnv(unregister);
    const res = await control(env).fetch(unregisterRequest('proj-123', 'owner-1'));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'The project runtime could not complete this request. Try again.' });
  });
});

describe('RuntimeControl /hosted/sweep (orphaned slot reconciliation)', () => {
  it('releases registrations for projects the owner no longer has', async () => {
    const releaseUnknown = vi.fn().mockResolvedValue(3);
    const getByName = vi.fn().mockReturnValue({ releaseUnknown });
    const res = await control({ PILOT: { getByName }, PROJECTS: { getByName: () => ({}) } }).fetch(new Request('https://runtime/hosted/sweep', {
      method: 'POST',
      headers: { 'x-bh-project': 'proj-1', 'x-bh-owner': 'owner-1', 'Content-Type': 'application/json' },
      body: JSON.stringify({ keep: ['proj-1', 'proj-2'] }),
    }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, released: 3 });
    expect(releaseUnknown).toHaveBeenCalledWith('owner-1', new Set(['proj-1', 'proj-2']));
  });

  it('drops malformed keep entries instead of failing the sweep', async () => {
    const releaseUnknown = vi.fn().mockResolvedValue(0);
    const env = { PILOT: { getByName: () => ({ releaseUnknown }) }, PROJECTS: { getByName: () => ({}) } };
    const res = await control(env).fetch(new Request('https://runtime/hosted/sweep', {
      method: 'POST',
      headers: { 'x-bh-project': 'proj-1', 'x-bh-owner': 'owner-1', 'Content-Type': 'application/json' },
      body: JSON.stringify({ keep: ['proj-1', 42, null, 'bad id!!'] }),
    }));
    expect(res.status).toBe(200);
    expect(releaseUnknown).toHaveBeenCalledWith('owner-1', new Set(['proj-1']));
  });

  it('rejects a missing owner scope without sweeping', async () => {
    const releaseUnknown = vi.fn();
    const env = { PILOT: { getByName: () => ({ releaseUnknown }) }, PROJECTS: { getByName: () => ({}) } };
    const res = await control(env).fetch(new Request('https://runtime/hosted/sweep', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }));
    expect(res.status).toBe(400);
    expect(releaseUnknown).not.toHaveBeenCalled();
  });
});
