import { Hono } from 'hono';
import { eq, and } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import * as schema from '@brainhalf/db/schema';
import type { Env } from '../env';
import { authMiddleware } from '../middleware/auth';
import { ulid } from 'ulidx';
import { encryptApiKey } from '../lib/crypto';

const settings = new Hono<{ Bindings: Env; Variables: { user: any } }>();

settings.post('/ai-providers/test', async (c) => {
  const body = await c.req.json();
  const { provider, apiKey, baseUrl } = body;

  if (!apiKey) return c.json({ error: 'API Key is required' }, 400);

  try {
    let url = baseUrl;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };

    if (provider === 'Cerebras') {
      url = baseUrl || 'https://api.cerebras.ai/v1/models';
    } else if (provider === 'AgentRouter') {
      url = baseUrl || 'https://agentrouter.org/v1/models';
    } else if (provider === 'OpenProvider') {
      url = baseUrl || 'https://openprovider.mimika.in/v1/models';
    } else if (provider === 'FreeModel') {
      url = baseUrl || 'https://cc.freemodel.dev/v1/models';
    } else if (provider === 'Groq') {
      url = baseUrl || 'https://api.groq.com/openai/v1/models';
    } else if (provider === 'Gemini') {
      url = baseUrl || 'https://generativelanguage.googleapis.com/v1beta/openai/models';
    } else if (provider === 'Custom' && baseUrl) {
      url = baseUrl.endsWith('/models') ? baseUrl : `${baseUrl.replace(/\/$/, '')}/models`;
    } else {
      return c.json({ error: 'Unsupported provider' }, 400);
    }

    headers['Authorization'] = `Bearer ${apiKey}`;

    const requestBody = url.endsWith('/chat/completions')
      ? { model: 'test', messages: [{ role: 'user', content: 'hi' }], max_tokens: 1 }
      : null;

    const testRes = await fetch(url, {
      method: requestBody ? 'POST' : 'GET',
      headers,
      body: requestBody ? JSON.stringify(requestBody) : undefined,
    });

    if (testRes.status === 401 || testRes.status === 403) {
      return c.json({ error: 'Invalid API Key' }, 400);
    }

    return c.json({ success: true, message: 'Connection successful' });
  } catch {
    return c.json({ error: 'Failed to reach API endpoint' }, 400);
  }
});

settings.use('*', authMiddleware);

settings.get('/ai-providers', async (c) => {
  const db = drizzle(c.env.DB);
  const user = c.get('user');

  const providers = await db
    .select({
      id: schema.apiConfigs.id,
      name: schema.apiConfigs.name,
      provider: schema.apiConfigs.provider,
      baseUrl: schema.apiConfigs.baseUrl,
      model: schema.apiConfigs.model,
      isDefault: schema.apiConfigs.isDefault,
    })
    .from(schema.apiConfigs)
    .where(eq(schema.apiConfigs.userId, user.id));

  return c.json({ providers });
});

settings.post('/ai-providers', async (c) => {
  const db = drizzle(c.env.DB);
  const user = c.get('user');
  const body = await c.req.json();

  if (body.isDefault) {
    await db.update(schema.apiConfigs)
      .set({ isDefault: false })
      .where(eq(schema.apiConfigs.userId, user.id));
  }

  const [provider] = await db.insert(schema.apiConfigs).values({
    id: ulid(),
    userId: user.id,
    name: body.name,
    provider: body.provider,
    baseUrl: body.baseUrl,
    model: body.model,
    apiKeyEncrypted: await encryptApiKey(body.apiKey || '', c.env.BETTER_AUTH_SECRET),
    isDefault: body.isDefault || false,
    createdAt: new Date(),
  }).returning({
    id: schema.apiConfigs.id,
    name: schema.apiConfigs.name,
    provider: schema.apiConfigs.provider,
    isDefault: schema.apiConfigs.isDefault,
  });

  return c.json(provider, 201);
});

settings.delete('/ai-providers/:id', async (c) => {
  const db = drizzle(c.env.DB);
  const user = c.get('user');
  const id = c.req.param('id');

  const [deleted] = await db.delete(schema.apiConfigs)
    .where(and(eq(schema.apiConfigs.id, id), eq(schema.apiConfigs.userId, user.id)))
    .returning();

  if (!deleted) return c.json({ error: 'Not found' }, 404);
  return c.json({ success: true });
});

settings.get('/credits', async (c) => {
  const db = drizzle(c.env.DB);
  const user = c.get('user');

  const [dbUser] = await db.select({ creditsRemaining: schema.users.creditsRemaining })
    .from(schema.users).where(eq(schema.users.id, user.id));

  const history = await db.select()
    .from(schema.transactions)
    .where(eq(schema.transactions.userId, user.id));

  return c.json({
    balance: dbUser?.creditsRemaining || 0,
    history
  });
});

export default settings;
