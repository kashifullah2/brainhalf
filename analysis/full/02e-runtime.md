# Phase 2E — Runtime System Deep Manual Review

**Scope**: `src/runtime/**` — all 21 files  
**Reviewer**: Automated deep audit  
**Date**: 2026-10-01  

## Files Reviewed (DEEP)

| File | Lines | Status |
|------|-------|--------|
| `project.ts` | 1261 | DEEP |
| `pilot.ts` | 162 | DEEP |
| `secrets.ts` | 55 | DEEP |
| `uploads.ts` | 131 | DEEP |
| `database-tools.ts` | 202 | DEEP |
| `managed-auth.ts` | ~200 | DEEP |
| `verification.ts` | 155 | DEEP |
| `worker.ts` | 137 | DEEP |
| `types.ts` | 89 | DEEP |
| `source.ts` | 51 | DEEP |
| `artifact.ts` | 36 | DEEP |
| `auth-page.ts` | 17 | DEEP |
| `cloudflare-api.ts` | 79 | DEEP |
| `integrations.ts` | 37 | DEEP |
| `managed-capability.ts` | 19 | DEEP |
| `managed-mail.ts` | 151 | DEEP |
| `managed-store.ts` | 117 | DEEP |
| `managed-types.ts` | 41 | DEEP |
| `publication.ts` | 37 | DEEP |
| `provisioning.ts` | 50 | DEEP |
| `request-monitor.ts` | 23 | DEEP |
| `availability.ts` | 36 | DEEP |
| `env.ts` | 14 | DEEP |
| `mail-provider.ts` | 37 | DEEP |

---

## Findings

### E-1: Duplicate `removeAll()` call in project deletion

**Severity**: Low | **Confidence**: High | **Label**: FACT

`project.ts:286-287` — `this.uploads().removeAll()` is called twice consecutively in the `/delete` handler:

```
286:  await this.uploads().removeAll();
287:  await this.uploads().removeAll();
```

The second call is a no-op if the first succeeded. If the first partially fails (throws mid-way through R2 deletes), the second call re-executes the entire removal — but this is accidental redundancy, not intentional retry logic. Each call constructs a new `ProjectUploads` instance, so there's no shared state.

**Impact**: Wasted network calls on every project deletion. No data loss or security risk.  
**Recommendation**: Remove line 287.

---

### E-2: Heartbeat handler has misleading indentation

**Severity**: Low | **Confidence**: High | **Label**: FACT (cosmetic, not a logic bug)

`project.ts:465-474` — Inside the `/heartbeat` transaction:

```
468:  if (active(job) && job.status !== 'stopping') {
469:    job.leaseUntil = Date.now() + PILOT_LIMITS.leaseMs;
470:    await txn.put({ current: job, [`job:${job.id}`]: job });
471:      const outcome = this.jobOutcome(job);
472:      if (outcome) await txn.put(`outcome:${outcome.id}:${outcome.kind}`, outcome);
473:  }
```

Lines 471-472 are dedented relative to lines 469-470 but are still inside the `if` block (JavaScript uses braces, not indentation, for scoping). The code is functionally correct — outcomes are only computed for active, non-stopping jobs.

**Impact**: Readability confusion during code review. No runtime effect.  
**Recommendation**: Reindent lines 471-472 to match lines 469-470.

---

### E-3: Non-atomic R2 migration during slug rename

**Severity**: Medium | **Confidence**: Medium | **Label**: INFERENCE

`project.ts:131-158` — `migrateAliasPrefix()` copies every R2 object from the old alias prefix to the new one, then deletes the old. The operation is performed object-by-object with no persisted progress cursor.

**Failure scenario**: If the Durable Object is evicted or hits a timeout mid-migration (e.g., after copying 500 of 1000 objects), the migration resumes from scratch on the next call — but the slug has already been re-registered. Objects already copied and deleted are fine, but objects not yet copied from the old prefix are now orphaned under a prefix that no longer resolves.

The release-record repointing (lines 148-157) IS persisted atomically via `storage.put(updates)`, but only AFTER the R2 loop completes — if the loop fails, release records still point to old-prefix keys.

