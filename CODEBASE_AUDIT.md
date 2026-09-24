# Codebase Audit Report

## Summary

**Audit date:** September 20, 2026. **Repository:** BrainHalf. **Branch:** `fix/full-test-and-polish`. **Reference commit:** `3b4f3306c0057f0290eda7e2676bb9b5394f8e16`. Locations refer to the working-tree source reviewed, not the historical line estimates in `CODEX_HANDOFF.md`.

**49 distinct findings:** the original 48 plus one High-priority follow-up (F01) found during lifecycle verification on September 21. Totals: 2 Critical, 20 High, 24 Medium, 3 Low. Cross-cutting issues have one primary category and are counted once.

**Remediation status — September 21, 2026:** **46 findings are fixed in the working tree and locally verified; 3 remain open. All 2 Critical and 20 High findings are now fixed locally**, including C02 and F01. The remaining findings are 1 Medium and 2 Low; this is not remediation of the entire audit or production release clearance. No fixes have been deployed or committed. Original issue descriptions and locations preserve the pre-remediation snapshot; subsequent remediation entries describe their respective local fix passes.

| Severity | Original | Follow-up | Fixed locally | Remaining |
|---|---:|---:|---:|---:|
| Critical | 2 | 0 | 2 | 0 |
| High | 19 | 1 | 20 | 0 |
| Medium | 24 | 0 | 23 | 1 |
| Low | 3 | 0 | 1 | 2 |
| **Total** | **48** | **1** | **46** | **3** |

### Remediation log

**C02 — Fixed locally, September 21:** `src/lib/preview-isolation.ts:15` enforces an opaque execution origin using response CSP `sandbox allow-scripts`; `src/components/Workspace.tsx:1499` adds the matching iframe restriction. This is browser-origin isolation even though the navigation URL remains on the platform hostname. `src/preview-main.tsx:1` builds separately, refuses nonopaque execution and never imports platform auth/cache modules. Authorized navigation embeds filtered files; the runtime provides per-document app-only memory storage, memory routing and module loading without platform sessions. `src/worker.ts:188` rejects untrusted platform API/agent requests before using credentials, ignores platform identity for untrusted preview requests, and sanitizes cookie/storage/security headers on tenant and alternate agent responses. Worker-first routes in `wrangler.toml:20` prevent static-asset bypass. Preview messages are limited to the active frame, and AI fixes require explicit approval in the trusted dialog (`src/components/Workspace.tsx:804`). Tests cover actual malicious code, direct navigation without iframe flags, blocked legacy fallback, module compatibility and browser storage separation. Applications requiring durable storage or real deployed backend authentication need their own integration; these controls must not be relaxed to expose platform credentials. No production deployment or DNS-origin migration is claimed.

