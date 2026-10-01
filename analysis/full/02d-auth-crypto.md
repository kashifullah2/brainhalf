# Phase 2D — Auth & Crypto Deep Manual Review

## Files reviewed:
- `src/lib/auth.ts` (459 lines) — Session verification, token extraction, project authorization
- `src/lib/crypto.ts` (266 lines) — WebCrypto helpers: HMAC, PBKDF2, SHA-256, base64url, input validation
- `src/lib/google-auth.ts` (109 lines) — Platform Google OAuth flow (PKCE)
- `src/runtime/managed-auth.ts` (250 lines) — Managed app authentication (password, Google, GitHub, magic link)
- `src/runtime/integrations.ts` (36 lines) — Cookie helpers, JSON reader
- `src/lib/runtime-config.ts` (lines 1-8) — Session secret validation

---

## 1. Token Lifecycle

### Generation (crypto.ts:185-195)
- Format: `bh_<b64url(JSON payload)>.<b64url(HMAC-SHA256(payload))>`
- Payload: `{ uid: string, iat: number, exp: number }` — no secrets, only opaque user id and timing. [FACT]
- Signed with HMAC-SHA256 using `SESSION_SECRET` env var. [FACT]
- TTL: 30 days (`TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30`). [FACT]

### Verification (crypto.ts:210-242)
1. Prefix check (`bh_`)
2. Split on last `.` to separate payload and signature
3. Decode base64url payload → parse JSON
4. Validate `uid` is string, `exp` and `iat` are numbers
5. Check expiry (`payload.exp <= now → null`)
6. HMAC verify (timing-safe) — recomputes HMAC and compares via `timingSafeEqual`
7. Compute `sha256Hex(token)` as stable `tokenId` for revocation lookup
- **Fail closed**: any step failing returns null. [FACT]

### Revocation (auth.ts:113-134)
- After signature/expiry check, `verifySession` queries the Registry's sessions table by token hash
- Registry returns userId and expiry; auth.ts double-checks `body.userId === verified.userId`
- On error (Registry unreachable), returns null (fail-closed). [FACT]
- Logout deletes the session row, making future verifications fail. [FACT]

### Session Registration (auth.ts:382-408)
- Token hash (`sha256Hex(token)`) stored in Registry, not the raw token. [FACT, excellent]
- Expiry recomputed from the signed token payload itself, not from a separate clock, to prevent drift. [FACT]

**No issues found in token lifecycle.** The chain is: generate → sign → store hash → verify signature + expiry + revocation check → fail closed. Sound.

---

## 2. Password Hashing

### Algorithm (crypto.ts:107-163)
- **PBKDF2-SHA256** with 100,000 iterations, 16-byte random salt, 32-byte derived key. [FACT]
- Serialized as `pbkdf2$100000$<saltB64url>$<hashB64url>`. [FACT]
- Salt generated per password via `crypto.getRandomValues`. [FACT]
- Verification uses `timingSafeEqual` on base64url-encoded hash strings. [FACT]

### Parsing (crypto.ts:122-128)
- `parsePasswordHash` validates format (`pbkdf2$<int>$<salt>$<hash>`), rejects if iterations < 1000. [FACT]
- This minimum threshold means if the iteration count is ever downgraded in the stored hash, it can't go below 1000. [FACT]

**FINDING D-1: PBKDF2 iterations below OWASP 2023 recommendation**
`PBKDF2_ITERATIONS = 100_000` at crypto.ts:107. OWASP's 2023 Password Storage Cheat Sheet recommends 600,000 iterations for PBKDF2-HMAC-SHA256. The current setting is 6x below recommendation. This doesn't mean passwords are insecure — 100k iterations still provides meaningful resistance — but a stolen database would be faster to brute-force than necessary.
- Severity: **Low** — 100k iterations is still considered acceptable; the main risk is in a database breach scenario.
- Confidence: **High**
- Label: **FACT** (crypto.ts:107 vs OWASP recommendation)

---

## 3. Timing-Safe Comparison

