import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import * as schema from '@brainhalf/db/schema';
import type { Env } from '../env';
import { authMiddleware } from '../middleware/auth';
async function ensureAppUser(
  db: ReturnType<typeof drizzle>,
  authUser: { id: string; email: string; name?: string | null; image?: string | null }
) {
  const [existing] = await db.select().from(schema.users).where(eq(schema.users.id, authUser.id));
  if (existing) return existing;

  const baseUsername = authUser.email
    .split('@')[0]
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase();
  const username = `${baseUsername}_${Math.random().toString(36).substring(2, 6)}`;

  const [created] = await db.insert(schema.users).values({
    id: authUser.id,
    email: authUser.email,
    username,
    displayName: authUser.name || baseUsername,
    avatarUrl: authUser.image || null,
    plan: 'free',
    creditsRemaining: 100,
    totalGamesCreated: 0,
    totalPlaysReceived: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  }).returning();

  return created;
}

const users = new Hono<{ Bindings: Env; Variables: { user: any } }>();

users.use('*', authMiddleware);

users.get('/me', async (c) => {
  const db = drizzle(c.env.DB);
  const authUser = c.get('user');

  const user = await ensureAppUser(db, authUser);
  return c.json(user);
});

users.patch('/me', async (c) => {
  const db = drizzle(c.env.DB);
  const authUser = c.get('user');
  const body = await c.req.json();

  const allowedFields: Record<string, any> = {};
  const whitelist = ['displayName', 'username', 'bio', 'avatarUrl'] as const;
  for (const key of whitelist) {
    if (key in body) allowedFields[key] = body[key];
  }

  const [updated] = await db
    .update(schema.users)
    .set({
      ...allowedFields,
      updatedAt: new Date(),
    })
    .where(eq(schema.users.id, authUser.id))
    .returning();

  if (!updated) {
    return c.json({ error: 'User not found' }, 404);
  }

  return c.json(updated);
});

export default users;
