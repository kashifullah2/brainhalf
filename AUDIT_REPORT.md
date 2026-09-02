# BrainHalf — Consolidated Audit Report

**Date:** 2026-09-01
**Commit:** `cd10206` (branch `main`)
**Scope:** `src/` · `server/` · `functions/` · `queue-worker/` · `migrations/` · `scripts/` · config

## What was audited and how

Six passes over the full tree: structural map, correctness bugs, security, performance,
maintainability, dependency/config, and test coverage. Every finding below was traced to a
specific line. Where a claim was verifiable by execution, it was executed — the test suite,
both typechecks, `pnpm build`, `pnpm audit`, `pnpm outdated`, the production bundle sizes, and
a standalone check of the email validator. Claims that could only be traced by reading are
marked as such in the individual entry.

**Baseline health at time of audit:** 218 tests pass (17 files). `pnpm typecheck` and
`pnpm typecheck:server` are clean. `pnpm build` succeeds in ~42s. No linter is configured;
`noUnusedLocals` / `noUnusedParameters` stand in for one.

## Summary

| Severity | Count | Meaning |
|---|---|---|
| **Critical** | 8 | Broken in production now, or an exploitable security risk |
| **High** | 31 | Data loss/corruption, silent feature failure, or a security hardening gap |
| **Medium** | 47 | Correctness bugs with workarounds, performance, high-cost maintainability |
| **Low** | 21 | Hygiene; safe to defer |
| **Total** | **107** | |

**Effort key:** **S** = under 2 hours · **M** = half a day to two days · **L** = more than two days

### The five things that matter most

1. **Rotate the EmailJS credentials** (C-1) and the four `VITE_`-prefixed keys in `.env` (C-5).
   Both are S. C-1 is the only finding an outsider can act on today.
2. **The queue worker is the single worst file in the repo** — C-2, C-6, C-7, H-1 through H-4 all
   live in 301 lines that are neither typechecked nor tested. Fixing the pipeline it duplicates
   (H-19) removes most of them at once.
3. **The deploy pipeline cannot ship a working system** — C-3, C-4, C-8 mean a normal `pnpm deploy`
   can produce a Pages app that enqueues work nothing consumes, from a clone that cannot deploy
   at all. All three are S.
4. **There is no CI** (H-30). Every gate in this repo is opt-in.
5. **The data-mutation layer has zero tests** (H-27 through H-29). Auth primitives are among the
   best-tested code in the codebase; `server/batches.ts` at 589 lines has no test file.

---

# CRITICAL

## C-1 · EmailJS credentials committed to git and shipped in the browser bundle
**File:** `wrangler.toml:75-79` · also `dist/assets/Contact-*.js`, `src/pages/legal/Contact.tsx:144-159`
**Effort: S** · **Status (2026-09-01): partially remediated** — the browser-side EmailJS path is
deleted and the bundle is verified clean; the `wrangler.toml` `[vars]` removal and the credential
rotation are still outstanding and are the parts that actually close the exposure.

`EMAILJS_SERVICE_ID`, `EMAILJS_TEMPLATE_ID`, `EMAILJS_PWD_TEMPLATE_ID` and `EMAILJS_PUBLIC_KEY`
sit in `[vars]` in a tracked file, and the same values reach the client bundle via
`VITE_EMAILJS_*`. Together they are the complete argument set for
`POST https://api.emailjs.com/api/v1.0/email/send`.

These are live credentials, not public identifiers: `functions/api/auth/password-reset.ts:94-100`
calls that endpoint from a Worker while **spoofing** a browser `Origin` and `User-Agent`, which
only works if EmailJS's non-browser API restriction is off. Anyone reading the repo or the JS
bundle can therefore send mail through the account's templates — including the password-reset
template, which renders a `reset_url` the sender controls. That is branded credential phishing,
and it bypasses the 5/hour/IP limit on `functions/api/contact.ts:52-58`.

**Fix:** rotate the public key and both template ids (they are in git history, so removing them
from `HEAD` is not sufficient); enable the EmailJS domain allowlist and private-key requirement;
move all four to Pages secrets; delete the browser path per the teardown checklist already written
at `Contact.tsx:27-28`.

## C-2 · O(n²) base64 encoding kills the queue worker on any real file
**File:** `queue-worker/src/index.ts:78-80` · **Effort: S**

```js
const base64 = btoa(
  new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
);
```

String concatenation inside `reduce` reallocates on every byte. A 14 MB PDF (the documented
`MAX_PDF_BYTES`) costs ~14 million allocations. This will not finish inside a Worker CPU budget.
When the isolate is killed the `catch` at `:216` never runs, so the document is stranded at
`status='processing'` and `refreshBatchStatus` pins the batch at `'processing'` permanently —
the exact state `src/lib/batch-status.ts` exists to work around.

**Fix:** chunked encoding.
```js
const bytes = new Uint8Array(buffer);
let binary = '';
const CHUNK = 0x8000;
for (let i = 0; i < bytes.length; i += CHUNK) binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
const base64 = btoa(binary);
```

## C-3 · Nothing deploys the queue consumer; the producer can ship without it
**File:** `package.json:12` vs `queue-worker/package.json:6` · **Effort: S**

`pnpm deploy` runs `wrangler pages deploy dist` only. `wrangler.toml:64-66` declares the
**producer** binding `OCR_QUEUE`. The **consumer** (`brainhalf-processor`) is a separate Worker
deployed by `cd queue-worker && pnpm deploy`, which nothing at the root references — no script,
no CI, no note in `package.json`.

A normal deploy therefore ships a Pages app that enqueues OCR jobs to a queue whose consumer is
stale or absent. `functions/api/batches/index.ts:120-137` sets `asyncProcessing: true` on a
successful `sendBatch`, so `src/lib/api-client.ts:442-450` tells the user extraction is running
in the background and returns. Nothing consumes the messages. Documents sit at `'queued'`,
batches at `'processing'`, and no error appears anywhere.

**Fix:** consumer first, then Pages, in one script.
```jsonc
"deploy:worker": "pnpm --filter brainhalf-processor exec wrangler deploy",
"deploy:pages":  "NODE_OPTIONS=\"--dns-result-order=ipv4first\" wrangler pages deploy dist --project-name brainhalf",
"deploy":        "pnpm build && pnpm db:migrate:remote && pnpm deploy:worker && pnpm deploy:pages"
```
Requires C-4.

## C-4 · `wrangler` is not a project dependency — deploys rely on an unpinned global binary
**File:** `package.json:8,12,19,20` · `queue-worker/package.json:6,9` · **Effort: S**
**Status (2026-09-01): remediated.** `wrangler` pinned to 4.122.0 via the catalog; both packages
resolve one version each of wrangler/typescript/@cloudflare/workers-types; `packages:` added;
`engines` + `packageManager` set; `queue-worker/node_modules` installs. One addition beyond the
stated fix: `onlyBuiltDependencies: [esbuild, workerd]`, without which pnpm 10 blocks workerd's
postinstall and `wrangler pages dev` has no local runtime.

Four root scripts invoke `wrangler`; it appears in neither `dependencies` nor `devDependencies`.
`node_modules/wrangler` is absent — resolution falls to a global install (observed: **4.122.0**).
`queue-worker/package.json:9` declares `wrangler: "^3.0.0"`, a different major, and its
`node_modules` was never installed because `pnpm-workspace.yaml` has no `packages:` key.

A clean clone cannot deploy or migrate, and the deployed artifact is not reproducible — whichever
wrangler the operator happens to have is the one that bundles and uploads the Functions.

**Fix:** pin `"wrangler": "4.122.0"` in root `devDependencies`; add `packages: ['.', 'queue-worker']`
to `pnpm-workspace.yaml`; move `wrangler`/`typescript`/`@cloudflare/workers-types` into the catalog
so both packages resolve one version each. Add `engines` and `packageManager` fields.

## C-5 · Live `VITE_`-prefixed provider and AWS credentials in `.env`
**File:** `.env` (untracked, correctly gitignored) · **Effort: S**

Non-empty values present for `VITE_HUNYUAN_API_KEY`, `VITE_OCR_API_KEY`,
`VITE_AWS_ACCESS_KEY_ID`, `VITE_AWS_SECRET_ACCESS_KEY`, `VITE_AWS_REGION`.

**Verified not leaking today:** none of those values appears anywhere in `dist/`, because Vite
only inlines `import.meta.env.X` for `X` that source code references, and nothing in `src/` does.

But the `VITE_` prefix *is* the opt-in to browser inlining — `src/lib/ocr-client.ts:5-7` documents
exactly this hazard. And `public/_headers:35-43` confirms these are remnants of a real
browser-side path: `connect-src` used to list `api.futureppo.top`, `api.openai.com` and
`*.amazonaws.com` for "a 'browser-side fallback' that reached the OCR vendors from the page." So
these keys were plausibly served to browsers at some point.

**Fix:** rotate all four in their provider consoles — treat as compromised. Delete the five lines.
Add a build-time guard in `vite.config.ts` that throws when a `VITE_*(KEY|SECRET|TOKEN)` var is
non-empty, allowlisting only `VITE_EMAILJS_PUBLIC_KEY` and `VITE_GOOGLE_CLIENT_ID`.

## C-6 · `table` extraction mode always fails through the queue (UNIQUE violation)
**File:** `queue-worker/src/index.ts:164-173` with `:196-208` · **Effort: S**

```js
parsed.forEach((row) => {
  for (const [key, val] of flattenExtraction(row)) {   // no row prefix
```
`flattenExtraction(row)` uses the default `prefix = ''`, so every array row produces the *same*
key set. A 20-row table yields 20 fields named `Amount`. The insert at `:196` has no
`ON CONFLICT`, and `migrations/0002_batches.sql:65` declares `UNIQUE (document_id, normalized_field)`.
`env.DB.batch()` runs in an implicit transaction, so the second insert throws, the batch rolls
back, and the `catch` marks the document `'failed'`.

**Fix:** prefix by row index, matching what `src/lib/ocr-client.ts:347-349` already does:
`flattenExtraction(row, `Row ${rowIndex + 1}`)`.

## C-7 · Queue-processed documents are stored at confidence 1.0 — the review gate silently disengages
**File:** `queue-worker/src/index.ts:205` (and `:212-214`) · **Effort: M**

`field.confidence ?? 1.0` — but `confidence` is declared optional at `:144` and **never assigned**
at any of the three push sites (`:167-171`, `:176-181`, `:185-189`), so the fallback always fires.
Separately, `:212-214` updates only `status`, `ocr_text` and `error`; `documents.overall_confidence`
is never written, and the `_overall_confidence` every prompt in `server/ocr-prompts.ts` requests is
stored as an ordinary data field.

