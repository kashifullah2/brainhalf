# BrainHalf — Complete File-by-File Codebase Analysis

**Generated**: September 28, 2026 · Branch: `fix/full-test-and-polish` (post-cleanup commit `01d03c4` + reliability/UX fix batch)
**Scope**: every source file in `src/`, configs, scripts, and test landscape.
**Verified state at analysis time**: typecheck clean · oxlint clean · 996 main + 102 runtime + 36 script tests passing · production build + SEO checks passing.

---

## 1. Executive Summary

BrainHalf is a production AI app-builder/cloud-IDE on Cloudflare: one main Worker (edge router + `ChatAgent`/`AuthRegistry` Durable Objects with SQLite) and one runtime Worker (`brainhalf-runtime`) hosting managed apps on `*.apps.brainhalf.com`. Frontend is React 19 + Vite + Monaco.

| Metric | Value |
| :--- | :--- |
| Source files (excl. tests/generated) | ~135 |
| Source LOC (excl. tests/generated) | ~35,500 |
| Unit/integration test files | 97 (`src/__tests__`) |
| Runtime test files | 3 (`runtime-tests/`) |
| E2E/benchmark specs | ~60 active specs in `tests/` |
| Largest files | `agent.ts` 3,163 · `index.css` 2,516 · `ChatPanel.tsx` 2,237 · `Workspace.tsx` 1,872 |
| `as any` hotspots | `agent.ts` 38 · `model-tester.ts` 13 · `auth.ts` 5 · `registry.ts` 4 |

**Structural verdict**: security posture and test depth are excellent; the dominant risks are (a) three god files carrying most change traffic, (b) dual project-file state (client IndexedDB/localStorage vs DO SQLite), (c) preview reliability resting on a chain of postMessage handshakes without a watchdog, and (d) provider/model docs that drifted from code (fixed in this batch).

---

## 2. Entry Points & Core Engine

### `src/worker.ts` — 684 lines — Main Worker entry/router
Auth-gated edge router. Handles: CORS preflights for `/api/`, `/agents/`, `/preview/`, `/p/`; the 13 auth routes; rate limiting via Registry DO (`auth`, `modelTest` buckets); session verification (HMAC token, cookie/header only on WS — `?token=` stripped at handshake); Google OAuth start/callback; project claim/ownership gate; dispatch-namespace preview routing; runtime service proxying (`x-bh-project`/`x-bh-owner` headers); static assets with shell security headers; JSON 404 for unmatched API paths. Exports `PlatformEnv` (typed bindings, no more `env: any`) and the `ManagedProviders` entrypoint.
- Health: good after this batch. `DispatchBinding`/`DurableBinding` structural types via `src/lib/bindings.ts`.
- Rate limiting covers auth, model-test, and preview traffic (preview buckets fail open on limiter outage).

### `src/agent.ts` — 3,163 lines — `ChatAgent` Durable Object (the core engine)
Per-project stateful agent: SQLite persistence (messages, project_files, checkpoints), multi-provider streaming generation, tool loop (`read_file`/`write_file`/`edit_file`/`list_files`/`check_syntax`), exact-edit guards, secret-file filtering at the reader (`.env` can never leave the DO), token ladder `[32768, 16384, 8192, 4096]`, continuation requests for truncated output, edge preview HTTP serving (Sucrase transpile, dual-MIME CSS), simulated backend execution, source snapshots to R2, product-outcome events, MCP tool wiring via `BuilderService`.
- Health: heavily tested (generation runtime, write guards, erasure, stop-generation suites) but it is the #1 god file — 38 `as any`, 54 console calls, and nearly every feature touches it.
- Improved this batch: provider branch tree extracted to `provider-clients.ts`; Dahl dead code removed.

### `src/registry.ts` — 784 lines — `AuthRegistry` Durable Object
Account store: signup/login (PBKDF2 100k), sessions with revocation table, email verification + password reset tokens (hashed, expiring), WS ticket mint/redeem (single-use `bhwt_`), project ownership/claim, rate-limit buckets, AI budget ledger, product outcomes aggregation, publication records.
- Health: solid; fail-closed defaults; ownership enforced at Worker gate and re-checked in the DO.

### `src/App.tsx` — 565 lines — Root SPA shell
View switching (landing/dashboard/workspace), auth gating, session bootstrap, private-search metadata, lazy workspace loading.

### `src/main.tsx` — 39 lines — Client bootstrap (hydrateRoot for prerendered pages, createRoot otherwise).
### `src/preview-main.tsx` — 18 lines — Preview iframe bundle entry (mounts `PreviewRunner`).
### `src/vite-env.d.ts` — 14 lines — Vite client types + `cloudflare:workers` module declaration.

---

## 3. `src/lib/` — Business Logic (one line per file)

