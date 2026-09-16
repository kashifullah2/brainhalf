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
