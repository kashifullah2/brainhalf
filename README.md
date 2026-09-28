# BrainHalf

> **AI-powered cloud IDE on the edge.** Generate, edit, and preview full-stack web applications with multi-model AI, Monaco editor, and isolated browser previews — hosted entirely on Cloudflare's edge network.

**Live:** [brainhalf.com](https://brainhalf.com)

---

## Overview

BrainHalf is an AI engineering workspace where you describe what you want to build and the agent writes the code, previews it live, and deploys it. Projects run on Cloudflare Durable Objects with embedded SQLite, giving every project its own isolated runtime and persistent storage.

---

## Key Features

### AI Code Generation
- Multi-model selector: DeepSeek V4 Pro (default), Claude Sonnet 4.6, GPT-OSS 120B, and others
- Streaming generation with live progress bar showing files being written
- Auto-fix for TypeScript build errors without user action
- Bounded generation with configurable step limits and automatic continuation

### Workspace
- **Monaco editor** with syntax highlighting, TypeScript language server, and word-wrap toggle
- **Split view** — code editor and live preview side by side (toggle with ⊞ button or Ctrl+K → split)
- **Command palette** (Ctrl+K / Cmd+K) — instant fuzzy search across files and actions
- **File explorer** with full CRUD: create files (+), rename (double-click or pencil icon), delete (trash icon with confirmation)
- Click-to-edit inspect mode — click any element in the design preview to pre-fill the chat with an edit prompt
- Right-click context menu in design preview — change text, style, color, or remove elements
- One-click **Undo** button in Code toolbar after every AI generation (restores to pre-generation checkpoint)
- ZIP export, GitHub auto-sync with session PAT, and Publish to production

### Preview
- **Design preview**: isolated sandboxed iframe via `/preview/{projectId}/index.html` — Sucrase JSX/TSX transpilation on the edge, dual-MIME CSS serving, in-browser React runtime
- **Live app preview**: embedded iframe from `dev-{id}.apps.brainhalf.com` — real Cloudflare Worker + D1 database for testing auth/data flows
- Fast expired-session detection — immediately shows error instead of waiting 45 seconds
- Error boundary with "Ask agent to fix" auto-fix button in the preview strip

### Source History
- Agent auto-saves a checkpoint before every generation
- **Source history panel** (Build → Source history): relative timestamps, sectioned by auto-saves vs manual, inline diff with per-file change badges, direct Restore button per row
- Up to 12 checkpoints per project, max 20 MB

### Project Console
- Build, verify, and publish managed apps
- Database viewer — browse D1 tables, paginate rows, download JSON
- Uploaded files management
- Authentication & email configuration (Google OAuth, Resend)
- AI usage monitoring and project settings

### Publishing
- One-click deployment to `{name}.brainhalf.com` production domains
- Verified publication: build → test → publish exact source revision
- Custom domain support

---

## Architecture

```
[ USER BROWSER ]
       │
       ├── WebSocket ────────► Cloudflare Worker (src/worker.ts)
       │                              │
       │                              ▼
       │                   ChatAgent Durable Object
       │                   ├── Embedded SQLite
       │                   │   ├── messages (conversation)
       │                   │   ├── project_files (source)
       │                   │   └── source_checkpoints (history)
       │                   ├── AI streaming router
       │                   │   ├── Cloudflare Workers AI (DeepSeek V4 Pro, etc.)
       │                   │   ├── AWS Bedrock (Claude Sonnet 4.6, etc.)
       │                   │   └── Other providers
       │                   └── /preview/:projectId/ (Sucrase transpiler)
       │
       └── iframe ──────────► /preview/{id}/index.html
                                      │
                              preview-runtime.js
                              ├── Opaque-origin sandbox
                              ├── ESM import resolver (esm.sh)
                              ├── In-memory simulated backend
                              └── Error reporting + auto-fix
```

---

## Repository Structure

```
brainhalf/
├── src/
│   ├── agent.ts                  # ChatAgent Durable Object (SQLite, AI streaming, preview router)
│   ├── worker.ts                 # Cloudflare Worker entrypoint
│   ├── App.tsx                   # Root application
│   ├── components/
│   │   ├── Workspace.tsx         # Main IDE: editor, file tree, preview, split view, toolbar
│   │   ├── ChatPanel.tsx         # AI chat, model selector, attachment upload, streaming
│   │   ├── PreviewRunner.tsx     # Sandboxed preview runtime (inspect mode, context menu)
│   │   ├── PreviewCanvas.tsx     # Preview toolbar: viewport, refresh, inspect, popout
│   │   ├── FileExplorer.tsx      # File tree with CRUD (create/rename/delete)
│   │   ├── CommandPalette.tsx    # Ctrl+K command palette (files + actions)
│   │   ├── ProjectHistory.tsx    # Source history UI (checkpoints, diff, restore)
│   │   ├── ProjectConsole.tsx    # Build, database, auth, monitoring console
│   │   ├── ProjectDatabase.tsx   # D1 table browser
│   │   ├── GenerationProgress.tsx # Streaming progress bar
│   │   ├── PublishDialog.tsx     # Publish to production workflow
│   │   └── ...                   # Auth, settings, dashboard, onboarding
│   ├── lib/
│   │   ├── automatic-backend.ts  # Live app preview ticket + CHIPS cookie lifecycle
│   │   ├── automatic-build-fix.ts # Auto-fix TypeScript errors after build failures
│   │   ├── github-export.ts      # GitHub tree-based commit export
│   │   ├── preview-isolation.ts  # Preview sandbox config and file filtering
│   │   ├── project-store.ts      # IndexedDB/localStorage project file persistence
│   │   ├── source-history.ts     # SourceHistory class + SourceCheckpoint schema
│   │   ├── models.ts             # MODEL_ALLOWLIST, provider routing, output limits
│   │   ├── events.ts             # Type-safe appEvents pub/sub bus
│   │   ├── templates.ts          # Project starter templates
│   │   └── utils.ts              # Path normalization, file helpers
│   ├── runtime/                  # Live app preview integration (CHIPS cookies, tickets)
│   └── __tests__/                # Vitest unit and integration tests (96 files)
├── public/
│   ├── _headers                  # Cloudflare cache and security headers
│   ├── fonts/                    # Self-hosted Bricolage Grotesque, DM Mono, Instrument Sans
│   └── images/                   # Social/OG images
├── tests/
│   ├── browser/                  # Playwright E2E suites (local fixture, no live AI)
│   └── benchmark/                # Benchmark runner (results excluded from git)
├── dist/                         # Production build output (gitignored)
├── wrangler.toml                 # Cloudflare Workers config (DO, AI, Assets, R2)
├── vite.config.ts                # Vite build config (main app + preview runtime)
├── tsconfig.json                 # TypeScript strict config
├── package.json                  # Dependencies and npm scripts
├── PLATFORM_INFO.md              # Authoritative technical specification
├── ARCHITECTURE.md               # Architecture and structure map
├── DECISIONS.md                  # Architecture decision log
├── MODELS.md                     # Model registry (providers, IDs, limits)
├── TODO.md                       # Roadmap and task backlog
├── SEO_HANDOFF.md                # SEO page map, verification, measurement plan
└── BRAND_EMAIL_HANDOFF.md        # Brand assets, email setup, Google OAuth config
```

---

## Getting Started

### Prerequisites
- Node.js `v22.18.0+`
- npm `v10.0.0+`
- Cloudflare account (Workers AI binding, Durable Objects, R2)

### Install
```bash
git clone https://github.com/kashifullah2/brainhalf.git
cd brainhalf
npm install
```

### Local Development
```bash
npm run dev
```
Opens at [http://localhost:5173](http://localhost:5173). Auth uses a local fixture; Google sign-in reports unavailable locally.

---

## Testing

```bash
# Unit + integration tests (Vitest)
npm test

# TypeScript check
npx tsc --noEmit

# Lint (Oxlint)
npm run lint

# Local E2E browser tests (no live AI, no deploys)
npm run test:e2e

# SEO tests against local Worker
npm run test:e2e:seo
```

Live inference and production tests require explicit authorization:
```bash
BRAINHALF_ALLOW_LIVE_TESTS=1 npm run test:e2e:live -- tests/your-suite.spec.ts
```

---

## Deployment

### 1. Configure secrets
```bash
npm run wrangler -- secret put SESSION_SECRET   # 32+ chars, required
npm run wrangler -- secret put GOOGLE_CLIENT_ID
npm run wrangler -- secret put GOOGLE_CLIENT_SECRET
npm run wrangler -- secret put RESEND_API_KEY
```

See [BRAND_EMAIL_HANDOFF.md](./BRAND_EMAIL_HANDOFF.md) for full Google OAuth and email setup.

### 2. Deploy
```bash
# Verify + check remote secrets + deploy
npm run deploy

# Deploy runtime + main app together
npm run deploy:platform
```

The guarded deploy command runs `npm run verify:release` before deploying. It rejects source changes after verification and archives the exact built source.

### Provider configuration

| Provider | Required |
|---|---|
| `cloudflare` (default) | `AI` Workers AI binding |
| `anthropic` | `ANTHROPIC_API_KEY` secret |
| `aws` | `BEDROCK_API_KEY` or `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` |
| `atria` | `ATRIA_API_KEY` secret |

`wrangler.toml` declares `REQUIRED_MODEL_PROVIDERS = "cloudflare"`. Use a comma-separated list for additional providers.

---

## Preview Security

The design preview runs in a **sandboxed opaque-origin iframe**:
- Response CSP: `sandbox allow-scripts allow-forms allow-popups`
- No `allow-same-origin` — generated code cannot access platform cookies, session, IndexedDB, or other projects
- `preview-runtime.js` has no platform auth imports and uses isolated in-memory storage
- AI fix requests require confirmation in a trusted platform dialog

Do not remove the sandbox policy, add `allow-same-origin`, or bypass Worker-first routes in `wrangler.toml`.

---

## License

Private & Proprietary © BrainHalf. All rights reserved.
