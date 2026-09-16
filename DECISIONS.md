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
