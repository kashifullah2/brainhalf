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
  extractWsTicket,
  issueWsTicket,
  json,
  unauthorized,
  verifySession,
  verifyWsTicket,
  USER_ID_QUERY_PARAM,
} from './lib/auth';
import { RateLimiter } from './lib/rate-limit';

export { ChatAgent, AuthRegistry };

const AUTH_ROUTES = new Set([
  '/api/auth/signup',
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/session',
  '/api/auth/ws-ticket',
]);

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
const RATE_LIMITS = new RateLimiter({
  modelTest: { limit: 20, windowMs: 60_000 },
  auth: { limit: 10, windowMs: 60_000 },
});

function checkRateLimit(bucket: 'modelTest' | 'auth', key: string): { ok: boolean; retryAfter: number } {
  return RATE_LIMITS.check(bucket, key);
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
    // No custom request headers are defined. A header once advertised here
    // (x-bh-csrf) was never read or validated anywhere — a phantom control that
    // implied a defense that did not exist. State-changing routes are protected
    // by the Bearer token (not browser-attachable cross-site) plus the
    // SameSite=Lax session cookie, which Lax policy keeps off cross-site POSTs
    // and WebSocket handshakes; advertising a header here would not change that.
    'Access-Control-Allow-Headers': 'authorization, content-type',
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
 * script-src can be strict: 'self' plus the CDNs Monaco's loader actually fetches
 * from. `unsafe-inline` stays out of script-src on purpose — it is present in
 * style-src only, where the app relies on injected styles and the risk profile is
 * different.
 *
 * `unsafe-eval` is a hard requirement, not a TODO. The preview engine
 * (PreviewRunner.tsx) transpiles user files with sucrase and executes them
 * through `new Function` in a same-origin iframe; that is the product's core
 * feature, not leftover dev tooling. Removing it means replacing the in-browser
 * module loader with a Worker-side bundler. Until that happens, script-src must
 * keep 'unsafe-eval' or the preview stops running anything.
 *
 * The preview iframe is same-origin (`/preview/<id>/index.html`), so frame-src
 * only ever needs 'self'. The codesandbox origins previously listed here were
 * for a Sandpack engine toggle that never actually rendered anything.
 *
 * Note on `run_worker_first`: assets are served from [assets] without invoking
 * this Worker, so `public/_headers` -- not this function -- is what ships in
 * production. src/__tests__/headers-drift.test.ts makes the two drifting fail
 * the build, which is a cheaper and equivalent guarantee than paying for a
 * Worker invocation on every static asset.
 */
export function shellSecurityHeaders(): Record<string, string> {
  const csp = [
    `default-src 'none'`,
    `script-src 'self' 'unsafe-eval' https://cdn.jsdelivr.net https://unpkg.com https://esm.sh https://static.cloudflareinsights.com`,
    `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net`,
    `img-src 'self' data: https: blob:`,
    `font-src 'self' data: https://fonts.gstatic.com`,
    // connect-src is deliberately not `https:`. Nothing in the shell makes a
    // cross-origin request (every fetch and the agent WebSocket are same-origin;
    // apiBase() resolves to window.location.origin in production), so a blanket
    // scheme would only hand an XSS an exfiltration channel to any host. The
    // insights beacon is the one exception.
    `connect-src 'self' https://cloudflareinsights.com`,
    `worker-src 'self' blob:`,
    `frame-src 'self'`,
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
    // The session cookie is Secure, but nothing here tells a browser to never
    // attempt plain HTTP — a first-visit downgrade or an open redirect could
    // otherwise serve the shell (and a looser policy from an intermediary)
    // before the user ever reaches HTTPS.
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
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

    // Strip any client-supplied _uid param that would bypass our auth gate.
    // The Worker re-injects it after verification; a client cannot forge it.
    if (url.searchParams.has(USER_ID_QUERY_PARAM)) {
      url.searchParams.delete(USER_ID_QUERY_PARAM);
      request = new Request(url.toString(), request);
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
        case '/api/auth/ws-ticket': {
          // The handshake needs a credential that fits in a URL. Issue one that
          // is single-use and short-lived; the client never sees a long-lived
          // token in a WebSocket URL again.
          const user = await verifySession(request, env);
          if (!user) {
            response = unauthorized('Sign in to request a connection ticket');
            break;
          }
          const ticket = await issueWsTicket(env, user.userId);
          response = ticket
            ? json(200, { ticket })
            : jsonError('Could not issue a connection ticket', 503);
          break;
        }
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
        if (res.ok && request.method === 'DELETE') {
          // The registry tombstones the ownership row, but the Durable Object and
          // its R2 backup still hold the project's files. The tombstone makes the
          // id unreachable, so this is erasure rather than access control — and
          // it is best-effort: a failed delete here only leaves orphaned storage,
          // not an exposed project.
          try {
            const doId = env.ChatAgent.idFromName(projectId);
            await Promise.allSettled([
              env.PROJECT_BACKUPS?.delete(`backup-${doId}`),
              env.PROJECT_BACKUPS?.delete(`backup-${doId}.json`),
              env.PROJECT_BACKUPS?.delete(`backup-${projectId}`),
              env.PROJECT_BACKUPS?.delete(`backup-${projectId}.json`),
            ]);
          } catch (backupErr) {
            console.error('Failed to delete project backup:', backupErr);
          }
        }
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
        // A provider error can carry account, endpoint or request detail that
        // belongs in logs, not in the browser.
        return withCors(jsonError('Model test failed. See server logs for detail.', 500), origin);
      }
    }

    /* --------- Dispatch namespace: live user workers (owned) --------- */
    if (url.pathname.startsWith('/p/')) {
      const match = url.pathname.match(/^\/p\/([^/]+)(.*)/);
      if (match && match[1]) {
        const scriptName = match[1];
        const subPath = match[2] || '/';
        const user = await verifySession(request, env);
        // Mutating operations require ownership; viewing web apps is public
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          if (!user || !(await isProjectOwner(env, scriptName, user.userId))) {
            return withCors(forbidden('You do not own this deployment'), origin);
          }
        }

        if (env.DISPATCHER) {
          try {
            const subworker = env.DISPATCHER.get(scriptName);
            const targetUrl = new URL(request.url);
            targetUrl.pathname = subPath;
            const effectiveUserId = user?.userId || 'public-preview-viewer';
            const subRequest = new Request(targetUrl.toString(), injectUserId(request, effectiveUserId));
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
          const effectiveUserId = user?.userId || 'public-preview-viewer';
          const forwardRequest = new Request(targetUrl.toString(), injectUserId(request, effectiveUserId));
          const id = env.ChatAgent.idFromName(scriptName);
          const obj = env.ChatAgent.get(id);
          return obj.fetch(forwardRequest);
        }

        return jsonError('Deployment not found', 404);
      }
    }

    /* --------- Edge preview routes (authenticated read / public showcase; write-guarded mutations) --------- */
    if (url.pathname.startsWith('/preview/')) {
      const match = url.pathname.match(/^\/preview\/([^/]+)/);
      if (match && match[1]) {
        const agentId = match[1];
        const isShowcase = isPublicProject(agentId);
        const user = await verifySession(request, env);
        if (!user && !isShowcase) return unauthorized('Sign in to view this preview');

        // Mutating operations (e.g. /api/sync) always require genuine ownership
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          if (!user || !(await isProjectOwner(env, agentId, user.userId))) {
            return forbidden('You do not have permission to modify this preview');
          }
        } else {
          // If an authenticated user views an unclaimed project, claim it for them.
          // Viewing previews never fails with 403: any authenticated user (and public visitors) can view.
          if (user) {
            await authorizeOrClaim(env, agentId, user.userId, request.url).catch(() => false);
          }
        }

        const id = env.ChatAgent.idFromName(agentId);
        const obj = env.ChatAgent.get(id);
        const effectiveUserId = user ? user.userId : 'public-preview-viewer';
        return obj.fetch(injectUserId(request, effectiveUserId));
      }
    }

    /* --------- Agent WS + HTTP routes: auth gate + ACL --------- */
    const agentResponse = await routeAgentRequest(request, env, {
      // Runs *before* the request reaches the Durable Object. Deny here, or
      // rewrite the request to carry the verified user id.
      onBeforeConnect: async (req, route) => {
        // The upgrade URL is the only place a browser can carry credentials for
        // a WebSocket. A single-use ticket keeps the 30-day session token out of
        // URLs — and therefore out of logs and sampled traces. The `?token=`
        // path stays as a fallback so a client predating the ticket still
        // connects; both resolve to a user id before any ownership check.
        const ticket = extractWsTicket(req);
        let userId = ticket ? await verifyWsTicket(env, ticket) : null;
        if (!userId) {
          userId = (await verifySession(req, env))?.userId ?? null;
        }
        if (!userId) return unauthorized('Sign in to connect');
        const claim = await authorizeOrClaim(env, route.name, userId, req.url);
        if (!claim.ok) {
          console.warn(`[DEBUG] authorizeOrClaim failed for ${route.name}. Status: ${claim.status}`);
          if (claim.status === 409) return injectUserId(req, 'QUOTA_EXCEEDED');
          return injectUserId(req, 'FORBIDDEN');
        }
        console.warn(`[DEBUG] authorizeOrClaim succeeded for ${route.name}. Injecting userId: ${userId}`);
        return injectUserId(req, userId);
      },
      onBeforeRequest: async (req, route) => {
        const user = await verifySession(req, env);
        if (!user) return unauthorized('Sign in to access this project');
        const claim = await authorizeOrClaim(env, route.name, user.userId, req.url);
        if (!claim.ok) return forbidden('You do not own this project');
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
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          if (!user || !(await isProjectOwner(env, agentId, user.userId))) {
            return withCors(forbidden('You do not have permission to modify this preview'), origin);
          }
        }
        const id = env.ChatAgent.idFromName(agentId);
        const obj = env.ChatAgent.get(id);
        const targetUrl = new URL(request.url);
        targetUrl.pathname = `/preview/${agentId}${url.pathname}`;
        const effectiveUserId = user ? user.userId : 'public-preview-viewer';
        return obj.fetch(new Request(targetUrl.toString(), injectUserId(request, effectiveUserId)));
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
 * Public showcase projects, template previews, and diagnostic benchmark suites
 * are publicly readable so users, guests, and evaluators can preview them without
 * encountering 403/401 lockouts. Modifying project files still requires owner authentication.
 */
export function isPublicProject(projectId: string): boolean {
  if (!projectId) return false;
  return (
    projectId === 'all-models-studio' ||
    projectId === 'default' ||
    projectId.startsWith('test-model-') ||
    projectId.startsWith('showcase-') ||
    projectId.startsWith('demo-') ||
    projectId.startsWith('public-') ||
    projectId.startsWith('template-')
  );
}

/**
 * A project the user is connecting to is *claimed* on first authenticated
 * access, then ownership is enforced for every subsequent request. Returns
 * false when the project belongs to someone else (or the Registry is down —
 * fail closed).
 */
async function authorizeOrClaim(env: any, projectId: string, userId: string, requestUrl: string): Promise<{ ok: boolean; status: number }> {
  if (!projectId || !userId) return { ok: false, status: 400 };
  let name: string | undefined;
  try {
    name = new URL(requestUrl).searchParams.get('name') || undefined;
  } catch {
    /* a malformed URL just means no display name */
  }
  try {
    const result = await authorizeProject(env, projectId, userId, name);
    console.warn(`[DEBUG] authorizeProject returned: ${JSON.stringify(result)}`);
    return result;
  } catch (err) {
    // Fail closed: a Registry outage must not become an authorization bypass.
    console.error('authorizeProject failed; denying access:', err);
    return { ok: false, status: 500 };
  }
}