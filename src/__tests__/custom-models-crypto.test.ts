import { describe, it, expect } from 'vitest';
import { encryptValue, decryptValue } from '../lib/crypto';

describe('custom model API key encryption', () => {
  it('round-trips an API key through encrypt/decrypt', async () => {
    const encrypted = await encryptValue('test-secret', 'sk-test-key-123');
    expect(encrypted).not.toBe('sk-test-key-123');
    expect(await decryptValue('test-secret', encrypted)).toBe('sk-test-key-123');
  });

  it('fails to decrypt with the wrong secret', async () => {
    const encrypted = await encryptValue('secret-a', 'sk-test-key-123');
    expect(await decryptValue('secret-b', encrypted)).toBeNull();
  });

  it('returns null for corrupted ciphertext', async () => {
    expect(await decryptValue('test-secret', 'not-valid-base64!!!')).toBeNull();
  });

  it('produces different ciphertext for the same input (random IV)', async () => {
    const a = await encryptValue('test-secret', 'sk-same');
    const b = await encryptValue('test-secret', 'sk-same');
    expect(a).not.toBe(b);
    expect(await decryptValue('test-secret', a)).toBe('sk-same');
    expect(await decryptValue('test-secret', b)).toBe('sk-same');
  });
});