### Where used:
1. **HMAC verification** (crypto.ts:77-79): `hmacVerify` computes expected HMAC then compares via `timingSafeEqual`. [FACT]
2. **Password verification** (crypto.ts:141-148): `verifyPassword` derives candidate then compares via `timingSafeEqual`. [FACT]
3. **Managed-auth state checks** (managed-auth.ts:107, 225): GitHub and Google OAuth state params compared with `timingSafeEqual`. [FACT]

### Implementation (crypto.ts:57-64):
```ts
export function timingSafeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let mismatch = a.length ^ b.length;
  for (let i = 0; i < len; i++) {
    mismatch |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return mismatch === 0;
}
```
- XORs length first (leaks length difference but this is acceptable for fixed-length comparisons like HMAC). [FACT]
- Iterates to `max(a.length, b.length)`, padding short side with 0. [FACT]
- No early return — constant-time for same-length inputs. [FACT]

### Where NOT used:
1. **Platform Google OAuth state** (google-auth.ts:77): Uses `state !== readCookie(request)` — not timing-safe. However, state is 43-char random value (256 bits of entropy), making timing attacks computationally infeasible. Not exploitable. [FACT, no finding]

---

## 4. Session Management

### Creation:
- `handleSignup` / `handleLogin` (auth.ts:283-343): issue token → register session hash in Registry → set cookie + return token in JSON body. [FACT]
- Token returned both in response body (for SPA header-based auth) and Set-Cookie (for same-origin navigations). [FACT]

