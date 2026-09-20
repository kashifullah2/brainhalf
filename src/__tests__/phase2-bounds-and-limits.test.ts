/**
 * Phase 2 regression cover: the bounds, limits and lifecycle guards that stop a
 * single client from growing the Durable Objects' state without limit, and that
 * keep a stuck generation from locking a project forever.
 *
 * Each unit here is small on purpose. The pieces are private to the agent and
 * the worker precisely because they are load-bearing, so what needs to be pinned
 * is their behaviour at the boundary: the count at which a limit trips, that a
 * lock really is released on timeout, and that a secret written into the store
 * never comes back out.
 */

import { describe, it, expect, vi } from 'vitest';
import { RateLimiter } from '../lib/rate-limit';
import { BusyLock } from '../lib/concurrency';
import { InMemoryDataStore, stripSecrets } from '../lib/backend-runner';

describe('RateLimiter (shared by the Worker gates and the generation gate)', () => {
  it('allows exactly `limit` calls in one window', () => {
    const limiter = new RateLimiter({ gen: { limit: 3, windowMs: 10_000 } });
    expect(limiter.check('gen', 'user-a')).toEqual({ ok: true, retryAfter: 0 });
    expect(limiter.check('gen', 'user-a')).toEqual({ ok: true, retryAfter: 0 });
    expect(limiter.check('gen', 'user-a')).toEqual({ ok: true, retryAfter: 0 });
  });

  it('refuses the call past the limit and reports a positive retryAfter', () => {
    const limiter = new RateLimiter({ gen: { limit: 2, windowMs: 5_000 } });
    limiter.check('gen', 'user-a');
    limiter.check('gen', 'user-a');
    const blocked = limiter.check('gen', 'user-a');
    expect(blocked.ok).toBe(false);
    // A zero retryAfter would let a client busy-loop instead of backing off.
    expect(blocked.retryAfter).toBeGreaterThan(0);
    // And it keeps refusing for the rest of the window.
    expect(limiter.check('gen', 'user-a').ok).toBe(false);
  });

  it('counts each key independently', () => {
    const limiter = new RateLimiter({ gen: { limit: 1, windowMs: 10_000 } });
    expect(limiter.check('gen', 'user-a').ok).toBe(true);
    expect(limiter.check('gen', 'user-b').ok).toBe(true);
    expect(limiter.check('gen', 'user-a').ok).toBe(false);
  });

  it('resets the window once it has elapsed', () => {
    vi.useFakeTimers();
    try {
      const limiter = new RateLimiter({ gen: { limit: 1, windowMs: 1_000 } });
      expect(limiter.check('gen', 'user-a').ok).toBe(true);
      expect(limiter.check('gen', 'user-a').ok).toBe(false);
      vi.advanceTimersByTime(1_001);
      expect(limiter.check('gen', 'user-a').ok).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('fails open for a bucket it does not know', () => {
    const limiter = new RateLimiter({ gen: { limit: 1, windowMs: 10_000 } });
    // An unconfigured bucket must not silently deny service.
    expect(limiter.check('unknown-bucket', 'user-a')).toEqual({ ok: true, retryAfter: 0 });
  });

  it('reclaims expired windows so the map cannot grow without bound', () => {
    vi.useFakeTimers();
    try {
      const limiter = new RateLimiter({ gen: { limit: 5, windowMs: 1_000 } });
      // A known epoch: the fake clock starts at wall-clock time, which would make
      // the arithmetic below meaningless.
      vi.setSystemTime(0);
      // Distinct keys are distinct map entries, so this pushes the map well past
      // the sweep threshold. They all share one window, so none are expired yet.
      for (let i = 0; i < 5_001; i++) limiter.check('gen', `user-${i}`);
      expect(limiter.size).toBe(5_001);
      // Let every window lapse, then touch the limiter again: the sweep fires on
      // the next insert and drops everything that has lapsed.
      vi.setSystemTime(2_000);
      limiter.check('gen', 'user-after-sweep');
      expect(limiter.size).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('BusyLock (a generation must not hold a project forever)', () => {
  it('runs the work and releases the lock', async () => {
    const lock = new BusyLock();
    const result = await lock.run('generate:x', async () => 'done');
    expect(result).toEqual({ value: 'done' });
    expect(lock.isHeld).toBe(false);
  });

  it('refuses a second concurrent run instead of queueing it', async () => {
    const lock = new BusyLock();
    let release!: () => void;
    const inFlight = new Promise<void>((resolve) => { release = resolve; });
    const first = lock.run('generate:x', async () => { await inFlight; return 'first'; });
    // The second caller is told why, rather than silently waiting behind work
    // of unknown size.
    const refused = await lock.run('generate:x', async () => 'second');
    expect('reason' in refused).toBe(true);
    expect((refused as { reason: string }).reason).toContain('still running');
    release();
    expect(await first).toEqual({ value: 'first' });
  });

  it('abandons work that exceeds the timeout and releases the lock', async () => {
    vi.useFakeTimers();
    const lock = new BusyLock();
    let released = false;
    const neverSettles = new Promise<string>(() => { /* deliberately unresolved */ });
    const pending = lock.run('generate:slow', async () => { await neverSettles; released = true; return 'never'; }, 100);
    vi.advanceTimersByTime(150);
    const result = await pending;
    expect('reason' in result).toBe(true);
    expect((result as { reason: string }).reason).toContain('exceeded 100ms');
    // The whole point: a stuck generation cannot wedge the project.
    expect(lock.isHeld).toBe(false);
    expect(released).toBe(false);
    vi.useRealTimers();
  });

  it('does not crash the isolate when abandoned work later rejects', async () => {
    const lock = new BusyLock();
    let rejectWork!: (e: Error) => void;
    const work = new Promise<string>((_, reject) => { rejectWork = reject; });
    const pending = lock.run('generate:flaky', async () => { await work; return 'nope'; }, 50);
    await new Promise((r) => setTimeout(r, 80));
    // The timeout has already won and nobody is awaiting `work`; its rejection
    // must not become an unhandled-rejection crash.
    rejectWork(new Error('provider gave up'));
    await expect(pending).resolves.toMatchObject({ reason: expect.stringContaining('exceeded') });
  });

  it('re-throws work that fails before the timeout', async () => {
    const lock = new BusyLock();
    await expect(
      lock.run('generate:bad', async () => { throw new Error('boom'); }, 10_000)
    ).rejects.toThrow('boom');
    expect(lock.isHeld).toBe(false);
  });
});

describe('InMemoryDataStore (the backend-runner sandbox store)', () => {
  it('stores and reads rows by table', () => {
    const store = new InMemoryDataStore();
    store.create('tasks', { id: '1', title: 'ship' });
    expect(store.findAll('tasks')).toEqual([{ id: '1', title: 'ship', createdAt: expect.any(String), updatedAt: expect.any(String) }]);
  });

  it('refuses more tables than the cap allows', () => {
    const store = new InMemoryDataStore();
    let lastError: any;
    for (let i = 0; i < 200; i++) {
      try { store.create(`table-${i}`, { id: String(i) }); } catch (e) { lastError = e; break; }
    }
    expect(lastError).toBeInstanceOf(Error);
    expect(lastError.code).toBe('STORE_FULL');
    expect(lastError.message).toContain('Too many tables');
  });

  it('refuses rows past the per-table cap', () => {
    const store = new InMemoryDataStore();
    let lastError: any;
    for (let i = 0; i < 20_000; i++) {
      try { store.create('rows', { id: String(i) }); } catch (e) { lastError = e; break; }
    }
    expect(lastError).toBeInstanceOf(Error);
    expect(lastError.code).toBe('STORE_FULL');
    expect(lastError.message).toContain('is full');
  });
});

describe('stripSecrets (secrets must not come back out of the generic CRUD API)', () => {
  it('removes password and token fields and keeps everything else', () => {
    const item = stripSecrets({ id: '1', email: 'a@b.c', password: 'hunter2', token: 'sk_x', role: 'admin' });
    expect(item).toEqual({ id: '1', email: 'a@b.c', role: 'admin' });
  });

  it('does not mutate the object it was given', () => {
    const original = { id: '1', password: 'hunter2' };
    stripSecrets(original);
    expect(original).toEqual({ id: '1', password: 'hunter2' });
  });

  it('maps over arrays', () => {
    const items = stripSecrets([{ id: '1', token: 'sk' }, { id: '2', password: 'pw' }]);
    expect(items).toEqual([{ id: '1' }, { id: '2' }]);
  });

  it('leaves primitives alone', () => {
    expect(stripSecrets('plain' as unknown as string)).toBe('plain');
  });
});
