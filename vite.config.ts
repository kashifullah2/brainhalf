import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, loadEnv, type Plugin } from 'vite';
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
// The same prompt builder production uses. Imported rather than reimplemented so
// the two cannot answer a mode differently.
import {
  MAX_CUSTOM_PROMPT_CHARS,
  OCR_DOCUMENT_TYPES,
  buildUpstreamRequest,
  isOcrMode,
} from './server/ocr-prompts';

// Graceful defaults — no longer crashes when env vars are missing.
// .env is consulted as well as the shell, so PORT/BASE_PATH declared there are
// actually honoured (previously only shell env was read).
const rootDir = path.resolve(import.meta.dirname);
const fileEnv = loadEnv(process.env.NODE_ENV || 'development', rootDir, '');
const port = Number(process.env.PORT || fileEnv.PORT) || 5173;
const basePath = process.env.BASE_PATH || fileEnv.BASE_PATH || '/';

/**
 * Hosts the dev/preview server will answer for.
 *
 * `true` means "any", which switches off the Host header check that stops a page
 * the developer is browsing from reaching a dev server bound to 0.0.0.0. Replit
 * needs it, because its proxy hostname is generated per session; elsewhere the
 * default is the loopback set, and DEV_ALLOWED_HOSTS (comma separated) covers a
 * tunnel such as ngrok.
 */
const devAllowedHosts: string[] =
  process.env.REPL_ID !== undefined
    ? (process.env.REPLIT_DEV_DOMAIN ? [process.env.REPLIT_DEV_DOMAIN] : [])
    : [
        'localhost',
        '127.0.0.1',
        '[::1]',
        ...(process.env.DEV_ALLOWED_HOSTS || fileEnv.DEV_ALLOWED_HOSTS || '')
          .split(',')
          .map((host) => host.trim())
          .filter(Boolean),
      ];

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

      const hunyuanUserAgent = 'BrainHalf-OCR-Backend/1.0';

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

        const remoteAddress = req.socket.remoteAddress;
        const isLoopback =
          remoteAddress === '127.0.0.1' ||
          remoteAddress === '::1' ||
          remoteAddress === '::ffff:127.0.0.1';

        const allowRemote = readEnv('DEV_ALLOW_REMOTE') === 'true';
        if (!isLoopback && !allowRemote) {
          return send(403, { error: 'Remote access disabled.' });
        }

        const sharedSecret = readEnv('DEV_PROXY_SHARED_SECRET');
        if (sharedSecret && req.headers['x-dev-proxy-secret'] !== sharedSecret) {
          return send(403, { error: 'Unauthorized.' });
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
          tier?: unknown;
          mode?: unknown;
          customPrompt?: unknown;
          document?: { contentType?: unknown; dataUrl?: unknown; filename?: unknown };
          messages?: unknown;
        };
        try {
          parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch {
          return send(400, { error: 'Request body must be valid JSON.' });
        }

        // Mirrors functions/api/ocr.ts exactly: a `messages` array is refused, the
        // mode is checked against a fixed list, and the prompt is built here rather
        // than accepted from the caller.
        if (parsed.messages !== undefined) {
          return send(400, {
            error:
              'This endpoint no longer accepts a `messages` array. Send { mode, document } instead.',
          });
        }
        if (!isOcrMode(parsed.mode)) {
          return send(400, { error: 'Unknown or missing extraction mode.' });
        }
        const customPrompt =
          typeof parsed.customPrompt === 'string' && parsed.customPrompt.trim()
            ? parsed.customPrompt.trim().slice(0, MAX_CUSTOM_PROMPT_CHARS)
            : undefined;

        const doc = parsed.document;
        const contentType = typeof doc?.contentType === 'string' ? doc.contentType : '';
        if (!(OCR_DOCUMENT_TYPES as readonly string[]).includes(contentType)) {
          return send(415, {
            error: `Unsupported document type (${contentType || 'unknown'}).`,
          });
        }
        const dataUrl = typeof doc?.dataUrl === 'string' ? doc.dataUrl : '';
        if (!dataUrl.startsWith(`data:${contentType};base64,`) || dataUrl.length < 32) {
          return send(400, {
            error: '`document.dataUrl` must be a base64 data URL matching the declared type.',
          });
        }

        const upstream = buildUpstreamRequest(parsed.mode, customPrompt, {
          contentType,
          dataUrl,
          filename:
            typeof doc?.filename === 'string' ? doc.filename.slice(0, 255) : 'document',
        });

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

        // Fixed, matching functions/api/ocr.ts. They used to be read off the request
        // body, which handed the caller two knobs on billed behaviour.
        const temperature = 0;
        const seed = 42;

        // OpenAI gets the full parameter set (logprobs, response_format,
        // bounded output). Hunyuan gets only what it is known to accept; its
        // confidence comes from the _overall_confidence the prompt requests.
        let upstreamBody: Record<string, unknown> = isOpenAI
          ? {
              model,
              messages: upstream.messages,
              ...buildModelParams(model, {
                temperature,
                seed,
                logprobs: true,
                jsonObject: upstream.jsonObject,
                maxCompletionTokens: MAX_OCR_COMPLETION_TOKENS,
              }),
            }
          : {
              model,
              messages: upstream.messages,
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
              // Same status mapping as production (functions/api/ocr.ts): a vendor
              // status is not the caller's status, and only 413 is genuinely about
              // the caller's document.
              //
              // One deliberate difference: production does NOT return the vendor's
              // message, because it describes our account. Here it is returned on
              // purpose -- this proxy only ever runs on a developer's machine, and
              // the whole reason to read a provider error is to see what it said.
              const status = upstream.status === 413 ? 413 : 503;
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
            return send(503, { error: 'Could not reach the OCR service.' });
          }
        }

        // Only reachable if a 400 was judged recoverable twice. Defensive.
        return send(503, { error: 'Could not reach the OCR service.' });
      });
    },
  };
}

