# BrainHalf — Codex Handoff & Full Platform Reference

> This file is the single source of truth for any AI assistant (Codex, Claude, etc.) picking up this codebase.
> It covers: what the product is, how every part works, every bug fixed, every UI change made, deployment steps, and how to continue safely.

---

## 1. What Is BrainHalf?

BrainHalf is a **full-stack AI app builder** deployed on Cloudflare Workers.

- User types a natural-language prompt → BrainHalf generates a complete React + Cloudflare Workers app
- Live preview renders in-browser (no build server — Sucrase transpiles inside the iframe)
- Monaco editor lets users edit files immediately
- One-click publish to Cloudflare's global edge

**Live URL:** https://brainhalf.com  
**Stack:** React 19 + Vite 8 (frontend) + Cloudflare Workers + Durable Objects (backend)  
**AI models:** Cloudflare Workers AI (default), Anthropic Claude, AWS Bedrock, Atria  

---

## 2. Repository Layout

```
brainhalf/
├── src/
│   ├── worker.ts            # Cloudflare Worker entry — HTTP routing, auth, project CRUD
│   ├── agent.ts             # ChatAgent Durable Object — AI generation engine (2466 lines)
│   ├── App.tsx              # Root React component — view routing (landing ↔ workspace)
│   ├── index.css            # ALL styles live here (single file, BEM-ish class names)
│   │
│   ├── components/
│   │   ├── LandingPage.tsx      # Hero, prompt input, recent-projects list
│   │   ├── ChatPanel.tsx        # WebSocket client, streaming chat, auto-send, stop
│   │   ├── Workspace.tsx        # Monaco editor + preview iframe + toolbar
│   │   ├── PreviewRunner.tsx    # In-iframe Sucrase transpiler + React renderer
│   │   ├── TopNav.tsx           # Breadcrumb, status pill, user avatar
│   │   ├── CodeFileBlock.tsx    # File cards inside chat (with Open-in-Editor split-button)
│   │   ├── DiffEditBlock.tsx    # Targeted-edit blocks shown in chat
│   │   ├── LoginScreen.tsx      # Auth gate shown when hitting /?project=<id> unauthenticated
│   │   ├── FileExplorer.tsx     # Project file tree panel (inside Workspace)
│   │   ├── ConfirmModal.tsx     # Reusable destructive-action confirm dialog
│   │   ├── BrainHalfLogo.tsx   # SVG logo component
│   │   ├── CommandBlock.tsx     # Shell command blocks in chat
│   │   ├── PlanBlock.tsx        # Plan/thinking blocks in chat
│   │   ├── ErrorBoundary.tsx    # Top-level React error boundary
│   │   └── MacOSTrafficLights.tsx  # macOS window chrome (decorative)
│   │
│   └── lib/
│       ├── project-store.ts     # localStorage + IndexedDB CRUD for projects/messages/files
│       ├── status-store.ts      # Reactive hook: Building/Ready/Error/Stopped/Connecting
│       ├── events.ts            # Typed in-process event bus (appEvents)
│       ├── message-parser.ts    # Streaming parser: splits tokens → file/edit/plan/text segments
│       ├── models.ts            # Model allowlist + resolveModel()
│       ├── auth.ts              # AuthRegistry DO + session management
│       ├── auth-client.ts       # Client-side session token helpers (localStorage)
│       ├── rate-limit.ts        # Fixed-window rate limiter (Worker + DO gates)
│       ├── concurrency.ts       # BusyLock + IdempotencyStore
│       ├── system-prompt.ts     # System prompt builder
│       ├── backend-runner.ts    # In-iframe backend simulation for full-stack apps
│       ├── ssrf.ts              # SSRF guard for agent outbound fetches
│       ├── templates.ts         # Baseline React starter template
│       ├── crypto.ts            # Session token hashing utilities
│       ├── zip-export.ts        # ZIP project download
│       ├── github-export.ts     # GitHub repo export
│       ├── prism-loader.ts      # Lazy syntax highlighting
│       └── utils.ts             # normalizePath, misc helpers
│
├── tests/                   # Playwright E2E + Vitest unit tests
├── public/                  # Static assets + _headers (CSP, security headers)
├── wrangler.toml            # Cloudflare deployment config
├── vite.config.ts           # Vite build config
└── package.json
```

---

## 3. How The Platform Works End-to-End

### 3.1 User Journey: Landing Page → Live App

