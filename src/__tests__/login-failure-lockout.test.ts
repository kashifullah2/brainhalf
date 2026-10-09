import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { vi } from 'vitest';
import type { DurableObjectState } from '@cloudflare/workers-types';
import { hashPassword } from '../lib/crypto';

vi.mock('agents', () => ({ routeAgentRequest: vi.fn(), Agent: class {} }));
vi.mock('../agent', () => ({ ChatAgent: class {} }));

import { AuthRegistry } from '../registry';

describe('P1 Login brute-force — per-email failure rate limit', () => {
  let db: DatabaseSync;
  let registry: AuthRegistry;

  function makeState(): DurableObjectState {
    return {
      storage: {
        setAlarm: async () => {},
        transactionSync: (work: () => unknown) => {
          db.exec('BEGIN');
          try { const r = work(); db.exec('COMMIT'); return r; }
          catch (e) { db.exec('ROLLBACK'); throw e; }
        },
        sql: {
          exec: (query: string, ...params: any[]) => {
            const rows = db.prepare(query).all(...params);
            return { toArray: () => rows };
          },
        },
      },
    } as unknown as DurableObjectState;
  }

  const login = (email: string, password: string) =>
    registry.fetch(new Request('https://registry/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }));

  beforeEach(async () => {
    db = new DatabaseSync(':memory:');
    registry = new AuthRegistry(makeState(), {});
    await registry.fetch(new Request('https://registry/bootstrap'));
    const hash = await hashPassword('correct-password-for-test');
    db.prepare('INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)').run('u1', 'victim@example.com', hash, 1000);
    db.prepare('INSERT INTO email_verification (user_id, verified_at) VALUES (?, ?)').run('u1', 1500);
  });

  afterEach(() => db.close());

  it('increments the loginFail counter on a wrong password', async () => {
    const res = await login('victim@example.com', 'wrong-password');
    expect(res.status).toBe(401);
    const row = db.prepare("SELECT count FROM rate_limits WHERE bucket = 'loginFail' AND rate_key = 'victim@example.com'").get() as { count: number } | undefined;
    expect(row?.count).toBe(1);
  });

  it('increments the loginFail counter on an unknown email', async () => {
    const res = await login('nobody@example.com', 'any-password');
    expect(res.status).toBe(401);
    const row = db.prepare("SELECT count FROM rate_limits WHERE bucket = 'loginFail' AND rate_key = 'nobody@example.com'").get() as { count: number } | undefined;
    expect(row?.count).toBe(1);
  });

  it('does NOT increment the loginFail counter on a successful login', async () => {
    const res = await login('victim@example.com', 'correct-password-for-test');
    expect(res.status).toBe(200);
    const row = db.prepare("SELECT count FROM rate_limits WHERE bucket = 'loginFail' AND rate_key = 'victim@example.com'").get() as { count: number } | undefined;
    expect(row).toBeUndefined();
  });

  it('blocks login (same error) when the fail counter reaches 10', async () => {
    // Seed 10 recorded failures directly to avoid running 10 PBKDF2 rounds.
    const futureWindow = Date.now() + 15 * 60 * 1000;
    db.prepare("INSERT INTO rate_limits (bucket, rate_key, count, reset_at) VALUES ('loginFail', 'victim@example.com', 10, ?)").run(futureWindow);

    // Correct password — still blocked; the error message is identical.
    const withCorrect = await login('victim@example.com', 'correct-password-for-test');
    expect(withCorrect.status).toBe(401);
    expect(await withCorrect.json()).toEqual({ error: 'Invalid email or password' });

    // Wrong password — same result.
    const withWrong = await login('victim@example.com', 'wrong-password');
    expect(withWrong.status).toBe(401);
    expect(await withWrong.json()).toEqual({ error: 'Invalid email or password' });
  });

  it('unblocks automatically once the rate-limit window expires', async () => {
    // Seed a row whose reset_at is already in the past.
    const expiredWindow = Date.now() - 1;
    db.prepare("INSERT INTO rate_limits (bucket, rate_key, count, reset_at) VALUES ('loginFail', 'victim@example.com', 10, ?)").run(expiredWindow);

    const res = await login('victim@example.com', 'correct-password-for-test');
    expect(res.status).toBe(200);
  });
});