**Mitigating factors**:
- Source file limit is 500 files (types.ts:68), upload limit is 100 files (types.ts:71), so total object count is bounded.
- The R2 loop uses pagination (limit: 1000) and should complete in a single pass for most projects.
- Slug renames are rare owner-initiated actions.

**Impact**: Data loss risk (orphaned assets/uploads) on interrupted slug rename.  
**Recommendation**: Persist the migration cursor in DO storage, or copy-first then delete-second in a separate pass after verifying all copies succeeded.

---

### E-4: R2 sweep during deletion capped at 5000 objects

**Severity**: Low | **Confidence**: Medium | **Label**: INFERENCE

`project.ts:294-298` — The R2 artifact sweep loop runs at most 50 passes of 100 objects each:

```
for (let pass = 0; pass < 50; pass++) {
  const objects = await this.env.ARTIFACTS.list({ prefix: `${this.alias}/`, limit: 100 });
  if (!objects.objects.length) break;
  await this.env.ARTIFACTS.delete(objects.objects.map(object => object.key));
}
```

If a project accumulates more than 5000 R2 objects (artifacts from many builds + uploads + screenshots + sources), the remaining objects are orphaned permanently.

**Mitigating factors**:
- Source limit: 500 files, upload limit: 100 files, artifact limit: 500 assets.
- Each build cycle creates ~1 artifact key, 1 source key, and 1 screenshot key.
- At 30 jobs/day limit, accumulation of 5000 objects would take months — and old artifacts are overwritten by key (same prefix pattern).

**Impact**: Minor R2 storage leak for extremely long-lived projects.  
**Recommendation**: Use `listed.truncated` / `listed.cursor` pattern instead of a fixed cap, consistent with `migrateAliasPrefix()` which already does this correctly.

---

### E-5: Static asset base64 decoding on every request

**Severity**: Low | **Confidence**: High | **Label**: FACT (performance, not security)

`project.ts:1030` — For static assets not served via the dispatch Worker:

```
Uint8Array.from(atob(asset.content), character => character.charCodeAt(0))
```

Base64 decoding happens per request for every asset fetch. The artifact is loaded from R2 on cache miss (line 1027), then each asset is decoded from the JSON blob.

**Impact**: CPU overhead on asset-heavy pages. No correctness issue — the artifacts are validated at build time (`artifact.ts:30` checks base64 format).  
**Recommendation**: This is a known trade-off of the artifact-as-JSON design. Acceptable at pilot scale.

---

### E-6: `assertSafeMigration` uses regex-based SQL validation

**Severity**: Medium | **Confidence**: Medium | **Label**: INFERENCE

`source.ts:46-50` — Migration SQL safety relies entirely on regex matching against stripped SQL:

```ts
const stripped = sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
if (/\b(?:DROP|TRUNCATE|DELETE|REPLACE|UPDATE|ATTACH|DETACH|VACUUM|PRAGMA)\b/i.test(stripped)
  || /\bALTER\s+TABLE\b[\s\S]*\b(?:DROP|RENAME)\b/i.test(stripped))
  throw new RuntimeError('...');
```

**Known limitations**:
1. String literals containing blocked keywords cause false rejections: `INSERT INTO t VALUES('DROP TABLE')` would be blocked. This is conservative (safe side).
2. `CREATE TRIGGER` bodies with UPDATE/DELETE would be falsely rejected — same conservative behavior.
3. The comment stripping is correct for `--` and `/* */` styles.
4. SQLite only accepts ASCII keywords, so Unicode homoglyph bypasses are not viable.

**What IS allowed**: INSERT, CREATE TABLE, CREATE INDEX, ALTER TABLE ADD COLUMN. This matches the documented "additive only" policy.

**Impact**: False rejections possible (user inconvenience), but no false acceptances identified. The regex approach is defense-in-depth on top of D1's own permission model.  
**Recommendation**: Acceptable. Document the false-rejection behavior for users.

---

## Positive Security Controls (FACT, verified)

### Authentication & Sessions