```
1. User visits brainhalf.com (or localhost:5173)
   → LandingPage.tsx renders

2. User types a prompt + submits
   → App.tsx: handleSubmitInitialPrompt(prompt, 'web')
   → createProject(title) minted in localStorage
   → pendingInitialPrompt state set
   → currentView switches to 'workspace'

3. Workspace + ChatPanel mount (keyed by projectId — forces fresh mount on project switch)
   → ChatPanel receives initialPrompt prop

4. ChatPanel connects WebSocket
   → GET /api/auth/ws-ticket  (short-lived single-use ticket, prevents session token in WS URL)
   → ws = new WebSocket(`/agents/chat/${projectId}?ticket=...`)
   → Worker routes via agents SDK → ChatAgent Durable Object assigned

5. Server sends { type: 'history', messages: [] } (empty for new project)
   → ChatPanel WS onmessage handler:
     - Checks pendingAutoSendRef FIRST (before localStorage)
     - Clears stale cache (deleteProjectMessages)
     - Calls handleSendMessage(prompt) after 60ms

6. handleSendMessage sends { type: 'chat', message: prompt, idempotencyKey }
   → ChatAgent.onMessage() receives it
   → Checks IdempotencyStore (deduplication — prevents re-sending same message)
   → Checks BusyLock (prevents concurrent generation)
   → Calls runGeneration()

7. runGeneration():
   → Builds system prompt (system-prompt.ts)
   → Calls runCloudflareWorkersAI() or streamText() depending on model
   → Streams tokens back via WS: { type: 'chunk', content: '...' }

8. ChatPanel receives chunks
   → message-parser.ts parses streaming tokens into segments:
     - type:'file'  → file path + content
     - type:'edit'  → targeted diff/patch
     - type:'plan'  → thinking/plan block
     - type:'text'  → prose response
   → For each file segment: appEvents.emit('file-generated', { path, content, isComplete })

9. Workspace.tsx handles 'file-generated':
   → handleFileGenerated() called
   → If isComplete: commitFiles(next) → setFiles(next) → saves to localStorage
   → If streaming: filesRef.current = next; setFiles(next) (no persist)

10. React useEffect fires on files state change:
    → iframeRef.postMessage({ type: 'sync-files', files })
    → PreviewRunner.tsx receives message → setFiles() → re-renders

11. hasGeneratedApp (useMemo) flips true when first non-starter App.jsx arrives
    → prevHasGeneratedRef useEffect fires → handleRefresh() → iframe key change
    → iframe reloads src → onLoad fires → postMessage with all files → clean render
    → Skeleton overlay (preview-skeleton-overlay) disappears
```

### 3.2 Preview Sync (How The Iframe Stays Live)

```
commitFiles(next)
  ├─ setFiles(next)                          → triggers React re-render
  ├─ saveProjectFiles(projectId, next)       → localStorage + IndexedDB
  └─ appEvents.emit('sync-files', {...})     → ChatPanel can listen if needed

useEffect([files]):
  └─ iframeRef.postMessage({ type:'sync-files', files })

PreviewRunner (inside iframe):
  window.addEventListener('message', e => {
    if (e.data.type === 'sync-files') setFiles(e.data.files)
  })
  → useMemo re-runs Sucrase transpile on every file change
  → React re-renders the user's app inside the iframe
  → Errors caught by PreviewErrorBoundary → postMessage back to parent
```

### 3.3 Auth Flow

```
Client side:
  localStorage key: 'bh_session_token'  (30-day token)
  localStorage key: 'bh_session_user'   (JSON: { id, email })

  DEV bypass token: 'bh_dev_local_token_not_a_real_session'
  (accepted in dev mode, skips real auth — used by all Playwright tests)

WebSocket auth:
  1. ChatPanel calls GET /api/auth/ws-ticket
  2. Worker: verifySession → issueWsTicket (short-lived, single-use)
  3. WS URL: /agents/chat/${projectId}?ticket=${ticket}
  4. Worker onBeforeConnect: verifies ticket, injects userId into connection state
  5. ChatAgent receives userId, owns project via AuthRegistry DO

Project ownership:
  AuthRegistry DO: projectId → userId mapping
  authorizeOrClaim(): agent connections/requests claim unowned ids; preview reads never claim
  isReadOnlyProject set to true if ownership denied → shows "Clone to My Projects" banner
```

#### Local access-control remediation — September 20, 2026

The working tree now uses an explicit `project_owners.published` flag. `AuthRegistry.ensureSchema()` adds it with default `0`, so existing projects, including showcase/demo/template names, remain private until their owner publishes them. Existing ownership and deletion tombstones are preserved. This change has not been deployed.

- The Publish dialog reads server status; **Publish app publicly** and **Make private** explicitly update it through owner-only `GET`/`PUT /api/projects/:id/publication`. Opening the dialog does not publish or deploy code.
- `/preview/:id`, `/p/:id` and same-origin Referer API fallbacks check registry access before forwarding. Missing/deleted projects return 404; registry failures deny access. Mutations still require the owner, even when published.
- Published edge previews expose frontend files under `src/`, `public/`, `assets/` and selected root entry/style files. Workspace snapshots, backend/configuration source, hidden files and credential files are not public preview resources. Resolved file aliases are checked too. A deployed tenant Worker serves its own application routes; a dispatch miss cannot expose a workspace snapshot through the fallback.
- Preview/dispatch responses are `no-store`; unpublishing or tombstoning blocks subsequent public requests, not already downloaded copies. Publishing exposes subsequent saved frontend edits as well as the current ones.
- The Vite development fixtures do not provide a real publication registry. Use the configured local Worker backend to exercise persistence; the browser regression suite mocks publication responses and the unit suite exercises the actual Worker/Registry handlers with SQLite.
- **C02 remains open:** generated code still runs on the platform origin. These ACLs are not preview-origin isolation. H14 account caches are addressed by the September 21 local remediation below. Do not treat these changes as release clearance.

