# CURRENT_STATE.md — BrainHalf audit baseline

Snapshot taken at the start of the `fix/full-audit-and-hardening` run (2026-09-16),
after re-reading `worker.ts`, `agent.ts` (2433 lines), `lib/model-tester.ts`,
`lib/backend-runner.ts`, `lib/project-store.ts`, `lib/utils.ts`, `lib/message-parser.ts`,
`vite.config.ts`, `wrangler.toml`, `public/_headers` and `src/__tests__/security.test.ts`.

## What's already fixed (verified present)

- **Path traversal**: `lib/utils.ts` `normalizePath` strips null bytes + `\`, drops `.`/`..`; `isSafeFilePath` blocks zip-slip. Unit-tested in `src/__tests__/security.test.ts`.
- **Blocked secret files**: `agent.ts` `BLOCKED_FILE_PATTERNS` / `isBlockedSecretFile` refuses to serve `.env`, keys, credentials.
- **SQL wildcard escaping**: LIKE candidates are escaped before interpolation (unit-tested); `agent.ts` still uses **leading-wildcard** LIKE for path matching though.
- **Preview CORS/nosniff**: `agent.ts` preview responses already restrict `Access-Control-Allow-Origin` to same-origin/localhost with `Vary: Origin`, plus `frame-ancestors`, `nosniff`, `Referrer-Policy: no-referrer`.
- **Streaming edit protocol**: `<edit>` blocks with 5-strategy fuzzy matching (`lib/message-parser.ts`), brace auto-repair in `extractAndSaveFiles`.
- **Per-project isolation**: each project = its own ChatAgent Durable Object (own SQLite), so chat/files are not shared across projects server-side.

## What's still broken (verified, with line refs to the current tree)

### Phase 1 — Auth & tenancy
- **No auth at all.** WS connect (`/agents/chat-agent/:projectId`), `/api/sync`, `/api/files`,
  `/preview/:id`, `/p/:name` are all unauthenticated. Anyone who guesses a project id owns it.
- **No server-side ownership model.** Projects are purely client-side (`lib/project-store.ts`, localStorage + IndexedDB).
- **Module-global store shared across tenants**: `lib/backend-runner.ts:177` `export const globalPreviewStore = new InMemoryDataStore()` — one in-memory DB for *every* project's simulated backend on the edge preview.
- **Unsigned tokens**: `lib/backend-runner.ts:329/385` `'bh_token_' + btoa(...)` — forgeable (this is the *generated app's* simulated backend, still a bad pattern to ship).
- **Wildcard CORS**: `lib/model-tester.ts:219` `Access-Control-Allow-Origin: *`; `agent.ts:2428` same on the catch-all 200.

### Phase 2 — Cost abuse / DoS
- **No model allowlist**: `model-tester.ts:277` `env.AI.run(modelId, ...)` with arbitrary client `modelId`; `agent.ts:700-704` the `aws` path's `else` passes *unknown* model ids straight to `bedrock(...)` with `maxTokens = 64000`; `agent.ts:665-686` uses substring matching (`includes('sonnet')`) instead of exact map lookup.
- **No timeouts on outbound AI calls**: `model-tester.ts:396/423` `streamText` with no `abortSignal`; `env.AI.run` calls unbounded.
- **Client-supplied token limits trusted**: `agent.ts:729` `data.max_tokens || data.max_completion_tokens` → `maxOutputTokens`.
- **Masked 200s**: `model-tester.ts:460` returns failures with HTTP 200.

### Phase 3 — Injection & SSRF
- **`</script>` breakout / stored XSS**: `agent.ts:1662-1664` injects `JSON.stringify`'d import map **raw** into `<script type="importmap">`; package names are parsed out of LLM-generated code. `JSON.stringify` does not escape `/`.
- **Raw path into generated JS**: `agent.ts:2288` `'File: ${path}'` — URL-derived path interpolated into a single-quoted JS string; a `'` or backtick breaks out.
- **SSRF**: `agent.ts:841-853` `fetch_api` tool — `fetch(url)` with no private-IP block, no redirect cap, no size cap, no timeout.
- **Wildcard postMessage**: 5 `postMessage(..., '*')` in the preview harness.
- **No CSP on the app shell**: `public/_headers` has only cache + nosniff + referrer.

### Phase 4 — Concurrency & data integrity
- **Stopped generation resurrects itself**: aborting `streamText` makes `agent.ts:899-913` fall through to `runCloudflareWorkersAI`, which starts a *new* generation; and inside it, an abort still runs `extractAndSaveFiles` + `saveTurn`, persisting **partial files**.
- **No busy lock**: `currentAbortController` is per-DO-instance, so two tabs in one project race and interleave file writes.
- **Edit blocks don't chain**: `agent.ts:1320-1343` each `<edit path="X">` re-reads the **original** DB row; multiple edits to the same file → last block wins, earlier edits silently lost.
- **No transactions**: `extractAndSaveFiles` writes, `sync_files` `replace_all` (DELETE + inserts), `rewrite_history`, `clear` are all multi-statement with no atomicity.
- **No epoch guard**: a delayed `saveTurn` from a killed generation can resurrect cleared/rewritten history.
- **No idempotency key** on prompt submission.
- **Restore clobbers near-empty projects**: `agent.ts:358-381` treats `count <= 1` as "uninitialized" — and because `ensureSchema` seeds 3 default files first, `count` is 3, so an R2 backup of a real project is **never restored at all**. Shared `default` fallback backup key when `ctx.id` is missing.
- **Partial failure on `replace_all`** leaves the project half-applied.

### Phase 5 — Schema / reliability
- **No migration framework, no `schema_version` table**; `ensureSchema` is ad-hoc `CREATE TABLE IF NOT EXISTS` + `INSERT OR IGNORE`.
- **Leading-wildcard LIKE** at `agent.ts:1986-2006` and `2235-2238` — unindexable.
- **No pagination/size limits** on `get_files` / `files_snapshot`.
- **In-memory store bugs**: `backend-runner.ts:131-145` honours client-supplied ids and computes `autoIds` as `Number(id)+1` → `Number('abc')` is `NaN → 0 → 1`, colliding with existing rows; `backend-runner.ts:687-693` auto-seeds fake records.

## What changed since the last audit

- The earlier auth implementation (login/signup, `src/lib/auth.ts`, `src/registry.ts`, LoginScreen,
  REGISTRY DO binding) was **fully reverted on 2026-09-16** before ever being committed — no git
  history remains, so Phase 1 is rebuilt from scratch here.
- Edge preview (`/preview/:id`) is now the render engine; WebContainers are gone.
- `src/lib/backend-runner.ts` + `src/lib/templates/` are new and untracked (in-app simulated backend).
- Dispatch namespace (`/p/:name`) now has a ChatAgent fallback (`3002519`).
- Baseline WIP committed as `d1e8b3d` on this branch before audit work began.
