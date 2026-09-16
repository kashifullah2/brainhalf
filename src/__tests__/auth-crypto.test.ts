import { describe, it, expect } from 'vitest';
import {
  TOKEN_PREFIX,
  TOKEN_TTL_SECONDS,
  base64urlDecode,
  base64urlDecodeString,
  base64urlEncode,
  base64urlEncodeString,
  hashPassword,
  hmacSign,
  hmacVerify,
  isValidEmail,
  isValidPassword,
  isValidProjectId,
  issueToken,
  parsePasswordHash,
  randomId,
  serializePasswordHash,
  sha256Hex,
  timingSafeEqual,
  verifyPassword,
  verifyTokenSignature,
} from '../lib/crypto';

const SECRET = 'test-session-secret-must-be-at-least-32-chars-long';
const OTHER_SECRET = 'a-completely-different-secret-also-32-chars-long';

describe('P1 Auth — base64url codec', () => {
  it('round-trips arbitrary bytes', () => {
    for (const sample of ['', 'a', 'ab', 'abc', 'hello world', 'PBKDF2$Salt##', '{{</script>}}']) {
      const encoded = base64urlEncodeString(sample);
      expect(base64urlDecodeString(encoded)).toBe(sample);
    }
  });

  it('produces URL-safe, padding-free output', () => {
    const bytes = new Uint8Array([0xfb, 0xff, 0xbf]);
    const encoded = base64urlEncode(bytes);
    expect(encoded).not.toMatch(/[+/=]/);
    expect(base64urlDecode(encoded)).toEqual(bytes);
  });

  it('rejects malformed input instead of throwing', () => {
    expect(base64urlDecode('!!!not-base64!!!')).toBeNull();
    expect(base64urlDecodeString('!!!')).toBeNull();
  });
});

describe('P1 Auth — HMAC signing', () => {
  it('verifies a signature over the same message', async () => {
    const sig = await hmacSign(SECRET, 'payload.abc');
    expect(await hmacVerify(SECRET, 'payload.abc', sig)).toBe(true);
  });

  it('rejects a signature from a different secret', async () => {
    const sig = await hmacSign(SECRET, 'payload.abc');
    expect(await hmacVerify(OTHER_SECRET, 'payload.abc', sig)).toBe(false);
  });

  it('rejects a signature over a tampered message', async () => {
    const sig = await hmacSign(SECRET, 'payload.abc');
    expect(await hmacVerify(SECRET, 'payload.evil', sig)).toBe(false);
  });
});

describe('P1 Auth — PBKDF2 password hashing', () => {
  it('round-trips a password through hash/verify', async () => {
    const stored = await hashPassword('correct horse battery staple');
    expect(stored.startsWith('pbkdf2$')).toBe(true);
    expect(await verifyPassword('correct horse battery staple', stored)).toBe(true);
  });

  it('rejects the wrong password', async () => {
    const stored = await hashPassword('correct horse battery staple');
    expect(await verifyPassword('wrong password', stored)).toBe(false);
  });

  it('uses a fresh random salt per hash', async () => {
    const a = await hashPassword('same-password');
    const b = await hashPassword('same-password');
    expect(a).not.toBe(b);
    expect(await verifyPassword('same-password', a)).toBe(true);
    expect(await verifyPassword('same-password', b)).toBe(true);
  });

  it('parses and re-serializes its own format', () => {
    const stored = `pbkdf2$100000$${base64urlEncodeString('sixteen-byte-salt')}$${base64urlEncodeString('hash-value')}`;
    const parsed = parsePasswordHash(stored);
    expect(parsed).not.toBeNull();
    expect(parsed!.iterations).toBe(100000);
    expect(serializePasswordHash(parsed!)).toBe(stored);
  });

  it('refuses degenerate or foreign hash strings', async () => {
    expect(parsePasswordHash('plaintext-password')).toBeNull();
    expect(parsePasswordHash('pbkdf2$abc$xx$yy')).toBeNull(); // non-numeric iterations
    expect(parsePasswordHash('pbkdf2$999$xx$yy')).toBeNull(); // below the floor
    expect(parsePasswordHash('pbkdf2$1000$only-three-parts')).toBeNull();
    await expect(verifyPassword('x', '$argon2id$v=19$whatever')).resolves.toBe(false);
  });
});