The review queue selects `WHERE confidence < threshold` (`functions/api/review-queue.ts:101`). At
1.0, nothing is ever below any threshold in the allowed 0.5–0.95 range. The product's core
promise — "Nothing is exported until you are happy with it" (`ReviewQueue.tsx:106-107`) — is
silently off for every document the queue processes. This is the same class of defect
`src/lib/confidence-scorer.ts:111-124` documents having already fixed once (the hardcoded 0.92).

**Fix:** extract `_overall_confidence` before flattening, run values through
`calculateFieldConfidence`, and persist `overall_confidence`. Best done as part of H-19.

## C-8 · Migrations are not part of the deploy, and two are hard dependencies
**File:** `package.json:19-20` · `wrangler.toml:51-58` · **Effort: S**

`db:migrate:remote` is a manual step.

| Missing migration | Symptom |
|---|---|
| `0005_batch_prompt` | `INSERT INTO batches (..., prompt)` at `batches/index.ts:106` throws → **500 on every batch creation** |
| `0004_templates` | every `/api/templates` request 500s |
| `0006_pending_uploads` | `storage-sweep.ts:55-70` throws, is caught, returns 0 → abandoned R2 objects accumulate forever, no error surfaced |

`wrangler.toml:51-58` states the 0006 dependency explicitly. The existing suite already contains a
fixture for the 0005 failure mode (`server/api-middleware.test.ts:76`), so it is a known risk with
no guard.

**Fix:** chain `db:migrate:remote` into `deploy` (see C-3). Add a test that greps `server/` and
`functions/` for referenced tables/columns and asserts each exists in `migrations/`.

---

# HIGH

## Queue worker (H-1 – H-4)

### H-1 · `max_retries = 3` is dead — OCR failures are never retried
**File:** `queue-worker/src/index.ts:34-39` vs `:216-224` · **Effort: S**

`processDocument` wraps the whole OCR path in its own `try/catch` that marks the document `'failed'`
and **swallows** the error. It therefore resolves normally, `message.ack()` runs at `:33`, and the
outer `catch { message.retry() }` is unreachable for any upstream failure. The comment "We do not
ack() so it retries" describes behaviour the code does not have. A transient provider 429 or 503
permanently fails the document on the first attempt, despite `max_retries = 3` in
`queue-worker/wrangler.toml`.

**Fix:** classify permanent vs transient; rethrow transient failures after recording so the outer
handler can call `message.retry()`.

### H-2 · Redelivery guard omits `'processing'`, contradicting its own comment
**File:** `queue-worker/src/index.ts:60-63` · **Effort: S**

```js
// If already processing or completed, skip. (Could be a redelivered message)
if (docRow.status === 'completed' || docRow.status === 'failed') {
```
The comment says `processing`; the condition checks `failed`. Cloudflare Queues is at-least-once,
so a redelivery while the first attempt is in flight starts a second extraction, and both reach the
field insert — the same UNIQUE collision as C-6, failing a document that was about to succeed.

**Fix:** add `|| docRow.status === 'processing'`, and make the transition atomic:
`UPDATE documents SET status='processing' WHERE id = ? AND status = 'queued'`, skipping when
`meta.changes === 0`.

### H-3 · Queue worker inserts fields without clearing the previous set
**File:** `queue-worker/src/index.ts:193-209` · **Effort: S**

`functions/api/batches/[batchId]/documents/[documentId]/result.ts:113-116` deliberately issues
`DELETE FROM document_fields WHERE document_id = ?` first — "Re-running extraction replaces the
previous fields rather than appending." The worker omits it, so any second pass over a document
that already has fields collides instead of replacing.

**Fix:** prepend the same `DELETE` to the `stmts` array.

### H-4 · Two different OCR upstreams for the same document
**File:** `queue-worker/src/index.ts:234` vs `functions/api/ocr.ts:69` · **Effort: S**

The worker hardcodes `https://api.futureppo.top/v1` as its default but
`queue-worker/wrangler.toml:22` overrides `HUNYUAN_BASE_URL` to
`https://brainhalf-vercel-proxy.vercel.app/v1`. The root `wrangler.toml` sets **no**
`HUNYUAN_BASE_URL`, so the Pages Function falls through to `api.futureppo.top`. The same document
hits a different service depending on which path processed it. `server/openai-params.ts:23-30`
exists specifically to prevent this drift; the Hunyuan constants were never moved into it.

**Fix:** move `DEFAULT_HUNYUAN_BASE_URL` / `DEFAULT_HUNYUAN_MODEL` / `HUNYUAN_USER_AGENT` into the
shared module and set the var in both `wrangler.toml`s or neither.

## Data loss (H-5 – H-9)

### H-5 · Table-mode extraction persists only the first row's values
**File:** `src/lib/ocr-client.ts:493-512` · **Effort: M**

`ordered` is built to derive the *column set* (`if (seen.has(label)) continue`) but is then used as
the `fields` array at `:503`. For a 20-row table, `fields` holds one entry per column with the value
from whichever row introduced it. `rows` has all 20 — but `createBatch` posts only `ocrText`,
`overallConfidence` and `fields` (`api-client.ts:496-507`); `rows` is never sent. The server rebuilds
`rows` from `document_fields` as one row per document (`server/batches.ts:268-282`), so after a reload
a 20-row table shows a single row. The data is visible once, then gone.

**Fix:** emit one field per row-and-column, prefixed by row index, so the relational store can hold
the grid.

### H-6 · A JSON-shaped `fulltext` response discards the entire transcription
**File:** `src/lib/ocr-client.ts:430-437` · **Effort: S**

```js
const rawTextContent = parsedObj.text || parsedObj.extracted_text || parsedObj.transcription
  || (typeof parsed === "string" ? parsed : "");
```
`fulltext` asks for plain text, so the `catch` at `:535` is the intended path. If the response
happens to be JSON-parseable and carries none of those three keys — which
`server/ocr-prompts.ts:134-142` documents this exact model doing, "invented ad-hoc keys" —
`rawTextContent` is `""`, and the page is stored as an empty field with empty `ocrText`, reported
as a **successful** extraction.

**Fix:** fall back to `content` rather than `""` in the final alternative.

### H-7 · Account deletion leaks R2 objects past the first 1000 pending uploads
**File:** `server/account.ts:183-197` · **Effort: M**

The pending-upload cleanup is capped at `LIMIT R2_DELETE_CHUNK` (1000), and the `catch` justifies
skipping the rest with "The sweep collects these anyway, and the rows cascade with the user below."
That reasoning is wrong: `sweepAbandonedUploads` reads *from* `pending_uploads`, and
`migrations/0006_pending_uploads.sql:22` declares `ON DELETE CASCADE` on `user_id`. Line 202 then
deletes the user, destroying the only record of the remaining keys.

Any pending upload beyond the first 1000 keeps its bytes in the bucket, unfindable and billed
indefinitely — on a GDPR Article 17 path that reported the data as erased.

**Fix:** loop until the table is empty for that user, bounded by `MAX_OBJECTS_PER_DELETE`, returning
`complete: false` like the `documents` path above it. Delete the user row only when nothing remains.

### H-8 · Rejecting a field writes the literal string `[REJECTED]` into exports
**File:** `src/pages/ReviewQueueDetail.tsx:154` · **Effort: S**

```js
const finalVal = action === "rejected" ? "[REJECTED]" : (customValue ?? fieldValues[fieldName] ?? originalVal);
```
This becomes `editedValue` (`review-queue-store.ts:281-283`), and `server/batches.ts:280` projects
`editedValue ?? value` into `rows`, which every exporter reads. A field a human marked *wrong*
appears in the CSV/XLSX/JSON/Markdown export as the text `[REJECTED]`, indistinguishable from
extracted content — and overwriting the value destroys the audit trail the `edited_value`/`value`
split exists to preserve (`migrations/0002_batches.sql:59`).

**Fix:** send `editedValue: null` for a rejection; let `review_status = 'rejected'` carry the meaning;
have exporters skip or blank rejected fields.

### H-9 · Clearing an edited cell silently reverts it to the model's value
**File:** `src/pages/BatchDetails.tsx:164,173` · **Effort: S**

`editedValue: editValue || null` — and `functions/.../fields.ts:50` treats `null` as "clear the
correction and restore the extracted value." The guard at `:164` does not catch it either: with
`editedValue = "abc"` and `editValue = ""`, neither clause matches. A user who deletes a wrong value
to blank it watches the model's value reappear, with a "Saved — Your correction is in." toast. There
is no way to record an empty field.

**Fix:** send `editValue` as-is; reserve `null` for an explicit "revert" action.

## Correctness (H-10 – H-16)

### H-10 · The review-queue page predicate omits the condition the badge counts
**File:** `functions/api/review-queue.ts:187-190` · **Effort: M**

`queueTotals` (`:97`) counts documents with an *unreviewed* flagged field
(`review_status IS NULL`); `isAwaitingReview` (`review-queue-store.ts:76`) encodes the same
predicate. The paging `EXISTS` has no `review_status IS NULL` clause, so it returns every flagged
document. `AppLayout.tsx:66-73` renders the badge from `totals.awaiting` while `ReviewQueue.tsx:90`
filters a 50-row page with `isAwaitingReview` — so a page can show "Queue's clear ☕" beside a
sidebar badge reading 12, with the awaiting items stranded on a later page.

`review-queue.ts:64-70` claims this exact drift is "the bug this replaces, not a new one." It was
moved, not removed.

**Fix:** add `AND f.review_status IS NULL` to the paging `EXISTS` so pagination is over awaiting
documents; serve the fully-verified list from a separate, explicitly-requested query.

### H-11 · `MAX_LISTED_BATCHES` is bypassable — unbounded query
**File:** `functions/api/batches/index.ts:34-46` · **Effort: S**

`intQuery` accepts any non-negative integer and `??` substitutes the cap only when the parameter is
absent, so `GET /api/batches?limit=1000000000` runs `LIMIT 1000000000` against a `LEFT JOIN` /
`GROUP BY` aggregate. No rate limit on this route. `server/batches.ts:18-23` states the cap exists
because "the query must not grow without bound."

**Fix:** `Math.min(intQuery(url,'limit') || MAX_LISTED_BATCHES, MAX_LISTED_BATCHES)` —
`functions/api/review-queue.ts:143` already does exactly this; the two copies of `intQuery` diverged.

