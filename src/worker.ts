import { routeAgentRequest } from 'agents';
import type { ExecutionContext } from '@cloudflare/workers-types';
import { ChatAgent } from './agent';
import { AuthRegistry } from './registry';
import { handleModelTest } from './lib/model-tester';
import {
  forbidden,
  handleLogin,
  handleLogout,
  handleSession,
  handleSignup,
  injectUserId,
  isAllowedOrigin,
  isProjectOwner,
  authorizeProject,
  unauthorized,
  verifySession,
} from './lib/auth';

export { ChatAgent, AuthRegistry };

const AUTH_ROUTES = new Set(['/api/auth/signup', '/api/auth/login', '/api/auth/logout', '/api/auth/session']);

function corsHeaders(origin: string | null): Record<string, string> {
  // Reflect only an allowlisted origin; never `*`.
  const allowed = origin && isAllowedOrigin(origin) ? origin : 'https://brainhalf.com';
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, content-type, x-bh-csrf',
    'Access-Control-Allow-Credentials': 'true',
    Vary: 'Origin',
  };
}

function withCors(response: Response, origin: string | null): Response {
  const next = new Response(response.body, response);
  for (const [k, v] of Object.entries(corsHeaders(origin))) next.headers.set(k, v);
  return next;
}

/**
 * Content-Security-Policy and friends for the IDE shell itself.
 *
 * The built shell emits no inline scripts (verified against `dist/index.html`), so
 * script-src can be strict: 'self' plus the two CDNs Sandpack's in-browser bundler
 * and Monaco's loader actually fetch from. `unsafe-inline` stays out of script-src
 * on purpose — it is present in style-src only, where the app relies on injected
 * styles and the risk profile is different.
 *
 * connect-src allows the same-origin API/WebSocket surface and the model CDNs the
 * shell talks to; everything else is denied by default-src 'none'.
 */
function shellSecurityHeaders(): Record<string, string> {
  const csp = [
    `default-src 'none'`,
    `script-src 'self' https://cdn.jsdelivr.net https://unpkg.com https://esm.sh`,
    `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net`,
    `img-src 'self' data: https: blob:`,
    `font-src 'self' data: https://fonts.gstatic.com`,
    `connect-src 'self' https: wss:`,
    `worker-src 'self' blob:`,
    `frame-src 'self' blob: https://preview.sandpack-static-server.codesandbox.io https://nodebox-runtime.codesandbox.io`,
    `frame-ancestors 'none'`,
    `form-action 'self'`,
    `base-uri 'self'`,
  ].join('; ');
  return {
    'Content-Security-Policy': csp,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'deny',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  };
}

/** Applies the shell security headers to an ASSETS response without losing its own. */
function withShellSecurity(response: Response): Response {
  const next = new Response(response.body, response);
  for (const [k, v] of Object.entries(shellSecurityHeaders())) next.headers.set(k, v);
  return next;
}

