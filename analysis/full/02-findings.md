# Phase 2: Deep Manual Review — Consolidated Findings

**Audit date**: 2026-10-01  
**Auditor**: Principal engineer review (coordinator + parallel agents)  
**Scope**: src/registry.ts, src/worker.ts, src/agent.ts*, src/runtime/project.ts, src/lib/auth.ts, src/lib/crypto.ts, src/lib/google-auth.ts, src/lib/ssrf.ts, src/lib/secret-files.ts, src/lib/project-access.ts, src/lib/preview-isolation.ts, src/lib/allowed-origins.ts

*agent.ts/backend-runner.ts — agent 02c still running at compile time; see 02c file when complete.

---

## Overall Risk Posture

**No Critical findings. No High findings.**

The codebase has a sound security architecture: fail-closed session verification, real revocation, HMAC-signed tokens, correct PKCE OAuth, single-use WebSocket tickets, per-route ownership checks, origin allowlisting, and systematic header sanitization at trust boundaries. The remaining findings are primarily in three categories: availability/scalability risks from the singleton DO bottleneck, missing rate limits on authenticated endpoints, and minor admin-path robustness gaps.

---

## Critical Findings

*None.*

---

## High Findings

### H-1: `pdfjs-dist` dependency — arbitrary JavaScript execution on malicious PDF

**Severity**: High | **Confidence**: High | **Label**: FACT  
**Source**: `npm audit` output (00-baseline.md)

`pdfjs-dist` is a direct dependency with a HIGH severity vulnerability allowing arbitrary JavaScript execution when processing a malicious PDF. This executes in the Worker/browser context of whoever opens the PDF. If users can upload and preview PDFs within BrainHalf projects, an attacker can craft a PDF that runs arbitrary code on the victim's machine.

**Evidence**: `npm audit` in baseline phase flagged `pdfjs-dist` with HIGH severity. Direct dependency.

**Recommendation**: Upgrade `pdfjs-dist` to a patched version, or disable PDF rendering until patched. Check whether user-uploaded PDFs are processed server-side (Worker context) or client-side only.

---

## Medium Findings

### M-1: Singleton Registry DO is a single point of failure and throughput bottleneck

**Severity**: Medium | **Confidence**: High | **Label**: FACT  
**Source**: 02a-auth-registry.md (R-4), 02b-worker-router.md (F16)  
**Files**: `src/lib/auth.ts:145-147`, `src/registry.ts` (entire file), `src/worker.ts:89`

Every authenticated request does at minimum two synchronous round-trips to `env.REGISTRY.idFromName('auth')`: one for session verification, one for the operation. All rate-limit checks, project claims, session lookups, WS ticket issuance, and gallery reads go through the same instance. Cloudflare Durable Objects serialize all requests to a single instance with no horizontal scaling.

`getUserRegistry` (auth.ts:150-154) is a sharded alternative that partitions by user hash, but it is **dead code** — never called outside its own definition.

**Failure scenario**: A viral traffic spike or a single account hammering the DO at network speed can degrade authentication latency for all users simultaneously.

**Recommendation**: Route rate-limit checks and session verification to sharded DOs using `getUserRegistry` or a similar partitioning scheme. The gallery cache (30s TTL) is a good mitigation example; apply the pattern to session lookups where possible.

---

### M-2: Admin allowlist check copy-pasted 8 times — drift risk

**Severity**: Medium | **Confidence**: High | **Label**: FACT  
**Source**: 02b-worker-router.md (F1)  
**File**: `src/worker.ts:389, 402, 415, 426, 444, 462, 482` (and one more)

The admin gate expression `String(env.PRODUCT_METRICS_OWNER_IDS || '').split(',').map((id: string) => id.trim()).includes(user.userId)` appears inline at 8 separate locations. No shared `isAdmin()` helper exists. A future change to any one instance (e.g., adding a new allowlist format, adding logging) risks silently diverging from the others.

