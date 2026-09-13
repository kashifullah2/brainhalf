# BrainHalf: Complete Platform Specification & Technical Architecture 📘

> **Authoritative Single-Source-of-Truth Document**  
> This document provides an exhaustive, comprehensive breakdown of the entire **BrainHalf** platform: its architecture, Cloudflare Edge runtime, Durable Objects SQLite storage, dual preview engines, multi-model AI routing, communication protocols, and deployment lifecycle.

---

## 1. Executive Summary

**BrainHalf** is an autonomous AI software engineering platform and cloud development environment hosted directly on Cloudflare's global edge network. It allows users to prompt an AI agent to build, edit, iterate, and run full-stack React applications in real time with zero cold start.

### Key Metrics & Highlights:
- **Domains**: `https://brainhalf.com` & `https://www.brainhalf.com`
- **Global Edge Infrastructure**: Cloudflare Workers with `nodejs_compat` runtime.
- **Edge State Engine**: Cloudflare Durable Objects with embedded SQLite databases.
- **Preview Boot Time**: `< 100ms` (Zero VM/Docker cold start).
- **Supported AI Models**: 8 Frontier & Open-Weight models across Cloudflare Workers AI and AWS Bedrock.
- **Preview Tech**: Dual preview engines (Cloudflare Edge Preview with Sucrase + Sandpack Virtual Bundler).
- **Test Suite**: 61/61 passing unit & integration tests (`vitest`).

---

## 2. System Architecture & Topology

