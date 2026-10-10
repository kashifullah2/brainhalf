const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/**
 * Verify a Cloudflare Turnstile token server-side.
 * Returns true on a valid challenge, false on failure or timeout.
 * Never throws — if the Turnstile API is unreachable, fall through.
 */
export async function verifyTurnstileToken(
  token: string,
  secretKey: string,
  ip?: string
): Promise<boolean> {
  if (!token || !secretKey) return false;
  try {
    const body = new URLSearchParams({ secret: secretKey, response: token });
    if (ip) body.set('remoteip', ip);
    const res = await fetch(SITEVERIFY_URL, {
      method: 'POST',
      body,
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return false;
    const data = await res.json() as { success: boolean };
    return data.success === true;
  } catch {
    return false;
  }
}