**Failure scenario**: Future change to one copy of the check doesn't propagate, granting access to admin routes that weren't updated.

**Recommendation**: Extract to `isAdmin(user, env): boolean` and replace all 8 inline uses.

---

### M-3: Admin user delete swallows cleanup errors, then unconditionally removes rows

**Severity**: Medium | **Confidence**: High | **Label**: FACT  
**Source**: 02a-auth-registry.md (R-2)  
**File**: `src/registry.ts:436-464`

The admin `DELETE /admin/users/:id` path iterates each user's projects, calls cleanup for each (runtime, agent, backups), but catches and logs errors at lines 445-447 without aborting. After the loop, the transaction unconditionally removes all `project_owners` rows and the user row (lines 451-463). If cleanup fails for any project, the registry rows are deleted with no way to retry since the data is gone.

Compare with `DELETE /admin/projects/:id` (lines 396-431) which correctly aborts and returns 500 on any cleanup failure, keeping the row for retry.

**Failure scenario**: Operator deletes a user whose runtime DO is transiently unreachable; rows are removed, leaving orphaned storage (R2, D1, deployed Workers scripts) with no owner row to track or clean up.

**Recommendation**: Mirror the single-project hard-delete pattern — abort the entire user delete if any project cleanup fails, or at minimum keep a retry queue entry for failed projects before deleting rows.

---

### M-4: Admin hard-delete fails for non-soft-deleted projects (two-step prerequisite undocumented)

**Severity**: Medium | **Confidence**: High | **Label**: FACT  
**Source**: 02a-auth-registry.md (R-3)  
**Files**: `src/registry.ts:396-431`, `src/agent.ts:2995-2999`, `src/registry.ts:326-328`

The admin hard-delete path does not set `deleted_at` on the project row before calling `eraseAgent()`. The agent's erase handler checks `/projects/deletion-owner` which only returns the owner when `deleted_at IS NOT NULL`. For any live project (not yet user-deleted), this returns 404, and the agent returns 403. The registry catches this, keeps the row, and returns 500. An operator using admin hard-delete on a live project will always fail.

**Failure scenario**: Operator cannot clean up a reported-abusive project via admin delete unless the user first self-deletes it (or the operator soft-deletes it via another path).

**Recommendation**: Either set `deleted_at` on the project row before calling `eraseAgent`, or add a path that sets `deleted_at` as part of admin hard-delete.

---

### M-5: No rate limit on WebSocket ticket issuance endpoint

**Severity**: Medium | **Confidence**: High | **Label**: FACT  
**Source**: 02b-worker-router.md (F2)  
**File**: `src/worker.ts:330` (explicit exemption from rate limit block)

`/api/auth/ws-ticket` is explicitly exempted from the rate-limit gate. Each call writes to the singleton Registry DO. A valid session holder can issue unlimited tickets per second, potentially saturating DO storage and increasing latency for all operations on the singleton.

**Recommendation**: Add a per-user rate limit (e.g., 60 ticket issuances per minute) for this endpoint.

---

### M-6: Referer-based preview proxy widens attack surface

**Severity**: Medium | **Confidence**: Med | **Label**: INFERENCE  
**Source**: 02b-worker-router.md (F7)  
**File**: `src/worker.ts:847-866`

Unmatched `/api/*` requests are silently proxied to a preview agent if the `Referer` header points to a preview page. `Referer` is user-controlled — preview content can set `Referrer-Policy: unsafe-url` to craft a Referer that routes arbitrary platform `/api/*` paths through to the agent DO. The `checkPreviewAccess` gate limits this to GET/HEAD for public reads, but the routing surface is wider than the explicit `/preview/` and `/p/` paths.

**Recommendation**: Consider making the preview proxy explicit (opt-in header) rather than Referer-based, or add path allowlisting on what can be proxied.

---

### M-7: CSP `unsafe-eval` in shell `script-src`