```
┌────────────────────────────────────────────────────────────────────────┐
│                              CLIENT BROWSER                            │
│  ┌─────────────────────────┐  ┌───────────────────┐  ┌───────────────┐ │
│  │  AI Chat Panel          │  │  Monaco Editor    │  │ Live Preview  │ │
│  │  - Model Selector       │  │  - File Tree Nav  │  │ (Edge Preview │ │
│  │  - Streaming Tokens     │  │  - Syntax Highlgt │  │  or Sandpack) │ │
│  └────────────┬────────────┘  └─────────┬─────────┘  └───────▲───────┘ │
└───────────────┼─────────────────────────┼────────────────────┼─────────┘
                │ (WebSocket)             │ (State / Events)   │ (HTTP iframe)
                ▼                         ▼                    │
┌──────────────────────────────────────────────────────────────┴─────────┐
│                      CLOUDFLARE WORKER ROUTER                          │
│                           (src/worker.ts)                              │
│  - Routes /preview/:projectId/* ───► ChatAgent Durable Object          │
│  - Serves static assets (dist/) from env.ASSETS                        │
│  - Proxies WebSocket agent upgrades to routeAgentRequest               │
└───────────────────────────────┬────────────────────────────────────────┘
                                │
                                ▼
┌────────────────────────────────────────────────────────────────────────┐
│                     DURABLE OBJECT: ChatAgent                          │
│                            (src/agent.ts)                              │
│                                                                        │
│  ┌─────────────────────────────┐    ┌────────────────────────────────┐ │
│  │    Embedded SQLite Store    │    │      Edge Preview HTTP Router  │ │
│  │  - messages table           │    │  - /preview/:id/index.html     │ │
│  │  - project_files table      │    │  - On-the-fly Sucrase TSX/JSX  │ │
│  │  - schema_version table     │    │  - Dual-MIME CSS Injector      │ │
│  └──────────────┬──────────────┘    │  - ErrorBoundary mount harness │ │
│                 │                   └────────────────────────────────┘ │
│                 ▼                                                      │
│  ┌───────────────────────────────────────────────────────────────────┐ │
│  │               Multi-Model AI Streaming Engine                     │ │
│  │  - Cloudflare Workers AI Edge Binding (env.AI)                    │ │
│  │  - AWS Bedrock Runtime Client (Claude Sonnet/Opus, MiniMax)       │ │
│  │  - Descending Token Ladder ([16384, 8192, 4096, 2048])            │ │
│  │  - Pre-save Sucrase Transpile Validation Guard                    │ │
│  └───────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Infrastructure & Cloudflare Edge Stack

### 3.1 Worker Configuration (`wrangler.toml`)
- **Worker Name**: `brainhalf`
- **Main Entrypoint**: `src/worker.ts`
- **Compatibility Date**: `2024-09-23`
- **Compatibility Flags**: `["nodejs_compat"]`
- **Bindings**:
  - `ChatAgent`: Durable Object class with SQLite migration tag `v1`.
  - `AI`: Cloudflare Workers AI edge model binding.
  - `ASSETS`: Static asset binding pointing to `dist/`.
- **Observability**: Distributed Tracing enabled with `head_sampling_rate = 0.05`.

### 3.2 Worker Router (`src/worker.ts`)
The edge worker handles three distinct traffic paths:
1. **Edge Preview Routing (`/preview/:projectId/*`)**: Extracts the `projectId`, retrieves the unique Durable Object stub via `env.ChatAgent.idFromName(agentId)`, and forwards the request to the DO's `fetch(request)`.
2. **Root & Static Assets (`env.ASSETS`)**: Serves `dist/index.html` and assets with strict zero-cache headers (`no-cache, no-store, must-revalidate, max-age=0`) to ensure browser clients always run the latest bundle.
3. **Agent WebSocket Routing**: Delegated to `routeAgentRequest(request, env)` from Cloudflare's `agents` SDK for real-time bi-directional messaging.

---

## 4. Durable Object Architecture: `ChatAgent` (`src/agent.ts`)

Each project created in BrainHalf is mapped to an isolated, persistent Cloudflare Durable Object named after the `projectId` (e.g. `proj-u7ywd7-mtx9fwln`).

### 4.1 SQLite Storage Schema
The Durable Object initializes an embedded SQLite database with the following schema:
```sql
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role TEXT,
  content TEXT,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS project_files (
  path TEXT PRIMARY KEY,
  content TEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY
);
```

### 4.2 Seed Files
On initial database creation, `ensureSchema()` seeds default starter files:
- `/src/App.jsx`: Clean baseline interactive React component.
- `/src/main.jsx`: Pristine ErrorBoundary mount harness.
- `/src/styles.css`: Standard base stylesheet.

---

## 5. Dual Preview Architecture

BrainHalf solves the traditional slow preview problem by providing two independent preview runtimes.

### 5.1 Cloudflare Edge Preview Engine (`/preview/:projectId/`)
The primary preview engine runs directly on Cloudflare Workers:
1. **HTML Shell (`/preview/:projectId/index.html`)**:
   - Injects Tailwind CSS via CDN with console-suppression wrappers.
   - Declares native **ES Module Import Maps**:
     ```json
     {
       "imports": {
         "react": "https://esm.sh/react@18.2.0",
         "react/": "https://esm.sh/react@18.2.0/",
         "react-dom": "https://esm.sh/react-dom@18.2.0?external=react",
         "react-dom/client": "https://esm.sh/react-dom@18.2.0/client?external=react",
         "lucide-react": "https://esm.sh/lucide-react@0.344.0?external=react",
         "framer-motion": "https://esm.sh/framer-motion@10.16.4?external=react,react-dom",
         "clsx": "https://esm.sh/clsx@2.1.0",
         "tailwind-merge": "https://esm.sh/tailwind-merge@2.2.1"
       }
     }
     ```
   - Embeds global `window.onerror` and `window.onunhandledrejection` listeners that stream runtime errors back to the parent IDE via `window.parent.postMessage`.
2. **Mount Harness (`/src/main.jsx`)**:
   - The mount harness is protected from accidental LLM overwrites.
   - Mounts `<App />` inside a custom React `ErrorBoundary`.
   - If a runtime error occurs, displays a graceful error card with error details and a one-click reload button.
3. **On-the-Fly Sucrase Transpilation**:
   - All `.jsx`, `.tsx`, `.ts`, and `.js` files requested by the browser are queried from SQLite and transpiled on the fly using `sucrase` with `['typescript', 'jsx']`.
   - Common Lucide icon typos and legacy aliases (e.g. `Chat` -> `MessageSquare`, `Dashboard` -> `LayoutDashboard`, `Spinner` -> `Loader2`, `Gear` -> `Settings`) are automatically resolved before transpilation.
   - Missing React hooks (`useState`, `useEffect`, `useRef`, etc.) are auto-injected if omitted by the AI.
4. **Spec-Compliant Dual-MIME CSS Serving**:
   - If CSS is fetched as an ES module script (`import './styles.css'` with `Sec-Fetch-Dest: script` or `Accept: */*`):
     Serves `Content-Type: application/javascript; charset=utf-8` containing:
     ```javascript
     (function() {
       const id = 'bh-style-' + cleanPath.replace(/[^a-zA-Z0-9]/g, '-');
       let el = document.getElementById(id);
       if (!el) {
         el = document.createElement('style');
         el.id = id;
         document.head.appendChild(el);
       }
       el.textContent = cssContent;
     })();
     export default cssContent;
     ```
   - If CSS is fetched as a stylesheet (`<link rel="stylesheet">` or `Accept: text/css`):
     Serves `Content-Type: text/css; charset=utf-8`.
5. **Cross-Origin Security & CSP**:
   - `Access-Control-Allow-Origin: *`
   - `Cross-Origin-Resource-Policy: cross-origin`
   - `Content-Security-Policy: frame-ancestors *` (permits embedding inside the IDE iframe).

### 5.2 Sandpack Virtual Bundler
- Integrated CodeSandbox virtual bundler for client-side sandboxed testing.
- Uses `SandpackProvider`, `SandpackPreview`, and an explicit Sandpack entrypoint (`/index.tsx`).
- Allows users to toggle preview modes at any time with a single click.

---

## 6. AI Engine, Models & Token Optimization

### 6.1 Supported AI Models

| Model ID | Provider | Type | Context / Capabilities |
| :--- | :--- | :--- | :--- |
| `claude-opus-4.6` | AWS Bedrock | Frontier LLM | Deep reasoning, large complex architectures |
| `claude-sonnet-4.6` | AWS Bedrock | Frontier LLM | Ultra-fast, state-of-the-art coding |
| `minimax-m2.5` | AWS Bedrock | Commercial LLM | High-speed code generation & logic |
| `@cf/qwen/qwen2.5-coder-32b-instruct` | Cloudflare Workers AI | Edge Native | SOTA open coding model, primary default |
| `@cf/qwen/qwen3.8-27b` | Cloudflare Workers AI | Edge Native | Next-gen Qwen reasoning |
| `@cf/zai-org/glm-5.3-flash` | Cloudflare Workers AI | Edge Native | Ultra-low latency code generation |
| `@cf/moonshotai/kimi-k2.7-code` | Cloudflare Workers AI | Edge Native | Specialized code assistant |
| `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | Cloudflare Workers AI | Edge Native | Meta 70B flagship instruct model |

