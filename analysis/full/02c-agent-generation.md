# Phase 2C — Agent & Generation Deep Manual Review

Files reviewed:
- `src/agent.ts` (3717 lines, targeted reads of security-critical sections)
- Generation libs reviewed via grep + targeted reads

Note: Parallel agent hit 429 rate limit; coordinator completed this review directly.

---

## 1. Authentication at Entry Points

### WebSocket (`onConnect`, lines 843-910)

- Reads userId from the injected `x-auth-user-id` header / `_uid` query param (set by Worker after session verification). If absent → close with 4401. [FACT]
- Special values `'QUOTA_EXCEEDED'` / `'FORBIDDEN'` are handled before the general null check. [FACT]
- Requires `sessionHash` (64-char hex) to be present in the URL query param. If missing/invalid → close with 4401. [FACT]
- Per-user connection limit: 5 concurrent sockets per user. Excess connections closed with 4429. [FACT]
- userId + sessionHash stored in `connection.state` for hibernation persistence. [FACT]

### HTTP (`onRequest`, line 2984-2991)

- Fail-closed at top: any request without an injected userId returns 401 immediately. [FACT]

---

## 2. Secret File Filtering

### Previously fixed critical issue (comment at lines 60-71)

A prior version of `/preview/:id/api/files` called `readAllProjectFiles()` but WITHOUT the secret filter, returning `/server/.env` (including JWT_SECRET and DATABASE_URL) in plaintext. This was fixed by moving `isBlockedSecretFile` inside `readAllProjectFiles()` → `collectProjectFiles(includeSecrets=false)` so every call site inherits the filter. [FACT — now fixed]

### Current state

`readAllProjectFiles()` always calls `collectProjectFiles(false)` (line 568) which skips paths where `isBlockedSecretFile(path)` returns true (line 521). All routes that return file contents to callers — preview, remix-export, admin-files, sync — use this method. [FACT]

### Finding A-1: Admin file inspection endpoint also filters secret files (informational)

**Severity**: Info | **Confidence**: High | **Label**: FACT  
**File**: `src/agent.ts:3047-3050`

`/internal/admin-files` calls `readAllProjectFiles()` which applies `isBlockedSecretFile` filtering. Operators cannot inspect `.env` files or private keys via this endpoint. This is likely intentional (operators see code but not credentials), but worth documenting — if an operator needs to verify credential configuration they must use the project runtime's integration settings, not this endpoint.

---

## 3. Internal Route Authorization

### `/internal/erase` (lines 2995-3011) — Deletion gate