| Issue | Status | Change and verification |
|---|---|---|
| M17 | Fixed locally — September 21 | Pinned Wrangler 4.135.0 in the manifest/lockfile; `scripts/wrangler.mjs:20` resolves and checks that exact local version, never a global or auto-downloaded CLI. Secret checks, deploy and R2 lifecycle use the same wrapper. Node >=22.18.0 is enforced through engines, `.npmrc` and CLI validation; `.node-version` records 22.23.2. `scripts/deploy.mjs:4` uses one normalized config/environment target for both secret checks and deployment, rejects bypass flags and aborts on failed checks. Nine Node regressions cover strict JSON, provider policy, target forwarding, check failures, Node requirements, the actual pinned config parser and actual local CLI version. `npm run verify` and the pinned CLI's local `deploy --dry-run` pass. No live deployment was performed. |
| M19 | Fixed locally — September 21 | Removed ephemeral signing keys (`src/lib/auth.ts:51`). Missing, short, blank or wrong-type secrets fail closed; API/agent/preview routes return uncached 503 responses, while static shell/preflight remain available. Signup/login validate before body parsing or registry side effects; verification remains nonthrowing and denies access. `src/lib/runtime-config.ts:7` shares provider credential alternatives between deployment and generation, with explicit `REQUIRED_MODEL_PROVIDERS` policy and Cloudflare-only default deployment. Bedrock aliases and Atria aliases are consistent across generation/model testing; Atria URLs are validated and never treated as keys. `scripts/check-secrets.mjs:13` validates selected providers, binding names, local signing values and available endpoint config, rejects credentials in vars, and strictly parses remote secret names. Remote values remain unknowable from listings and are validated at runtime. Runtime/auth/Worker and mocked-provider regressions cover failures before inference, all Bedrock bearer transports, and safe Atria errors. Documented release prerequisites and the intentional Atria misconfiguration migration. |
| C01 | Fixed locally | Moved the waiting-state calculation below `status` initialization in `src/components/Workspace.tsx:262`, preserving hook order. Four initial-render regressions cover fresh, saved-starter, legacy and generated projects in `src/__tests__/workspace-initialization.test.ts:8`. |
| H01 | Fixed locally | Replaced array-as-scalar SQL bindings with JSON-backed SQLite membership queries in `src/agent.ts:2089`, `src/agent.ts:2328` and `src/agent.ts:2334`. Real SQLite tests exercise sibling, parent and extension fallback lookup in `src/__tests__/preview-module-regressions.test.ts:10`. |
| H02 | Fixed locally | Default-export alias detection in `src/agent.ts:2388` no longer emits reserved words as export names. Regressions parse anonymous function, async function, class, arrow and null exports and retain named-component aliases. |
| H04 | Fixed locally | `src/App.tsx:292` keeps chat/workspace mounted across mobile tab changes. Browser coverage confirms the same socket stays open and file updates persist while preview is visible. |
| H05 | Fixed locally | `src/lib/pending-chat-request.ts:1` owns a consume-once send, cleanup callbacks and a UUID idempotency key. Removed competing send paths in `src/components/ChatPanel.tsx:316` and `src/components/ChatPanel.tsx:910`; unit and delayed-ticket browser tests verify one prompt delivery. |
| H06 | Fixed locally | Stop/unmount cancel pending requests, connection-time sends, context waiters and queued auto-send timers in `src/components/ChatPanel.tsx:685` and `src/components/ChatPanel.tsx:748`. Browser regression stops a prompt before its ticket arrives and verifies no prompt is transmitted. |
| H07 | Fixed locally | History handling in `src/components/ChatPanel.tsx:328` renders conversation history without replaying old file/edit blocks into the workspace. Browser regression preserves a newer manual edit despite older generated files in history. |
| H08 | Fixed locally | `src/agent.ts:729` accepts the UI's `ai` role and persists it as `assistant`. `src/__tests__/history-rewrite.test.ts:1` exercises the actual message handler against SQLite. |
| H10 | Fixed locally | `src/lib/project-store.ts:367` hydrates from IndexedDB before trusting old local cache, guards against intervening edits/deletions, and removes stale local entries after failed quota writes. `src/components/Workspace.tsx:479` waits before seeding/persisting a starter; context requests also wait at `src/components/Workspace.tsx:606`. Four quota/race unit tests and two real-browser IndexedDB reload tests cover stale and absent local caches, including files sent back to the socket. History hydration follows the same guarded storage pattern. |
| H13 | Fixed locally | `src/lib/tenant-request.ts:1` strips platform credentials, internal identity headers and token-bearing query parameters before dispatch; integrated at `src/worker.ts:350`. Request/body-preservation unit tests and the gateway dispatch test pass. This does not resolve C02; generated-app session transport is addressed separately under H11. |
| H15 | Fixed locally | Primary project opening is a native button in `src/components/LandingPage.tsx:389`, separate from its action menu. Browser regression focuses it and opens the project with Enter. |
| H16 | Fixed locally | `package.json:10` adds a typecheck → unit tests → lint → production build gate, required by `predeploy`; deployment still checks secrets. `src/__tests__/verification-gate.test.ts:1` protects the command chain. |
| H17 | Fixed locally | Message actions remain mounted and appear on keyboard focus, hover or touch via `src/index.css:3378`. Browser regression reaches Edit by keyboard and verifies the action group is visible. |
| H18 | Fixed locally | `src/components/ChatPanel.tsx:805` stages message editing, preserves the previous draft and offers Cancel. History is rewritten only when the edited prompt is submitted, with the consequence explained. Browser regression verifies no rewrite on edit/cancel and one rewrite on submission. |
| H19 | Fixed locally | Enabled Publish uses white on `#0369a1` in `src/components/Workspace.tsx:990`. Browser regression calculates contrast from computed styles and requires at least 4.5:1. |
| M03 | Fixed locally | Ticket acquisition has an in-flight guard and checks mount/socket state after awaiting authentication in `src/components/ChatPanel.tsx:241`. Browser regression leaves for Home before a delayed ticket completes and observes no orphan connection. |
| M04 | Fixed locally | `streamText` now receives configured agent tools and tool policy (`src/agent.ts:1325`) with `toolChoice: 'auto'` and bounded tool steps. `src/__tests__/agent-tools-wiring.test.ts:1` verifies tool wiring reaches the model invocation. |
| M05 | Fixed locally | `src/components/PreviewRunner.tsx:125` increments a revision on file sync and remounts the error boundary at `src/components/PreviewRunner.tsx:425`. An actual fallback iframe throws during render, receives corrected source and renders successfully without reloading. |
| M06 | Fixed locally | Added only `https://api.github.com` to shell `connect-src` in `src/worker.ts:141` and `public/_headers:18`. Header drift/allowlist tests pass. No GitHub request with a real token was made. |
| M07 | Fixed locally — September 21 | Worker rate limits now execute against durable Registry state (`src/worker.ts:47`, `src/registry.ts:177`) instead of isolate memory. Added a `rate_limits` table and `/rate-limit/check` endpoint in the AuthRegistry DO; auth and model-test gates consult it per request. `src/__tests__/worker.test.ts:396` and `src/__tests__/worker.test.ts:412` verify 429 enforcement for both buckets. |
| M09 | Fixed locally — September 21 | DO-served preview index now uses the same isolated runtime contract as Worker-served preview (`src/agent.ts:2045`), embedding filtered snapshot files through `isolatedPreviewHtml(...previewFiles(...))` instead of legacy import-map/harness HTML. This removes a major contract divergence between preview paths while keeping existing API/module routes for compatibility. Regressions for project access, preview isolation and module serving pass (`src/__tests__/project-access.test.ts`, `src/__tests__/preview-isolation.test.ts`, `src/__tests__/preview-module-regressions.test.ts`, `src/__tests__/worker.test.ts`). |
| M10 | Fixed locally — September 21 | `src/lib/events.ts:1` now defines typed app event contracts, including dynamic `workspace-context-response-*` and `command-result-*` channels, replacing `any` payload plumbing for core workspace/chat flows. Call sites were tightened in `src/components/ChatPanel.tsx:329` and `src/components/Workspace.tsx:301`. `src/__tests__/events.test.ts:1` remains green under strict typing. |
| M11 | Fixed locally | Shared `src/lib/use-modal-focus.ts:5` supplies focus containment, top-modal Escape handling and restoration for Login, Confirm, Deploy, Settings and Rename. Added missing dialog/input semantics and retained the existing GitHub focus implementation. Browser tests exercise forward/reverse Tab, Escape and restored triggers across all five affected dialog types. |
| M12 | Fixed locally | Unimplemented landing attachment/voice controls and chat voice input are explicitly disabled with honest accessible names/tooltips in `src/components/LandingPage.tsx:323` and `src/components/ChatPanel.tsx:1784`. Browser assertions verify disabled state. |
| M13 | Fixed locally | Landing has an associated visible label at `src/components/LandingPage.tsx:299` and a real focus outline at `src/index.css:2552`; chat has an explicit composer label. Browser regression verifies the computed focus outline and locates both composers by label. |
| M14 | Fixed locally — September 21 | Increased recent-project snippet and timestamp contrast/readability in `src/index.css:2866` and `src/index.css:2875`. Browser contrast regression for the remediated selectors passes (`tests/audit-remediation.spec.ts`). |
| M15 | Fixed locally — September 21 | Preview runtime no longer statically bundles the full Lucide namespace; the runtime resolves icon exports from loaded dependencies (`src/components/PreviewRunner.tsx:13`). Build output shrank from ~1.17 MB to ~434 KB for `dist/preview-runtime.js` in local measurements, while preview external-module regressions still pass. |
| M16 | Fixed locally — September 21 | Workspace now syncs deltas (`sync-files-delta`) after initial file transfer (`src/components/Workspace.tsx:345`), and PreviewRunner applies changed/removed paths with transpile caching (`src/components/PreviewRunner.tsx:254`). Browser regression confirms persisted revisions still reach active previews (`tests/audit-remediation.spec.ts`). |
| L02 | Fixed locally — September 21 | Recent-project thumbnails now reflect project archetypes inferred from title/first prompt (`analytics`, `workflow`, `commerce`, `chat`, `forms`, fallback app) with distinct miniature layouts/icons in `src/components/LandingPage.tsx:66`. Supporting thumbnail styles were expanded in `src/index.css:2885` to avoid generic identical placeholders while preserving compact card size. |
| M20 | Fixed locally | Native buttons replace landing brand/breadcrumb and top-nav rename actions. `src/App.tsx:308` exposes a focusable separator with value/range semantics and Arrow/Home/End/Enter resizing; pointer and keyboard limits agree. Browser regression renames and resizes using only keys. |
| M21 | Fixed locally | Replaced the close-shaped destructive toolbar control with a labelled Reset workspace action in the overflow menu at `src/components/Workspace.tsx:911`. Browser regression dismisses confirmation and verifies files are unchanged. |
| M22 | Fixed locally | Chat's shared generation state is a polite, atomic status region at `src/components/ChatPanel.tsx:1688`; top-nav status has semantics without duplicate live announcements. `src/components/CommandBlock.tsx:49` includes textual Pending/Running/Completed state. Browser regression verifies the chat announcement attributes; manual assistive-technology testing remains advisable. |
| M23 | Fixed locally | Login overlay/card scroll and the card is bounded by the dynamic viewport at `src/components/LoginScreen.tsx:114`. Browser regression exercises the modal at 720×320, tabs through controls and verifies the submit button can be brought inside the viewport. |
| M24 | Fixed locally | Shared `.minimum-hit-target` at `src/index.css:2119` expands tab-close, message-copy and code-dropdown controls to at least 28×28 without enlarging icons. Browser regression measures all three actual hit areas. |
| H03 | Fixed locally | Shared entry selection in `src/lib/preview-entry.ts:15` prefers generated code over a seeded JSX starter and respects explicit non-starter main imports. Workspace publication eligibility, fallback rendering, edge harness imports and direct edge fallback use that decision (`src/agent.ts:2045`, `src/agent.ts:2069`). Tests cover both starter templates, reversed file insertion order, bare paths, explicit imports, relative module URLs, safe HTML insertion, actual SQLite harness serving, Workspace rendering and browser TSX rendering. |
| H09 | Fixed locally | Schema migration 3 (`src/lib/migrations.ts:56`) persists a revision incremented by every file insert/update/delete. `src/agent.ts:706` serves versioned, request-scoped pages with raw-row cursors; secret filtering and encoded-byte limits cannot stall or repeat pages. `src/lib/file-snapshot.ts:1` buffers all pages, validates order/revision/size, ignores abandoned responses and preserves concurrent local additions/edits/deletions before atomic replacement. Empty snapshots are intentional replacements; failed, stale, disconnected and unsupported legacy transfers preserve existing data. HTTP/backup collectors now complete all pages rather than silently truncating at one page (`src/agent.ts:307`), with an explicit 64 MiB transfer limit. Snapshot application no longer echoes an entire downloaded workspace back through the smaller write-message limit. SQLite, assembler and browser regressions cover >200 files, byte truncation, secret rows, persisted revisions, stale restarts, interruptions, concurrent edits and empty results. No remote schema migration has been run. |
| H11 | Fixed locally | `src/lib/app-session.ts:1` distinguishes generated-app bearer tokens from platform credentials. Preview gateway verification uses the platform cookie without consuming or replacing the app bearer/body (`src/lib/auth.ts:145`, `src/worker.ts:384`); an app bearer alone does not authenticate platform access. The DO forwards only a token belonging to an active session in that project's own simulated store (`src/agent.ts:73`, `src/agent.ts:2005`). Gateway tests and actual handler signup/profile/login/logout tests pass, including other-project, unknown/revoked-token and platform-credential rejection. Publication ACLs and true tenant-origin isolation remain separate open findings. |
| M01 | Fixed locally | After persisting a file sync, the DO acknowledges its revision (`src/agent.ts:802`). Chat forwards that acknowledgement to the active workspace, which notifies the iframe (`src/components/Workspace.tsx:650`). Edge HTML debounces reloads only for newer persisted revisions, validates sender/origin, and requests the latest acknowledgement on load (`src/lib/preview-templates.ts:275`). Duplicate notifications cannot produce a reload loop. Removed the redundant generation-ready reload that raced persistence. Unit coverage verifies the persisted acknowledgement; browser tests cover the WS-to-iframe path, late listeners, actual emitted edge HTML/harness reloading, duplicate revisions and forged messages. |
| M02 | Fixed locally | `src/lib/status-store.ts:15` now maintains per-project generation state and separate preview errors. A generation Ready event cannot erase an unresolved preview error, and another project's error/reset cannot change the active project. Workspace reports verified iframe errors/recovery through `setPreviewStatus` (`src/components/Workspace.tsx:690`). Fallback and both edge mounting paths announce success from committed React effects instead of successful compilation/module import (`src/components/PreviewRunner.tsx:45`, `src/lib/preview-templates.ts:381`, `src/lib/preview-templates.ts:477`). Unit and browser regressions verify sticky errors, actual corrected rendering, both status pills, cross-project isolation and no premature edge success. This is runtime status correctness, not a guarantee that generated code meets product requirements. |
| H12 | Fixed locally | Added a durable, private-by-default publication flag (`src/registry.ts:115`), a read-only access lookup (`src/registry.ts:371`) and owner-only publication status/update handlers (`src/worker.ts:277`). The shared gate (`src/lib/project-access.ts:20`) protects preview reads, deployed tenant routes, dispatch misses and same-origin Referer API fallback. Reads no longer claim ids or ignore ownership failures; name prefixes are not publication grants. Missing/tombstoned projects return 404, registry failure denies access, and all mutations still require the owner. Published DO previews exclude workspace snapshots, backend/configuration source, hidden/credential files and private source aliases (`src/agent.ts:1952`, `src/agent.ts:2090`); deployed tenant application routes remain distinct from workspace resources. Forwarded access markers overwrite untrusted client headers; responses use `no-store`. The Publish dialog now requires explicit owner action, shows confirmed server state and supports unpublishing/error recovery (`src/components/PublicationControls.tsx:4`). Fifty real Worker/Registry SQLite tests plus six actual preview-handler regressions cover owner/other/guest access, deletion, migration/restart, publication/revocation, outage, aliases and dispatch/fallback behavior. Two browser tests cover explicit publication/unpublication and failure/retry without clearing a valid session. Existing projects, including named showcases, require explicit publication after the additive upgrade; no live schema/data changes were performed. C02 origin isolation and H14 browser-cache isolation remain open. |
| H14 | Fixed locally — September 21 | Namespaced localStorage and IndexedDB records by the server-verified account, including project lists/active ids, files and messages (`src/lib/project-store.ts:30`). Account changes flush pending edits into the departing namespace, detach memory/revision state and clear the session-only GitHub credential (`src/lib/project-store.ts:41`). Account-generation guards discard late reads, branch/merge continuations and stale component cleanup writes (`src/lib/project-store.ts:430`, `src/lib/project-store.ts:672`); project status also resets across account scopes. Auth activates storage from the actual session response, not cached user metadata, and rejects stale verification/login/ticket/401 results (`src/lib/auth-client.ts:150`). Logout detaches immediately rather than waiting for the network; cross-tab auth changes reverify identity and remount account-keyed views (`src/App.tsx:59`). Signed-out landing never lists cached projects. Legacy metadata/files/history are imported only for ids returned by the authenticated ownership listing, without replacing newer scoped data; unknown legacy records remain untouched but unread by normal app flows. Deletion markers prevent old legacy records reappearing after a new session. Twelve account-storage/auth regression tests, one status-scope test, and three browser cases cover same-id namespaces, pending writes/reads, legacy imports, real IndexedDB, signed-out presentation, and logout/login across two tabs. This is application-level account isolation, not disk encryption or protection against malicious same-origin JavaScript; C02 remains open. |
| M18 | Fixed locally — September 21 | Replaced the original lifecycle spec (`tests/ai-ide-e2e-001-lifecycle.spec.ts:5`) with deterministic, locally mocked generation that stays open until Stop, requiring both UI state and the outgoing stop request. Fixtures seed once rather than resetting on every navigation; the test checks A→B→A switching, distinct mounted history/file trees, persistent source snapshots, completed local cache deletion across reload, mobile interaction and a new prompt after socket reconnection. Rewrote the original platform helper (`tests/platform-checks.ts:15`) to report eight explicitly measured checks instead of twelve assumed capabilities. Missing evidence is a failure; reload compares actual data, isolation really switches projects (`tests/project-evidence.ts:57`), and console/page errors are captured for the stated interval with listener cleanup. Five browser helper regressions include positive coverage and deliberate history leaks, corrupted storage, missing evidence and browser errors that must be detected. The earlier four stale unit expectations remain corrected. Default Playwright discovery is restricted to five reviewed local suites; legacy/live/paid suites require an explicit opt-in config. All 36 local browser tests and 506 Vitest tests plus 9 CLI tests pass. Legacy suites remain separately unvalidated, not silently counted as passing. |
| F01 | Fixed locally — September 21 | Landing now awaits authenticated server deletion before clearing local recovery data (`src/components/LandingPage.tsx:181`, `src/lib/auth-client.ts:192`). Registry deletion checks ownership, revokes publication, and permits safe retries; unclaimed drafts receive tombstones. Browser cleanup awaits a files/messages IndexedDB transaction, and whole-project deletion markers prevent reconciliation and late writes from resurrecting records (`src/lib/project-store.ts:301`). Ordinary file/history resets remain writable. Pending/error/retry UI, session-switch guards, real SQLite authorization tests, real IndexedDB tests and browser lifecycle coverage verify the flow. The UI accurately distinguishes access revocation/local cleanup from eventual server-storage erasure. |