/**
 * Refuses to build when a secret-shaped VITE_ variable has a value.
 *
 * `VITE_` is not a naming convention, it is the opt-in to static inlining: Vite
 * substitutes every referenced `import.meta.env.VITE_X` into the emitted
 * JavaScript, which is served to anyone who opens the page. This repo has already
 * paid for that once -- `.env` carried live VITE_HUNYUAN_API_KEY, VITE_OCR_API_KEY
 * and a VITE_AWS_ACCESS_KEY_ID / VITE_AWS_SECRET_ACCESS_KEY pair, left behind by
 * the browser-side OCR fallback that src/lib/ocr-client.ts:5-7 describes removing.
 * They never reached a bundle only because nothing happened to reference them.
 * One `import.meta.env` away is not a security boundary.
 *
 * So the check is on the NAME, before anything is referenced. It runs on `build`
 * only: a broken production artifact is the failure worth blocking, and failing
 * `pnpm dev` on a stale local key would just teach people to delete the guard.
 *
 * It is a heuristic, not a secret scanner. It catches KEY / SECRET / TOKEN and
 * would not have caught VITE_AWS_REGION, which was deleted alongside the others
 * because it belonged to the same dead code path. Widen the pattern rather than
 * adding entries to the allowlist.
 */
const SECRET_SHAPED_VITE_VAR = /^VITE_.*(KEY|SECRET|TOKEN)/i;

/**
 * Values that really are public.
 *
 * VITE_GOOGLE_CLIENT_ID does not match the pattern at all (no KEY/SECRET/TOKEN in
 * the name) and is listed for the reader, not the regex — an OAuth client id is
 * published in the page by design.
 *
 * VITE_EMAILJS_PUBLIC_KEY used to be here, and its own comment said the entry
 * should be deleted. It now is. "Public key" was a misnomer: together with a
 * service id and a template id it is the complete argument set for EmailJS's send
 * endpoint, so allowlisting it meant the guard deliberately waved through the one
 * name it would otherwise have caught. functions/api/auth/password-reset.ts no
 * longer reads any VITE_-prefixed EmailJS variable either, so nothing has a reason
 * to set one — and if something does, the build now fails.
 */
const PUBLIC_VITE_VARS = new Set(['VITE_GOOGLE_CLIENT_ID']);

