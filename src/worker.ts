import { isPrivateSearch } from './seo/metadata';
import { routeAgentRequest } from 'agents';
import { handleGoogleAuth } from './lib/google-auth';
import { handleManagedGoogle } from './lib/managed-providers';
export { ManagedProviders } from './lib/managed-providers';
import { handleEmailRequest } from './lib/email';
import type { Ai, ExecutionContext } from '@cloudflare/workers-types';
import { ChatAgent } from './agent';
import { AuthRegistry } from './registry';
import { handleModelTest } from './lib/model-tester';
import {
  authUnavailable,
  forbidden,
  handleLogin,
  handleLogout,
  handleSession,
  injectUserId,
  isAllowedOrigin,
  isProjectOwner,
  authorizeProject,
  extractWsTicket,
  issueWsTicket,
  json,
  unauthorized,
  verifySession,
  verifyPreviewSession,
  redeemWsIdentity,
  extractToken,
  USER_ID_QUERY_PARAM,
} from './lib/auth';
import { sha256Hex } from './lib/crypto';
import { aiBudgetEndpoint } from './lib/ai-budget';
import { createTenantRequest } from './lib/tenant-request';
import { checkPreviewAccess, isPublicPreviewRead, PREVIEW_ACCESS_HEADER } from './lib/project-access';
import { validSessionSecret } from './lib/runtime-config';
import { isolatedPreviewHtml, previewFiles, previewSecurityHeaders } from './lib/preview-isolation';
import type { BindingFetcher, DispatchBinding, DurableBinding } from './lib/bindings';

export { ChatAgent, AuthRegistry };

/** Bindings declared in wrangler.toml. The index signature covers plain vars. */
export interface PlatformEnv {
  ChatAgent: DurableBinding;
  REGISTRY: DurableBinding;
  ASSETS: BindingFetcher;
  DISPATCHER: DispatchBinding;
  RUNTIME: BindingFetcher;
  AI: Ai;
  CONTACT_EMAIL?: string;
  PRODUCT_METRICS_OWNER_IDS?: string;
  [key: string]: unknown;
}

const AUTH_ROUTES = new Set([
  '/api/auth/signup',
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/session',
  '/api/auth/ws-ticket',
  '/api/auth/google/start',
  '/api/auth/google/callback',
  '/api/auth/google/complete',
  '/api/auth/forgot-password',
  '/api/auth/reset-password',
  '/api/auth/resend-verification',
  '/api/auth/verify-email',
  '/api/contact',
]);

/** Paths whose preflight must be answered by this Worker. */
const CORS_PREFIXES = ['/api/', '/agents/', '/preview/', '/p/'];

const RATE_LIMIT_CONFIG = {
  modelTest: { limit: 20, windowMs: 60_000 },
  auth: { limit: 10, windowMs: 60_000 },
  // Preview reads are per IP+project: a single page load costs ~2 requests
  // (HTML + file snapshot), so 120/min leaves generous headroom for reload
  // loops while still stopping scrape/refresh abuse. Writes are tighter.
  previewRead: { limit: 120, windowMs: 60_000 },
  previewWrite: { limit: 30, windowMs: 60_000 },
} as const;

async function checkRateLimit(
  env: PlatformEnv,
  bucket: keyof typeof RATE_LIMIT_CONFIG,
  key: string
): Promise<{ ok: boolean; retryAfter: number; unavailable?: boolean }> {
  try {
    const registry = env.REGISTRY.get(env.REGISTRY.idFromName('auth'));
    const config = RATE_LIMIT_CONFIG[bucket];
    const response = await registry.fetch('https://registry/rate-limit/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bucket, key, limit: config.limit, windowMs: config.windowMs }),
    });
    if (!response.ok) return { ok: false, retryAfter: 30, unavailable: true };
    const body = await response.json() as { ok?: boolean; retryAfter?: number };
    if (typeof body?.ok !== 'boolean') return { ok: false, retryAfter: 30, unavailable: true };
    return {
      ok: body.ok === true,
      retryAfter: typeof body.retryAfter === 'number' && Number.isFinite(body.retryAfter)
        ? Math.max(0, Math.ceil(body.retryAfter))
        : 0,
    };
  } catch (err) {
    console.warn('Rate-limit check failed:', err);
    return { ok: false, retryAfter: 30, unavailable: true };
  }
}

