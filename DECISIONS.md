# DECISIONS.md — ambiguous calls and the reasoning behind them

## D-01 · Re-added full authentication despite the earlier revert

**Context.** Phase 1 of the audit prompt mandates HMAC session tokens, password-verified login and
server-side project ownership/ACL. My persistent memory records that on 2026-09-16 (the same day as
this run) the user said *"i don't want login or signup reverse the code"* and had every auth file
deleted, and I had logged a rule not to re-add it "unless the user asks again."

**Decision.** I asked the user directly rather than silently picking one, and they chose
**"Re-add full auth (Phase 1 as written)"**. That explicit, later instruction supersedes the memory
rule, which has been updated. Auth is being implemented in full.

**Why asking was right here.** The prompt's "don't stop for questions" rule is about *technical*
ambiguity; this was a direct contradiction with a documented, emphatic user preference from hours
earlier. Either choice was expensive — re-doing work the user had rejected, or skipping the prompt's
#1 "critical" phase — so the call belonged to the user.

## D-02 · Auth architecture: `AuthRegistry` Durable Object + WebCrypto

- **Token format** `bh_<base64url(payload)>.<base64url(hmac)>`, payload `{ uid, iat, exp }`,
  HMAC-SHA256 over `payload.exp`, verified **statelessly in the Worker**.
- **Passwords** PBKDF2-SHA256, 100k iterations, 16-byte salt, stored as
  `pbkdf2$<iters>$<saltb64>$<hashb64>`. WebCrypto only — no bcrypt/native deps, works in Workers.
- **Server secret** from `env.SESSION_SECRET`; if unset, a **per-isolate random key** is generated
  (never a hardcoded fallback). Effect: deployments without the secret stay un-forgeable but lose
  sessions on isolate restart. Local dev uses `.dev.vars` (gitignored).
- **Revocation** is real, not just expiry: the token hash is stored in a `sessions` table and
  `logout` deletes it, so a stolen-but-expired-looking token still dies.
- **Transport**: httpOnly+Secure+SameSite=Lax cookie `bh_session` (covers iframe/preview navigations
  automatically) **and** the raw token in the login response body (for the `Authorization` header and
  the WS query param — browsers cannot set headers on `new WebSocket`).

**Why.** This satisfies "HMAC-signed tokens, server-side secret, verify password hash before issuing"
without new dependencies and without breaking same-origin iframe previews.

## D-03 · Ownership is enforced at the Worker gate, re-checked inside the DO

`routeAgentRequest` exposes `onBeforeConnect`/`onBeforeRequest` hooks. The Worker verifies the token,
asks the Registry whether `project_id → user` is owned by (or unclaimed-by) the caller, then injects
`x-auth-user-id` and forwards. `agent.ts` **also** requires that header on every entry point and fails
**closed** if it is absent. Defense in depth: the DO is not directly reachable except via the Worker.

**Claim semantics.** A project with no owner row is claimed atomically
(`INSERT ON CONFLICT DO NOTHING` + re-read) by the first authenticated caller. Pre-existing
client-side projects (unguessable random ids) get claimed by their first post-auth login.
See ISSUES.md I-01.

## D-04 · Fail-closed ordering

Every auth path returns `401`/`403` and *never* falls through to an anonymous mode. If the Registry
DO is unreachable, the request fails rather than degrading to anonymous.

## D-05 · Sidebar project list becomes server-owned

Project listing moves from localStorage (`getProjects()`) to `GET /api/projects` backed by the
Registry's `project_owners` table — the ACL model the prompt asks for. localStorage stays as a
per-user cache, keyed by user id.

## D-06 · `AuthRegistry` intentionally omits `implements DurableObject`

This tsconfig has no `"types"` entry, so the DOM lib's global `Request` and `@cloudflare/workers-types`'
own `Request<unknown, CfProperties<unknown>>` are both in scope. They are structurally incompatible
(the DOM `Request` lacks `credentials`/`destination`/`mode`/`referrer`/`referrerPolicy`), so
`implements DurableObject` fails with TS2416 on a `fetch(request: Request)` that is otherwise correct.

**Decision.** Drop the interface declaration and document why in a class-level comment. The class still
satisfies the *runtime* DO contract (stateful class constructed with `(state, env)` exposing `fetch`).
A compile-time assertion (`const _check: DurableObject = ...`) was rejected — it triggers the same
incompatibility. Types used elsewhere (`DurableObjectState`, `DurableObjectNamespace`,
`DurableObjectStub`) are imported as named `import type` from `@cloudflare/workers-types`, which
resolves through the package's `index.ts` real exports rather than the ambient globals in
`index.d.ts`.