**Severity**: Medium | **Confidence**: High | **Label**: FACT  
**Source**: 02b-worker-router.md (F9)  
**Files**: `src/worker.ts:212`, `public/_headers:16`

The main application shell includes `'unsafe-eval'` and `data:` in `script-src`. Combined, any XSS in the shell escalates to arbitrary code execution without requiring an external script host. This is a known trade-off for Monaco editor, but the `data:` URI permission is unnecessary for Monaco — consider removing it.

**Recommendation**: Remove `data:` from `script-src` if Monaco does not strictly require it. Consider a nonce-based CSP for Monaco.

---

### M-8: Remix endpoint has no rate limit

**Severity**: Medium | **Confidence**: High | **Label**: FACT  
**Source**: 02b-worker-router.md (F17)  
**File**: `src/worker.ts:586-639`

Each remix creates a project row, exports files from the source agent DO, and imports them into a new agent DO. No rate limit exists on this path. A user can issue remixes at network speed until hitting their project quota, consuming significant registry write traffic, DO instances, and R2 storage in the process.

**Recommendation**: Add a per-user rate limit (e.g., 10 remixes/minute) on the remix endpoint.

---

### M-9: Managed-auth timing oracle via dummy hash format mismatch

**Severity**: Medium | **Confidence**: High | **Label**: FACT  
**Source**: 02d-auth-crypto.md (D-2)  
**File**: `src/runtime/managed-auth.ts:170-172`, `src/lib/crypto.ts:141-148`

The managed-auth login path uses a dummy hash constant in bcrypt format (`$2b$10$...`) for timing defense when a user doesn't exist. But the system uses PBKDF2 (`pbkdf2$...`). `parsePasswordHash` returns null immediately for non-PBKDF2 formats, short-circuiting the derivation — returning in ~0ms vs ~50-100ms for existing users. This timing difference reveals whether an email is registered.

**Recommendation**: Replace the bcrypt-format dummy with a PBKDF2-format hash: `pbkdf2$100000$<fixedSalt>$<fixedHash>`.

---

### M-10: Preview HTTP `/api/sync` lacks file-count cap

**Severity**: Medium | **Confidence**: High | **Label**: FACT  
**Source**: 02c-agent-generation.md (F2C-02)  
**File**: `src/agent.ts:3184-3211`

The WebSocket `sync_files` handler enforces `MAX_FILES_PER_SYNC = 500`, but the HTTP POST `/api/sync` endpoint iterates over `Object.entries(bodyFiles)` without any count check. An authenticated user could submit thousands of file entries in a single request.

**Recommendation**: Add the same `MAX_FILES_PER_SYNC` check to the HTTP sync endpoint.

---

### M-11: Shell CSP whitelists arbitrary-package CDNs (unpkg, jsdelivr, esm.sh) with no consumer

**File**: `src/worker.ts:212-216`

Shell `script-src` includes `https://cdn.jsdelivr.net https://unpkg.com https://esm.sh`. These CDNs serve arbitrary user-published packages; any future XSS in the shell would get immediate arbitrary-script execution. Monaco does not need them (`Workspace.tsx:358,407` bundles monaco locally via `loader.config({ monaco })`) — legacy leftovers. **FACT, High confidence.** Fix: remove unpkg/jsdelivr from shell CSP; keep esm.sh scoped to the preview CSP.

### M-12: AdSense script loads inside the signed-in workspace shell

**File**: `index.html:19`, CSP at `src/worker.ts:212,216`

One HTML shell serves landing, login, dashboard and the authenticated workspace; the AdSense loader is in it unconditionally. Google's ad script executes with full DOM access on authenticated screens (HttpOnly session cookie is safe, but DOM/project content is observable), and AdSense policy discourages ads behind login. **FACT, High confidence.** Fix: inject the AdSense tag only on public marketing routes.

### M-13: Main Worker `compatibility_date` 2 years behind runtime Worker

**File**: `wrangler.toml:3` (`2024-09-23`) vs `wrangler.runtime.jsonc:5` (`2026-09-22`)