### H-12 · Async batches are reported as "completed" when nothing has run
**File:** `src/lib/api-client.ts:442-450` (and `:618-626`) · **Effort: M**

`CreateBatchProgress.status` is `"processing" | "completed" | "failed"` — there is no queued state —
so enqueueing is reported as completion, and `UploadModal.tsx:423-424` closes the flow.

Worse in combination: `BATCH_STALL_AFTER_MS` is 5 minutes (`batch-status.ts:22`), and that file's
header comment — "there is no worker and no queue" — is now **false**. If the queue backs up past
five minutes, `isBatchStalled` returns true, the dashboard offers "Resume", and
`handleResumeBatch` (`BatchDetails.tsx:450-469`) re-runs extraction client-side while the worker is
still processing the same documents — colliding on `document_fields` per H-3.

**Fix:** add a `"queued"` variant and surface it as such; make `isBatchStalled` aware that async
batches legitimately sit idle.

### H-13 · A malformed document id resolves to an arbitrary document
**File:** `src/pages/ReviewQueueDetail.tsx:82` → `review-queue-store.ts:118-119` → `functions/api/review-queue.ts:124` · **Effort: S**

`/app/review-queue/abc` gives `NaN`. `fetchQueue` sends `String(NaN)` = `"NaN"` because
`NaN !== undefined`. Server-side `intQuery` returns `null` for that, so **the filter is not applied
at all**, and `limit: 1` returns the first flagged document in the queue. The page renders an
unrelated document under the requested URL, and every review action writes to it.

**Fix:** validate before requesting (`Number.isInteger(parsed) && parsed > 0`) and skip `NaN` values
in `fetchQueue`'s query builder.

### H-14 · Stale document survives navigation; in-flight loads are not cancelled
**File:** `src/pages/ReviewQueueDetail.tsx:99-130` · **Effort: S**

`if (match) { setItem(match); ... }` with no `else`, so a document that has left the queue leaves the
*previous* one on screen — and actions write to the old `item.document.id`. There is also no
cancellation token, so a late response for a previous `documentId` overwrites the current one.

**Fix:** `setItem(match ?? null)` plus a `cancelled` flag in the effect's cleanup.

### H-15 · `postJson` can return `null` on a 200, then dereference it
**File:** `src/context/AuthContext.tsx:142-160` · **Effort: S**

A 200 with an unparseable, non-HTML body falls through both branches of the `catch` and returns
`null` typed as `T`. Callers then run `setUser(toProfile(data.user))` (`:187,372,383,403`) →
`TypeError: Cannot read properties of null`. An uncaught TypeError inside the auth flow reaches the
`ErrorBoundary` rather than showing a sign-in error. `src/lib/api-client.ts:157` handles this case
correctly; the auth copy dropped it.

**Fix:** `throw new Error("The server returned an unreadable response.")` after the HTML check.

### H-16 · Google sign-in can be permanently unavailable, and its promise can hang forever
**File:** `src/context/AuthContext.tsx:270-273` and `:340-354` · **Effort: M**

**(a)** The effect depends on `[handleCredentialResponse, GOOGLE_CLIENT_ID]`, and
`GOOGLE_CLIENT_ID` changes when `/auth/me` returns `googleClientId` (`:222`). The first run appends
the GSI script; the second finds `existing` truthy and calls `initialize()`, which returns early at
`:261` if `window.google` has not loaded — **without attaching an `onload`**. `isGoogleLoaded` stays
`false` forever and `initialize` is never called with the correct client id.

**(b)** `google.accounts.id.prompt(callback)` only rejects on `isNotDisplayed`/`isSkippedMoment`. Any
other dismissal leaves `pendingGoogle.current` set and the promise never settles — the caller's
spinner runs indefinitely.

**Fix:** attach the load handler whether or not the tag already exists; reject on a timeout.

## Security (H-17 – H-18)

### H-17 · The dev OCR proxy is an unauthenticated gateway to paid provider keys, reachable off-host
**File:** `vite.config.ts:164`, `:110-114`, `:494`, `:78-89`, `:340-344` · **Effort: S**

Four things compound: no session check (documented as deliberate at `:110-114`); no rate limit and
no origin check, because `functions/api/_middleware.ts` does not run under `vite dev`;
`host: '0.0.0.0'` at `:494` plus `--host 0.0.0.0` in `package.json:7`; and `allowedHosts: true`
whenever `REPL_ID` is set (`:78-80`), which disables Vite's Host-header check — the file names the
consequence itself at `:495-499` (DNS rebinding from any page the developer visits).

The proxy holds `HUNYUAN_API_KEY` and `OPENAI_API_KEY` and returns the vendor's error body to the
caller at `:340-344`. Anyone on the developer's network — or any website they browse — can spend the
account's OCR quota and read the results. Input validation in the proxy is otherwise good (mode
allowlist, content-type allowlist, data-URL prefix, `messages` refused).

**Fix:** bind to loopback by default; never set `allowedHosts: true` (read `REPLIT_DEV_DOMAIN` and
list it); add a shared-secret header from `.env`; reject non-loopback `remoteAddress` unless opted in.

### H-18 · Known-vulnerable dev toolchain: 1 critical, 1 high, 3 moderate
**File:** `package.json:34`, `pnpm-workspace.yaml` · **Effort: M**

| Package | Installed | Severity | Advisory | Fixed in |
|---|---|---|---|---|
| `vitest` | 2.1.9 | **critical** | GHSA-5xrq-8626-4rwp — arbitrary file read/execute when the UI server listens | ≥3.2.6 |
| `vite` | 5.4.21 | **high** | GHSA-fx2h-pf6j-xcff — `server.fs.deny` bypass | ≥6.4.3 |
| `vite` | 5.4.21 | moderate | GHSA-4w7w-66w2-5vf9 — path traversal in optimized-deps `.map` | ≥6.4.2 |
| `esbuild` (via vite) | ≤0.24.2 | moderate | GHSA-67mh-4wv8-2f99 — any website can request the dev server and read the response | ≥0.25.0 |
| `launch-editor` (via vite) | — | moderate | GHSA-v6wh-96g9-6wx3 — NTLMv2 disclosure (Windows) | vite ≥6.4.3 |

None ships to production. The esbuild advisory matters more than its rating suggests: it is what
makes H-17 exploitable from a web page rather than only the local network, and
`server.fs: { strict: true }` (`vite.config.ts:501`) is the control GHSA-fx2h-pf6j-xcff bypasses.
The vitest advisory is low-exploitability here — nothing runs `vitest --ui`.

**Fix:** `vitest` → ≥3.2.6 (patch-level for this project); `vite` 5 → 6.4.3, checking the three
`@replit/*` plugins and `@tailwindcss/vite` for peer ranges. Do not jump to vite 8 in one step.

## Architecture & maintainability (H-19 – H-21)

### H-19 · The OCR pipeline exists three times, and only two of them share code
**File:** `functions/api/ocr.ts:154-248` · `queue-worker/src/index.ts:227-273` · `vite.config.ts:125-370` · **Effort: L**

| Implementation | Lines | Imports from `server/` |
|---|---|---|
| `functions/api/ocr.ts` | 95 + 110 | `http`, `guard`, `rate-limit`, `openai-params`, `ocr-prompts` |
| `queue-worker/src/index.ts` | 47 + 40 | `openai-params`, `ocr-prompts`, `batches` |
| `vite.config.ts` (`devOcrProxy`) | 246 | **none** |

`server/openai-params.ts:23-30` explains why the model constants were extracted — "Both import from
here so the two cannot drift." That worked for the OpenAI names and was never done for Hunyuan, and
the dev proxy re-derives everything. **Every divergence in this report lives in this seam**: C-2, C-6,
C-7, H-1 through H-4, H-17. `vite.config.ts:122-123` even carries the warning "If you change the
upstream body here, change it in functions/api/ocr.ts in the same commit" — a comment doing a
compiler's job.

**Fix:** create `server/ocr-provider.ts` owning resolution + the call + the retry loop, returning a
discriminated union rather than a `Response` so each caller keeps its own transport. Deletes ~250 of
the ~390 duplicated lines and makes the drift unrepresentable. **This is the highest-leverage single
change in the report** — it closes seven findings.

### H-20 · The queue worker duplicates the whole parse-and-persist pipeline, minus the safeguards
**File:** `queue-worker/src/index.ts:142-224` vs `result.ts` + `src/lib/ocr-client.ts:381-562` · **Effort: M**

| Concern | Client path | Queue worker |
|---|---|---|
| JSON-block locator | `ocr-client.ts:396-428` | `:146-160` — same algorithm, retyped |
| `flattenExtraction` / `joinLabel` | `ocr-client.ts:307-360` | `:275-301` — **byte-identical copies** |
| Field dedup | `result.ts:70-84` | absent → C-6 |
| `DELETE` before insert | `result.ts:113-116` | absent → H-3 |
| Field count/length caps | `result.ts:26-28,66-68` | absent |
| Confidence scoring | `confidence-scorer.ts` | absent → C-7 |
| Meta-confidence stripping | `ocr-client.ts:290-305` | absent |

The two paths produce **different database contents for the same document**.

**Fix:** extract `server/extraction-parse.ts` (pure; inherits the existing `ocr-client.test.ts`
coverage for both callers) and `server/document-results.ts` (`normalizeFields` + `resultStatements`).
C-6, C-7 and H-3 then disappear as a side effect rather than as three separate fixes.

### H-21 · Circular import between the two largest client modules
**File:** `src/lib/api-client.ts:16` ⇄ `src/lib/ocr-client.ts:21` · **Effort: S**

`api-client` imports `processWithHunyuanOCR`; `ocr-client` imports `apiRequest`. It resolves today
through hoisting, but the cost is already visible: `batch-status.ts` had to be carved out as a
dependency-free file specifically to escape this graph (`:10-13`), and it is why `api-client.ts` has
zero tests at 1,095 lines.

**Fix:** move `apiRequest` / `apiFetch` / `ApiError` into `src/lib/http-client.ts` (depends only on
`api-paths`). Then `ocr-client → http-client` and `api-client → http-client, ocr-client`. Acyclic,
and `api-client` becomes testable. **Prerequisite for H-29.**

## Performance (H-22 – H-26)

### H-22 · One unindexed DB query per thumbnail — N+1 at the HTTP layer
**File:** `functions/api/storage/[[path]].ts:33-37` · missing index in `migrations/` · **Effort: S**

`WHERE user_id = ? AND object_path = ?` — the indexes on `documents` are `(batch_id, position)` and
`(user_id, content_hash)` (`migrations/0002_batches.sql:46-47`). **Nothing covers `object_path`.**