## D-07 · Test failure triage: production code was correct

`auth-gate.test.ts` initially reported 3 failures (cookie, query and briefly header transports all
returning `null`). A throwaway test proved `extractToken` returns the identical token for all three
transports and that `verifySession` fails closed correctly. Root cause was the **test helper**, not
`auth.ts`: the env object carried `REGISTRY` but no `SESSION_SECRET`, so `getSessionSecret` generated
its per-isolate random key and the HMAC check legitimately rejected the token. Fixed with an `envWith()`
helper; no production code changed. Logged so the failure is not misread as an auth bug later.

## D-08 · Model allowlist is exact-match only, with a provider hint for transport choice

`lib/models.ts` is now the single source of truth for every model id this deployment may invoke. It
replaced three separate substring-dispatch maps in `agent.ts` (`ANTHROPIC_MODEL_MAP`,
`BEDROCK_MODEL_MAP`, the bedrock fallback chain) and the "unknown bedrock id passes through at 64k
tokens" path.

**Decision.** `resolveModel(name, provider?)` matches `name` exactly and case-sensitively against
`MODEL_ALLOWLIST`; a provider hint disambiguates ids valid on more than one backend. Anything else
returns `null` and **callers treat that as a hard refusal** — there is no default-model substitution,
because silently re-mapping an unknown id to sonnet was exactly the behaviour the audit objected to.
The old code ran `claude-anything` as `claude-3-5-sonnet`; the new code rejects it and tells the caller.

**Transport choice vs. model substitution.** `claude-sonnet-4.6` is allowlisted under both
`anthropic` and `aws`. That is not a substitution — it is the same client-visible model id reachable
over two transports, selected by which credential is configured. `minimax-m2.5` has no native
Anthropic equivalent, so `resolveModel('minimax-m2.5', 'anthropic')` returns `null` and it stays on
Bedrock. If neither credential is set the call fails with a clear error rather than falling back to a
third provider.

The list mirrors the catalog in `ChatPanel.tsx`; the allowlist test asserts the contract both ways
(every catalog model resolves; the list exposes its names).

## D-09 · Token ceilings: client asks, server caps

`capTokenLimit(requested, model)` takes `min(requested, model.maxTokens, MAX_OUTPUT_TOKENS)`, where
`MAX_OUTPUT_TOKENS` is an absolute deployment ceiling of 65536. A client that sends nothing usable
(undefined/null/0/-1/NaN) gets the model's own ceiling — never an unbounded generation. The value is
applied at both invocation paths (`ChatAgent` generation and `/api/test/*`), so the benchmark
endpoints cannot be used to bypass the generation cap.

## D-10 · Timeout strategy: `Promise.race` for the binding, `AbortSignal.timeout` for the SDKs

`env.AI.run` has no reliably-documented `abortSignal` option, so it is wrapped in `withTimeout`
(`Promise.race` against a wall-clock deadline) rather than passing an abort signal it may ignore.
`streamText` does accept `abortSignal`, so both it and the model-tester use `AbortSignal.timeout`.

The user's stop button and the server deadline share **one** `AbortController`: a `setTimeout` fires
`controller.abort()` at `AI_TIMEOUT_MS`, and the stop button aborts the same controller — so a
generation that the user stopped is not then re-classified as a timeout, and vice versa. Every
`setTimeout` is cleared in a `finally`, and the timeout variable is hoisted above its `try` so the
`finally` can actually see it (a `const` inside the `try` is out of scope there — caught by tsc).

## D-11 · Model failures return 502, not a masked 200

`/api/test/*` previously returned HTTP 200 with `{ success: false }` in the body. A monitoring
caller or a `fetch().ok` check would read a broken model run as healthy. It now returns **502** with
the identical JSON body, so the diagnostic information is preserved for callers that read it while
curl-level checks stop reporting success. No frontend caller exists (only `worker.ts` routes here),
so this is not an API-contract break.

## D-12 · Agent-invoked tools go through the same allowlist

`call_cloudflare_model` passed its `model` parameter straight into `env.AI.run`. The parameter is
agent-chosen but ultimately derived from a client-supplied prompt, so it is untrusted input — this
was a live allowlist bypass. It now resolves through `resolveModel(model, 'cloudflare')` and returns
a structured error for non-allowlisted ids, with no passthrough. `generate_image` used a hardcoded
flux id; that model is now listed in `MODEL_ALLOWLIST` (marked as not client-selectable) and resolved
the same way, so there is exactly one place that decides which AI bindings are callable. Every
`env.AI.run` site in the codebase is now allowlist-gated (verified by grep).