**Latest verification:** The last full local gate remains `npm run verify` with **523 Vitest tests across 50 files, 9 Node deployment regressions, and 42/42 browser tests passing** plus typecheck/lint/build and dry-run deployment logs (`/tmp/brainhalf-critical-*.log`). After the latest M04/M07/M10/M14/M15/M16 changes, incremental checks pass: `npm run -s typecheck` and `npx vitest run src/__tests__/events.test.ts src/__tests__/worker.test.ts` (36 tests). No deployment, live inference, remote migrations, production deletion, or remote secret operations were performed. Browser API fixtures and a local dry-run are not production-equivalent release clearance.

**Remaining issue IDs (3):** M08; L01, L03. No Critical or High findings remain open in the audit. C02 uses genuine browser-enforced opaque execution origins, not separate DNS hosting and not just an iframe flag. The response CSP, standalone runtime, filtered project snapshots, platform-origin request guards, tenant-header sanitization and trusted AI-action approval are all required parts of the boundary. Production-equivalent verification of these controls, H12/H14 and deletion remains a release prerequisite. M08 still covers control-plane sharding/scale work; L01/L03 remain maintainability/dependency backlog items.

| Category | Critical | High | Medium | Low | Total |
|---|---:|---:|---:|---:|---:|
| Bug | 1 | 12 | 6 | 0 | 19 |
| Architecture | 0 | 0 | 3 | 1 | 4 |
| UI-UX | 0 | 4 | 9 | 1 | 14 |
| Security | 1 | 3 | 1 | 0 | 5 |
| Performance | 0 | 0 | 2 | 0 | 2 |
| Dependency | 0 | 1 | 3 | 1 | 5 |
| **Total** | **2** | **20** | **24** | **3** | **49** |

### Original audit method and limitations

- The requested five specialist subagents were launched in parallel. Repeated model rate limits, unavailable deployments, and interrupted runs prevented three specialist reviews from completing. The **Bug & Error Hunter returned 18 findings**, and the **UI/UX Auditor returned additional findings and refinements**. The coordinator consolidated both and performed architecture, security/performance and dependency/configuration review locally. This is **not** represented as five successfully completed independent reviews.
- Review used current source, configuration, lockfile, local checks, the handoff, and the three supplied screenshots. Historical audit documents were not treated as proof that a defect still exists. Core paths examined include routing/auth/registry, generation and message handling, persistence, both preview implementations, workspace/mobile lifecycle, landing/auth UI, styles, dependency/configuration and representative tests.
- The bug reviewer reported isolated local reproductions for SQL array bindings, anonymous exports, duplicate sends, history-role filtering, quota recovery, and generated-app authentication. These are reviewer-reported reproductions, not production exploit tests. Other findings identify concrete static paths, measured build results, or explicitly subjective design opportunities.
- **No application source fixes, package updates, deployment, production stress tests, or authenticated production probes were performed.** No secret values are included. A local production build regenerated ignored `dist/` output; logs and package-manager caches were written under `/tmp`.
- Screenshot 3 establishes a visible **Ready + blank preview** symptom, not its precise cause. C01 affects fresh/starter workspaces; it does not by itself explain a screenshot of an already-mounted generated project. H01–H03 and M01–M02 identify additional preview failure paths worth reproducing with that project's actual files.
- There was no fresh browser accessibility, mobile, network-waterfall, or production end-to-end run. Consequently, responsive behavior and security exploitability beyond the demonstrated code paths need runtime confirmation. This report is not a guarantee that all defects or vulnerabilities have been found.
- Final severities are coordinator priorities, not untouched reviewer ratings. In particular, M11 (modal focus) and M13 (composer accessibility) were rated High by the UI reviewer and consolidated as Medium here; they remain necessary accessibility fixes, not cosmetic suggestions. The UI review was targeted, not exhaustive static coverage of every component and state.

