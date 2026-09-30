import { WorkerEntrypoint } from 'cloudflare:workers';
import type { RuntimeEnv } from './env';
import { digest } from './source';
import { assertScope, environmentFrom, RuntimeError, type ProjectScope } from './types';
import { runtimeAvailability, runtimeOwnerAllowed, unavailableRuntimeStatus } from './availability';
import { provisioningCheck } from './provisioning';
import { verifyServiceCapability } from './managed-capability';
export { Sandbox } from '@cloudflare/sandbox';
export { ProjectRuntime } from './project';
export { PilotCoordinator } from './pilot';

export /** Best-effort read of a project's live slug alias. Falls back to null (the
 *  caller then uses the digest alias) if the DO stub does not expose it. */
async function projectAlias(env: Pick<RuntimeBindings, 'PROJECTS'>, projectId: string): Promise<string | null> {
  try {
    const project = env.PROJECTS.getByName(projectId) as { currentAlias?: () => Promise<string> } | null;
    if (project && typeof project.currentAlias === 'function') return await project.currentAlias();
  } catch { /* fall through to the digest-alias fallback */ }
  return null;
}

function runtimeError(error: unknown): Response {
  return Response.json({ error: error instanceof RuntimeError ? error.message : 'The project runtime could not complete this request. Try again.' }, { status: error instanceof RuntimeError ? error.status : 503, headers: { 'Cache-Control': 'no-store' } });
}
// This entrypoint is reachable only through BrainHalf's authenticated service binding.
export class RuntimeControl extends WorkerEntrypoint<RuntimeEnv> {
  async fetch(request: Request): Promise<Response> {
    try {
      const scope: ProjectScope = { projectId: request.headers.get('x-bh-project') || '', ownerId: request.headers.get('x-bh-owner') || '' };
      assertScope(scope);
      if (new URL(request.url).pathname === '/provisioning-check' && request.method === 'GET') {
        if (!this.env.PILOT_OWNER_IDS.split(',').map(id => id.trim()).includes(scope.ownerId)) throw new RuntimeError('Pilot access required.', 403);
        // Available while disabled, without registering a project or starting paid jobs.
        return Response.json(await provisioningCheck(this.env.CF_ACCOUNT_ID, this.env.CF_API_TOKEN, this.env.DISPATCH_NAMESPACE), { headers: { 'Cache-Control': 'no-store' } });
      }
      if (new URL(request.url).pathname === '/stop') {
        // Shutdown remains available when provisioning is disabled by the kill switch.
        return await this.env.PROJECTS.getByName(scope.projectId).control(request);
      }
      if (new URL(request.url).pathname === '/unregister' && request.method === 'POST') {
        // Lightweight hosted-slot release for project deletion. Unlike /delete,
        // this performs no teardown — it only drops the pilot registration so a
        // deleted project stops counting against the hosted-project limit the
        // moment the delete is accepted, instead of waiting for the async
        // cleanup queue (which also unregisters, as a harmless no-op).
        // The DO's stored alias is the source of truth: a slug-renamed project
        // must release its live slug, not the digest alias.
        const alias = await projectAlias(this.env, scope.projectId) || (await digest(scope.projectId)).slice(0, 32);
        await this.env.PILOT.getByName('pilot').unregister(alias, scope);
        return Response.json({ ok: true });
      }
      if (new URL(request.url).pathname === '/delete') {
        const project = this.env.PROJECTS.getByName(scope.projectId);
        // No alias argument: initialize must keep the stored slug so teardown
        // (pilot unregister, R2 sweep, quota release) runs under the live alias.
        await project.initialize(scope);
        return await project.control(request);
      }
      const availability = runtimeAvailability(this.env, scope.ownerId);
      const requestUrl = new URL(request.url);
      if (requestUrl.pathname === '/status' && requestUrl.searchParams.get('readiness') === '1' && request.method === 'GET') {
        // Generation needs configuration readiness, not job history or a hosted reservation.
        // Actual jobs still enforce project admission, quotas and resource limits.
        return Response.json({ enabled: availability.state === 'ready', availability }, { headers: { 'Cache-Control': 'no-store' } });
      }
      if (availability.state === 'disabled' || availability.state === 'pilot_only') {
        const url = new URL(request.url);
        if (url.pathname === '/status' && request.method === 'GET') {
          return Response.json(unavailableRuntimeStatus(scope.projectId, environmentFrom(url.searchParams.get('environment') || 'development'), availability), { headers: { 'Cache-Control': 'no-store' } });
        }
        throw new RuntimeError(availability.message, 503);
      }
      if (availability.state === 'setup_required' && new URL(request.url).pathname === '/jobs') throw new RuntimeError(availability.message, 503);
      const project = this.env.PROJECTS.getByName(scope.projectId);
      // The digest alias is only a first-init default: initialize keeps the
      // stored alias (custom slug) on later calls instead of clobbering it.
      if (!await project.initialize(scope, (await digest(scope.projectId)).slice(0, 32))) throw new RuntimeError('This project has been deleted.', 410);
      const alias = await projectAlias(this.env, scope.projectId) || (await digest(scope.projectId)).slice(0, 32);
      const pilot = this.env.PILOT.getByName('pilot');
      const response = await project.control(request);
      if (response.status === 410) await pilot.unregister(alias, scope);
      return response;
    } catch (error) { return runtimeError(error); }
  }
}

