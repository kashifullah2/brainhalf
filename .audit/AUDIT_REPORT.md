# BRAINHALF AUDIT REPORT — 2026-10-06
Mode: FULL. Auditor: automated principal-level audit. Evidence logs in .audit/logs/.

## 1. Executive Summary
Health score: 8.5 / 10
Formula: 10 − 1.0×High_confirmed − 0.3×Medium − 0.1×Low (1 High [dev-auth 403] + dep tree issues counted as Medium reachability, 3 Medium, 6 Low).
Counts: Critical 0 | High 1 | Medium 4 | Low 6 | Unverified 3.
Confidence: 9 CONFIRMED, 2 LIKELY, 3 UNVERIFIED.

Top problems:
1. (HIGH, CONFIRMED) Local dev signup/login/contact all fail with 403 — vite dev origin check never enables dev origins (vite.config.ts:95).
2. (MEDIUM, CONFIRMED) npm audit: proxy-addr critical + source-map-js high in dep tree (limited reachability — MCP sdk used client-only; source-map-js dev-only via vite/postcss).
3. (MEDIUM, CONFIRMED) Worker-side helpers (email.ts:94, google-auth.ts:40, model-tester.ts:260) call isAllowedOrigin without env, so `wrangler dev` rejects localhost despite IS_DEV=true in .dev.vars.
4. (LOW, CONFIRMED) Phantom dependency: scripts/prepare-trip-fixture.mjs imports undeclared `esbuild`; hardcodes /tmp + audit-artifacts paths.
5. (LOW, CONFIRMED) CI `npx wait-on` unpinned; env.CONTACT_EMAIL undocumented.

Verdict: Deployable now? YES for production — build, typecheck, lint, 1586 unit/script tests, prerender, SEO checks and the main-worker dry-run deploy all pass; production CORS/auth paths are correct and well-guarded. The one High bug only breaks the LOCAL dev experience (npm run dev), not production.

