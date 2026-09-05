import { Context, Next } from 'hono';
import { getAuth } from '../auth';
import type { Env } from '../env';

export async function authMiddleware(c: Context<{ Bindings: Env; Variables: { user: any; session: any } }>, next: Next) {
  const auth = getAuth(c.env);
  const session = await auth.api.getSession({
    headers: c.req.raw.headers,
  });

  if (!session) {
    const path = c.req.path;
    const isPublicAiChat = path === '/chat' || path.endsWith('/chat');
    const isProviderTest = path === '/ai-providers/test' || path.endsWith('/ai-providers/test');
    const isAssetSearch = path === '/search-and-download' || path.endsWith('/search-and-download');

    if (isPublicAiChat || isProviderTest || isAssetSearch) {
      await next();
      return;
    }
    return c.json({ error: 'Unauthorized' }, 401);
  }

  c.set('user', session.user);
  c.set('session', session.session);
  await next();
}
