import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AppEnv } from './http';
import {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  clearedCookieHeader,
  createSession,
  maybeSweepExpiredAuthRows,
  readSessionToken,
  resolveSession,
  revokeAllSessions,
  revokeSession,
  sessionCookie,
  toSessionUser,
} from './session';

// --- D1 stub ----------------------------------------------------------------
// Only the surface these functions actually touch: prepare().bind().first(),
// .run(), and batch(). Everything is recorded so a test can assert on the SQL
// and, more importantly, on the arguments -- that is where "we store the hash,
// never the token" is either true or not.

interface StubCall {
  sql: string;
  args: unknown[];
}

interface StubDb {
  calls: StubCall[];
  /** SQL of each statement handed to batch(), grouped per batch() call. */
  batched: string[][];
  setFirst: (value: unknown) => void;
  env: AppEnv;
}

function stubDb(options: { failBatch?: boolean } = {}): StubDb {
  const calls: StubCall[] = [];
  const batched: string[][] = [];
  const state: { first: unknown } = { first: null };

  function make(sql: string, args: unknown[]): Record<string, unknown> {
    return {
      __sql: sql,
      bind: (...next: unknown[]) => make(sql, next),
      first: async () => {
        calls.push({ sql, args });
        return state.first;
      },
      run: async () => {
        calls.push({ sql, args });
        return { success: true, meta: { changes: 1, last_row_id: 1 } };
      },
      all: async () => {
        calls.push({ sql, args });
        return { success: true, results: [] };
      },
    };
  }

  const db = {
    prepare: (sql: string) => make(sql, []),
    batch: async (statements: Array<Record<string, unknown>>) => {
      if (options.failBatch) throw new Error('D1 unavailable');
      batched.push(statements.map((s) => String(s.__sql)));
      return statements.map(() => ({ success: true, results: [] }));
    },
  };

  return {
    calls,
    batched,
    setFirst: (value: unknown) => {
      state.first = value;
    },
    env: { DB: db } as unknown as AppEnv,
  };
}

/** A D1 `datetime('now')`-style timestamp, offset from now. */
function sqlTime(offsetMs: number): string {
  return new Date(Date.now() + offsetMs)
    .toISOString()
    .replace('T', ' ')
    .slice(0, 19);
}

function userRow(expiresInMs: number) {
  return {
    expires_at: sqlTime(expiresInMs),
    id: 'usr_abc',
    email: 'person@example.com',
    first_name: 'Ada',
    last_name: 'Lovelace',
    picture_url: null,
    email_verified: 1,
  };
}

function requestWithCookie(cookie: string | null, url = 'https://app.example.com/api/auth/me') {
  return new Request(url, cookie ? { headers: { Cookie: cookie } } : undefined);
}

afterEach(() => {
  vi.restoreAllMocks();
});

// --- Cookie serialisation ---------------------------------------------------

describe('sessionCookie', () => {
  it('is HttpOnly, SameSite=Lax, and Secure over https', () => {
    const cookie = sessionCookie(requestWithCookie(null), 'the-token');

    expect(cookie).toContain(`${SESSION_COOKIE}=the-token`);
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain(`Max-Age=${SESSION_TTL_SECONDS}`);
    expect(cookie).toContain('Secure');
  });

  it('drops Secure over http, because a browser would reject the cookie', () => {
    // Not a concession in production -- it is what makes http://localhost work.
    const cookie = sessionCookie(
      requestWithCookie(null, 'http://localhost:8788/api/auth/me'),
      'the-token',
    );
    expect(cookie).not.toContain('Secure');
  });
});

describe('clearedCookieHeader', () => {
  it('expires the cookie immediately and keeps the same attributes', () => {
    const cookie = clearedCookieHeader(requestWithCookie(null));

    expect(cookie).toContain(`${SESSION_COOKIE}=`);
    expect(cookie).toContain('Max-Age=0');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Path=/');
  });
});

describe('readSessionToken', () => {
  it('reads the session cookie out of a crowded header', () => {
    expect(
      readSessionToken(
        requestWithCookie(`_ga=GA1.1.2; ${SESSION_COOKIE}=abc123; theme=dark`),
      ),
    ).toBe('abc123');
  });

  it('returns null when there is no cookie header at all', () => {
    expect(readSessionToken(requestWithCookie(null))).toBeNull();
  });

  it('returns null for an empty value', () => {
    expect(readSessionToken(requestWithCookie(`${SESSION_COOKIE}=`))).toBeNull();
  });

  it('does not match a cookie whose name merely starts the same', () => {
    expect(
      readSessionToken(requestWithCookie(`${SESSION_COOKIE}_old=abc123`)),
    ).toBeNull();
  });
});

// --- toSessionUser ----------------------------------------------------------

describe('toSessionUser', () => {
  it('maps the integer email_verified column to a boolean', () => {
    expect(toSessionUser({ ...userRow(0), email_verified: 1 }).emailVerified).toBe(true);
    expect(toSessionUser({ ...userRow(0), email_verified: 0 }).emailVerified).toBe(false);
  });
});

// --- createSession ----------------------------------------------------------

