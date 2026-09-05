import { Hono } from 'hono';
import { eq, and } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import * as schema from '@brainhalf/db/schema';
import type { Env } from '../env';

const games = new Hono<{ Bindings: Env }>();

/** Serve published game HTML for arcade iframe player */
games.get('/render/:id', async (c) => {
  const db = drizzle(c.env.DB);
  const id = c.req.param('id');

  const [project] = await db
    .select()
    .from(schema.projects)
    .where(and(eq(schema.projects.id, id), eq(schema.projects.isPublished, true)));

  if (!project) {
    return c.html('<html><body><p>Game not found</p></body></html>', 404);
  }

  const files = await db
    .select()
    .from(schema.projectFiles)
    .where(eq(schema.projectFiles.projectId, id));

  const indexFile = files.find(f => f.filePath === 'index.html' || f.filePath.endsWith('/index.html'))
    ?? files.find(f => f.fileType?.includes('html'))
    ?? files[0];

  const html = indexFile?.fileContent?.trim();
  if (!html) {
    return c.html(
      '<html><body style="font-family:sans-serif;background:#111;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh"><p>This game has no playable content yet.</p></body></html>',
      404
    );
  }

  return c.html(html, 200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': "default-src 'self' 'unsafe-inline' 'unsafe-eval' blob: data:; img-src * data: blob:; media-src * data: blob:; connect-src *;",
    'X-Frame-Options': 'SAMEORIGIN',
  });
});

export default games;
