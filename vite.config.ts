import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, loadEnv, type Plugin } from 'vite';

import runtimeErrorOverlay from '@replit/vite-plugin-runtime-error-modal';

/**
 * Radix packages that are pure internals — every widget pulls several of them,
 * so they belong in one shared chunk rather than one chunk each.
 */
const RADIX_CORE = new Set([
  'primitive',
  'react-arrow',
  'react-collection',
  'react-compose-refs',
  'react-context',
  'react-direction',
  'react-dismissable-layer',
  'react-focus-guards',
  'react-focus-scope',
  'react-id',
  'react-popper',
  'react-portal',
  'react-presence',
  'react-primitive',
  'react-roving-focus',
  'react-slot',
  'react-use-callback-ref',
  'react-use-controllable-state',
  'react-use-escape-keydown',
  'react-use-effect-event',
  'react-use-is-hydrated',
  'react-use-layout-effect',
  'react-use-previous',
  'react-use-rect',
  'react-use-size',
  'react-visually-hidden',
  'rect',
  'number',
]);

// Shared with functions/api/ocr.ts so dev and production build the same upstream
// body. Importing it is what keeps the two in step — a copy would drift.
import {
  buildModelParams,
  retryWithoutRejectedParam,
  DEFAULT_OPENAI_BASE_URL,
  DEFAULT_OPENAI_MODEL,
  DEFAULT_OPENAI_FALLBACK_MODEL,
} from './server/openai-params';

// Graceful defaults — no longer crashes when env vars are missing.
// .env is consulted as well as the shell, so PORT/BASE_PATH declared there are
// actually honoured (previously only shell env was read).
const rootDir = path.resolve(import.meta.dirname);const fileEnv = loadEnv(process.env.NODE_ENV || 'development', rootDir, '');
const port = Number(process.env.PORT || fileEnv.PORT) || 5173;
const basePath = process.env.BASE_PATH || fileEnv.BASE_PATH || '/';

// Keep in sync with the cap in functions/api/ocr.ts.
const MAX_OCR_BODY_BYTES = 20 * 1024 * 1024;

// Keep in sync with MAX_COMPLETION_TOKENS in functions/api/ocr.ts.
const MAX_OCR_COMPLETION_TOKENS = 8192;

function stripTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

/**
 * Vite's dev server does not run Cloudflare Pages Functions, so during
 * `pnpm dev` a request to /api/ocr would fall through to index.html. This
 * plugin mirrors functions/api/ocr.ts inside the dev server.
 *
 * The credential is read from the Node process, so in development it stays
 * server-side exactly as it does in production: it is never sent to the browser
 * and never inlined into the bundle.
 *
 * ONE DELIBERATE DIFFERENCE: production requires a signed-in session (see the
 * requireSession call in functions/api/ocr.ts). This proxy cannot check one,
 * because plain `pnpm dev` has no D1 binding to resolve a session against. Run
 * `pnpm dev:api` to exercise the real, authenticated path. Production also
 * rate-limits per account, which likewise needs D1.
 *
 * Everything about the *upstream request* is kept identical to production on
 * purpose. This proxy once added `logprobs: true` when production did not, and
 * because extractModelConfidence() in src/lib/confidence-scorer.ts falls back to
 * a flat 0.92 when logprobs are absent, model confidence was real in
 * development and a constant in production — so no confidence-threshold
 * behaviour observed locally matched what users got. Both now send it, via the
 * same buildModelParams() helper. If you change the upstream body here, change
 * it in functions/api/ocr.ts in the same commit.
 */
