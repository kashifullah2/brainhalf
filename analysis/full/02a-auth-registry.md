# Phase 2A — AuthRegistry Deep Manual Review

## File: src/registry.ts (1006 lines)

Single Durable Object instance (`idFromName('auth')`) holding all identity, session, project-ownership, rate-limit, gallery, and AI-budget records.

---

## 1. Route-by-Route Analysis

### Internal-only (reached via Worker binding, never public HTTP)

| Route | Method | Auth at Worker | Auth inside Registry | What it trusts |
|---|---|---|---|---|
| `/ai/usage` | GET | None (DO binding) | None | — |
| `/ai/start`, `/ai/end`, `/ai/reserve` | POST | None (DO binding) | Validates body.id regex `^[A-Za-z0-9_-]{1,128}$` | body.id, body.lease, body.maxTokens |
| `/outcomes` | POST | None (DO binding) | Verifies `project_owners.user_id = event.ownerId` (:307) | event.projectId, event.ownerId |
| `/outcomes` | GET | None (DO binding) | None (returns all if no userId filter) | — |
| `/projects/deletions` | GET | None (DO binding) | None (trusts userId param) | userId query param |
| `/projects/quota` | GET | None (DO binding) | None (trusts userId param) | userId query param |
| `/projects/deletion-owner` | GET | None (DO binding) | None | projectId query param |
| `/admin/account` | GET | None (DO binding) | None | email query param |
| `/admin/managed-owner` | GET | None (DO binding) | None | ownerId query param |
| `/admin/users` | GET | Worker: session + PRODUCT_METRICS_OWNER_IDS allowlist (worker.ts:399-402) | None | — |
| `/admin/projects` | GET | Worker: session + allowlist (worker.ts:412-415) | None | — |
| `/admin/projects/:id` | DELETE | Worker: session + allowlist (worker.ts:423-426) | None (trusts caller) | projectId from path |
| `/admin/users/:id` | DELETE | Worker: session + allowlist (worker.ts:479-482) | None (trusts caller) | userId from path |
| `/auth/google` | POST | None (DO binding) | Validates subject+email format | body.subject, body.email |
| `/auth/signup` | POST | None (DO binding) | isValidEmail, isValidPassword | body.email, body.password |
| `/auth/login` | POST | None (DO binding) | isValidEmail, isValidPassword, verifyPassword | body.email, body.password |
| `/sessions` | POST | None (DO binding) | None (trusts caller) | body.tokenHash, body.userId, body.expiresAt |
| `/sessions/:hash` | GET | None (DO binding) | Checks expiry | tokenHash from path |
| `/sessions` | DELETE | None (DO binding) | None (trusts caller) | body.tokenHash |
| `/ws-tickets` | POST | None (DO binding) | Verifies sessionHash against sessions table (:602-603) | body.userId, body.sessionHash |
| `/ws-tickets/verify` | POST | None (DO binding) | Single-use delete + expiry + session back-check (:617-632) | body.ticket |
| `/rate-limit/check` | POST | None (DO binding) | Validates params | bucket, key, limit, windowMs |
| `/projects/claim` | POST | None (DO binding) | None (trusts userId) | body.projectId, body.userId, body.name |
| `/projects/access` | GET | None (DO binding) | None (trusts userId) | projectId, userId query params |
| `/projects/publication` | GET/PUT | None (DO binding) | Checks `user_id === userId` (:795) | projectId, userId query params |
| `/gallery` | GET | None | None | — (public read) |
| `/projects/showcase` | GET/PUT | None (DO binding) | Checks `user_id === userId` (:840) | projectId, userId query params |
| `/projects/showcase-status` | GET | None (DO binding) | None | projectId query param |
| `/projects/remix` | POST | None (DO binding) | Checks live count < MAX_PROJECTS_PER_USER (:873) | body.userId, body.sourceProjectId |
| `/projects/owner-check` | GET | None (DO binding) | Compares `user_id === userId` (:897) | projectId, userId query params |
| `/projects` | GET | None (DO binding) | None (trusts userId) | userId query param |
| `/projects/:id` | PATCH | None (DO binding) | Checks `user_id === body.userId` (:940) | projectId, body.userId |
| `/projects/:id` | DELETE | None (DO binding) | Checks `user_id === userId` (:958) | projectId, userId query param |
| `/email/*` | POST | None (DO binding) | Delegated to emailRegistry | — |
| `/oauth/store` | POST | None (DO binding) | Key format `^[A-Za-z0-9_-]{43}$` | body.key, body.kind, body.data |
| `/oauth/consume` | POST | None (DO binding) | Key format + expiry + delete-before-decide | body.key, body.kind |

