# BrainHalf 🧠⚡

> **The Autonomous AI Software Engineering Platform & Cloud IDE on the Edge**  
> Generate, edit, and preview web applications with Cloudflare Workers, Durable Objects with SQLite, and multi-model AI. Full-stack production execution requires an application-owned backend.

Live Platform: **[brainhalf.com](https://brainhalf.com)** & **[www.brainhalf.com](https://www.brainhalf.com)**

---

## 🌟 Overview

**BrainHalf** is an AI engineering workspace hosted on Cloudflare's edge network. It combines streaming AI code generation with an interactive IDE, Monaco code editor, and isolated browser previews.

BrainHalf serves project files from the edge and transpiles JSX/TSX with Sucrase. Generated frontend code executes in an isolated browser document, not a server container. Preview startup depends on project size, dependencies and network availability.

---

## 🚀 Key Features

### 1. Isolated Application Preview
- `/preview/:projectId/` serves an authorized project snapshot to an isolated browser runtime.
- Supports React JSX/TSX applications and plain HTML/CSS/JavaScript with local modules, styles and SVG assets.
- Loads reachable external dependencies through `esm.sh`, preserving declared package versions and a shared React instance.
- Reports render, script, promise and dependency-loading errors in the preview; corrected files can recover the preview.
- HTML updates reload the isolated document so script globals and event listeners restart cleanly. Temporary preview data resets on reload.

### 2. Multi-Model AI Engine
The streaming router offers Cloudflare Workers AI, AWS Bedrock, and Atria model entries. DeepSeek V4 Pro (`@cf/deepseek-ai/deepseek-v4-pro-0813`) is the default in both the browser and server. Dahl MiniMax M2.7 has been removed from the picker and server allowlist. `MODEL_ALLOWLIST` in `src/lib/models.ts` defines accepted client names, provider IDs and output limits; the model picker derives its choices from that list. Configured aliases can differ from provider IDs. Selection does not establish live availability: the provider must have valid credentials, bindings, endpoint configuration and model access. Failed requests do not silently fall back to an older model.

### 3. Bounded Generation & Continuation
- Enforces configured model output limits and bounds tool execution steps.
- Retries compatible token-limit failures on the selected model; credentials and provider failures are reported.
- Requests continuation for incomplete file output after the current turn finishes. Generation quality and maximum output remain subject to the selected provider's limits.
- Tool-based edits require a complete, current file read. `edit_file` applies exact, unique replacements atomically and rejects stale reads or syntax errors. Whole-file writes cannot overwrite unread existing files. Text-based edit blocks reject missing or ambiguous matches rather than guessing.

### TypeScript And Full-Stack Projects

New workspaces use a shared strict TypeScript/React starter on both client and server. Existing JavaScript projects keep their architecture and files.

Open **Project actions → Project console** to build and start a development app, verify its exact source revision, and explicitly publish a verified Workers app to production. The console also provides database management, uploaded files, authentication/email, source recovery, monitoring, and account-wide AI allowance. Source history and AI usage remain accessible without managed hosting.

Managed hosting remains limited to the configured pilot owners. Before a request that needs a backend, BrainHalf checks availability. Accounts without hosting can explicitly choose **Build downloadable app**: new projects then use a standalone TypeScript Node backend with setup instructions for the user's own hosting. Existing project architectures are preserved. The hosted browser preview does not run exported Node processes or their databases. No simulated backend success is supplied.

Generation completion is distinct from application verification. The model picker reports response completion, and the console displays behavioral checks only when their source revision matches. Failed or stale verification prevents managed production publication. Node projects support development builds/previews; their production deployment uses the exported project's own hosting.


### 4. Spec-Compliant Dual-MIME CSS Serving
- **Module Import Compatibility**: When a file executes `import './styles.css'`, the edge preview serves a spec-compliant JavaScript module (`Content-Type: application/javascript; charset=utf-8`) that injects a `<style>` element into `<head>` and exports the CSS string (`export default css`).
- **Stylesheet Compatibility**: When requested via `<link rel="stylesheet">`, it serves raw CSS (`Content-Type: text/css; charset=utf-8`).
- Completely eliminates browser strict MIME type violations.

### 5. Durable Object SQLite Persistence
- Every project session is bound to a unique Cloudflare Durable Object (`ChatAgent`) backed by embedded SQLite.
- Fully persists:
  - **`messages`**: Multi-turn conversation history and tool outputs.
  - **`project_files`**: Clean, synchronized project filesystem (`/src/App.jsx`, `/src/styles.css`, `/index.html`, etc.).

### 6. Interactive Monaco IDE & Workspace
- Resizable split-pane layout (Chat / Monaco Code Editor / Live Preview).
- Syntax highlighting, auto-completion, line numbers, and dark cyber aesthetics.
- Real-time file tree navigation and active file indicator.
- One-click ZIP export (`JSZip`) and project sharing via persistent URL query parameters (`?project=<id>`).

---

## 🏗️ System Architecture

```
                                  [ USER BROWSER ]
                                         │
                 ┌───────────────────────┴───────────────────────┐
                 │                                               │
          [ WebSocket ]                                    [ HTTP / Preview ]
                 │                                               │
                 ▼                                               ▼
      ┌─────────────────────┐                         ┌─────────────────────┐
      │  Cloudflare Worker  │                         │  Cloudflare Worker  │
      │   (src/worker.ts)   │                         │   (src/worker.ts)   │
      └──────────┬──────────┘                         └──────────┬──────────┘
                 │                                               │
                 ▼                                               ▼
┌──────────────────────────────────┐            ┌──────────────────────────────────┐
│ Durable Object: ChatAgent        │            │ Durable Object: ChatAgent        │
│  - WebSocket onMessage / Stream  │            │  - /preview/:projectId/          │
│  - Embedded SQLite Database      │            │  - On-the-fly Sucrase Transpiler │
│     * messages                   │            │  - Import Maps & ESM Resolver    │
│     * project_files              │            │  - Dual-MIME CSS Injector        │
└──────────┬───────────────────────┘            └──────────────────────────────────┘
           │
           ├─────────────────────────────┐
           ▼                             ▼
┌───────────────────────┐   ┌───────────────────────┐
│ Cloudflare Workers AI │   │      AWS Bedrock      │
│  (env.AI Edge Binding)│   │  (Claude Sonnet/Opus, │
│  - Qwen 2.5 Coder 32B │   │   MiniMax M2.5)       │
│  - Llama 3.3 70B      │   └───────────────────────┘
│  - GLM 5.3 / Kimi     │
└───────────────────────┘
```

---

## 📁 Repository Structure

```
brainhalf/
├── src/
│   ├── agent.ts               # ChatAgent Durable Object (SQLite, AI streaming, Edge Preview router)
│   ├── worker.ts              # Cloudflare Worker entrypoint & preview request dispatcher
│   ├── App.tsx                # Main IDE application container
│   ├── index.css              # Global design system, glassmorphism tokens, animations
│   ├── components/
│   │   ├── ChatPanel.tsx      # AI chat interface, streaming token renderer, model selector
│   │   ├── Workspace.tsx      # Monaco code editor, file tree, isolated preview shell
│   │   ├── TopNav.tsx         # Project name editor, export, share, settings modals
│   │   └── Sidebar.tsx        # Project list, creation, deletion, persistence
│   ├── lib/
│   │   ├── events.ts          # Type-safe pub/sub event bus (appEvents)
│   │   ├── message-parser.ts  # Streaming <file> & <edit> tag extractor and diff patcher
│   │   ├── project-store.ts   # LocalStorage project metadata & history store
│   │   ├── templates.ts       # Baseline starter templates (React + Tailwind + Lucide)
│   │   └── utils.ts           # Path normalization and file helpers
│   └── __tests__/             # Comprehensive Vitest unit and integration test suite
├── public/
│   ├── _headers               # Cloudflare Pages / Workers strict cache & security headers
│   └── favicon.svg            # Platform favicon
├── dist/                      # Production client build assets
├── wrangler.toml              # Cloudflare Workers configuration (DO, AI, Assets bindings)
├── vite.config.ts             # Vite build & bundler configuration
├── tsconfig.json              # TypeScript strict configuration
├── TODO.md                    # Platform roadmap & task backlog
├── PLATFORM_INFO.md           # Authoritative single-source-of-truth technical reference
└── package.json               # Project dependencies and npm scripts
```

---

## 🛠️ Getting Started

### Prerequisites
- **Node.js**: `v22.18.0` or higher
- **npm**: `v10.0.0` or higher
- **Cloudflare Account**: For Workers AI, Durable Objects, and Wrangler CLI deployment
- **AWS Bedrock Account** *(Optional)*: If utilizing Claude Sonnet 4.6 or MiniMax M2.5

### Installation
```bash
# Clone the repository
git clone https://github.com/kashifullah2/brainhalf.git
cd brainhalf

# Install dependencies
npm install
```

### Local Development
```bash
# Start Vite development server
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

---

## 🧪 Testing & Linting

BrainHalf maintains strict code quality standards:

```bash
# Run Vitest tests and Node deployment-tool regressions
npm test

# Run high-performance Oxlint
npm run lint

# TypeScript verification
npx tsc --noEmit
```

`npm run test:e2e` selects six reviewed local-fixture browser suites: account isolation, audit remediation, edge preview, lifecycle, platform checks, and critical/high remediation. Playwright starts Vite and Chrome; these suites do not call live inference or publish applications. They use `domcontentloaded` and observable UI/protocol conditions rather than waiting for WebSocket connections to become idle.

The lifecycle test holds a mocked generation open until Stop is clicked, verifies the stop request, switches between two projects with distinct history/files, confirms an authenticated DELETE request, waits for durable cache cleanup, reloads without reseeding the deleted project, and sends a mobile prompt after a controlled socket reconnection. Separate Worker/Registry tests exercise real ownership and publication tombstones; browser API fixtures are not evidence of live remote erasure. Delete revokes access/publication and removes browser files/history; server source, attachments, credentials, runtime resources, and backups are erased by the durable cleanup queue, with completion reported on the dashboard. Failed server deletion retains local recovery files and offers retry. Platform checks report only what they exercise: missing project evidence is a failure, console capture is limited to the measured interval, and opening the publication dialog is not a successful deployment. Legacy callers must supply two `ProjectEvidence` fixtures and the verified account as the fourth argument to `runPlatformLevelChecks` to test persistence/isolation.

### Preview execution boundary

`npm run dev` and `npm run build` build a separate `dist/preview-runtime.js`. The IDE entry never renders generated code. Preview documents use a browser-enforced **opaque origin** through response CSP `sandbox allow-scripts allow-forms`, reinforced by the workspace iframe sandbox; the response policy also covers standalone previews and tenant/agent HTML. This isolates execution despite the URL remaining under the platform hostname. Do not add `allow-same-origin`, remove the response policy, or bypass the Worker-first routes in `wrangler.toml`.

Authorized preview navigation embeds only the selected project's filtered files. The runtime has no platform auth/cache imports, uses its own in-memory backend simulation, and supports project-relative/alias modules and the existing external-package import map. Router wrappers use memory navigation. Generated code cannot access platform cookies, browser caches, IndexedDB, privileged platform APIs, or automatic AI-action authority. Its localStorage/sessionStorage interfaces are isolated, per-document memory stores that reset on reload; they never contain the platform session or another preview's values. AI fix requests require confirmation in a trusted platform dialog. Applications needing durable storage, real backend authentication, or deployment-specific navigation need an application-owned integration rather than access to BrainHalf's session; simulated previews are not production backend verification.

Local hostile-code browser tests probe parent DOM, cookies, localStorage, IndexedDB, network requests and forged AI-fix messages. Worker tests separately check origin rejection, public/private snapshot filtering, and removal of tenant-controlled cookie/storage/security headers. Deployment must include both the runtime asset and Worker configuration; serving `dist` alone is not equivalent to the protected preview service. Production-equivalent verification is still required before release.

Embedded previews wait for a project-matched file snapshot from their parent workspace before executing. The runtime does not execute arbitrary Node/Python processes, native apps, server rendering, database drivers, or package scripts. Bundler-specific features such as CSS modules, `import.meta` and top-level `await` are not implemented. Generated backend files are exportable source; the built-in API simulator does not execute their custom routes. Browser-only storage and simulated API records are temporary. Export and run an application in its intended environment to verify production persistence and integrations.

### Chat and workspace synchronization

The current client and Worker negotiate `snapshot-v2` on connection. Existing server files are fetched before local uploads or queued prompts. If an existing local application differs, the workspace preserves it and offers **Use server files** or **Keep local files**; choosing local files checks the server revision again before writing. Secret files omitted from snapshots are preserved. Normal client writes are serialized and revision-checked. Deploy the matching client and Worker together; older servers use the legacy protocol.

Chat renders generated file blocks as conversation content while persisted server file events update the workspace. Stop retains completed writes, clears pending sends and ignores trailing text. Clear Chat preserves application files. Automatic continuation waits until the active turn completes.

Legacy, paid-provider, benchmark and production-targeting suites are separate and **not verified by the local run**. They may contain stale expectations or hardcoded production URLs; inspect a selected suite and obtain permission before running it. The explicit live config rejects execution unless `BRAINHALF_ALLOW_LIVE_TESTS=1` is set:

```bash
# With explicit authorization and controlled accounts only; select a suite
BRAINHALF_ALLOW_LIVE_TESTS=1 npm run test:e2e:live -- tests/your-reviewed-suite.spec.ts
```

`npm run test:all-models` and `npm run benchmark` use the same guarded live config. An explicitly named legacy spec is not selected by the default local config. Test additions must be classified in `tests/browser-policy.ts`; do not broaden the local pattern to all specs or count missing/unexecuted checks as passes.

---

## 🚢 Deployment to Cloudflare Workers

### 1. Configure Cloudflare Credentials
Use Node.js >=22.18.0 (`.node-version` records the locally verified version), then install the lockfile with `npm ci`. The project pins Wrangler; deployment scripts never download a CLI through `npx` or use a global installation. Ensure you are authenticated:
```bash
npm run wrangler -- login
```

### 2. Configure Environment Secrets
Every Worker environment requires a persistent, randomly generated `SESSION_SECRET` of at least 32 non-padding characters. Enter it through Wrangler's interactive prompt, never in a command argument or a checked-in file:
```bash
npm run wrangler -- secret put SESSION_SECRET
```

Missing, blank, or short signing secrets return an uncached 503 on API, agent and preview routes; the Worker does not generate ephemeral replacement keys. Static shell delivery and CORS preflight remain available. For local Worker development, put the same required configuration in ignored `.dev.vars`; Vite's development auth fixture is not production authentication.

### Google sign-in

For logo assets, contact messages, email verification, password recovery, and Resend setup commands, see [BRAND_EMAIL_HANDOFF.md](BRAND_EMAIL_HANDOFF.md).

Sign-in and sign-up both support **Continue with Google** through the Worker. Email/password sign-in remains available. Create a Google OAuth **Web application** client in Google Cloud Console, configure its consent screen, and add these authorized redirect URIs for the domains you serve:

- `https://brainhalf.com/api/auth/google/callback`
- `https://www.brainhalf.com/api/auth/google/callback` (if you serve the app on `www`)
- `http://localhost:8788/api/auth/google/callback` (optional local Worker testing; match the actual hostname/port exactly)

Set both values as Worker secrets using interactive prompts:

```bash
npm run wrangler -- secret put GOOGLE_CLIENT_ID
npm run wrangler -- secret put GOOGLE_CLIENT_SECRET
```

For local Worker development, add those same variable names to ignored `.dev.vars`. Never put the client secret in a `VITE_*` variable or browser code. The frontend calls its own origin in production; local frontend development can use `VITE_BACKEND_HOST=http://localhost:8788` with a running Worker and the same hostname for both servers. The plain Vite auth fixture intentionally reports Google sign-in as unavailable and allows email sign-in; it does not impersonate Google.

The server exchanges the authorization code with PKCE, consumes browser-bound state once, checks Google's verified userinfo, and identifies returning users by their Google subject. A one-minute HttpOnly handoff completes into the existing revocable session; no session token is put in a redirect URL. Accounts with an existing password and matching email must use their existing password; email matching does not automatically link accounts. Google-only accounts use Google to sign in. While the consent screen is in Testing, add the intended Google accounts as test users. Publish the consent screen when ready for your audience.

Without both credentials, the Google button explains that sign-in is unavailable and keeps the email form usable. Automated tests cover the flow with mocked Google responses and real Registry SQLite; a live account check still requires configured credentials and an authorized test user.

If Google shows **Error 400: redirect_uri_mismatch**, open [Google Auth Platform → Clients](https://console.cloud.google.com/auth/clients) and select the Web application client whose client ID matches the Worker's `GOOGLE_CLIENT_ID`. Under **Authorized redirect URIs**, add exactly `https://brainhalf.com/api/auth/google/callback` and save. The scheme, hostname, path, and trailing slash must match the authorization request. Saving credentials in Cloudflare does not register this callback with Google. This Google Console change does not require redeploying the Worker; start a new sign-in attempt after saving.

Google Analytics uses measurement ID `G-RRR516MXP2` via `src/lib/analytics.ts`. It loads asynchronously on public pages of the production domains, with sanitized page/referrer URLs, and stops collection when an account signs in. Local development, previews, private query URLs, missing pages, and existing signed-in sessions do not initialize Analytics. The initializer is bundled with the app so the CSP does not need executable inline scripts; both CSP sources allow Google's analytics endpoints. After `npm run deploy`, check Analytics **Reports → Realtime** while opening the public site in a signed-out browser. Browser blockers may prevent collection. The browser tests stub Google to avoid polluting the real property.

`wrangler.toml` declares `REQUIRED_MODEL_PROVIDERS = "cloudflare"`, matching the default Workers AI binding. Use a comma-separated list to require additional providers. Repeat this policy and the appropriate bindings in each named environment. The deploy gate and generation runtime share these credential rules:

| Provider | Required configuration |
|---|---|
| `cloudflare` | Workers AI binding named `AI` |
| `anthropic` | `ANTHROPIC_API_KEY` secret |
| `aws` | `BEDROCK_API_KEY`, one of the supported bearer aliases, or both `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` |
| `atria` | `ATRIA_API_KEY` secret |
| `dahl` | `DAHL_API_KEY` secret |

Bedrock bearer aliases are `AWS_BEARER_TOKEN_BEDROCK`, `AWS_API_KEY`, `AWS_BEDROCK_API_KEY`, `BEDROCK_TOKEN`, and `AWS_BEDROCK_KEY`. `AWS_REGION` defaults to `us-east-1`. Atria defaults to `https://api.atria-asi.ai/v1`; an optional `ATRIA_BASE_URL` must be HTTPS without embedded credentials, query or fragment. Dahl defaults to `https://inference.dahl.global/v1`; optional `DAHL_BASE_URL` follows the same HTTPS rules. Optional providers are not mandatory for deployment, but selecting one without its credentials fails explicitly.

`npm run check:secrets` validates remote secret **names**, not their values or provider account validity. It cannot detect a short remote signing secret or an invalid remote endpoint; runtime validation still applies. A supplied local `SESSION_SECRET` is checked, but is not proof of the remote value. Credentials in Wrangler `vars` are rejected.

The production config also declares `REQUIRED_PUBLIC_SERVICES = "email,google"`. Before publishing, the gate requires `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `CONTACT_EMAIL`, `GOOGLE_CLIENT_ID`, and `GOOGLE_CLIENT_SECRET`. API keys and client secrets must be Worker secrets; sender/contact addresses and the public Google client ID may be secrets or valid Wrangler vars. Local shell values do not satisfy deployed configuration. Repeat this service policy in named environments that expose the same account and contact flows. The check does not verify Resend domain approval, actual delivery, or Google's authorized callback URI; those still need live validation.

### 3. Build & Deploy
```bash
# Local bundle verification only (does not deploy)
npm run build
npm run wrangler -- deploy --dry-run

# Release only when ready: verify, check target secrets, then deploy
npm run deploy
```

The guarded deploy command accepts only `--env`/`-e` and `--config`/`-c`; other flags fail rather than bypass checks. For example, `npm run deploy -- --env staging` checks and deploys the same environment. `CLOUDFLARE_ENV` is also forwarded consistently; an explicit flag takes precedence. `npm run check:secrets -- --env staging` checks without deploying. Config paths are resolved before both operations. Avoid direct deployment through the raw CLI, which bypasses the release gate. Production routes remain `brainhalf.com` and `www.brainhalf.com`.

### Appearance

The landing page, account screens, agent workspace, code editor, preview controls, and dialogs share the same fonts and color tokens. The sun/moon button switches between light and dark. First visits follow the device preference; a manual choice is remembered across reloads and tabs. Theme initialization runs before the app styles to avoid a flash of the wrong theme. Generated applications inside the isolated preview keep their own design.

---

## 📄 License

Private & Proprietary © BrainHalf. All rights reserved.


## Public pages and SEO

`npm run build` prerenders the homepage and the public pages in `src/seo/content.ts`, then generates `sitemap.xml` and checks metadata, internal links, structured data, the social image, and crawl controls. The public HTML contains the same content React hydrates in the browser. Private project query URLs are marked `noindex` by the Worker; previews and API responses are excluded as well.

Run `npm run test:e2e:seo` for public-page tests against a local Cloudflare Worker, including no-JavaScript rendering, canonical redirects, 404 status codes, mobile navigation, and deferred editor bundles. This suite does not generate apps or contact AI providers. The main local browser suite remains separate.

See [SEO_HANDOFF.md](./SEO_HANDOFF.md) for the page map, deployment checks, Google Search Console verification and sitemap submission, and the ongoing measurement plan. SEO changes take effect on the live site after deployment; rankings and indexing are controlled by search engines.

## Release and operating controls

- `npm run verify` runs application/runtime typechecks, automated tests, lint, builds, and SEO checks.
- `npm run verify:release` additionally requires both local browser suites, the runtime/container dry run, and real local Worker smoke checks. It fails on any incomplete check. Browser and container checks require localhost/Chrome/Docker access.
- `npm run deploy` invokes the full release verifier directly, checks remote configuration, and rejects source or built-asset changes after verification. Directly calling the deployment script uses the same gate. `.release/validation.json` records the checked source/artifact hashes and `.release/source-<hash>.tar.gz` preserves the exact application source, including uncommitted application files. No production deployment is performed by validation or CI.
- The default AI allowance is shared across all projects and model tests: 60 provider calls, 2,000,000 reserved output tokens per UTC day, and two simultaneous generations. Every actual provider call reserves its maximum output before execution, including retries and SDK tool steps. Reservations stay charged after failures and reset daily; they are protective limits, not monetary billing or actual token usage. Missing allowance or rate-limit storage denies new inference. Limits are defined in `src/lib/ai-budget.ts`.
- The historical `claude-sonnet-6` client key remains compatible with saved sessions; its actual model and visible label are **Claude Sonnet 4.6**.
- Project deletion atomically revokes access and queues durable cleanup. Registry alarms retry runtime resources, agent source/history/attachments/credentials, and backups with persisted progress. Pending/completed cleanup is visible on the dashboard. Minimal ownership tombstones prevent deleted project IDs being reclaimed, and completed cleanup records are retained for 30 days.

For a coordinated production rollout of the hosting runtime and main application, run `npm run deploy:platform`. It requires the complete release checks (including Chrome, localhost and Docker), checks remote secret names for both services, and deploys the runtime before the main app. It preserves existing usage limits and reports a partial rollout if the second upload fails. It does not bypass the release gate.