function devOcrProxy(): Plugin {
  return {
    name: 'dev-ocr-proxy',
    apply: 'serve',
    configureServer(server) {
      // An empty prefix makes loadEnv return non-VITE_ vars as well.
      const env = loadEnv(server.config.mode, server.config.root, '');
      const readEnv = (name: string) => env[name] || process.env[name] || '';

      // Default tier: the dedicated OCR model (Hunyuan).
      const hunyuanKey = readEnv('HUNYUAN_API_KEY');
      const hunyuanBaseUrl = stripTrailingSlash(
        readEnv('HUNYUAN_BASE_URL') || 'https://api.futureppo.top/v1',
      );
      const hunyuanModel = readEnv('HUNYUAN_MODEL') || 'hunyuan-ocr';

      // Escalation tier: OpenAI. OPENAI_API_KEY is preferred; OCR_API_KEY is
      // accepted as a fallback (where the deployment's existing key lives).
      const openaiKey = readEnv('OPENAI_API_KEY') || readEnv('OCR_API_KEY');
      const openaiBaseUrl = stripTrailingSlash(
        readEnv('OPENAI_BASE_URL') || DEFAULT_OPENAI_BASE_URL,
      );
      const openaiModel = readEnv('OPENAI_MODEL') || DEFAULT_OPENAI_MODEL;
      // Cheap OpenAI model used on the default tier when no Hunyuan key is set.
      const openaiFallbackModel = DEFAULT_OPENAI_FALLBACK_MODEL;

      // Mirrors HUNYUAN_USER_AGENT in functions/api/ocr.ts: the upstream
      // rejects the default Node User-Agent, so a browser UA is sent instead.
      const hunyuanUserAgent =
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

      if (!hunyuanKey) {
        server.config.logger.warn(
          '[dev-ocr-proxy] HUNYUAN_API_KEY is not set in .env - default-tier /api/ocr will return 503.',
        );
      }
      if (!openaiKey) {
        server.config.logger.warn(
          '[dev-ocr-proxy] OPENAI_API_KEY is not set in .env - escalation-tier /api/ocr will return 503.',
        );
      }

      server.middlewares.use('/api/ocr', async (req, res) => {
        const send = (status: number, body: unknown) => {
          res.statusCode = status;
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Cache-Control', 'no-store');
          res.end(JSON.stringify(body));
        };

        if (req.method !== 'POST') {
          return send(405, { error: 'Method not allowed. Use POST.' });
        }

        const chunks: Buffer[] = [];
        let received = 0;
        try {
          for await (const chunk of req) {
            received += (chunk as Buffer).length;
            if (received > MAX_OCR_BODY_BYTES) {
              return send(413, { error: 'Document too large.' });
            }
            chunks.push(chunk as Buffer);
          }
        } catch {
          return send(400, { error: 'Could not read request body.' });
        }

        let parsed: {
          messages?: unknown;
          temperature?: number;
          seed?: number;
          jsonObject?: boolean;
          tier?: string;
        };
        try {
          parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch {
          return send(400, { error: 'Request body must be valid JSON.' });
        }
        if (!Array.isArray(parsed?.messages) || parsed.messages.length === 0) {
          return send(400, {
            error: 'Request must include a non-empty `messages` array.',
          });
        }

        // Mirrors production: the caller names a tier, never a model. Anything
        // other than the exact string 'escalation' is the default tier.
        const tier = parsed.tier === 'escalation' ? 'escalation' : 'default';

        // Default tier uses Hunyuan when a key is configured, otherwise falls
        // back to a cheap OpenAI model (mirrors functions/api/ocr.ts).
        const useHunyuan = tier === 'default' && Boolean(hunyuanKey);
        const isOpenAI = !useHunyuan;

        const apiKey = useHunyuan ? hunyuanKey : openaiKey;
        const baseUrl = useHunyuan ? hunyuanBaseUrl : openaiBaseUrl;
        const model = useHunyuan
          ? hunyuanModel
          : tier === 'escalation'
            ? openaiModel
            : openaiFallbackModel;
        const providerName = useHunyuan ? 'hunyuan' : 'openai';

        if (!apiKey) {
          return send(503, { error: 'OCR service is not configured.' });
        }

        const temperature =
          typeof parsed.temperature === 'number' ? parsed.temperature : 0;
        const seed = typeof parsed.seed === 'number' ? parsed.seed : 42;

        // OpenAI gets the full parameter set (logprobs, response_format,
        // bounded output). Hunyuan gets only what it is known to accept; its
        // confidence comes from the _overall_confidence the prompt requests.
        let upstreamBody: Record<string, unknown> = isOpenAI
          ? {
              model,
              messages: parsed.messages,
              ...buildModelParams(model, {
                temperature,
                seed,
                logprobs: true,
                jsonObject: parsed.jsonObject === true,
                maxCompletionTokens: MAX_OCR_COMPLETION_TOKENS,
              }),
            }
          : {
              model,
              messages: parsed.messages,
              temperature,
              seed,
            };

        // Only the OpenAI tier sends optional parameters a model might reject
        // by name, so only it gets a second attempt.
        let attemptsRemaining = isOpenAI ? 2 : 1;

        while (attemptsRemaining > 0) {
          attemptsRemaining -= 1;

          try {
            const upstream = await fetch(`${baseUrl}/chat/completions`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`,
                Accept: 'application/json',
                ...(isOpenAI ? {} : { 'User-Agent': hunyuanUserAgent }),
              },
              body: JSON.stringify(upstreamBody),
            });

            const text = await upstream.text();
            if (!upstream.ok) {
              if (isOpenAI && upstream.status === 400 && attemptsRemaining > 0) {
                let errorBody: unknown = null;
                try {
                  errorBody = JSON.parse(text);
                } catch {
                  // Not JSON, so there is no named parameter to act on.
                }
                const retry = retryWithoutRejectedParam(upstreamBody, errorBody);
                if (retry) {
                  server.config.logger.warn(
                    `[dev-ocr-proxy] ${model} rejected '${retry.removed}'; retrying without it. ` +
                      'Update the capability table in server/openai-params.ts.',
                  );
                  upstreamBody = retry.body;
                  continue;
                }
              }

              server.config.logger.error(
                `[dev-ocr-proxy] upstream ${upstream.status}: ${text.slice(0, 500)}`,
              );
              // Same mapping as production (functions/api/ocr.ts): a vendor status
              // is not the caller's status. Only 413 is genuinely about the
              // caller's document.
              const status = upstream.status === 413 ? 413 : 502;
              return send(status, {
                error: `OCR service error (${upstream.status}).`,
                details: text.slice(0, 500),
              });
            }

            server.config.logger.info(
              `[dev-ocr-proxy] provider=${providerName} model=${model} tier=${tier}`,
            );

            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Cache-Control', 'no-store');
            return res.end(text);
          } catch (error) {
            const cause = (error as { cause?: { code?: string } })?.cause;
            server.config.logger.error(
              `[dev-ocr-proxy] fetch failed: ${String(error)}` +
                (cause?.code ? ` (cause: ${cause.code})` : ''),
            );
            return send(502, { error: 'Could not reach the OCR service.' });
          }
        }

        // Only reachable if a 400 was judged recoverable twice. Defensive.
        return send(502, { error: 'Could not reach the OCR service.' });
      });
    },
  };
}

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    devOcrProxy(),
    // Replit-specific plugins only load when running inside Replit.
    ...(process.env.NODE_ENV !== 'production' &&
    process.env.REPL_ID !== undefined
      ? [
          await import('@replit/vite-plugin-cartographer').then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, '..'),
            }),
          ),
          await import('@replit/vite-plugin-dev-banner').then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      // Adjusted from broken monorepo-relative path to local assets dir.
      '@assets': path.resolve(import.meta.dirname, 'public', 'assets'),
    },
    dedupe: ['react', 'react-dom'],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist'),
    emptyOutDir: true,
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // React core — rarely changes, so a dedicated chunk maximizes cache hits.
          if (id.includes('node_modules/react-dom') || id.includes('node_modules/react/')) {
            return 'vendor-react';
          }
          if (id.includes('node_modules/recharts')) {
            return 'vendor-recharts';
          }
          if (id.includes('node_modules/lucide-react')) {
            return 'vendor-lucide';
          }
          if (id.includes('node_modules/@radix-ui/')) {
            // One chunk per Radix package. Lumping all of them together meant a
            // page that opens an accordion also downloaded the select, menubar
            // and toast implementations; the shared internals (compose-refs,
            // primitive, portal, ...) still coalesce into a single core chunk.
            const pkg = id.split('node_modules/@radix-ui/')[1].split('/')[0];
            return RADIX_CORE.has(pkg) ? 'radix-core' : `radix-${pkg.replace('react-', '')}`;
          }
          if (id.includes('node_modules/class-variance-authority')) {
            return 'vendor-ui';
          }
          if (id.includes('node_modules/@tanstack')) {
            return 'vendor-tanstack';
          }
          if (id.includes('node_modules/localforage')) {
            return 'vendor-localforage';
          }
        },
      },
    },
  },
  server: {
    port,
    strictPort: false,
    host: '0.0.0.0',
    allowedHosts: true,
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host: '0.0.0.0',
    allowedHosts: true,
  },
});
