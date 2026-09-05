import { Hono } from 'hono';
import { eq, and } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import * as schema from '@brainhalf/db/schema';
import type { Env } from '../env';
import { authMiddleware } from '../middleware/auth';
import { ulid } from 'ulidx';
import { searchAndDownloadAsset } from '@brainhalf/ai/asset-search';
import type { AssetSearchRequest } from '@brainhalf/ai/asset-search';
import { isLocalDevOrigin } from '../lib/dev-origin';

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

const assets = new Hono<{ Bindings: Env; Variables: { user: any } }>();

/** Search free asset libraries and return downloaded bytes (base64). Works without sign-in on localhost. */
assets.post('/search-and-download', async (c) => {
  const requestOrigin = c.req.header('Origin') || c.req.header('Referer') || '';
  const authUrl = c.env.BETTER_AUTH_URL || '';
  const isLocalDev =
    isLocalDevOrigin(requestOrigin) ||
    authUrl.includes('localhost') ||
    authUrl.includes('127.0.0.1');

  const auth = c.req.header('Authorization');
  const hasSession = Boolean(c.req.header('Cookie')?.includes('session'));
  if (!isLocalDev && !hasSession && !auth) {
    return c.json({ error: 'Sign in to fetch assets, or use localhost dev.' }, 401);
  }

  let body: AssetSearchRequest;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  if (!body.query?.trim()) {
    return c.json({ error: 'query is required' }, 400);
  }

  const result = await searchAndDownloadAsset(body, {
    polyPizzaApiKey: c.env.POLY_PIZZA_API_KEY,
    huggingFaceApiKey: c.env.HUGGINGFACE_API_KEY,
  });

  if (!result.success) {
    // Returning 200 keeps the client flow simple: the studio can decide whether
    // to fall back to procedural generation, without treating "no results" as a
    // missing route / transport failure.
    return c.json({ success: false, error: result.error, title: result.title });
  }

  const dataBase64 = bytesToBase64(result.data);

  return c.json({
    success: true,
    source: result.source,
    title: result.title,
    localPath: result.localPath,
    contentType: result.contentType,
    dataBase64,
    usageHint: result.usageHint,
  });
});

assets.use('*', authMiddleware);

assets.get('/', async (c) => {
  const db = drizzle(c.env.DB);
  const user = c.get('user');
  
  const results = await db
    .select()
    .from(schema.assetLibrary)
    .where(eq(schema.assetLibrary.userId, user.id));

  return c.json({ assets: results });
});

assets.post('/upload', async (c) => {
  const db = drizzle(c.env.DB);
  const user = c.get('user');
  
  const formData = await c.req.formData();
  const fileEntry = formData.get('file');

  if (!fileEntry || typeof fileEntry === 'string') {
    return c.json({ error: 'No file provided' }, 400);
  }

  const file = fileEntry as File;
  const filename = file.name || `asset_${ulid()}`;
  const objectKey = `${user.id}/${ulid()}-${filename}`;
  const publicUrl = `https://assets.brainhalf.com/${objectKey}`;

  // Upload to R2
  if (c.env.ASSETS_BUCKET) {
    await c.env.ASSETS_BUCKET.put(objectKey, await file.arrayBuffer(), {
      httpMetadata: { contentType: file.type }
    });
  }

  const [asset] = await db.insert(schema.assetLibrary).values({
    id: ulid(),
    userId: user.id,
    name: filename,
    assetType: file.type.startsWith('image/')
      ? 'texture'
      : file.type.startsWith('audio/')
        ? 'sound'
        : 'model',
    fileUrl: publicUrl,
    fileSize: file.size,
    isPublic: false,
    createdAt: new Date(),
  }).returning();

  return c.json({ asset });
});

assets.delete('/:id', async (c) => {
  const db = drizzle(c.env.DB);
  const user = c.get('user');
  const id = c.req.param('id');

  const [deleted] = await db.delete(schema.assetLibrary)
    .where(and(eq(schema.assetLibrary.id, id), eq(schema.assetLibrary.userId, user.id)))
    .returning();

  if (!deleted) return c.json({ error: 'Not found' }, 404);
  
  return c.json({ success: true });
});

export default assets;
