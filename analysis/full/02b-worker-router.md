# Phase 2B: Worker Router Deep Review — src/worker.ts

## Route-by-Route Authorization Matrix

| # | Method | Path Pattern | Auth Required | Ownership Check | Admin Check | Rate Limit | CORS | CSRF Protection |
|---|--------|-------------|---------------|-----------------|-------------|------------|------|-----------------|
| 1 | GET | `www.brainhalf.com/*` | No | No | No | No | N/A (redirect) | N/A |
| 2 | GET | `/sign-in`, `/login` | No | No | No | No | N/A (redirect) | N/A |
| 3 | GET/HEAD | `/preview-rules.json` | No | No | No | No | `*` (intentional) | N/A |
| 4 | GET/HEAD | `/preview-runtime.js` | No | No | No | No | `*` (intentional) | N/A |
| 5 | OPTIONS | `/api/*`, `/agents/*`, `/preview/*`, `/p/*` | No | No | No | No | CORS preflight | N/A |
| 6 | POST | `/api/auth/signup` | No | No | No | auth bucket | withCors | Bearer + SameSite=Lax cookie |
| 7 | POST | `/api/auth/login` | No | No | No | auth bucket | withCors | Bearer + SameSite=Lax cookie |
| 8 | POST | `/api/auth/logout` | Session (optional for cookie clear) | No | No | auth bucket | withCors | Bearer + SameSite=Lax cookie |
| 9 | GET | `/api/auth/session` | Session | No | No | No | withCors | Bearer + SameSite=Lax cookie |
| 10 | POST | `/api/auth/ws-ticket` | Session | No | No | No (see Finding F2) | withCors | Bearer |
| 11 | GET | `/api/auth/google/start` | No | No | No | No | withCors | N/A (redirect flow) |
| 12 | GET | `/api/auth/google/callback` | No (OAuth state) | No | No | No | withCors | OAuth state param |
| 13 | POST | `/api/auth/google/complete` | No | No | No | auth bucket | withCors | Bearer |
| 14 | POST | `/api/auth/forgot-password` | No | No | No | auth bucket | withCors | Bearer |
| 15 | POST | `/api/auth/reset-password` | No | No | No | auth bucket | withCors | Bearer |
| 16 | POST | `/api/auth/resend-verification` | No | No | No | auth bucket | withCors | Bearer |
| 17 | POST | `/api/auth/verify-email` | No | No | No | auth bucket | withCors | Bearer |
| 18 | POST | `/api/contact` | No | No | No | auth bucket | withCors | Bearer |
| 19 | GET | `/api/apps/google/start` | No | No | No | No | withCors | N/A (redirect) |
| 20 | GET | `/api/account/outcomes` | Session | User-scoped query | No | No | withCors | Bearer |
| 21 | GET | `/api/admin/outcomes` | Session | No | PRODUCT_METRICS_OWNER_IDS | No | withCors | Bearer |
| 22 | GET | `/api/admin/users` | Session | No | PRODUCT_METRICS_OWNER_IDS | No | withCors | Bearer |
| 23 | GET | `/api/admin/projects` | Session | No | PRODUCT_METRICS_OWNER_IDS | No | withCors | Bearer |
| 24 | DELETE | `/api/admin/projects/:id` | Session | No | PRODUCT_METRICS_OWNER_IDS | No | withCors | Bearer |
| 25 | GET | `/api/admin/projects/:id/files` | Session | No | PRODUCT_METRICS_OWNER_IDS | No | withCors | Bearer |
| 26 | GET/HEAD | `/api/admin/projects/:id/preview/*` | Session | No | PRODUCT_METRICS_OWNER_IDS | No | withCors | Bearer |
| 27 | DELETE | `/api/admin/users/:id` | Session | No | PRODUCT_METRICS_OWNER_IDS | No | withCors | Bearer |
| 28 | GET | `/api/account/ai-usage` | Session | User-scoped | No | No | withCors | Bearer |
| 29 | GET | `/api/account/deletions` | Session | User-scoped | No | No | withCors | Bearer |
| 30 | GET | `/api/account/project-quota` | Session | User-scoped | No | No | withCors | Bearer |
| 31 | POST | `/api/projects/:id/stop` | Session | isProjectOwner | No | No | withCors | Bearer |
| 32 | * | `/api/projects/:id/runtime/*` | Session | isProjectOwner | No | No | withCors | Bearer |
| 33 | GET | `/api/projects` | Session | User-scoped | No | No | withCors | Bearer |
| 34 | GET | `/api/gallery` | No | No | No | No | withCors | N/A |
| 35 | GET/PUT | `/api/projects/:id/showcase` | Session | User-scoped (via registry) | No | No | withCors | Bearer |
| 36 | POST | `/api/projects/:id/remix` | Session | No (source must be gallery) | No | No | withCors | Bearer |
| 37 | GET/PUT | `/api/projects/:id/publication` | Session | User-scoped (via registry) | No | No | withCors | Bearer |
| 38 | DELETE/PATCH | `/api/projects/:id` | Session | isProjectOwner (PATCH only) | No | No | withCors | Bearer |
| 39 | * | `/api/test/simple`, `/api/test/medium`, `/api/test/hard` | Session | No | No | modelTest bucket | withCors | Bearer |
| 40 | * | `/p/:scriptName/*` | Preview session (optional) | checkPreviewAccess | No | previewRead/Write | withCors + withPreviewPrivacy | N/A (sandboxed) |
| 41 | * | `/preview/:agentId/*` | Preview session (optional) | checkPreviewAccess | No | previewRead/Write | withCors + withPreviewPrivacy | N/A (sandboxed) |
| 42 | WS | `/agents/:name` | Session or WS ticket | authorizeOrClaim | No | No (see Finding F3) | SDK-managed | Bearer or single-use ticket |
| 43 | * | `/agents/:name` (HTTP) | Session | authorizeOrClaim | No | No (see Finding F3) | withCors | Bearer |
| 44 | * | `/api/*` (unmatched, referer-based preview proxy) | Preview session (optional) | checkPreviewAccess | No | previewRead/Write | withCors + withPreviewPrivacy | N/A |
| 45 | * | `/api/*`, `/agents/*` (unmatched) | No | No | No | No | withCors | N/A (404) |
| 46 | * | `/*` (static shell) | No | No | No | No | shellSecurityHeaders | N/A |