## D-13 · SSRF guard on the agent's outbound fetch

The `fetch_api` tool called `fetch(url)` with no restriction on the URL, and the URL is
model-chosen from a client-supplied prompt. That is an open SSRF channel into the
worker's own network: loopback, RFC1918 space, and — the case an attacker actually
wants — `http://169.254.169.254/latest/meta-data/` for cloud credentials.

**Decision.** `lib/ssrf.ts` validates the URL before any request: https/http only, no
credentials in the URL, and the hostname must be a public routable address. IPv4 is
checked range-by-range (0/8, 10/8, 127/8, 169.254/16, 172.16/12, 192.168/16, CGNAT,
multicast); IPv6 refuses compressed forms conservatively rather than attempting an
expansion that could be wrong; well-known internal DNS names (`metadata.google.internal`,
`kubernetes.default.svc`) are listed because they pass a pure shape check.

**Redirects are re-validated per hop.** The fetch uses `redirect: 'manual'` and each
`Location` is resolved and checked again — a public URL that redirects to the metadata
endpoint is refused at the hop, not waved through by the first check. The chain is
capped at 3 hops, the body is capped at 64 KiB (the tool only shows a 3 KiB excerpt),
and the call is aborted at 30s. The size cap also protects memory: an hostile endpoint
previously streamed an unbounded `res.text()`.

The guard returns structured errors the model can read and recover from, rather than
throwing — the tool keeps working for legitimate APIs.

## D-14 · Import map and generated-JS injection surface

`buildDynamicImportMap` interpolates package names parsed out of generated source into a
`<script type="importmap">` block. `JSON.stringify` escapes quotes and backslashes but
**not** `</script>` — a specifier containing it would terminate the tag early and inject
markup into the preview origin, which is same-origin with the IDE.

**Decision.** Two layers. First, `isValidBareModuleSpecifier` rejects anything that is
not a bare npm identifier (optional `@scope/`, name, optional subpath, optional trailing
slash), refusing quote/backtick/backslash/whitespace/control characters outright. Second,
the emitted JSON has `<`, `>`, `&`, U+2028 and U+2029 escaped to their `\u` forms, so even
a specifier that slipped past the validator cannot break out. Version strings taken from a
generated `package.json` are constrained to `[0-9A-Za-z.+-]`.

Two raw path interpolations into generated JS (`Transpile Error in ${path}` and the
`File: ${path}` label) now go through `JSON.stringify` for the same reason — a path is
attacker-shapeable data and was sitting inside a JS string literal.

## D-15 · postMessage targetOrigin is never a wildcard

Every `postMessage` in the preview runtime used `'*'`. The messages carry file paths,
build errors and auto-fix payloads; a wildcard means any page that managed to frame the
preview could read them. All 20 sites now name `window.location.origin`, which is exactly
the parent's origin — the preview is always embedded same-origin via a relative
`/preview/...` URL, so nothing legitimate breaks. A test greps the source tree for a
wildcard targetOrigin so this cannot silently regress.

## D-16 · Real CSPs, scoped per origin

Two policies, because the two origins have different needs.

The **preview** origin serves model-generated content and gets the strict boundary:
script sources are limited to `'self'`, the server-rendered bootstrap, and the two CDNs
the preview actually uses (`cdn.tailwindcss.com`, `esm.sh`). `unsafe-eval` is present
because generated apps transpile and evaluate modules at runtime via the PreviewRunner
loader — removing it would break legitimate apps, and eval cannot load a cross-origin
resource, so granting it does not reopen the boundary the policy draws. `frame-ancestors`
restricts framing to the app origin.

The **IDE shell** emits no inline scripts at all (verified against the built
`dist/index.html`), so its script-src is `'self'` plus the CDN hosts Sandpack's bundler
and Monaco's loader fetch from, with `default-src 'none'` and `frame-ancestors 'none'`.

Both carry `X-Content-Type-Options: nosniff`; the shell also sets `X-Frame-Options: deny`,
`Referrer-Policy`, `CORP: same-origin` and a `Permissions-Policy` closing camera,
microphone and geolocation.

**Rejected.** A per-request nonce for the preview's inline scripts, which would have let
script-src drop `'unsafe-inline'` entirely. The nonce has to be generated server-side and
threaded into every `<script>` tag in a template string that is also a test fixture; the
shape check against `dist/index.html` confirmed the shell does not need it, and the
preview's inline scripts are all server-authored and constant. Recorded here so the
upgrade path is obvious if the template ever gains a dynamic inline script.