describe('createSession', () => {
  it('stores the hash and never the token itself', async () => {
    const db = stubDb();
    const token = await createSession(db.env, 'usr_abc', {
      userAgent: 'test-agent',
      ip: '203.0.113.7',
    });

    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(db.calls).toHaveLength(1);
    expect(db.calls[0].sql).toContain('INSERT INTO sessions');

    // The whole point of hashing at rest: a dump of this table must not contain
    // anything replayable as a login.
    expect(db.calls[0].args).not.toContain(token);
    expect(String(db.calls[0].args[0])).toMatch(/^[0-9a-f]{64}$/);
    expect(db.calls[0].args[1]).toBe('usr_abc');
  });
});

// --- resolveSession ---------------------------------------------------------

describe('resolveSession', () => {
  it('returns null without touching the database when there is no cookie', async () => {
    const db = stubDb();
    expect(await resolveSession(requestWithCookie(null), db.env)).toBeNull();
    expect(db.calls).toHaveLength(0);
  });

  it('returns null for a token with no matching row', async () => {
    const db = stubDb();
    db.setFirst(null);
    expect(
      await resolveSession(requestWithCookie(`${SESSION_COOKIE}=nope`), db.env),
    ).toBeNull();
  });

  it('resolves a live session without re-issuing the cookie', async () => {
    const db = stubDb();
    db.setFirst(userRow(25 * 24 * 60 * 60 * 1000));

    const session = await resolveSession(
      requestWithCookie(`${SESSION_COOKIE}=live-token`),
      db.env,
    );

    expect(session?.user.id).toBe('usr_abc');
    expect(session?.user.email).toBe('person@example.com');
    expect(session?.refreshedToken).toBeUndefined();
    expect(db.calls.some((c) => c.sql.includes('UPDATE sessions'))).toBe(false);
  });

  it('deletes the row and returns null when the session has expired', async () => {
    const db = stubDb();
    db.setFirst(userRow(-60_000));

    expect(
      await resolveSession(requestWithCookie(`${SESSION_COOKIE}=stale`), db.env),
    ).toBeNull();

    const deletion = db.calls.find((c) => c.sql.includes('DELETE FROM sessions'));
    expect(deletion).toBeDefined();
  });

  it('rolls the session forward when it is close to expiry', async () => {
    const db = stubDb();
    // Two days left, against a seven-day refresh window.
    db.setFirst(userRow(2 * 24 * 60 * 60 * 1000));

    const session = await resolveSession(
      requestWithCookie(`${SESSION_COOKIE}=aging-token`),
      db.env,
    );

    expect(session?.refreshedToken).toBe('aging-token');
    expect(db.calls.some((c) => c.sql.includes('UPDATE sessions'))).toBe(true);
  });

  it('treats an unparseable expires_at as expired', async () => {
    const db = stubDb();
    db.setFirst({ ...userRow(0), expires_at: 'not-a-timestamp' });

    expect(
      await resolveSession(requestWithCookie(`${SESSION_COOKIE}=junk`), db.env),
    ).toBeNull();
  });
});

// --- Revocation -------------------------------------------------------------

describe('revokeSession', () => {
  it('deletes by hash, not by token', async () => {
    const db = stubDb();
    await revokeSession(requestWithCookie(`${SESSION_COOKIE}=doomed`), db.env);

    expect(db.calls).toHaveLength(1);
    expect(db.calls[0].sql).toContain('DELETE FROM sessions');
    expect(db.calls[0].args).not.toContain('doomed');
    expect(String(db.calls[0].args[0])).toMatch(/^[0-9a-f]{64}$/);
  });

  it('does nothing when there is no cookie', async () => {
    const db = stubDb();
    await revokeSession(requestWithCookie(null), db.env);
    expect(db.calls).toHaveLength(0);
  });
});

describe('revokeAllSessions', () => {
  it('deletes every row for the user', async () => {
    const db = stubDb();
    await revokeAllSessions(db.env, 'usr_abc');

    expect(db.calls[0].sql).toContain('DELETE FROM sessions WHERE user_id = ?');
    expect(db.calls[0].args).toEqual(['usr_abc']);
  });
});

// --- Opportunistic sweep ----------------------------------------------------

describe('maybeSweepExpiredAuthRows', () => {
  it('prunes both token tables when the dice say so', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const db = stubDb();

    await maybeSweepExpiredAuthRows(db.env);

    expect(db.batched).toHaveLength(1);
    const [statements] = db.batched;
    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain('DELETE FROM sessions');
    expect(statements[1]).toContain('DELETE FROM password_reset_tokens');
    // Bounded: a single request must never pay for a table-wide delete.
    expect(statements[0]).toContain('LIMIT');
    expect(statements[1]).toContain('LIMIT');
  });

  it('does nothing on the other 49 calls out of 50', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const db = stubDb();

    await maybeSweepExpiredAuthRows(db.env);

    expect(db.batched).toHaveLength(0);
  });

  it('swallows a database failure instead of failing the request', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const db = stubDb({ failBatch: true });

    await expect(maybeSweepExpiredAuthRows(db.env)).resolves.toBeUndefined();
  });
});