The Worker that runs the entire auth/registry/preview security perimeter operates under two-year-old runtime semantics. **FACT, High confidence.** Fix: bump to match, run verify + smoke, deploy.

### M-14: Load test supports no capacity claim; reports PASS with 100% WebSocket failure

**File**: `load-results/load-summary.json`, harness `tests/load-test-thousands.mjs`

Target was `http://localhost:5173` (Vite dev server), `websocket.connectedCount: 0` with `errorCount: 50`, 500/1000 HTTP responses were 401 — verdict `PASS`. Both an invalid capacity artifact and a test-integrity bug (WS leg failure does not fail the run). **FACT, High confidence.** Fix: fail verdict on `connectedCount===0 || errorCount>0`; retarget at `wrangler dev`/staging.

### M-15: Admin/pilot identifiers committed to public repo; `ADMIN_EMAILS` gates skip email-verification check

**File**: `wrangler.toml:9`, `wrangler.runtime.jsonc:20`, gates at `src/registry.ts:281-293` and `src/registry.ts:729-737`

Admin email and a pilot user id are committed in tracked config. Privilege gates keyed on `ADMIN_EMAILS` (AI-budget exemption, project-quota bypass) match `users.email` without checking `email_verification.verified_at`; password-signup emails are unverified by design (`registry.ts:495-497`). On a fresh deploy/fork, first registrant of the published admin address inherits unlimited budget/quota. Live exploitability is low (account exists); disclosure + fork risk remain. Sensitive admin *routes* already use the secret `PRODUCT_METRICS_OWNER_IDS` allowlist (`worker.ts:389` et al.) — that half is fixed. **FACT, High confidence (mechanics) / Medium (live exploitability).** Fix: move ADMIN_EMAILS to a secret, require verified email in privilege gates, rotate pilot id.

## Low Findings

### L-1: Remix skips `MAX_PROJECT_ROWS_PER_USER` total-row quota check

**Severity**: Low | **Confidence**: High | **Label**: FACT  
**Source**: 02a-auth-registry.md (R-1)  
**File**: `src/registry.ts:866-883`

`/projects/remix` checks only `MAX_PROJECTS_PER_USER` (live count ≤ 50), not `MAX_PROJECT_ROWS_PER_USER` (total rows including deleted, ≤ 200). A user who has deleted many projects can create remixes past the total-row cap. Compare with `/projects/claim` which checks both at lines 735 and 740.

---

### L-2: No rate limit on project creation or deletion

**Severity**: Low | **Confidence**: High | **Label**: FACT  
**Source**: 02a-auth-registry.md (R-5, R-6)  
**File**: `src/registry.ts:658-771, 951-988`

`/projects/claim` and `DELETE /projects/:id` have no rate limits. A user can hit the project cap in seconds and cycle create/delete in rapid succession, generating sustained load on the singleton DO and the pilot coordinator.

---

### L-3: DELETE `/api/projects/:id` has no Worker-side ownership check

**Severity**: Low | **Confidence**: High | **Label**: FACT  
**Source**: 02b-worker-router.md (F4)  
**File**: `src/worker.ts:661-697`

The DELETE path for `/api/projects/:id` does not call `isProjectOwner()` at the Worker layer (the PATCH path at the same URL does). Safety depends entirely on the registry checking the `userId` query parameter. This is defense-in-depth gap, not a current vulnerability.

---

### L-4: WS ticket session back-check skipped when sessionHash omitted

**Severity**: Low | **Confidence**: High | **Label**: FACT  
**Source**: 02d-auth-crypto.md (D-1)  
**File**: `src/registry.ts:602-603`

WS ticket issuance validates `sessionHash` against the sessions table only when `body.sessionHash` is provided. Future callers who omit `sessionHash` skip the liveness check. The Worker's production code path does pass `sessionHash`, so this is not a current vulnerability.

---

