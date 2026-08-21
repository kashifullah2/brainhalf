// ---------------------------------------------------------------------------
// Google ID token verification.
//
// The previous implementation base64-decoded the token in the browser and
// trusted the payload (src/context/AuthContext.tsx `parseJwt`). Anyone could
// hand-craft a token for any email. This verifies the RS256 signature against
// Google's published keys and checks every claim that matters.
// ---------------------------------------------------------------------------

const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const ACCEPTED_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
/** Tolerance for clock skew between Google and the edge, in seconds. */
const CLOCK_SKEW_SECONDS = 60;
/** How long a fetched key set is reused. Google rotates keys over days. */
const JWKS_TTL_SECONDS = 3600;
/**
 * Floor between forced refetches. Without it, a token carrying a made-up `kid`
 * would send this to Google on every request -- an amplifier anyone could aim
 * at us by posting garbage to /api/auth/google.
 */
const FORCED_REFETCH_MIN_INTERVAL_MS = 60_000;

export interface GoogleIdentity {
  sub: string;
  email: string;
  emailVerified: boolean;
  firstName: string;
  lastName: string;
  picture: string | null;
}

interface Jwk {
  kid: string;
  kty: string;
  alg?: string;
  n: string;
  e: string;
}

interface JwtHeader {
  alg?: string;
  kid?: string;
}

interface GoogleClaims {
  iss?: string;
  aud?: string;
  sub?: string;
  exp?: number;
  iat?: number;
  nbf?: number;
  email?: string;
  email_verified?: boolean | string;
  given_name?: string;
  family_name?: string;
  name?: string;
  picture?: string;
}

/** Per-isolate key set. Isolates are reused across requests, so this hits. */
let jwksCache: { keys: Jwk[]; expiresAt: number } | null = null;
let lastForcedFetchAt = 0;

/**
 * Returns Google's signing keys, from memory when they are still fresh.
 *
 * The previous version fetched on every single verification and relied on the
 * Cache-Control of Google's response to make that cheap. It does not: a plain
 * `fetch` to a third-party origin is not cached unless it is asked to be, so
 * every sign-in paid a full round trip to googleapis.com before it could even
 * look at the token. Two caches now sit in front of it -- the module-level one
 * below (per isolate, free) and the edge cache via `cf.cacheTtl` (shared across
 * isolates in the same colo).
 */
async function fetchJwks(options: { bypassCache?: boolean } = {}): Promise<Jwk[]> {
  if (!options.bypassCache && jwksCache && jwksCache.expiresAt > Date.now()) {
    return jwksCache.keys;
  }

  const response = await fetch(GOOGLE_JWKS_URL, {
    headers: { Accept: 'application/json' },
    // cacheTtl 0 on a forced refetch is what makes the refetch meaningful --
    // reading the same stale set out of the edge cache would defeat the point.
    cf: {
      cacheTtl: options.bypassCache ? 0 : JWKS_TTL_SECONDS,
      cacheEverything: !options.bypassCache,
    },
  });
  if (!response.ok) {
    throw new Error(`Could not fetch Google signing keys (${response.status}).`);
  }
  const body = (await response.json()) as { keys?: Jwk[] };
  if (!Array.isArray(body.keys) || body.keys.length === 0) {
    throw new Error('Google returned an empty key set.');
  }

  jwksCache = { keys: body.keys, expiresAt: Date.now() + JWKS_TTL_SECONDS * 1000 };
  return body.keys;
}

function base64UrlToBytes(value: string): Uint8Array {
  const base64 = value.split('-').join('+').split('_').join('/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function base64UrlToString(value: string): string {
  return new TextDecoder().decode(base64UrlToBytes(value));
}

/**
 * Verifies signature, issuer, audience and expiry. Throws on any failure —
 * callers must treat a thrown error as "not authenticated", never as a warning.
 */
export async function verifyGoogleIdToken(
  idToken: string,
  expectedClientId: string,
): Promise<GoogleIdentity> {
  if (!expectedClientId) {
    throw new Error('GOOGLE_CLIENT_ID is not configured on the server.');
  }

  const segments = idToken.split('.');
  if (segments.length !== 3) {
    throw new Error('Malformed ID token.');
  }
  const [headerPart, payloadPart, signaturePart] = segments;

  let header: JwtHeader;
  let claims: GoogleClaims;
  try {
    header = JSON.parse(base64UrlToString(headerPart)) as JwtHeader;
    claims = JSON.parse(base64UrlToString(payloadPart)) as GoogleClaims;
  } catch {
    throw new Error('Malformed ID token.');
  }

  // Reject `alg: none` and anything that is not the algorithm Google uses.
  if (header.alg !== 'RS256') {
    throw new Error(`Unsupported token algorithm: ${header.alg ?? 'none'}.`);
  }
  if (!header.kid) {
    throw new Error('ID token has no key id.');
  }

  let jwk = (await fetchJwks()).find((key) => key.kid === header.kid);
  // A cached set can predate a rotation, in which case a perfectly valid token
  // would be rejected until the TTL lapsed. Refetch once before giving up, but
  // no more often than the interval above allows.
  if (!jwk && Date.now() - lastForcedFetchAt > FORCED_REFETCH_MIN_INTERVAL_MS) {
    lastForcedFetchAt = Date.now();
    jwk = (await fetchJwks({ bypassCache: true })).find(
      (key) => key.kid === header.kid,
    );
  }
  if (!jwk) {
    throw new Error('ID token was signed with an unknown key.');
  }

  const publicKey = await crypto.subtle.importKey(
    'jwk',
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );

  const signatureValid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    publicKey,
    base64UrlToBytes(signaturePart),
    new TextEncoder().encode(`${headerPart}.${payloadPart}`),
  );
  if (!signatureValid) {
    throw new Error('ID token signature is invalid.');
  }

  // --- Claims ---------------------------------------------------------------
  if (!claims.iss || !ACCEPTED_ISSUERS.includes(claims.iss)) {
    throw new Error('ID token has an unexpected issuer.');
  }
  const isAudValid = Array.isArray(claims.aud)
    ? (claims.aud as string[]).includes(expectedClientId)
    : claims.aud === expectedClientId;

  if (!isAudValid) {
    throw new Error('ID token was not issued for this application.');
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (typeof claims.exp !== 'number' || claims.exp + CLOCK_SKEW_SECONDS < nowSeconds) {
    throw new Error('ID token has expired.');
  }
  if (typeof claims.nbf === 'number' && claims.nbf - CLOCK_SKEW_SECONDS > nowSeconds) {
    throw new Error('ID token is not yet valid.');
  }
  if (typeof claims.iat === 'number' && claims.iat - CLOCK_SKEW_SECONDS > nowSeconds) {
    throw new Error('ID token was issued in the future.');
  }

  if (!claims.sub) {
    throw new Error('ID token has no subject.');
  }
  const email = typeof claims.email === 'string' ? claims.email.trim().toLowerCase() : '';
  if (!email) {
    throw new Error('ID token contains no email address.');
  }

  // Google sends this as a boolean or the string "true" depending on the flow.
  const emailVerified = claims.email_verified === true || claims.email_verified === 'true';
  if (!emailVerified) {
    throw new Error('Google has not verified this email address.');
  }

  const nameParts = (claims.name ?? '').trim().split(' ');
  return {
    sub: claims.sub,
    email,
    emailVerified,
    firstName: claims.given_name?.trim() || nameParts[0] || email.split('@')[0],
    lastName: claims.family_name?.trim() || nameParts.slice(1).join(' '),
    picture: claims.picture ?? null,
  };
}
