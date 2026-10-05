# BrainHalf — Architecture Diagrams

## 1. Full System Component Map

```
┌─────────────────────────────────────────────────────────────────────┐
│  BROWSER                                                             │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  React SPA (src/main.tsx → src/App.tsx)                      │   │
│  │  ┌────────────┐  ┌─────────────────┐  ┌────────────────────┐│   │
│  │  │ LandingPage│  │   ChatPanel     │  │    Workspace       ││   │
│  │  │            │  │  (WebSocket WS) │  │  Monaco + Preview  ││   │
│  │  └────────────┘  └────────┬────────┘  └────────────────────┘│   │
│  │                           │ WS                                │   │
│  └───────────────────────────┼──────────────────────────────────┘   │
│                              │ HTTP + WS + Cookie                    │
└──────────────────────────────┼──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  CLOUDFLARE EDGE — Main Worker (src/worker.ts)                       │
│                                                                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐  │
│  │ /api/auth/*  │  │ /api/admin/* │  │ /api/projects/:id/       │  │
│  │ Google OAuth │  │ Admin gate   │  │ runtime/* proxy          │  │
│  └──────┬───────┘  └──────┬───────┘  └────────────┬─────────────┘  │
│         │                 │                         │                │
│  ┌──────▼───────────────────────────────────────┐  │                │
│  │  AuthRegistry DO                              │  │ Service        │
│  │  registry.ts                                  │  │ Binding        │
│  │  (users, sessions, projects, models,          │  ▼                │
│  │   AI budget, rate limits, gallery)            │ ┌──────────────┐ │
│  └───────────────────────────────────────────────┘ │ Runtime      │ │
│                                                     │ Worker       │ │
│  ┌──────────────────────────────────────────────┐  │ (separate    │ │
│  │  ChatAgent DO (per project)                   │  │ deployment)  │ │
│  │  agent.ts                                     │  └──────────────┘ │
│  │  (files, history, generation, attachments)    │                │
│  │  ↑ Reached via:                               │                │
│  │   /agents/chat-agent/:id (WS)                 │                │
│  │   /preview/:id/* (HTTP)                       │                │
│  └──────────────────────────────────────────────┘  │                │
│                                                       │                │
│  ┌────────────────────────────────────────────────┐ │                │
│  │  Cloudflare Assets (dist/)                     │ │                │
│  │  Static HTML, JS bundles, fonts, images        │ │                │
│  └────────────────────────────────────────────────┘ │                │
│                                                       │                │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │  Dispatch Namespace (brainhalf-projects)                        │ │
│  │  /p/:alias → per-project Worker scripts                        │ │
│  └─────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  CLOUDFLARE EDGE — Runtime Worker (brainhalf-runtime)                │
│                                                                       │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  RuntimeControl (WorkerEntrypoint)                           │    │
│  │  runtime/worker.ts                                           │    │
│  │  Routes: /stop /unregister /hosted/sweep /delete /status     │    │
│  └──────────────────────┬──────────────────────────────────────┘    │
│                          │                                            │
│  ┌───────────────────────▼──────────────────────────────────────┐   │
│  │  ProjectRuntime DO (per project)                              │   │
│  │  runtime/project.ts                                           │   │
│  │  (Sandbox jobs, D1 migrations, Worker deploy, verification)   │   │
│  └──────────────────────┬────────────────────────────────────── ┘   │
│                          │                                            │
│  ┌───────────────────────▼──────────────────────────────────────┐   │
│  │  PilotCoordinator DO (global)                                 │   │
│  │  runtime/pilot.ts                                             │   │
│  │  (Hosted slot allocation, max 10 per user)                    │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                       │
│  External: Cloudflare D1 API, R2, Workers Deploy API                 │
└─────────────────────────────────────────────────────────────────────┘
```

## 2. Generation Pipeline Sequence