export default {
  async fetch(request: Request, env: any, _ctx: ExecutionContext) {
    const url = new URL(request.url);
    const origin = request.headers.get('origin');

    // Preflight for the API surface.
    if (request.method === 'OPTIONS' && (url.pathname.startsWith('/api/') || url.pathname.startsWith('/agents/'))) {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    /* ------------------------- auth endpoints ------------------------- */
    if (AUTH_ROUTES.has(url.pathname)) {
      let response: Response;
      switch (url.pathname) {
        case '/api/auth/signup':
          response = await handleSignup(request, env);
          break;
        case '/api/auth/login':
          response = await handleLogin(request, env);
          break;
        case '/api/auth/logout':
          response = await handleLogout(request, env);
          break;
        default:
          response = await handleSession(request, env);
          break;
      }
      // Local dev over plain http cannot use Secure cookies; match the scheme.
      if (url.protocol !== 'https:') {
        const setCookie = response.headers.get('Set-Cookie');
        if (setCookie) response.headers.set('Set-Cookie', setCookie.replace('; Secure', ''));
      }
      return withCors(response, origin);
    }

    /* --------- project listing / management (authenticated) --------- */
    if (url.pathname === '/api/projects' && request.method === 'GET') {
      const user = await verifySession(request, env);
      if (!user) return withCors(unauthorized(), origin);
      try {
        const registry = env.REGISTRY.get(env.REGISTRY.idFromName('auth'));
        const res = await registry.fetch(`https://registry/projects?userId=${encodeURIComponent(user.userId)}`);
        const body = await res.text();
        return withCors(new Response(body, { status: res.status, headers: { 'Content-Type': 'application/json' } }), origin);
      } catch (err) {
        console.error('Failed to list projects:', err);
        return withCors(new Response(JSON.stringify({ error: 'Failed to list projects', projects: [] }), { status: 502, headers: { 'Content-Type': 'application/json' } }), origin);
      }
    }

    if (url.pathname.startsWith('/api/projects/') && (request.method === 'DELETE' || request.method === 'PATCH')) {
      const user = await verifySession(request, env);
      if (!user) return withCors(unauthorized(), origin);
      const projectId = decodeURIComponent(url.pathname.slice('/api/projects/'.length));
      const registry = env.REGISTRY.get(env.REGISTRY.idFromName('auth'));
      const target = new URL(`https://registry/projects/${encodeURIComponent(projectId)}`);
      if (request.method === 'DELETE') target.searchParams.set('userId', user.userId);
      const init: RequestInit = { method: request.method, headers: { 'Content-Type': 'application/json' } };
      if (request.method === 'PATCH') {
        const body = await request.json().catch(() => ({}));
        init.body = JSON.stringify({ ...body, userId: user.userId });
      }
      const res = await registry.fetch(target.toString(), init);
      return withCors(new Response(await res.text(), { status: res.status, headers: { 'Content-Type': 'application/json' } }), origin);
    }

    /* --------- performance test APIs: authenticated + allowlisted --------- */
    // Previously callable by anyone with any model id. Now identity is required
    // and the model allowlist is enforced inside handleModelTest.
    if (url.pathname === '/api/test/simple' || url.pathname === '/api/test/medium' || url.pathname === '/api/test/hard') {
      const level = url.pathname === '/api/test/simple' ? 'simple' : url.pathname === '/api/test/medium' ? 'medium' : 'hard';
      const user = await verifySession(request, env);
      if (!user) return withCors(unauthorized('Sign in to run model tests'), origin);
      return withCors(await handleModelTest(request, env, level, { userId: user.userId }), origin);
    }

    /* --------- Dispatch namespace: live user workers (owned) --------- */
    if (url.pathname.startsWith('/p/')) {
      const match = url.pathname.match(/^\/p\/([^/]+)(.*)/);
      if (match && match[1]) {
        const scriptName = match[1];
        const subPath = match[2] || '/';
        const user = await verifySession(request, env);
        if (!user) return withCors(unauthorized(), origin);
        // A deployed user worker is only reachable by the project owner.
        const owns = await isProjectOwner(env, scriptName, user.userId);
        if (!owns) return withCors(forbidden('You do not own this deployment'), origin);

        if (env.DISPATCHER) {
          try {
            const subworker = env.DISPATCHER.get(scriptName);
            const targetUrl = new URL(request.url);
            targetUrl.pathname = subPath;
            const subRequest = new Request(targetUrl.toString(), injectUserId(request, user.userId));
            return await subworker.fetch(subRequest);
          } catch (_dispatchErr: any) {
            // Worker not found in dispatch namespace; fall back to the DO below.
          }
        }

        if (env.ChatAgent) {
          const redirectPath = subPath === '/' || subPath === '' ? '/index.html' : subPath;
          if (request.method === 'GET' && (subPath === '/' || subPath === '')) {
            return Response.redirect(`${url.origin}/preview/${scriptName}${redirectPath}`, 302);
          }

          const targetUrl = new URL(request.url);
          targetUrl.pathname = `/preview/${scriptName}${redirectPath}`;
          const forwardRequest = new Request(targetUrl.toString(), injectUserId(request, user.userId));
          const id = env.ChatAgent.idFromName(scriptName);
          const obj = env.ChatAgent.get(id);
          return obj.fetch(forwardRequest);
        }
      }
    }

    /* --------- Edge preview routes (owned projects only) --------- */
    if (url.pathname.startsWith('/preview/')) {
      const match = url.pathname.match(/^\/preview\/([^/]+)/);
      if (match && match[1]) {
        const agentId = match[1];
        const user = await verifySession(request, env);
        if (!user) return unauthorized('Sign in to view this preview');

        // Preview HTML and assets are owner-only. The generated app's own
        // /api/* calls are proxied below after the same ownership check.
        const owns = await isProjectOwner(env, agentId, user.userId);
        if (!owns) return forbidden('You do not have access to this preview');

        const id = env.ChatAgent.idFromName(agentId);
        const obj = env.ChatAgent.get(id);
        return obj.fetch(injectUserId(request, user.userId));
      }
    }

    // Serve static frontend root assets with strict cache control
    if (env.ASSETS && (url.pathname === '/' || url.pathname === '/index.html')) {
      const response = await env.ASSETS.fetch(request);
      const newHeaders = new Headers(response.headers);
      newHeaders.set('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
      newHeaders.set('Pragma', 'no-cache');
      newHeaders.set('Expires', '0');
      const hardened = new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders
      });
      return withShellSecurity(hardened);
    }

    /* --------- Agent WS + HTTP routes: auth gate + ACL --------- */
    const agentResponse = await routeAgentRequest(request, env, {
      // Runs *before* the request reaches the Durable Object. Deny here, or
      // rewrite the request to carry the verified user id.
      onBeforeConnect: async (req, route) => {
        const user = await verifySession(req, env);
        if (!user) return unauthorized('Sign in to connect');
        const projectId = route.name;
        const owns = await authorizeOrClaim(env, projectId, user.userId, req.url);
        if (!owns) return forbidden('You do not own this project');
        return injectUserId(req, user.userId);
      },
      onBeforeRequest: async (req, route) => {
        const user = await verifySession(req, env);
        if (!user) return unauthorized('Sign in to access this project');
        const projectId = route.name;
        const owns = await authorizeOrClaim(env, projectId, user.userId, req.url);
        if (!owns) return forbidden('You do not own this project');
        return injectUserId(req, user.userId);
      },
    });
    if (agentResponse) {
      // The SDK applies its own CORS handling when configured; we attach ours
      // for same-origin fetches from the browser app.
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
        return withCors(agentResponse, origin);
      }
      return agentResponse;
    }

    // Serve static frontend assets for all other routes
    if (env.ASSETS) {
      return withShellSecurity(await env.ASSETS.fetch(request));
    }

    return new Response('Not found', { status: 404 });
  }
};

/**
 * A project the user is connecting to is *claimed* on first authenticated
 * access, then ownership is enforced for every subsequent request. Returns
 * false when the project belongs to someone else (or the Registry is down —
 * fail closed).
 */
async function authorizeOrClaim(env: any, projectId: string, userId: string, requestUrl: string): Promise<boolean> {
  if (!projectId || !userId) return false;
  let name: string | undefined;
  try {
    name = new URL(requestUrl).searchParams.get('name') || undefined;
  } catch {
    /* ignore */
  }
  return authorizeProject(env, projectId, userId, name);
}