`AppHome` renders a thumbnail per batch row and the listing cap is 500, so one dashboard paint can
issue up to 500 `/api/storage/*` requests, each paying a `sessions ⋈ users` lookup, an unindexed
`documents` filter (up to 50,000 rows at the documented ceilings), and an R2 `get`. The same gap hits
`server/storage-sweep.ts:59-61` (a correlated `NOT EXISTS` per pending row) and `server/account.ts:172-177`.

**Fix:** add `idx_documents_object_path` and `idx_documents_user_object`. Then add `loading="lazy"` +
`IntersectionObserver` to the dashboard thumbnails to cut the request count.

### H-23 · The batch page re-downloads every document and every field every 3 seconds
**File:** `src/pages/BatchDetails.tsx:115-128` · **Effort: M**

`refetchInterval: 3000` on `useGetBatch`, which returns every document plus every field
(`server/batches.ts:209-286`). At the documented ceilings (100 documents × 300 fields × 8,000 chars)
that is a multi-megabyte payload re-assembled from two D1 queries every three seconds, plus a full
table reconciliation per tick. `ocr_text` is already excluded for exactly this reason (`:211-213`);
the fields were not. `AppHome.tsx:65-71` does the same at 4s against the 500-batch aggregate list.

**Fix:** add `functions/api/batches/[batchId]/status.ts` returning status + counts in one query; poll
that and invalidate the full read only when counts change. Add backoff (3s → 6s → 12s).

### H-24 · Extraction is strictly sequential — a 100-document batch can take hours
**File:** `src/lib/api-client.ts:457-529` (and `:637-702`) · **Effort: M**

Each iteration awaits one `/api/ocr` round trip with a 60s upstream timeout, and
`extractWithEscalation` can add a second full call (`:382-398`). Worst case ~120s per document; at
the 100-document cap that is up to 3.3 hours in one browser tab, and closing it abandons the rest.
`handleRetryAllFailed` is documented as sequential on purpose, but `createBatch` carries no such
note — and `RULES.ocr` allows 120/hour (`server/rate-limit.ts:38`).

**Fix:** bounded concurrency of 4 via a worker-pool loop, preserving per-document failure isolation.
Cuts the worst case to ~50 minutes at 4 in-flight against a 120/hour allowance.

### H-25 · The upload pipeline blocks the main thread three times per file
**File:** `src/lib/ocr-client.ts:115,118,134` · **Effort: M**

| Step | Cost |
|---|---|
| `fileToBase64` (`:222-275`) | synchronous `canvas.toDataURL` of up to 1500×1500px |
| `analyzeImageQuality` (`confidence-scorer.ts:44-99`) | `getImageData(200,200)` then **two** pixel loops; contrast builds a 40,000-element array and re-iterates it |
| `hashString` (`:53-57`) | `TextEncoder().encode()` over the **entire base64 data URL** — a ~19 MB string and a ~19 MB `Uint8Array` for a 14 MB PDF |

The tab freezes for hundreds of ms to seconds per file, and `hashString` momentarily doubles peak
memory for the largest accepted payload.

**Fix:** hash the `File` bytes, not the base64 string — or better, reuse the `contentHash` the upload
endpoint already computed and returned (`storage/upload.ts:135,174`), which the client is
re-deriving. Move the canvas work to `createImageBitmap` + `OffscreenCanvas`. Fuse the two pixel
loops with Welford's method.

### H-26 · The IndexedDB OCR cache grows without bound
**File:** `src/lib/ocr-client.ts:134,214` · **Effort: S**

Every extraction stores the full model response keyed by content hash × mode × tier. Nothing evicts
it; the only pruning is the schema-version sweep at `:44-50`, which fires once per prefix change. The
same document in 3 modes at 2 tiers occupies 6 entries. On `QuotaExceededError` the write is caught
and warned at `:216`, so the cache silently stops working with no visible signal.

**Fix:** an LRU index capped at ~200 entries, evicting on write; store `cachedAt` and drop entries
older than 30 days.

## Test coverage on critical paths (H-27 – H-30)

### H-27 · `result.ts` — the only path extracted data reaches the database — has no test
**File:** `functions/api/batches/[batchId]/documents/[documentId]/result.ts` · **Effort: S**

Untested and silent if wrong: field dedup (`:72-84`), the `MAX_FIELDS` cap (`:26,66-68`), the
DELETE-then-INSERT ordering (`:113-116`), and the three `overallConfidence` branches (`:99-104`) —
where a client sending `null` yields `0`, flagging a clean document.

**Fix:** the fake-D1 harness in `server/api-endpoints.test.ts` already fits.

### H-28 · `server/batches.ts` — 589 lines, no test file, holds an ownership boundary and a state machine
**File:** `server/batches.ts` · **Effort: M**

- **`invalidObjectPath` (`:439-451`)** — an ownership boundary whose own docstring explains it exists
  because "'the read path happens to reject it' is not the same as 'the row cannot be written'."
  Twelve lines, pure, no test. A regression lets users point document rows at other accounts' R2 keys
  with no visible failure.
- **`refreshBatchStatus` (`:292-313`)** — the five-state batch machine, called from six places. The
  `COUNT(*) = 0` arm must come first (because `SUM(status='failed') = COUNT(*)` is `NULL`, not `TRUE`,
  on an empty batch); nothing pins that ordering.
- **`insertDocuments` (`:475-568`)** — duplicate detection both cross-request and in-request, position
  assignment, `pending_uploads` claim, and the `last_row_id` mapping at `:564` that can yield `NaN`.
- **`getBatchDetail` (`:196-286`)** — depends on `MIN(d.position)` being present purely to pin two bare
  columns (`:132-137`). Removing that "unused" aggregate breaks thumbnails with no error.

### H-29 · Auth *primitives* are well tested; not one auth *endpoint* is
**File:** `functions/api/auth/*` (7 files) · **Effort: M**

`crypto.ts` (11 tests), `session.ts` (21), `google.ts` (13), `guard.ts` (5), `rate-limit.ts` (9) are
thorough. `server/api-endpoints.test.ts` covers only `/api/settings` and `POST /api/batches`.

Highest-risk of the seven: **`functions/api/auth/google.ts:90-125`**, account linking by email. If no
row matches `google_sub` it falls back to matching by email and links the Google identity to that
password account. `users.google_sub` is `UNIQUE` (`migrations/0001_auth.sql:18`), so
`SET google_sub = COALESCE(google_sub, ?)` throws when that sub is already on another account — and
the error is **caught and swallowed** at `:123-125`, with a session issued anyway at `:127`.

Also untested: `login.ts:74-104` (the two `dummyVerify` branches that prevent account enumeration, and
the rule that a failed rehash must not block a login — remove a `dummyVerify` call and every test
still passes because the response body is identical); `password-reset-confirm.ts:68-118` (the ordering
of token consumption, session revocation and re-issue); `signup.ts:70-85` (the `String(error).includes('UNIQUE')`
race mapping).

**Also: `server/http.ts` has no test file** and holds every input gate — and `isPlausibleEmail`
(`:103-109`) is provably wrong (see M-2). Twelve pure assertions, ~20 minutes. **Best value per minute
in the repo.**

### H-30 · No CI — nothing runs the tests, typechecks, or the audit
**File:** absent (`.github/`, `.gitlab-ci.yml`, `.circleci/`, `Jenkinsfile` all missing) · **Effort: S**

218 tests pass and both typechecks are clean *right now*; nothing enforces it. Combined with C-4
(unpinned wrangler) and M-14 (queue worker outside `typecheck:all`), the gates that exist are opt-in
and the least-safe file is outside all of them.

**Fix:** a workflow running `pnpm install --frozen-lockfile`, `typecheck:all`, `test`, `build`, and
`pnpm audit --audit-level high` on push and PR.

### H-31 · A test that passes while the bug ships
**File:** `src/lib/ocr-client.test.ts:52-66` · **Effort: S**

The table-mode test asserts `fields` **names** and `rows` **values**. But `createBatch` posts only
`fields` to `/result` (`api-client.ts:501-506`) — `rows` is never persisted. The test verifies the
half of the return value that is discarded, which is why H-5 shipped.

**Fix:** add `expect(result.fields.map(f => f.value))`. One line.

---

# MEDIUM

## Security hardening

