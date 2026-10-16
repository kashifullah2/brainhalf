# BrainHalf

AI app builder on Cloudflare Workers. React 19 + Vite 8 SPA with Durable Objects for real-time collaboration and project ownership.

## Architecture

- **`src/worker.ts`** — Main Cloudflare Worker: routes, auth, project access control, WebSocket upgrade
- **`src/agent.ts`** — `ChatAgent` Durable Object: WebSocket lifecycle, onMessage routing, auth, file serving, project management. Delegates AI generation to `GenerationPipeline`.
- **`src/lib/generation-pipeline.ts`** — `GenerationPipeline` class: full AI generation path — CF Workers AI retry loop, kill-switch, tool loop, repair counters, completeness/phantom-hook/route-coverage checks, file extraction, streaming.
- **`src/registry.ts`** — `AuthRegistry` Durable Object: user accounts, project ownership, publication, model status (admin kill-switch)
- **`src/runtime/`** — Separate Worker (`brainhalf-runtime`): builds and hosts user-generated apps via Workers for Platforms
- **`src/components/`** — React UI: workspace, chat panel, preview, publication controls
- **`src/lib/`** — Shared utilities: auth, crypto, models, project store, runtime client

### Key files

- **`src/lib/models.ts`** — Single source of truth for allowed AI models. Adding a model = entry here + display in `ChatPanel.tsx` + thinking support in `agent.ts`
- **`src/lib/auth.ts`** — Session verification, project ownership checks, login/signup helpers
- **`src/lib/project-runtime-client.ts`** — Frontend polling for runtime status (dev + production)
- **`src/lib/api-coverage.ts`** — `extractWorkerRoutes` / `extractApiFetches` / `findUncoveredFetches`. Route checker only recognises chained-router `.get('/api/...', handler)` syntax — NOT the if/else `url.pathname` dispatch style used by the baseline `workers-starter.ts` template.
- **`src/runtime/source.ts`** — `assertSafeMigration`, `sourceSnapshot`, file hashing

## Frontend Design System

Single unified design system — no split between landing and studio.

### Fonts
- **`--font-sans` / `--font-brand`**: `'Instrument Studio'` (Instrument Sans) — used for all text including headings
- **`--font-mono`**: `'DM Studio Mono'` — code only
- Self-hosted WOFF files in `public/fonts/`

### Accent color
- Light mode: `#5857FF` (electric blue-violet)
- Dark mode: `#7B7AFF`

### CSS layers (load order matters)
1. `src/index.css` — dark-mode defaults and base token definitions
2. `src/styles/studio-theme.css` — active token overrides for all App.tsx pages (loaded last, wins)
3. `src/components/landing/landing-tokens.css` — landing-only scoped overrides within `.landing-container`

### Key token files
- **`src/styles/studio-theme.css`** — primary token layer for all pages
- **`src/styles/studio-fonts.css`** — `@font-face` declarations
- **`src/components/landing/landing-tokens.css`** — landing page scoped overrides (maps `--landing-*` → studio tokens)
- **`src/index.css`** — base/fallback tokens

### Design work
- Superdesign project: `.superdesign/` — init files in `.superdesign/init/`, design system in `.superdesign/design-system.md`
- Canvas: `https://superdesign.dev/teams/5cb48de4-0ec0-4e58-8050-0c9a5c9d42bf/projects/a500624d-b0b2-4afe-accb-f72bb85c287b`

## Commands

### Development
```bash
npm run dev              # Local dev server (Vite)
npx wrangler dev         # Local Worker dev
```

### Testing
```bash
npm test                              # All unit tests (vitest main + runtime + scripts)
npx vitest run                        # Main tests only
npx vitest run --config vitest.runtime.config.ts  # Runtime tests only (runtime-tests/)
npm run typecheck                     # Both tsconfigs: tsconfig.json + tsconfig.runtime.json
npm run lint                          # oxlint
npm run verify                        # Full pipeline: typecheck + test + lint + build
```

### Deploy
```bash
npm run build && npx wrangler deploy                                    # Frontend + main Worker
node scripts/wrangler.mjs deploy --config wrangler.runtime.jsonc        # Runtime Worker (separate)
```

Do NOT use `npm run deploy` — that runs the full release pipeline with verification gates. Use the commands above for quick deploys.

### E2E / Playwright
```bash
npx playwright test                          # Default suite (needs local backend)
npx playwright test --config playwright.live.config.ts  # Live tests against production
```

About 22 of ~264 Playwright tests require a production backend (Durable Objects, Workers AI) and will fail locally. This is expected.

## Security rules

- **`.dev.vars`** contains real secrets (`SESSION_SECRET`, `ATRIA_API_KEY`). NEVER commit or read its contents.
- **`IS_DEV`** must be `"false"` in `wrangler.toml`. Only set to `"true"` in `.dev.vars` for local dev.
- **`src/runtime/generated.d.ts`** is gitignored — it contained real `CF_ACCOUNT_ID` and `PILOT_OWNER_IDS`. Never re-add to git.
- Never commit `.env`, `.dev.vars`, credentials, or API keys.
- Always run `git status` before committing to check for sensitive files.

## Adding a new AI model

1. Add entry to `CF_MODELS` (or other provider array) in `src/lib/models.ts`
2. Add display metadata in `MODEL_DISPLAY` in `src/components/ChatPanel.tsx`
3. If the model supports thinking/reasoning, set `supportsThinking: true` on its entry in `src/lib/models.ts` (checked by `modelSupportsThinking()`)
4. If the model accepts image input, add to `acceptsImageInput()` in `src/lib/models.ts`
5. Verify the model ID exists on Cloudflare Workers AI catalog before deploying

## Durable Object hibernation

ChatAgent uses WebSocket Hibernation. In-memory Maps (like `connectionUserIds`) are wiped on every hibernate/wake cycle. Always persist critical state via `connection.setState()` and recover from `connection.state` in `onMessage`. See `agent.ts` for the pattern.

`GenerationPipeline` is re-created on every wake (lazy getter `get pipeline()`). Its fields start at their declared defaults. Fields that must survive hibernation are persisted to D1 SQL and lazily restored on first access — e.g. `pendingCompletenessRepair` reads from `pending_repair` table when the in-memory field is `null`. Do not rely on pipeline field values surviving across a hibernate/wake cycle unless they are backed by SQL.

## Test patterns

- Auth in Playwright: set `localStorage.setItem('bh_session_token', 'bh_dev_local_token_not_a_real_session')` via `addInitScript` before `page.goto`
- Never use `waitForLoadState('networkidle')` — WebSocket keeps the connection open. Use `domcontentloaded`.
- Workspace navigation is URL-based: `/?project=<id>`
- No sidebar exists — it was removed. Project switching uses the top nav.

## Code style

- No comments unless the WHY is non-obvious
- No premature abstractions or speculative features
- Validate at system boundaries only (user input, external APIs)
- Trust internal code and framework guarantees
