# BrainHalf

AI app builder on Cloudflare Workers. React 19 + Vite 8 SPA with Durable Objects for real-time collaboration and project ownership.

## Architecture

- **`src/worker.ts`** — Main Cloudflare Worker: routes, auth, project access control, WebSocket upgrade
- **`src/agent.ts`** — `ChatAgent` Durable Object (~4000 lines): AI generation pipeline, tool loop, file extraction, streaming
- **`src/registry.ts`** — `AuthRegistry` Durable Object: user accounts, project ownership, publication, model status (admin kill-switch)
- **`src/runtime/`** — Separate Worker (`brainhalf-runtime`): builds and hosts user-generated apps via Workers for Platforms
- **`src/components/`** — React UI: workspace, chat panel, preview, publication controls
- **`src/lib/`** — Shared utilities: auth, crypto, models, project store, runtime client

### Key files

- **`src/lib/models.ts`** — Single source of truth for allowed AI models. Adding a model = entry here + display in `ChatPanel.tsx` + thinking support in `agent.ts`
- **`src/lib/auth.ts`** — Session verification, project ownership checks, login/signup helpers
- **`src/lib/project-runtime-client.ts`** — Frontend polling for runtime status (dev + production)
- **`src/runtime/source.ts`** — `assertSafeMigration`, `sourceSnapshot`, file hashing

## Commands

### Development
```bash
npm run dev              # Local dev server (Vite)
npx wrangler dev         # Local Worker dev
```

### Testing
```bash
npm test                              # All unit tests (vitest main + runtime + scripts)
npx vitest run                        # Main tests only (~1440 tests)
npx vitest run --config vitest.runtime.config.ts  # Runtime tests only (~140 tests)
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
3. If the model supports thinking/reasoning, set `supportsThinking: true` on its entry in `src/lib/models.ts` (checked by `modelSupportsThinking()` at line ~177)
4. If the model accepts image input, add to `acceptsImageInput()` in `src/lib/models.ts`
5. Verify the model ID exists on Cloudflare Workers AI catalog before deploying

## Durable Object hibernation

ChatAgent uses WebSocket Hibernation. In-memory Maps (like `connectionUserIds`) are wiped on every hibernate/wake cycle. Always persist critical state via `connection.setState()` and recover from `connection.state` in `onMessage`. See `agent.ts` for the pattern.

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