| # | File:line | Issue | Fix | Effort |
|---|---|---|---|---|
| **M-1** | `functions/api/auth/password-reset.ts:86` → `analytics-consent.tsx:80` → `ResetPassword.tsx:34-35` | The live reset token is in the URL query string. For a visitor who accepted analytics, `gtag("config", ...)` fires a page_view whose `page_location` is the full URL — **the token is sent to Google Analytics**. Not blocked by `Referrer-Policy` (it travels in the measurement payload, not `Referer`). The token also stays in history for its full one-hour TTL. | Deliver the token in the URL **fragment** (`#token=`), which is never sent to servers and is excluded from `page_location`. Or `send_page_view: false` plus a `history.replaceState` strip before analytics can fire. | S |
| **M-2** | `server/http.ts:95-109` | `isPlausibleEmail` accepts CR/LF. Verified: `"a@b.com\nBcc:x.y"` → ACCEPTED. Those values reach mail headers (`contact.ts:88` `replyTo`, `password-reset.ts:106` `to_email`). `contact.ts:41-48` defines `cleanHeaderText` because "a newline starts a new header" and applies it to `subject` but not `email`. Exploitability is transport-dependent and currently low (EmailJS JSON-encodes), but a newline-bearing address also passes signup and is stored in `users.email`. | Strip control characters in `normalizeEmail`; reject any whitespace in `isPlausibleEmail`. | S |
| **M-3** | `functions/api/storage/upload.ts:116-122` | Content type is taken from the client's multipart header with no magic-byte check, so arbitrary bytes can be labelled `image/png` — and the per-type size cap becomes chooseable. Largely mitigated: the read endpoint sets `default-src 'none'; sandbox` and `nosniff` (`[[path]].ts:53-55`), so stored HTML/SVG cannot execute in the origin. | Sniff the first 12 bytes, require agreement with the declared type, store the sniffed value, and apply the cap after sniffing. | S |
| **M-4** | `server/rate-limit.ts:154,172-182` | On D1 failure the limiter falls back to a per-isolate counter, so the effective limit is `configured × warm isolates` on the endpoints where it is load-bearing (600k PBKDF2 iterations per login; real money on `/api/ocr`). Separately `!env.DB` short-circuits to **no limit at all**, which is a misconfiguration rather than an outage. The tradeoff is documented at `:84-98` and the reasoning is sound. | Fail closed (503) on a missing binding. For the outage path, divide the limit by an assumed isolate count, or move to a Durable Object. | M |
| **M-5** | `functions/api/auth/password-reset-confirm.ts:68-86` | Token consumption is not atomic — the `used_at` check and the `UPDATE` are separate statements with the password write between them, outside a transaction. Concurrent requests both pass; and if the second `UPDATE` fails, `:89` returns 500 *after* the password changed, leaving a live token. | Claim the token conditionally first: `UPDATE ... SET used_at = datetime('now') WHERE token_hash = ? AND used_at IS NULL AND expires_at > datetime('now')`, treating `meta.changes === 0` as invalid. | S |
| **M-6** | `functions/api/ocr.ts:285-381` | The rate limit is enforced *after* reading up to 20 MB (`:292`), `JSON.parse`ing it (`:304`), and resolving the provider (`:368`). A caller already over quota still costs a 20 MB body read plus two more 20 MB copies against a 128 MB isolate. | Move `enforceRateLimit` to immediately after `requireSession` (`:272`), before `request.arrayBuffer()`. | S |
| **M-7** | 16 of 27 endpoint files | No `enforceRateLimit` on any `batches/*` write path, `templates/index.ts` POST, `settings.ts` PATCH, or `review-queue.ts`. `result.ts` is the notable one: up to 300 fields × 8,000 chars plus 200,000 chars of `ocrText` (~2.6 MB of writes) per unthrottled call. Meanwhile `templates/[templateId].ts` POST (increment an integer) *is* limited at 60/min. There is no stated rule for which routes carry limits. | State the rule in `server/rate-limit.ts`; add the missing entries to `RULES`; add a test enumerating `functions/api/**` and asserting every file exporting `onRequestPost` / `onRequestPatch` / `onRequestDelete` references `enforceRateLimit`. | M |
| **M-8** | `public/_headers:56` | `Cross-Origin-Opener-Policy: unsafe-none` opts out of cross-origin isolation, keeping `window.opener` reachable. Presumably needed for the GSI popup, but it is the one weakening in that file with no reason annotated. | Try `same-origin-allow-popups`. If GSI genuinely needs `unsafe-none`, document why — the file's convention is that every weakening carries its reason. | S |

## Correctness

| # | File:line | Issue | Fix | Effort |
|---|---|---|---|---|
| **M-9** | `functions/api/batches/[batchId]/documents/index.ts:75-92`; `functions/api/templates/index.ts:80-95` | Time-of-check/time-of-use on both caps: `getBatchCapacity` then `insertDocuments`, and `COUNT(*)` then `INSERT`. Concurrent requests can each pass and exceed `MAX_DOCUMENTS_PER_BATCH` / `MAX_TEMPLATES`. | Conditional insert (`INSERT ... SELECT ... WHERE (SELECT COUNT(*) ...) < cap`) checking `meta.changes`. | S |
| **M-10** | `functions/api/.../result.ts:99-104` | `body.overallConfidence === undefined ? average(fields) : clampConfidence(...)`. A client sending `null` yields `0`, flagging a clean document into the review queue. | Treat `null` like `undefined`, or reject it explicitly. | S |
| **M-11** | `functions/api/storage/[[path]].ts:45,58-59` | `onlyIf: request.headers` hands R2 the whole header set, so it evaluates `If-Match`/`If-Unmodified-Since` too — but every body-less result is reported as **304**, where a failed `If-Match` must be **412**. Edge case: browsers don't send `If-Match` on GET. | Pass only the cache-validation headers, or distinguish the two cases before choosing a status. | S |
| **M-12** | `server/batches.ts:564` | `Number(results[index]?.meta.last_row_id)` yields `NaN` if a statement result is missing, propagating `NaN` document ids to the client (serialised as `null`), which then 400 on every follow-up call with a confusing message. | Validate and throw: `if (!Number.isInteger(id) \|\| id <= 0) throw new Error('Document insert returned no row id.')`. | S |
| **M-13** | `src/lib/confidence-scorer.ts:380-397` | Whole-page text is scored with per-field gibberish heuristics. `/(.)\1{4,}/` fires on any `-----` separator line (near-universal on receipts) for `-0.5`; `specialRatio > 0.3` fires on currency-dense documents. With no model signal (the default Hunyuan tier has no logprobs) the renormalised score drops to ~0.75–0.81 against a 0.8 threshold, so clean transcriptions are routed to review for containing a horizontal rule. | Scale thresholds by length, or skip the repetition/special-character checks above a few hundred characters and rely on entropy alone. | M |
| **M-14** | `src/lib/confidence-scorer.ts:558-575,594-621` | `findFieldValue` tokenizes on non-alphanumerics, so a field named `Sub Total` yields `['sub','total']` and **satisfies `includes('total')`**. Iterating in document order, `findFieldValue(fields, ['total', ...])` can return the subtotal as the total, producing a false "difference of X" warning on a correct invoice. Related: the multi-word candidates `'amount due'`, `'grand total'`, `'unit price'`, `'line total'` can never match via tokens and are largely dead. | Exclude fields already bound to another role; match multi-word candidates against the joined token string. | S |
| **M-15** | `src/lib/confidence-scorer.ts:252` | `/^\d{1,3}(?:[, ]\d{3})*.../` requires exactly three-digit groups, so `1,00,000` fails and scores 0.3 with "Invalid numeric / currency structure" — while `CURRENCY_MARKERS` deliberately includes `pkr`, `inr`, `rs.`, `₨`, `₹`. | Add an alternative for two-digit groups: `/^\d{1,3}(?:,\d{2})*,\d{3}(?:\.\d{1,3})?$/`. | S |
| **M-16** | `functions/api/templates/index.ts:72-77`; `[templateId].ts:63-68` | `.join(',').slice(0, MAX_EXPECTED_FIELDS_LENGTH)` caps the *joined* string, so the last field name can be severed mid-word; `server/templates.ts:52-53` then splits on `,` and returns the fragment as a field name. | Accumulate whole entries and stop before exceeding the limit. | S |
| **M-17** | `src/hooks/use-review-hotkeys.ts:92-107` | `case "a": case "A":` handles both, but `"e"`, `"r"`, `"j"`, `"k"` are lowercase-only — with Caps Lock on, Save Edit / Reject / navigation stop working while Approve keeps working. Separately, `case "Escape"` calls `preventDefault()` and `onBack()` whenever no text input is focused, including while a Radix dialog is open, so Escape both closes the dialog and navigates away. | Normalise with `e.key.toLowerCase()` and branch on `e.shiftKey`; guard Escape with an open-dialog check. | S |
| **M-18** | `src/lib/use-page-title.ts:13-18` | `DEFAULT_DESCRIPTION` is captured at module load from `meta[name="description"]`. `scripts/prerender-public.mjs` writes a **route-specific** description into each static HTML file, so on a cold load of `/terms` the fallback *is* the terms description — and any later route with no `description` serves it. That is the bug the comment claims to fix, reintroduced by prerendering. | Hardcode the canonical site description as the fallback, or read it from a dedicated meta tag prerendering leaves alone. | S |
| **M-19** | `src/lib/xlsx-writer.ts:309-318`; `src/lib/api-client.ts:976-985` | Both revoke the blob URL synchronously in the same task as `link.click()`. Several browsers have not started fetching yet, and the download silently does nothing. | `setTimeout(() => URL.revokeObjectURL(url), 1000)`. | S |
| **M-20** | `src/lib/ocr-client.ts:258-264` | The canvas fallback sets only `reader.onload`, unlike the PDF branch at `:226-230`. If the read fails the promise never settles and extraction hangs with no error. `img.onerror` at `:272` also skips `URL.revokeObjectURL`, leaking an object URL per failed decode. | Add `reader.onerror = reject`; revoke the URL in both handlers. | S |
| **M-21** | `src/hooks/use-toast.ts:5,170-178` | The subscription effect's dependency is `[state]` rather than `[]`, so the listener is torn down and re-registered on every toast change. `TOAST_REMOVE_DELAY = 1000000` (~16.7 min) keeps dismissed toasts and their `setTimeout` handles alive that long. Also a re-render fan-out problem: `dispatch` calls `setState` on **every** `useToast` consumer (10 components), so one toast re-renders `BatchDetails`' 50-row table, `Navbar` and `Toaster`. | Dep → `[]`; delay → ~5000ms; components that only *emit* should import the standalone `toast` (already exported at `:187`) instead of calling `useToast()`. | S |
| **M-22** | `queue-worker/src/index.ts:143,183-190` | `data.choices?.[0]?.message?.content \|\| ""` — an empty response falls into the JSON-parse `catch` and stores a `Full Text Transcription` field with an empty value, marking the document `'completed'`. | Treat empty content as a failure. | S |
| **M-23** | `functions/api/batches/index.ts:119-137`; `documents/index.ts:94-111` | The `sendBatch` chunk loop is inside one `try`. If chunk 1 succeeds and chunk 2 throws, `asyncProcessing` stays `false` and only a log records it — so the client extracts client-side while the first 100 documents are already enqueued. Double provider spend and colliding writes. | Track `sent`; set `asyncProcessing = (sent === messages.length)`; fail the request on a partial send. | S |

## Performance