| Control | Location | Detail |
|---------|----------|--------|
| Session tokens hashed before storage | `project.ts` session helpers | SHA-256 digest; raw token never persisted |
| Single-use ticket sessions | `project.ts:980` | `consume: true` deletes ticket on read |
| Cookie security | `integrations.ts:13-18` | `__Host-` prefix, HttpOnly, Secure, SameSite=Lax (or None+Partitioned for embeds) |
| Preview auth gate | `project.ts:995` | Dev environment requires valid `__Host-bh_preview` session |
| Rate limiting | `managed-store.ts:64-69` | Per-key sliding window with SQL-backed counters |
| Timing-safe auth | `managed-auth.ts` | `timingSafeEqual` for password comparison; dummy hash for missing users |

### Request Isolation

| Control | Location | Detail |
|---------|----------|--------|
| Header stripping (deployed Worker) | `project.ts:1016` | Removes `x-bh-*`, `x-brainhalf-*`, `cf-access-*`, `authorization`, `cookie` before dispatch |
| Header stripping (sandbox preview) | `project.ts:1007-1009` | Same pattern plus `x-auth-*`; BrainHalf cookies filtered from cookie header |
| Set-Cookie blocked from user Workers | `project.ts:1024` | `response.headers.delete('Set-Cookie')` on dispatched Worker responses |
| CSRF origin check | `project.ts:996` | Non-safe methods require `Origin === url.origin`; null/missing Origin → 403 |
| Worker resource limits | `project.ts:1023` | `cpuMs: 50, subRequests: 20` on dispatched user Workers |
| Browser guardrails | `project.ts:1153` | Verification browser locked to `allowedDomains: [hostname]` |

### Data Protection

| Control | Location | Detail |
|---------|----------|--------|
| AES-256-GCM encryption | `secrets.ts` | 12-byte random IV, scope-bound AAD per project+environment |
| Secret redaction | `secrets.ts` | Regex patterns for re_, GOCSPX-, whsec_, cfut_, ghp_, sk-, bhsvc_ |
| Token redaction in email detail | `managed-mail.ts:70` | Production email detail redacts `#token=` values |
| Request monitor anonymization | `request-monitor.ts:7-15` | Only route groups stored, never full paths or user IDs |
| Provisioning diagnostics | `provisioning.ts:12` | Never returns token values or account data |

### SQL Injection Prevention

| Control | Location | Detail |
|---------|----------|--------|
| `databaseIdentifier()` | `database-tools.ts:4-7` | Regex `/^[A-Za-z][A-Za-z0-9_]{0,63}$/`, blocks sqlite/cf/bh prefixes, double-quote wrapping |
| Parameterized queries | `database-tools.ts` (all functions) | `prepareRowImport`, `prepareRowUpdate`, `prepareRowDelete` all use `?` parameters |
| Row/field limits | `database-tools.ts` | Max 100 records, max 100 fields, max 50 columns per table |
| Read boundary | `database-tools.ts:readDatabaseTable` | LIMIT 51, offset clamped to 1,000,000, output truncated at 8000 chars |
| `_bh_migrations` protection | `project.ts` | Regex blocks migration SQL from touching `_bh_migrations` table |
| Verification SQL read-only | `verification.ts` | Blocks PRAGMA, INSERT, UPDATE, DELETE, DROP, ALTER in verification database steps |

### Upload Security

| Control | Location | Detail |
|---------|----------|--------|
| File size limit | `uploads.ts` | 5MB per file (`PILOT_LIMITS.uploadBytes`) |
| File count limit | `uploads.ts` | 100 files per environment (`PILOT_LIMITS.uploadFiles`) |
| Parallel upload limit | `uploads.ts` | 2 concurrent uploads (`PILOT_LIMITS.parallelUploads`) |
| Content-type validation | `uploads.ts` | Regex validation of MIME type |
| Filename validation | `uploads.ts` | No path separators, no control chars, 1-160 chars |
| CSP on served files | `uploads.ts` | `default-src 'none'; sandbox`, plus `X-Content-Type-Options: nosniff` |
| Storage quota enforcement | `pilot.ts:46-58` | Transaction-based reservation with idempotency check |

### Source File Safety