describe('P1 Auth — HMAC-signed session tokens', () => {
  it('issues a token with the expected shape and a verified signature', async () => {
    const { token, payload } = await issueToken(SECRET, 'user-123');
    expect(token.startsWith(TOKEN_PREFIX)).toBe(true);
    expect(payload.uid).toBe('user-123');
    expect(payload.exp).toBeGreaterThan(payload.iat);
    expect(await verifyTokenSignature(token, SECRET)).not.toBeNull();
  });

  it('exposes the user id and a stable revocation id', async () => {
    const { token } = await issueToken(SECRET, 'user-123');
    const verified = await verifyTokenSignature(token, SECRET);
    expect(verified).not.toBeNull();
    expect(verified!.userId).toBe('user-123');
    // The revocation id is the hash of the full token, so it is stable.
    expect(verified!.tokenId).toBe(await sha256Hex(token));
  });

  it('rejects a token verified with a different secret', async () => {
    const { token } = await issueToken(SECRET, 'user-123');
    expect(await verifyTokenSignature(token, OTHER_SECRET)).toBeNull();
  });

  it('rejects a tampered payload (signature covers the payload bytes)', async () => {
    const { token } = await issueToken(SECRET, 'user-123');
    const body = token.slice(TOKEN_PREFIX.length);
    const [payloadB64, sig] = body.split('.');
    // Escalate uid in the decoded payload, keep the original signature.
    const tamperedPayload = JSON.parse(base64urlDecodeString(payloadB64)!);
    tamperedPayload.uid = 'user-admin';
    const tampered = TOKEN_PREFIX + base64urlEncodeString(JSON.stringify(tamperedPayload)) + '.' + sig;
    expect(await verifyTokenSignature(tampered, SECRET)).toBeNull();
  });

  it('rejects an expired token', async () => {
    const { token } = await issueToken(SECRET, 'user-123', -60);
    expect(await verifyTokenSignature(token, SECRET)).toBeNull();
  });

  it('uses the documented 30-day TTL by default', () => {
    expect(TOKEN_TTL_SECONDS).toBe(60 * 60 * 24 * 30);
  });

  it('fails closed on malformed tokens', async () => {
    expect(await verifyTokenSignature(null, SECRET)).toBeNull();
    expect(await verifyTokenSignature(undefined, SECRET)).toBeNull();
    expect(await verifyTokenSignature('', SECRET)).toBeNull();
    expect(await verifyTokenSignature('bh_nosignature', SECRET)).toBeNull();
    expect(await verifyTokenSignature('bh_..', SECRET)).toBeNull();
    expect(await verifyTokenSignature('not-a-token.at.all', SECRET)).toBeNull();
    expect(await verifyTokenSignature('bh_not-base64!.sig', SECRET)).toBeNull();
  });

  it('fails closed on a payload with a missing or non-string uid', async () => {
    const forged = async (payload: any) => {
      const payloadB64 = base64urlEncodeString(JSON.stringify(payload));
      const sig = await hmacSign(SECRET, payloadB64);
      return TOKEN_PREFIX + payloadB64 + '.' + sig;
    };
    expect(await verifyTokenSignature(await forged({ uid: '' }), SECRET)).toBeNull();
    expect(await verifyTokenSignature(await forged({ uid: 1234 }), SECRET)).toBeNull();
    expect(await verifyTokenSignature(await forged({ foo: 'bar' }), SECRET)).toBeNull();
    expect(await verifyTokenSignature(await forged({ uid: 'user-1', exp: 'soon' }), SECRET)).toBeNull();
  });
});

describe('P1 Auth — input validation', () => {
  it('validates email shape and length', () => {
    expect(isValidEmail('user@example.com')).toBe(true);
    expect(isValidEmail('USER@EXAMPLE.COM')).toBe(true);
    expect(isValidEmail('a@b.co')).toBe(true);
    expect(isValidEmail('not-an-email')).toBe(false);
    expect(isValidEmail('missing@domain')).toBe(false);
    expect(isValidEmail('@example.com')).toBe(false);
    expect(isValidEmail('space in@example.com')).toBe(false);
    expect(isValidEmail(12345)).toBe(false);
    expect(isValidEmail('a'.repeat(255) + '@example.com')).toBe(false);
  });

  it('requires printable-ASCII passwords of at least 8 characters', () => {
    expect(isValidPassword('password')).toBe(true);
    expect(isValidPassword('P@ssw0rd!')).toBe(true);
    expect(isValidPassword('short')).toBe(false);
    expect(isValidPassword('has space')).toBe(false);
    expect(isValidPassword('含漢字的密碼')).toBe(false);
    expect(isValidPassword(null)).toBe(false);
  });

  it('restricts project ids to a DO-name-safe charset', () => {
    expect(isValidProjectId('proj-abc_123')).toBe(true);
    expect(isValidProjectId('a')).toBe(true);
    expect(isValidProjectId('proj/../../etc')).toBe(false);
    expect(isValidProjectId('proj with space')).toBe(false);
    expect(isValidProjectId('proj.evil')).toBe(false);
    expect(isValidProjectId('a'.repeat(129))).toBe(false);
    expect(isValidProjectId(42)).toBe(false);
  });
});

describe('P1 Auth — helpers', () => {
  it('compares strings in constant time and length-mismatches safely', () => {
    expect(timingSafeEqual('abc', 'abc')).toBe(true);
    expect(timingSafeEqual('abc', 'abd')).toBe(false);
    expect(timingSafeEqual('abc', 'abcd')).toBe(false);
    expect(timingSafeEqual('', '')).toBe(true);
  });

  it('hashes deterministically for revocation lookups', async () => {
    expect(await sha256Hex('token-a')).toBe(await sha256Hex('token-a'));
    expect(await sha256Hex('token-a')).not.toBe(await sha256Hex('token-b'));
  });

  it('generates unique, prefixed random ids', () => {
    const a = randomId('usr_');
    const b = randomId('usr_');
    expect(a.startsWith('usr_')).toBe(true);
    expect(a).not.toBe(b);
    expect(randomId().length).toBeGreaterThan(8);
  });
});