| # | File:line | Issue | Fix | Effort |
|---|---|---|---|---|
| **M-24** | `server/batches.ts:292-313` | `refreshBatchStatus` is a full aggregate over the batch's documents, called **twice per document** in the queue worker (`:68` and `:223`) plus once per result/failure/retry/delete. A 100-document batch issues ~200 aggregate UPDATEs scanning up to 100 rows each — ~20,000 rows of redundant work to maintain one derived column. | Drop the pre-processing call at `:68`; debounce to once per queue *batch* rather than per message. | S |
| **M-25** | `server/account.ts:51-127` | Six queries, four capped at 5,000 rows, including `documents` **with `ocr_text`** (`:76-77`) — the largest column — grouped into nested objects and `JSON.stringify`'d into one response. At 200 KB of text per document that is well past a 128 MB isolate. | Stream via `TransformStream`, paging each table; or exclude `ocr_text` behind an `?includeText=1` flag. | M |
| **M-26** | `src/lib/xlsx-writer.ts:70-76,84-163` | CRC-32 is byte-at-a-time and `buildZip` concatenates everything into one buffer, synchronously on the UI thread, called straight from click handlers (`BatchDetails.tsx:333`, `AppHome.tsx:222`). A multi-thousand-row export freezes the tab. | Move to a Web Worker — the module is dependency-free, so it ports as-is. | S |
| **M-27** | `server/http.ts:59-65` | `SECURITY_HEADERS` applies `Cache-Control: no-store` to **all** `json()` responses. The comment scopes the intent to auth, but the constant is shared, so no read endpoint supports browser caching or `304` revalidation. | Keep `no-store` for `/api/auth/*` and `/api/account/*`; let read endpoints opt into `private, max-age=0, must-revalidate` + an ETag from `batches.updated_at`. `storage/[[path]].ts:45-59` already implements this pattern. | M |
| **M-28** | `package.json:60`, `vite.config.ts:437` | `localforage` is 32 KB raw for one consumer (the OCR cache). Its value is a driver fallback chain including WebSQL, which no current browser has — and the cached values are megabyte-scale strings localStorage could never hold. | Replace with ~30 lines of direct IndexedDB, or the Cache API (which gives eviction for free). Drop the dependency and its `optimizeDeps` entry. | M |
| **M-29** | `src/lib/ocr-client.ts:44-50` | A bare `localforage.keys().then(...)` at module scope enumerates **every** key in the store on each import, to find non-`v5_` ones. Pure cost on every cold load after the one-time migration. | Guard with a stored `ocr_cache_schema` marker so it runs once ever. | S |
| **M-30** | `src/pages/AppHome.tsx:172-185` | `fetchSelected` chunks `getBatch` in groups of 3, each returning all documents and all fields. Selecting 100 batches is 34 sequential round trips, all held in memory simultaneously for `buildExport`. | A server-side multi-batch export streaming CSV from one query. Short of that, raise the chunk size to ~8. | M |
| **M-31** | `src/App.tsx:8,12,13` and `:5` | First paint is **523 KB raw / 146 KB gzipped** across 12 files (measured). `App.tsx:17-21` states the intent — "Kept out of the entry chunk so a landing-page visit no longer downloads the sidebar shell" — but eager imports of `Navbar` (pulls dropdown-menu + avatar + menu), `Toaster` (radix-toast) and `TooltipProvider` (radix-tooltip) defeat it, and `QueryClientProvider` pulls 41 KB of TanStack Query onto a page that issues no queries. ~31 KB gzipped (**21% of first paint**) for UI a marketing visitor never sees. | `lazy()` the three chrome components; push `QueryClientProvider` down inside `AppRoutes` (`AuthProvider` uses raw `fetch`, not React Query, so it can stay above). | M |
| **M-32** | `index.html:158` | The font request includes `ital,wght@0,300..800;1,300..800` — the italic axis, roughly doubling the Plus Jakarta Sans download. `grep -rn "italic" src/` returns nothing outside `not-italic`. Loading is otherwise well done (preconnect, direct `<link>` not `@import`, `display=swap`). | Drop to `family=Plus+Jakarta+Sans:wght@300..800`. | S |
| **M-33** | `public/android-chrome-512x512.png` | 191 KB for a 512×512 icon (should be under 30 KB); `apple-touch-icon.png` 37 KB, `favicon.ico` 16 KB. Referenced from `site.webmanifest`, so installs fetch it. | `oxipng -o4` / `pngquant`, or ship a WebP alongside. | S |

## Maintainability & config