function forbidSecretViteVars(): Plugin {
  return {
    name: 'forbid-secret-vite-vars',
    apply: 'build',
    config(_config, { mode }) {
      // .env files AND the ambient environment: Vite inlines from both, and CI
      // typically supplies VITE_ vars through the latter.
      const candidates = new Map<string, string | undefined>();
      for (const [name, value] of Object.entries(loadEnv(mode, rootDir, 'VITE_'))) {
        candidates.set(name, value);
      }
      for (const [name, value] of Object.entries(process.env)) {
        if (name.startsWith('VITE_')) candidates.set(name, value);
      }

      const offenders = [...candidates.entries()]
        .filter(([name, value]) =>
          Boolean(value?.trim()) &&
          SECRET_SHAPED_VITE_VAR.test(name) &&
          !PUBLIC_VITE_VARS.has(name),
        )
        .map(([name]) => name)
        .sort();

      if (offenders.length > 0) {
        // Names only. Printing a value would put it in CI logs, which is the
        // problem this exists to prevent.
        throw new Error(
          `Refusing to build: ${offenders.length} secret-shaped VITE_ variable(s) have values ` +
            `and would be inlined into the client bundle.\n\n` +
            offenders.map((name) => `  - ${name}`).join('\n') +
            `\n\nA VITE_-prefixed variable is readable by anyone who opens the page. If one of ` +
            `these is a real credential, remove it from .env and rotate it at the provider. If it ` +
            `is genuinely public, rename it so it does not read as a secret, or add it to ` +
            `PUBLIC_VITE_VARS in vite.config.ts with a comment saying why it is safe.`,
        );
      }
    },
  };
}

export default defineConfig({
  base: basePath,
  plugins: [
    forbidSecretViteVars(),
    react(),
    tailwindcss(),
    devOcrProxy(),
    // Replit-specific plugins only load when running inside Replit dev mode.

  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
    },
    dedupe: ['react', 'react-dom'],
  },
  /**
   * Pre-bundle the dependencies live routes use, at server start.
   *
   * Every route in App.tsx is a dynamic import, so Vite's dep scanner — which
   * crawls from index.html — cannot see most of these until you actually visit
   * the route that needs one. It then re-bundles mid-session and forces a full
   * reload:
   *
   *   [vite] ✨ new dependencies optimized: @radix-ui/react-accordion
   *   [vite] ✨ optimized dependencies changed. reloading
   *   Error: Cannot read properties of null (reading 'useRef')
   *
   * That error is the reload racing modules that still hold a reference to the
   * pre-bundle being replaced — React resolves to null and the first hook call
   * throws. It is a development-only failure, but it looks exactly like a real
   * bug and costs a hard refresh every time a new route is opened.
   *
   * Deliberately a list rather than `entries: ['src/**\/*.tsx']`. It used to be
   * justified by the 36 unreachable files in src/components/ui, which dragged
   * recharts, cmdk, vaul, embla and react-day-picker into the crawl; those
   * files and those dependencies are gone now, but an explicit list is still
   * the cheaper contract. If a new dependency is added to a lazily-loaded
   * route, add it here too — forgetting only costs the one reload this avoids.
   */
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react-dom/client',
      'wouter',
      '@tanstack/react-query',
      'lucide-react',
      'class-variance-authority',
      'clsx',
      'tailwind-merge',
      'next-themes',
      'date-fns',
      'localforage',
      'react-zoom-pan-pinch',
      '@radix-ui/react-slot',
      '@radix-ui/react-accordion',
      '@radix-ui/react-alert-dialog',
      '@radix-ui/react-avatar',
      '@radix-ui/react-checkbox',
      '@radix-ui/react-dialog',
      '@radix-ui/react-dropdown-menu',
      '@radix-ui/react-progress',
      '@radix-ui/react-scroll-area',
      '@radix-ui/react-select',
      '@radix-ui/react-tabs',
      '@radix-ui/react-toast',
      '@radix-ui/react-tooltip',
    ],
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
    host: process.env.REPL_ID !== undefined ? '0.0.0.0' : '127.0.0.1',
    allowedHosts: devAllowedHosts,
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host: process.env.REPL_ID !== undefined ? '0.0.0.0' : '127.0.0.1',
    allowedHosts: devAllowedHosts,
  },
});