| Control | Location | Detail |
|---------|----------|--------|
| Path traversal prevention | `source.ts:16` | No `..`, `.`, empty segments, backslash, null, CR, LF |
| Secret file blocking | `source.ts:18` | `isBlockedSecretFile()` filter (except `.env.example`) |
| Directory blocking | `source.ts:19` | `node_modules`, `.git`, `.brainhalf`, `dist` prefixed paths stripped |
| Lockfile stripping | `source.ts:24` | Model-authored lockfiles removed — prevents supply chain poisoning |
| Prototype pollution guard | `source.ts:28` | Uses `Object.defineProperty` instead of direct assignment |
| Duplicate path detection | `source.ts:25` | Throws on duplicate normalized paths |
| Size/count limits | `source.ts:13,27` | 500 files, 4MB total after icon compatibility transform |

### Auth Page Security

| Control | Location | Detail |
|---------|----------|--------|
| CSP nonce | `auth-page.ts:5` | `crypto.randomUUID()` nonce for script and style |
| Strict CSP | `auth-page.ts:14` | `default-src 'none'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'` |
| Token in fragment only | `auth-page.ts:8` | Token extracted from `location.hash`, never in URL query string |
| History state cleanup | `auth-page.ts:8` | `history.replaceState` strips hash immediately — prevents Referer leakage |
| HTML escaping | `auth-page.ts:1,6` | App name escaped in all HTML contexts |

### Pilot Coordinator

| Control | Location | Detail |
|---------|----------|--------|
| Transaction-based registration | `pilot.ts:68-86` | Project count enforced atomically within transaction |
| Owner-scoped counting | `pilot.ts:77-83` | Owner-prefix index prevents cross-owner slot theft |
| Lease-based admission | `pilot.ts:139-158` | Sandbox/browser slots with expiry; stale leases cleaned on acquire |
| Daily job deduplication | `pilot.ts:32` | Job IDs tracked in daily usage array to prevent double-counting |
| Hostname uniqueness | `pilot.ts:91-98` | Custom hostname registration checked atomically in transaction |

### Email System

| Control | Location | Detail |
|---------|----------|--------|
| Idempotency keys | `managed-mail.ts:79` | Duplicate sends prevented by fingerprint + idempotency_key unique index |
| Rate limiting | `managed-mail.ts:90` | Daily email limit enforced per environment |
| Retry with backoff | `managed-mail.ts:144` | Exponential backoff: 30s × 2^attempt, max 5 retries |
| 23-hour expiry | `managed-mail.ts:128` | Stale queued messages auto-fail after 23 hours |
| Deleted project check | `managed-mail.ts:111,136` | `drain()` checks `deleted` flag before each send |
| Action URL origin check | `managed-mail.ts:50` | Email template action URLs must match app origin — prevents open redirect |
| Template variable whitelist | `managed-mail.ts:38` | Only declared variables allowed per template kind |
| History pruning | `managed-mail.ts:148` | Bounded to 500 messages, 30-day retention |

### Managed Capability Tokens

| Control | Location | Detail |
|---------|----------|--------|
| HMAC-signed tokens | `managed-capability.ts:7` | `bhsvc_` prefix, HMAC-SHA256 with context string |
| Scope assertion on verify | `managed-capability.ts:16` | `assertScope()` validates projectId and ownerId after decode |
| Length limit | `managed-capability.ts:10` | Rejects tokens > 1500 chars |
| No extra segments | `managed-capability.ts:12` | Rejects tokens with unexpected `.` segments |

### Cloudflare API Client

| Control | Location | Detail |
|---------|----------|--------|
| Path parameter encoding | `cloudflare-api.ts:22-24` | `encodeURIComponent` on accountId, zoneId, all path params |
| Redirect suppression | `cloudflare-api.ts:28` | `redirect: 'manual'` prevents following redirects |
| Timeout | `cloudflare-api.ts:27` | 30-second `AbortSignal.timeout` on all requests |
| Response size limit | `cloudflare-api.ts:30` | `readBoundedJson` with 8MB cap |

### Artifact Validation