### 6.2 Descending Token Ladder
To guarantee maximum completion capacity without encountering provider ceiling exceptions, Cloudflare AI executions step through a descending ladder:
```typescript
const TOKEN_LADDER = [65536, 32768, 16384, 8192];
```
Cloudflare defaults unconfigured calls to only 256 tokens; BrainHalf explicitly sets `max_tokens` and `max_completion_tokens` through this ladder to allow generating complete 500+ line applications in a single turn.

### 6.3 Pre-Save Syntax Validation Guard
In `src/agent.ts`, the `extractAndSaveFiles` method intercepts all generated code before updating the SQLite store:
- If a generated file has an unclosed `<file>` tag or markdown fallback, it is passed through `transform(code, { transforms: ['jsx', 'typescript'] })`.
- If the file is cut off mid-statement and throws a syntax error, **it is rejected and not saved to SQLite**. This prevents truncated responses from corrupting previously working code.

### 6.4 Variable Collision Prevention Mandate
The AI system prompts explicitly mandate:
- Never collide collection names with scalar counters (e.g. `coinEntities` array vs `coinsCollected` number).
- Never execute `array += 1` to prevent `TypeError: <variable> is not iterable` in game loops and list renderings.

---

## 7. WebSocket Protocol & Event Communication

### 7.1 Connection Endpoint
`wss://brainhalf.com/agents/chat-agent/:projectId`

### 7.2 Client-to-Agent Message Payloads
- **`prompt`**:
  ```json
  {
    "prompt": "Create a modern weather dashboard",
    "projectId": "proj-xyz",
    "model": "@cf/qwen/qwen2.5-coder-32b-instruct",
    "provider": "cloudflare",
    "workspaceFiles": { "/src/App.jsx": "..." }
  }
  ```
