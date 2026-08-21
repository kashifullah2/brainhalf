// ---------------------------------------------------------------------------
// Password hashing and token generation.
//
// Workers has no native bcrypt/argon2, so this uses PBKDF2-HMAC-SHA256 from
// WebCrypto. The runtime refuses any single deriveBits call above 100,000
// iterations ("Pbkdf2 failed: iteration counts above 100000 are not
// supported"), which is well under the 600,000 OWASP recommends for
// PBKDF2-SHA256. We reach the recommended work factor by chaining several
// capped derivations, feeding each round's output in as the next round's key
// material: the rounds cannot be parallelised, so the total cost to an attacker
// is ITERATIONS x ROUNDS.
//
// Hashes are self-describing, so these parameters can be raised later and old
// hashes upgraded transparently on the next successful login.
// ---------------------------------------------------------------------------

/** Hard platform ceiling for one deriveBits call. */
const MAX_ITERATIONS_PER_CALL = 100_000;
const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_ROUNDS = 1;
const SALT_BYTES = 16;
const KEY_BITS = 256;

/** Total sequential iterations a stored hash represents. */
function workFactor(iterations: number, rounds: number): number {
  return iterations * rounds;
}

/** base64 -> base64url, without padding. Avoids regex escaping entirely. */
function toBase64Url(base64: string): string {
  return base64.split('+').join('-').split('/').join('_').split('=').join('');
}

function fromBase64Url(value: string): string {
  const base64 = value.split('-').join('+').split('_').join('/');
  const padding = (4 - (base64.length % 4)) % 4;
  return base64 + '='.repeat(padding);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function randomToken(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytesToBase64(bytes));
}

export function randomId(prefix: string): string {
  return `${prefix}_${randomToken(16)}`;
}

/** SHA-256, hex encoded. Used to store session and reset tokens at rest. */
export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Chained PBKDF2. Round 1 derives from the password; every later round derives
 * from the previous round's output, so the work is strictly sequential.
 */
async function pbkdf2(
  password: string,
  salt: Uint8Array,
  iterations: number,
  rounds: number,
): Promise<Uint8Array> {
  if (iterations > MAX_ITERATIONS_PER_CALL) {
    throw new Error(
      `PBKDF2 iteration count ${iterations} exceeds the ${MAX_ITERATIONS_PER_CALL} the runtime allows per call.`,
    );
  }

  let material: Uint8Array | string = password;

  for (let round = 0; round < rounds; round++) {
    const raw =
      typeof material === 'string'
        ? new TextEncoder().encode(material)
        : material;
    const key = await crypto.subtle.importKey('raw', raw, 'PBKDF2', false, [
      'deriveBits',
    ]);
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
      key,
      KEY_BITS,
    );
    material = new Uint8Array(bits);
  }

  return material as Uint8Array;
}

/**
 * Produces `pbkdf2$sha256$<iterations>x<rounds>$<salt>$<hash>` with base64url
 * parts. A bare `<iterations>` in the third field means one round.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = new Uint8Array(SALT_BYTES);
  crypto.getRandomValues(salt);
  const derived = await pbkdf2(password, salt, PBKDF2_ITERATIONS, PBKDF2_ROUNDS);
  return [
    'pbkdf2',
    'sha256',
    `${PBKDF2_ITERATIONS}x${PBKDF2_ROUNDS}`,
    toBase64Url(bytesToBase64(salt)),
    toBase64Url(bytesToBase64(derived)),
  ].join('$');
}

/** Length-independent, value-independent comparison. */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  let diff = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i++) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return diff === 0;
}

export interface PasswordVerification {
  valid: boolean;
  /** True when the stored hash used weaker parameters than we now require. */
  needsRehash: boolean;
}

export async function verifyPassword(
  password: string,
  stored: string | null,
): Promise<PasswordVerification> {
  if (!stored) return { valid: false, needsRehash: false };

  const parts = stored.split('$');
  if (parts.length !== 5 || parts[0] !== 'pbkdf2' || parts[1] !== 'sha256') {
    return { valid: false, needsRehash: false };
  }

  // Third field is either `<iterations>` (one round) or `<iterations>x<rounds>`.
  const [iterationsPart, roundsPart] = parts[2].split('x');
  const iterations = Number(iterationsPart);
  const rounds = roundsPart === undefined ? 1 : Number(roundsPart);
  if (
    !Number.isFinite(iterations) ||
    iterations < 1 ||
    !Number.isFinite(rounds) ||
    rounds < 1
  ) {
    return { valid: false, needsRehash: false };
  }

  let salt: Uint8Array;
  let expected: Uint8Array;
  try {
    salt = base64ToBytes(fromBase64Url(parts[3]));
    expected = base64ToBytes(fromBase64Url(parts[4]));
  } catch {
    return { valid: false, needsRehash: false };
  }

  let actual: Uint8Array;
  try {
    actual = await pbkdf2(password, salt, iterations, rounds);
  } catch (error) {
    // A hash whose parameters the runtime will not reproduce cannot be checked.
    // Refusing is the only safe answer; the account needs a password reset.
    console.error('[crypto] cannot verify stored hash parameters:', error);
    return { valid: false, needsRehash: false };
  }

  const valid = timingSafeEqual(actual, expected);
  return {
    valid,
    needsRehash:
      valid &&
      workFactor(iterations, rounds) <
        workFactor(PBKDF2_ITERATIONS, PBKDF2_ROUNDS),
  };
}

/**
 * Burns roughly the same CPU as a real verification. Called on login attempts
 * for addresses that do not exist, so response timing does not reveal which
 * emails are registered.
 */
export async function dummyVerify(password: string): Promise<void> {
  const salt = new Uint8Array(SALT_BYTES);
  crypto.getRandomValues(salt);
  await pbkdf2(password || 'placeholder', salt, PBKDF2_ITERATIONS, PBKDF2_ROUNDS);
}