## 2. Coverage
- Fully read: src/worker.ts, src/runtime/worker.ts, vite.config.ts, src/lib/allowed-origins.ts, auth-client.ts, api-origin.ts, email-client.ts, dev-auth-mock.ts, main.tsx, seo/metadata.ts (relevant parts), wrangler.toml/jsonc, tsconfigs, CI workflow, package.json, Dockerfile.runtime.
- Partially read (targeted greps/traces): src/agent.ts (3992 lines), src/registry.ts (1247), src/components/* (~60 files), src/lib/* (~100 files), tests/*.
- Unread: generated.d.ts (554KB generated), worker-configuration.d.ts (generated), full e2e spec bodies.
- Commands run: typecheck, oxlint, vitest (main+runtime), node --test scripts, npm build, prerender+SEO, npm audit, wrangler dry-run (main OK), wrangler runtime dry-run (BLOCKED: no Docker daemon), git hygiene scans, live headless-Chrome probes (landing, modal, signup, gallery, 21 routes).
- Not run: full Playwright e2e suite (heavy; CI runs it), live-model tests (need provider keys/network), pip tools (N/A — no Python app code).

## 3. Findings Table (severity-sorted)
| ID | Severity | Confidence | Category | File:Line | Problem | Evidence | Impact | Fix |
|----|----------|-----------|----------|-----------|---------|----------|--------|-----|
| F1 | High | CONFIRMED | Connection/config | vite.config.ts:95 + src/lib/allowed-origins.ts:52 | Dev server rejects its own origin: isAllowedOrigin(origin) called without env; allowed-origins doc says "pass undefined to use the full list (e.g. the Vite dev server)" but implementation returns PRODUCTION_ORIGINS only for undefined. All dev POSTs (signup, login, forgot-password, resend-verification, contact) 403. | Live probe: `API 403 http://localhost:5173/api/auth/signup {"error":"Untrusted request origin"}`; modal shows "Untrusted request origin"; e2e tests bypass login by seeding localStorage (tests/fixtures/helpers.ts:26) so suite never catches it. | Documented local-dev flow (`npm run dev`) cannot sign up/log in; new contributors blocked. | In vite.config.ts pass { IS_DEV: true }, or make isAllowedOrigin(undefined) match its doc comment. |
| F2 | Medium | CONFIRMED | Dependency | package.json (via @modelcontextprotocol/sdk→express 5.2.1→proxy-addr 2.0.7) | Critical advisory GHSA-jqcg-44mw-7w3h in dep tree. Reachability LOW: only MCP client imports used (src/lib/builder-tools.ts:1-2); express server path never executed. | npm audit output in .audit/logs/audit.log. | Supply-chain hygiene; noise in audits. | npm audit fix / pin override. |
| F3 | Medium | CONFIRMED | Dependency | package.json (vite→postcss→source-map-js 1.2.1) | High advisory GHSA-68fv-2mgg-jv7q (event-loop DoS), dev/build-time only. | npm audit output. | Build-time DoS on crafted sourcemaps only. | npm audit fix. |
| F4 | Medium | CONFIRMED | Config inconsistency | src/lib/email.ts:94, src/lib/google-auth.ts:40, src/lib/model-tester.ts:260 | isAllowedOrigin called without env in Worker code: under `wrangler dev` (IS_DEV=true in .dev.vars) localhost is still rejected — inconsistent with the IS_DEV contract in allowed-origins.ts. | Code reading; worker.ts:165/310 pass env correctly, these three don't. | `wrangler dev` full-stack local testing 403s on email/google/model-test routes. (Vite dev stubs these, production unaffected.) | Thread env through RegistryEnv call sites. |
| F5 | Low | CONFIRMED | Phantom dependency | scripts/prepare-trip-fixture.mjs:1 | Imports 'esbuild' — not in package.json; works only via hoisting from agents/vite/wrangler. | `npm ls esbuild` shows only transitive copies. | Breaks silently if hoisting changes. | Add esbuild to devDependencies or use wrangler's bundled build API. |
| F6 | Low | CONFIRMED | Hardcoded paths | scripts/prepare-trip-fixture.mjs:4-9 | CWD-relative input audit-artifacts/2026-09-23/trip-planner and /tmp output paths. | File contents. | Script is single-machine scratch tooling. | Accept or parameterize. |
| F7 | Low | CONFIRMED | CI | .github/workflows/validate.yml:32 | `npx wait-on` not a declared devDependency — unpinned fetch at CI time. | grep package.json = 0 hits. | Supply-chain/flakiness risk in CI. | Add wait-on to devDependencies. |
| F8 | Low | CONFIRMED | Env docs | src/worker.ts:656 | env.CONTACT_EMAIL read but absent from wrangler.toml [vars] and .dev.vars.example. | grep of both files. | x-bh-test-inbox header silently never set. | Document in .dev.vars.example. |
| F9 | Low | CONFIRMED | Lint hygiene | 15+ sites (see .audit/logs/oxlint.log) | Unused imports/vars; Date.now() during render (BuilderOverlay:65, PreviewRunner:205, BackendBuildProgress:36/53, AdminPage:641). | oxlint output. | Cosmetic; unstable render values. | Remove/prefix with _, move Date.now into event/effect. |
| F10 | Low | CONFIRMED | Git hygiene | working tree | Uncommitted deletions of codebase-analysis-docs/*; .audit/ not in .gitignore. | git status. | Noise. | Commit/remove intentionally; ignore .audit/. |
| F11 | Medium | UNVERIFIED | Deploy | wrangler.runtime.jsonc containers | Runtime-worker dry-run deploy blocked: Docker daemon unreachable in audit sandbox (permission denied on /var/run/docker.sock). | .audit/logs/runtime-check.log. | Cannot verify container image build path; last successful deploy unknown. | Re-run `npm run runtime:check` with Docker access. |
| F12 | Low | UNVERIFIED | Models | src/lib/models.ts:49-86 | Model IDs (e.g. @cf/deepseek-ai/deepseek-v4-pro-0813, claude-sonnet-4-6, kimi-k3) not verified against provider catalogs (no network in sandbox). | Code listing. | Retired-model failures would surface at generation time. | Run `npm run test:live:apps` with keys. |
| F13 | Low | UNVERIFIED | E2E | tests/e2e/dead-ui-audit.spec.ts etc. | Full Playwright e2e not executed locally (long; CI runs with continue-on-error). | playwright.config.ts. | Dead-UI regressions could slip between CI runs. | Run npx playwright test when time allows. |

## 4. Broken Paths Table (Phase 2)
Script .audit/path-check.mjs checked 1873 relative imports: 117 flagged, ALL resolved as false positives (string-fixture imports in tests/templates, `?raw` suffix, .js→.ts mapping, virtual preview files). Real path findings: F5/F6 only. All public assets referenced by index.html/CSS exist (fonts, favicons, images, manifest, theme-init.js). No case-mismatch imports; no case-duplicate tracked files.

## 5. UI Trace (Phase 4)
Probed live with headless Chrome against `npm run dev`:
- Landing: all nav/CTA links valid (21/21 routes 200; no href="#"; no dead buttons; sign-in modal opens; zero console errors).
- Sign-in modal: tabs, Google button, forgot-password all wired; signup POST reaches backend — BROKEN in dev only by F1 (403).
- Hero "Start building": correctly disabled until prompt entered (by design).
- Gallery: /api/gallery fetched with AbortController; double-fire is handled StrictMode remount (not a bug).
- target="_blank" links all carry rel="noopener"/"noreferrer".
- /admin is lazy + noindex; unknown routes render "Page Not Found" (pageMetadata never returns undefined).

## 6. Connection Contracts (Phase 5)
Frontend→Worker: /api/auth/* (apiBase fetchers in auth-client.ts ↔ AUTH_ROUTES worker.ts:60-73 + handlers) MATCH; /api/projects GET/DELETE/PATCH ↔ worker.ts:663/804 MATCH; /api/projects/:id/publication GET/PUT ↔ worker.ts:784 MATCH (frontend auth-client.ts:310 sends exactly GET/PUT); /api/account/ai-usage, project-quota ↔ worker.ts:604/616 MATCH; /api/gallery ↔ worker.ts:699 MATCH; /preview/:id/* ↔ worker.ts:918 MATCH; /agents/* WS ↔ routeAgentRequest w/ auth gate MATCH.
CORS: allowlist-reflect, never `*` on platform API; preflight covers /api/ /agents/ /preview/ /p/; credentials+specific-origin (no wildcard conflict). Preview/runtime responses intentionally ACAO:* (public embeds) with cookies stripped (withPreviewPrivacy).
Env vars: all code-used bindings declared in wrangler configs (ChatAgent, REGISTRY, PILOT cross-script, PROJECT_BACKUPS, DISPATCHER, RUNTIME, AI, ASSETS; runtime worker: PROJECTS, PILOT, Sandbox, ARTIFACTS, DISPATCHER, BROWSER, PLATFORM). Only CONTACT_EMAIL undocumented (F8).
Bindings↔code: bidirectional match; dry-run deploy of main worker lists all bindings resolved.
Auth: PBKDF2 password hashing, HMAC-SHA256 session tokens, timing-safe compares, fail-closed verifySession, ws-ticket single-use flow, operator gate with email fallback (documented rationale). Protected routes enforced server-side; frontend merely hides.
Third-party: Resend, Google OAuth, GitHub, CF API, Anthropic/OpenAI/Bedrock/Atria via provider-clients — endpoints/headers consistent; SSRF guard in builder-tools.ts:14 (public HTTPS 443 only); prompt-injection guidance embedded in system-prompt.ts.
Connection Map: all links WORKING except: dev auth POSTs (F1 BROKEN), wrangler-dev origin-gated routes (F4 BROKEN in that mode), runtime container deploy (F11 UNVERIFIED), live model IDs (F12 UNVERIFIED).

## 7. Failure Modes (Phase 9, from code evidence)
- Rate limiter down: auth/modelTest fail CLOSED with 503 + message; previews fail OPEN deliberately (documented, worker.ts:147-154).
- Registry blip: integratedModelsEnabled fails open (documented, worker.ts:205).
- SESSION_SECRET missing/weak: all CORS-prefixed routes 503 authUnavailable (worker.ts:348); validSessionSecret enforces 32+ chars (auth.ts:55-58).
- Preview-runtime asset missing from deploy: explicit 503 JS stub with console.error (worker.ts:323-342).
- 410 deleted project at runtime → pilot slot unregistered (runtime/worker.ts).
- Double-submit/timeouts: frontend fetches carry AbortSignal.timeout; account-changed-mid-request guards in auth-client.ts.
- Malformed JSON in publication PUT → 400 (worker.ts:799).

## 8. Root-Cause Clusters
Cluster A — "allowed-origins refactor left call sites behind": F1 (vite.config.ts:95) + F4 (email/google/model-tester). Single conceptual fix: decide the undefined-env contract (full list per doc comment) OR thread env everywhere; then update all 4 call sites + doc comment consistently.
Cluster B — "dependency hygiene": F2 + F3; one `npm audit fix` (plus override if needed) resolves both.
Cluster C — "undeclared/unpinned tooling": F5 + F7; add esbuild + wait-on to devDependencies.

## 9. Fix Plan (awaiting your approval — no source modified)
1. (S, low risk) F1: pass `{ IS_DEV: true }` in vite.config.ts:95 origin check. Verify: dev signup probe returns 200.
2. (S, low risk) F2+F3: `npm audit fix`; re-run npm audit + build.
3. (S, low risk) F5+F7: add esbuild + wait-on to devDependencies; npm install; re-run CI script syntax check.
4. (S, low risk) F8: add CONTACT_EMAIL to .dev.vars.example comment block.
5. (M, medium risk) F4: thread env into email.ts/google-auth.ts/model-tester.ts isAllowedOrigin calls; re-run unit tests (registry/auth suites).
6. (S, low risk) F9: fix oxlint warnings (unused imports; Date.now in render).
7. (S) F10: decide codebase-analysis-docs deletions; add .audit/ to .gitignore.
8. (S) F11/F12 verification runs when Docker/network available.

## 10. Verification Checklist
- F1: `npm run dev`, then browser signup at localhost:5173 → expect 200 and workspace entry; or rerun .audit/ui-probe6.cjs expecting no 403.
- F2/F3: `npm audit --omit=dev` → 0 vulnerabilities; `npm run build` green.
- F4: `npm run wrangler dev` + curl -H 'Origin: http://localhost:8788' POST /api/auth/forgot-password → not 403.
- F5/F7: fresh `npm ci` + `node scripts/prepare-trip-fixture.mjs --help`-style import resolves; CI green.
- Regression: `npm run verify` (typecheck+tests+lint+build) all green; spot-run `npx playwright test tests/e2e/login-gate.spec.ts`.

## 11. Open Questions (only you can answer)
1. Is `wrangler dev` a supported local workflow, or is vite-dev the only intended one? (Decides F4 priority.)
2. Docker access for this machine — needed to verify the runtime-worker container deploy path (F11).
3. Should .audit/ and codebase-analysis-docs/ be kept, moved, or deleted?
4. Are the live provider keys in .dev.vars (ATRIA_API_KEY etc.) current — may I run `npm run test:live:apps` (it spends API quota)?
