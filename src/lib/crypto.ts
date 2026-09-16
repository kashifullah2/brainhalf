/**
 * Zero-dependency WebCrypto helpers shared by the Worker, the AuthRegistry
 * Durable Object and the browser. WebCrypto is available in all three runtimes
 * (Workers, browsers, and Node >= 19 via globalThis.crypto), so the same code
 * path is used everywhere — no bcrypt/native dependency, no node-only polyfill.
 */

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();

/* ------------------------------------------------------------------ */
/* base64url (spec-compliant, URL-safe, no padding)                    */
/* ------------------------------------------------------------------ */

export function base64urlEncode(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (let i = 0; i < view.length; i++) binary += String.fromCharCode(view[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64urlDecode(input: string): Uint8Array | null {
  try {
    const padded = input.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

export function base64urlEncodeString(str: string): string {
  return base64urlEncode(TEXT_ENCODER.encode(str));
}

export function base64urlDecodeString(input: string): string | null {
  const bytes = base64urlDecode(input);
  return bytes ? TEXT_DECODER.decode(bytes) : null;
}

/* ------------------------------------------------------------------ */
/* Random ids                                                         */
/* ------------------------------------------------------------------ */

export function randomId(prefix: string = '', byteLength: number = 18): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return `${prefix}${base64urlEncode(bytes)}`;
}

/* ------------------------------------------------------------------ */
/* Constant-time comparison (never leak via timing)                    */
/* ------------------------------------------------------------------ */

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

/* ------------------------------------------------------------------ */
/* HMAC-SHA256 — session token signing                                 */
/* ------------------------------------------------------------------ */

export async function hmacSign(secret: string, message: string): Promise<string> {
  const key = await importHmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, TEXT_ENCODER.encode(message));
  return base64urlEncode(sig);
}

export async function hmacVerify(secret: string, message: string, signature: string): Promise<boolean> {
  const expected = await hmacSign(secret, message);
  return timingSafeEqual(expected, signature);
}

export async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    TEXT_ENCODER.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

/* ------------------------------------------------------------------ */
/* SHA-256 (token hashes for revocation, integrity checks)             */
/* ------------------------------------------------------------------ */

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', TEXT_ENCODER.encode(input));
  const view = new Uint8Array(digest);
  let hex = '';
  for (let i = 0; i < view.length; i++) hex += view[i].toString(16).padStart(2, '0');
  return hex;
}

/* ------------------------------------------------------------------ */
/* PBKDF2-SHA256 — password hashing                                    */
/* ------------------------------------------------------------------ */

export const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_SALT_BYTES = 16;
const PBKDF2_KEY_BYTES = 32;

export interface PasswordHash {
  iterations: number;
  salt: string; // base64
  hash: string; // base64
}

/** Serialize as `pbkdf2$<iterations>$<saltB64>$<hashB64>`. */
export function serializePasswordHash(h: PasswordHash): string {
  return `pbkdf2$${h.iterations}$${h.salt}$${h.hash}`;
}

export function parsePasswordHash(stored: string): PasswordHash | null {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return null;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < 1000) return null;
  return { iterations, salt: parts[2], hash: parts[3] };
}

export async function hashPassword(password: string): Promise<string> {
  const salt = new Uint8Array(PBKDF2_SALT_BYTES);
  crypto.getRandomValues(salt);
  const hash = await derivePbkdf2(password, salt, PBKDF2_ITERATIONS);
  return serializePasswordHash({
    iterations: PBKDF2_ITERATIONS,
    salt: base64urlEncode(salt),
    hash: base64urlEncode(hash),
  });
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parsed = parsePasswordHash(stored);
  if (!parsed) return false;
  const salt = base64urlDecode(parsed.salt);
  if (!salt) return false;
  const candidate = await derivePbkdf2(password, salt, parsed.iterations);
  return timingSafeEqual(base64urlEncode(candidate), parsed.hash);
}

async function derivePbkdf2(
  password: string,
  salt: Uint8Array,
  iterations: number
): Promise<ArrayBuffer> {
  const keyMaterial = await crypto.subtle.importKey('raw', TEXT_ENCODER.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  return crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    keyMaterial,
    PBKDF2_KEY_BYTES * 8
  );
}

/* ------------------------------------------------------------------ */
/* Session tokens — HMAC-signed, expiring, revocable                   */
/* ------------------------------------------------------------------ */

export interface TokenPayload {
  uid: string;
  iat: number; // issued at (seconds)
  exp: number; // expires at (seconds)
}

export const TOKEN_PREFIX = 'bh_';
/** 30 days, in seconds. */
export const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;

/**
 * Issue a token: `bh_<b64url(payload)>.<b64url(hmac(payload))>`.
 * The HMAC covers the base64url payload, so any tampering with the payload
 * invalidates the signature. The payload is *not* encrypted — it must never
 * carry secrets, only an opaque user id and timing.
 */
export async function issueToken(
  secret: string,
  userId: string,
  ttlSeconds: number = TOKEN_TTL_SECONDS
): Promise<{ token: string; payload: TokenPayload }> {
  const now = Math.floor(Date.now() / 1000);
  const payload: TokenPayload = { uid: userId, iat: now, exp: now + ttlSeconds };
  const payloadB64 = base64urlEncodeString(JSON.stringify(payload));
  const sig = await hmacSign(secret, payloadB64);
  return { token: `${TOKEN_PREFIX}${payloadB64}.${sig}`, payload };
}

export interface VerifiedToken {
  userId: string;
  tokenId: string; // stable id for revocation lookups
  exp: number;
}

/**
 * Verify a token's signature and expiry. Returns null on any failure —
 * malformed, bad signature, wrong prefix, or expired. **Fail closed.**
 *
 * Callers must *additionally* check the revocation store (sessions table)
 * before trusting the result.
 */
export async function verifyTokenSignature(token: string | null | undefined, secret: string): Promise<VerifiedToken | null> {
  if (!token || typeof token !== 'string') return null;
  if (!token.startsWith(TOKEN_PREFIX)) return null;

  const body = token.slice(TOKEN_PREFIX.length);
  const dotIndex = body.lastIndexOf('.');
  if (dotIndex < 1) return null;

  const payloadB64 = body.slice(0, dotIndex);
  const sig = body.slice(dotIndex + 1);
  if (!payloadB64 || !sig) return null;

  const payloadJson = base64urlDecodeString(payloadB64);
  if (!payloadJson) return null;

  let payload: TokenPayload;
  try {
    payload = JSON.parse(payloadJson);
  } catch {
    return null;
  }
  if (!payload || typeof payload.uid !== 'string' || !payload.uid) return null;
  if (typeof payload.exp !== 'number' || typeof payload.iat !== 'number') return null;

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp <= now) return null;

  const valid = await hmacVerify(secret, payloadB64, sig);
  if (!valid) return null;

  const tokenId = await sha256Hex(token);
  return { userId: payload.uid, tokenId, exp: payload.exp };
}

/* ------------------------------------------------------------------ */
/* Input validation                                                    */
/* ------------------------------------------------------------------ */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// bcrypt-style, but really just: printable ASCII, 8-512 chars, no whitespace.
const PASSWORD_RE = /^[\x21-\x7e]{8,512}$/;

export function isValidEmail(email: unknown): email is string {
  return typeof email === 'string' && email.length <= 254 && EMAIL_RE.test(email.trim().toLowerCase());
}

export function isValidPassword(password: unknown): password is string {
  return typeof password === 'string' && PASSWORD_RE.test(password);
}

/** Project ids are the Durable Object instance names — restrict the charset. */
const PROJECT_ID_RE = /^[a-zA-Z0-9_-]{1,128}$/;

export function isValidProjectId(id: unknown): id is string {
  return typeof id === 'string' && PROJECT_ID_RE.test(id);
}
