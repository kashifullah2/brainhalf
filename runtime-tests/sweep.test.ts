import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('cloudflare:workers', () => ({
  DurableObject: class { constructor(public ctx: any, public env: any) {} },
  WorkerEntrypoint: class { constructor(public ctx: any, public env: any) {} },
}));
vi.mock('@cloudflare/sandbox', () => ({ getSandbox: () => ({ destroy: async () => {} }) }));
vi.mock('@cloudflare/playwright', () => ({ launch: vi.fn(), connect: vi.fn(), sessions: vi.fn() }));

import { RuntimeControl } from '../src/runtime/worker';

afterEach(() => { vi.restoreAllMocks(); });

function makeEnv(releaseUnknown: (ownerId: string, keep: ReadonlySet<string>) => Promise<number>) {
  return {
    PILOT_OWNER_IDS: 'owner-1',
    PROJECTS: { getByName: () => ({ initialize: async () => {}, control: async () => new Response('ok') }) },
    PILOT: { getByName: () => ({ releaseUnknown }) },
  };
}

function sweepRequest(body: BodyInit | null, contentType = 'application/json') {
  return new Request('https://runtime/hosted/sweep', {
    method: 'POST',
    headers: { 'x-bh-project': 'proj-abc', 'x-bh-owner': 'owner-1', 'Content-Type': contentType },
    body,
  });
}

// ---------------------------------------------------------------------------
// Issue 2: /hosted/sweep swallowed JSON parse error
// If the body fails to parse (empty, truncated), body.keep evaluates to
// undefined → keep is an empty Set → every hosted slot is deleted.
// ---------------------------------------------------------------------------
describe('/hosted/sweep: fail closed on invalid request body', () => {
  it('returns 400 and does not call releaseUnknown when the body is not valid JSON', async () => {
    const releaseUnknown = vi.fn(async () => 0);
    const ctrl = new RuntimeControl({} as any, makeEnv(releaseUnknown) as any);
    const res = await ctrl.fetch(sweepRequest('')); // empty body → JSON parse error
    expect(res.status).toBe(400);
    expect(releaseUnknown).not.toHaveBeenCalled();
  });

  it('returns 400 and does not call releaseUnknown when body.keep is missing', async () => {
    const releaseUnknown = vi.fn(async () => 0);
    const ctrl = new RuntimeControl({} as any, makeEnv(releaseUnknown) as any);
    const res = await ctrl.fetch(sweepRequest(JSON.stringify({ other: true }))); // valid JSON, no keep
    expect(res.status).toBe(400);
    expect(releaseUnknown).not.toHaveBeenCalled();
  });

  it('returns 400 and does not call releaseUnknown when body.keep is not an array', async () => {
    const releaseUnknown = vi.fn(async () => 0);
    const ctrl = new RuntimeControl({} as any, makeEnv(releaseUnknown) as any);
    const res = await ctrl.fetch(sweepRequest(JSON.stringify({ keep: 'proj-abc' }))); // keep is string
    expect(res.status).toBe(400);
    expect(releaseUnknown).not.toHaveBeenCalled();
  });

  it('calls releaseUnknown with the correct keep set when body is valid', async () => {
    const releaseUnknown = vi.fn(async (_ownerId: string, keep: ReadonlySet<string>) => keep.size);
    const ctrl = new RuntimeControl({} as any, makeEnv(releaseUnknown) as any);
    const res = await ctrl.fetch(sweepRequest(JSON.stringify({ keep: ['proj-a', 'proj-b'] })));
    expect(res.status).toBe(200);
    expect(releaseUnknown).toHaveBeenCalledTimes(1);
    const [ownerId, keep] = releaseUnknown.mock.calls[0];
    expect(ownerId).toBe('owner-1');
    expect([...keep].sort()).toEqual(['proj-a', 'proj-b']);
  });
});
