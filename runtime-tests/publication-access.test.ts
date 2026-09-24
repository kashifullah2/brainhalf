import { describe, expect, it, vi } from 'vitest';
vi.mock('cloudflare:workers', () => ({
  WorkerEntrypoint: class { constructor(public ctx: any, public env: any) {} },
  DurableObject: class { constructor(public ctx: any, public env: any) {} },
}));
vi.mock('@cloudflare/sandbox', () => ({ Sandbox: class {}, getSandbox: vi.fn() }));
vi.mock('@cloudflare/playwright', () => ({ launch: vi.fn(), connect: vi.fn(), sessions: vi.fn() }));
import runtimeWorker, { RuntimeControl, AppServicesAPI } from '../src/runtime/worker';
import { serviceCapability } from '../src/runtime/managed-capability';

function fixture() {
  const scope = { projectId: 'project', ownerId: 'new-owner' };
  const project = { initialize: vi.fn(async () => true), control: vi.fn(async () => Response.json({ ok: true })), appRequest: vi.fn(async () => new Response('Live frontend and backend')), backendService: vi.fn(async () => Response.json({ ok: true })) };
  const pilot = { register: vi.fn(async () => ({ ok: true })), lookup: vi.fn(async () => scope) };
  const env: any = { RUNTIME_ENABLED: 'true', RUNTIME_ACCESS: 'all', PILOT_OWNER_IDS: 'operator', RUNTIME_DOMAIN: 'apps.example.com', PROJECT_SECRETS_KEY: btoa('k'.repeat(32)), CF_API_TOKEN: 'test', CF_ACCOUNT_ID: 'account', Sandbox: {}, BROWSER: {}, ARTIFACTS: {}, DISPATCHER: {}, PROJECTS: { getByName: vi.fn(() => project) }, PILOT: { getByName: () => pilot } };
  return { env, scope, project, pilot };
}

describe('Public hosting access', () => {
  it.each(['true', 'false'])('answers generation readiness without opening a project or reserving resources when enabled=%s', async enabled => {
    const f = fixture(); f.env.RUNTIME_ENABLED = enabled;
    const control = new RuntimeControl({} as any, f.env);
    const response = await control.fetch(new Request('https://control/status?readiness=1', { headers: { 'x-bh-project': f.scope.projectId, 'x-bh-owner': f.scope.ownerId } }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ enabled: enabled === 'true', availability: { state: enabled === 'true' ? 'ready' : 'disabled' } });
    expect(f.env.PROJECTS.getByName).not.toHaveBeenCalled();
    expect(f.pilot.register).not.toHaveBeenCalled();
  });
  it('delegates authenticated control without reserving a slot before job validation', async () => {
    const f = fixture(); const control = new RuntimeControl({} as any, f.env);
    const request = () => new Request('https://control/jobs?environment=production', { method: 'POST', headers: { 'x-bh-project': f.scope.projectId, 'x-bh-owner': f.scope.ownerId } });
    expect((await control.fetch(request())).status).toBe(200);
    expect(f.project.control).toHaveBeenCalledOnce();
    f.pilot.register.mockResolvedValue({ ok: false, status: 429, error: 'Your account has reached its hosted project limit.' } as any);
    expect((await control.fetch(request())).status).toBe(200);
    expect(f.project.control).toHaveBeenCalledTimes(2);
    expect(f.pilot.register).not.toHaveBeenCalled();
  });
  it('still rejects missing owner scope and keeps operator diagnostics restricted', async () => {
    const f = fixture(); const control = new RuntimeControl({} as any, f.env);
    expect((await control.fetch(new Request('https://control/jobs', { method: 'POST' }))).status).toBe(400);
    expect((await control.fetch(new Request('https://control/provisioning-check', { headers: { 'x-bh-project': f.scope.projectId, 'x-bh-owner': f.scope.ownerId } }))).status).toBe(403);
    expect(f.project.control).not.toHaveBeenCalled();
  });
  it('serves a registered non-pilot owner app and rejects unknown apps', async () => {
    const f = fixture(); const request = new Request('https://' + 'a'.repeat(32) + '.apps.example.com/api/health');
    expect((await runtimeWorker.fetch(request, f.env)).status).toBe(200);
    expect(f.project.appRequest).toHaveBeenCalledWith(request, 'production');
    f.pilot.lookup.mockResolvedValue(null as any);
    expect((await runtimeWorker.fetch(request, f.env)).status).toBe(404);
  });
  it('allows backend services only with a capability matching the registered owner', async () => {
    const f = fixture(); const services = new AppServicesAPI({} as any, f.env);
    const credential = await serviceCapability(f.scope, 'production', f.env.PROJECT_SECRETS_KEY);
    const request = () => new Request('https://services/email', { method: 'POST', headers: { Authorization: 'Bearer ' + credential } });
    expect((await services.fetch(request())).status).toBe(200);
    f.pilot.lookup.mockResolvedValue({ ...f.scope, ownerId: 'someone-else' });
    expect((await services.fetch(request())).status).toBe(403);
    expect(f.project.backendService).toHaveBeenCalledOnce();
  });
});
