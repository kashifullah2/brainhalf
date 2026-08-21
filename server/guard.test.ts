import { describe, expect, it } from 'vitest';

import type { AppEnv } from './http';
import { authHeaders, intParam, requireSession } from './guard';

function emptyEnv(): AppEnv {
  // requireSession() must not reach the database when there is no cookie, so a
  // DB that throws on use is the assertion.
  const db = {
    prepare: () => {
      throw new Error('requireSession queried the database without a cookie');
    },
  };
  return { DB: db } as unknown as AppEnv;
}

describe('intParam', () => {
  it('accepts positive integers', () => {
    expect(intParam('5')).toBe(5);
    expect(intParam('1')).toBe(1);
    // Pages hands a repeated path segment through as an array.
    expect(intParam(['7'])).toBe(7);
    // Number() accepts exponent notation; 1e3 really is the integer 1000, so
    // letting it through is correct rather than merely tolerated.
    expect(intParam('1e3')).toBe(1000);
  });

  it('rejects everything that is not a positive integer', () => {
    // Each of these used to be a path to a query with a nonsense id.
    expect(intParam('0')).toBeNull();
    expect(intParam('-1')).toBeNull();
    expect(intParam('1.5')).toBeNull();
    expect(intParam('abc')).toBeNull();
    expect(intParam('')).toBeNull();
    expect(intParam(undefined)).toBeNull();
    expect(intParam([])).toBeNull();
  });
});

describe('requireSession', () => {
  it('returns a 401 Response for an anonymous caller', async () => {
    const result = await requireSession(
      new Request('https://app.example.com/api/batches'),
      emptyEnv(),
    );

    expect(result).toBeInstanceOf(Response);
    const response = result as Response;
    expect(response.status).toBe(401);

    const body = (await response.json()) as { error?: string };
    expect(typeof body.error).toBe('string');
  });
});

describe('authHeaders', () => {
  it('is undefined when the session did not roll forward', () => {
    expect(
      authHeaders({
        user: {
          id: 'usr_abc',
          email: 'person@example.com',
          firstName: 'Ada',
          lastName: 'Lovelace',
          pictureUrl: null,
          emailVerified: true,
        },
      }),
    ).toBeUndefined();
  });

  it('carries the refreshed cookie through to the handler response', () => {
    expect(
      authHeaders({
        user: {
          id: 'usr_abc',
          email: 'person@example.com',
          firstName: 'Ada',
          lastName: 'Lovelace',
          pictureUrl: null,
          emailVerified: true,
        },
        setCookie: 'bh_session=fresh; Path=/',
      }),
    ).toEqual({ 'Set-Cookie': 'bh_session=fresh; Path=/' });
  });
});