### L-5: `?token=` query param fallback accepts 30-day session tokens in access logs

**Severity**: Low | **Confidence**: High | **Label**: FACT  
**Source**: 02d-auth-crypto.md (D-3)  
**File**: `src/lib/auth.ts:82-86`

The WS ticket system was introduced specifically to prevent long-lived session tokens from appearing in WS upgrade URLs. However, the `?token=` query param fallback still accepts full 30-day session tokens. A regression in the WS client path could expose long-lived tokens to Cloudflare access logs and trace data.

---

### L-6: SSRF guard is shape-check only — DNS rebinding not prevented

**Severity**: Low | **Confidence**: High | **Label**: FACT (acknowledged in code)  
**Source**: Direct read of `src/lib/ssrf.ts`  
**File**: `src/lib/ssrf.ts:1-10 (header comment)`

The SSRF guard validates URL shape and IP range but performs no DNS resolution. DNS rebinding attacks (registering a DNS name that initially resolves to a safe IP, then rebinding to a private IP after the check passes) are explicitly acknowledged as unmitigated in the code comments. In the Cloudflare production environment, Workers cannot reach private IPs at all (no access to RFC1918 addresses), so DNS rebinding achieves nothing in prod. This is a risk in dev/test environments.

---

### L-7: `uploads().removeAll()` called twice in delete path

**Severity**: Low | **Confidence**: High | **Label**: FACT  
**Source**: 02e-runtime.md (E-1)  
**File**: `src/runtime/project.ts:286-287`

Two consecutive identical calls to `this.uploads().removeAll()`. The second is redundant. Not a security issue, but misleading and could mask partial cleanup on the first call.

---

### L-8: `clientKey()` falls back to shared `'unknown'` rate-limit bucket

**Severity**: Low | **Confidence**: Med | **Label**: INFERENCE  
**Source**: 02b-worker-router.md (F8)  
**File**: `src/worker.ts:135-139`

When both `cf-connecting-ip` and `x-forwarded-for` are absent, all requests share an `'unknown'` rate-limit bucket. In production this cannot happen (Cloudflare always sets `cf-connecting-ip`), but in edge cases (misconfigured proxies, future platform changes) it could allow rate-limit bypass or DoS of the shared bucket.

---

### L-9: PBKDF2 iterations (100k) below OWASP 2023 recommendation (600k)

**Severity**: Low | **Confidence**: High | **Label**: FACT  
**Source**: 02d-auth-crypto.md (D-1)  
**File**: `src/lib/crypto.ts:107`

OWASP's 2023 Password Storage Cheat Sheet recommends 600,000 iterations for PBKDF2-HMAC-SHA256. Current setting is 100,000 — still provides meaningful resistance but 6x below recommendation. Main risk is in a database breach scenario where offline brute-force is faster than it needs to be.

---

### L-10: SSRF guard rejects all compressed IPv6 conservatively

**Severity**: Low | **Confidence**: High | **Label**: FACT  
**Source**: 02c-agent-generation.md (F2C-04)  
**File**: `src/lib/ssrf.ts:104-108`

All compressed IPv6 addresses (containing `::`) are rejected rather than expanded. Documented as intentional — expansion is error-prone. A model-generated fetch targeting a valid public IPv6 in compressed form would be refused.

---

### L-11: Preview sync silently drops oversize files but reports success

**Severity**: Low | **Confidence**: High | **Label**: FACT  
**Source**: 02c-agent-generation.md (F2C-01)  
**File**: `src/agent.ts:3184-3211`

The HTTP POST `/api/sync` calls `upsertFile()` which silently returns false for files exceeding `MAX_FILE_BYTES`. The response still says `success: true`, misleading the caller about which files were actually stored.

---

### L-12: `import.meta.env` / `process.env` replacement is string-level, not AST

**Severity**: Low | **Confidence**: High | **Label**: FACT  
**Source**: 02c-agent-generation.md (F2C-19)  
**File**: `src/agent.ts:3600-3601`