---

## Findings

### F1: Admin allowlist check is copy-pasted 8 times — drift risk

**Severity**: Medium | **Confidence**: High | **Label**: FACT

The admin gate `String(env.PRODUCT_METRICS_OWNER_IDS || '').split(',').map((id: string) => id.trim()).includes(user.userId)` appears as an identical inline expression at **8 separate locations**:

- `src/worker.ts:389` — `/api/admin/outcomes`
- `src/worker.ts:402` — `/api/admin/users` (GET)
- `src/worker.ts:415` — `/api/admin/projects` (GET)
- `src/worker.ts:426` — `/api/admin/projects/:id` (DELETE)
- `src/worker.ts:444` — `/api/admin/projects/:id/files`
- `src/worker.ts:462` — `/api/admin/projects/:id/preview/*`
- `src/worker.ts:482` — `/api/admin/users/:id` (DELETE)
- `src/worker.ts:389` — `/api/account/outcomes` (admin branch)

If any one instance is edited (e.g., to trim a specific ID format, or to add a regex-based allowlist), the other 7 can silently diverge. There is no shared `isAdmin()` helper. This is not currently vulnerable, but the pattern creates a latent bypass surface for any future change.

---

### F2: `/api/auth/ws-ticket` has no rate limit

**Severity**: Medium | **Confidence**: High | **Label**: FACT

At `src/worker.ts:330`, the rate limit block explicitly **exempts** `/api/auth/ws-ticket`:

```ts
if (request.method === 'POST' && url.pathname !== '/api/auth/session'
    && url.pathname !== '/api/auth/ws-ticket') {
```

