import type { BrainHalfServices } from './brainhalf';
interface Env extends BrainHalfServices { DB: D1Database; BRAINHALF_MANAGED?: string }
const json = (body: unknown, status = 200) => Response.json(body, { status });
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/api/health') return json({ ok: true, runtime: 'workers', database: !!env.DB });
    // The BrainHalf dispatcher removes client identity headers and injects a verified app session.
    // Standalone exports must supply their own authentication before enabling private routes.
    const userId = env.BRAINHALF_MANAGED === 'true' ? request.headers.get('x-bh-user-id') : null;
    if (!userId) return json({ error: 'Sign in to use this feature.' }, 401);
    if (request.method !== 'GET' && request.headers.get('Origin') !== url.origin) return json({ error: 'Untrusted origin' }, 403);
    if (url.pathname === '/api/items' && request.method === 'GET') {
      const result = await env.DB.prepare('SELECT id,title,created_at AS createdAt FROM items WHERE user_id=? ORDER BY created_at DESC LIMIT 100').bind(userId).all();
      return json({ items: result.results });
    }
    if (url.pathname === '/api/items' && request.method === 'POST') {
      const reader = request.body?.getReader(); let text = ''; const decoder = new TextDecoder();
      if (!reader) return json({ error: 'Body required' }, 400);
      let size = 0;
      while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > 4096) { await reader.cancel(); return json({ error: 'Request too large' }, 413); } text += decoder.decode(part.value, { stream: true }); }
      let body: { title?: unknown }; try { body = JSON.parse(text + decoder.decode()); } catch { return json({ error: 'Invalid JSON' }, 400); }
      if (!body || typeof body.title !== 'string' || !body.title.trim() || body.title.length > 200) return json({ error: 'Title must have 1 to 200 characters.' }, 400);
      const item = { id: crypto.randomUUID(), title: body.title.trim(), createdAt: Date.now() };
      await env.DB.prepare('INSERT INTO items(id,user_id,title,created_at) VALUES (?,?,?,?)').bind(item.id, userId, item.title, item.createdAt).run();
      return json({ item }, 201);
    }
    const match = url.pathname.match(/^\/api\/items\/([a-zA-Z0-9-]+)$/);
    if (match && request.method === 'DELETE') {
      const result = await env.DB.prepare('DELETE FROM items WHERE id=? AND user_id=?').bind(match[1], userId).run();
      return result.meta.changes ? json({ ok: true }) : json({ error: 'Item not found' }, 404);
    }
    return json({ error: 'Route not found' }, 404);
  }
};
