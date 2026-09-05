import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { eq, and, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import * as schema from '@brainhalf/db/schema';
import type { Env } from '../env';
import { authMiddleware } from '../middleware/auth';
import { ulid } from 'ulidx';
import { decryptApiKey } from '../lib/crypto';
import { isLocalDevOrigin } from '../lib/dev-origin';
import {
  resolveEnvApiKey,
  resolveDefaultProvider,
  resolveProviderChain,
  resolvePlatformProviderOptions,
} from '../lib/ai-providers';
import {
  FREEMODEL_DEFAULT_BASE_URL,
  GROQ_DEFAULT_BASE_URL,
  GEMINI_DEFAULT_BASE_URL,
  type ProviderType,
} from '@brainhalf/ai/providers';

const ai = new Hono<{ Bindings: Env; Variables: { user: { id: string } } }>();

ai.use('*', authMiddleware);

function chatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/$/, '');
  if (trimmed.endsWith('/chat/completions')) return trimmed;
  return `${trimmed}/chat/completions`;
}

ai.post('/chat', async (c) => {
  const db = drizzle(c.env.DB);
  const user = c.get('user') as { id: string } | undefined;

  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const { messages, projectId, providerConfig } = body as {
    messages?: unknown;
    projectId?: string;
    providerConfig?: unknown;
  };

  if (!Array.isArray(messages) || messages.length === 0) {
    return c.json({ error: 'Messages array is required' }, 400);
  }

  let finalProviderConfig = providerConfig as {
    provider?: string;
    apiKey?: string;
    baseUrl?: string;
    model?: string;
  } | null;
  let dbUser: typeof schema.users.$inferSelect | null = null;

  if (user) {
    const [result] = await db.select().from(schema.users).where(eq(schema.users.id, user.id));
    dbUser = result ?? null;

    if (!dbUser) {
      return c.json({ error: 'User not found' }, 404);
    }

    if (dbUser.creditsRemaining <= 0) {
      return c.json({ error: 'Insufficient credits' }, 402);
    }

    if (!finalProviderConfig?.apiKey) {
      const [defaultConfig] = await db.select().from(schema.apiConfigs).where(
        and(eq(schema.apiConfigs.userId, user.id), eq(schema.apiConfigs.isDefault, true))
      );
      if (defaultConfig) {
        const decryptedKey = await decryptApiKey(
          defaultConfig.apiKeyEncrypted,
          c.env.BETTER_AUTH_SECRET
        );
        finalProviderConfig = {
          provider: defaultConfig.provider,
          apiKey: decryptedKey,
          baseUrl: defaultConfig.baseUrl ?? undefined,
          model: defaultConfig.model ?? undefined,
        };
      }
    }
  }

  const explicitProvider = finalProviderConfig?.provider;
  const provider = explicitProvider || resolveDefaultProvider(c.env);
  // A key counts as "bring your own" only if it arrived with the request or was
  // loaded from the signed-in user's saved config — never the platform env key.
  const usingPlatformKey = !finalProviderConfig?.apiKey;
  // When spending platform keys from .dev.vars, always walk the full chain —
  // never pin to a single provider because the client sent a provider name.
  const providersToTry = usingPlatformKey ? resolveProviderChain(c.env) : [provider];

  const hasUsableKey = providersToTry.some((p) => {
    const key = finalProviderConfig?.apiKey || resolveEnvApiKey(c.env, p);
    return Boolean(key && !key.startsWith('replace-with'));
  });

  // Lockdown: anonymous callers may NOT spend the platform's own provider key in
  // production. Local dev (localhost origins) is exempt so engineers can use
  // CEREBRAS_API_KEY from .dev.vars without signing in every time.
  const requestOrigin = c.req.header('Origin') || c.req.header('Referer') || '';
  const authUrl = c.env.BETTER_AUTH_URL || '';
  const isLocalDev =
    isLocalDevOrigin(requestOrigin) ||
    authUrl.includes('localhost') ||
    authUrl.includes('127.0.0.1');

  if (!user && usingPlatformKey && !isLocalDev) {
    return c.json({
      error: 'Sign in to generate with your BrainHalf credits, or add your own provider API key in Settings.'
    }, 401);
  }

  if (!hasUsableKey) {
    return c.json({
      error: `API Key is missing. Add CEREBRAS_API_KEY or FREEMODEL_API_KEY to apps/workers/.dev.vars, or configure a provider in Settings.`
    }, 400);
  }

  const { ProviderManager } = await import('@brainhalf/ai/providers');
  const { StreamingManager } = await import('@brainhalf/ai/streaming');
  const { GAME_AGENT_SYSTEM_PROMPT, TOOLS } = await import('@brainhalf/ai/agent');

  const gameType = (body.gameType as string) || 'standard_3d';
  const complexity = gameType === '2d' ? 'simple_2d' : 'standard_3d';
  const streamMgr = new StreamingManager();

  return streamSSE(c, async (stream) => {
    let lastError = 'All configured AI providers failed';
    let succeeded = false;
    let selectedModel = '';
    let promptTokens = 0;
    let completionTokens = 0;
    let generationTimeMs = 0;
    let estimatedCost = 0;

    try {
      for (let attempt = 0; attempt < providersToTry.length; attempt++) {
        const tryProvider = providersToTry[attempt];
        const tryApiKey = finalProviderConfig?.apiKey || resolveEnvApiKey(c.env, tryProvider);
        if (!tryApiKey || tryApiKey.startsWith('replace-with')) continue;

        const platformOpts = resolvePlatformProviderOptions(c.env, tryProvider, finalProviderConfig);
        const providerMgr = new ProviderManager({
          provider: tryProvider as ProviderType,
          apiKey: tryApiKey,
          baseUrl: platformOpts.baseUrl,
          modelOverride: platformOpts.model,
        });

        selectedModel = providerMgr.selectBestModel(complexity);
        const config = providerMgr.getConfig();
        const providerMap: Record<string, string> = {
          'Cerebras': 'https://api.cerebras.ai/v1/chat/completions',
          'AgentRouter': 'https://agentrouter.org/v1/chat/completions',
          'OpenProvider': 'https://openprovider.mimika.in/v1/chat/completions',
          'FreeModel': chatCompletionsUrl(platformOpts.baseUrl || FREEMODEL_DEFAULT_BASE_URL),
          'Groq': chatCompletionsUrl(platformOpts.baseUrl || GROQ_DEFAULT_BASE_URL),
          'Gemini': chatCompletionsUrl(platformOpts.baseUrl || GEMINI_DEFAULT_BASE_URL),
          'Cloudflare': chatCompletionsUrl(platformOpts.baseUrl || ''),
        };

        if (config.provider === 'Cloudflare' && !platformOpts.baseUrl) {
          lastError =
            'Cloudflare provider missing base URL. Set CLOUDFLARE_AI_BASE_URL to https://api.cloudflare.com/client/v4/accounts/<account_id>/ai/v1';
          if (attempt < providersToTry.length - 1) continue;
          await stream.writeSSE({ data: JSON.stringify({ type: 'error', error: lastError }) });
          return;
        }

        const fetchUrl = chatCompletionsUrl(
          config.baseUrl || providerMap[config.provider] || providerMap.Cerebras,
        );

        const mappedMessages = (messages as Array<Record<string, unknown>>).map((m) => {
          if (m.role === 'tool') {
            return {
              role: 'tool' as const,
              tool_call_id: m.tool_call_id as string,
              content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? ''),
            };
          }
          if (m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length > 0) {
            return {
              role: 'assistant' as const,
              content: typeof m.content === 'string' ? m.content : '',
              tool_calls: m.tool_calls,
            };
          }
          return { role: m.role as string, content: (m.content as string) ?? '' };
        });

        const fetchBody: Record<string, unknown> = {
          model: selectedModel,
          messages: [
            { role: 'system', content: GAME_AGENT_SYSTEM_PROMPT },
            ...mappedMessages,
          ],
          tools: TOOLS.map(t => ({
            type: 'function' as const,
            function: {
              name: t.function.name,
              description: t.function.description,
              parameters: t.function.parameters,
            },
          })),
          stream: true,
          stream_options: { include_usage: true },
        };

        if (config.provider === 'FreeModel') {
          fetchBody.reasoning_effort = 'xhigh';
          fetchBody.store = false;
        }

        const aiResponse = await fetch(fetchUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'text/event-stream',
            'Authorization': `Bearer ${config.apiKey}`,
          },
          body: JSON.stringify(fetchBody),
        });

        if (!aiResponse.ok) {
          let errBody = '';
          try {
            errBody = await aiResponse.text();
          } catch {
            errBody = aiResponse.statusText;
          }
          lastError = `AI API Error (${tryProvider}, ${aiResponse.status}): ${errBody || aiResponse.statusText}`;
          const canFallback = attempt < providersToTry.length - 1;
          const retryable = aiResponse.status === 429 || aiResponse.status >= 500;
          if (canFallback && retryable) {
            await stream.writeSSE({
              data: JSON.stringify({
                type: 'info',
                message: `${tryProvider} unavailable (${aiResponse.status}) — trying ${providersToTry[attempt + 1]}…`,
              }),
            });
            continue;
          }
          if (canFallback) continue;
          await stream.writeSSE({
            data: JSON.stringify({ type: 'error', error: lastError })
          });
          return;
        }

        if (!aiResponse.body) {
          lastError = `AI API returned no response body (${tryProvider})`;
          if (attempt < providersToTry.length - 1) continue;
          await stream.writeSSE({ data: JSON.stringify({ type: 'error', error: lastError }) });
          return;
        }

        const startTime = Date.now();
        const events = streamMgr.adaptStream(aiResponse, 'openai');
        let hadError = false;
        promptTokens = 0;
        completionTokens = 0;

        for await (const event of events) {
          if (event.type === 'error') hadError = true;
          if (event.usage) {
            promptTokens = event.usage.promptTokens ?? promptTokens;
            completionTokens = event.usage.completionTokens ?? completionTokens;
          }
          await stream.writeSSE({ data: JSON.stringify(event) });
        }

        generationTimeMs = Date.now() - startTime;

        if (hadError) {
          lastError = `${tryProvider} stream ended with an error`;
          if (attempt < providersToTry.length - 1) continue;
          return;
        }

        estimatedCost = providerMgr.calculateCost(selectedModel, promptTokens, completionTokens);
        succeeded = true;
        break;
      }

      if (!succeeded) {
        await stream.writeSSE({ data: JSON.stringify({ type: 'error', error: lastError }) });
        return;
      }

      const totalTokens = promptTokens + completionTokens;

      if (user && dbUser) {
        await db.update(schema.users)
          .set({
            creditsRemaining: sql`${schema.users.creditsRemaining} - 1`,
            updatedAt: new Date()
          })
          .where(
            and(
              eq(schema.users.id, user.id),
              sql`${schema.users.creditsRemaining} > 0`
            )
          );

        // Only log history against a real project to avoid FK violations.
        if (projectId && projectId !== 'new_project') {
          try {
            await db.insert(schema.generationHistory).values({
              id: ulid(),
              projectId,
              userId: user.id,
              prompt: String(messages[messages.length - 1]?.content || 'chat').slice(0, 2000),
              modelUsed: finalProviderConfig?.model || selectedModel,
              tokensUsed: totalTokens,
              promptTokens,
              completionTokens,
              estimatedCost,
              generationTimeMs,
              status: 'completed',
              createdAt: new Date(),
            });
          } catch (logErr) {
            console.error('[ai] Failed to record generation history:', logErr);
          }
        }
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      await stream.writeSSE({ data: JSON.stringify({ type: 'error', error: errorMessage }) });
    }
  });
});

export default ai;