#### Local account-cache remediation — September 21, 2026

- Account scopes start detached and activate only from a successful login/signup or verified session response. Cached `bh_session_user` does not select a storage namespace. Session verification accepts the Worker's `userId` response and the development fixture's `user` response.
- localStorage uses `brainhalf_account:<encoded-account-id>:<original-key>`. IndexedDB keeps `BrainHalfStorage` version 1 and its existing `files`/`messages` stores, with account-prefixed record keys instead of bare project ids. No remote schema change is involved.
- Logout immediately detaches caches and clears the session-only GitHub token. Cross-tab token/user changes close the old account view and verify the new session. Project components use account-bound storage functions; pending debounce writes stay in the departing account, and late reads/cleanup writes cannot enter the new account. In-memory project status is account-scoped too.
- The authenticated `/api/projects` listing enables recovery of legacy records only for confirmed owned ids. Recovery prefers IndexedDB, respects newer scoped data and records deletion markers. Unknown legacy data is preserved, not exposed or reassigned to the next person signing in. Legacy drafts that were never claimed on the server require a separately designed ownership-safe recovery flow; do not bulk-adopt them.
- This is application-level isolation, not encryption against someone with browser-profile/devtools access or malicious same-origin scripts. C02 remains a release blocker.
- Local verification: 464 unit tests across 46 files, plus 30 browser regressions including `tests/account-isolation.spec.ts`. Browser identity endpoints are controlled fixtures; no deployment or production account was used.

#### Local configuration remediation — September 21, 2026

- M17 and M19 are fixed locally. The audit now records 35 fixed findings and 13 remaining, including C02. Do not infer production release clearance.
- Invalid session secrets no longer create ephemeral signing keys. API/agent/preview requests return uncached 503s; signup/login perform no registry writes when configuration is invalid. Static shell and CORS preflight remain available.
- `src/lib/runtime-config.ts` shares the explicit required-provider policy and credential alternatives with the deploy checker and generation paths. `REQUIRED_MODEL_PROVIDERS = "cloudflare"` is set in Wrangler vars. Bedrock bearer aliases no longer accidentally select native Anthropic in model tests. Misfiled Atria URL/key configuration must be corrected before release.
- Wrangler is pinned to 4.135.0 and invoked through one checked project-local wrapper. The deploy gate checks exactly the same environment/config it deploys. Node >=22.18.0 is required; install the lockfile with `npm ci` and use `.node-version` (22.23.2). See section 9 and README for commands and secret-value validation limits.
- Latest verification: `npm run verify` passes 499 Vitest tests in 48 files, 9 Node deployment regressions, typecheck, lint with existing warnings, and frontend build. Local `npm run wrangler -- deploy --dry-run` succeeds. Logs are `/tmp/brainhalf-config-verify.log` and `/tmp/brainhalf-config-dry-run.log`. The preceding batch's 30 passing browser regressions were not rerun here. No live inference, production secrets, deployment or remote migration was used.

#### Local test-integrity remediation — September 21, 2026

- M18 is fixed locally. The original lifecycle and platform-check files now contain behavioral assertions rather than swallowed expectations, conditionally skipped steps or tautologies. The lifecycle seeds once, waits for actual storage completion, verifies mocked streaming/stop messages, switches distinct project views, and tests mobile sending after a controlled socket restart.
- Platform checks require explicit two-project/account evidence for persistence/isolation, fail when evidence is absent, and capture browser errors during their own measurement interval. Negative-control browser tests prove detection of history leakage, corrupt persisted files, missing evidence and console/page errors. The helper does not claim unmeasured deployment or backend capabilities.
- Default Playwright discovery is local-only: five reviewed specs, 36 tests. Legacy/live/model/benchmark commands use the opt-in config described in section 10. Those older suites are not represented as verified or passing.
- Verification: 506 Vitest tests in 49 files, 9 Node CLI tests, all 36 local browser tests, strict checking of changed browser files, and `npm run verify` pass. Existing lint warnings remain. Logs: `/tmp/brainhalf-legacy-verify.log`, `/tmp/brainhalf-legacy-all-browser.log`, `/tmp/brainhalf-legacy-types.log`, `/tmp/brainhalf-live-gate.log`. No production or paid-provider tests ran.
- **New High-priority follow-up F01:** the landing Delete UI does not call the authenticated server deletion API, so cache deletion does not revoke publication or permanently remove the server project. See the audit for the exact call path and recommended fix; do not conceal this gap by treating local storage cleanup as remote deletion. The original 48 now have 36 fixed and 12 open; F01 brings the current audit to 49 findings with 13 open. C02 remains the Critical release blocker.

#### Critical/High remediation — September 21, 2026 (latest)