```
ChatPanel                    Worker             ChatAgent DO         AI Provider
    │                           │                     │                    │
    │──WS upgrade+ticket────────▶                     │                    │
    │                    verify ticket                │                    │
    │                    inject userId                │                    │
    │◀──WS open─────────────────────────────────────│                    │
    │◀──{type:'history',messages,files}──────────────│                    │
    │                                                 │                    │
    │──{type:'generate',prompt,model,files}──────────▶                    │
    │                           idempotency.claim()   │                    │
    │                           generationLock.run()  │                    │
    │                           AiBudget.start()      │                    │
    │                           buildSystemPrompt()   │                    │
    │                                                 │──streamText()─────▶│
    │◀──{type:'status','Generating'}─────────────────│                    │
    │◀──{type:'token', content}◄──────────────────── │◄──token chunk──────│
    │    (RAF-throttled, per token)                   │                    │
    │◀──{type:'file_updated', path, content}─────────│                    │
    │    (on each complete <file> block)              │                    │
    │                                                 │◄──finish stream────│
    │                           extractFiles()        │                    │
    │                           saveGenerationTurn()  │                    │
    │                           AiBudget.end()        │                    │
    │◀──{type:'done', summary}────────────────────────│                    │
```

## 2b. CORS Origin Gate (post-fix)

```
Request arrives at Worker
        │
        ▼
_isDev = Boolean(env.IS_DEV)   ← set once per request at top of fetch()
        │
corsHeaders(origin):
  isAllowedOrigin(origin, { IS_DEV: _isDev })
        │
   ┌────┴────────────────────────────────────┐
   │ origin in PRODUCTION_ORIGINS?           │
   │  ['https://brainhalf.com',              │
   │   'https://www.brainhalf.com']          │
   │  YES → reflect origin                   │
   │                                         │
   │ origin in DEV_ORIGINS AND _isDev=true?  │
   │  ['http://localhost:5173', ...]         │
   │  YES → reflect origin                   │
   │                                         │
   │ Otherwise                               │
   │  → reflect 'https://brainhalf.com'     │
   └─────────────────────────────────────────┘

Config:
  wrangler.toml  →  IS_DEV = "false"   (never reflects localhost in prod)
  .dev.vars      →  IS_DEV = true      (reflects localhost in local dev)
```

## 2c. Runtime Proxy Headers (post-fix)

```
Worker receives:
  POST /api/projects/:id/runtime/:path
  Content-Type: multipart/form-data; boundary=...   (file upload)
  x-file-name: my-document.pdf

BEFORE FIX:
  Runtime received:
    Content-Type: application/json   ← WRONG (hardcoded)
    (x-file-name: missing)           ← DROPPED

AFTER FIX:
  Runtime receives:
    Content-Type: multipart/form-data; boundary=...  ← forwarded
    x-file-name: my-document.pdf                     ← forwarded
    x-bh-project: proj-...
    x-bh-owner: user-...
```

## 3. Preview System Architecture

```
Workspace Component
│
├─── [Runtime Active?]
│    YES → LivePreviewFrame
│    │      <iframe src="/preview/{projectId}/">
│    │      Authentication via httpOnly cookie
│    │      Served by Worker → ChatAgent → Sandbox dev build
│    │
│    NO → PreviewCanvas
│          <iframe sandbox="allow-scripts allow-forms allow-popups">
│          src = blob:// or data: URL
│          
└─── PreviewRunner (in-browser, inside iframe)
      │
      ├── Reads #preview-data JSON (files injected by Worker)
      ├── Import map: 14 static + dynamic esm.sh entries
      ├── sucrase.transform() for each .tsx/.ts file
      ├── new Function(code) execution  
      ├── InMemoryDataStore for /api/* calls
      └── window.parent.postMessage for errors

Security layers:
  Worker → previewFiles() filters out secrets, dotfiles, .key, .sqlite
  Worker → previewSecurityHeaders() sets sandbox CSP
  Worker → isolatedPreviewHtml() escapes JSON payload (replaces <)
  iframe → opaque origin (no allow-same-origin) → cannot access parent
```

## 4. Authentication Flow