Each ticket issuance writes to the Registry DO (a `POST` to `https://registry/ws-tickets`). A valid session holder can issue unlimited tickets per second, filling the Registry DO's storage and consuming latency from the singleton. The tickets are short-lived and single-use, so the abuse surface is storage exhaustion / DO saturation, not replay.

---

### F3: Agent WS and HTTP routes have no rate limit

**Severity**: Low | **Confidence**: High | **Label**: FACT

The `routeAgentRequest` path (lines 791–844) has no `checkRateLimit` call. Once authenticated, a user can make unlimited requests to the Durable Object. The DO itself may have internal limits, but there is no edge-layer rate limiting for these routes. This matters because each request wakes a DO, and AI generation requests cost inference tokens.

---

### F4: DELETE `/api/projects/:id` has no ownership check — relies entirely on registry

**Severity**: Medium | **Confidence**: High | **Label**: FACT

At `src/worker.ts:661–697`, the `DELETE` path for `/api/projects/:id` does **not** call `isProjectOwner()`:

```ts
if (url.pathname.startsWith('/api/projects/') && (request.method === 'DELETE' || request.method === 'PATCH')) {
    ...
    if (request.method === 'PATCH' && !await isProjectOwner(env, projectId, user.userId)) {
      return withCors(forbidden('You do not own this project'), origin);
    }
    // DELETE proceeds with NO ownership check here
    ...
    if (request.method === 'DELETE') {
      target.searchParams.set('userId', user.userId);
    }
```

The `userId` is attached as a query param and the registry presumably checks it. But the **Worker itself** does not verify ownership before forwarding. The safety depends entirely on the registry side enforcing that `userId` matches the project owner. If the registry route ever had a bug (e.g., using the userId as a filter but not as a hard gate), any authenticated user could delete any project.

The PATCH path has an explicit `isProjectOwner` check. The asymmetry is suspicious.

---

### F5: `verifyPreviewSession` strips Authorization header but keeps cookie

**Severity**: Low | **Confidence**: High | **Label**: FACT

At `src/lib/auth.ts:136–141`:
```ts
export async function verifyPreviewSession(request: Request, env: RegistryEnv): Promise<AuthenticatedUser | null> {
  if (!getAppSessionToken(request.headers)) return verifySession(request, env);
  const headers = new Headers(request.headers);
  headers.delete('authorization');
  return verifySession(new Request(request.url, { headers }), env);
}
```

When an `Authorization: Bearer bh_token_...` header is present (an app session token), the function strips the Authorization header and falls back to the **cookie**. This means a user's platform session cookie is used even if the app-session token is present. The purpose seems to be preventing app-session tokens (which are opaque to the platform) from being confused with platform tokens. This is correct behavior but should be documented — an app-session token holder who also has a platform cookie will be silently authenticated as the platform user.

---

### F6: Admin preview endpoint removes X-Frame-Options — controlled but notable

**Severity**: Low | **Confidence**: High | **Label**: FACT

At `src/worker.ts:474`:
```ts
headers.delete('X-Frame-Options');
```

The admin preview route intentionally removes the `X-Frame-Options: deny` header so the admin UI can iframe the project. This is correct for the use case but means an admin's authenticated session renders user-controlled HTML inside an iframe on the main origin. The preview's CSP sandbox (`previewSecurityHeaders`) is applied elsewhere but **not** on this admin preview path — the code returns the proxied response directly with only the X-Frame-Options deletion. The preview content renders with the **agent's own headers**, not the platform's sandboxing headers.

Wait — re-reading lines 465–476, the response is the raw agent response with only `Cache-Control` and `X-Frame-Options` modifications, but **without** `withPreviewPrivacy()`. This means admin previews are NOT sandboxed with the preview CSP. User-controlled content renders with full CSP of the agent's response, which may be permissive.

---

### F7: Referer-based preview proxy at unmatched /api/ routes

**Severity**: Medium | **Confidence**: Med | **Label**: INFERENCE

At `src/worker.ts:847–866`, any unmatched `/api/*` request is checked against the `Referer` header:

```ts
const referer = new URL(request.headers.get('Referer') || '');
if (referer.origin === url.origin) previewMatch = referer.pathname.match(/^\/(?:preview|p)\/([^/]+)(?:\/|$)/);
```

If the Referer shows the request came from a preview page, the request is proxied to the preview agent. The Referer is checked to be same-origin. However, `Referer` is user-controllable (spoofable via `<meta name="referrer" content="unsafe-url">` or `Referrer-Policy` override in user-generated preview content). If preview content sets its own Referrer-Policy, a crafted fetch from the preview sandbox could route arbitrary `/api/*` paths through to the agent's DO, bypassing the expected auth checks.

The `checkPreviewAccess` gate does still apply, limiting this to GET/HEAD for public reads. But the surface is wider than it appears — a user's preview could route requests to its own agent's API endpoints that are normally not accessible through the preview path.

---

### F8: `clientKey()` for rate limiting uses `cf-connecting-ip` with fallback to `x-forwarded-for`

**Severity**: Low | **Confidence**: Med | **Label**: INFERENCE

At `src/worker.ts:135–139`:
```ts
function clientKey(request: Request): string {
  return request.headers.get('cf-connecting-ip')
    || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || 'unknown';
}
```

In the Cloudflare Workers environment, `cf-connecting-ip` is set by Cloudflare's edge and is reliable. The `x-forwarded-for` fallback is used in local dev where `cf-connecting-ip` is absent. In production, this is fine.

However, the `'unknown'` fallback means that if both headers are absent (unlikely in production, possible in some edge cases), ALL such requests share the same rate-limit bucket. This could cause a denial-of-service for legitimate users if some unknown-keyed traffic fills the bucket, or bypass rate limits if the shared bucket is generous enough.

---

### F9: CSP `unsafe-eval` in shell script-src

**Severity**: Medium | **Confidence**: High | **Label**: FACT

At `src/worker.ts:212` (and `public/_headers:16`):
```
script-src 'self' 'unsafe-eval' data: blob: ...
```

`unsafe-eval` is present in the **shell** CSP (the main app, not just the preview). This is almost certainly required by Monaco editor (`eval()` for syntax highlighting). However, `data:` and `blob:` URIs in `script-src` combined with `unsafe-eval` means any XSS in the shell app can escalate to arbitrary code execution without needing to load an external script.

This is a known trade-off for embedding Monaco, but it should be documented. The preview iframe has its own separate (also permissive) CSP.

---

### F10: WebSocket upgrade responses bypass CORS headers

**Severity**: Low | **Confidence**: High | **Label**: FACT

At `src/worker.ts:841–843`:
```ts
if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
  return withCors(withPreviewPrivacy(agentResponse), origin);
}
return agentResponse;
```

