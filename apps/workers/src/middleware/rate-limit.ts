import { Context, Next } from 'hono';
import type { Env } from '../env';
import { isLocalDevOrigin } from '../lib/dev-origin';

export async function rateLimitMiddleware(c: Context<{ Bindings: Env; Variables: { user?: any } }>, next: Next) {
  const path = new URL(c.req.url).pathname;
  if (path.startsWith('/api/auth')) {
    return next();
  }
  if (
    c.req.method === 'GET' &&
    (path.startsWith('/api/arcade') || path.startsWith('/api/games/render'))
  ) {
    return next();
  }
  if (c.req.method === 'POST' && /^\/api\/arcade\/games\/[^/]+\/play$/.test(path)) {
    return next();
  }

  // Local dev: wrangler has no cf-connecting-ip, so every request shares one
  // "unknown" bucket and the agent loop (many /api/ai/chat turns) hits 429 fast.
  const requestOrigin = c.req.header('Origin') || c.req.header('Referer') || '';
  const authUrl = c.env.BETTER_AUTH_URL || '';
  if (
    isLocalDevOrigin(requestOrigin) ||
    authUrl.includes('localhost') ||
    authUrl.includes('127.0.0.1')
  ) {
    return next();
  }

  const ip = c.req.header('cf-connecting-ip') || 'unknown';
  const user = c.get('user');
  
  let limit = 100; // unauthenticated (requests per hour)
  let identifier = `rate_limit:ip:${ip}`;

  if (user) {
    identifier = `rate_limit:user:${user.id}`;
    if (user.plan === 'pro' || user.plan === 'studio') {
      limit = 10000;
    } else {
      limit = 1000;
    }
  }

  const currentWindow = Math.floor(Date.now() / (1000 * 60 * 60)); // 1 hour window
  const key = `${identifier}:${currentWindow}`;
  
  // Try to use KV if bound, otherwise bypass for local dev without KV
  if (!c.env.KV) {
    return next();
  }

  const currentRequests = Number(await c.env.KV.get(key)) || 0;
  
  if (currentRequests >= limit) {
    return c.json({ error: 'Rate limit exceeded' }, 429);
  }

  c.executionCtx.waitUntil(
    c.env.KV.put(key, (currentRequests + 1).toString(), { expirationTtl: 3600 })
  );

  await next();
}