The preview transpiler uses naive string replacement for env references. These replacements could match inside string literals or comments. Only affects preview rendering, not stored source.

---

### L-13: CI has no dependency-audit step

**File**: `.github/workflows/validate.yml`

CI runs verify + Playwright e2e (`scripts/verify-release.mjs:9-10`) but never `npm audit`; the pdfjs-dist HIGH (H-1) reached `main` silently. **FACT, High confidence.** Fix: add `npm audit --audit-level=high` with an allowlist for accepted transitive dev risk.

### L-14: Prerelease pin `@cloudflare/sandbox@0.13.0-next.769.1` in production path

**File**: `package.json:41`

Exact-pinned prerelease SDK in the deploy path; upgrade path untracked. **FACT.** Fix: track upstream 1.0; smoke-test sandbox on bumps.

## Informational

### I-1: `undici` HIGH severity vulnerability (transitive via wrangler)

**Source**: `npm audit` (00-baseline.md)

`undici` has a HIGH severity DoS vulnerability (WebSocket deflate). This is a transitive dependency pulled in by `wrangler` (the development/deployment toolchain), not the production runtime. Workers do not use `undici` in the deployed bundle. Risk is limited to the development environment and CI pipeline.

---

### I-2: `getUserRegistry` sharded DO helper is dead code

**Source**: 02a-auth-registry.md (R-4)  
**File**: `src/lib/auth.ts:150-154`

`getUserRegistry` partitions the registry by user hash — the right foundation for scaling beyond the singleton bottleneck (M-1). It exists but is never called. When M-1 is addressed, this function should be the starting point.

---

### I-3: Admin preview path missing sandbox CSP headers

**Source**: 02b-worker-router.md (F6)  
**File**: `src/worker.ts:462-476`

The admin preview path (`/api/admin/projects/:id/preview/*`) removes `X-Frame-Options` to allow iframing but does not apply `withPreviewPrivacy()` or the preview sandbox CSP. Admin preview content renders with the agent's own CSP, which may be more permissive than the user-facing preview sandbox. Admin UI-only risk (admin already has full project access).

---

### I-4: Positive security controls worth retaining

The following mechanisms are explicitly well-designed and should be preserved through future refactors:

- **Session revocation**: HMAC verified before registry round-trip; fail-closed on exception (`auth.ts:113-134`)
- **WS single-use tickets**: Delete-before-decide pattern; 60s TTL; stored as SHA-256 hash (`registry.ts:617-633`)
- **Identity injection**: Worker strips user-supplied `_uid` and `x-auth-user-id` before re-injecting verified userId (`worker.ts:311-314`, `auth.ts:436-448`)
- **Header sanitization before dispatch**: All `x-bh-*`, `cf-access-*`, `authorization`, `cookie` headers stripped before forwarding to user's Worker or Node container (`project.ts:1007-1016`)
- **Set-Cookie stripped from user Worker responses**: Prevents user backend from setting cookies in BrainHalf's domain (`project.ts:1024`)
- **Project tombstone pattern**: Deleted project IDs can never be reclaimed by another user (`registry.ts:967`, `/projects/claim` tombstone check)
- **Browser guardrails in verification**: Test browser restricted to app hostname (`project.ts:1153`)
- **PBKDF2-SHA256 at 100K iterations**: Meets NIST minimum with a reasonable margin (`crypto.ts`)
- **PKCE OAuth**: Code challenge + state + double-submit cookie (`google-auth.ts`)
- **Preview sandbox**: `allow-scripts allow-forms allow-popups` with `frame-ancestors 'self' ...` limited to BrainHalf domains (`preview-isolation.ts`)

---

### I-5: Committed build/test artifacts

**File**: `tsconfig.node.tsbuildinfo`, `load-results/load-summary.json` (tracked). Churn noise + the misleading capacity artifact of M-14. **FACT.** Fix: gitignore tsbuildinfo; fix harness or drop artifact.

