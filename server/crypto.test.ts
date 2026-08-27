import { describe, expect, it } from 'vitest';

import {
  hashPassword,
  randomId,
  randomToken,
  sha256Hex,
  verifyPassword,
} from './crypto';

// PBKDF2 here is 100,000 iterations x 6 chained rounds by design, so a single
// hash is deliberately expensive. Every test that hashes gets a raised timeout
// rather than a reduced work factor -- lowering it for tests would mean testing
// something other than what runs in production.
const SLOW = { timeout: 30_000 };

describe('sha256Hex', () => {
  it('matches the published digest for the empty string', async () => {
    expect(await sha256Hex('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('matches the published digest for "abc"', async () => {
    expect(await sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

describe('randomToken', () => {
  it('is base64url only, so it survives a cookie and a URL unescaped', () => {
    for (let i = 0; i < 20; i++) {
      expect(randomToken()).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it('does not repeat', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) seen.add(randomToken());
    expect(seen.size).toBe(200);
  });

  it('honours the requested byte length', () => {
    // 16 bytes -> 22 base64 chars once padding is stripped.
    expect(randomToken(16)).toHaveLength(22);
    expect(randomToken(32)).toHaveLength(43);
  });
});

describe('randomId', () => {
  it('prefixes the token', () => {
    expect(randomId('usr')).toMatch(/^usr_[A-Za-z0-9_-]{22}$/);
  });
});

describe('hashPassword', () => {
  it('produces a self-describing hash with the current parameters', SLOW, async () => {
    const stored = await hashPassword('correct horse battery staple');
    const parts = stored.split('$');

    expect(parts).toHaveLength(5);
    expect(parts[0]).toBe('pbkdf2');
    expect(parts[1]).toBe('sha256');
    // The parameters live in the hash so they can be raised later without
    // invalidating everyone's password.
    expect(parts[2]).toBe('100000x6');
    expect(parts[3]).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(parts[4]).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('salts, so the same password hashes differently twice', SLOW, async () => {
    const a = await hashPassword('same-password');
    const b = await hashPassword('same-password');
    expect(a).not.toBe(b);
  });
});

describe('verifyPassword', () => {
  it('accepts the right password and rejects the wrong one', SLOW, async () => {
    const stored = await hashPassword('s3cret-passphrase');

    expect(await verifyPassword('s3cret-passphrase', stored)).toEqual({
      valid: true,
      needsRehash: false,
    });
    expect((await verifyPassword('s3cret-passphras', stored)).valid).toBe(false);
    expect((await verifyPassword('', stored)).valid).toBe(false);
  });

  it('rejects rather than throws on a null or malformed hash', async () => {
    const rejected = { valid: false, needsRehash: false };

    expect(await verifyPassword('x', null)).toEqual(rejected);
    expect(await verifyPassword('x', '')).toEqual(rejected);
    expect(await verifyPassword('x', 'not-a-hash')).toEqual(rejected);
    // Right shape, wrong algorithm.
    expect(await verifyPassword('x', 'bcrypt$sha256$1x1$c2FsdA$aGFzaA')).toEqual(
      rejected,
    );
    // Right algorithm, nonsense work factor.
    expect(
      await verifyPassword('x', 'pbkdf2$sha256$abcxdef$c2FsdA$aGFzaA'),
    ).toEqual(rejected);
    // Right algorithm, zero rounds.
    expect(await verifyPassword('x', 'pbkdf2$sha256$100000x0$c2FsdA$aGFzaA')).toEqual(
      rejected,
    );
  });

  it('flags a weaker legacy hash for rehashing', SLOW, async () => {
    // A hash written before the chained rounds existed: one round, so the third
    // field carries no `x`. It must still verify, and it must ask to be upgraded.
    const legacy = await legacySingleRoundHash('legacy-password');

    expect(await verifyPassword('legacy-password', legacy)).toEqual({
      valid: true,
      needsRehash: true,
    });
    // A wrong password never asks for a rehash -- that would be a free oracle
    // telling an attacker the account exists and is on old parameters.
    expect(await verifyPassword('wrong', legacy)).toEqual({
      valid: false,
      needsRehash: false,
    });
  });
});

/**
 * Builds a one-round hash in the pre-chaining format, using WebCrypto directly.
 * server/crypto.ts can verify it but can no longer produce it.
 */
async function legacySingleRoundHash(password: string): Promise<string> {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100_000 },
    key,
    256,
  );

  return ['pbkdf2', 'sha256', '100000', b64url(salt), b64url(new Uint8Array(bits))].join(
    '$',
  );
}

function b64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).split('+').join('-').split('/').join('_').split('=').join('');
}
