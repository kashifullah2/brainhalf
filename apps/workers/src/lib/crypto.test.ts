import { describe, it, expect } from "vitest";
import { encryptApiKey, decryptApiKey } from "./crypto";

const SECRET = "test-secret-value-1234567890";

describe("crypto round-trip", () => {
  it("decrypts back to the original plaintext", async () => {
    const plaintext = "sk-cerebras-abcdef-1234567890";
    const encrypted = await encryptApiKey(plaintext, SECRET);
    expect(encrypted).not.toBe(plaintext);
    const decrypted = await decryptApiKey(encrypted, SECRET);
    expect(decrypted).toBe(plaintext);
  });

  it("produces different ciphertext each call (random IV)", async () => {
    const a = await encryptApiKey("same-key", SECRET);
    const b = await encryptApiKey("same-key", SECRET);
    expect(a).not.toBe(b);
    expect(await decryptApiKey(a, SECRET)).toBe("same-key");
    expect(await decryptApiKey(b, SECRET)).toBe("same-key");
  });

  it("fails to decrypt with the wrong secret", async () => {
    const encrypted = await encryptApiKey("secret-payload", SECRET);
    await expect(decryptApiKey(encrypted, "wrong-secret")).rejects.toBeTruthy();
  });

  it("handles unicode plaintext", async () => {
    const plaintext = "key-with-émoji-🎮-and-ünïcode";
    const encrypted = await encryptApiKey(plaintext, SECRET);
    expect(await decryptApiKey(encrypted, SECRET)).toBe(plaintext);
  });
});