/** Project Workers receive this binding and a capability scoped to their own environment. */
export class AppServicesAPI extends WorkerEntrypoint<RuntimeEnv> {
  async fetch(request: Request): Promise<Response> {
    try {
      if (this.env.RUNTIME_ENABLED !== 'true') throw new RuntimeError('App services are temporarily unavailable.', 503);
      const scope = await verifyServiceCapability((request.headers.get('Authorization') || '').replace(/^Bearer /, ''), this.env.PROJECT_SECRETS_KEY || '');
      // Resolve the alias from the project's stored state: a slug-renamed
      // project is registered under its slug, not the digest alias.
      const alias = await projectAlias(this.env, scope.projectId) || (await digest(scope.projectId)).slice(0, 32);
      const current = await this.env.PILOT.getByName('pilot').lookup(alias);
      if (!current || current.ownerId !== scope.ownerId || current.projectId !== scope.projectId || !runtimeOwnerAllowed(this.env, scope.ownerId)) throw new RuntimeError('App services are unavailable.', 403);
      return await this.env.PROJECTS.getByName(scope.projectId).backendService(request, scope.environment);
    } catch (error) { return runtimeError(error); }
  }
}

export default {
  async fetch(request: Request, env: RuntimeEnv): Promise<Response> {
    try {
      if (env.RUNTIME_ENABLED !== 'true') throw new RuntimeError('Runtime is temporarily unavailable.', 503);
      const url = new URL(request.url);
      const pilot = env.PILOT.getByName('pilot');
      const suffix = `.${env.RUNTIME_DOMAIN}`;

      let scope: ReturnType<typeof pilot.lookup> extends Promise<infer T> ? T : never;
      let environment: 'development' | 'production' = 'production';

      if (url.hostname.endsWith(suffix)) {
        // *.apps.brainhalf.com — standard BrainHalf subdomain routing
        let alias = url.hostname.slice(0, -suffix.length);
        environment = alias.startsWith('dev-') ? 'development' : 'production';
        if (environment === 'development') alias = alias.slice(4);
        if (!/^([a-f0-9]{32}|[a-z][a-z0-9-]{2,38}[a-z0-9])$/.test(alias)) throw new RuntimeError('Unknown app.', 404);
        scope = await pilot.lookup(alias);
      } else {
        // Custom domain — look up by hostname in pilot
        scope = await pilot.lookupCustomHostname(url.hostname);
      }

      if (!scope || !runtimeOwnerAllowed(env, scope.ownerId)) throw new RuntimeError('Unknown app.', 404);
      const response = await env.PROJECTS.getByName(scope.projectId).appRequest(request, environment);
      const safe = new Response(response.body, response);
      safe.headers.set('X-Content-Type-Options', 'nosniff');
      safe.headers.set('Referrer-Policy', 'no-referrer');
      safe.headers.set('Cache-Control', 'no-store');
      if (environment === 'development') safe.headers.set('X-Robots-Tag', 'noindex, nofollow');
      return safe;
    } catch (error) { return runtimeError(error); }
  },
} satisfies ExportedHandler<RuntimeEnv>;