| Control | Location | Detail |
|---------|----------|--------|
| Base64 format check | `artifact.ts:30` | Regex `/^[A-Za-z0-9+/]*={0,2}$/` on each asset content |
| Path traversal prevention | `artifact.ts:30` | Must start with `/`, no `..` or `.` segments, no control chars |
| Symlink blocking | `artifact.ts:11` | Build-time: `isSymbolicLink()` check; validation: redundant with base64 check |
| Size enforcement | `artifact.ts:32-33` | 12MB total, must include `/index.html` |
| Asset count limit | `artifact.ts:27` | Max 500 assets |

---

## Architecture Notes

### Single Pilot Coordinator (INFERENCE, scalability observation)

All project registration, lookup, usage tracking, and slot admission flows through a single `PilotCoordinator` Durable Object per platform instance. This creates a serialization bottleneck for concurrent operations:
- Every app request triggers `consumeUsage('requests')` on the owner's usage DO
- Every job start triggers `acquire()` on the shared admission DO
- Every slug lookup during routing hits `pilot.lookup()`

At pilot scale this is acceptable. At high scale, the admission DO becomes a throughput ceiling. The owner-specific DOs (usage tracking) are already sharded per owner.

### Verification Pipeline Isolation (FACT, positive)

Each verification run:
1. Creates a disposable D1 database (`bh-test-${job.id}`)
2. Deploys a disposable Worker (`bh-test-${job.id}`)
3. Creates ephemeral test users with deterministic IDs
4. Runs in a browser locked to the app's hostname
5. Cleans up ALL of the above in a `finally` block (project.ts:1242-1257)

The test Worker uses the same service bindings as the real deployment. Test users are revoked and deleted. The disposable D1 and Worker are removed via the CF API. This provides strong isolation between verification runs and production.

### Email Queue Design (FACT, positive)

The managed email system uses a persistent SQL-backed queue inside the DO:
- Emails survive DO hibernation (stored in SQL, not memory)
- Alarm-driven drain with bounded batch size (5 per tick)
- Provider credentials sealed with AES-256-GCM per message
- Development emails captured (not sent) — safe for testing

---

## Items NOT Found (explicit negatives)

1. **No SQL injection vectors** in database-tools.ts, managed-store.ts, or request-monitor.ts — all use parameterized queries or validated identifiers.
2. **No prototype pollution** in source.ts or verification.ts — both use `Object.defineProperty` or explicit key checks (`__proto__`, `prototype`, `constructor`).
3. **No secret leakage** in provisioning.ts, availability.ts, or managed-store.ts — all explicitly avoid returning credential values.
4. **No open redirect** in auth-page.ts or managed-mail.ts — action URLs validated against app origin.
5. **No XSS** in auth-page.ts — CSP nonce, HTML escaping, frame-ancestors 'none'.

---

## Summary Table

| ID | Severity | Confidence | Label | Description |
|----|----------|------------|-------|-------------|
| E-1 | Low | High | FACT | `uploads().removeAll()` called twice in delete path (`project.ts:286-287`) |
| E-2 | Low | High | FACT | Heartbeat outcome code has misleading indentation (`project.ts:471-472`) |
| E-3 | Medium | Medium | INFERENCE | Non-atomic R2 migration in `migrateAliasPrefix()` — interrupted rename can orphan assets (`project.ts:131-158`) |
| E-4 | Low | Medium | INFERENCE | R2 delete sweep capped at 5000 objects — edge-case storage leak (`project.ts:294-298`) |
| E-5 | Low | High | FACT | Static asset base64 decoded per request — performance overhead (`project.ts:1030`) |
| E-6 | Medium | Medium | INFERENCE | `assertSafeMigration` regex-based SQL validation has known false-rejection edge cases (`source.ts:46-50`) |

**Critical findings**: 0  
**High findings**: 0  
**Medium findings**: 2 (E-3, E-6)  
**Low findings**: 4 (E-1, E-2, E-4, E-5)

**Overall assessment**: The runtime system demonstrates strong security engineering. All user input boundaries are validated. SQL injection is comprehensively prevented. Session management uses industry-standard patterns. The managed auth system has timing-safe comparisons and proper rate limiting. The verification pipeline provides excellent isolation with full cleanup. The email system is robust with idempotency, retry logic, and proper credential sealing. The two medium findings (non-atomic R2 migration and regex SQL validation) represent defense-in-depth concerns rather than exploitable vulnerabilities.