1. Verifies `x-bh-project` header matches `this.name` (the DO's own project ID) — prevents scope escape
2. Back-checks registry via `/projects/deletion-owner?projectId=...` — only succeeds when `deleted_at IS NOT NULL`
3. Verifies the injected userId equals the returned `ownerId`

**Assessment**: Three independent checks. Cannot erase a live project (registry returns 404 for `deleted_at IS NULL`). Cannot erase a different project (header check). Cannot impersonate another owner (Worker injects userId from verified session). [FACT]

### `/internal/remix-export` (lines 3025-3035)

- Verifies `showcase=1` in registry before exporting files
- Uses `readAllProjectFiles()` (with secret filter) and `contextFileAllowed` (excludes node_modules etc.)
- Strips harness entries — the preview scaffolding cannot be copied to a remix

### `/internal/remix-import` (lines 3052-3074)

- Verifies `isProjectOwner` against registry — destination project must be owned by the requester
- Input validated: files must be `Record<string, string>`
- Only paths passing `contextFileAllowed` + not harness entries are written
- `normalizePath` applied before writes

### `/internal/admin-files` (lines 3040-3051)

- Re-verifies operator allowlist (`PRODUCT_METRICS_OWNER_IDS`) in the agent — defense-in-depth against Worker check
- Verifies `x-bh-project` header matches `this.name`

---

## 4. Model Access Control

### Allowlist enforcement (line 1584-1588)

```ts
const resolved = resolveModel(requestedModel, data.provider);
if (!resolved) {
  sendError(`Model "${requestedModel}" is not in the model allowlist`);
  return;
}
```

Exact match only. Comment explicitly documents: "No substring dispatch ('includes sonnet') and no default substitution for an unknown id." [FACT]

### Finding A-2: Per-isolate generation rate limiter is not a global quota

**Severity**: Low | **Confidence**: High | **Label**: FACT  
**File**: `src/agent.ts:265-269`

```ts
const GENERATION_LIMITER = new RateLimiter({
  generation: { limit: 30, windowMs: 60_000 },
  ...
});
```

The comment explicitly notes: "per-isolate and therefore an upper bound, not a global quota." A user connecting to many different projects, or connecting from a fresh DO instance (after eviction), gets a fresh rate limit window. The `AiBudget` (billing quota) provides the hard global cap; this limiter is a soft per-session guard. A user who re-opens the workspace multiple times could issue more than 30 generations per minute globally.

---

## 5. URL Fetch / SSRF

Generation tool uses `safeFetchText(url)` (line 1844) which routes through `src/lib/ssrf.ts`. Shape-check only (no DNS resolution) — see L-6 in consolidated findings.

---

## 6. Prompt Size Limit

`MAX_PROMPT_CHARS = 32_000` (line 238). Checked at line 1285 before generation:

```ts
if (actualPrompt.length > MAX_PROMPT_CHARS) {
  // returns error to client
}
```

Prevents unbounded inference cost from oversized prompts. [FACT]

---

## 7. File Write Limits

- `MAX_FILE_BYTES = 2 MB` per file (line 230)
- `MAX_FILES_PER_SYNC = 500` (line 241)
- `MAX_STORED_MESSAGES = 1,000` chat turns (line 244)
- `MAX_SNAPSHOT_BYTES = 8 MB` per snapshot page (line 227)

These prevent storage exhaustion via individual writes. [FACT]

---

## 8. CORS in Agent (lines 3080-3097)

```ts
const sameOrigin = origin != null && origin === url.origin;
const isDevOrigin = origin != null && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
const allow = sameOrigin || isDevOrigin ? (origin as string) : url.origin;
```

Reflects origin only for same-origin or localhost dev origins. Not `*`. Prior bug fix noted (POST was missing from `Allow-Methods`). [FACT]

---

## 9. Hibernation State (Finding A-3)

**Severity**: Low | **Confidence**: High | **Label**: FACT  
**File**: `src/agent.ts:866-876`

```ts
this.connectionUserIds.set(connection.id, userId);
try { connection.setState({ userId, sessionHash }); } catch { /* ... */ }
```

When the DO is evicted and revived (hibernation), `connectionUserIds` (in-memory Map) is empty but `connection.state` survives. On message receipt, the agent reads userId from state as fallback:

```ts
const state = connection.state as { userId?: string; sessionHash?: string } | null;
const userId = state?.userId || uri?.searchParams.get(USER_ID_QUERY_PARAM);
```

Then at lines 1018-1024 it re-validates: checks registry for session liveness + `isProjectOwner`. So session revocation is enforced on the first message after hibernation revival. [FACT — positive design]

However: the `try { connection.setState(...) } catch {}` silently ignores failures. If `setState` fails (e.g., during hibernation cold-start), the connection proceeds without persisted state. After hibernation, the fallback to `USER_ID_QUERY_PARAM` from the URL relies on the original upgrade URL remaining accurate — which it does since the URL is immutable per connection.

---

## Summary Table

| ID | Severity | Confidence | Label | Description |
|----|----------|-----------|-------|-------------|
| A-1 | Info | High | FACT | Admin file endpoint filters secrets (intentional, document for operators) |
| A-2 | Low | High | FACT | Generation rate limiter is per-isolate, not global |
| A-3 | Low | High | FACT | `connection.setState` failure silently ignored; fallback URL param handles it |
| — | Fixed | High | FACT | Previously: /preview/:id/api/files leaked /server/.env — now fixed by readAllProjectFiles() filtering |

**Positive findings**: Fail-closed authentication at every entry point, exact model allowlist enforcement, per-connection secret file filtering applied universally, three-layer erase authorization, showcase-gated remix export, CORS reflecting only allowlisted origins, prompt size limit, file write size limits.