**Key observation**: The registry trusts the userId it receives because the Worker has already verified the session. This is safe because the DO is only reachable via the Worker binding — Cloudflare enforces this at the platform level. [FACT, High confidence]

---

## 2. Creation Paths

### 2a. Project claim (`/projects/claim`, :658-771)

- **Quota enforcement**: Both `live >= MAX_PROJECTS_PER_USER` (50) and `total >= MAX_PROJECT_ROWS_PER_USER` (200) are checked at :735 and :740. [FACT]
- **Admin bypass**: Admin emails are looked up at :730-733 and bypass quota at :734. [FACT]
- **Race condition safety**: Uses `INSERT OR IGNORE` at :748, then re-reads at :755-757 to determine the actual owner. If two users race to claim the same project, only one INSERT wins and the re-read reveals the true owner; the loser gets 403. [FACT, High confidence]
- **Idempotency**: A `project_claim_idempotency` table (:162-169) prevents duplicate submissions from creating extra projects. 24hr TTL. [FACT]
- **Deleted-project reclaim protection**: Rows with `deleted_at IS NOT NULL` are kept (tombstoned). The claim checks `deleted_at != null` and returns 410 at :700. [FACT]

### 2b. Remix (`/projects/remix`, :866-883)

- **Quota**: Checks `live >= MAX_PROJECTS_PER_USER` at :873-874. [FACT]
- **Source validation**: Source must have `showcase = 1` and `deleted_at IS NULL` at :872. [FACT]

**FINDING R-1: Remix skips MAX_PROJECT_ROWS_PER_USER check**
Remix checks only `MAX_PROJECTS_PER_USER` (live count), NOT `MAX_PROJECT_ROWS_PER_USER` (total row count). A user who has deleted many projects can still create remixes past the total-row cap since the remix path only counts `deleted_at IS NULL` rows.
- Severity: **Low** — requires 200 project deletions + remixes to exploit; consequence is slightly exceeding the row cap.
- Confidence: **High**
- Label: **FACT** (registry.ts:873 vs :740)

### 2c. Signup (`/auth/signup`, :507-535)

- Validates email (isValidEmail) and password (isValidPassword). [FACT]
- Checks email uniqueness at :517. [FACT]
- No rate limit *inside* the registry, but the Worker applies auth rate limit (10/min per IP) at worker.ts:330-332. [FACT]

### 2d. Google OAuth (`/auth/google`, :487-503)

- If the Google subject is already linked, returns the existing user. [FACT]
- If email is already taken by a password account, returns `{ conflict: true }` (safe: no merge). [FACT]
- If new, creates user with password_hash `!google-only` (not a valid PBKDF2 hash, so password login fails). [FACT]

---

## 3. Deletion Paths

### 3a. User-initiated DELETE (`/projects/:id DELETE`, :951-988)

- **Tombstone**: Sets `deleted_at = timestamp` and `published = 0` at :967. Row is never removed. [FACT]
- **Ownership check**: Verifies `user_id !== userId → 403` at :958. [FACT]
- **Unclaimed-id protection**: `!rows.length → 404` at :962 prevents creating tombstones for never-claimed ids. [FACT, excellent defense — see comment at :959-961]
- **Async cleanup**: Enqueues to `project_cleanup` table, sets alarm, best-effort pilot slot release. [FACT]
- **Reclaim impossibility**: Since the row stays (only `deleted_at` changes), `/projects/claim` sees the row and returns 410 at :700 and :759. Another user cannot claim it. [FACT, High confidence]

### 3b. Admin hard delete (`/admin/projects/:id DELETE`, :396-431)

- **Order**: Runtime → Agent → Backups → (only if all succeed) → Remove row. [FACT]
- **Failure handling**: If any cleanup step fails, the row is kept and 500 returned (:418-420). The id remains owned. [FACT, good]
- **Transaction**: Row deletion, cleanup-queue purge, and idempotency purge in `transactionSync` at :422-429. [FACT]

### 3c. Admin user delete (`/admin/users/:id DELETE`, :436-464)

**FINDING R-2: Admin user delete swallows cleanup errors then removes rows**
Project cleanup errors during admin user delete are logged but swallowed (:445-447), and the project is still added to `deletedProjects` (:448). The final transaction *always* removes all project_owners rows and the user row (:451-463). If runtime/agent/backup cleanup fails for any project, the registry row is still deleted — leaving orphaned DO storage and R2 backups with no owner row to retry against.

Compare with admin *project* delete (:396-431) which correctly aborts when cleanup fails. The user delete path does not have this safeguard.
- Severity: **Medium** — operator must notice logged errors; no way to retry since rows are gone. Risk is orphaned storage, not data exposure. Only happens via manual operator action.
- Confidence: **High**
- Label: **FACT** (registry.ts:444-448 + 451-463)