- **`sync_files`**: Synchronizes client-side file changes directly into the DO's SQLite database.
- **`stop`**: Triggers `AbortController.abort()` to halt generation immediately.
- **`clear`**: Clears the conversation history from SQLite (`DELETE FROM messages`).
- **`rewrite_history`**: Replaces conversation turns after message deletion or editing.

### 7.3 Agent-to-Client Message Payloads
- **`stream`**:
  ```json
  { "type": "stream", "chunk": { "response": "const [state...", "done": false } }
  ```
- **`file_updated`**:
  ```json
  { "type": "file_updated", "path": "/src/App.jsx", "content": "..." }
  ```
- **`history`**: Returns previous multi-turn conversation rows upon connection.
- **`tool_call`**: Broadcasts tool execution events (e.g. `write_file`).
- **`error`**: Reports generation or provider failures.

---

## 8. Frontend UI & State Management

### 8.1 Core Components
- **`src/App.tsx`**: Top-level application component managing layout state, active project resolution, and responsive panels.
- **`src/components/ChatPanel.tsx`**: AI chat panel with streaming token rendering, model selector dropdown, RAF-throttled token queues, image upload, and error auto-fix triggers.
- **`src/components/Workspace.tsx`**: Multi-panel workspace containing the Monaco code editor (`@monaco-editor/react`), file tree explorer, and dual preview container (`Sandpack` + Edge Preview `iframe`).
- **`src/components/TopNav.tsx`**: Header with inline project name editing, project sharing (`navigator.clipboard`), ZIP export (`jszip`), and deploy status modal.
- **`src/components/Sidebar.tsx`**: Project drawer listing recent projects, creation button, and deletion controls.

### 8.2 Event Bus (`src/lib/events.ts`)
A decoupled type-safe EventEmitter (`appEvents`) coordinates cross-component communication:
- `file-generated`: Emitted when the AI outputs or modifies a file.
- `preview-error`: Dispatched by the preview iframe when an uncaught error occurs.
- `auto-fix-error`: Triggers the AI to automatically diagnose and patch broken code.
- `project-renamed`: Synchronizes project name updates across TopNav and Sidebar.
- `request-export`: Triggers JSZip compilation of the active project.

---

## 9. Testing & Quality Assurance

The codebase includes an extensive Vitest suite with **61 passing tests**:
- `src/__tests__/events.test.ts`: Event emitter reliability, listener isolation, error containment.
- `src/__tests__/project-store.test.ts`: LocalStorage management, JSON corruption recovery, project CRUD operations.
- `src/__tests__/worker.test.ts`: Cloudflare Worker routing, preview URL dispatching, asset header overrides.
- `src/__tests__/message-parser.test.ts`: `<file>`, `<edit>`, `<search>`, `<replace>` extraction and diff patching.
- `src/__tests__/templates.test.ts`: Template integrity, starter files, fallback provisions.
- `src/__tests__/security.test.ts`: File path sanitization, directory traversal attack prevention.
- `src/__tests__/zip-export.test.ts`: Project ZIP generation and structure verification.
- `src/__tests__/ai-stream-edge-cases.test.ts`: Stream edge cases, malformed tags, partial chunks.
- `src/__tests__/utils.test.ts`: Path normalization and utility helpers.

---

## 10. Operations & Deployment Guide

### 10.1 Commands
```bash
# Development server
npm run dev

# Quality checks
npm run lint          # Oxlint (0 errors, 0 warnings)
npm test              # Vitest (61/61 passing)
npx tsc --noEmit      # TypeScript strict compiler check

# Production build & deploy
npm run build         # Vite client bundle -> dist/
npx wrangler deploy   # Cloudflare Workers & Durable Objects deploy
```

### 10.2 Secrets Configuration
```bash
npx wrangler secret put AWS_ACCESS_KEY_ID
npx wrangler secret put AWS_SECRET_ACCESS_KEY
npx wrangler secret put AWS_REGION
npx wrangler secret put BEDROCK_API_KEY
```

---

*This document represents the definitive architecture and state of BrainHalf as of September 2026.*