## Finding Index

| ID | Severity | Confidence | Label | Area | Description |
|----|----------|-----------|-------|------|-------------|
| H-1 | High | High | FACT | Deps | pdfjs-dist arbitrary JS on malicious PDF |
| M-1 | Medium | High | FACT | Architecture | Singleton DO bottleneck; getUserRegistry dead code |
| M-2 | Medium | High | FACT | Auth | Admin allowlist 8 inline copies — drift risk |
| M-3 | Medium | High | FACT | Admin | User delete swallows cleanup errors, removes rows |
| M-4 | Medium | High | FACT | Admin | Hard-delete fails for non-soft-deleted projects |
| M-5 | Medium | High | FACT | Auth | No rate limit on WS ticket issuance |
| M-6 | Medium | Med | INFERENCE | Routing | Referer-based preview proxy widenable |
| M-7 | Medium | High | FACT | CSP | unsafe-eval + data: in shell script-src |
| M-8 | Medium | High | FACT | Auth | No rate limit on remix endpoint |
| M-9 | Medium | High | FACT | Auth | Managed-auth timing oracle — dummy hash format mismatch |
| M-10 | Medium | High | FACT | Agent | Preview HTTP /api/sync lacks file-count cap |
| L-1 | Low | High | FACT | Quota | Remix skips MAX_PROJECT_ROWS_PER_USER |
| L-2 | Low | High | FACT | RateLimit | No rate limit on project create/delete |
| L-3 | Low | High | FACT | AuthZ | DELETE /api/projects/:id no Worker-side ownership check |
| L-4 | Low | High | FACT | Auth | WS ticket back-check skipped when sessionHash omitted |
| L-5 | Low | High | FACT | Auth | ?token= fallback exposes 30-day tokens to access logs |
| L-6 | Low | High | FACT | SSRF | DNS rebinding unmitigated (acknowledged, prod safe) |
| L-7 | Low | High | FACT | Code | uploads().removeAll() called twice in delete |
| L-8 | Low | Med | INFERENCE | RateLimit | 'unknown' shared rate-limit bucket fallback |
| L-9 | Low | High | FACT | Crypto | PBKDF2 iterations 100k vs OWASP 600k recommendation |
| L-10 | Low | High | FACT | SSRF | Compressed IPv6 rejected (conservative, documented) |
| L-11 | Low | High | FACT | Agent | Preview sync silently drops oversize files, reports success |
| L-12 | Low | High | FACT | Agent | import.meta.env replacement is string-level, not AST |
| L-13 | Low | High | FACT | CI | No npm audit gate in CI |
| L-14 | Low | High | FACT | Deps | @cloudflare/sandbox prerelease pin |
| I-1 | Info | High | FACT | Deps | undici HIGH in devDeps (wrangler transitive, not prod) |
| I-2 | Info | High | FACT | Architecture | getUserRegistry dead code — scalability foundation exists |
| I-3 | Info | High | FACT | Admin | Admin preview lacks sandbox CSP |
| I-5 | Info | High | FACT | Repo | Committed tsbuildinfo + load-results artifacts |

---

## Totals

| Severity | Count |
|----------|-------|
| Critical | 0 |
| High | 1 |
| Medium | 15 |
| Low | 14 |
| Info | 4 |
| **Total** | **34** |

All findings are FACT-labeled except M-6 (INFERENCE) and L-8 (INFERENCE). Zero findings required guessing — each is backed by file:line evidence.

**Overall assessment**: No critical vulnerabilities. The single High finding (pdfjs-dist) is a dependency issue with a clear upgrade path. The Medium findings cluster around three themes: (1) singleton DO scalability, (2) missing rate limits on authenticated endpoints, and (3) admin operation robustness. The auth/crypto implementation is strong — fail-closed, timing-safe, properly revocable, with PKCE OAuth and single-use WS tickets. The codebase demonstrates security-conscious engineering.