### Original audit validation results

| Check | Result |
|---|---|
| `npm run typecheck` | Failed: four TS2448/TS2454 diagnostics for `status` at `src/components/Workspace.tsx:253`; one underlying defect, C01. |
| `npm test` | 330 tests: **326 passed, 4 failed**; 31 passing and 2 failing test files. Failures are two obsolete landing-content expectations and two obsolete status-color expectations. |
| `npm run lint` | **45 warnings** recorded. Warnings are not counted individually as 45 additional defects. |
| `npm run build` | Succeeded: 1,960 modules transformed. This does not validate TypeScript correctness; see H16. |
| `npm audit --json` | Succeeded after approved network access: **0 reported vulnerabilities**, 351 dependencies in npm's audit metadata. This is not proof of application security or CDN dependency safety. |
| `npm outdated --json` | Registry query reports **16 direct entries behind latest**. Being outdated is not evidence of a vulnerability. |

Evidence logs: `/tmp/brainhalf-audit-typecheck.log`, `/tmp/brainhalf-audit-unit.log`, `/tmp/brainhalf-audit-lint.log`, `/tmp/brainhalf-audit-build.log`, `/tmp/brainhalf-audit-dependencies.json`, `/tmp/brainhalf-audit-outdated.json`. These temporary files are not committed artifacts.

## Critical Issues

### C01 — Fresh workspace initialization throws before rendering
- **Status**: Fixed locally on September 20, 2026; see the remediation log. Not deployed.
- **Issue**: `isWaitingForFirstApp` reads block-scoped `status` before its state declaration. With a starter/fresh project, `!hasGeneratedApp` is true and the read throws a temporal-dead-zone error. Existing generated projects may bypass the read through short-circuiting. Confirmed by the current typecheck and source.
- **Location**: `src/components/Workspace.tsx:253`; `src/components/Workspace.tsx:262`.
- **Category**: Bug
- **Severity**: Critical
- **Suggested Fix**: Declare the status state before derived expressions; add a regression test that mounts a fresh workspace rather than only rendering landing markup.

### C02 — Generated code executes in the authenticated application's origin
- **Status**: Fixed locally on September 21, 2026 with a standalone runtime and response-enforced opaque execution origins; not deployed. See the remediation log and release limitations.
- **Issue**: The preview iframe has no sandbox and loads a same-origin route. Model-generated or imported application code can access the parent DOM and origin storage, including `bh_session_token` and cached projects, and make same-origin authenticated platform requests. Restricting external scripts with CSP does not separate generated code from the IDE. Exploitation requires malicious generated/imported code to be opened by a signed-in user; no live exploit was attempted.
- **Location**: `src/components/Workspace.tsx:1472`; `src/agent.ts:1899`; `src/lib/auth-client.ts:47`; `src/components/PreviewRunner.tsx:334`.
- **Category**: Security
- **Severity**: Critical
- **Suggested Fix**: Serve untrusted previews from a separate, cookieless origin with a constrained sandbox and authenticated, narrowly typed messaging. Do not give previews access to platform session credentials or parent storage. Test isolation before relaxing sandbox flags.

## High Priority

### F01 — Landing Delete does not remove or unpublish the server project (follow-up, September 21)
- **Status**: Fixed locally on September 21, 2026; authenticated tombstoning/publication revocation and durable browser cleanup are verified. Server-storage erasure is not claimed. Not deployed.
- **Issue**: The Delete confirmation promises permanent removal, but its handler only invokes the synchronous browser-store `deleteProject` helper. It does not call the existing authenticated `DELETE /api/projects/:id` route. Consequently it does not tombstone the server project or revoke publication; ownership reconciliation can add the server-listed project metadata back. This is supported by the client call path and controlled lifecycle trace, not a live production deletion test. Local IndexedDB cleanup is asynchronous, so the new browser test waits for completed storage deletion before reloading rather than claiming immediate-unload durability.
- **Location**: `src/components/LandingPage.tsx:178`; `src/components/LandingPage.tsx:475`; `src/lib/project-store.ts:276`; `src/lib/project-store.ts:52`; `src/worker.ts:303`.
- **Category**: Bug
- **Severity**: High
- **Suggested Fix**: Connect the UI to the authenticated deletion API, await confirmed server deletion before displaying success, preserve local recovery state on failure, and await cache cleanup. Cover owner/other-user behavior, server failure/retry, publication revocation, reload, and delayed local writes. Do not treat clearing browser storage as remote erasure.

### H01 — Relative module lookup binds arrays as SQL scalars
- **Issue**: File-resolution queries interpolate arrays into a single tagged-SQL binding rather than expanding scalar placeholders. The bug reviewer checked the installed SQL wrapper and reproduced a nested `./utils` import failure in a SQLite surrogate. This can prevent edge modules from being served.
- **Location**: `src/agent.ts:2328`; `src/agent.ts:2334`; `src/agent.ts:2088`.
- **Category**: Bug
- **Severity**: High
- **Suggested Fix**: Use scalar placeholders or a serialized array with `json_each()`, following existing safe query patterns; cover extension and sibling/parent lookup branches.

### H02 — Module rewriting corrupts anonymous default exports
- **Issue**: The default-export regex can capture the keyword `function` from valid `export default function () { ... }`, then append invalid `export { function };`. The reviewer reproduced an ES-module parsing failure after transformation.
- **Location**: `src/agent.ts:2388`; `src/agent.ts:2393`.
- **Category**: Bug
- **Severity**: High
- **Suggested Fix**: Derive exports from parsed syntax or restrict synthesis to actual named identifiers; test anonymous functions/classes, expressions and named defaults.

### H03 — Generated TypeScript entry loses to the seeded JSX starter
- **Issue**: The server seeds `/src/App.jsx`, while the harness unconditionally imports it. A generated `/src/App.tsx` can coexist with that valid starter and never become the rendered entry; the workspace's generated-app detection also favors JSX.
- **Location**: `src/lib/preview-templates.ts:467`; `src/agent.ts:423`; `src/components/Workspace.tsx:88`.
- **Category**: Bug
- **Severity**: High
- **Suggested Fix**: Define an authoritative entry manifest or consistent entry-selection policy, and replace/remove the starter when accepting an alternative generated entry.

### H04 — Mobile tab navigation destroys generation and synchronization owners
- **Issue**: Chat and Workspace are conditionally mounted by mobile tab. Leaving Chat closes its WebSocket; while Chat is selected, Workspace's persistence/context listeners are absent. Generation can continue on the server while the client misses updates and later mounts stale files.
- **Location**: `src/App.tsx:287`; `src/App.tsx:304`; `src/components/ChatPanel.tsx:668`.
- **Category**: Bug
- **Severity**: High
- **Suggested Fix**: Keep project connection and file synchronization mounted independently of visible panels, or hide panels without unmounting their owners. Test switching tabs during streaming and resizing across the mobile breakpoint.

### H05 — Reconnection can submit the same prompt twice
- **Issue**: A disconnected send queues `pendingSendRef`, consumed on socket open, and separately schedules another send after one second. The reviewer reproduced two prompt payloads without an idempotency key. A duplicate busy error can clear client generation state while the original continues.
- **Location**: `src/components/ChatPanel.tsx:304`; `src/components/ChatPanel.tsx:942`; `src/components/ChatPanel.tsx:948`.
- **Category**: Bug
- **Severity**: High
- **Suggested Fix**: Use one consume-once pending request and preserve a stable idempotency key across retries; remove the competing timer send path.

