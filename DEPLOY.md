# Deploying BrainHalf on Cloudflare

## Architecture

| App | Cloudflare product | URL |
|-----|-------------------|-----|
| `apps/workers` | Worker | `https://api.brainhalf.com` |
| `apps/web` | Pages | `https://brainhalf.com` |
| `apps/studio` | Pages | `https://studio.brainhalf.com` |

## 1. Workers API

```bash
cd apps/workers
cp .dev.vars.example .dev.vars   # local only — never commit .dev.vars

# One-time secrets (production)
wrangler secret put BETTER_AUTH_SECRET
wrangler secret put CEREBRAS_API_KEY
wrangler secret put CLOUDFLARE_AI_API_TOKEN

# Optional: set Cloudflare Workers AI as primary model provider
# add non-secret vars in Worker Settings (or wrangler.toml [vars]):
#   DEFAULT_AI_PROVIDER=Cloudflare
#   DEFAULT_AI_PROVIDER_FALLBACK=Cerebras,Groq,Gemini,FreeModel

# Migrate D1 (first deploy) — safe to re-run
curl -X POST https://api.brainhalf.com/api/migrate

pnpm deploy
```

Set **Custom Domain** `api.brainhalf.com` on the Worker.  
Dashboard → Worker → Settings → Variables: `BETTER_AUTH_URL=https://api.brainhalf.com`
Dashboard → Worker → Settings → Variables:
- `CLOUDFLARE_AI_BASE_URL=https://api.cloudflare.com/client/v4/accounts/<account_id>/ai/v1`
- `CLOUDFLARE_AI_DEFAULT_MODEL=@cf/qwen/qwen2.5-coder-32b-instruct` (or your preferred Workers AI model)

## 2. Web (marketing + dashboard)

```bash
cd apps/web
pnpm build
wrangler pages deploy ./build/client --project-name=brainhalf-web
```

Pages env vars (dashboard):

- `API_URL` = `https://api.brainhalf.com`
- `STUDIO_URL` = `https://studio.brainhalf.com`
- `CACHE` KV binding (optional, same namespace as workers)

Custom domain: `brainhalf.com`

## 3. Studio (IDE)

Build with production API URL:

```bash
cd apps/studio
export VITE_API_URL=https://api.brainhalf.com
export VITE_WEB_URL=https://brainhalf.com
pnpm build
wrangler pages deploy ./dist --project-name=brainhalf-studio
```

Custom domain: `studio.brainhalf.com`  
`public/_headers` enables WebContainer (COOP/COEP).

## 4. CORS & cookies

Workers allow origins: localhost, `brainhalf.com`, `studio.brainhalf.com`, and `*.pages.dev` preview URLs.

Auth cookies require HTTPS and matching `BETTER_AUTH_URL` on the API worker.

## 5. Pre-deploy checklist

- [ ] `pnpm typecheck` passes
- [ ] `pnpm build` passes
- [ ] D1 migrated on remote
- [ ] Secrets set via `wrangler secret` (not in `wrangler.toml`)
- [ ] `API_URL` set on web Pages project
- [ ] Studio built with `VITE_API_URL`