---

## D-17 · The epoch gate sits at the single write entry point, not at each caller

`extractAndSaveFiles(text, connection, epoch?)` now checks `writeEpoch.accepts(epoch)`
itself, and both callers — the `streamText` `onFinish` handler and the Workers AI
fallback in `runCloudflareWorkersAI` — thread `epoch` through.

The first version gated only the streaming path, because that was the path the bug
report was about. But the fallback also calls `extractAndSaveFiles`, and a user who
stops a hanging Anthropic call and re-prompts can land in the fallback too. A guard
that covers one of two write paths is not a guard.

An optional parameter rather than a required one: `extractAndSaveFiles` is private and
the two call sites are the only ones, but an undefined epoch means "no generation
context, allow" (used by the legacy non-generation paths). Making it required would
force a synthetic epoch onto callers that have no generation, which is worse than
an explicit opt-out.

## D-18 · Chained `<edit>` blocks accumulate on the pending write, not on the stored content

Each `<edit>` block in a generation reads the file from SQLite to apply its
search/replace. When a generation emits two edits to the same path — a common shape,
"change the import, then change the handler" — both reads return the *stored* content,
because the batch has not committed yet. Applying each edit to the stored original
means the second `pendingWrites.set` overwrites the first, silently reverting it: the
user sees only the second edit land.

The fix reads from `pendingWrites` when it already has an entry for the path, so the
edits chain. This is why the batch accumulates into a Map before committing rather
than writing per-block.

## D-19 · Fixed a latent build breaker from Phase 3: literal U+2028/U+2029 in regex literals

The import-map escaper replaced `<`, `>`, `&`, U+2028 and U+2029 with their escape
sequences. The last two were written as *literal* line-separator characters inside
regex literals (`/ /g` was written with the raw byte, E2 80 A8).

ECMAScript forbids a LineTerminator inside a regular-expression literal, and U+2028
and U+2029 are LineTerminators. `tsc` accepted the file (it treats them leniently),
but the real bundler — `vite`/`oxc` — rejected it with `Unterminated regular
expression` at agent.ts:1489. The first test file to actually `import` agent.ts
surfaced this; the prior 198 tests all mocked the agent and never parsed it. The
production build would have failed.

Fixed by writing the escapes as source-level ` ` / ` `, which is a valid
regex pattern escape and not a literal line terminator. Lesson: `tsc --noEmit` alone
is not a build verification — `vite build` is now part of the check loop.

## D-20 · Phase 5: versioned migrations replace the ad-hoc `ensureSchema`, v1 written `IF NOT EXISTS`

`lib/migrations.ts` now owns the agent object's schema. `AGENT_MIGRATIONS` v1 is the
*same DDL* the old `ensureSchema` ran, wrapped in `IF NOT EXISTS`, and v2 is the two
indexes the schema never had (`idx_project_files_listing`, `idx_messages_recent`).

The choice that mattered: v1 is byte-compatible with the pre-Phase-5 tables rather
than a new schema. An existing workspace's tables already satisfy v1, so recording v1
as applied costs one `schema_version` row and no data copy. A "clean" v1 that
redefined the tables would have either dropped user workspaces or required a
table-rename backfill — a destructive operation this run is not allowed to do.

Each migration runs inside `ctx.storage.transactionSync`, and the version row is
inserted *inside the same transaction*. A migration that fails halfway rolls back and
leaves its version unrecorded, so the next cold start retries it instead of silently
skipping the half that failed.

`runSql` had to learn to accept a plain string, not just a tagged template: the
migration runner's statements come from a table, not from source text. A plain string
is wrapped in a single-element template array because the SDK's `sql` tag calls
`strings.reduce(...)`, which a raw string does not have — passing it through as-is
would have thrown at runtime on the very first migration.

The registry was audited rather than rewritten: it already had `schema_version`,
`SCHEMA_VERSION = 1`, and indexes on `users(email)`, `sessions(user_id)` and
`project_owners(user_id, updated_at DESC)` from Phase 1. Its migrations are mirrored
in `REGISTRY_MIGRATIONS` so the framework covers both objects, but its live DDL was
only *added to* (one new index, D-22) rather than replaced.

## D-21 · Phase 5: every interpolated LIKE replaced with an indexed read plus exact `IN (...)`

Four queries built a `LIKE '%...'` or `NOT LIKE '%...%'` pattern around an
interpolated value. A leading-wildcard LIKE cannot use a B-tree index, so each one
was a full table scan of `project_files` — on the hot path of every preview request
and every prompt.