### H06 — Stop leaves pending connection-time sends active
- **Issue**: Stop does not clear `pendingSendRef`, CONNECTING-socket open listeners, or delayed context/send callbacks. Those callbacks do not validate the generation counter, so a stopped request can begin after the connection opens.
- **Location**: `src/components/ChatPanel.tsx:727`; `src/components/ChatPanel.tsx:935`; `src/components/ChatPanel.tsx:942`.
- **Category**: Bug
- **Severity**: High
- **Suggested Fix**: Cancel pending sends, listeners and timers; check a request epoch after every asynchronous boundary before sending.

### H07 — History replay overwrites later manual edits
- **Issue**: Every nonempty history response reparses historical assistant file/edit blocks and reapplies them as current mutations. A manual change or deletion after that assistant response can be overwritten or resurrected on reload/reconnection.
- **Location**: `src/components/ChatPanel.tsx:326`.
- **Category**: Bug
- **Severity**: High
- **Suggested Fix**: Restore current files from an authoritative revisioned snapshot. Render conversation history without replaying it as new workspace mutations.

### H08 — History rewrites drop assistant messages
- **Issue**: The client uses role `ai` and sends it unchanged in `rewrite_history`; the server accepts only `user` and `assistant`. The reviewer reproduced a rewrite retaining the user turn but silently dropping the AI turn.
- **Location**: `src/components/ChatPanel.tsx:788`; `src/agent.ts:729`.
- **Category**: Bug
- **Severity**: High
- **Suggested Fix**: Normalize roles at a shared protocol boundary and validate the complete history before replacing stored messages.

### H09 — A paginated file snapshot becomes a destructive full replacement
- **Issue**: The server emits a capped first page with `total`, `offset`, `truncated` and `hasMore`. The client ignores those fields and replaces/persists its entire file map. A subsequent `request_sync` uploads that incomplete map with `replace_all: true`, risking deletion of omitted files.
- **Location**: `src/agent.ts:1832`; `src/components/ChatPanel.tsx:527`; `src/components/ChatPanel.tsx:521`.
- **Category**: Bug
- **Severity**: High
- **Suggested Fix**: Assemble all snapshot pages under a revision before committing; prohibit incomplete snapshots from authorizing full replacement. Test row and byte limits.

### H10 — Quota recovery can overwrite newer IndexedDB files with stale data
- **Issue**: A failed localStorage write leaves the old value intact. After reload, `getProjectFilesAsync()` returns that old synchronous value without consulting IndexedDB, and Workspace saves it again. If the synchronous value is absent, Workspace can seed a baseline before asynchronous recovery. The reviewer reproduced stale recovery after quota failure.
- **Location**: `src/lib/project-store.ts:363`; `src/lib/project-store.ts:402`; `src/components/Workspace.tsx:477`.
- **Category**: Bug
- **Severity**: High
- **Suggested Fix**: Give persisted snapshots revisions and a defined authority; await IndexedDB hydration before seeding or saving. Do not claim an asynchronous IndexedDB write has succeeded before it resolves.

### H11 — Backend header filtering breaks generated-app sessions
- **Issue**: Edge forwarding removes Authorization, but the simulated backend resolves generated-app sessions exclusively from that header. The injected platform-user header does not replace app authentication. The reviewer observed the same simulated `/api/auth/me` call change from 200 to 401 after filtering.
- **Location**: `src/agent.ts:62`; `src/agent.ts:1990`; `src/lib/backend-runner.ts:332`.
- **Category**: Bug
- **Severity**: High
- **Suggested Fix**: Distinguish platform credentials from generated-app credentials, forwarding only validated app-session credentials through a dedicated boundary.

### H12 — Preview read routes bypass project ownership and deletion checks
- **Issue**: `/preview/:id` allows any authenticated reader even when `authorizeOrClaim()` rejects ownership/deletion. `/p/:id/...` fallback and Referer-routed `/api/...` reads inject a public viewer without checking explicit publication. The DO checks only that an injected identity exists. Its `/api/files` and source routes can therefore disclose non-secret project files to readers outside the owner ACL; deletion tombstones do not reliably make these read paths unreachable. This is a route-level finding, not a live disclosure test.
- **Location**: `src/worker.ts:337`; `src/worker.ts:365`; `src/worker.ts:385`; `src/worker.ts:402`; `src/worker.ts:458`; `src/agent.ts:1859`; `src/agent.ts:1961`.
- **Category**: Security
- **Severity**: High
- **Suggested Fix**: Define explicit owner/private/published/deleted states and enforce them consistently before every read and dispatch fallback. Keep source snapshots owner-only and reject tombstoned projects on all routes.

### H13 — Dispatch forwards platform credentials into tenant Workers
- **Issue**: `/p/:script` constructs a request from the incoming request and forwards it to the tenant Worker without removing Cookie or Authorization. A tenant application can inspect platform credentials sent by a signed-in visitor, independently of the browser iframe issue. The platform identity header is also forwarded.
- **Location**: `src/worker.ts:343`; `src/worker.ts:357`; `src/lib/auth.ts:30`.
- **Category**: Security
- **Severity**: High
- **Suggested Fix**: Strip platform cookies, bearer credentials and internal identity headers at the dispatch boundary. Use scoped per-tenant identity only where intentionally required; retain app-owned credentials separately.

### H14 — Local project data is not isolated by account or logout
- **Issue**: Projects use shared origin-level keys and files/messages are indexed by project rather than signed-in account. Logout removes session metadata but leaves projects and cached contents. Landing reads the shared project list even without a user, matching screenshot 1. Another user of the same browser profile can see previous prompts/project metadata and access cached source.
- **Location**: `src/lib/project-store.ts:28`; `src/lib/project-store.ts:50`; `src/lib/auth-client.ts:56`; `src/App.tsx:215`; `src/components/LandingPage.tsx:121`; `src/components/LandingPage.tsx:372`.
- **Category**: Security
- **Severity**: High
- **Suggested Fix**: Namespace persisted data by verified account, separate anonymous drafts, and detach/clear account caches on logout or account switch. Gate cached project presentation on the active account.

### H15 — Recent project cards lack keyboard activation
- **Issue**: The primary open-project control is a clickable `div` with no link/button semantics, tab stop or key handler. Keyboard users cannot activate the card directly and must discover the secondary action menu instead.
- **Location**: `src/components/LandingPage.tsx:380`.
- **Category**: UI-UX
- **Severity**: High
- **Suggested Fix**: Make the project title/card's primary action a real link or button, keep the menu a separate control, and provide visible focus and a descriptive accessible name.

### H16 — Deployment can ship code that fails typechecking
- **Issue**: Build/predeploy only run Vite; deploy checks secret names and invokes Wrangler. Neither typecheck nor tests gate deployment. This audit demonstrates the consequence: `npm run build` succeeds while the workspace has a confirmed TypeScript/runtime initialization defect.
- **Location**: `package.json:8`; `package.json:9`; `package.json:16`; `package.json:17`.
- **Category**: Dependency
- **Severity**: High
- **Suggested Fix**: Add a mandatory verification gate with typecheck and regression tests before deployment, and enforce it in CI. Preserve the existing secret check.

### H17 — Chat actions exist only during mouse hover
- **Issue**: Edit/Delete/Rewind controls are conditionally mounted using mouse-enter state. Keyboard focus cannot reveal controls that are absent from the DOM, and touch has no explicit equivalent action menu.
- **Location**: `src/components/ChatPanel.tsx:1113`; `src/components/ChatPanel.tsx:1131`; `src/components/ChatPanel.tsx:1200`.
- **Category**: UI-UX
- **Severity**: High
- **Suggested Fix**: Keep actions mounted, expose them on focus-within as well as hover, and provide a discoverable touch menu.

### H18 — Starting a message edit immediately deletes subsequent history
- **Issue**: Edit copies the message to the composer, immediately slices and persists history, and sends the shortened history to the server before an edited prompt is submitted. There is no staging/cancel/undo flow or confirmation of this destructive consequence. This is distinct from H08's protocol-role loss.
- **Location**: `src/components/ChatPanel.tsx:775`; `src/components/ChatPanel.tsx:782`; `src/components/ChatPanel.tsx:788`.
- **Category**: UI-UX
- **Severity**: High
- **Suggested Fix**: Stage edits separately and commit the conversation rewrite only on confirmed resubmission, with a clear consequence message and Cancel action.