function tooManyRequests(retryAfter: number): Response {
  return new Response(JSON.stringify({ error: 'Too many requests. Slow down and try again shortly.' }), {
    status: 429,
    headers: { 'Content-Type': 'application/json', 'Retry-After': String(retryAfter) },
  });
}

/**
 * Rate limit for preview traffic. Unlike auth/modelTest, previews fail OPEN
 * when the limiter itself is unavailable — rate limiting is abuse protection,
 * not a reason to take every preview offline during a registry hiccup.
 */
async function checkPreviewRateLimit(env: PlatformEnv, request: Request, agentId: string): Promise<Response | null> {
  const isWrite = !['GET', 'HEAD', 'OPTIONS'].includes(request.method);
  const rate = await checkRateLimit(env, isWrite ? 'previewWrite' : 'previewRead', `${clientKey(request)}:${agentId}`);
  if (rate.ok) return null;
  if (rate.unavailable) {
    console.warn(`Preview rate-limit service unavailable; allowing ${request.method} for project ${agentId}`);
    return null;
  }
  return tooManyRequests(rate.retryAfter);
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
  next.headers.set('Cache-Control', 'no-store');
  for (const [k, v] of Object.entries(corsHeaders(origin))) next.headers.set(k, v);
  next.headers.set('X-Robots-Tag', 'noindex, nofollow');
  return next;
}

/** A JSON error, so an API caller never has to parse an HTML page. */
function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function withPreviewPrivacy(response: Response): Response {
  const next = new Response(response.body, response);
  for (const name of ['Set-Cookie', 'Clear-Site-Data', 'Refresh', 'Access-Control-Allow-Credentials', 'X-Frame-Options']) next.headers.delete(name);
  for (const [name, value] of Object.entries(previewSecurityHeaders())) next.headers.set(name, value);
  return next;
}

function previewRequest(request: Request, userId: string | undefined, owner: boolean): Request {
  const forwarded = injectUserId(request, userId || 'public-preview-viewer');
  forwarded.headers.set(PREVIEW_ACCESS_HEADER, owner ? 'owner' : 'public');
  return forwarded;
}

function previewDenied(status: number): Response {
  return withPreviewPrivacy(jsonError(status === 503 ? 'Project service unavailable' : 'Project unavailable or access denied', status));
}

/**
 * Content-Security-Policy and friends for the IDE shell itself.
 *
 * The built shell emits no executable inline scripts (verified against `dist/index.html`), so
 * script-src can be strict: 'self' plus the CDNs Monaco's loader actually fetches
 * from. `unsafe-inline` stays out of script-src on purpose — it is present in
 * style-src only, where the app relies on injected styles and the risk profile is
 * different.
 *
 * Note on `run_worker_first`: most public pages and assets are served from [assets]
 * without invoking this Worker. The root shell runs through the Worker to set
 * request-specific indexing headers. Keep `public/_headers` and this function
 * aligned for both delivery paths. src/__tests__/headers-drift.test.ts makes the two drifting fail
 * the build, which is a cheaper and equivalent guarantee than paying for a
 * Worker invocation on every static asset.
 */
