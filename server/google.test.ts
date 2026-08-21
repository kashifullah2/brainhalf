import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { verifyGoogleIdToken } from './google';

// ---------------------------------------------------------------------------
// These tests mint real RS256 tokens with a throwaway key pair and serve that
// key pair's public half as Google's JWKS. Nothing is stubbed inside google.ts,
// so the signature check under test is the same code path a real sign-in takes.
// ---------------------------------------------------------------------------

const CLIENT_ID = '1234567890-abcdef.apps.googleusercontent.com';
const KID = 'test-key-1';

let keyPair: CryptoKeyPair;
let otherKeyPair: CryptoKeyPair;
let fetchMock: ReturnType<typeof vi.fn>;

function b64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).split('+').join('-').split('/').join('_').replace(/=+$/, '');
}

function b64urlJson(value: unknown): string {
  return b64url(new TextEncoder().encode(JSON.stringify(value)));
}

async function generateRsaKeyPair(): Promise<CryptoKeyPair> {
  return (await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
}

function baseClaims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1000);
  return {
    iss: 'https://accounts.google.com',
    aud: CLIENT_ID,
    sub: '1029384756',
    iat: now,
    exp: now + 3600,
    // Deliberately mixed case with a trailing space -- the identity that comes
    // back must be normalised, because it is used to look up the user row.
    email: 'Person@Example.com ',
    email_verified: true,
    given_name: 'Ada',
    family_name: 'Lovelace',
    name: 'Ada Lovelace',
    picture: 'https://lh3.googleusercontent.com/a/abc',
    ...overrides,
  };
}

async function signToken(
  claims: Record<string, unknown> = baseClaims(),
  options: { header?: Record<string, unknown>; signWith?: CryptoKeyPair } = {},
): Promise<string> {
  const header = options.header ?? { alg: 'RS256', kid: KID, typ: 'JWT' };
  const signingInput = `${b64urlJson(header)}.${b64urlJson(claims)}`;

  if (header.alg === 'none') return `${signingInput}.`;

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    (options.signWith ?? keyPair).privateKey,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${b64url(new Uint8Array(signature))}`;
}

beforeAll(async () => {
  keyPair = await generateRsaKeyPair();
  otherKeyPair = await generateRsaKeyPair();

  const publicJwk = (await crypto.subtle.exportKey('jwk', keyPair.publicKey)) as JsonWebKey;
  const jwks = { keys: [{ ...publicJwk, kid: KID, alg: 'RS256', use: 'sig' }] };

  fetchMock = vi.fn(
    async () =>
      new Response(JSON.stringify(jwks), {
        headers: { 'Content-Type': 'application/json' },
      }),
  );
  vi.stubGlobal('fetch', fetchMock);
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe('verifyGoogleIdToken', () => {
  it('accepts a correctly signed token and normalises the identity', async () => {
    const identity = await verifyGoogleIdToken(await signToken(), CLIENT_ID);

    expect(identity.sub).toBe('1029384756');
    expect(identity.email).toBe('person@example.com');
    expect(identity.emailVerified).toBe(true);
    expect(identity.firstName).toBe('Ada');
    expect(identity.lastName).toBe('Lovelace');
    expect(identity.picture).toBe('https://lh3.googleusercontent.com/a/abc');
  });

  it('reuses the cached key set instead of fetching per verification', async () => {
    const before = fetchMock.mock.calls.length;
    await verifyGoogleIdToken(await signToken(), CLIENT_ID);
    await verifyGoogleIdToken(await signToken(), CLIENT_ID);

    // The point of the module-level cache: sign-in must not pay a round trip to
    // googleapis.com every time.
    expect(fetchMock.mock.calls.length).toBe(before);
  });

  it('falls back to the name claim when given_name is absent', async () => {
    const identity = await verifyGoogleIdToken(
      await signToken(baseClaims({ given_name: undefined, family_name: undefined })),
      CLIENT_ID,
    );

    expect(identity.firstName).toBe('Ada');
    expect(identity.lastName).toBe('Lovelace');
  });

  it('rejects alg: none without even looking up a key', async () => {
    const before = fetchMock.mock.calls.length;
    const token = await signToken(baseClaims(), { header: { alg: 'none', kid: KID } });

    await expect(verifyGoogleIdToken(token, CLIENT_ID)).rejects.toThrow(
      /Unsupported token algorithm/,
    );
    expect(fetchMock.mock.calls.length).toBe(before);
  });

  it('rejects a token signed by a different key', async () => {
    // Same kid, so the key set resolves -- only the signature disagrees.
    const token = await signToken(baseClaims(), { signWith: otherKeyPair });

    await expect(verifyGoogleIdToken(token, CLIENT_ID)).rejects.toThrow(
      /signature is invalid/,
    );
  });

  it('rejects a token minted for another Google application', async () => {
    const token = await signToken(baseClaims({ aud: 'someone-else.apps.googleusercontent.com' }));

    await expect(verifyGoogleIdToken(token, CLIENT_ID)).rejects.toThrow(
      /not issued for this application/,
    );
  });

  it('rejects an expired token', async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await signToken(baseClaims({ iat: now - 7200, exp: now - 3600 }));

    await expect(verifyGoogleIdToken(token, CLIENT_ID)).rejects.toThrow(/has expired/);
  });

  it('rejects an unexpected issuer', async () => {
    const token = await signToken(baseClaims({ iss: 'https://accounts.evil.example' }));

    await expect(verifyGoogleIdToken(token, CLIENT_ID)).rejects.toThrow(/unexpected issuer/);
  });

  it('rejects an unverified email address', async () => {
    const token = await signToken(baseClaims({ email_verified: false }));

    await expect(verifyGoogleIdToken(token, CLIENT_ID)).rejects.toThrow(/has not verified/);
  });

  it('accepts email_verified sent as the string "true"', async () => {
    const identity = await verifyGoogleIdToken(
      await signToken(baseClaims({ email_verified: 'true' })),
      CLIENT_ID,
    );
    expect(identity.emailVerified).toBe(true);
  });

  it('rejects a malformed token', async () => {
    await expect(verifyGoogleIdToken('a.b', CLIENT_ID)).rejects.toThrow(/Malformed/);
    await expect(verifyGoogleIdToken('a.b.c', CLIENT_ID)).rejects.toThrow(/Malformed/);
  });

  it('refuses to verify anything when GOOGLE_CLIENT_ID is unset', async () => {
    // Otherwise the aud check would compare against '' and pass for nobody --
    // but a future edit could just as easily make it pass for everybody.
    await expect(verifyGoogleIdToken(await signToken(), '')).rejects.toThrow(
      /GOOGLE_CLIENT_ID is not configured/,
    );
  });

  it('refetches once for an unknown key id, then stops', async () => {
    const token = await signToken(baseClaims(), {
      header: { alg: 'RS256', kid: 'rotated-in-key-99' },
    });

    // A real rotation looks exactly like this, so one forced refetch is right.
    const before = fetchMock.mock.calls.length;
    await expect(verifyGoogleIdToken(token, CLIENT_ID)).rejects.toThrow(/unknown key/);
    expect(fetchMock.mock.calls.length).toBe(before + 1);

    // The second attempt must not: otherwise anyone posting garbage kids to
    // /api/auth/google turns this endpoint into an amplifier aimed at Google.
    await expect(verifyGoogleIdToken(token, CLIENT_ID)).rejects.toThrow(/unknown key/);
    expect(fetchMock.mock.calls.length).toBe(before + 1);
  });
});
