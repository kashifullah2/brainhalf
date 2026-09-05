import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import type { Env } from './env';
import { rateLimitMiddleware } from './middleware/rate-limit';
import { getAuth } from './auth';

import projects from './routes/projects';
import arcade from './routes/arcade';
import assets from './routes/assets';
import settings from './routes/settings';
import ai from './routes/ai';
import users from './routes/users';
import games from './routes/games';

import { createAllTables, isDatabaseReady } from './db/migrate';

const app = new Hono<{ Bindings: Env }>();

let migrationPromise: Promise<void> | null = null;

async function ensureDatabase(env: Env): Promise<void> {
  if (!migrationPromise) {
    migrationPromise = (async () => {
      const ready = await isDatabaseReady(env.DB);
      if (!ready) {
        console.log('[db] Running migrations (local D1 was empty)…');
        await createAllTables(env.DB);
        console.log('[db] Migrations complete.');
      }
    })().catch((err) => {
      migrationPromise = null;
      throw err;
    });
  }
  return migrationPromise;
}

app.use('*', async (c, next) => {
  await ensureDatabase(c.env);
  await next();
});

app.use('*', logger());

const ALLOWED_ORIGINS = new Set([
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:5174',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5174',
  'https://brainhalf.com',
  'https://www.brainhalf.com',
  'https://studio.brainhalf.com',
  'https://api.brainhalf.com',
]);

function isAllowedOrigin(origin: string): boolean {
  if (ALLOWED_ORIGINS.has(origin)) return true;
  if (/^https:\/\/[a-z0-9-]+\.brainhalf\.pages\.dev$/.test(origin)) return true;
  if (/^https:\/\/[a-z0-9-]+\.brainhalf-(web|studio|api)\.pages\.dev$/.test(origin)) return true;
  return false;
}

app.use('*', cors({
  origin: (origin) => (origin && isAllowedOrigin(origin) ? origin : 'https://brainhalf.com'),
  credentials: true,
}));

app.use('*', rateLimitMiddleware);

app.onError((err, c) => {
  console.error(`${err}`);
  return c.json({ error: err.message || 'Internal Server Error' }, 500);
});

app.all('/api/auth/*', async (c) => {
  try {
    const auth = getAuth(c.env);
    return auth.handler(c.req.raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Auth initialization failed';
    console.error('[auth] handler failed:', err);
    return c.json(
      {
        error: message.includes('BETTER_AUTH_SECRET')
          ? 'Auth is misconfigured on the server (missing BETTER_AUTH_SECRET).'
          : 'Authentication service temporarily unavailable.',
      },
      500,
    );
  }
});

app.route('/api/projects', projects);
app.route('/api/arcade', arcade);
app.route('/api/assets', assets);
app.route('/api/settings', settings);
app.route('/api/ai', ai);
app.route('/api/users', users);
app.route('/api/games', games);

/** Manual migration trigger (safe to re-run — uses IF NOT EXISTS) */
app.post('/api/migrate', async (c) => {
  try {
    await createAllTables(c.env.DB);
    return c.json({ ok: true, message: 'All tables created or already exist.' });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Migration failed';
    return c.json({ ok: false, error: message }, 500);
  }
});

export default {
  fetch: app.fetch,
  // Some Cloudflare environments attach a Queue consumer trigger to this Worker.
  // Provide a no-op handler so deploys never fail when that trigger exists.
  async queue() {
    // Intentionally no-op.
  },
};