- **C02 and F01 are now fixed locally.** This supersedes the earlier open-status notes above. The audit has **38 fixed findings and 11 open: 8 Medium and 3 Low. All 2 Critical and 20 High findings are locally closed.** Nothing has been committed or deployed; this is not production release clearance.
- Preview isolation is enforced by response CSP `sandbox allow-scripts`, not merely an iframe flag. The browser gives each document an opaque execution origin despite its platform-hosted URL. `src/preview-main.tsx` and `vite.preview.config.ts` produce a standalone `dist/preview-runtime.js`; `main.tsx` no longer evaluates generated code or selects the runner for arbitrary iframes. Both `npm run dev` and `npm run build` include the runtime build.
- Authorized Worker navigation embeds only filtered project files. The renderer has no platform auth/project-store imports, uses memory routing and per-document app-only localStorage/sessionStorage, and retains project-relative/alias/JSON imports and external packages through the existing import-map policy and a shared React instance. The application storage and backend simulation reset with the preview document; they are not durable deployed storage. Native platform cookies, IndexedDB, account caches and privileged API credentials remain inaccessible.
- All preview/tenant responses and alternate agent HTTP responses receive the execution boundary; tenant `Set-Cookie`, `Clear-Site-Data`, credential-CORS and other dangerous header overrides are removed. Untrusted/opaque origins are rejected before platform auth or agent routing and cannot inherit the owner's identity on preview reads. Keep `wrangler.toml` Worker-first routes and the runtime asset together. Do not add `allow-same-origin`, bypass the headers, or restore platform storage to fix a generated application's integration.
- Child messages are scoped to the active frame; malformed errors are bounded. An AI-fix request now opens a trusted confirmation dialog and does not consume generation credits until approved. Browser tests exercise malicious parent/storage/network probes, canceled and approved fix requests, standalone opaque navigation, blocked fallback entry, relative modules and shared-React external imports.
- Landing deletion now awaits authenticated DELETE and validates success before clearing recovery files. Registry deletion checks the actual owner, clears publication and is idempotent for that owner; unclaimed drafts are tombstoned. Local cleanup waits for the files/messages IndexedDB transaction. Separate whole-project markers prevent late writes/reconciliation from reviving deleted data without blocking ordinary file/history reset writes. Failure/retry, duplicate prevention, account-switch guards and post-reload behavior are covered. The dialog accurately promises access revocation/local removal, not immediate physical erasure of retained server storage.
- Final verification: **523 Vitest tests in 50 files; 9 Node CLI tests; 42/42 browser tests in six reviewed local suites; strict checking of changed browser/config files; typecheck, lint and both builds; local Worker deployment dry-run; `git diff --check`**. Warnings remain, including Vite's future native-config-loader compatibility notice. Logs: `/tmp/brainhalf-critical-verify.log`, `/tmp/brainhalf-critical-all-browser.log`, `/tmp/brainhalf-critical-browser-types.log`, `/tmp/brainhalf-critical-dry-run.log`. The built runtime also contains no platform session/cache identifiers. No live inference, production deletion, remote migration, secret operation or deployment was performed.
- Next work is the remaining Medium/Low audit entries. Before any release, obtain permission for controlled production-equivalent checks of these security headers, private/public deployment integrations, account isolation and deletion. Local browser fixtures and a dry-run do not prove the currently deployed service is fixed.

### 3.4 Generation Engine (agent.ts)

```
ChatAgent Durable Object:
  - One DO per project (named by projectId)
  - Persistent storage: SQLite via DO storage API
  - R2 backup: saves files on every generation complete; restores on cold start

onConnect(connection):
  → verifyUserId (from onBeforeConnect injection)
  → ensureSchema() (SQLite table setup)
  → restoreFromR2() if DO storage is empty
  → seedStarterIfNeeded()
  → sends { type: 'history', messages: [...] }
  → sends { type: 'request_sync' }

onMessage(connection, message):
  → Handles: ping / get_files / stop / clear / rewrite_history / sync_files / chat
  → For 'chat': auth check → rate limit → idempotency → BusyLock → runGeneration()

runGeneration():
  → Reads file history from DO storage
  → Builds input messages (user + AI turns)
  → AbortController for stop support
  → Calls runCloudflareWorkersAI() [CF models] or streamText() [Anthropic/Bedrock/Atria]

Tools available to agent (via streamText):
  - read_file(path)        → returns file content
  - write_file(path, content) → writes file, sends 'file' WS message
  - list_files()           → returns file tree
  - delete_file(path)
  - run_command(cmd)       → always returns "unsupported" (preview has no shell)
```

---

## 4. Key State & Event Flow

### appEvents Bus (src/lib/events.ts)
Cross-component communication without prop drilling:

| Event | From | To | Payload |
|---|---|---|---|
| `file-generated` | ChatPanel | Workspace | `{ path, content, isComplete }` |
| `file-deleted` | ChatPanel | Workspace | `{ path }` |
| `files-refreshed` | ChatPanel | Workspace | `FileMap` |
| `generation-status` | ChatPanel | TopNav, Workspace | `{ status, detail, projectId }` |
| `sync-files` | Workspace | ChatPanel | `{ files, replaceAll }` |
| `open-file` | CodeFileBlock | Workspace | `{ path }` |
| `request-workspace-context` | ChatPanel | Workspace | `{ requestId }` |
| `workspace-context-response-*` | Workspace | ChatPanel | `{ files }` |
| `clear-workspace` | Workspace (reset btn) | ChatPanel, Workspace | — |
| `open-deploy-modal` | Workspace (Publish btn) | App.tsx | — |
| `platform-status-sync` | status-store | TopNav | status payload |
| `project-messages-updated` | project-store | LandingPage | `{ projectId }` |