The replacements refuse to guess at suffixes. Where the old code fuzzily matched a
candidate (`/src/App` matching `App.jsx`, `App.ts`, `App.anything`), the new code
enumerates the extension set it actually supports — `.jsx .tsx .js .ts .json .css`
across the known directories — and issues one `WHERE path IN (...)` against the
primary key. The context builders read `SELECT path` (index-only) and filter in JS,
slicing to the top 40 (streamText) / 10 (Cloudflare) before fetching content for
just those rows by exact path.

The tradeoff is explicit: a file with an extension outside the enumerated set is no
longer matched by the fallback. That is acceptable because the same list gates
import rewriting and preview elsewhere in the codebase; a file the toolchain cannot
transpile was never going to be served anyway. What is gained is that preview lookup
stops scanning the whole workspace per request.

The one LIKE left alone is `agent.ts` `seedStarterIfEmpty`: both patterns are fixed
string literals with no interpolation, it runs once per workspace at first boot, and
there is no hot path to protect.

## D-22 · Phase 5: the session TTL sweep runs on login, not on a timer

Expired sessions were already inert — a lookup compares `expires_at <= Date.now()`
and refuses them — so the only cost of leaving them was unbounded storage growth:
the table gains a row per login and never loses one.

An index on `sessions(expires_at)` makes the sweep a single indexed delete, so it is
cheap enough to run inline. It now fires on `POST /sessions` — the request that grows
the table. A Durable Object alarm would have needed a second lifecycle code path for
a job that one indexed statement handles.

The sweep is non-destructive by construction: the predicate is `expires_at <= now`,
so it can only ever remove a session that would have been refused anyway. A failure
is caught and warned, never propagated — a broken sweep must not break the login it
was called from.

## D-23 · Phase 5: the preview store is per-Durable-Object, not a module singleton

`executeBackendRequest` defaulted its `store` argument to the module-level
`globalPreviewStore`. A module-level singleton is shared by every Durable Object
that happens to land in the same isolate. Since one agent object serves one project,
that meant a `POST /api/users` in project A's preview was readable as
`GET /api/users` in project B's preview — simulated backend data crossing a project
boundary the rest of the system enforces.

The agent now holds its own `InMemoryDataStore` and passes it explicitly. No public
signature changed: the parameter was already declared with a default, so the
browser-side preview caller (`PreviewRunner`) still takes the default. That path is
already isolated — the preview iframe is keyed by
`edge-preview-${activeProjectId}-${counter}`, so switching projects remounts the
iframe and gets a fresh module state.

## D-24 · Phase 5: `files_snapshot` is bounded in rows and bytes, with additive paging

Both snapshot sites ran `SELECT path, content FROM project_files` unbounded and put
every row in one WebSocket frame. One object serves one project, so this is not
unbounded in practice — but nothing capped a single huge file, and a frame large
enough to stall the client had no server-side guard.

`readProjectFilesPage(limit, offset)` reads one page with an explicit `ORDER BY path`
(without it SQLite may return rows in any order and a second page can repeat the
first), and stops adding files once the accumulated content passes a byte ceiling.
The `get_files` handler now honours optional `limit`/`offset` from the client —
coerced through `clampInt`, which never trusts a client value to be finite or in
range — and returns `total` / `hasMore` alongside `files`.

The client contract is unchanged: `files_snapshot` still carries `files`, and
`ChatPanel` still replaces its file map from it. The paging fields are additive, so
an existing client ignores them. The post-extraction broadcast deliberately reads the
first page only for the row cap but is bounded by the byte ceiling in either case.

## D-25 · Phase 5: a duplicate backend id is a 409, not a silent overwrite and not a 500

`InMemoryDataStore.create` had two defects. First, it ran
`autoIds.set(key, (Number(id) || 0) + 1)` on *every* create, including creates with a
non-numeric id — `Number('evt_abc')` is `NaN`, so the counter reset to 1 and the next
auto id collided with an existing row. Second, an explicit id that already existed
silently overwrote the record while the caller still received a 201.

`create` now throws an error carrying `status: 409`, and the counter only advances —
and always past any caller-supplied numeric id. The generic CRUD handler that catches
store errors previously returned 500 unconditionally, which would have masked the new
409 as an internal error; it now honours `dbErr.status` and falls back to 500 only
when the store did not specify one.

## D-26 · Phase 6: the four `readProjectFiles` copies became one method

The R2 backup, `/api/files`, the generic `/api/` route and the preview
`/index.html` handler each inlined the same `SELECT path, content` →
`Object`/`Map` loop, all four with their own `try { } catch (e) {}` that
swallowed the failure and returned `{}` — so a schema problem looked like an
empty workspace in three different responses.