### AI / Generation
| File | Lines | Role | Notes |
| :--- | ---: | :--- | :--- |
| `models.ts` | 167 | `MODEL_ALLOWLIST`, `DEFAULT_MODEL_ID` (DeepSeek V4 Pro), `resolveModel` exact-match, token caps | Single source of truth; picker derives from it |
| `provider-clients.ts` | 90 | **New.** Shared provider credentials, transport selection (Bedrock↔Anthropic), `BEDROCK_ALIASES`, client factories | Removed 4-file duplication |
| `model-tester.ts` | 662 | `/api/test/*` live model diagnostics, Bedrock alias retry, auto-heal | 13 `as any`; distinct streaming loops by design |
| `model-reliability.ts` | 83 | Retry classification, quota-error handling | |
| `system-prompt.ts` | 197 | Agent system prompt builder (rules 16/17 etc.) | |
| `prompt-mode.ts` | 22 | Conversational vs build prompt detection | |
| `generation-controls.ts` | 46 | Server-bounded reliability controls (steps 1–20, tokens 300–65536) | |
| `generation-session.ts` | 13 | In-flight generation snapshot | |
| `generation-target.ts` | 22 | Backend-need detection + hosting availability preflight | |
| `generation-timing.ts` | 45 | Browser-observed timing metrics | |
| `agent-capabilities.ts` | 145 | Tool capability mapping for Workers AI vs SDK paths | |
| `agent-context.ts` | 41 | Bounded conversation context + file ranking | |
| `message-parser.ts` | 434 | Parses model output into files/edits/segments | |
| `exact-edits.ts` | 16 | Exact unique-replacement edit application | |
| `assistant-response.ts` | 22 | Visible-content judgment helpers | |
| `chat-transcript.ts` | 158 | Tool transcript formatting for chat bubbles | |
| `workers-ai-tool-stream.ts` | 69 | Workers AI tool-call streaming adapter | |
| `ai-budget.ts` | 92 | Allowance metering (`AiBudget`, reservations) | |
| `repair-budget.ts` | 10 | Auto-repair attempt cap | |
| `automatic-build-fix.ts` | 89 | Client hook: auto-fix TS build errors | |

### Preview subsystem
| File | Lines | Role | Notes |
| :--- | ---: | :--- | :--- |
| `preview-isolation.ts` | 69 | Sandbox config, security headers, file filtering | |
| `preview-entry.ts` | 51 | App entry selection, starter detection | |
| `preview-import-map.ts` | ~60 | esm.sh import-map builder, harness detection | |
| `preview-modules.ts` | 80 | In-memory module registry for the sandbox | |
| `preview-runtime.ts` | 56 | Preview runtime bootstrap helpers | |
| `preview-fetch.ts` | 56 | Sandboxed fetch shim | |
| `preview-storage.ts` | 11 | Sandboxed localStorage shim | |
| `preview-diagnostics.ts` | 56 | Preview error capture/classification | |
| `preview-mode.ts` | 15 | Retired simulated-API marker + `BACKEND_NOT_RUNNING` | |
| `preview-templates.ts` | 581 | Starter app JSX, harness, CSS-module wrapper, missing-component stub | |
| `backend-runner.ts` | 1,036 | In-preview simulated backend executor + `InMemoryDataStore` | Largest lib file; candidate for splitting |

### Auth / Security
| File | Lines | Role | Notes |
| :--- | ---: | :--- | :--- |
| `auth.ts` | 452 | Token HMAC, session verify, project ownership, WS tickets, preview session | `RegistryEnv` now structural |
| `auth-client.ts` | 344 | Client session store, `authFetch`, WS ticket prefetch; `?token=` fallback removed | |
| `crypto.ts` | 265 | WebCrypto helpers (SHA-256, HMAC, PBKDF2) | |
| `google-auth.ts` | 109 | Google OAuth code flow (PKCE, single-use state) | |
| `google-profile.ts` | 20 | Google profile fetch | |
| `oauth-schema.ts` | 5 | OAuth payload schemas | |
| `allowed-origins.ts` | 23 | CORS origin allowlist | |
| `rate-limit.ts` | 67 | Rate limiter primitives | |
| `ssrf.ts` | 232 | SSRF-guarded fetch (host allow/deny, redirect control) | |
| `secret-files.ts` | 11 | Blocked secret-path matcher | |
| `http-body.ts` | 9 | Bounded JSON reader (2 MB) | |
| `tenant-request.ts` | 11 | Dispatch-tenant request builder | |
| `app-session.ts` | 3 | App-session token accessor | |
| `bindings.ts` | 18 | **New.** Structural `BindingFetcher`/`DurableBinding`/`DispatchBinding` | |
| `cloudflare-mock.ts` | 18 | `cloudflare:workers` mock for Vite/Vitest (restored after accidental deletion) | Aliased in both vitest configs — never delete without checking configs |

### Projects / Workspace
| File | Lines | Role | Notes |
| :--- | ---: | :--- | :--- |
| `project-store.ts` | 785 | Client persistence (IndexedDB + localStorage), fork/merge, debounced writes | Half of the dual-source-of-truth pair |
| `workspace-reconciliation.ts` | 33 | Client↔DO snapshot reconciliation | Exists because of dual truth |
| `recent-projects.ts` | 70 | Recent project list | |
| `project-access.ts` | 44 | Preview access checks | |
| `project-cleanup.ts` | 42 | Project deletion cascade | |
| `project-export.ts` | 48 | Export boundary: strips secrets, caps size | |
| `zip-export.ts` | 174 | ZIP download builder | |
| `github-export.ts` | ~170 | GitHub tree-commit export **+ repository import** (two-way) | |
| `file-snapshot.ts` | 80 | Snapshot size bounds | |
| `source-history.ts` | 37 | `SourceHistory` + checkpoint schema | |
| `project-starters.ts` | 450 | TypeScript starter + `addTypeScriptBackend` scaffolder | |
| `workers-starter.ts` | 98 | Workers-runtime starter | |
| `managed-app-scaffold.ts` | 15 | Managed backend scaffold entry | |
| `templates.ts` + `templates/pulseboard.ts` | 359+676 | Starter templates | pulseboard is a full template app |
| `project-runtime-client.ts` | 244 | Runtime service client (`runtimeRequest`, `useProjectRuntime`) | |
| `builder-service.ts` | 151 | Builder DO service: MCP config, attachments storage | |
| `builder-tools.ts` | 61 | MCP Streamable-HTTP tool discovery | |
| `builder-client.ts` | 12 | Builder request helper | |
| `builder-attachments.ts` | 55 | Attachment validation (image MIME sniffing) | |
| `read-upload.ts` | 59 | Upload reader | |
| `publish-project.ts` | 56 | Publish orchestration client | |
| `pending-chat-request.ts` | 37 | Queued prompt across project switch | |
| `business-apps.ts` | 17 | Onboarding audience presets | |