### H19 — Publish text has insufficient contrast
- **Issue**: Enabled Publish uses white 12px text on `#0ea5e9`. The reviewer calculated **2.77:1** contrast, below the 4.5:1 target for normal-sized text; the supplied workspace screenshot shows this bright-blue action.
- **Location**: `src/components/Workspace.tsx:968`.
- **Category**: UI-UX
- **Severity**: High
- **Suggested Fix**: Darken the background or select a sufficiently dark foreground, and verify hover/focus/disabled states separately.

## Medium Priority

### M01 — Edge preview does not consume live file-sync messages
- **Issue**: Workspace sends `sync-files` to the iframe, but the edge HTML/harness does not implement the matching listener. Only the SPA `PreviewRunner` consumes that protocol. Later file updates can leave the edge preview stale until a remount.
- **Location**: `src/components/Workspace.tsx:365`; `src/lib/preview-templates.ts:247`; `src/lib/preview-templates.ts:463`.
- **Category**: Bug
- **Severity**: Medium
- **Suggested Fix**: Implement a revisioned edge-preview update/acknowledgement protocol, or refresh only after a completed file batch is acknowledged by the server.

### M02 — Preview failure does not invalidate the shared Ready status
- **Issue**: The preview error handler updates only Workspace-local status. The shared status store consumes generation/platform events, so the top bar can remain Ready while preview rendering fails. This is consistent with screenshot 3 but does not establish its exact blank-screen cause.
- **Location**: `src/components/Workspace.tsx:657`; `src/lib/status-store.ts:192`.
- **Category**: Bug
- **Severity**: Medium
- **Suggested Fix**: Track project-scoped generation and preview health in the shared state, and require a successful committed render before reporting preview readiness.

### M03 — Ticket acquisition can create an orphan socket after unmount
- **Issue**: `connect()` awaits the ticket and constructs a WebSocket without rechecking lifecycle ownership. Cleanup may have already run while no socket existed. The later `onopen` returns for an unmounted component without closing the newly opened socket.
- **Location**: `src/components/ChatPanel.tsx:250`; `src/components/ChatPanel.tsx:267`; `src/components/ChatPanel.tsx:668`.
- **Category**: Bug
- **Severity**: Medium
- **Suggested Fix**: Abort ticket acquisition or validate a connection epoch after the await; explicitly close stale sockets and unregister request-context listeners.

### M04 — Defined agent tools are not passed to the model invocation
- **Issue**: File/tool handlers are constructed in `agentTools`, but `streamOptions` does not receive a `tools` property. These handlers are unreachable through the non-Cloudflare `streamText` invocation, despite the apparent capability surface.
- **Location**: `src/agent.ts:1088`; `src/agent.ts:1264`; `src/agent.ts:1325`.
- **Category**: Bug
- **Severity**: Medium
- **Suggested Fix**: Pass validated tools and an explicit tool-step policy, or remove dead handlers and unsupported capability claims. Test a real tool invocation rather than only generated file text.

### M05 — Fallback preview error boundary cannot recover after correction
- **Issue**: The fallback `PreviewErrorBoundary` retains `hasError` and has no revision reset. Updated files can compile successfully while the existing boundary continues displaying the previous render error.
- **Location**: `src/components/PreviewRunner.tsx:423`.
- **Category**: Bug
- **Severity**: Medium
- **Suggested Fix**: Reset the boundary when an accepted file revision changes or remount it with a revision key; test an error followed by corrected code.

### M06 — Production CSP blocks browser-side GitHub export
- **Issue**: Export calls GitHub's API from the browser, but the shipped `connect-src` permits only self and Cloudflare Insights. This static policy mismatch blocks the initial API call in a browser enforcing those headers.
- **Location**: `public/_headers:18`; `src/lib/github-export.ts:123`; `src/components/Workspace.tsx:458`.
- **Category**: Bug
- **Severity**: Medium
- **Suggested Fix**: Allow only the required GitHub API origin, or implement a narrowly secured server export endpoint. Test under production headers, not only the development server.

### M07 — Auth and model-test limits are isolate-local, not hard ceilings
- **Issue**: Module-level rate counters reset on isolate recreation and are not shared across isolates/locations. They reduce single-instance abuse but do not enforce an account-wide inference quota or durable credential-attempt limit. The source already acknowledges this limitation.
- **Location**: `src/worker.ts:39`; `src/worker.ts:51`; `src/worker.ts:201`; `src/worker.ts:324`.
- **Category**: Security
- **Severity**: Medium
- **Suggested Fix**: Add durable per-account spend/concurrency controls and platform-level abuse limiting; keep local counters as an inexpensive first layer.

### M08 — One registry instance centralizes unrelated users' auth and metadata
- **Issue**: All session verification, ownership and account operations route to the same named `auth` Durable Object. Project agents are partitioned, but the identity/metadata control plane remains a shared throughput and availability dependency. No load threshold was measured.
- **Location**: `src/lib/auth.ts:144`; `src/worker.ts:249`; `src/registry.ts:247`; `src/registry.ts:383`.
- **Category**: Architecture
- **Severity**: Medium
- **Suggested Fix**: Design measurable sharding boundaries for identity and per-user/project metadata, retaining revocation and ownership correctness; load-test before choosing a migration.

### M09 — Multiple preview implementations have divergent contracts
- **Issue**: The SPA fallback evaluates a small CommonJS-style dependency set; the edge path rewrites/transpiles modules and emits its own HTML/harness; Vite also contains bespoke backend middleware. Entry selection, imports, file updates and error recovery differ, making a passing local preview weak evidence of production parity.
- **Location**: `src/components/PreviewRunner.tsx:268`; `src/lib/preview-templates.ts:463`; `src/agent.ts:2204`; `vite.config.ts:221`.
- **Category**: Architecture
- **Severity**: Medium
- **Suggested Fix**: Define one preview contract and shared resolver/entry/message logic; run the same fixtures against local and edge implementations. Label simulation versus deployed execution explicitly.

### M10 — Cross-component and WebSocket contracts are untyped
- **Issue**: The event bus accepts arbitrary strings and `any` payloads, while components manually assemble protocol messages. The compiler cannot catch role, pagination, status or project-scoping mismatches such as H08/H09. This is a structural cause, not an additional count for each resulting bug.
- **Location**: `src/lib/events.ts:1`; `src/lib/events.ts:22`; `src/components/ChatPanel.tsx:314`; `src/agent.ts:729`.
- **Category**: Architecture
- **Severity**: Medium
- **Suggested Fix**: Introduce shared discriminated message unions, typed event maps and runtime schemas at trust boundaries; require project/revision/request identifiers where relevant.

### M11 — Modal focus management is incomplete
- **Issue**: Login focuses email and handles Escape, but its modal container lacks dialog semantics, focus containment and focus restoration. ConfirmModal has dialog semantics and initial focus but lacks a focus trap/restoration. Deploy/Settings lack a full focus lifecycle; Rename lacks dialog semantics and an associated input label. Background controls remain keyboard-reachable while obscured. GitHub export already has explicit focus-management code and is not included in this blanket diagnosis.
- **Location**: `src/components/LoginScreen.tsx:35`; `src/components/LoginScreen.tsx:83`; `src/components/ConfirmModal.tsx:27`; `src/components/TopNav.tsx:475`; `src/components/TopNav.tsx:628`; `src/components/LandingPage.tsx:470`.
- **Category**: UI-UX
- **Severity**: Medium
- **Suggested Fix**: Use a shared accessible dialog primitive with a name, inert background, focus trap, Escape handling and focus return; preserve the current form labels and error alert.

### M12 — Landing input advertises actions that do not work
- **Issue**: Landing and chat microphone buttons have no action handlers; the landing add-files/context button merely focuses the textarea rather than selecting files or adding context. They appear enabled and imply capabilities that are not implemented.
- **Location**: `src/components/LandingPage.tsx:320`; `src/components/LandingPage.tsx:329`; `src/components/ChatPanel.tsx:1744`.
- **Category**: UI-UX
- **Severity**: Medium
- **Suggested Fix**: Implement the advertised flows or remove/disable the controls with an honest explanation. Do not use unrelated focus behavior as a substitute for file selection.

### M13 — Primary prompt input loses its label and focus indicator
- **Issue**: Landing and chat composers lack explicit labels. Landing also has `!important` focus rules removing outline/border/shadow without a wrapper replacement; keyboard location becomes difficult to identify and placeholder guidance disappears during entry. Chat does have a wrapper focus treatment, so the missing-focus diagnosis applies specifically to landing.
- **Location**: `src/components/LandingPage.tsx:299`; `src/index.css:2518`; `src/index.css:2533`; `src/components/ChatPanel.tsx:1510`.
- **Category**: UI-UX
- **Severity**: Medium
- **Suggested Fix**: Provide an associated label and a visible focus treatment on the input or enclosing composer; keep example text as supplemental guidance.