---

## 4. Admin Routes — Erase Gate Cross-Check

### Registry side (admin hard delete):
```
registry.ts:79 → eraseAgent sends:
  POST https://agent/internal/erase
  headers: { 'x-auth-user-id': ownerId, 'x-bh-project': projectId }
```

### Agent side (`/internal/erase`):
```
agent.ts:2996-2999 → checks:
  1. projectId from x-bh-project matches self.name
  2. Calls registry /projects/deletion-owner?projectId=... to verify deleted_at IS NOT NULL
  3. Verifies deletion-owner.ownerId === getRequestUserId(request)
```

### Registry `/projects/deletion-owner` (registry.ts:326-328):
Returns ownerId only when `deleted_at IS NOT NULL`. Otherwise returns 404.

**FINDING R-3: Admin hard-delete fails for non-soft-deleted projects**
The admin hard-delete path (registry.ts:396-431) does NOT set `deleted_at` before calling `eraseAgent()`. The agent's erase handler (agent.ts:2998-2999) calls `/projects/deletion-owner` which returns the ownerId only when `deleted_at IS NOT NULL`. For a live project that hasn't been user-deleted, `/projects/deletion-owner` returns 404, and the agent returns 403 "Deletion has not been authorized."

This means admin hard-delete will always fail at the agent erase step for projects that haven't been soft-deleted first. The registry catches this at :414, reports it at :418-420, and keeps the row (returning 500). The operator would need to first soft-delete via user flow, then hard-delete — an unintuitive two-step process.

Note: The user-initiated DELETE flow correctly sets `deleted_at` at :967, so the async cleanup works. The admin user delete flow (:436-464) has the same issue but swallows the error (see R-2).
- Severity: **Medium** — Broken admin operation, not a security issue. Operator cannot fully clean up live projects without a workaround.
- Confidence: **High**
- Label: **FACT** (registry.ts:396-431 + agent.ts:2995-2999 + registry.ts:326-328)

---

## 5. Ownership Checks / IDOR

All ownership-sensitive registry routes receive userId from the Worker, which extracts it from a verified session token. The Worker:
1. Strips client-supplied `_uid` param (worker.ts:311-314)
2. Strips client-supplied `x-auth-user-id` header via `injectUserId` (auth.ts:445)
3. For PATCH/DELETE on projects, passes `user.userId` from verified session, not from request body (worker.ts:682-686 strips userId from body and replaces with verified one)

**No IDOR found.** The trust chain is sound: browser → session token → Worker verifies → injects userId → registry trusts Worker. [FACT, High confidence]

**Minor defense-in-depth note**: The Worker strips the `_uid` param at :311-314 and the `x-auth-user-id` header in `injectUserId`. Both are correct — a client cannot forge the Worker-injected identity.

---

## 6. Non-Atomic Multi-Step Operations

### 6a. User project deletion (registry.ts:951-988)
Three-phase: (1) tombstone + enqueue in transactionSync, (2) best-effort pilot release, (3) async cleanup via alarm.
- **Risk**: If pilot release fails (:977-986), the hosted-project slot stays occupied until the cleanup queue catches up. User might see a stale limit. Logged and retried.
- **Severity**: Low — user inconvenience, not data loss. [FACT]

### 6b. Admin hard delete (registry.ts:396-431)
Three network calls (runtime, agent, backups) then a local transaction.
- **Risk**: Partial failure leaves the row in place (fail-safe). See R-3 above for the `deleted_at` prerequisite issue.

### 6c. Admin user delete (registry.ts:436-464)
N project cleanups in a loop, then a single transaction deleting everything.
- **Risk**: See R-2 above — errors swallowed, then rows deleted regardless.

### 6d. Remix (worker.ts:586-638)
Three steps: (1) registry creates project row, (2) source agent exports files, (3) target agent imports files.
- **Risk**: If export or import fails, `cleanupRemixProject` deletes the newly created project (worker.ts:607-608). This is best-effort (`.catch(() => {})`), so a failed cleanup leaves an empty project counting against quota.
- **Severity**: Low — the user can manually delete the empty project. [INFERENCE, Med confidence]

---

## 7. Single-Instance Bottleneck

Every request class below funnels through `env.REGISTRY.idFromName('auth')`:

1. **All session verification** — every authenticated request does `verifySession` → registry
2. **All project operations** — claim, access, owner-check, delete, rename, publication, showcase
3. **Rate limiting** — auth, model tests, preview reads/writes
4. **Gallery listing** (mitigated by 30s in-memory cache)
5. **WS ticket issue/verify** — every WebSocket connection
6. **Outcomes recording/reading**