### Platform services / misc
| File | Lines | Role | Notes |
| :--- | ---: | :--- | :--- |
| `events.ts` | 102 | Type-safe pub/sub bus (`appEvents`) | |
| `status-store.ts` | 204 | Platform status store (build state per project) | |
| `analytics.ts` | 52 | GA on public pages only | |
| `product-outcomes.ts` | 52 | First-party outcome counters (no content) | |
| `project-growth.ts` | ~150 | Onboarding state, usage events, reliability settings persistence | |
| `email.ts` | 106 | Contact/auth email HTTP handlers | |
| `email-client.ts` | 9 | Resend client | |
| `email-registry.ts` | 51 | Registry-side email token handling | |
| `managed-providers.ts` | ~120 | `ManagedProviders` entrypoint for the runtime Worker | |
| `migrations.ts` | 170 | DO SQLite migration runner | |
| `concurrency.ts` | 193 | `BusyLock`, `IdempotencyStore`, `WriteEpoch`, dedupe | |
| `timeouts.ts` | 16 | Shared TTL/timeout constants | |
| `utils.ts` | 103 | Path normalization, safety checks | |
| `lucide-compat.ts` | 45 | Legacy lucide icon aliases | |
| `prism-loader.ts` | 90 | Prism global bootstrap | |
| `theme.ts` | 39 | Theme get/set/persist | |
| `brand-image.ts` | 2 | Inline logo PNG (base64) | |
| `runtime-config.ts` | 78 | Provider credentials map, endpoint validation (Dahl removed) | |

---

## 4. `src/runtime/` — Managed Hosting Worker (`brainhalf-runtime`)

| File | Lines | Role | Notes |
| :--- | ---: | :--- | :--- |
| `worker.ts` | 108 | `RuntimeControl` entrypoint; pilot gate, provisioning check, stop/delete bypass the kill switch | Reachable only via service binding |
| `project.ts` | 1,034 | `ProjectRuntime` DO: jobs (build/verify/publish), sandbox execution, artifact handling, outcome outbox, release registry | Largest runtime file |
| `pilot.ts` | ~250 | `PilotCoordinator` DO: per-account project registration (limit 10), leases, daily job limits | Limit test updated to 10 this batch |
| `availability.ts` | 35 | Runtime availability states (ready/pilot_only/disabled/setup_required) | |
| `provisioning.ts` | 49 | Dispatch-namespace provisioning check via Cloudflare API | |
| `cloudflare-api.ts` | 78 | Cloudflare API client (custom domains 503 without zone config) | |
| `types.ts` | 85 | `RuntimeError`, scopes, `PILOT_LIMITS` (projects 10, sandboxes 2, uploads 5 MB…) | |
| `env.ts` | 13 | `RuntimeEnv` binding types | |
| `source.ts` | 45 | Source digest/snapshot helpers | |
| `artifact.ts` | 35 | Built-artifact validation (12 MB cap, index.html required) | |
| `publication.ts` | 35 | Production publication flow | |
| `verification.ts` | 154 | Behavioral verification of built apps per source revision | |
| `managed-store.ts` | 104 | Managed app data store (D1 via API) | |
| `managed-auth.ts` | 211 | Managed app auth (signup/login for generated apps) | |
| `managed-mail.ts` | 151 | Managed app email (daily cap 20) | |
| `managed-capability.ts` | 18 | Capability verification | |
| `managed-types.ts` | 39 | Managed service types | |
| `database-tools.ts` | 41 | SQL identifier validation + table reads | |
| `integrations.ts` | 36 | Integration readiness (email/Google) | |
| `mail-provider.ts` | 36 | Mail provider abstraction | |
| `secrets.ts` | 48 | Per-project secret handling | |
| `uploads.ts` | ~120 | Project file uploads (5 MB/100 files/2 parallel caps) | |
| `request-monitor.ts` | 23 | Runtime request metrics | |
| `auth-page.ts` | 16 | Hosted app auth page | |
| `generated.d.ts` | 15,749 | Generated `RuntimeBindings` (from `wrangler types`) | Do not hand-edit |

---

## 5. `src/components/` — UI Layer (46 components)

