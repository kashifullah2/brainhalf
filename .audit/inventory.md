# PHASE 0 INVENTORY — brainhalf

## Stack (detected)
- Frontend: Vite 8 + React 19 + TypeScript 7, SPA in `src/`, entry `src/main.tsx` (`index.html`), preview lib build `src/preview-main.tsx` -> `dist/preview-runtime.js`.
- Backend #1 (platform worker): `src/worker.ts` (wrangler.toml, name `brainhalf`, custom domains brainhalf.com/www). Bindings: ASSETS(dist), AI, ChatAgent DO, AuthRegistry DO(REGISTRY), PILOT DO (cross-script brainhalf-runtime), R2 PROJECT_BACKUPS, dispatch namespace DISPATCHER, service binding RUNTIME -> brainhalf-runtime RuntimeControl.
- Backend #2 (runtime worker): `src/runtime/worker.ts` (wrangler.runtime.jsonc, name `brainhalf-runtime`, route *.apps.brainhalf.com). Bindings: PLATFORM service -> brainhalf ManagedProviders, DOs ProjectRuntime/PilotCoordinator/Sandbox, container Sandbox (Dockerfile.runtime), R2 ARTIFACTS, DISPATCHER, BROWSER.
- DB: Durable Object SQLite (ChatAgent, AuthRegistry, ProjectRuntime, PilotCoordinator, Sandbox). No D1. Generated apps get SQLite via node:sqlite templates.
- Auth: session cookie via AuthRegistry DO + Google OAuth; session secret SESSION_SECRET.
- External APIs: Anthropic, OpenAI, AWS Bedrock (@ai-sdk), Atria (custom), Resend (email), Google OAuth, GitHub API/OAuth, Cloudflare API (client/v4).
- Deploy: `npm run deploy` (scripts/deploy.mjs) via wrangler 4.147; CI .github/workflows/validate.yml runs npm run verify + verify:release + playwright smoke.
- Tests: vitest (151 files), vitest.runtime (runtime-tests/), node --test scripts/__tests__, playwright e2e.

## Baseline tool results (logs in .audit/logs/)
- tsc --noEmit (both configs): PASS
- oxlint: PASS, warnings only (unused imports, react/purity Date.now in render)
- vitest main: 1438/1439 pass; 1 failure = product-quality inner node test `listen EPERM 127.0.0.1` — sandbox restriction; PASSES unsandboxed (environmental, not a bug)
- vitest runtime-tests: 140/140 PASS; scripts node --test: 7/7 PASS
- npm run build: PASS (25 pages prerendered, SEO checks passed)
- npm audit --omit=dev: 2 vulns: proxy-addr <=2.0.7 CRITICAL (via express 5.2.1 <- @modelcontextprotocol/sdk, GHSA-jqcg-44mw-7w3h); source-map-js <=1.2.1 HIGH (via postcss <- vite, GHSA-68fv-2mgg-jv7q)
- wrangler runtime:check dry-run: BLOCKED by missing Docker daemon access (environmental; cannot verify in sandbox) — UNVERIFIED
- git: no case-duplicate tracked files; .dev.vars NOT tracked (good); .gitignore covers env/node_modules/dist

## Routes (src/worker.ts)
- /sign-in,/login -> redirect to modal (305)
- /api/auth/google/callback GET (311), /api/apps/google/start GET (312)
- /preview-rules.json GET/HEAD (316), /preview-runtime.js (323)
- OPTIONS preflight for CORS_PREFIXES (344)
- AUTH_ROUTES set (363): /api/auth/session GET, others POST
- /api/account/outcomes, /api/admin/outcomes GET (428)
- /api/admin/users GET (442), /api/admin/projects GET (455), /api/admin/projects/:id DELETE (466)
- /api/admin/models[/:id][/test] (483)
- /api/admin/email-status GET (509), /api/admin/settings GET/POST (527)
- /api/models/status GET (541)
- /api/admin/projects/:id/files GET (553), /api/admin/projects/:id/preview/* (571)
- /api/admin/users/:id DELETE (592)
- /api/account/ai-usage GET (604), /api/account/deletions GET (610), /api/account/project-quota GET (616)
- /api/projects/:id/stop (623), /api/projects/:id/runtime/* proxy (639, /email-test 656)
- /api/projects GET (663)
- /api/gallery GET (699)
- /api/projects/:id/showcase (708), /api/projects/:id/remix (729), /api/projects/:id/publication (784)
- /api/projects/:id DELETE/PATCH (804)
- /api/test/simple|medium|hard (855)
- /p/:id public showcase (876)
- /preview/:id/* edge preview (918)
- /agents/* via routeAgentRequest (945) w/ onBeforeConnect/onBeforeRequest ACL
- fallback: unmatched /api/*,/agents/* -> 404 (1027); else ASSETS w/ shell for /,/dashboard,/admin (1035)

## Frontend views (src/App.tsx)
- Views: landing (default), workspace (?project=), dashboard (/dashboard), admin (/admin); sign-in is modal not route.
- Shell paths served by worker: /, /dashboard, /admin (+ /sign-in,/login handled).

## Env vars (real, code-used)
- Worker [vars] declared: REQUIRED_MODEL_PROVIDERS, REQUIRED_PUBLIC_SERVICES, ADMIN_EMAILS, IS_DEV
- Worker secrets (expected): SESSION_SECRET, ANTHROPIC_API_KEY, AWS_*, ATRIA_API_KEY/ATRIA_BASE_URL, RESEND_API_KEY/RESEND_FROM_EMAIL, GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET, PRODUCT_METRICS_OWNER_IDS, CONTACT_EMAIL(optional)
- Runtime worker vars: RUNTIME_ENABLED, RUNTIME_ACCESS, RUNTIME_DOMAIN, RUNTIME_SERVICE_NAME, CF_ACCOUNT_ID, PILOT_OWNER_IDS, DISPATCH_NAMESPACE; secrets: CF_API_TOKEN, PROJECT_SECRETS_KEY
- Frontend (import.meta.env): VITE_BACKEND_HOST, VITE_PUBLIC_URL
- Generated-app templates use: APP_ORIGIN, DATABASE_PATH, DATABASE_URL, NODE_ENV, PORT, JWT_SECRET, BRAINHALF_SERVICES, BRAINHALF_SERVICE_TOKEN (injected at app deploy)

## External API call sites
- api.cloudflare.com/client/v4 (cloudflare-api.ts)
- api.github.com + github.com/login/oauth (github-export.ts/github-profile.ts)
- oauth2.googleapis.com/token, openidconnect.googleapis.com/v1/userinfo (google-auth.ts)
- api.resend.com/emails (email.ts)
- LLM providers via @ai-sdk (anthropic/openai/bedrock) + Atria custom base URL
- 'https://registry*' strings = test mock (cloudflare-mock / dev-auth-mock), NOT production

## Assets
- public/: fonts (woff/ttf), images/landing (png/webp), favicon set in assest/ (gitignored 'assest/' — check!), manifest (webmanifest x3)