```
SIGNUP/LOGIN:
Browser ──POST /api/auth/login──► Worker ──► AuthRegistry DO
                                              │ verifyPassword(PBKDF2)
                                              │ issueToken(HMAC-SHA256)
                                              │ store sha256(token) in sessions table
                                              ◄─ {token, user}
Browser ◄── Set-Cookie: bh_session (httpOnly, Secure, SameSite=Lax)
         ◄── {token} → localStorage['bh_session_token']

WEBSOCKET:
Browser ──POST /api/auth/ws-ticket──► Worker ──► AuthRegistry
                                                   │ issue bhwt_<random>
                                                   │ store {ticket, userId, sessionHash, exp:+60s}
                                                   ◄── {ticket}
Browser ──WS upgrade /agents/chat-agent/:id?ticket=bhwt_...──► Worker
                                              │ extractWsTicket()
                                              │ redeemWsIdentity() ──► AuthRegistry (DELETE ticket)
                                              │ injectUserId(req, userId, sessionHash)
                                              ──► ChatAgent DO (x-auth-user-id header)

SESSION VERIFY (each API request):
Worker.verifySession(request):
  1. extractToken() — header / cookie / (WebSocket query)
  2. verifyTokenSignature(token, SESSION_SECRET) — stateless HMAC check
  3. Registry.fetch('/auth/session?tokenHash=sha256(token)') — revocation check
  4. Return {userId, email} or null
```

## 5. Database Entity Relationships

```
AuthRegistry SQLite (global)
┌──────────────────────────────────────┐
│ users                                 │
│  id PK, email UNIQUE, password_hash,  │
│  created_at                           │
└──────────────────────┬───────────────┘
                        │ 1:N
┌──────────────────────▼───────────────┐
│ sessions                              │
│  token_hash PK, user_id FK,           │
│  created_at, expires_at               │
└───────────────────────────────────────┘

┌──────────────────────────────────────┐
│ project_owners                        │
│  project_id PK, user_id, name,        │
│  created_at, updated_at               │
│  published (boolean, default false)   │
│  showcased (boolean, default false)   │
│  remix_count                          │
└───────────────────────────────────────┘

ChatAgent SQLite (per project)
┌──────────────────────────────────────┐
│ messages                              │
│  id AUTOINCREMENT PK,                 │
│  role ('user'|'assistant'|'system'),  │
│  content, created_at                  │
└───────────────────────────────────────┘
┌──────────────────────────────────────┐
│ project_files                         │
│  path PK,                             │
│  content, updated_at                  │
│  ← triggers update project_file_revision │
└───────────────────────────────────────┘
┌──────────────────────────────────────┐
│ generation_jobs                       │
│  id PK, prompt, model, status,        │
│  completed_files (JSON array),        │
│  resume_count, parent_job_id,         │
│  started_at, updated_at               │
└───────────────────────────────────────┘
┌──────────────────────────────────────┐
│ generation_usage                      │
│  id PK, model, status,                │
│  started_at, finished_at,             │
│  input_tokens, output_tokens,         │
│  first_response_at, provider_calls,   │
│  source_revision                      │
└───────────────────────────────────────┘
```

## 6. Model Provider Decision Tree

```
resolveModel(name, provider?)
        │
        ▼
MODEL_ALLOWLIST exact match?
  NO → null (request refused)
  YES → AllowedModel { provider, id, maxTokens }
        │
        ▼
selectModelTransport(model, creds)
        │
   ┌────┴────────────────────────────────┐
   │ anthropic && !ANTHROPIC_API_KEY?    │
   │   → try resolveModel(name, 'aws')  │
   │                                    │
   │ aws && !hasBedrockCredentials?     │
   │   → try resolveModel(name, 'anthropic') │
   └────┬────────────────────────────────┘
        │
        ▼
providerModel(model, creds, env):
  cloudflare → env.AI binding (Workers AI)
  aws        → createAmazonBedrock(bedrockConfig)
  anthropic  → createAnthropic({apiKey})
  atria      → createOpenAI({baseURL, apiKey})
  custom     → createOpenAI({baseURL, apiKey: decryptedKey})
```
