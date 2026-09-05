import { Hono } from 'hono';
import { eq, desc, and } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import * as schema from '@brainhalf/db/schema';
import type { Env } from '../env';
import { authMiddleware } from '../middleware/auth';

const arcade = new Hono<{ Bindings: Env; Variables: { user: any } }>();

arcade.get('/games', async (c) => {
  const db = drizzle(c.env.DB);
  const url = new URL(c.req.url);
  const page = parseInt(url.searchParams.get('page') || '1');
  const limit = parseInt(url.searchParams.get('limit') || '20');
  const offset = (page - 1) * limit;
  const filterType = url.searchParams.get('type'); 

  let conditions = [eq(schema.projects.isPublished, true)];
  if (filterType) conditions.push(eq(schema.projects.gameType, filterType as any));

  const games = await db
    .select({
      id: schema.projects.id,
      title: schema.projects.title,
      description: schema.projects.description,
      gameType: schema.projects.gameType,
      thumbnailUrl: schema.projects.thumbnailUrl,
      playCount: schema.projects.playCount,
      likeCount: schema.projects.likeCount,
      username: schema.users.username,
    })
    .from(schema.projects)
    .innerJoin(schema.users, eq(schema.projects.userId, schema.users.id))
    .where(and(...conditions))
    .orderBy(desc(schema.projects.createdAt))
    .limit(limit)
    .offset(offset);

  return c.json({ games });
});

arcade.get('/games/:id', async (c) => {
  const db = drizzle(c.env.DB);
  const id = c.req.param('id');
  const [game] = await db
    .select({
      id: schema.projects.id,
      title: schema.projects.title,
      description: schema.projects.description,
      gameType: schema.projects.gameType,
      engine: schema.projects.engine,
      thumbnailUrl: schema.projects.thumbnailUrl,
      playCount: schema.projects.playCount,
      likeCount: schema.projects.likeCount,
      username: schema.users.username,
      userId: schema.projects.userId,
    })
    .from(schema.projects)
    .innerJoin(schema.users, eq(schema.projects.userId, schema.users.id))
    .where(and(eq(schema.projects.id, id), eq(schema.projects.isPublished, true)));
  if (!game) return c.json({ error: 'Not found' }, 404);
  return c.json(game);
});

arcade.post('/games/:id/play', async (c) => {
  const id = c.req.param('id');
  const ip = c.req.header('cf-connecting-ip') || 'unknown';
  const hour = Math.floor(Date.now() / (1000 * 60 * 60));
  const dedupeKey = `play:ip:${ip}:${id}:${hour}`;

  if (c.env.KV) {
    const already = await c.env.KV.get(dedupeKey);
    if (already) return c.json({ success: true, deduplicated: true });
    await c.env.KV.put(dedupeKey, '1', { expirationTtl: 3600 });
  }

  const sql = `UPDATE projects SET play_count = play_count + 1 WHERE id = ? AND is_published = 1`;
  await c.env.DB.prepare(sql).bind(id).run();
  return c.json({ success: true });
});

arcade.post('/games/:id/like', authMiddleware, async (c) => {
  const id = c.req.param('id');
  const user = c.get('user');
  // Deduplicate: one like per user per game
  const dedupeKey = `like:${user.id}:${id}`;
  if (c.env.KV) {
    const already = await c.env.KV.get(dedupeKey);
    if (already) return c.json({ success: true, deduplicated: true });
    await c.env.KV.put(dedupeKey, '1', { expirationTtl: 60 * 60 * 24 * 365 });
  }
  const sql = `UPDATE projects SET like_count = like_count + 1 WHERE id = ? AND is_published = 1`;
  await c.env.DB.prepare(sql).bind(id).run();
  return c.json({ success: true });
});

arcade.get('/trending', async (c) => {
  const db = drizzle(c.env.DB);
  const games = await db
    .select({
      id: schema.projects.id,
      title: schema.projects.title,
      thumbnailUrl: schema.projects.thumbnailUrl,
      playCount: schema.projects.playCount,
      username: schema.users.username,
    })
    .from(schema.projects)
    .innerJoin(schema.users, eq(schema.projects.userId, schema.users.id))
    .where(eq(schema.projects.isPublished, true))
    .orderBy(desc(schema.projects.playCount))
    .limit(10);

  return c.json({ games });
});

export default arcade;
