import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthError, login } from '../lib/auth-client';

function stubFetch(status: number, body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('login() typed error codes', () => {
  it('throws an AuthError preserving EMAIL_VERIFICATION_REQUIRED', async () => {
    stubFetch(403, {
      error: 'Verify your email before signing in. You can request a new link below.',
      code: 'EMAIL_VERIFICATION_REQUIRED',
    });
    const err = await login('user@example.com', 'password123').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AuthError);
    expect((err as AuthError).code).toBe('EMAIL_VERIFICATION_REQUIRED');
    expect((err as Error).message).toBe('Verify your email before signing in. You can request a new link below.');
  });

  it('throws an AuthError with undefined code for generic failures', async () => {
    stubFetch(401, { error: 'Invalid email or password.' });
    const err = await login('user@example.com', 'wrongpassword').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AuthError);
    expect((err as AuthError).code).toBeUndefined();
    expect((err as Error).message).toBe('Invalid email or password.');
  });

  it('still surfaces the message when the server sends no code field', async () => {
    stubFetch(500, { error: 'Something went wrong.' });
    const err = await login('user@example.com', 'password123').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AuthError);
    expect((err as AuthError).code).toBeUndefined();
  });
});