### M14 — Recent-project supporting text is unnecessarily hard to read
- **Issue**: Project snippets use 11.5px white text at 0.38 alpha: the reviewer estimated about **3.6:1** against the specified dark card surface. The landing placeholder also uses only 0.35-white. The screenshot shows weak hierarchy and aggressive truncation. Timestamps at 0.45 alpha are borderline and are not classified as failing without exact compositing. No browser-wide contrast audit was performed.
- **Location**: `src/index.css:2866`; `src/index.css:2875`; `src/components/LandingPage.tsx:46`.
- **Category**: UI-UX
- **Severity**: Medium
- **Suggested Fix**: Use tested semantic foreground/background pairs, increase supporting text size, and allow useful wrapping or an accessible full-text reveal instead of truncating content both in JavaScript and CSS.

### M15 — Landing eagerly loads the preview engine and entire icon namespace
- **Issue**: `main.tsx` imports both App and PreviewRunner before choosing the view. PreviewRunner imports the complete Lucide namespace for a dynamic proxy, preventing ordinary per-icon tree shaking. The measured production icon chunk is **748.89 kB / 190.85 kB gzip**; Sucrase adds **200.43 / 45.64 kB**. These are build measurements, not measured load-time regressions.
- **Location**: `src/main.tsx:4`; `src/main.tsx:5`; `src/components/PreviewRunner.tsx:3`; `src/components/PreviewRunner.tsx:13`; `vite.config.ts:397`.
- **Category**: Performance
- **Severity**: Medium
- **Suggested Fix**: Lazy-load preview/editor-only code and isolate the generated-app icon catalog from the landing shell. Compare transferred bytes and startup timings before/after; do not merely raise chunk warning limits.

### M16 — Every edit copies the full file map into the preview
- **Issue**: Storage debounce does not debounce React file updates or iframe `postMessage`. Each keystroke copies the project map, and the fallback runner discards its module cache and recompiles on every `files` identity change. Cost scales with project size rather than the changed module.
- **Location**: `src/components/Workspace.tsx:345`; `src/components/Workspace.tsx:365`; `src/components/Workspace.tsx:696`; `src/components/PreviewRunner.tsx:254`; `src/components/PreviewRunner.tsx:266`.
- **Category**: Performance
- **Severity**: Medium
- **Suggested Fix**: Send revisioned changed-file batches, cache compiled modules by content hash and invalidate dependencies selectively. Throttle preview updates independently of durable saves; profile representative large projects.

### M17 — Deployment depends on an undeclared Wrangler installation
- **Issue**: Scripts invoke bare `wrangler`, while the secret check uses `npx wrangler`; Wrangler is absent from direct dependencies and the local `node_modules/wrangler` lookup failed. A clean checkout cannot reproduce the deployment CLI version from its lockfile and may fail or fetch a different version.
- **Location**: `package.json:16`; `package.json:19`; `package.json:36`; `scripts/check-secrets.mjs:22`.
- **Category**: Dependency
- **Severity**: Medium
- **Suggested Fix**: Pin Wrangler as a development dependency and use the same project-local executable for checks and deployment. Document and enforce the Node runtime used in CI.

### M18 — Test results include stale expectations and non-asserting checks
- **Issue**: Four current unit failures expect removed landing copy or former amber status colors. Separately, an E2E lifecycle assertion swallows failure, and a project-isolation check asserts `true` and records success without switching projects. Such checks can report confidence without exercising the promised behavior.
- **Location**: `src/__tests__/landing-unauthenticated.test.ts:33`; `src/__tests__/landing-unauthenticated.test.ts:63`; `src/__tests__/status-store.test.ts:137`; `tests/ai-ide-e2e-001-lifecycle.spec.ts:88`; `tests/platform-checks.ts:173`.
- **Category**: Dependency
- **Severity**: Medium
- **Suggested Fix**: Update approved UI expectations, replace tautologies with behavioral assertions, and let critical assertions fail. Separate mock/local suites from explicitly opted-in production tests.

### M19 — Runtime secret validation silently degrades and deploy checks lack provider consistency
- **Issue**: Missing/short `SESSION_SECRET` causes a random per-isolate signing key rather than a clear configuration failure. The predeploy checker can confirm remote names but not remote length, and unconditionally requires `ATRIA_API_KEY` even though other provider paths exist. This can both admit invalid signing configuration and reject otherwise viable non-Atria deployments.
- **Location**: `src/lib/auth.ts:56`; `scripts/check-secrets.mjs:15`; `scripts/check-secrets.mjs:68`; `src/agent.ts:1045`.
- **Category**: Dependency
- **Severity**: Medium
- **Suggested Fix**: Fail closed with an explicit production configuration error for an invalid signing secret; validate selected-provider requirements consistently at startup/deploy time. Keep permissive development behavior explicitly development-only.

### M20 — Rename, navigation and panel resizing lack keyboard equivalents
- **Issue**: Top-nav project rename is a clickable span and the panel divider supports mouse drag/double-click only. Landing brand/breadcrumb elements have button roles and tab stops but no keyboard activation handlers. Role attributes alone do not supply native button behavior.
- **Location**: `src/components/TopNav.tsx:214`; `src/App.tsx:297`; `src/components/LandingPage.tsx:205`; `src/components/LandingPage.tsx:218`.
- **Category**: UI-UX
- **Severity**: Medium
- **Suggested Fix**: Use native buttons for actions and a focusable separator with keyboard resizing/reset and an announced current value.

### M21 — Close-shaped icon performs a destructive workspace reset
- **Issue**: The far-right X resembles dismissing a panel but invokes reset. The tooltip/accessibility label is accurate and a confirmation exists; the mismatch is specifically the visible affordance, not an unconfirmed destructive operation.
- **Location**: `src/components/Workspace.tsx:992`; `src/components/Workspace.tsx:1024`.
- **Category**: UI-UX
- **Severity**: Medium
- **Suggested Fix**: Put an explicitly labelled Reset workspace action with an appropriate icon in the destructive-actions menu.

### M22 — Dynamic generation and command states lack announcements
- **Issue**: Chat output and changing status pills lack deliberate live-region/status semantics; command state uses spinner/check icons without state text. Screen-reader users receive no dependable completion/error announcement.
- **Location**: `src/components/ChatPanel.tsx:1013`; `src/components/TopNav.tsx:310`; `src/components/ChatPanel.tsx:1665`; `src/components/CommandBlock.tsx:49`.
- **Category**: UI-UX
- **Severity**: Medium
- **Suggested Fix**: Provide concise polite status announcements and text equivalents, announcing completed messages rather than every streamed token.

### M23 — Auth modal can exceed short or keyboard-reduced viewports
- **Issue**: The overlay centers an unconstrained card without scroll overflow or a maximum height while document scrolling is disabled. Landscape, zoom, validation messages or an on-screen keyboard can place controls outside the usable area. This is a static layout risk, not a reproduced mobile failure.
- **Location**: `src/components/LoginScreen.tsx:83`; `src/components/LoginScreen.tsx:100`; `src/index.css:340`.
- **Category**: UI-UX
- **Severity**: Medium
- **Suggested Fix**: Make the overlay scrollable and constrain content to the dynamic viewport; test short landscape screens, text zoom and the virtual keyboard.

### M24 — Small action hit areas demand excessive precision
- **Issue**: Project-tab close and message copy use 12px icons with zero padding; the code-dropdown segment uses a 13px icon with only 4px/5px padding. These controls have small interactive areas, not just small decorative glyphs.
- **Location**: `src/components/TopNav.tsx:235`; `src/components/ChatPanel.tsx:1093`; `src/components/CodeFileBlock.tsx:163`.
- **Category**: UI-UX
- **Severity**: Medium
- **Suggested Fix**: Expand hit areas and spacing without necessarily enlarging glyphs; test touch selection and adjacent-action errors.

## Low Priority

### L01 — Large mixed-responsibility modules make changes difficult to isolate
- **Issue**: The generation class, chat component, workspace and global stylesheet combine many unrelated responsibilities: approximately 2,466, 1,832, 1,621 and 3,357 lines respectively. Inline component styles coexist with the large global stylesheet. This is maintainability debt, not evidence that file length itself causes failure.
- **Location**: `src/agent.ts:1`; `src/components/ChatPanel.tsx:1`; `src/components/Workspace.tsx:1`; `src/index.css:1`; `src/components/LoginScreen.tsx:86`.
- **Category**: Architecture
- **Severity**: Low
- **Suggested Fix**: After correctness fixes, extract cohesive connection/session, persistence, preview-runtime and dialog modules with explicit contracts. Avoid a broad cosmetic refactor during stabilization.