### Status Color System (src/lib/status-store.ts)

| State | Color | Used when |
|---|---|---|
| Building | `#3b82f6` (blue) | AI is generating / WS connecting |
| Connecting | `#3b82f6` (blue) | WS reconnecting |
| Ready | `#10b981` (green) | Project has files, idle |
| Stopped | `#10b981` (green) | User stopped generation |
| Error | `#ef4444` (red) | Generation failed |

These colors appear in: TopNav status pill dot, `.status-dot.generating` CSS class, Stop button background.

---

## 5. All Bugs Fixed In This Session

### Bug 1 — Auto-send from Landing Page Silently Dropped (CRITICAL)
**File:** `src/components/ChatPanel.tsx`  
**Problem:** When a user submitted a prompt from the landing page, the WS `onmessage` handler checked `getProjectMessages(activeProjectId)` for stale localStorage data BEFORE checking `pendingAutoSendRef`. A race condition caused 1 user message to appear in localStorage (from the landing page form state) before the handler ran, making it think the project had history and skipping the auto-send entirely. The prompt was displayed but never sent to the AI.  
**Fix:** Moved `pendingAutoSendRef.current` check to be the FIRST branch (before any localStorage check). Added `deleteProjectMessages(activeProjectId)` to clear stale cache before auto-send.  
**Lines:** ~334–361 in ChatPanel.tsx

### Bug 2 — Error Messages Silently Dropped
**File:** `src/components/ChatPanel.tsx`  
**Problem:** Error handler had guard `if (!isGeneratingRef.current) return;` — errors arriving after generation state was cleared (e.g. after WS reconnect) were silently ignored.  
**Fix:** Removed the guard. All `{ type: 'error' }` WS messages are now always displayed.  
**Line:** ~479

### Bug 3 — Preview Never Auto-Renders on First Generation
**File:** `src/components/Workspace.tsx`  
**Problem:** The preview iframe only received files via `postMessage` from a `useEffect`. On first generation, the iframe was loaded with the baseline starter template. When the first real generated file arrived via `postMessage`, the starter's in-memory React state sometimes didn't cleanly replace itself.  
**Fix:** Added `prevHasGeneratedRef` useEffect — when `hasGeneratedApp` transitions from `false → true`, calls `handleRefresh()` to remount iframe with new key, triggering `onLoad → postMessage` with the full file set.

### Bug 4 — Blank Screen During Generation (UX)
**File:** `src/components/Workspace.tsx` + `src/index.css`  
**Problem:** From landing page submit to first generated file (3–10s), users saw the baseline starter template — a generic placeholder with no indication anything was happening.  
**Fix:** Added `isWaitingForFirstApp = !hasGeneratedApp && (status === 'Generating' || status === 'Idle')`. When true, renders `.preview-skeleton-overlay` — an animated skeleton (nav bar, hero lines, card grid) positioned absolute over the iframe. Disappears when `hasGeneratedApp` becomes true.

### Bug 5 — Inconsistent Status Colors
**Files:** `src/lib/status-store.ts`, `src/index.css`, `src/components/ChatPanel.tsx`  
**Problem:** `Stopped` and `Connecting` states used amber `#f59e0b`. `.status-dot.generating` CSS used teal `var(--color-ai)`. Stop button used red `#ef4444`. All three indicators were a different color for the same state.  
**Fix:** Unified: blue=building (all building states), green=idle/ready (Ready + Stopped), red=error only. Stop button changed from red to blue.

### Bug 6 — Duplicate Projects in Recent List
**File:** `src/components/LandingPage.tsx`  
**Problem:** `getProjects()` returned duplicates if localStorage became inconsistent. No deduplication.  
**Fix:** Added `dedupe()` function using a Set. Applied to initial state, `refreshProjects()`, and `handleDeleteConfirm()`.

### Bug 7 — "Untitled Project" Generic Fallback Name
**File:** `src/components/LandingPage.tsx`  
**Problem:** Recent projects list showed raw `proj.name` — "Untitled Project" for any new project. Also ignored the existing `getProjectDisplayTitle()` helper that reads the first user message.  
**Fix:** `displayName(proj)` now calls `getProjectDisplayTitle(proj)` and maps any "Untitled Project" / "New project" result to `"Draft — continue building."`.

---

## 6. UI Changes Made In This Session

### Toolbar Simplification (Workspace.tsx)
- **Before:** Help + Popout + Branch + Share + Publish all in a row (5 visible buttons)
- **After:** Single `⋯` overflow menu containing Help, Popout, Branch. Only Share + Publish remain as primary visible buttons.
- Added `overflowMenuOpen` state + click-outside backdrop pattern