### Workspace core
| File | Lines | Role | Notes |
| :--- | ---: | :--- | :--- |
| `Workspace.tsx` | 1,872 | Main IDE: editor, preview, split view, toolbar, action menu, console drawer | Was 2,193 — GitHub modal extracted this batch |
| `GithubSyncModal.tsx` | 408 | **New.** `useGithubSync` hook + modal (export/import/auto-sync, focus trap, Escape) | |
| `ChatPanel.tsx` | 2,237 | AI chat, model picker, attachments, streaming, message actions | Remaining god file |
| `PreviewRunner.tsx` | ~700 | Sandboxed preview runtime (module registry, inspect mode, context menu, error panel, file-sync watchdog, dependency-load retry) | |
| `PreviewCanvas.tsx` | 68 | Preview toolbar (viewport switcher, refresh, inspect, popout) | |
| `FileExplorer.tsx` | 267 | File tree with CRUD + context actions | |
| `CommandPalette.tsx` | 200 | Ctrl+K fuzzy file/action palette | Unused imports cleaned this batch |
| `CodeFileBlock.tsx` | 315 | Code card in chat (syntax highlight) | |
| `DiffEditBlock.tsx` | 237 | Edit-pair card | |
| `CommandBlock.tsx` | 65 | Shell-command card | |
| `PlanBlock.tsx` | 37 | Plan card | |
| `AssistantMarkdown.tsx` | 19 | Markdown renderer wrapper | |
| `ToolSummary.tsx` | 10 | Tool call summary chip | |
| `AgentTracker.tsx` | 321 | Live agent step tracker (+ 424-line CSS) | |
| `AgentTools.tsx` | 111 | MCP server management UI | |
| `BuildProgress.tsx` | 22 | Build progress chip | |
| `GenerationProgress.tsx` | 88 | Streaming progress bar | |
| `HtmlPreview.tsx` | 101 | HTML sandbox preview variant | |
| `ActionMenu.tsx` | 119 | Dropdown action menu primitive | |
| `ConfirmModal.tsx` | 195 | Confirmation dialog primitive | |
| `ErrorBoundary.tsx` | 214 | App error boundary | |
| `TopNav.tsx` | 219 | Workspace top navigation | |

### Project console cluster
| File | Lines | Role | Notes |
| :--- | ---: | :--- | :--- |
| `ProjectConsole.tsx` | 140 | Console shell — 9 flat sections (UX-flagged: needs intent grouping) | |
| `ProjectDatabase.tsx` | 244 | D1 table browser | |
| `ProjectFiles.tsx` | 50 | Uploaded files manager | |
| `ProjectHistory.tsx` | 254 | Source history (checkpoints, inline diff, restore) | JSX type fixed this batch |
| `ProjectServices.tsx` | 71 | Auth/email services config | |
| `ProjectMonitor.tsx` | 12 | Monitoring stub-thin wrapper | |
| `ProjectAgentUsage.tsx` | 57 | AI usage display | |
| `ProjectConnections.tsx` | 26 | Connections section | |
| `ProjectGrowthHub.tsx` | 54 | Growth/onboarding hub | |
| `PublicationControls.tsx` | 258 | Publish/unpublish/take-offline controls | |
| `CustomDomainSettings.tsx` | 192 | Custom domain attach/detach | Depends on zone config |
| `PublishDialog.tsx` | 362 | Publish workflow dialog | |

### Public / auth
| File | Lines | Role |
| :--- | ---: | :--- |
| `LandingPage.tsx` | 353 | Landing page (+ 249-line CSS) |
| `LandingShowcase.tsx` | 92 | Showcase strip |
| `LandingFooter.tsx` | 27 | Footer |
| `DashboardPage.tsx` | 182 | Projects dashboard |
| `RecentProjects.tsx` | 181 | Recent project cards |
| `LoginScreen.tsx` | 121 | Signup/login/reset forms |
| `AccountPage.tsx` | 47 | Account settings page |
| `ContactForm.tsx` | 28 | Contact form |
| `PublicPage.tsx` | 53 | Public prerendered pages shell |
| `BrainHalfLogo.tsx` | 51 | Shared logo |
| `ThemeToggle.tsx` | 11 | Dark/light toggle |

---

## 6. `src/seo/`, styles, assets