| # | File:line | Issue | Fix | Effort |
|---|---|---|---|---|
| **M-34** | `src/pages/BatchDetails.tsx` | 1,087 lines, 152 branches, nine responsibilities: paged table, inline editing, row selection, bulk delete, bulk export, five export formats, single retry, retry-all, resume-stalled, upload-more, side panel. 19 of the repo's 120 changelog comments are here — it is where change concentrates and the hardest file to change safely. All editing state is page-level, which is also why every keystroke re-renders the whole table. | Extract along the seams already marked by comment blocks: `BatchTable.tsx` (with a memoised `EditableCell`), `useBatchExport.ts`, `useBatchRetry.ts`, `useRowSelection.ts`. `useBatchExport` is highest value — `buildExportData` (`:234-251`) and `AppHome`'s `buildExport` (`:187-207`) already disagree on header formatting. | L |
| **M-35** | `src/lib/api-client.ts` | 1,095 lines across seven domains (transport, query keys, read hooks, batch orchestration, document mutations, storage, settings, account, templates). Imported by 11 modules, so it is the likeliest merge-conflict site, and it has zero tests. | Split into `src/lib/api/{http,keys,batches,documents,account,templates}.ts` with an `index.ts` re-export so no caller changes. Do H-21 first. | M |
| **M-36** | `src/lib/ocr-client.ts:381-562` | `parseOCRResult` is ~180 lines: one `try` spanning 140 lines with three mutually exclusive output shapes plus a `catch` building a fourth. Two of the three data-loss bugs found (H-5, H-6) were here, precisely because the branches are interleaved in one scope. The `catch` also does double duty — "the model returned plain text" (the *expected* path for `fulltext`) and "parsing genuinely failed". | One function per shape (`parseFullText` / `parseTable` / `parseKeyValue`) behind an explicit `locateJsonBlock` + mode dispatch. Each becomes independently testable. | M |
| **M-37** | `src/lib/confidence-scorer.ts` | 674 lines, 131 branches (highest density in the repo at 0.19), two unrelated concerns: per-field scoring (`:31-482`) and cross-field arithmetic (`:484-656`, one caller). `calculateFieldConfidence` (`:260-457`) is ~200 lines with a 7-arm switch nested inside an if/else chain, then four sequential mutations of `qualityScore`. | Split the file; extract `scorePattern`, `scoreTextQuality` and `blend` as pure functions. `blend` especially — the renormalisation when `model === null` is the subtlest logic in the file and is only observable today through the whole pipeline. | M |
| **M-38** | `functions/api/templates/[templateId].ts:31,97,125`; `BatchDetails.tsx:104`, `DocumentDetails.tsx:76-77`, `ReviewQueueDetail.tsx:82` | Path params are parsed three ways. `server/guard.ts:47-51` provides the tested `intParam`, used correctly in 10 endpoint files — but `templates/[templateId].ts` uses raw `Number()` with a hand-rolled check **repeated three times in one file**, and three pages use `parseInt(...) : 0`, which yields `NaN`. That is the direct cause of H-13. | Use `intParam` in the templates endpoint; add a client `routeId()` returning `number \| null` next to `api-paths.ts`. | S |
| **M-39** | `server/ocr-prompts.ts:20`, `functions/api/batches/index.ts:16`, `server/templates.ts:15`, `src/components/UploadModal.tsx:45` — and six declarations of `0.8` | The same nine mode strings are declared **four times**, with "Must match…" comments at `ocr-prompts.ts:19,41-44` pointing at the copies. The confidence default `0.8` is declared six times plus the schema default, and `api-client.ts:308` comments "Mirrors the fallback in src/pages/BatchDetails.tsx" — a mirror of a mirror. Adding a tenth mode means four coordinated edits. | Import `isOcrMode`/`OCR_MODES` everywhere; derive `PRESETS` from `OCR_MODES` with a `Record<OcrMode, …>` label map so a missing label becomes a **compile error**. One threshold module, plus a test asserting it equals the migration default. | M |
| **M-40** | 9 helpers across module boundaries | `flattenExtraction`/`joinLabel` (identical copies in `ocr-client.ts` + `queue-worker`), `resolveProvider` (×2), `megabytes`/`maxBytesFor` (`upload-limits.ts` + `storage/upload.ts`), `expiryIso` (`session.ts:50` + `password-reset.ts:21`), `sha256Hex` (`crypto.ts:64` string + `storage/upload.ts:56` ArrayBuffer), `intQuery` (×2), `escapeHtml` (×2). Two have already caused bugs: the `intQuery` copies diverged (H-11), and the size caps are the "keep three files in sync" invariant `upload-limits.ts:25-27` warns about in prose. | `expiryIso` → `server/time.ts`; `intQuery` → `server/guard.ts` with the clamp built in; size caps → one `server/upload-limits.ts` the client re-exports; `sha256Hex` → one overload. The `.mjs` copy of `escapeHtml` can stay. | M |
| **M-41** | `tsconfig.server.json:23`; `queue-worker/tsconfig.json` | The queue worker escapes every gate: not in `typecheck:all`; its own tsconfig omits `noUnusedLocals`/`noUnusedParameters` (which both other configs set with a comment explaining they substitute for the absent linter — proof it matters: `capabilitiesFor` and `usedTokens` are imported at `:1` and never used); 5 `any`s including `first<any>()` on the row driving the whole function; pins `typescript@^5` and `@cloudflare/workers-types@^4` against the root's `^7`/`^5`; no tests. | Add `typecheck:worker` and chain it into `typecheck:all`; copy the two `noUnused*` flags; type the D1 row; move to the catalog (C-4). | S |
| **M-42** | `wrangler.toml:25` vs `queue-worker/wrangler.toml:3` | `compatibility_date` is `2026-08-01` and `2024-03-20` — **2.5 years apart** — while `server/openai-params.ts`, `ocr-prompts.ts` and `batches.ts` execute under both. Compatibility dates gate real behavioural changes (streams, `Request`/`Response` details, global exposure). The worker also declares no `compatibility_flags`, an undocumented constraint. | Set both to the same date; add a comment in each saying they move together; re-run tests after any bump. | S |
| **M-43** | `wrangler.toml:60-77` | No `EMAIL` binding is declared, so `functions/api/contact.ts:75-80` returns 503 in production — always. `Contact.tsx:83` treats 503 as "not configured" and falls back to browser EmailJS, so the form works, but the *server* path (HTML escaping, CR/LF stripping, 5/hour/IP) is dead and every real submission goes through the unthrottled browser path. | Same root cause as C-1 — resolve together. Add an email binding or call EmailJS server-side with a private key (the pattern `password-reset.ts:94-114` already uses), then delete the browser fallback. | M |
| **M-44** | `.env.example`, `.dev.vars.example`, `src/vite-env.d.ts` | Documented but never read: `VITE_APP_API_BASE_URL`, `VITE_UPLOAD_API_URL` (0 references in `src/`) — leftovers from before same-origin `apiUrl()`, and `.env.example` still annotates the second one's behaviour. Read but never documented: `OCR_API_KEY` (the legacy fallback the current deployment's key actually lives under, per `server/http.ts:26-30`), `EMAILJS_SERVICE_ID`, `EMAILJS_TEMPLATE_ID`, `EMAILJS_PWD_TEMPLATE_ID`, `VITE_EMAILJS_PWD_TEMPLATE_ID`, `DEV_ALLOWED_HOSTS`. `vite-env.d.ts` declares only three of the four `VITE_EMAILJS_*`. **Consequence:** an environment set up from `.dev.vars.example` gets no OpenAI key at all. | Delete the two dead entries, add the six missing ones, add the fourth to `vite-env.d.ts`. Add a test enumerating `env.X` reads and asserting each appears in `.dev.vars.example`. | S |
| **M-45** | `server/http.ts:9-57` | No environment validation anywhere. Every `AppEnv` field except `DB` and `DOCUMENTS` is optional, each checked at the moment it is needed and reported as a generic 503. A deploy missing `GOOGLE_CLIENT_ID` looks healthy until a user clicks "Continue with Google". Nothing states which combinations constitute a working deployment. Related: local `.env` sets `OCR_API_URL`/`OCR_MODEL`/`OCR_MODEL_ESCALATION` — **no code reads them** (the code reads `OPENAI_BASE_URL`/`OPENAI_MODEL`) — and `OCR_API_KEY` is empty, so the escalation tier silently 503s in dev and that whole path is untested locally. | One `server/env-check.ts` returning `{ok, missing, degraded}`, called from `_middleware.ts` and cached per isolate. The `missing` vs `degraded` distinction is what the per-call 503s cannot express. Rename the stale local keys and warn on obsolete names. | S |
| **M-46** | `package.json:24-37`, `pnpm-workspace.yaml` | Build tooling is 2–3 majors behind: `vite` 5.4.21 → 8.2.2, `vitest` 2.1.9 → 4.1.11, `@vitejs/plugin-react` 4.7.0 → 6.1.1, `@types/node` 20.19.43 → **26.4.0** (6 majors) — while `typescript` is at **7.0.2**. Both typechecks pass, so nothing is broken, but that is an unusual set of eras to hold together and each plugin upgrade needs the others moved. `queue-worker` additionally pins `typescript@^5` — **two TS majors in one repo**. | `@types/node` first (match deployed Node), then `vite` 5→6 (clears H-18's high advisory), then the React plugin, then `vitest` 2→3.2.6. Consolidate `typescript` into the catalog. | M |
| **M-47** | `package.json:39-73` | Runtime majors available: `lucide-react` 0.453.0 → **1.38.0** (still on a `0.x` line, so `^0.453.0` can pull a breaking icon rename on any install, with no CI to catch it); `tailwind-merge` 2.6.1 → 3.6.0 (v3 changed the `extendTailwindMerge` shape — `src/lib/utils.ts:5-13` extends `font-size` for ten custom tokens, and commit `7d031f7` "Fix tailwind-merge stripping button text colors" shows this config is already fragile); `date-fns` 3.6.0 → 4.4.0 (2 call sites). Also `@cloudflare/workers-types` 5.20260814.1 is dated **after** `compatibility_date = 2026-08-01` — the types describe a runtime newer than the pin. | Pin `lucide-react` exactly until 1.x. Defer `tailwind-merge` v3 and `date-fns` v4 until CI exists, then one at a time with `src/lib/utils.test.ts` as the guard. Bump workers-types and `compatibility_date` together. | M |

---

# LOW

| # | File:line | Issue | Fix | Effort |
|---|---|---|---|---|
| **L-1** | `src/lib/review-queue-store.ts:304` | `markBatchReviewed` has **zero callers** — the only genuinely dead export in the codebase. `ReviewQueue.tsx` has a per-document "Approve fields" button and no batch-level equivalent, so wiring it up is plausibly the intent. | Delete or wire up. | S |
| **L-2** | `src/hooks/use-toast.ts:70` | `reducer` is exported but used only internally at `:130`, and no test imports it. | Drop the `export`. | S |
| **L-3** | 15 non-test sites | `any` concentrated in two causes: `docsById`/`fieldsByDoc` typed `Map<number, any>` (`BatchDetails.tsx:205,211`) despite `Document`/`ExtractedField` being imported in the same file; and `window.google` having no declaration, so every GSI call site casts (`GoogleAuthCard.tsx:117,128,139`, `AuthContext.tsx`). | Type the two maps; add `src/types/google-gsi.d.ts` for the narrow slice used. Removes 6 of 15 and makes H-16's race visible to the compiler. | S |
| **L-4** | `src/hooks/use-mobile.tsx:6,20` | State starts `undefined` and the return is `!!isMobile`, so the first render always reports desktop; the real value arrives in an effect. `AppLayout` branches on it, so mobile users get a desktop-rail render then a re-render and reflow. | `useState(() => typeof window !== 'undefined' && window.innerWidth < MOBILE_BREAKPOINT)`. | S |
| **L-5** | `src/pages/ReviewQueueDetail.tsx:428-431` | `fieldCardRefs` is a `Map` keyed by array index; entries for indices that no longer exist are never removed when `flaggedFields` shrinks. | Key by `normalizedField`, or clear the map when the document changes. | S |
| **L-6** | `src/pages/Settings.tsx:142-146,168-172` | Two separate `useEffect`s each call `getConfidenceThreshold()` on mount — one for display state, one for `savedThreshold.current`. `src/hooks/use-confidence-threshold.ts:4-15` exists specifically to collapse this pattern, and Settings is the page that still does it twice. The two responses can also interleave with a slider drag, leaving `savedThreshold.current` stale so a failed save rolls back to the wrong value. Also duplicates the `0.8` literal at `:50,165`. | Read from `useConfidenceThreshold()`; seed `savedThreshold` from it. | S |
| **L-7** | `src/pages/ReviewQueue.tsx:186-256` | Dead branch: `pendingItems = items.filter(isAwaitingReview)`, so `pendingInDoc === 0` is never true and the `isFullyReviewed` styling, "Fully Verified" badge and `disabled={isFullyReviewed}` inside this map are unreachable. | Delete, so the two lists' responsibilities stay legible. | S |
| **L-8** | `src/pages/AppHome.tsx:202` | `r[c.replace(/_/g, " ")] = ...` — two distinct columns `total_due` and `total due` collide into one key, silently dropping data. Also inconsistent with `BatchDetails.tsx:247`, which uses `humanizeFieldLabel(col)`, so the two export paths produce different headers for the same batch. | Use `humanizeFieldLabel` in both; de-duplicate collisions with a suffix. | S |
| **L-9** | `src/pages/AppHome.tsx:113,299-303` | `allSelected` compares only `size`, so a filter change can show "Deselect all" for a non-matching selection. The fourth stat card shows "In Flight" when `running > 0`, else "Failed" — so when both are non-zero the failed count is invisible in the stat row. | Compare membership; show both counts. | S |
| **L-10** | `src/pages/BatchDetails.tsx:220-227` | `currentPage` clamps `page` for render but the state is not reset, so deleting documents can leave `page` stale and the Next/Prev handlers operate on the unclamped value. | Reset `page` when `filteredRows.length` shrinks below the current offset. | S |
| **L-11** | `src/lib/humanizeField.ts` | The only camelCase filename in a directory of kebab-case (`humanize-error.ts`, `use-page-title.ts`, `upload-limits.ts`, `batch-status.ts`), and it exports `humanizeFieldLabel`. | Rename to `humanize-field.ts`. | S |
| **L-12** | `src/lib/ocr-client.ts:107,60` | `processWithHunyuanOCR` names a vendor in the public API of a function that dispatches to Hunyuan *or* OpenAI depending on tier and configuration; `HunyuanOCRResponse` is the shape of *our parsed result*, not of Hunyuan's response. | `extractDocument` and `ExtractionResult`. | S |
| **L-13** | `src/components/` | Three naming conventions at the same level: kebab-case (`error-boundary.tsx`, `theme-toggle.tsx`, `analytics-consent.tsx`) and PascalCase (`UploadModal.tsx`, `StatusBadge.tsx`, `ConfidenceIndicator.tsx`), with barrels in `app/` and `marketing/` but not for the eight top-level files. | PascalCase for components (matching the majority and `components.json`'s shadcn convention); add a top-level barrel. | S |
| **L-14** | `src/lib/batch-stall.test.ts` | Covers `batch-status.ts`. The filename mismatch defeats the colocation convention `vitest.config.ts:11-17` depends on — the config was changed specifically so "a test file next to the code it covers" is discovered. | Rename to `batch-status.test.ts`. | S |
| **L-15** | `assest/` (16 files, tracked) | Misspelled directory holding 2.8 MB: `logo.jpeg` at **1.9 MB**, `logo.png` at 546 KB, and two favicon sets of which `withouttext/` duplicates `public/` byte-for-byte. Not under `public/`, so none ships — but it is over a quarter of the 11 MB `.git`, and every clone and CI checkout pays for it. | Keep one master logo (SVG if available), delete the duplicate favicon set, spell it `assets/`. Removing from `HEAD` won't shrink history — `git filter-repo` if clone size matters. | S |
| **L-16** | `test.js`, `test.mjs` (untracked, repo root) | Leftover `tailwind-merge` probes from commit `7d031f7`. | Delete, or move under `scripts/`. | S |
| **L-17** | `src/lib/batch-status.ts:4-5`; `server/batches.ts:56-58` | Both state "Extraction runs in the browser tab — there is no worker and no queue." A queue worker is deployed. A comment that confidently describes the wrong architecture is worse than no comment. Part of a broader pattern: **120 changelog-style comments** (`FIX:`, "used to", "The previous version"), concentrated in `BatchDetails.tsx` (19), `DocumentDetails.tsx` (9), `AppHome.tsx` (9). The comment quality in this repo is otherwise a genuine strength — `public/_headers` is 82% comment, `_middleware.ts` 50%, `rate-limit.ts` 45%, all explaining *why* with the failure mode named — and worth protecting. The liability is specifically the "what it used to be" subset, which ages into confusion and, in these two cases, is already false. | Fix these two now. For the rest: where the old behaviour was a bug, the durable form is a test name (an assertion cannot rot); where still explanatory, rewrite in the present tense. | M |
| **L-18** | `functions/api/auth/me.ts:26,33` | Returns `GOOGLE_CLIENT_ID` to unauthenticated callers. Public by design (it is in every page's GSI call), so not a leak — noted only because it is an unauthenticated config-disclosure endpoint. | Keep it to genuinely public values; never add server config to that object. | S |
| **L-19** | `wrangler.toml:34`, `queue-worker/wrangler.toml:12` | `database_id` committed. A resource identifier, not a credential (access needs an account API token). Standard for wrangler configs. | No action; awareness only. | S |
| **L-20** | `functions/api/_middleware.ts:27,52-70` | The CSRF check exempts requests carrying neither `Sec-Fetch-Site` nor `Origin` — deliberate and correctly reasoned at `:44-49` (CSRF requires a browser; a browser sends at least one). Combined with `SameSite=Lax` this is adequate. `MUTATING_METHODS` covers only POST/PUT/PATCH/DELETE, so revisit if a state-changing GET is ever added. | Accepted risk; document the GET caveat. | S |
| **L-21** | `functions/api/storage/[[path]].ts:52` | `Cache-Control: private, max-age=3600` correctly excludes shared caches, but extracted source documents (invoices, receipts) persist in the local browser cache after sign-out — relevant on a shared machine. | `private, no-cache, max-age=0, must-revalidate`, relying on the ETag/304 path already implemented at `:45-59`. | S |

---

# Appendix A — Verified clean

Recorded so these are not "fixed" again, and so the audit trail shows they were checked.

**No SQL injection.** Every statement across `server/`, `functions/` and `queue-worker/` uses
`.prepare().bind()`. Every template interpolation inside a SQL string was traced: generated `?`
placeholder lists (`batches.ts:497,550`, `account.ts:171`, `storage-sweep.ts:87`,
`review-queue.ts:210`), module constants (`session.ts:228,235`), the `SUMMARY_SELECT`/`SUMMARY_GROUP`
fragments (`batches.ts:183,202`), a fixed clause chosen by a boolean (`review.ts:63`), and a fixed
assignment list (`fields.ts:87`, values bound). No user-controlled string reaches SQL text.

**No XSS sinks.** Zero occurrences of `dangerouslySetInnerHTML`, `innerHTML`, `outerHTML`,
`document.write`, `eval` or `new Function` anywhere in the application. CSP (`public/_headers:51`)
withholds `'unsafe-inline'` from `script-src` — with the JSON-LD refusal explained at `:28-33` and an
explicit instruction not to add it — and sets `object-src 'none'`, `base-uri 'self'`,
`form-action 'self'`, `frame-ancestors 'none'`. HTML email is escaped (`contact.ts:92-96`), and export
values pass through `sanitizeForExport` (`utils.ts:31-36`), which correctly guards leading tab/CR/LF
as well as index 0.

**No CORS misconfiguration.** No `Access-Control-Allow-*` header is set anywhere. The API is
same-origin only; the client sends `credentials: "same-origin"`.

**Ownership checks are consistent.** All 24 endpoints begin with `requireSession`, and no endpoint
accepts a user id from the request — ownership derives solely from `auth.user.id` (`guard.ts:4-7`).
Object reads enforce it twice (key prefix *and* a `documents` row, `[[path]].ts:27-39`) with traversal
rejected first; object *writes* are validated at row-creation time (`batches.ts:439-451`).
Missing-vs-forbidden is uniformly 404 to prevent id enumeration.

**Password and session handling is sound.** PBKDF2-SHA256 chained to 600,000 sequential iterations
within the Workers 100k-per-call ceiling, 16-byte salt, self-describing hash, length- and
value-independent comparison (`crypto.ts:129-136`), transparent rehash on login, and `dummyVerify` on
both nonexistent and Google-only accounts. Session tokens are 256-bit random with only the SHA-256
stored, `HttpOnly`, `SameSite=Lax`, `Secure` on https only, 30-day TTL with rolling refresh, and
revoke-all on password change.

**Google ID token verification is correct.** Full RS256 signature check against Google's JWKS with
`alg` pinned (rejecting `none`), `kid` required, `iss` allowlisted, `aud` compared to the configured
client id, `exp`/`nbf`/`iat` checked with bounded skew, and forced JWKS refetch throttled against
amplification (`google.ts:21,153`).

**Prompt-injection surface is bounded.** `server/ocr-prompts.ts` owns prompt construction; `/api/ocr`
refuses a `messages` array outright rather than ignoring it (`ocr.ts:312-317`), validates `mode`
against a fixed set, caps `customPrompt`, and requires inline base64 so no caller-named remote URL is
fetched on the account's credential. Tier→model mapping is server-side.

**Secrets hygiene is otherwise good.** `.env` and `.dev.vars` are gitignored and untracked; both
example files carry empty values only. No `sk-`/`AIza`/`ghp_` patterns in tracked source — the
high-entropy matches are SHA-256 test vectors in `crypto.test.ts` and skill hashes in
`skills-lock.json`.

**No deprecated packages** in the lockfile. `xlsx@0.18.5` (two unpatched advisories, no fixed version
published) was already removed in favour of `src/lib/xlsx-writer.ts`.

**No N+1 in the batch read model.** `batches.ts:124-158` replaced five correlated subqueries per row
with one `LEFT JOIN`/`GROUP BY`; `getBatchDetail`/`getDocumentDetail` use `env.DB.batch()`;
`insertDocuments` does one hash lookup plus one batched write for up to 100 documents.
`AppLayout.tsx:66-73` asks for `?countOnly=1` — one `COUNT(DISTINCT ...)` over `idx_fields_review` —
replacing up to fifty sequential paged requests per route.

**Code splitting is disciplined.** All 15 routes are `lazy()`, `manualChunks` splits vendors for cache
stability, `optimizeDeps.include` pre-bundles lazy-route dependencies, `react-zoom-pan-pinch` (40 KB)
is correctly isolated off the entry path, and `date-fns` tree-shakes cleanly.

**Polling is conditional**, not unconditional — both dashboards stop when nothing is in flight and
when a batch is stalled. **Storage reads support conditional requests** with a real 304 path.

**Dead code is essentially absent** — one unused export (L-1) across the entire surface.

**No payment code exists.** `AppLayout.tsx:112` has a Billing nav entry pointing at
`/app/settings/billing`, and `Settings.tsx:595-611` renders a panel stating no subscription or card
data exists. No Stripe, no price/subscription tables, no webhook handler. Nothing missing — the
feature is not built.

---

# Appendix B — Recommended sequence

Ordered by risk reduced per hour, not by severity.

### Week 1 — stop the bleeding (all S)
1. **C-1** rotate EmailJS credentials, lock down the account. The only finding an outsider can act on today.
2. **C-5** rotate the four `VITE_`-prefixed keys; delete them; add the build-time guard.
3. **C-4** pin `wrangler`; add `packages:` to the workspace.
4. **C-3 + C-8** chain the worker deploy and the migrations into `pnpm deploy`.
5. **C-2** the chunked base64 fix — six lines.
6. **H-30** add CI. Everything above stays fixed only if something checks.
7. **M-41** extend `typecheck:all` to the queue worker before touching it further.

### Week 2 — the queue worker and its tests
8. **H-29 (`server/http.ts` half)** — twelve pure assertions, ~20 minutes, and `isPlausibleEmail` is already broken (M-2).
9. **H-19 + H-20** extract `server/ocr-provider.ts`, `server/extraction-parse.ts` and `server/document-results.ts`. **This is the highest-leverage change in the report** — it closes C-6, C-7, H-1, H-2, H-3, H-4 and M-40's worst copies as side effects rather than as seven separate fixes.
10. **H-27 + H-28** tests for `result.ts`, then `invalidObjectPath` and `refreshBatchStatus`.
11. **H-31** the one-line test fix that lets H-5 be caught.

### Week 3 — user-visible correctness
12. **H-5, H-6** the two data-loss paths in `parseOCRResult`.
13. **H-10** the review-queue predicate — the badge and the page disagree right now.
14. **H-8, H-9, H-13, H-14, H-15** small, each user-visible.
15. **H-12** add a `"queued"` progress state so async batches stop reporting completion.
16. **H-22** the two missing indexes — one migration.
17. **H-18** bump `vitest` and `vite`.

### Week 4+ — structural
18. **H-21** break the `api-client` ⇄ `ocr-client` cycle (prerequisite for testing either).
19. **H-23, H-24** the status endpoint and bounded extraction concurrency — the two changes users would actually feel.
20. **H-7, H-16, H-17** the remaining High items.
21. **M-39** collapse the four mode lists into one import — turns three prose invariants into compile errors.
22. **M-34 through M-37** the large file splits. Defer until you next need to touch each area.

Everything in **Low** is safe to batch into a single cleanup pass, except **L-17**'s two false
architecture comments, which should be corrected alongside H-12 since they describe the same
misunderstanding.

---

# Appendix C — Findings by file

| File | Findings |
|---|---|
| `queue-worker/src/index.ts` | C-2, C-6, C-7, H-1, H-2, H-3, H-4, H-20, M-22, M-24, M-41, M-42 |
| `src/lib/api-client.ts` | H-12, H-21, H-24, H-29, M-19, M-35, M-39 |
| `src/lib/ocr-client.ts` | H-5, H-6, H-21, H-25, H-26, H-31, M-20, M-29, M-36, L-12 |
| `src/pages/BatchDetails.tsx` | H-9, H-12, H-23, M-34, M-38, L-8, L-10, L-17 |
| `functions/api/ocr.ts` | H-4, H-19, M-6 |
| `vite.config.ts` | H-17, H-19, C-5 (guard) |
| `server/batches.ts` | H-28, M-12, M-24, M-40, L-17 |
| `src/lib/confidence-scorer.ts` | H-25, M-13, M-14, M-15, M-37 |
| `functions/api/review-queue.ts` | H-10, M-7, M-40 |
| `src/pages/ReviewQueueDetail.tsx` | H-8, H-13, H-14, M-17, L-5 |
| `src/context/AuthContext.tsx` | H-15, H-16, L-3 |
| `functions/api/auth/*` | H-29, M-1, M-2, M-5 |
| `wrangler.toml` / `queue-worker/wrangler.toml` | C-1, C-3, C-8, H-4, M-42, M-43, L-19 |
| `package.json` / `pnpm-workspace.yaml` | C-3, C-4, C-8, H-18, H-30, M-46, M-47 |
| `.env` / `.env.example` / `.dev.vars.example` | C-5, M-44, M-45 |
| `server/http.ts` | H-29, M-2, M-27, M-45 |
| `functions/api/.../result.ts` | H-27, M-7, M-10 |
| `functions/api/storage/*` | H-22, M-3, M-11, L-21 |
| `public/_headers` | M-8, and the CSP verified clean in Appendix A |

---

*Findings marked "verified" were confirmed by execution. Everything else was traced by reading and
cites the line it was traced to. Areas deliberately not covered in depth: the 21 `src/components/ui/*`
primitives, `src/components/marketing/*`, `DocumentSidePanel.tsx`, `TemplatesSettings.tsx`, and the
`src/pages/legal/*` content pages.*