WebSocket upgrade responses are returned without CORS or preview privacy headers. This is technically correct (browsers don't apply CORS to WebSocket upgrades), but the comment explains it: "copying it into a new Response drops the socket." The untouched response is safe because WS auth is handled by the ticket/session validation in `onBeforeConnect`.

---

### F11: `preview-runtime.js` served with `Access-Control-Allow-Origin: *`

**Severity**: Low | **Confidence**: High | **Label**: FACT

At `src/worker.ts:289`:
```
'Access-Control-Allow-Origin': '*'
```

The preview runtime JS is served with wildcard CORS. This is intentional — preview iframes on `null` origins need to load it. The file is public static JS with no user-specific content, so this is safe.

---

### F12: `PREVIEW_ACCESS_HEADER` stripping on every request

**Severity**: Low | **Confidence**: High | **Label**: FACT

At `src/worker.ts:293–296`:
```ts
if (request.headers.has(PREVIEW_ACCESS_HEADER)) {
  request = new Request(request);
  request.headers.delete(PREVIEW_ACCESS_HEADER);
}
```

The Worker strips any client-supplied `x-brainhalf-preview-access` header, then later injects its own verified copy via `previewRequest()` at line 184. This is correct defense-in-depth — a client cannot forge preview access level.

---

### F13: Origin check exempts Google OAuth callback and managed Google start

**Severity**: Low | **Confidence**: High | **Label**: FACT

At `src/worker.ts:268–271`:
```ts
const googleCallback = url.pathname === '/api/auth/google/callback' && request.method === 'GET';
const managedGoogleStart = url.pathname === '/api/apps/google/start' && request.method === 'GET';
if ((url.pathname.startsWith('/api/') || url.pathname.startsWith('/agents/')) && untrustedOrigin && !googleCallback && !managedGoogleStart) {
  return withCors(forbidden('Untrusted request origin'), origin);
}
```

This is correct — OAuth callbacks arrive with Google's origin, not the app's. The exemption is method-restricted to GET, preventing POST-based CSRF. The OAuth state parameter protects against cross-site request forgery for the callback itself.

---

### F14: Local dev cookie downgrade (Secure flag removal)

**Severity**: Low | **Confidence**: High | **Label**: FACT

At `src/worker.ts:377–381`:
```ts
if (url.protocol !== 'https:') {
  const cookies = response.headers.getSetCookie();
  response.headers.delete('Set-Cookie');
  for (const value of cookies) response.headers.append('Set-Cookie', value.replace('; Secure', ''));
}
```

In local development (http://), the Secure flag is stripped from cookies so they work without HTTPS. In production (https://), this code path is never hit. The check is `url.protocol !== 'https:'`, which is reliable because `url` is constructed from `request.url` at line 251.

---

### F15: `USER_ID_QUERY_PARAM` stripping is early and comprehensive

**Severity**: N/A (positive finding) | **Confidence**: High | **Label**: FACT

At `src/worker.ts:311–314`:
```ts
if (url.searchParams.has(USER_ID_QUERY_PARAM)) {
  url.searchParams.delete(USER_ID_QUERY_PARAM);
  request = new Request(url.toString(), request);
}
```

Any client-supplied `_uid` parameter is unconditionally stripped before any routing. The Worker then re-injects it after authentication via `injectUserId()`. This prevents user ID forgery. Good.

---

### F16: Single-instance bottleneck — all rate limits go through idFromName('auth')

**Severity**: Medium | **Confidence**: High | **Label**: FACT

Every `checkRateLimit()` call at `src/worker.ts:89` routes through:
```ts
const registry = env.REGISTRY.get(env.REGISTRY.idFromName('auth'));
```

This is the same singleton Registry DO that handles auth, sessions, projects, and all admin operations. Under high traffic, rate-limit checks add latency to the DO that also handles login, session verification, and project listing. A burst of rate-limit checks during a traffic spike could slow down authentication for everyone.

The code at `src/lib/auth.ts:149–154` shows a `getUserRegistry` helper that partitions by user hash, but it's not used by the Worker's rate-limit or auth paths.

---

### F17: `/api/projects/:id/remix` has no rate limit

**Severity**: Medium | **Confidence**: High | **Label**: FACT

The remix endpoint (lines 586–639) is authenticated but has no rate limit. Each remix:
1. Creates a new project in the registry
2. Exports files from the source agent DO
3. Imports files into the new agent DO

An authenticated user could rapidly create many remix projects, consuming registry storage and DO instances. The project limit enforced by the registry is the only cap, not a time-based rate.

---

## Summary

| Severity | Count |
|----------|-------|
| Critical | 0 |
| High | 0 |
| Medium | 5 (F1, F2, F4, F7, F17) |
| Low | 7 (F3, F5, F6, F8, F9, F10, F16) |
| Info | 5 (F11, F12, F13, F14, F15) |

The Worker router has a solid auth architecture — fail-closed defaults, origin validation, `_uid` stripping, single-use WS tickets, and per-route method enforcement. The main risks are:
1. **Admin gate duplication** (F1) creating a latent bypass surface
2. **Missing rate limits** on WS ticket issuance, agent routes, and remix (F2, F3, F17)
3. **DELETE without Worker-side ownership check** (F4) relying entirely on registry enforcement
4. **Referer-based routing** (F7) potentially widening the preview proxy surface
5. **Admin preview bypasses sandbox CSP** (F6)