Not funneled through the singleton:
- **AI budget** — routed to separate `ai-budget:{userId}` DO instances (registry.ts:272). Good.

**FINDING R-4: All traffic serializes through a single Durable Object**
Every authenticated request does at least TWO round-trips to the singleton DO: one for session lookup and one for the operation. The sharded `getUserRegistry` function exists (auth.ts:150-154) but is **never called** — it's dead code. Confirmed by grep: only one result (the definition itself).

Under high load, this is a throughput bottleneck. Cloudflare Durable Objects serialize all requests to a single instance; there is no horizontal scaling.
- Severity: **Medium** — not a security issue but an availability/scalability risk. A burst of legitimate traffic (e.g., gallery going viral) serializes behind auth checks. The galleryCache mitigates one path but not the general bottleneck.
- Confidence: **High**
- Label: **FACT**

---

## 8. Rate Limiting

### What exists:
| Bucket | Limit | Window | Applied at | Notes |
|---|---|---|---|---|
| `auth` | 10 | 60s | Worker, POST auth routes (worker.ts:330-332) | Per IP (clientKey) |
| `modelTest` | 20 | 60s | Worker, /api/test/* (worker.ts:708) | Per userId |
| `previewRead` | 120 | 60s | Worker, preview/dispatch routes | Per IP:projectId |
| `previewWrite` | 30 | 60s | Worker, preview/dispatch mutations | Per IP:projectId |

### Rate limit implementation (registry.ts:231-264):
- Uses a `rate_limits` SQL table in the singleton DO. [FACT]
- Sweeps expired entries on each check (:234). [FACT]
- Window-based counting with atomic increment. [FACT]

### What's missing:

**FINDING R-5: No rate limit on project creation**
`/projects/claim` and `/projects/remix` have no rate limit. A verified user can create projects at network speed up to their quota (50 live / 200 total). While quotas cap total damage, the lack of rate limiting means a malicious user can fill their quota in seconds and generate significant load on the singleton DO.
- Severity: **Low** — quotas provide the hard cap; rate limiting would smooth the load curve.
- Confidence: **High**
- Label: **FACT**

**FINDING R-6: No rate limit on project deletion**
`DELETE /projects/:id` has no rate limit. A user can delete all 50 projects in rapid succession, each triggering an alarm + best-effort pilot release + cleanup enqueue. Combined with rapid re-creation (see R-5), this creates a create-delete-create cycle against the singleton DO.
- Severity: **Low** — each deletion is one row UPDATE + one alarm; the async cleanup self-throttles.
- Confidence: **High**
- Label: **FACT**

**FINDING R-7: No rate limit on session check / WS-ticket endpoints**
Every `verifySession` call and WS-ticket issuance hits the singleton DO. These are implicitly limited by requiring a valid session (you need to be logged in), but there's no per-user rate limit on how fast an authenticated user can make requests. A single account could in theory hammer the DO.
- Severity: **Low** — Cloudflare's infrastructure provides some implicit protection (request queuing, per-IP connection limits at the edge). The session verification is lightweight (single indexed SQL read).
- Confidence: **Med**
- Label: **INFERENCE**

---

## Summary of Findings

| ID | Finding | Severity | Confidence | Label |
|---|---|---|---|---|
| R-1 | Remix skips MAX_PROJECT_ROWS_PER_USER check | Low | High | FACT |
| R-2 | Admin user delete swallows cleanup errors then removes rows | Medium | High | FACT |
| R-3 | Admin hard-delete fails for non-soft-deleted projects (agent erase gate prerequisite) | Medium | High | FACT |
| R-4 | All traffic serializes through singleton DO; sharded getUserRegistry is dead code | Medium | High | FACT |
| R-5 | No rate limit on project creation paths | Low | High | FACT |
| R-6 | No rate limit on project deletion | Low | High | FACT |
| R-7 | No per-user rate limit on session checks | Low | Med | INFERENCE |

### Positive findings (things that are done well):
- Tombstone-based deletion prevents id reclaim by other users (:147-151, :700, :759)
- `INSERT OR IGNORE` + re-read pattern safely handles claim races (:748-761)
- Idempotency keys prevent duplicate project creation (:162-170, :669-691)
- Session tokens stored as hashes — DB leak cannot forge sessions (:22-26)
- WS tickets are single-use, short-lived, hash-stored (:43-46, :597-633)
- OAuth merging is conservative — conflict detection prevents unsafe account linking (:497)
- Worker strips user-supplied identity headers before forwarding (:311-314, auth.ts:445)
- Admin routes require session + explicit PRODUCT_METRICS_OWNER_IDS allowlist check
- Gallery cache mitigates hottest public read path (:64-65, :810-828)
- Unclaimed-id tombstone protection (:959-962)