### L02 — Project thumbnails are generic placeholders rather than useful previews
- **Issue**: Every project gets the same skeleton/browser arrangement with an ID-derived accent color, regardless of its actual output. Combined with similarly truncated prompt-derived titles, the recent-project list offers little visual recognition. This is a design/usability opportunity, not a runtime defect.
- **Location**: `src/components/LandingPage.tsx:35`; `src/components/LandingPage.tsx:67`; `src/components/LandingPage.tsx:387`.
- **Category**: UI-UX
- **Severity**: Low
- **Suggested Fix**: Use actual successful-preview thumbnails or honest project-type/status artwork, stronger project naming, and one distinctive BrainHalf interaction or visual motif rather than decorative variation alone.

### L03 — Sixteen direct dependency entries have available updates
- **Issue**: The September 20 registry check reports 16 entries behind latest. Examples: `agents` 0.22.0 → 0.24.0, `ai` 7.0.97 → 7.0.107, `react`/`react-dom` 19.2.8 → 19.3.0, Vite 8.2.2 → 8.3.0, Vitest 5.0.0 → 5.0.1. The current npm audit reports zero vulnerabilities; no security impact is inferred from version age alone.
- **Location**: `package.json:21`; `package.json:36`; `package-lock.json:1`.
- **Category**: Dependency
- **Severity**: Low
- **Suggested Fix**: Review upstream release notes and upgrade in tested groups after baseline failures are resolved. Treat pre-1.0 Agents changes cautiously; preserve the DOMPurify override until its necessity is rechecked.

## Architecture Overview

This section is the coordinator's synthesis; the independent architecture subagent did not complete.

1. **Browser shell:** `src/main.tsx` renders only the top-level IDE and refuses implicit iframe/preview fallback entry. `App` owns view/project/auth/mobile navigation. `ChatPanel` owns WebSocket generation and message parsing; `Workspace` owns the editor, file map, sandboxed preview and export UI. `src/preview-main.tsx` is a separate runtime entry without platform auth/cache access.
2. **Cross-component state:** A string-keyed `appEvents` bus still connects file mutations, context requests and generation status. The remediation adds per-project status/error state, a typed versioned snapshot protocol and persisted-revision preview acknowledgements. Other event and WebSocket contracts remain loosely typed, and component refs/state still duplicate parts of the lifecycle.
3. **Persistence:** Files/messages exist in memory, localStorage, IndexedDB and per-project Durable Object SQLite; R2 provides backups. Hydration is guarded against overwrites, and full snapshots use durable revisions and atomic client assembly. Browser records now use verified-account namespaces and account-generation guards. Legacy recovery is gated by authenticated server ownership; unknown legacy records are retained without being shown or automatically adopted. The remaining event contracts still need consolidation.
4. **Edge:** `worker.ts` routes auth, project operations, model diagnostics, previews and tenant dispatch. One `ChatAgent` per project partitions generation/storage, while one `AuthRegistry` handles identities, sessions, ownership, publication and deletion tombstones. A shared read gate now enforces these states before preview/dispatch/fallback forwarding. That necessary access lookup does not solve the singleton registry scaling concern (M08).
5. **Execution:** Standard preview documents embed an authorized, filtered project snapshot and load the standalone runtime under response-enforced opaque-origin CSP. The iframe adds the same sandbox; standalone navigation and alternate tenant/agent HTML are hardened at the Worker boundary. The runtime transpiles modules, shares a single React instance with external packages, uses memory routing and per-document application storage, and simulates backend APIs in memory. Generated code cannot inherit platform credentials or invoke AI actions without trusted confirmation. Legacy edge modules and actual tenant deployments still exist; simulation is not production backend verification, and applications needing durable storage or deployment-specific APIs require application-owned integration.
6. **Maintainability:** Shared auth helpers, a reusable confirmation dialog, isolated utility tests and explicit file-commit functions provide useful foundations. Consolidate contracts around those rather than replacing the stack. No verified circular-dependency defect was established in this review; a complete automated dependency-graph audit remains outstanding.

## UI/UX Findings

These are grouped references to the original canonical entries, not additional issue counts. Their impact descriptions are the pre-remediation observations; consult the remediation log before treating an item as still open. H14 account-cache isolation, C02 preview isolation, F01 deletion, M14 readability and L02 project-thumbnail distinctiveness are locally fixed; production-equivalent checks remain outstanding.

| Page/component | Findings | User impact |
|---|---|---|
| Landing / recent projects | H14, H15, M12–M14, L02 | Previous-account metadata remains visible; primary cards lack keyboard activation; dead composer actions; weak focus/readability and generic previews. |
| Login and confirmation dialogs | M11, M23 | Focus can leave an apparently modal surface; login lacks dialog semantics and short-height resilience. Existing input labels, autocomplete and error alert are positive controls to preserve. |
| Workspace / preview | C01, H01–H03, H19, M01–M02, M05–M06, M20–M21, M24 | Fresh workspace crash, module failures/starter precedence, stale status, failed recovery/export, weak Publish contrast and confusing reset/navigation controls. |
| Mobile navigation | H04 | Switching to see the result can disconnect the very stream delivering it. Fresh viewport testing remains necessary after fixing lifecycle ownership. |
| Chat / generation controls | H05–H09, H17–H18, M03–M04, M22, M24 | Duplicate sends, ineffective stop, destructive history/snapshots and edit flow, hover-only actions, missing announcements, stale sockets and unavailable tools. |

**Screenshot interpretation:** Image 1 is useful evidence of low-information thumbnails, dense/truncated metadata and signed-out recent projects. Image 2 establishes the auth modal's visual presentation, but not focus behavior or autofill root causes. Image 3 shows a full workspace with no rendered result despite Ready; capture its actual source files and browser/network errors before attributing that specific incident to one implementation defect. Do not redesign the UI as a substitute for fixing its execution and state model.

## Recommended Fix Order

1. **Validate the Critical/High fixes before release:** C02 and F01 are fixed locally. Exercise preview response headers, opaque execution, account separation, publication revocation and deletion retries in a controlled production-equivalent Cloudflare environment. Ship the standalone runtime and Worker-first configuration together; never relax the sandbox to restore platform-session access.
2. **Restore the remaining advertised generation tools:** address M04 with execution, cancellation and authorization tests. Preserve the now-tested snapshot, history, deletion and preview behavior; do not interpret backend simulation as deployed application verification.
3. **Harden remaining release and abuse controls:** design durable abuse limits (M07). M17–M19 release tooling, canonical test assertions and runtime/provider checks are fixed locally. Keep legacy/live suites explicitly opted in and review them individually rather than treating the local suite as certification. Validate actual environment secrets before deployment and review dependency updates (L03) in small verified batches.
4. **Complete shared contracts and measure performance:** build on shared entry selection and typed snapshots to unify the remaining preview/event contracts (M09–M10). Address measured recompilation/bundle costs (M15–M16), registry sharding needs (M08) and oversized modules (L01). Avoid speculative sharding without load measurements.
5. **Complete presentation improvements:** run manual screen-reader, zoom and real-device checks on the implemented accessibility fixes and updated landing cards before declaring the entire UI accessible.
6. **Verify deployment conditions before release:** validate schema migration 3, the versioned snapshot protocol and preview refresh/error behavior in a production-equivalent Cloudflare environment. Keep the local verification gate mandatory; do not deploy while the unresolved security findings remain unaddressed.

### Remaining verification

- Complete independent architecture, security/performance and dependency reviews when subagent service availability permits; expand the targeted static UI review to remaining components/styles/states and runtime accessibility tests. Reconcile new findings without double-counting.
- Run production-equivalent local Worker/DO integration tests and browser tests under shipped security headers; do not assume Vite mocks exercise production authorization or module loading.
- Extend the passing publication/deletion, tenant-header, opaque-preview and cross-tab account fixtures into production-equivalent Cloudflare checks. Include direct navigation, published/private deployments and third-party-cookie restrictions; local closure of C02 does not certify the deployed service.
- Reproduce the supplied blank-project incident using its actual generated files. The original audit was findings-only; the subsequent local implementation changes and their verification are recorded in the remediation log.
