# System Inventory: Routes & API Endpoints

This document enumerates every route, API endpoint, WebSocket connection path, and RPC interface in the BrainHalf platform.

## 1. Frontend & Client-Facing Routes

| Route Pattern | Method | Type | Description | Auth Required |
| :--- | :--- | :--- | :--- | :--- |
| `/` | `GET` | Static / SPA Root | Main BrainHalf IDE interface or login screen | Public (renders Login if unauthenticated) |
| `/index.html` | `GET` | Static / SPA | SPA root entry HTML | Public |
| `/?p=:projectId` | `GET` | SPA Query Param | Loads specific project by ID | Yes (session required to load project data) |
| `/preview/:projectId/*` | `GET`, `POST` | Preview Engine | Edge preview iframe rendering the generated React app | Yes (Project Owner Only) |
| `/p/:scriptName/*` | `GET`, `POST` | Worker Dispatch | Live user worker dispatch namespace with DO fallback | Yes (Project Owner Only) |
| `/assets/*` | `GET` | Static Assets | Bundled JS, CSS, fonts, and worker assets | Public (with strict shell CSP) |

---

## 2. Platform REST API Endpoints

| Endpoint | Method | Handler / Source | Description | Auth Enforced |
| :--- | :--- | :--- | :--- | :--- |
| `/api/auth/signup` | `POST` | `handleSignup` (`src/lib/auth.ts`) | User registration (PBKDF2 hashing, email uniqueness, session token) | Public |
| `/api/auth/login` | `POST` | `handleLogin` (`src/lib/auth.ts`) | User authentication (verifies PBKDF2 hash, issues HMAC session token) | Public |
| `/api/auth/logout` | `POST` | `handleLogout` (`src/lib/auth.ts`) | Terminates session, clears `bh_session` cookie | Public |
| `/api/auth/session` | `GET` | `handleSession` (`src/lib/auth.ts`) | Validates active session and returns user profile | Yes (cookie / Authorization header) |
| `/api/projects` | `GET` | `src/worker.ts` -> `AuthRegistry` DO | Lists all projects owned by the authenticated user | Yes |
| `/api/projects/:id` | `PATCH` | `src/worker.ts` -> `AuthRegistry` DO | Updates project metadata (e.g. project name) | Yes (Owner Only) |
| `/api/projects/:id` | `DELETE` | `src/worker.ts` -> `AuthRegistry` DO | Deletes project registration and metadata | Yes (Owner Only) |
| `/api/test/simple` | `POST` | `handleModelTest` (`src/lib/model-tester.ts`) | Benchmark endpoint for model evaluation (simple prompt tier) | Yes (Allowlist Enforced) |
| `/api/test/medium` | `POST` | `handleModelTest` (`src/lib/model-tester.ts`) | Benchmark endpoint for model evaluation (medium prompt tier) | Yes (Allowlist Enforced) |
| `/api/test/hard` | `POST` | `handleModelTest` (`src/lib/model-tester.ts`) | Benchmark endpoint for model evaluation (hard prompt tier) | Yes (Allowlist Enforced) |

---

## 3. WebSocket Realtime Protocols

| Path Pattern | Protocol | Handler | Authentication Gate | Description |
| :--- | :--- | :--- | :--- | :--- |
| `/agents/chat-agent/:projectId` | `WSS` | `ChatAgent` (`src/agent.ts`) via `routeAgentRequest` | `onBeforeConnect`: `verifySession` + `authorizeOrClaim` | Bi-directional generation stream, AST sync, and control commands |

### WebSocket Client-to-Agent Message Types:
- `prompt`: Submits generation request with prompt, target model, and workspace files.
- `sync_files`: Bulk-syncs client-side files into the DO's embedded SQLite database (`replace_all` supported).
- `get_files`: Fetches snapshot of workspace files from SQLite with pagination (`limit`, `offset`).
- `stop`: Aborts active generation stream and increments `WriteEpoch` to discard late writes.
- `clear`: Deletes message history from SQLite.
- `rewrite_history`: Atomically replaces conversation turns (with deduplication).

### WebSocket Agent-to-Client Message Types:
- `stream`: Real-time text token stream chunks.
- `file_updated`: Emitted when an individual file is parsed, syntax-validated, and saved to SQLite.
- `files_snapshot`: Paginated array of workspace files.
- `history`: Stored chat turns returned upon initial connection.
- `status`: Busy lock or generation state transitions.
- `error`: Structured error reporting with honest HTTP/error codes.

---

## 4. Generated App Simulated Backend API (`/api/*` inside Preview)

| Route Pattern | Handler | Purpose |
| :--- | :--- | :--- |
| `/api/*` (within preview) | `executeBackendRequest` (`src/lib/backend-runner.ts`) | Simulated in-memory REST backend for generated apps (CRUD, auth, pagination, relational tables) |