export function shellSecurityHeaders(): Record<string, string> {
  const csp = [
    `default-src 'none'`,
    `script-src 'self' 'unsafe-eval' data: blob: https://cdn.jsdelivr.net https://unpkg.com https://esm.sh https://static.cloudflareinsights.com https://www.googletagmanager.com https://pagead2.googlesyndication.com https://www.googletagservices.com https://securepubads.g.doubleclick.net https://tpc.googlesyndication.com https://*.adtrafficquality.google`,
    `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net`,
    `img-src 'self' data: https: blob:`,
    `font-src 'self' data: https://fonts.gstatic.com`,
    `connect-src 'self' https://cloudflareinsights.com https://api.github.com https://cdn.jsdelivr.net https://www.googletagmanager.com https://*.google-analytics.com https://*.google.com https://pagead2.googlesyndication.com https://googleads.g.doubleclick.net https://*.googlesyndication.com https://*.adtrafficquality.google`,
    `worker-src 'self' blob:`,
    `frame-src 'self' https://*.apps.brainhalf.com https://googleads.g.doubleclick.net https://tpc.googlesyndication.com https://www.google.com https://securepubads.g.doubleclick.net`,
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
function withShellSecurity(response: Response, privateSearch = false): Response {
  const next = new Response(response.body, response);
  for (const [k, v] of Object.entries(shellSecurityHeaders())) next.headers.set(k, v);
  if (next.status >= 400 || privateSearch) next.headers.set('X-Robots-Tag', 'noindex, nofollow');
  return next;
}

export default {
  async fetch(request: Request, env: PlatformEnv, _ctx: ExecutionContext) {
    const url = new URL(request.url);
    // Canonical host consolidation: Google indexed www.brainhalf.com as a
    // duplicate of the apex (splitting ranking signals across hosts), so the
    // www host permanently redirects before any other handling.
    if (url.hostname === 'www.brainhalf.com') {
      url.hostname = 'brainhalf.com';
      return Response.redirect(url.toString(), 301);
    }
    // Sign-in is a modal on the landing page, never a route. The URL picked up
    // indexed impressions anyway (navigational "brainhalf sign in" queries), so
    // redirect it to the homepage instead of leaving a soft 404 in the index.
    if (url.pathname === '/sign-in' || url.pathname === '/login') {
      return Response.redirect(`${url.origin}/`, 301);
    }
    const privateSearch = isPrivateSearch(url.search);
    const origin = request.headers.get('origin');
    const untrustedOrigin = (origin !== null && !isAllowedOrigin(origin)) || request.headers.get('sec-fetch-site') === 'cross-site';
    const googleCallback = url.pathname === '/api/auth/google/callback' && request.method === 'GET';
    const managedGoogleStart = url.pathname === '/api/apps/google/start' && request.method === 'GET';
    if ((url.pathname.startsWith('/api/') || url.pathname.startsWith('/agents/')) && untrustedOrigin && !googleCallback && !managedGoogleStart) {
      return withCors(forbidden('Untrusted request origin'), origin);
    }
    if (url.pathname === '/preview-rules.json' && ['GET', 'HEAD'].includes(request.method)) {
      return new Response(request.method === 'HEAD' ? null : '{}', { headers: {
        'Content-Type': 'application/speculationrules+json', 'Access-Control-Allow-Origin': '*',
        'Cross-Origin-Resource-Policy': 'cross-origin', 'Cache-Control': 'public, max-age=86400',
        'X-Content-Type-Options': 'nosniff',
      } });
    }
    if (url.pathname === '/preview-runtime.js') {
      const asset = await env.ASSETS.fetch(request);
      if (!asset.ok) {
        return new Response('console.error("[BrainHalf] Preview runtime asset missing from deployment. Redeploy to fix.");', {
          status: 503,
          headers: { 'Content-Type': 'application/javascript', 'Access-Control-Allow-Origin': '*', 'Retry-After': '30' },
        });
      }
      return new Response(asset.body, { status: 200, headers: {
        'Content-Type': 'application/javascript', 'Access-Control-Allow-Origin': '*',
        'Cross-Origin-Resource-Policy': 'cross-origin', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff',
      } });
    }
    if (request.headers.has(PREVIEW_ACCESS_HEADER)) {
      request = new Request(request);
      request.headers.delete(PREVIEW_ACCESS_HEADER);
    }

    // FIX: preflight was answered only for /api/ and /agents/. A cross-origin
    // preflight for /preview/ or /p/ fell through to the static asset handler
    // and returned HTML, so the real request was never sent.
    if (request.method === 'OPTIONS' && CORS_PREFIXES.some(p => url.pathname.startsWith(p))) {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (CORS_PREFIXES.some(prefix => url.pathname.startsWith(prefix)) && !validSessionSecret(env?.SESSION_SECRET)) {
      return withCors(authUnavailable(), origin);
    }

    // Strip any client-supplied _uid param that would bypass our auth gate.
    // The Worker re-injects it after verification; a client cannot forge it.
    if (url.searchParams.has(USER_ID_QUERY_PARAM)) {
      url.searchParams.delete(USER_ID_QUERY_PARAM);
      request = new Request(url.toString(), request);
    }

    /* ------------------------- auth endpoints ------------------------- */
    if (managedGoogleStart || (googleCallback && url.searchParams.get('state')?.startsWith('mg_'))) {
      return handleManagedGoogle(request, env);
    }
    if (AUTH_ROUTES.has(url.pathname)) {
      const method = url.pathname === '/api/auth/session' || url.pathname === '/api/auth/google/callback' ? 'GET' : 'POST';
      if (request.method !== method) {
        const response = jsonError('Method not allowed', 405);
        response.headers.set('Allow', method);
        return withCors(response, origin);
      }
      // Login and signup are the classic credential-stuffing targets and were
      // completely unmetered. Session and logout are cheap, so only the two
      // write paths are limited.
      if (request.method === 'POST' && url.pathname !== '/api/auth/session' && url.pathname !== '/api/auth/ws-ticket') {
        const rate = await checkRateLimit(env, 'auth', clientKey(request));
        if (!rate.ok) return withCors(rate.unavailable ? jsonError('Rate-limit service unavailable. Please retry shortly.', 503) : tooManyRequests(rate.retryAfter), origin);
      }

      let response: Response;
      switch (url.pathname) {
        case '/api/auth/google/start':
        case '/api/auth/google/callback':
        case '/api/auth/google/complete':
          response = await handleGoogleAuth(request, env);
          break;
        case '/api/auth/signup':
        case '/api/auth/forgot-password':
        case '/api/auth/reset-password':
        case '/api/auth/resend-verification':
        case '/api/auth/verify-email':
        case '/api/contact':
          response = await handleEmailRequest(request, env);
          break;
        case '/api/auth/login':
          try { response = await handleLogin(request, env); }
          catch { response = authUnavailable(); }
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
          const ticket = await issueWsTicket(env, user.userId, await sha256Hex(extractToken(request)!));
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
        const cookies = response.headers.getSetCookie();
        response.headers.delete('Set-Cookie');
        for (const value of cookies) response.headers.append('Set-Cookie', value.replace('; Secure', ''));
      }
      return withCors(response, origin);
    }

    if ((url.pathname === '/api/account/outcomes' || url.pathname === '/api/admin/outcomes') && request.method === 'GET') {
      const user = await verifySession(request, env);
      if (!user) return withCors(unauthorized(), origin);
      const admin = url.pathname === '/api/admin/outcomes';
      if (admin && !String(env.PRODUCT_METRICS_OWNER_IDS || '').split(',').map((id: string) => id.trim()).includes(user.userId)) return withCors(forbidden(), origin);
      try {
        const response = await env.REGISTRY.get(env.REGISTRY.idFromName('auth')).fetch('https://registry/outcomes' + (admin ? '' : '?userId=' + encodeURIComponent(user.userId)));
        const headers = new Headers(response.headers); headers.set('Cache-Control', 'no-store');
        return withCors(new Response(response.body, { status: response.status, headers }), origin);
      } catch { return withCors(jsonError('Outcome metrics unavailable', 503), origin); }
    }

    // Owner-only account list. The registry route returns compact public-safe
    // rows (no credentials); this gate adds session + operator allowlist auth.
    if (url.pathname === '/api/admin/users' && request.method === 'GET') {
      const user = await verifySession(request, env);
      if (!user) return withCors(unauthorized(), origin);
      if (!String(env.PRODUCT_METRICS_OWNER_IDS || '').split(',').map((id: string) => id.trim()).includes(user.userId)) return withCors(forbidden(), origin);
      try {
        const response = await env.REGISTRY.get(env.REGISTRY.idFromName('auth')).fetch('https://registry/admin/users');
        const headers = new Headers(response.headers); headers.set('Cache-Control', 'no-store');
        return withCors(new Response(response.body, { status: response.status, headers }), origin);
      } catch { return withCors(jsonError('User list unavailable', 503), origin); }
    }

    if (url.pathname === '/api/account/ai-usage' && request.method === 'GET') {
      const user = await verifySession(request, env);
      if (!user) return withCors(unauthorized(), origin);
      try { return withCors(await aiBudgetEndpoint(env, user.userId).fetch(new Request('https://registry/ai/usage')), origin); }
      catch { return withCors(jsonError('AI allowance unavailable', 503), origin); }
    }
    if (url.pathname === '/api/account/deletions' && request.method === 'GET') {
      const user = await verifySession(request, env);
      if (!user) return withCors(unauthorized(), origin);
      try { return withCors(await env.REGISTRY.get(env.REGISTRY.idFromName('auth')).fetch(`https://registry/projects/deletions?userId=${encodeURIComponent(user.userId)}`), origin); }
      catch { return withCors(jsonError('Cleanup status unavailable', 503), origin); }
    }
    /* --------- project listing / management (authenticated) --------- */
    const stopMatch = url.pathname.match(/^\/api\/projects\/([A-Za-z0-9_-]+)\/stop$/);
    if (stopMatch && request.method === 'POST') {
      const user = await verifySession(request, env);
      if (!user) return withCors(unauthorized(), origin);
      if (!await isProjectOwner(env, stopMatch[1], user.userId)) return withCors(forbidden('You do not own this project'), origin);
      try {
        const agent = env.ChatAgent.get(env.ChatAgent.idFromName(stopMatch[1]));
        const [stopped, runtime] = await Promise.allSettled([
          agent.fetch(injectUserId(new Request('https://agent/internal/stop', { method: 'POST' }), user.userId)),
          env.RUNTIME ? env.RUNTIME.fetch(new Request('https://runtime/stop', { method: 'POST', headers: { 'x-bh-project': stopMatch[1], 'x-bh-owner': user.userId } })) : Promise.resolve(null),
        ]);
        if (runtime.status === 'rejected' || (runtime.value && !runtime.value.ok)) return withCors(jsonError('Runtime termination could not be confirmed.', 502), origin);
        if (stopped.status === 'rejected') throw stopped.reason;
        return withCors(stopped.value, origin);
      } catch { return withCors(jsonError('Could not confirm shutdown. Keep this page open and retry.', 503), origin); }
    }
    const runtimeMatch = url.pathname.match(/^\/api\/projects\/([A-Za-z0-9_-]+)\/runtime(\/.*)$/);
    if (runtimeMatch) {
      const user = await verifySession(request, env);
      if (!user) return withCors(unauthorized(), origin);
      if (!await isProjectOwner(env, runtimeMatch[1], user.userId)) return withCors(forbidden('You do not own this project'), origin);
      if (!env.RUNTIME) return withCors(jsonError('The full-stack runtime has not been deployed yet.', 503), origin);
      const target = new URL(request.url); target.pathname = runtimeMatch[2];
      const headers = new Headers({ 'Content-Type': 'application/json', 'x-bh-project': runtimeMatch[1], 'x-bh-owner': user.userId });
      if (runtimeMatch[2] === '/email-test' && env.CONTACT_EMAIL) headers.set('x-bh-test-inbox', env.CONTACT_EMAIL);
      try {
        const response = await env.RUNTIME.fetch(new Request(target, { method: request.method, headers, body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body, redirect: 'manual' }));
        const safe = new Response(response.body, response); safe.headers.set('Cache-Control', 'no-store');
        return withCors(safe, origin);
      } catch { return withCors(jsonError('Project runtime unavailable. Try again shortly.', 503), origin); }
    }
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

    // Public gallery listing — no session; the registry only returns showcased apps.
    if (url.pathname === '/api/gallery' && request.method === 'GET') {
      try {
        const response = await env.REGISTRY.get(env.REGISTRY.idFromName('auth')).fetch('https://registry/gallery');
        const listing = new Response(response.body, response);
        listing.headers.set('Cache-Control', 'public, max-age=60');
        return withCors(listing, origin);
      } catch { return withCors(jsonError('The gallery is temporarily unavailable', 502), origin); }
    }

    const showcaseMatch = url.pathname.match(/^\/api\/projects\/([A-Za-z0-9_-]+)\/showcase$/);
    if (showcaseMatch) {
      if (request.method !== 'GET' && request.method !== 'PUT') return withCors(jsonError('Method not allowed', 405), origin);
      const user = await verifySession(request, env);
      if (!user) return withCors(unauthorized(), origin);
      const query = new URLSearchParams({ projectId: showcaseMatch[1], userId: user.userId });
      try {
        const response = await env.REGISTRY.get(env.REGISTRY.idFromName('auth')).fetch(`https://registry/projects/showcase?${query}`, {
          method: request.method,
          headers: { 'Content-Type': 'application/json' },
          body: request.method === 'PUT' ? JSON.stringify(await request.json()) : undefined,
        });
        return withCors(response, origin);
      } catch (error) {
        if (error instanceof SyntaxError) return withCors(jsonError('Invalid JSON', 400), origin);
        return withCors(jsonError('Showcase update failed', 502), origin);
      }
    }

    // Remix a gallery app: the registry creates the caller's project and counts
    // the remix, then the source agent's public files are copied into it.
    const remixMatch = url.pathname.match(/^\/api\/projects\/([A-Za-z0-9_-]+)\/remix$/);
    if (remixMatch && request.method === 'POST') {
      const user = await verifySession(request, env);
      if (!user) return withCors(unauthorized(), origin);
      const sourceId = remixMatch[1];
      try {
        const registry = env.REGISTRY.get(env.REGISTRY.idFromName('auth'));
        const created = await registry.fetch('https://registry/projects/remix', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: user.userId, sourceProjectId: sourceId }),
        });
        if (!created.ok) return withCors(created, origin);
        const { projectId, name } = await created.json() as { projectId: string; name: string };
        const exportResponse = await env.ChatAgent.get(env.ChatAgent.idFromName(sourceId))
          .fetch(new Request('https://agent/internal/remix-export', { headers: { 'x-bh-project': sourceId } }));
        if (!exportResponse.ok) throw new Error(`Remix export failed: ${exportResponse.status}`);
        const imported = await env.ChatAgent.get(env.ChatAgent.idFromName(projectId))
          .fetch(injectUserId(new Request('https://agent/internal/remix-import', {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'x-bh-project': projectId }, body: await exportResponse.text(),
          }), user.userId));
        if (!imported.ok) {
          // Best-effort cleanup so a failed copy never leaves a broken project behind.
          await registry.fetch(`https://registry/projects/${encodeURIComponent(projectId)}?userId=${encodeURIComponent(user.userId)}`, { method: 'DELETE' }).catch(() => {});
          throw new Error(`Remix import failed: ${imported.status}`);
        }
        return withCors(Response.json({ projectId, name }), origin);
      } catch (error) {
        console.error('Remix failed:', error);
        return withCors(jsonError('Remix could not be completed. Please try again.', 502), origin);
      }
    }

    const publicationMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/publication$/);
    if (publicationMatch) {
      if (request.method !== 'GET' && request.method !== 'PUT') return withCors(jsonError('Method not allowed', 405), origin);
      const user = await verifySession(request, env);
      if (!user) return withCors(unauthorized(), origin);
      const query = new URLSearchParams({ projectId: publicationMatch[1], userId: user.userId });
      try {
        const registry = env.REGISTRY.get(env.REGISTRY.idFromName('auth'));
        const response = await registry.fetch(`https://registry/projects/publication?${query}`, {
          method: request.method,
          headers: { 'Content-Type': 'application/json' },
          body: request.method === 'PUT' ? JSON.stringify(await request.json()) : undefined,
        });
        return withCors(withPreviewPrivacy(response), origin);
      } catch (error) {
        if (error instanceof SyntaxError) return withCors(jsonError('Invalid JSON', 400), origin);
        return withCors(previewDenied(503), origin);
      }
    }

    if (url.pathname.startsWith('/api/projects/') && (request.method === 'DELETE' || request.method === 'PATCH')) {
      const user = await verifySession(request, env);
      if (!user) return withCors(unauthorized(), origin);

      let projectId: string;
      try { projectId = decodeURIComponent(url.pathname.slice('/api/projects/'.length)); }
      catch { return withCors(jsonError('Invalid project id', 400), origin); }
      if (!projectId || projectId.includes('/')) {
        return withCors(jsonError('Invalid project id', 400), origin);
      }

      if (request.method === 'PATCH' && !await isProjectOwner(env, projectId, user.userId)) {
        return withCors(forbidden('You do not own this project'), origin);
      }


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

      const rate = await checkRateLimit(env, 'modelTest', user.userId);
      if (!rate.ok) return withCors(rate.unavailable ? jsonError('Rate-limit service unavailable. No model test was started.', 503) : tooManyRequests(rate.retryAfter), origin);

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
        const user = untrustedOrigin ? null : await verifyPreviewSession(request, env);
        const access = await checkPreviewAccess(env, scriptName, user?.userId, request.method, subPath, 'deployment');
        if (!access.ok) return withCors(previewDenied(access.status), origin);
        const limited = await checkPreviewRateLimit(env, request, scriptName);
        if (limited) return withCors(limited, origin);

        if (env.DISPATCHER) {
          try {
            const subworker = env.DISPATCHER.get(scriptName);
            const subRequest = createTenantRequest(request, subPath);
            return withPreviewPrivacy(await subworker.fetch(subRequest));
          } catch (dispatchErr: any) {
            // Worker not found in the dispatch namespace; fall back to the DO.
            console.warn(`Dispatch miss for ${scriptName}:`, dispatchErr?.message || dispatchErr);
          }
        }

        if (env.ChatAgent) {
          if (!access.owner && !isPublicPreviewRead(subPath)) return withCors(previewDenied(user ? 403 : 401), origin);
          const redirectPath = subPath === '/' || subPath === '' ? '/index.html' : subPath;
          if ((request.method === 'GET' || request.method === 'HEAD') && (subPath === '/' || subPath === '' || subPath === '/index.html')) {
            return withPreviewPrivacy(Response.redirect(`${url.origin}/preview/${scriptName}${redirectPath}`, 302));
          }

          const targetUrl = new URL(request.url);
          targetUrl.pathname = `/preview/${scriptName}${redirectPath}`;
          const forwardRequest = new Request(targetUrl.toString(), previewRequest(request, user?.userId, access.owner));
          const id = env.ChatAgent.idFromName(scriptName);
          const obj = env.ChatAgent.get(id);
          return withPreviewPrivacy(await obj.fetch(forwardRequest));
        }

        return jsonError('Deployment not found', 404);
      }
    }

    /* --------- Edge preview routes (authenticated read / public showcase; write-guarded mutations) --------- */
    if (url.pathname.startsWith('/preview/')) {
      const match = url.pathname.match(/^\/preview\/([^/]+)/);
      if (match && match[1]) {
        const agentId = match[1];
        const user = untrustedOrigin ? null : await verifyPreviewSession(request, env);
        const subPath = url.pathname.slice(match[0].length) || '/';
        const access = await checkPreviewAccess(env, agentId, user?.userId, request.method, subPath);
        if (!access.ok) return withCors(previewDenied(access.status), origin);
        const limited = await checkPreviewRateLimit(env, request, agentId);
        if (limited) return withCors(limited, origin);

        const id = env.ChatAgent.idFromName(agentId);
        const obj = env.ChatAgent.get(id);
        if ((request.method === 'GET' || request.method === 'HEAD') && ['/', '/index.html'].includes(subPath)) {
          const snapshotUrl = new URL(request.url);
          snapshotUrl.pathname = `/preview/${agentId}/api/files`;
          const snapshot = await obj.fetch(previewRequest(new Request(snapshotUrl, { headers: request.headers }), user?.userId, true));
          if (!snapshot.ok) return withPreviewPrivacy(jsonError('Preview files unavailable', 502));
          const files = await snapshot.json().catch(() => null);
          if (!files || typeof files !== 'object' || Array.isArray(files)) return withPreviewPrivacy(jsonError('Invalid preview snapshot', 502));
          return withPreviewPrivacy(new Response(request.method === 'HEAD' ? null : isolatedPreviewHtml(agentId, previewFiles(files, access.owner)), { headers: { 'Content-Type': 'text/html; charset=utf-8' } }));
        }
        return withPreviewPrivacy(await obj.fetch(previewRequest(request, user?.userId, access.owner)));
      }
    }

    /* --------- Agent WS + HTTP routes: auth gate + ACL --------- */
    const agentResponse = await routeAgentRequest(request, env, {
      // Runs *before* the request reaches the Durable Object. Deny here, or
      // rewrite the request to carry the verified user id.
      onBeforeConnect: async (req, route) => {
        // The upgrade URL is the only place a browser can carry credentials for
        // a WebSocket. A single-use ticket keeps the 30-day session token out of
        // URLs — and therefore out of logs and sampled traces. Without a ticket,
        // only the session cookie (or an Authorization header) authenticates;
        // `?token=` is stripped here so the long-lived token can never ride in
        // a URL, even from an outdated or tampered client.
        const ticket = extractWsTicket(req);
        const identity = ticket ? await redeemWsIdentity(env, ticket) : null;
        let userId = identity?.userId ?? null;
        let sessionHash = identity?.sessionHash ?? null;
        if (!userId) {
          const sanitizedUrl = new URL(req.url);
          sanitizedUrl.searchParams.delete('token');
          const sanitized = new Request(sanitizedUrl.toString(), req);
          userId = (await verifySession(sanitized, env))?.userId ?? null;
          if (userId) sessionHash = await sha256Hex(extractToken(sanitized)!);
        }
        if (!userId || !sessionHash || !/^[a-f0-9]{64}$/.test(sessionHash)) return unauthorized('Sign in to connect');
        const claim = await authorizeOrClaim(env, route.name, userId, req.url);
        if (!claim.ok) {
          if (claim.status === 409) return injectUserId(req, 'QUOTA_EXCEEDED');
          return injectUserId(req, 'FORBIDDEN');
        }
        return injectUserId(req, userId, sessionHash);
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
        return withCors(withPreviewPrivacy(agentResponse), origin);
      }
      return agentResponse;
    }

    /* --------- Unmatched API / agent routes --------- */
    if (url.pathname.startsWith('/api/')) {
      let previewMatch: RegExpMatchArray | null = null;
      try {
        const referer = new URL(request.headers.get('Referer') || '');
        if (referer.origin === url.origin) previewMatch = referer.pathname.match(/^\/(?:preview|p)\/([^/]+)(?:\/|$)/);
      } catch {}
      if (previewMatch && previewMatch[1] && env.ChatAgent) {
        const agentId = previewMatch[1];
        const user = await verifyPreviewSession(request, env);
        const access = await checkPreviewAccess(env, agentId, user?.userId, request.method, url.pathname);
        if (!access.ok) return withCors(previewDenied(access.status), origin);
        const limited = await checkPreviewRateLimit(env, request, agentId);
        if (limited) return withCors(limited, origin);
        const id = env.ChatAgent.idFromName(agentId);
        const obj = env.ChatAgent.get(id);
        const targetUrl = new URL(request.url);
        targetUrl.pathname = `/preview/${agentId}${url.pathname}`;
        return withPreviewPrivacy(await obj.fetch(new Request(targetUrl.toString(), previewRequest(request, user?.userId, access.owner))));
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
      // Fetch the root asset: html_handling canonicalizes /index.html to /,
      // which would otherwise redirect a dashboard reload back to the landing page.
      const shellPaths = ['/dashboard', '/admin'];
      const assetRequest = shellPaths.includes(url.pathname) ? new Request(new URL('/', url), request) : request;
      return withShellSecurity(await env.ASSETS.fetch(assetRequest), privateSearch || shellPaths.includes(url.pathname));
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
async function authorizeOrClaim(env: PlatformEnv, projectId: string, userId: string, requestUrl: string): Promise<{ ok: boolean; status: number }> {
  if (!projectId || !userId) return { ok: false, status: 400 };
  let name: string | undefined;
  let idempotencyKey: string | undefined;
  try {
    name = new URL(requestUrl).searchParams.get('name') || undefined;
    idempotencyKey = new URL(requestUrl).searchParams.get('idempotencyKey') || undefined;
  } catch {
    /* a malformed URL just means no display name */
  }
  try {
    return await authorizeProject(env, projectId, userId, name, idempotencyKey);
  } catch (err) {
    // Fail closed: a Registry outage must not become an authorization bypass.
    console.error('authorizeProject failed; denying access:', err);
    return { ok: false, status: 500 };
  }
}