### Preview URL Bar Cleanup (Workspace.tsx)
- Removed the Refresh (`RefreshCw`) icon button next to URL bar
- Removed the ExternalLink icon button next to URL bar
- Popout (open in new tab) is now only in the `⋯` overflow menu
- Removed decorative `Lock` icon from URL pill (it implied HTTPS security it couldn't guarantee)

### Viewport Control (Workspace.tsx + index.css)
- **Before:** `Desktop | Tablet | Mobile` segmented control with icon + text label
- **After:** Icon-only: Monitor / Tablet / Smartphone icons, no labels
- Removed stale responsive CSS that showed/hid span labels at different breakpoints

### File Card Actions (CodeFileBlock.tsx)
- **Before:** Three separate buttons: `Code`/`Hide` + `Copy` + `Editor ↗`
- **After:** `[Open in Editor | ▾]` split-button — left segment opens editor, right chevron opens dropdown with "View inline code" / "Hide inline code". `Copy` is now icon-only (no label).

### Landing Page Hero (LandingPage.tsx + index.css)
- **Before:** `"What would you like to build today?"` with teal-sky-indigo gradient on "build today"
- **After:** `"Turn any idea into a full-stack app."` — solid white, confident statement
- **Subheadline before:** `"Describe your idea and watch it come to life."`
- **Subheadline after:** `"BrainHalf generates working frontend and backend code, deploys it to Cloudflare's global edge, and hands you the source. Describe what you want — no boilerplate, no config."`
- `.landing-headline-gradient` CSS class deleted

### Recent Projects Cards (LandingPage.tsx + index.css)
- **Thumbnail:** Added `<ProjectThumbnail>` component to each card — mini browser-frame (120×72px, already had CSS) with accent-colored skeleton blocks. Accent color is derived from a simple hash of the project ID (6 possible accent colors: indigo/sky/emerald/amber/pink/violet)
- **Snippet:** First user message text shown as a 55-char subtitle under the title
- **Name fallback:** "Untitled Project" → "Draft — continue building."
- **Deduplication:** Deduplicated by project ID on every list refresh

---

## 7. CSS Architecture

All styles in `src/index.css` — no CSS modules, no Tailwind.

**Key CSS variables** (defined in `:root`):
```css
--accent-light: #2dd4bf          /* teal — AI elements */
--color-success: #10b981         /* green — Ready state */
--color-error: #ef4444           /* red — errors */
--color-ai: #2dd4bf              /* teal — AI chat elements */
--color-ai-bg: rgba(20,184,166,0.08)
--color-neutral: #a1a1aa         /* gray */
--bg-app: #090a0f                /* main background */
--bg-surface: #1a1d27            /* cards/panels */
--border-subtle: rgba(255,255,255,0.07)
--font-mono: 'JetBrains Mono', 'Fira Code', monospace
```

**Important CSS classes:**
- `.status-dot.generating` — blue pulsing dot (building state)
- `.status-dot.ready` — green dot
- `.status-dot.idle` — green dot (idle = ready)
- `.status-dot.error` — red dot
- `.viewport-pill-btn` — icon-only viewport buttons
- `.preview-skeleton-overlay` — generation skeleton overlay
- `.skeleton-block` — shimmer-animated skeleton block
- `.landing-project-card` — recent project card
- `.landing-card-thumbnail` — 120×72 mini browser frame
- `.browser-chrome` — preview URL bar area
- `.browser-url-pill` — URL display pill

---

## 8. Local Development

### Prerequisites
- Node.js 20+
- Wrangler CLI (`npm install -g wrangler`)
- Cloudflare account (for deployment only)

### Setup
```bash
git clone <repo>
cd brainhalf
npm install
npx playwright install chromium   # first time only
```

### Running Locally
```bash
# Frontend dev server only (no Durable Objects — most UI features work)
npm run dev
# → http://localhost:5173

# Auth bypass in tests (localStorage):
localStorage.setItem('bh_session_token', 'bh_dev_local_token_not_a_real_session')
localStorage.setItem('bh_session_user', JSON.stringify({ id: 'dev-user-1', email: 'dev@brainhalf.local' }))
```

### Scripts
```bash
npm run dev         # Vite dev server
npm run build       # Production build → dist/
npm run test        # Vitest unit tests + Node deployment-tool regressions
npm run test:e2e    # Playwright E2E (needs dev server running)
npm run lint        # Oxlint
npm run deploy      # full verification + target secret checks + pinned local Wrangler
npm run r2:lifecycle  # Set R2 expiry policy (run once per bucket)
```

---

## 9. Deployment

### Deploy to Cloudflare
```bash
npm run deploy
```
This runs: `npm run verify` (typecheck, both test suites, lint, build) → `scripts/deploy.mjs` (target-specific secret/provider checks, then the pinned local Wrangler). Node.js >=22.18.0 is enforced by `.npmrc`/package engines; `.node-version` records 22.23.2. Install with `npm ci`. Never replace the guarded release command with direct `npx wrangler deploy`.

`npm run deploy -- --env staging` forwards the same environment/config flags to checks and deployment. `CLOUDFLARE_ENV` is also honored consistently. Only `--env`/`-e` and `--config`/`-c` are supported by the gate; extra deployment flags are rejected. `npm run wrangler -- deploy --dry-run` verifies Worker bundling locally without deploying. `npm run check:secrets -- --env staging` checks remote secret names without deployment; listing cannot verify remote values or provider account validity.

**Deployed to:** brainhalf.com and www.brainhalf.com

### Secrets (set interactively via `npm run wrangler -- secret put <NAME>`)
```
SESSION_SECRET          # Required; persistent random value, >=32 non-padding characters
ATRIA_API_KEY           # Optional; required if Atria is selected, unless XKIRO_API_KEY exists
ATRIA_BASE_URL          # Optional HTTPS endpoint; defaults to https://api.atria-asi.ai/v1
XKIRO_API_KEY           # Optional alias for ATRIA_API_KEY
ANTHROPIC_API_KEY       # Optional — for direct Anthropic models
BEDROCK_API_KEY         # Optional — for AWS Bedrock models
```

`REQUIRED_MODEL_PROVIDERS` in Wrangler vars is the explicit comma-separated deployment/runtime policy. The default is `cloudflare`, requiring binding `AI`; optional providers are not unconditionally required. Each named environment must declare its policy and bindings. Bedrock accepts the shared bearer aliases or the complete AWS key pair; see `src/lib/runtime-config.ts` and README. A value stored in `ATRIA_BASE_URL` is no longer interpreted as an API key: migrate it to the correct secret before releasing. URLs must use HTTPS without embedded credentials, query or fragment.

Invalid signing configuration yields an uncached 503 for API/agent/preview routes, while shell assets and CORS preflight remain available. Signup/login fail before account/session writes, and verification fails closed. There is no ephemeral signing fallback. Runtime generation validates provider policy and actual nonblank credential values; deploy checks can only validate listed secret names and configured bindings. No production secrets were inspected or changed during the remediation.

### Cloudflare Resources (all configured in wrangler.toml)
| Resource | Type | Name/Binding |
|---|---|---|
| `env.ChatAgent` | Durable Object | `ChatAgent` class, SQLite storage |
| `env.REGISTRY` | Durable Object | `AuthRegistry` class, SQLite storage |
| `env.PROJECT_BACKUPS` | R2 Bucket | `brainhalf-project-backups` |
| `env.AI` | Workers AI | Default CF model binding |
| `env.ASSETS` | Static assets | Built `dist/` directory |
| `env.DISPATCHER` | Dispatch Namespace | `brainhalf-projects` |

### DO Migration Safety
**CRITICAL:** Never rename a Durable Object class without adding a `[[migrations]]` entry in `wrangler.toml` with `renamed_classes`. Renaming without migration silently abandons all existing storage (all user projects and accounts lost).

---

## 10. Testing

### Test Suites
| Suite | File | Coverage | Backend needed? |
|---|---|---|---|
| Account isolation | `tests/account-isolation.spec.ts` | Cross-account storage, cross-tab logout | Controlled fixtures |
| Audit remediation | `tests/audit-remediation.spec.ts` | Chat, preview, publication UI, accessibility | Controlled fixtures |
| Edge preview | `tests/edge-preview-remediation.spec.ts` | Actual emitted preview renderer | Local modules/HTTP fixtures |
| Local lifecycle | `tests/ai-ide-e2e-001-lifecycle.spec.ts` | Stop, project switching, completed local cache deletion, mobile, socket reconnect | Controlled fixtures |
| Platform checks | `tests/platform-checks-regression.spec.ts` | Actual helper checks, missing evidence, injected history/storage/browser errors | Controlled fixtures |
| Legacy/live suites | Other `tests/**/*.spec.ts` | Historical model, benchmark, chaos and production scenarios; not locally certified | Explicit opt-in and reviewed targets |

### Test Status
- `npm run test:e2e` selects only the five reviewed local suites in `tests/browser-policy.ts`. Historical passing estimates for the larger legacy collection are not current validation evidence.
- `npm run test:e2e:live`, `npm run test:all-models` and `npm run benchmark` use `playwright.live.config.ts`, which refuses to load without `BRAINHALF_ALLOW_LIVE_TESTS=1`. Some legacy specs hardcode production URLs; review and obtain permission before selecting a suite. Opt-in is not a claim that those tests are correct or passing.
- `runPlatformLevelChecks` now reports eight measured checks, not twelve assumed capabilities. Its fourth argument supplies the verified account id and two distinct project fixtures. Missing evidence fails persistence/isolation checks. It captures console/page errors only during its measured interval and removes its listeners afterward. It does not claim model attribution, backend auto-fix, remote deployment, or full-session console cleanliness.
- Local lifecycle fixtures seed once, retain mocked per-project history, serve Monaco assets from disk and hold generation open until explicitly stopped. Cache deletion is awaited before reloading. A controlled socket restart is not a real network-outage test.
- **Deletion follow-up:** the landing Delete action invokes synchronous browser-store deletion, not the authenticated server DELETE API. Registry reconciliation can reintroduce server-listed project metadata; publication is not revoked by that UI flow. This is separate from the tested server tombstone/access checks and needs its own UI/API integration fix. Immediate unload before asynchronous IndexedDB deletion finishes is not covered by the completed-write lifecycle assertion.

### Key Playwright Selectors
```
data-testid="topbar-status-pill"     # Status pill in TopNav
data-testid="stop-generation-btn"    # Stop button (shown while generating)
data-testid="send-prompt-btn"        # Send button
button[aria-label="User profile and menu"]  # User avatar button
button[title="Change AI model"]      # Model picker
button[title*="Send"]                # Send button (alternate)
button[title*="Stop generation"]     # Stop button (alternate)
.top-nav-project-tab                 # Project name in top nav
.landing-project-card                # Recent project card on landing page
.viewport-pill-btn                   # Desktop/Tablet/Mobile buttons
```

### Auth Setup in Tests
```javascript
await page.addInitScript(() => {
  localStorage.setItem('bh_session_token', 'bh_dev_local_token_not_a_real_session');
  localStorage.setItem('bh_session_user', JSON.stringify({ id: 'dev-user-1', email: 'dev@brainhalf.local' }));
});
await page.goto('http://localhost:5173/?project=<id>', { waitUntil: 'domcontentloaded' });
// NEVER use waitUntil: 'networkidle' — WebSocket keeps the connection open forever
```

---

## 11. Current Git Branch & Uncommitted Work

**Branch:** `fix/full-test-and-polish`  
**Main branch:** `main`

### Uncommitted Changes (deployed but not committed)
```
M src/components/ChatPanel.tsx       # Auto-send fix + error handler fix
M src/components/CodeFileBlock.tsx   # Split-button Open in Editor
M src/components/LandingPage.tsx     # Hero rewrite + thumbnails + dedupe
M src/components/Workspace.tsx       # Toolbar simplify + skeleton overlay + auto-refresh
M src/index.css                      # Status colors + skeleton CSS + snippet CSS
M src/lib/status-store.ts            # Stopped→green, Connecting→blue
D fullstack_backend_tab_verified.png # Deleted stale screenshot
? playwright-screenshot.png          # Untracked stale screenshot (safe to delete)
```

**All changes have been deployed to production** via `npx wrangler deploy` (Version ID: `7b9acabf-dfd9-407b-88aa-8709123309df`).

---

## 12. What NOT To Break

These are fragile areas where past bugs have occurred — handle with care:

1. **`pendingAutoSendRef` check order** — Must remain the FIRST branch in the WS `onmessage` history handler (before any `getProjectMessages` call). If you move it inside a localStorage check, auto-send from landing page breaks silently.

2. **Durable Object migrations** — Never rename `ChatAgent` or `AuthRegistry` class names without a `[[migrations]]` block in `wrangler.toml`. This silently wipes all user data.

3. **`waitUntil: 'networkidle'` in Playwright** — Always use `'domcontentloaded'`. WebSocket keeps the connection open, so networkidle never fires and tests time out.

4. **Iframe key change (`edgeRefreshCounter`)** — `handleRefresh()` increments this, causing the iframe to fully remount. It's used intentionally when files are replaced wholesale. Calling it on every file change would cause constant flickering.

5. **`IdempotencyStore.claim(null)`** — Returns `true` (allows through). Messages without an idempotency key are never deduplicated. This is intentional for tool calls.

6. **`isComplete` flag on `file-generated` events** — Streaming chunks use `isComplete: false` (don't persist, don't sync to iframe storage). Only `isComplete: true` calls `commitFiles`. Don't change this — persisting every chunk causes race conditions.

7. **`hasGeneratedAppCode()` function** — Checks if `App.jsx` content matches known starter template markers. If the starter template changes, update the markers list in this function or projects will always appear as "not generated."

---

## 13. Model System

### Available Models (src/lib/models.ts)
```
Cloudflare Workers AI (via env.AI):
  @cf/qwen/qwen2.5-coder-32b-instruct       (DEFAULT)
  @cf/meta/llama-3.3-70b-instruct-fp8-fast
  @cf/meta/llama-4-scout-17b-16e-instruct
  @cf/qwen/qwen3-8b-27b (?)
  ... (full list in models.ts)

Anthropic (via ANTHROPIC_API_KEY secret):
  claude-sonnet-4-5, claude-haiku-4-5, etc.

AWS Bedrock (via BEDROCK_API_KEY secret):
  Bedrock-hosted Claude models

Atria (via ATRIA_API_KEY + ATRIA_BASE_URL secrets):
  Custom model endpoint
```

### Model Resolution
`resolveModel(name, provider?)` in `models.ts`:
1. Checks allowlist for exact name match
2. Routes to appropriate provider
3. Falls back to default CF model if unrecognized

---

## 14. Quick-Start Checklist for a New AI Assistant

If you're picking this up fresh, do this first:

- [ ] Read `src/agent.ts` (~2466 lines) — this is the AI brain, everything generation-related is here
- [ ] Read `src/components/ChatPanel.tsx` — this is the client side of generation (WS, streaming, file events)
- [ ] Read `src/components/Workspace.tsx` — this owns the editor + preview iframe + file state
- [ ] Check `src/lib/events.ts` for the full event bus API before adding cross-component communication
- [ ] Run `npm run dev` and test with the dev auth token above before making changes
- [ ] Run `npm test` to verify unit tests pass
- [ ] Run `npm run build` before deploying to catch TypeScript errors
- [ ] Deploy with `npm run deploy` (not `wrangler deploy` directly — the predeploy script handles secrets check)