| File | Lines | Role |
| :--- | ---: | :--- |
| `seo/content.ts` | 193 | Public page content definitions |
| `seo/growth-pages.ts` | 37 | SEO landing/growth pages |
| `seo/metadata.ts` | 33 | Metadata + private-search detection |
| `seo/render.tsx` | 48 | Prerender renderer |
| `index.css` | 2,516 | Global design system (dark palette #09090b-based — UX-flagged as flat/dark-grey) |
| `styles/studio-workspace.css` | 455 | Workspace layout styles |
| `styles/studio-theme.css` | 240 | Theme variables |
| `assets/` | — | Logo/brand assets |

---

## 7. Configuration Files

| File | Role | Notes |
| :--- | :--- | :--- |
| `wrangler.toml` | Main Worker config (routes, DOs, R2, dispatch, runtime service, observability 5%) | DO migration-safety comment is excellent |
| `wrangler.runtime.jsonc` | Runtime Worker (containers, browser binding, dispatch, pilot vars) | `PILOT_OWNER_IDS` gates hosting |
| `package.json` | Scripts incl. `verify` (typecheck+test+lint+build), `prepare` (installs `.githooks`) | dompurify override documented |
| `vite.config.ts` | Vite + dev backend middleware + vitest config + `cloudflare:workers` alias | 14k chars — dev middleware is sizeable |
| `vite.preview.config.ts` | Preview iframe bundle build | |
| `vitest.runtime.config.ts` | Runtime suite config | |
| `tsconfig.json` / `tsconfig.node.json` / `tsconfig.runtime.json` | Strict TS; runtime excluded from main project | |
| `.oxlintrc.json` | oxlint (react/hooks/oxc plugins) | Several react-compiler rules off by choice |
| `playwright.config.ts` / `.live` / `.seo` | Three e2e profiles | |
| `.github/workflows/validate.yml` | CI: now runs full `npm run verify` **before** `verify:release` (previously tests were not gating) | Fixed this batch |
| `.githooks/pre-push` | Local gate: typecheck + both vitest configs | New this batch |
| `Dockerfile.runtime` | Sandbox container image (64 bytes) | |

---

## 8. Scripts (`scripts/`)

`deploy.mjs`, `deploy-platform.mjs`, `verify-release.mjs` (packaging/validation — does **not** run tests; CI now covers that), `check-secrets.mjs` (deployment secret validation; Dahl refs removed), `wrangler.mjs` (wrangler wrapper), `prerender.mjs`, `check-seo.mjs`, `check-runtime-local.mjs`, `check-agent-local.mjs`, `live-auth.mjs`, `test-business-apps.mjs`, `test-live-model-apps.mjs`, `test-trip-planner.mjs`, `trip-planner-harness.mjs`, `prepare-trip-fixture.mjs`, `browser-test-trip-planner.mjs`, `audit-fullstack-live.mjs`, `audit-public-platform.mjs`, `setup-provisioning-token.mjs` + 7 script test files (36 subtests passing).

---

## 9. Test Landscape

| Suite | Files | Tests | State |
| :--- | ---: | ---: | :--- |
| `src/__tests__` (vitest main) | 98 | 1,040 | All passing |
| `runtime-tests` (vitest runtime) | 3 | 102 | All passing |
| `scripts/__tests__` (node:test) | 7 | 36 | All passing |
| `tests/` (playwright e2e/benchmark/chaos) | ~60 specs | 128 local-gate | Local-gate suite green (128/128; 2 specs are load-sensitive under 4-way parallelism and pass in isolation) |

---

## 10. Cross-Cutting Issue Index (all confirmed this session)

1. **God files**: `agent.ts` 3,163 / `ChatPanel.tsx` 2,237 / `Workspace.tsx` 1,872 (improved from 2,193). Every feature touches them → regression coupling.
2. **Dual file-state truth**: `project-store.ts` (IndexedDB/localStorage) vs DO SQLite; `workspace-reconciliation.ts` exists only because of this split; root of the race-condition bug class.
3. ~~**Preview reliability**~~ FIXED: file-sync watchdog re-requests files 5× then shows a real error; dependency CDN loads have a 20s timeout + 2 auto-retries; a failed load retries on the next file sync; any fresh sync clears stale error panels (`PreviewRunner.tsx`).
4. ~~**Generation failure UX**~~ FIXED: `src/lib/generation-errors.ts` classifies provider failures (rate-limit/overload/network/timeout/context/auth); transient classes auto-retry per stage (2 attempts, backoff, user-notified via `generation_notice`) and final errors reach the client with a `provider_busy`/`context_length`/`provider_auth` code + friendly copy (`ChatPanel.tsx`).
5. **Dark theme flatness**: near-black + dark-grey surfaces, no elevation system (`index.css`).
6. **Console UX**: 9 flat jargon-heavy sections (`ProjectConsole.tsx`).
7. ~~**`any` residue**~~ FIXED: all 38 `: any` annotations in `agent.ts` and 12 in `model-tester.ts` replaced with real types — `ClientMessage` WS payload type, typed tracing spans (`vite-env.d.ts`), `ProviderLanguageModel` for ai-sdk models, structural Workers AI stream/payload types, `errorMessage()` helper for unknown catch bindings. Only deliberate `any` left: heterogeneous SQL bind values in `runSql`.
8. ~~**E2E debt**~~ FIXED for the local gate: restored `src/lib/dev-auth-mock.ts` (deleted in `f6f7fd9`, broke every dev `/api/auth/*` route with 500 "Internal error"); restored the always-available "Open app preview" affordance in the preview health strips (regression from `6bf796d`); updated stale specs to the live-preview design (auto-embed ticket vs open ticket).
9. ~~**Rate limiting gaps**~~ FIXED: `/preview/*`, `/p/*`, and referer-matched `/api/*` preview traffic now metered per IP+project (120 reads/min, 30 writes/min) via the Registry DO; fails open on limiter outage so previews never go down with the rate-limit service; the workspace expired-session fast-path now keys on 401/403 so a 429 is never misreported as an expired session.
10. **Doc drift**: fixed this batch (MODELS/PLATFORM_INFO/ARCHITECTURE/TODO/SEO_HANDOFF/README); guard is CI + this analysis file.

---

## 11. Lovable-Parity Batch (2026-09-29, this session)

11. ~~**Stuck preview error state**~~ FIXED: a `preview-success` arriving while the builder was still finishing was dropped, leaving "Preview could not be loaded" until a manual refresh. Success during generation now clears stale error state without leaving 'Generating', and the terminal ready event only restarts the load cycle when no render has confirmed the final files — otherwise it forces one authoritative reload (`Workspace.tsx`).
12. ~~**Mid-generation module errors flipped the workspace to Error**~~ FIXED: transient "Cannot resolve module" reports while files are still being written no longer flip the workspace status or arm the load-timeout; they surface in the preview panel only and are cleared by the first successful render (`Workspace.tsx`).
13. ~~**No per-generation diff summary in chat**~~ FIXED: every generation now ends with a "N files changed" card in the chat — per-file added/edited/removed badges, +/− line counts from a real snapshot diff (`src/lib/file-diff.ts`, LCS with prefix/suffix trimming and a cell budget), expandable inline unified diff per file (session), click-to-open in the editor (`src/components/GenerationChanges.tsx`, `ChatPanel.tsx`). Cards persist locally and survive server-history restores via `mergeHistoryMetadata`.
14. ~~**Database tools were read-only-ish**~~ FIXED: the console database panel now shows a real schema view (tables with row counts; columns with type, primary-key, not-null and default badges) and supports per-row edit (JSON) and delete, each saving a recovery point first. Rows carry the implicit `rowid`; WITHOUT ROWID tables fall back to read-only (`src/runtime/database-tools.ts`, `src/runtime/project.ts`, `src/components/ProjectDatabase.tsx`).
15. ~~**Publish verification gate blocked on infrastructure flakes**~~ FIXED: verification distinguishes app check failures from infrastructure failures (browser launch, disposable D1 provisioning). Infra failures retry the whole run once before blocking; app check failures still block immediately (`verifyWithInfraRetry` in `src/runtime/project.ts`).
16. ~~**Project console was jargon-heavy and confusing**~~ FIXED: full redesign — plain-language sections grouped Ship/Run/Manage (Publish, Domain, Database, Files, Users & email, Monitoring, Source history, AI usage, Project settings), Test/Live environment switch with plain hints, guided 3-step "Get your app ready" flow (Build → Run checks → Try it live) with per-step status (Done/Next step/Needs attention), friendly job labels, "Make live" version rollback, collapsible activity log (`src/components/ProjectConsole.tsx`, `ProjectConsole.css`).
17. ~~**Console vanished on mobile**~~ FIXED: resizing desktop→mobile while the console/code/logs pane was open left it rendered but `display:none` — invisible with no way back. The workspace now pushes the open pane to the mobile tab state on breakpoint crossing (both directions), while keeping the chat-first mobile landing for the default preview tab (`Workspace.tsx`).
18. ~~**Malformed database responses crashed the whole workspace**~~ FIXED: `ProjectDatabase` validates response shapes before applying them; a bad/hung runtime API now shows an inline error instead of crashing into the workspace error boundary.
19. ~~**No visual schema editor**~~ FIXED: the console Database section can now create tables (typed columns with text/whole number/decimal/binary, primary key, required, defaults), add columns to existing tables (SQLite rules enforced — required columns need a default, no PK via alter), and remove columns (PK protected, last column protected). Every schema change saves a recovery point first and clears the verification stamp (`prepareCreateTable`/`prepareAddColumn`/`prepareDropColumn` in `src/runtime/database-tools.ts`, `/database/schema/*` endpoints in `src/runtime/project.ts`). Verified that auto-wired auth (#1 second half) is already complete: managed auth endpoints + hosted auth pages exist (`src/runtime/managed-auth.ts`, `auth-page.ts`) and the system prompt instructs the builder to wire them into every app that needs accounts.
20. ~~**GitHub sign-in for generated apps missing**~~ FIXED: generated apps can now offer "Continue with GitHub" alongside Google. Custom-credentials only (no managed GitHub app exists): the owner pastes a GitHub OAuth client ID/secret under Users & email → Custom provider connections, enables the GitHub toggle, and the hosted sign-in page shows the button automatically. Full PKCE-style state flow: `/api/auth/github/start` (browser-bound one-time state, rate-limited) → `/api/auth/github/callback` (state equality check, code exchange, primary verified email required) → account linking by `github_id` with email-match merge that never keeps an unverified attacker's password. `managed_users` gained a `github_id` column via a guarded migration (`ensureManagedSchema` in `src/runtime/managed-store.ts`) so existing project databases upgrade in place. Publish gate blocks production when GitHub is enabled without credentials (`assertProductionServices`); `GET /api/auth/config` reports `githubReady`; system prompt documents the endpoint for the builder. Tests: `src/__tests__/github-oauth.test.ts` (exchange + credential validation), `runtime-tests/github-oauth.test.ts` (full flow: state binding, one-time use, identity reuse, email linking, disabled/unconfigured gates, schema migration), `tests/nontechnical-flow.spec.ts` (hosted page shows/hides the button per readiness).
21. ~~**No public remix gallery**~~ FIXED: BrainHalf now has Lovable-style public remixing. Owners list a published app from the console Publish section ("Gallery" card in `src/components/GalleryListing.tsx`); listing requires the app to be live first. The public `/gallery` page (`src/components/GalleryPage.tsx`, prerendered + sitemap + llms.txt entries) shows showcased apps with description and remix count, links each live app at `/p/<id>/`, and offers Remix (signed-in) or "Sign in to remix". Remix flow: `POST /api/projects/:id/remix` → registry atomically creates the caller's copy (`<name> (remix)`) with quota enforcement and increments the source's remix counter → Worker pulls `/internal/remix-export` from the source agent (authorized by the registry showcase flag, secrets filtered by `isBlockedSecretFile`) → pushes `/internal/remix-import` into the new project agent (owner-verified, generation-lock guarded, replaces starter content transactionally, backs up to R2); a failed copy deletes the new project so nothing broken is left behind. Unlisting stops new remixes; existing copies stay with their owners. Tests: `src/__tests__/gallery.test.ts` (7: listing privacy, owner gates, publish-first rule, status endpoint, remix naming/count/quota, legacy migration), `src/__tests__/worker.test.ts` (3: orchestration, cleanup on failure, auth/registry rejection), `tests/gallery.spec.ts` (browser: cards, live links, empty + failure states, mobile width).
22. ~~**No monetization path (AdSense)**~~ FIXED: Google AdSense verification script (`ca-pub-8643322366786400`) is injected after `<!--seo-head-end-->` in `index.html` so it survives SEO prerendering (verified in `dist/index.html`), and `public/ads.txt` carries the authorization line. CSP was widened in BOTH `shellSecurityHeaders()` (`src/worker.ts`) and `public/_headers` (kept in sync by the drift test) for `pagead2.googlesyndication.com`, `googletagservices.com`, and the DoubleClick frames/connections ads require. Policy compliance: the privacy page gained an "Advertising" section disclosing Google's advertising cookies and opt-out links (adssettings.google.com, aboutads.info/choices) as AdSense Program Policies require. No ad units are placed yet — only the site-verification script loads, so nothing renders inside signed-in workspaces or generated apps.
23. ~~**Navbar and footer were plain**~~ FIXED: full redesign. The landing header is now sticky with a blurred translucent backdrop (`position: sticky; backdrop-filter: blur(14px)` on `.landing-header`) and pill-style nav links with rounded hover states and `aria-current` support; the mobile menu gained Gallery, Build guide, and About links. The footer (`src/components/LandingFooter.tsx`) is now a real sitemap: brand column with tagline, four link columns (Product, Resources, Use cases, Legal) covering every public page, and a bottom bar with copyright and legal links — collapsing to a two-column grid on tablet and a stacked layout on phones. Fixing the sticky header required switching `body`/`#root` from `overflow-x: hidden` to `overflow-x: clip` in `src/index.css`: `hidden` turns `#root` into a scroll container that never scrolls, which silently disables `position: sticky` for everything inside it; `clip` clips horizontal overflow identically without creating a scroll context. Verified with Playwright: header pinned at top:0 after scroll, no horizontal overflow, menu and footer screenshots at desktop and mobile widths.
24. ~~**Header controls differed on every page**~~ FIXED: one shared `src/components/SiteHeaderActions.tsx` now renders the same control group everywhere — Dashboard button, theme toggle, and user menu (avatar + email + dropdown with Dashboard/Sign out) for signed-in visitors; Sign in/Get Started (landing, modal-driven) or a Start building link (standalone pages) when signed out. Used by `LandingPage`, `GalleryPage`, `PublicPage`, `DashboardPage` (with `hideDashboard` and the AI-usage block as lazy `menuExtra`), and `AccountPage`. Standalone pages self-detect the stored session (`getToken`/`getUser`) after mount so prerendered HTML stays hydration-safe; the default sign-out path calls `logout()` and returns home. The workspace `TopNav` also gained a Dashboard button (icon on desktop, menu item on mobile) routed through a new `'dashboard'` workspace-exit intent so an in-flight generation is stopped and confirmed before leaving. Verified: typecheck, 1058+107 tests, and Playwright screenshots of signed-out/signed-in/menu-open/dark/mobile states.
25. **Veritas page audit (2026-09-29) fixes**: (a) JS error — CSP `connect-src` blocked AdSense sodar telemetry at `ep1.adtrafficquality.google`; added `https://*.adtrafficquality.google` to `connect-src` in `src/worker.ts`, `public/_headers`, and the drift test. (b) Tap targets — 27 small/crowded targets: example tabs now 44px desktop / 48px mobile (`LandingShowcase.css`), the "Start from a guide" strip links are now 48px pill chips instead of inline text links (`LandingPage.css`), and footer links grew from 32px to 40px with wider gaps. (c) GEO — homepage gained a "The network under your app" proof section with citable figures (~50 ms from 95% of the Internet-connected population, 300+ cities) sourced to cloudflare.com/network, addressing both the thin-statistics and no-cited-sources findings; `HOME_MODIFIED` bumped. NOT code-fixable, reported to owner: the backlink profile (79% identical spam anchors — needs Google Search Console disavow, not code) and missing social profile links (needs real Facebook/X/Instagram/LinkedIn URLs to add to the footer + Organization `sameAs`).

---

## 12. Full Re-Read Sweep (2026-09-29, second pass)

Every source file was re-read line by line: all of `src/runtime/` (21 files), `src/worker.ts`, `src/registry.ts`, `src/agent.ts`, all of `src/lib/` (~90 files), all of `src/components/` (~45 TSX), `src/App.tsx`, `src/main.tsx`, `src/seo/*`, `scripts/*`, and all configs. Cross-checks: dependency usage per package, `dangerouslySetInnerHTML` sinks, `eval`/`new Function`, unescaped `innerHTML`, floating promises, timer/listener cleanup, duplicate object keys, localStorage JSON parsing, and console noise.

26. ~~**Dead dependencies in production install**~~ FIXED: `eslint` (^10.11.0) and `@axe-core/playwright` (^4.13.0) sat in `dependencies` with zero imports anywhere in `src/`, `scripts/`, `tests/`, or `runtime-tests/` (linting is `oxlint`; no eslint config exists). Both removed; the lockfile shed ~800 lines. Every other dependency was verified in use (`@ai-sdk/*`, `agents`, `sucrase`, `zod`, `jszip`, `pdfjs-dist`, `prismjs`, `react-markdown`, `remark-gfm`, `@cloudflare/sandbox`, `@cloudflare/playwright`, `@modelcontextprotocol/sdk`, `@monaco-editor/react`, `lucide-react`).
27. ~~**Leftover `[DEBUG]` logging on the auth hot path**~~ FIXED: `src/worker.ts` logged `console.warn('[DEBUG] authorizeOrClaim failed …')` on every rejected WebSocket connect and `console.warn('[DEBUG] authorizeProject returned: …')` with the full authorization payload on every project authorization — noisy in production logs and leaking claim structure into sampled traces. Both removed; the fail-closed `catch` logging remains.

### Audited and confirmed safe (previously suspected classes)

- **`dangerouslySetInnerHTML`**: two sinks — `CodeFileBlock.tsx` (Prism output; `Prism.highlight` HTML-escapes input) and `PreviewRunner.tsx` `<style>` tag (`</style` escaped). No raw user HTML reaches either.
- **No `eval` / `new Function`** outside the sandboxed preview iframe templates (isolated opaque-origin document).
- **Timers/listeners**: all `setInterval`/`setTimeout`/`addEventListener` sites in `Workspace.tsx`, `ChatPanel.tsx`, `PreviewRunner.tsx`, `DashboardPage.tsx` have matching cleanup on unmount.
- **localStorage JSON**: every `JSON.parse(localStorage…)` site is wrapped in try/catch with a fallback.
- **Empty `catch {}` blocks** in `worker.ts`/`agent.ts`/`registry.ts` (16 sites): all are deliberate non-failure paths (optional referer parsing, best-effort cache clears) documented inline.
- **`isPublicIp` IPv6**: compressed forms rejected before parse; no bypass.
- **npm audit**: could not run (registry network blocked in sandbox); the `dompurify` override already pins past the four known monaco advisories.

28. ~~**"Installing dependencies failed (exit 1)" on every project preview/build**~~ FIXED: three layers. (a) Root cause — `sourceSnapshot` (`src/runtime/source.ts`) let model-authored lockfiles (`package-lock.json`, `npm-shrinkwrap.json`, `yarn.lock`, `pnpm-lock.yaml`) through to the sandbox job, which then chose `npm ci`; a hallucinated lock never matches the generated `package.json`, so `npm ci` hard-fails every time. Lockfiles are now stripped at snapshot time (consistent with `agent-context.ts` and `workers-starter.ts`, which already excluded them), so resolution always runs fresh with `npm install`. (b) Resilience — a failed install step now retries once with plain `npm install` (`installRetried` flag on the stored job), recovering old R2 snapshots that still carry lockfiles and transient registry flakes; timeouts are not retried. (c) Diagnosability — the thrown error used to be a bare `failed (exit 1)`; `npmFailureSummary` (`src/runtime/project.ts`) now extracts the actionable npm lines (ETARGET/ERESOLVE/404/network) into the job message the UI shows, e.g. "Installing dependencies failed (exit 1). npm reported: ETARGET No matching version found for fake-dep@^9.9.9". Tests: lockfile stripping incl. nested-path preservation (`src/__tests__/fullstack-runtime.test.ts`), retry-then-pass and retry-then-named-failure through the full job alarm loop (`runtime-tests/project.test.ts`). NOTE: this fix lands on the branch — the live site keeps failing until deploy.

29. ~~**"Publishing stopped: Building application failed (exit 1)" hid the real cause and had no auto-repair**~~ FIXED: two layers. (a) The design preview runs Sucrase (types stripped, never checked), so TypeScript errors in generated code stay invisible until publish runs the real `tsc --noEmit && vite build` in the sandbox — publish then died with a bare "exit 1". `commandFailureSummary` (renamed from `npmFailureSummary`, `src/runtime/project.ts`) now also extracts `error TS…`, `Type error:`, `error during build`, Rollup/unresolved-import/transform errors into the job message, so the user sees e.g. "src/App.tsx(42,5): error TS2322: …" instead of an exit code. (b) `useAutomaticBuildFix` (`src/lib/automatic-build-fix.ts`) only watched failed `build`/`preview` jobs — failed **publish** jobs never triggered the repair flow. It now watches publish jobs too and extracts Vite/Rollup errors in addition to TS errors, so a failed publish automatically asks the agent for a surgical fix (still guarded by RepairBudget).

30. ~~**One WebSocket frame + one React render per streamed token**~~ FIXED: `sendDisplay` in `src/agent.ts` sent every single token as its own WS message (plus broadcast), thousands of frames per generation. Deltas now coalesce into 50 ms frames (~20 updates/sec — still smooth typing, ~100x fewer frames and client renders). Ordering is preserved: pending text flushes before every non-stream message (tool_call, files_changed, done) and at all completion/error boundaries. Compatible with existing tests, which join chunks and assert `done` is last.

31. ~~**Preview cold-start latency**~~ IMPROVED: the isolated preview HTML (`src/lib/preview-isolation.ts`) now preconnects to `https://esm.sh` so the import-map module fetches skip DNS+TLS setup on every preview load.