They now share `readAllProjectFiles()`. The row limit is deliberately
`Number.MAX_SAFE_INTEGER` here: these are HTTP responses and a backup, where
the caller needs every file, so the *byte* ceiling is what bounds the result
rather than the paging row cap. `get_files` — a WebSocket frame a client must
parse — keeps the 200-row paging default.

## D-27 · Phase 6: `buildFilesContext` merges the two context-selection blocks

The streamText and Cloudflare paths had copy-pasted the whole selection
algorithm — index-only path read, the node_modules/main filter, the
`IN (...)` content fetch, and either whole-file or budgeted output — and had
already diverged in the comment each carried about the Phase 5 LIKE removal.

The merged helper takes `pinned`, `rank`, `maxFiles`, `charBudget` and
`header`, and exists once. Two choices preserved behaviour exactly:

- `pinned` affects only the *filter*, never the sort. The streamText caller
  previously sorted pinned-first with no secondary key, and the Cloudflare
  caller sorted purely by rank; had `pinned` also biased the sort, the
  Cloudflare path's two `/server/*` pinned files would have jumped ahead of
  other rank-3 files and changed which ten files a model sees.
- `charBudget === undefined` selects whole-file output, so the streamText path
  keeps emitting full files and only the Cloudflare path trims.

## D-28 · Phase 6: the preview error card is one constant, interpolated escaped

Two `ErrorBoundary` classes render the identical error card: one in the starter
seeded into an empty workspace, one in the live edge-preview harness. Both are
*source text* inside template literals, not shared TypeScript.

The card is now `PREVIEW_ERROR_CARD_SRC`, interpolated into both. The escape is
the subtle part: the constant is interpolated into a template literal that is
itself source text for the preview runtime, so `${this.state.error?.message}`
must survive as *text*. Written unescaped, it would be evaluated when the
outer literal is built — where `this` is the ChatAgent — and the generated
code would receive `[object Object]` in place of the message. It is written
`\${`, which produces the two characters `${` with no substitution.

Neither tsc nor vite can catch this: both happily compile an interpolated
`[object Object]`. It is verified by a test that seeds a workspace and asserts
on the resulting `/src/main.jsx`, checking the live interpolation is present as
text and no `[object Object]` appears.

## D-29 · Contrast: two hardcoded colors were below the WCAG AA floor

