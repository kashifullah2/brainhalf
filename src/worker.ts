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

/** Paths whose preflight must be answered by this Worker. */
const CORS_PREFIXES = ['/api/', '/agents/', '/preview/', '/p/'];

/* ------------------------------------------------------------------ *
 * Rate limiting
 *
 * The model-test endpoints call an LLM on every request. They were
 * authenticated but unmetered, so one signed-in account could drive
 * unbounded inference spend with a loop. This is a small fixed-window
 * counter held in the isolate; it is not a distributed limiter (an
 * attacker spread across colos gets a higher effective ceiling), but it
 * removes the trivial single-client abuse case with no added latency.
 * For a hard guarantee, move this into the AuthRegistry Durable Object
 * or Cloudflare's Rate Limiting binding.
 * ------------------------------------------------------------------ */
interface RateWindow { count: number; resetAt: number; }
const RATE_BUCKETS = new Map<string, RateWindow>();
const RATE_LIMITS: Record<string, { limit: number; windowMs: number }> = {
  modelTest: { limit: 20, windowMs: 60_000 },
  auth: { limit: 10, windowMs: 60_000 },
};

function checkRateLimit(bucket: keyof typeof RATE_LIMITS, key: string): { ok: boolean; retryAfter: number } {
  const { limit, windowMs } = RATE_LIMITS[bucket];
  const now = Date.now();
  const mapKey = `${bucket}:${key}`;
  const existing = RATE_BUCKETS.get(mapKey);

  if (!existing || existing.resetAt <= now) {
    RATE_BUCKETS.set(mapKey, { count: 1, resetAt: now + windowMs });
    // Opportunistic sweep so the map cannot grow without bound in a
    // long-lived isolate.
    if (RATE_BUCKETS.size > 5000) {
      for (const [k, v] of RATE_BUCKETS) if (v.resetAt <= now) RATE_BUCKETS.delete(k);
    }
    return { ok: true, retryAfter: 0 };
  }

  existing.count++;
  if (existing.count > limit) {
    return { ok: false, retryAfter: Math.ceil((existing.resetAt - now) / 1000) };
  }
  return { ok: true, retryAfter: 0 };
}

function tooManyRequests(retryAfter: number): Response {
  return new Response(JSON.stringify({ error: 'Too many requests. Slow down and try again shortly.' }), {
    status: 429,
    headers: { 'Content-Type': 'application/json', 'Retry-After': String(retryAfter) },
  });
}

/** Best-effort client identity for rate limiting before a session is known. */
function clientKey(request: Request): string {
  return request.headers.get('cf-connecting-ip')
    || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || 'unknown';
}

function corsHeaders(origin: string | null): Record<string, string> {
  // Reflect only an allowlisted origin; never `*`.
  const allowed = origin && isAllowedOrigin(origin) ? origin : 'https://brainhalf.com';
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, content-type, x-bh-csrf',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function withCors(response: Response, origin: string | null): Response {
  const next = new Response(response.body, response);
  for (const [k, v] of Object.entries(corsHeaders(origin))) next.headers.set(k, v);
  return next;
}

/** A JSON error, so an API caller never has to parse an HTML page. */
function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Content-Security-Policy and friends for the IDE shell itself.
 *
 * The built shell emits no inline scripts (verified against `dist/index.html`), so
 * script-src can be strict: 'self' plus the CDNs Sandpack's in-browser bundler and
 * Monaco's loader actually fetch from. `unsafe-inline` stays out of script-src on
 * purpose — it is present in style-src only, where the app relies on injected
 * styles and the risk profile is different.
 */