### Cookie Security (auth.ts:418-419):
```
bh_session=<token>; Max-Age=2592000; Path=/; HttpOnly; Secure; SameSite=Lax
```
- **HttpOnly**: yes — JavaScript cannot read the cookie. [FACT]
- **Secure**: yes — cookie only sent over HTTPS. In local dev, Worker strips Secure flag (worker.ts:377-381). [FACT]
- **SameSite=Lax**: yes — protects against CSRF for POST requests; allows GET navigations. [FACT]
- **Path=/**: yes — cookie sent for all paths. [FACT]
- **No Domain**: correct — cookie defaults to exact host (no subdomain sharing). [FACT]

### Logout (auth.ts:345-371):
- Deletes session row in Registry (revocation). [FACT]
- Clears cookie regardless of revocation success. [FACT]
- Returns 503 if revocation can't be confirmed (transparent to user). [FACT]

### Managed app cookies (integrations.ts:13-18):
- `secureCookie`: `Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=<seconds>` — correct. [FACT]
- Uses `__Host-` prefix (e.g., `__Host-bh_app`) which browsers enforce: requires Secure, Path=/, no Domain. [FACT, excellent defense]
- Embedded preview cookie: `SameSite=None; Partitioned` — CHIPS for cross-site iframes. [FACT]

---

## 5. WebSocket Ticket System

### Issuance (auth.ts:168-183):
- `issueWsTicket(env, userId, sessionHash)` → POST to Registry → returns random ticket string. [FACT]
- Ticket is prefixed with `bhwt_` (auth.ts:217). [FACT]
- Registry stores ticket as SHA-256 hash with 60s TTL and session back-reference (registry.ts:597-608). [FACT]

### Verification (auth.ts:191-210):
- `redeemWsIdentity` → POST to Registry `/ws-tickets/verify` → Registry atomically DELETEs the row and returns userId + sessionHash. [FACT]
- Single-use: the DELETE ensures a replayed ticket always fails. [FACT]
- Session back-check: Registry verifies the original session is still valid (registry.ts:617-632). [FACT]
- Expired tickets silently fail (no error leak). [FACT]

### Extraction (auth.ts:213-220):
- `extractWsTicket` only accepts `?ticket=` param with `bhwt_` prefix. [FACT]
- This is separate from `extractToken` which checks `?token=` — the two systems don't interfere. [FACT]

**No issues found.** The ticket system correctly mitigates the risk of long-lived session tokens appearing in WebSocket URLs and logs.

---

## 6. Google OAuth Flow (Platform)

### google-auth.ts — Authorization Code + PKCE:

1. **Start** (line 57-74):
   - Generates random state (32 bytes) and verifier (32 bytes). [FACT]
   - Stores state → verifier mapping in Registry with 600s TTL. [FACT]
   - State set in `bh_google` cookie (HttpOnly, SameSite=Lax, Secure in prod). [FACT]
   - PKCE S256 challenge computed: `base64url(SHA-256(verifier))`. [FACT]
   - Returns authorization URL to client (client navigates). [FACT]

2. **Callback** (line 76-105):
   - State validated: `state.length !== 43 || state !== readCookie(request)` — cookie-bound CSRF protection. [FACT]
   - State consumed from Registry (single-use via `/oauth/consume`). [FACT]
   - `returnTo` URL origin re-validated with `isAllowedOrigin`. [FACT, good defense against open redirect]
   - Code exchanged with Google using `code_verifier` (PKCE completion). [FACT]
   - Identity obtained from `https://openidconnect.googleapis.com/v1/userinfo` (authenticated endpoint), NOT from decoding the ID token. [FACT, excellent — avoids algorithm confusion attacks]
   - `email_verified === true` check prevents linking unverified emails. [FACT]
   - Registry conflict detection: if email exists with password account → returns `conflict` (no merge). [FACT]

3. **Complete** (line 43-53):
   - Handoff token: random 32-byte single-use key, stored in Registry with 60s TTL. [FACT]
   - Identity attached to handoff key (not in URL or cookie value). [FACT]
   - Client's final POST sends handoff key via cookie → Registry consumes → issues session. [FACT]
   - Cookie cleared after consumption. [FACT]

**No issues found.** The OAuth flow is well-implemented with PKCE, state binding, single-use tokens, and server-side identity verification.

---

## 7. Managed Auth (Runtime)

### Rate Limiting (managed-auth.ts:17-21):
- 20 requests/minute per IP (hashed). [FACT]
- 6 requests/minute per email (hashed). [FACT]
- Applied to login, signup, password operations, magic links, OAuth starts. [FACT]

### User Enumeration Defense:

**FINDING D-2: Managed-auth timing oracle via dummy hash format mismatch**
At managed-auth.ts:170-172:
```ts
const DUMMY_HASH = '$2b$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ012';
const hashToVerify = user?.password_hash || DUMMY_HASH;
const valid = isValidPassword(body.password) && await verifyPassword(body.password, hashToVerify) && user?.password_hash;
```

The intent is correct: verify a password even when the user doesn't exist to prevent timing-based user enumeration. However, `DUMMY_HASH` uses **bcrypt format** (`$2b$10$...`) while the system uses **PBKDF2** (`pbkdf2$...`). Inside `verifyPassword` (crypto.ts:141-148), `parsePasswordHash` returns `null` immediately for non-PBKDF2 formats, short-circuiting the derivation:

- **User exists**: PBKDF2 derivation runs (~50-100ms)
- **User doesn't exist**: `parsePasswordHash(DUMMY_HASH)` returns null → `verifyPassword` returns false instantly (~0ms)

This timing difference reveals whether an email is registered. An attacker sending login attempts can distinguish "email not found" (fast response) from "wrong password" (slow response).

Fix: Use a PBKDF2-format dummy hash, e.g., `pbkdf2$100000$<fixedSalt>$<fixedHash>`.
- Severity: **Medium** — user enumeration in managed (pilot) apps. Attacker learns which emails are registered.
- Confidence: **High**
- Label: **FACT** (managed-auth.ts:170-172 + crypto.ts:141-148)

### OAuth state handling:
- `timingSafeEqual` used for state comparison (managed-auth.ts:107, 225). [FACT, good]
- Session-based state with cookie binding and single-use consumption. [FACT]

### Account linking safety:
- Google/GitHub linking checks: if existing user has a *different* Google sub or GitHub id → rejects. [FACT]
- If unverified user links via OAuth: password cleared and sessions revoked (`this.store.revoke`). [FACT, excellent — prevents pre-registration attacks]

### Magic link:
- Token: 32 random bytes, stored as SHA-256 hash. [FACT]
- 30-minute TTL. [FACT]
- Previous links NOT invalidated on new issuance (managed-auth.ts:35-36): only expired ones cleaned. This prevents third-party link invalidation attacks (comment at :34). [FACT, good]
- Action lookup is re-checked after async password hashing (managed-auth.ts:143): prevents TOCTOU if account state changes during hashing. [FACT]

---

## 8. Input Validation

### Email (crypto.ts:248, 252-253):
```ts
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// length <= 254
```
- Accepts: `a@b.c`, `user+tag@example.com`, `"quoted"@example.com`
- Rejects: whitespace, multiple @, no TLD portion
- More permissive than RFC 5322 strict, but intentionally so — standard practice for signup forms. [FACT]
- Max length 254 matches RFC 5321 path limit. [FACT]
- **No ReDoS risk**: the regex has no nested quantifiers. [FACT]

### Password (crypto.ts:250, 256-258):
```ts
const PASSWORD_RE = /^[\x21-\x7e]{8,512}$/;
```
- Printable ASCII only (! through ~), 8-512 chars. [FACT]
- Excludes space (`\x20`), which prevents confusion with trimming. [FACT]
- No ReDoS risk. [FACT]
- Excludes non-ASCII (emoji, accented chars). This is a deliberate choice, not a bug. [FACT]

### Project ID (crypto.ts:261, 263-265):
```ts
const PROJECT_ID_RE = /^[a-zA-Z0-9_-]{1,128}$/;
```
- Alphanumeric + underscore + hyphen, 1-128 chars. [FACT]
- Safe for use in URLs, headers, and DO names. No injection risk. [FACT]

### Session Secret (runtime-config.ts:1-8):
- Requires at least 32 non-padding characters after trimming and stripping trailing `=`. [FACT]
- Does NOT validate entropy quality, but this is an env var set by the operator. [INFERENCE, Low concern]

---

## 9. Dead Code

### getUserRegistry (auth.ts:150-154):
- **Exported but never called.** Confirmed: only one grep hit (the definition). [FACT]
- Intent was to shard the Registry DO by user hash to avoid the singleton bottleneck. Never wired up.
- Already documented in Finding R-4 (02a-auth-registry.md).

---

## 10. Other Crypto Observations

### Random ID generation (crypto.ts:47-51):
- Uses `crypto.getRandomValues` for all random values. [FACT, correct]
- WS tickets: 32 bytes = 256 bits of entropy. [FACT]
- OAuth state: 32 bytes = 256 bits of entropy. [FACT]

### No use of `Math.random()`:
All crypto-random values use `crypto.getRandomValues`. No `Math.random()` calls found in security-sensitive paths. [FACT]

### Base64url implementation (crypto.ts:15-41):
Standard implementation using `btoa`/`atob` with URL-safe character replacement. Handles padding correctly. [FACT]

---

## Summary of Findings

| ID | Finding | Severity | Confidence | Label |
|---|---|---|---|---|
| D-1 | PBKDF2 iterations (100k) below OWASP recommendation (600k) | Low | High | FACT |
| D-2 | Managed-auth timing oracle: bcrypt-format dummy hash short-circuits PBKDF2 | Medium | High | FACT |

### Positive findings (done well):
- HMAC-SHA256 token signing with fail-closed verification chain (crypto.ts:210-242, auth.ts:113-134)
- `timingSafeEqual` used for all security-critical comparisons (crypto.ts:57-64)
- Session tokens stored as SHA-256 hashes — DB leak cannot forge sessions (auth.ts:383)
- Cookie flags: HttpOnly, Secure, SameSite=Lax, Path=/ (auth.ts:418-419)
- Managed app cookies use `__Host-` prefix for strongest binding (integrations.ts:13-14)
- Google OAuth: PKCE S256, cookie-bound state, identity from userinfo endpoint, email_verified check (google-auth.ts)
- WS tickets: single-use, short-lived (60s), hash-stored, session back-check (auth.ts:168-210)
- Conservative OAuth conflict handling — no unsafe account merges (google-auth.ts:99)
- Managed auth pre-registration defense: password cleared and sessions revoked on OAuth proof (managed-auth.ts:72-73, 86-87)
- Magic link anti-invalidation: new issuance doesn't kill existing valid links (managed-auth.ts:35-36)
- TOCTOU re-check after password hashing (managed-auth.ts:143)
- Session secret validation requires >= 32 non-padding chars (runtime-config.ts:1-8)
- No `Math.random()` in security paths; all randomness from `crypto.getRandomValues`
- Input validation regexes are safe from ReDoS