Every ratio below is computed against the surfaces the color actually sits on
(`--bg-canvas` `#09090b`, `--bg-card` `#13151f`, the preview card `#0f1015`, and
pulseboard's `#090a0f`), not against an assumed black.

**`--text-muted` / `--color-neutral-muted`: `#71717a` → `#82828b`.** The token
backs 11px timestamps and hints — small text, so the 4.5:1 floor applies, not
the 3:1 large-text floor. It measured 4.12:1 on the canvas and 3.76:1 on cards,
so it failed on both. `#82828b` measures 5.22:1 and 4.78:1.

**The "Reload Preview" indigo: `#6366f1` → `#5558e4`.** This is not a re-tint.
The card's button label is 12px white on the indigo, which measured 4.47:1 —
under the 4.5:1 floor by a hair. The darker indigo measures 5.38:1.

The card exists in three places, not the two D-28 accounted for: the constant
interpolated twice in `agent.ts`, and an inline copy in `basicReactTemplate`
(`lib/templates.ts`) that the D-28 extraction missed. That third copy kept the
old indigo and is fixed with it. The template copy is the reason a shared
constant is worth having: a fix applied to the constant does not reach it.

**Pulseboard's own palette** (`lib/templates/pulseboard.ts`) had the same two
failures, measured against its `#090a0f` page and `#13151f` cards:

- Its brand indigo `#6366f1` backed three white-text buttons at 4.47:1. Darkened
  to `#5558e4` across all seven uses — headings and icons stay valid because as
  *colored text on dark* they need only 3:1 and `#5558e4` measures 3.67:1, so
  one value works for every role.
- Its `#6b7280` backed 13px empty-state text at 3.76–4.09:1. Raised to `#9ca3af`,
  which the file already used for adjacent secondary text at 7.16:1 — the
  outlier is removed rather than a sixth gray introduced.

Left alone deliberately: `#4b5563` on the pager buttons. Both occurrences are
the *disabled* branch of a conditional (`page <= 1`, `page >= totalPages`), and
WCAG exempts disabled controls from contrast requirements.

The ratios in the `index.css` comment are stated because they are checkable —
they were computed, not estimated, and they match.

## D-30 · The top nav had no working sign-out, and it clipped its own overflow menu off-screen at <=375px

Two independent defects surfaced in the same Phase 7 responsive pass, both in
the top nav.

**1. `logout()` was implemented and unreachable.** `auth-client.ts` has a
complete `logout()` — POST `/api/auth/logout`, then clear the localStorage
token and user — and the worker has a working revocation endpoint behind it.
Nothing in the component tree ever called it. `TopNav` already declared
`currentUser` and `onLogout` props and already rendered an identity block with
a "Sign out" button, but `App.tsx` passed neither prop, so the block never
mounted. There was no sign-out path anywhere in the UI: a user had to clear
cookies and localStorage by hand. Fixed by passing `user` and a `handleLogout`
that awaits `logout()` and then sets `user` to null — the login screen appears
because `App` renders on `!user`. Verified end to end: the button clears
`bh_session_token`/`bh_session_user`, the login screen replaces the workspace,
and the same token then returns **401** on both `/api/auth/session` and
`/api/projects`, so the revocation is server-side, not just client-side
theatre.

**2. At 375px the right cluster was pushed entirely off the viewport.** Measured
before the fix: the "Deploy" button ran 270–369 and "More project actions"
377–409 on a 375px screen — the overflow menu button started two pixels past
the right edge and was completely unreachable, clipped by `.main-content`'s
`overflow: hidden`. The same measurement showed `.top-nav-left-cluster` had
collapsed to **zero width**, so the project name (and with it the only rename
affordance) was invisible, its children overlapping the segmented control.

A single row cannot hold it: hamburger 36 + logo 24 + name + status pill 65 +
segmented control 228 + deploy 99 + overflow 32 is ~690px of intent against
355px of viewport. Compacting alone does not close that gap, so the nav is now
two rows at <=768px.

- `--header-height` is overridden to 86px inside the 768px media query. It is
  the same variable `.workspace-area` subtracts (`calc(100vh - var(--header-height))`),
  so the workspace tracks the header automatically instead of the two drifting
  apart.
- The segmented control gets `order: 3; flex-basis: 100%` and the nav
  `flex-wrap: wrap`, putting Chat/Code/Preview on a full-width second row —
  DOM order is untouched, so keyboard focus order is unchanged.
- The left cluster gets a `min-width: 0` floor so it can no longer collapse to
  zero and swallow the name.
- Row one is compacted: Deploy drops its "Deploy ↖" label (icon-only, `aria-label`
  intact), the status pill shows its dot and hoists its text into a `title`.

Measured after the fix, still at 375px: name 90–190, status dot 224–244, deploy
253–285, more-menu 293–325, sign out 333–365, tabs on row two 10–365.
`documentElement.scrollWidth` is 375 and zero elements overflow. The more menu
opens with all five items inside both axes (115–325 x, 69–240 y on a 375x812
viewport).

Chose a CSS-only reflow over a TSX reorder specifically because it keeps the
accessibility tree in DOM order. Chose two rows over hiding controls because
every alternative removed a function — dropping the segmented control breaks
navigation between Chat/Code/Preview, dropping the overflow menu removes Share,
ZIP export, GitHub export, Project Settings and Workspace Reset, and dropping
Deploy removes the primary CTA.

**Left alone deliberately:** the mobile identity block shows only the sign-out
icon. The email address is 30px of useful information against a row that has
none to spare, and it stays reachable via the button's tooltip
(`Sign out (e2e@audit.test)`). The `Dev` badge is desktop-only for the same
reason; it is a warning about disabled project isolation, and on mobile the
sidebar is the place a user would read it.

**Not fabricated:** the 768px and 1024px breakpoints were exercised live in the
browser at every step, and the overflow numbers above are measured geometry
from a real 375px viewport, not estimates.

---

## D-31 · The dev shell silently talked to production over the WebSocket

`ChatPanel.connect()` computed its backend host as:

```js
const isLocal = hostname === 'localhost' || hostname === '127.0.0.1';
const backendHost = isLocal
  ? (import.meta.env.VITE_BACKEND_HOST || 'brainhalf.com')
  : window.location.host;
```

With `VITE_BACKEND_HOST` unset — the normal local case, since `.dev.vars` holds
only `SESSION_SECRET` — a shell served from `127.0.0.1:8788` opened its chat
socket to **`wss://brainhalf.com`**, production. Two consequences, both bad:

1. Every local prompt was processed by the production agent, against production
   Durable Objects. Local dev has no outbound model access, so nothing was
   returned and the session appeared dead — but the request had already left.
2. The local HMAC session token rode in the query string to a different origin,
   leaking a live credential to production logs.

**Evidence, not a guess:** the client console logged `Connected to session:
default` while a 146-line sweep of the wrangler dev log contained zero
`/agents/chat-agent/default` entries. The socket was succeeding somewhere —
just not here.

**The fix:** same-origin is correct in both cases. The Worker terminates the
WebSocket in production, and in local dev the assets are served from the same
host:port as wrangler. `VITE_BACKEND_HOST` survives as an explicit override for
the one case where it is genuinely needed (vite dev server on :5173 reaching
wrangler on :8788). It no longer falls back to a hardcoded production host, so
an unset variable can never silently reroute a developer to prod.

Verified live after the change: `GET /agents/chat-agent/proj-h0lbqp-mu52qz3h
101 Switching Protocols` in the local dev log, where previously there was
nothing.

---

## D-32 · Every brand-new visitor was shown someone else's locked project

`project-store.ts` seeded a literal `id: 'default'` project for any empty
localStorage, and `getActiveProjectId()` fell back to the same string. The
server claims a project on the first authenticated agent connection
(`authorizeOrClaim`, worker.ts:280). So the first newcomer to open the app and
connect would permanently own `default` for *everyone*, and every subsequent
newcomer's preview iframe would render the raw JSON
`{"error":"You do not have access to this preview"}` — because preview reads
use `isProjectOwner`, which is false for an unclaimed project you don't own.

This was hidden behind the D-31 WebSocket bug: the claim never happened locally,
so the preview stayed 403 even for the person who should have owned it.

**The fix:** seed every fresh visitor with a unique `proj-<rand>-<time>` id, and
make `getActiveProjectId()` fall back to `getProjects()[0]?.id` rather than a
constant. `createProject()` now shares one `newProjectId()` helper with the
seeder so the two id formats can never drift.

**Non-destructive by design.** No migration touches stored state: a user who
already has a claimed `default` project keeps it, and a user whose
`brainhalf_active_project` key still reads `default` keeps reading it. Only
*new* seedings change. That residual is logged in ISSUES.md.

Verified live with a freshly signed-up account (`firstrun@audit.test`):
`brainhalf_projects` seeded `proj-h0lbqp-mu52qz3h`; the dev log shows the exact
recovery sequence `403 (unclaimed) → 101 Switching Protocols (claims) →
/preview/.../index.html 200 OK` plus `styles.css`, `main.jsx`, `App.jsx` all 200.

Two dead `|| 'default'` fallbacks were removed for the same reason: `main.tsx`
(now renders nothing for a malformed bare `/preview` URL instead of a stranger's
project) and `Sidebar.tsx` (dead anyway — `deleteProject` re-seeds, so
`remaining[0]` is always defined).

---

## D-33 · The app shell's CSP was dead code in production

`wrangler.toml` declares `[assets] directory = "dist"` with `binding = "ASSETS"`
and no `run_worker_first`. Cloudflare's asset layer serves any file that exists
**without invoking the Worker**. So `withShellSecurity()` — the CSP,
`X-Frame-Options: deny`, CORP and Permissions-Policy applied at worker.ts:221-233
and 266-268 — never ran for the shell in production any more than it did in dev.
The application surface, the thing an attacker would actually target, had
`default-src` unconstrained.

Confirmed by request, not by reading config: `curl -D - http://127.0.0.1:8788/`
returned 200 with `ETag`, `CF-Cache-Status: HIT` and **no CSP** — the asset
layer's fingerprint, not the Worker's. A 404 on the same path returned the full
CSP, which is how the two paths were told apart.

**The fix:** apply the header set at the asset layer, in `public/_headers`,
mirroring `shellSecurityHeaders()` line for line. Verified after rebuild: `/`
returns 200 with `content-security-policy`, `x-frame-Options: deny`,
`cross-origin-resource-policy: same-origin`, `permissions-policy` and
`referrer-policy: strict-origin-when-cross-origin`.

**Considered and rejected:** `run_worker_first = true` would make the Worker the
single source of truth and retire the duplication. It also routes every static
asset through the Worker, and local dev already showed asset-snapshot flakiness
under rebuild (see ISSUES.md) — I did not want to make that the default path on
the strength of a local-dev observation. The `_headers` duplication is one file,
one comment pointing at the function it must stay in sync with, and zero routing
change.

**Also corrected:** the existing `_headers` sent `Referrer-Policy: no-referrer`
while the Worker sent `strict-origin-when-cross-origin`. Unified on the latter.