function shellSecurityHeaders(): Record<string, string> {
  const csp = [
    `default-src 'none'`,
    `script-src 'self' 'unsafe-eval' https://cdn.jsdelivr.net https://unpkg.com https://esm.sh https://static.cloudflareinsights.com`,
    `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net`,
    `img-src 'self' data: https: blob:`,
    `font-src 'self' data: https://fonts.gstatic.com`,
    `connect-src 'self' https: wss: https://cloudflareinsights.com`,
    `worker-src 'self' blob:`,
    `frame-src 'self' blob: https://*.codesandbox.io https://preview.sandpack-static-server.codesandbox.io https://nodebox-runtime.codesandbox.io`,
    `manifest-src 'self'`,
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
    // The shell is an authenticated app; never let a shared cache hold it.
    'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0',
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

    // FIX: preflight was answered only for /api/ and /agents/. A cross-origin
    // preflight for /preview/ or /p/ fell through to the static asset handler
    // and returned HTML, so the real request was never sent.
    if (request.method === 'OPTIONS' && CORS_PREFIXES.some(p => url.pathname.startsWith(p))) {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    /* ------------------------- auth endpoints ------------------------- */
    if (AUTH_ROUTES.has(url.pathname)) {
      // Login and signup are the classic credential-stuffing targets and were
      // completely unmetered. Session and logout are cheap, so only the two
      // write paths are limited.
      if (url.pathname === '/api/auth/login' || url.pathname === '/api/auth/signup') {
        const rate = checkRateLimit('auth', clientKey(request));
        if (!rate.ok) return withCors(tooManyRequests(rate.retryAfter), origin);
      }

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
        return withCors(jsonError('Failed to list projects', 502), origin);
      }
    }

    if (url.pathname.startsWith('/api/projects/') && (request.method === 'DELETE' || request.method === 'PATCH')) {
      const user = await verifySession(request, env);
      if (!user) return withCors(unauthorized(), origin);

      const projectId = decodeURIComponent(url.pathname.slice('/api/projects/'.length));
      if (!projectId || projectId.includes('/')) {
        return withCors(jsonError('Invalid project id', 400), origin);
      }

      // FIX: ownership was delegated entirely to the Registry via a userId
      // query parameter for DELETE, and for PATCH by merging userId into the
      // body — where a client-supplied `userId` field in that same body could
      // override it, since `...body` was spread first. Ownership is now checked
      // here, before the call, and the client body can no longer carry a userId.
      const owns = await isProjectOwner(env, projectId, user.userId);
      if (!owns) return withCors(forbidden('You do not own this project'), origin);

      const registry = env.REGISTRY.get(env.REGISTRY.idFromName('auth'));
      const target = new URL(`https://registry/projects/${encodeURIComponent(projectId)}`);
      const init: RequestInit = { method: request.method, headers: { 'Content-Type': 'application/json' } };

      if (request.method === 'DELETE') {
        target.searchParams.set('userId', user.userId);
      } else {
        const body = await request.json().catch(() => ({} as any));
        const { userId: _ignored, ...safeBody } = (body || {}) as Record<string, unknown>;
        init.body = JSON.stringify({ ...safeBody, userId: user.userId });
      }

      try {
        const res = await registry.fetch(target.toString(), init);
        return withCors(new Response(await res.text(), { status: res.status, headers: { 'Content-Type': 'application/json' } }), origin);
      } catch (err) {
        console.error('Registry call failed:', err);
        return withCors(jsonError('Project service unavailable', 502), origin);
      }
    }

    /* --------- performance test APIs: authenticated + limited --------- */
    // Previously callable by anyone with any model id. Identity is required,
    // the model allowlist is enforced inside handleModelTest, and the endpoint
    // is now rate limited per user because each call costs inference.
    if (url.pathname === '/api/test/simple' || url.pathname === '/api/test/medium' || url.pathname === '/api/test/hard') {
      const level = url.pathname === '/api/test/simple' ? 'simple' : url.pathname === '/api/test/medium' ? 'medium' : 'hard';
      const user = await verifySession(request, env);
      if (!user) return withCors(unauthorized('Sign in to run model tests'), origin);

      const rate = checkRateLimit('modelTest', user.userId);
      if (!rate.ok) return withCors(tooManyRequests(rate.retryAfter), origin);

      try {
        return withCors(await handleModelTest(request, env, level, { userId: user.userId }), origin);
      } catch (err: any) {
        console.error('Model test failed:', err);
        return withCors(jsonError(err?.message || 'Model test failed', 500), origin);
      }
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
          } catch (dispatchErr: any) {
            // Worker not found in the dispatch namespace; fall back to the DO.
            console.warn(`Dispatch miss for ${scriptName}:`, dispatchErr?.message || dispatchErr);
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

        return jsonError('Deployment not found', 404);
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
        // /api/* calls are proxied through the same ownership check.
        const owns = await authorizeOrClaim(env, agentId, user.userId, request.url);
        if (!owns) return forbidden('You do not have access to this preview');

        const id = env.ChatAgent.idFromName(agentId);
        const obj = env.ChatAgent.get(id);
        return obj.fetch(injectUserId(request, user.userId));
      }
    }

    /* --------- Agent WS + HTTP routes: auth gate + ACL --------- */
    const agentResponse = await routeAgentRequest(request, env, {
      // Runs *before* the request reaches the Durable Object. Deny here, or
      // rewrite the request to carry the verified user id.
      onBeforeConnect: async (req, route) => {
        const user = await verifySession(req, env);
        if (!user) return unauthorized('Sign in to connect');
        const owns = await authorizeOrClaim(env, route.name, user.userId, req.url);
        if (!owns) return forbidden('You do not own this project');
        return injectUserId(req, user.userId);
      },
      onBeforeRequest: async (req, route) => {
        const user = await verifySession(req, env);
        if (!user) return unauthorized('Sign in to access this project');
        const owns = await authorizeOrClaim(env, route.name, user.userId, req.url);
        if (!owns) return forbidden('You do not own this project');
        return injectUserId(req, user.userId);
      },
    });
    if (agentResponse) {
      // The SDK applies its own CORS handling when configured; we attach ours
      // for same-origin fetches from the browser app. A WebSocket upgrade
      // response must be returned untouched — copying it into a new Response
      // drops the socket.
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
        return withCors(agentResponse, origin);
      }
      return agentResponse;
    }

    /* --------- Unmatched API / agent routes --------- */
    if (url.pathname.startsWith('/api/')) {
      const referer = request.headers.get('Referer') || '';
      const previewMatch = referer.match(/\/preview\/([^/?#]+)/);
      if (previewMatch && previewMatch[1] && env.ChatAgent) {
        const agentId = previewMatch[1];
        const user = await verifySession(request, env);
        if (user) {
          const owns = await authorizeOrClaim(env, agentId, user.userId, request.url);
          if (owns) {
            const id = env.ChatAgent.idFromName(agentId);
            const obj = env.ChatAgent.get(id);
            const targetUrl = new URL(request.url);
            targetUrl.pathname = `/preview/${agentId}${url.pathname}`;
            return obj.fetch(new Request(targetUrl.toString(), injectUserId(request, user.userId)));
          }
        }
      }
    }

    // FIX: an unmatched /api/ or /agents/ path used to fall through to
    // env.ASSETS and return the SPA's index.html with status 200. Any client
    // doing res.json() on a typo'd or removed endpoint got a JSON parse error
    // instead of a 404, which is a genuinely hard bug to trace from the
    // browser. API namespaces now 404 as JSON.
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/agents/')) {
      return withCors(jsonError(`No route for ${request.method} ${url.pathname}`, 404), origin);
    }

    if (env.ASSETS) {
      // withShellSecurity sets no-store caching, so the previous special case
      // for '/' and '/index.html' is no longer needed — every shell response
      // gets the same headers through one path.
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
    /* a malformed URL just means no display name */
  }
  try {
    return await authorizeProject(env, projectId, userId, name);
  } catch (err) {
    // Fail closed: a Registry outage must not become an authorization bypass.
    console.error('authorizeProject failed; denying access:', err);
    return false;
  }
}