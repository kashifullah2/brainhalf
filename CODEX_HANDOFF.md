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
  authorizeOrClaim(): if project has no owner, claim it; else verify
  isReadOnlyProject set to true if ownership denied → shows "Clone to My Projects" banner
```

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
npm run test        # Vitest unit tests
npm run test:e2e    # Playwright E2E (needs dev server running)
npm run lint        # Oxlint
npm run deploy      # build + wrangler deploy (needs secrets set)
npm run r2:lifecycle  # Set R2 expiry policy (run once per bucket)
```

---

## 9. Deployment

### Deploy to Cloudflare
```bash
npm run deploy
```
This runs: `scripts/check-secrets.mjs` → `vite build` → `wrangler deploy`

**Deployed to:** brainhalf.com and www.brainhalf.com

### Required Secrets (set once via `wrangler secret put <NAME>`)
```
SESSION_SECRET          # Used for signing session tokens
ATRIA_API_KEY           # Atria model provider
ATRIA_BASE_URL          # Atria base URL
XKIRO_API_KEY           # Xkiro model provider
ANTHROPIC_API_KEY       # Optional — for direct Anthropic models
BEDROCK_API_KEY         # Optional — for AWS Bedrock models
```

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
| Platform security | `tests/platform/security.spec.ts` | Auth gates, XSS, CORS | No |
| Project lifecycle | `tests/e2e-projects-lifecycle.spec.ts` | Create/open/delete | No |
| Agent scenarios | `tests/playwright-agent.spec.ts` | T01–T20 generation | Yes (prod) |
| QA master suite | `tests/qa-master-suite.spec.ts` | Tier 1–4 apps | Yes (prod) |
| Chaos suites | `tests/chaos-*.spec.ts` | Race conditions, mutations | Yes (prod) |
| Production breaker | `tests/production-breaker-deep-stress.spec.ts` | Full stress | Yes (prod) |

### Test Status
- **~222/264 passing locally** (dev server only, no Durable Objects)
- **~42 tests require production backend** (Cloudflare Workers AI / DO)

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
