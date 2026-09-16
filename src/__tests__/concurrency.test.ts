import { describe, it, expect } from 'vitest';
import { BusyLock, IdempotencyStore, WriteEpoch, dedupeAdjacent, runInTransaction } from '../lib/concurrency';

describe('P4 WriteEpoch — a stale generation cannot write', () => {
  it('accepts only the most recent ticket', () => {
    const epoch = new WriteEpoch();
    const a = epoch.begin();
    const b = epoch.begin();
    expect(epoch.accepts(a)).toBe(false);
    expect(epoch.accepts(b)).toBe(true);
  });

  it('rejects a ticket from before any generation', () => {
    expect(new WriteEpoch().accepts(0)).toBe(false);
    // A NaN or undefined ticket must never be accepted: it means the caller never
    // actually began a generation, so its writes have no right to land.
    expect(new WriteEpoch().accepts(NaN as unknown as number)).toBe(false);
  });

  it('treats stop as superseding the in-flight generation', () => {
    const epoch = new WriteEpoch();
    const ticket = epoch.begin();
    expect(epoch.accepts(ticket)).toBe(true);
    // stop() bumps the epoch; the still-running generation is now stale.
    epoch.begin();
    expect(epoch.accepts(ticket)).toBe(false);
  });

  it('reports a monotonically increasing snapshot', () => {
    const epoch = new WriteEpoch();
    expect(epoch.snapshot()).toBe(0);
    epoch.begin();
    epoch.begin();
    expect(epoch.snapshot()).toBe(2);
  });
});

describe('P4 BusyLock — a second concurrent generation is refused, not queued', () => {
  it('runs the closure and returns its value', async () => {
    const lock = new BusyLock();
    const res = await lock.run('job', async () => 42);
    expect(res).toEqual({ value: 42 });
    expect(lock.isHeld).toBe(false);
  });

  it('refuses a second caller while the first is in flight', async () => {
    const lock = new BusyLock();
    let release!: () => void;
    const first = new Promise<void>(resolve => (release = resolve));
    const started = lock.run('first', () => first.then(() => 'done'));
    // Give the lock a tick to claim.
    await Promise.resolve();
    expect(lock.isHeld).toBe(true);
    const second = await lock.run('second', async () => 'should not run');
    expect('reason' in second).toBe(true);
    expect((second as { reason: string }).reason).toContain('first');
    release();
    expect((await started)).toEqual({ value: 'done' });
  });

  it('releases the lock when the closure throws', async () => {
    const lock = new BusyLock();
    await expect(lock.run('boom', async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(lock.isHeld).toBe(false);
    // And a subsequent job can take it.
    expect((await lock.run('next', async () => 'ok'))).toEqual({ value: 'ok' });
  });
});

describe('P4 IdempotencyStore — a redelivered message generates once', () => {
  it('claims a key once and refuses it afterwards', () => {
    const store = new IdempotencyStore();
    expect(store.claim('msg-1')).toBe(true);
    expect(store.claim('msg-1')).toBe(false);
    expect(store.has('msg-1')).toBe(true);
  });

  it('treats a missing key as "no dedup requested"', () => {
    const store = new IdempotencyStore();
    expect(store.claim(null)).toBe(true);
    expect(store.claim(undefined)).toBe(true);
    expect(store.claim('')).toBe(true);
    expect(store.size).toBe(0);
  });

  it('never becomes an unbounded client memory sink', () => {
    // A malicious or buggy client could send a unique key per message forever.
    // The store must evict, not grow.
    const store = new IdempotencyStore(4);
    for (let i = 0; i < 10; i++) store.claim(`key-${i}`);
    expect(store.size).toBeLessThanOrEqual(4);
    // Old keys are gone, so an old redelivery would be accepted as new. That is
    // the documented trade: bounded memory over perfect dedup across unbounded
    // time.
    expect(store.size).toBe(4);
  });

  it('refuses an oversized key rather than storing it', () => {
    const store = new IdempotencyStore();
    const huge = 'x'.repeat(1000);
    expect(store.claim(huge)).toBe(true);
    expect(store.has(huge)).toBe(false);
  });
});

describe('P4 runInTransaction — all statements commit or none do', () => {
  it('runs the closure inside transactionSync and returns its value', () => {
    const calls: string[] = [];
    const storage = {
      transactionSync<R>(closure: () => R): R {
        calls.push('begin');
        const r = closure();
        calls.push('commit');
        return r;
      },
    };
    const out = runInTransaction(storage, () => {
      calls.push('statement');
      return 'result';
    });
    expect(out).toBe('result');
    expect(calls).toEqual(['begin', 'statement', 'commit']);
  });

  it('propagates a thrown statement so the caller decides, not the helper', () => {
    const storage = { transactionSync: <R,>(c: () => R): R => c() };
    expect(() => runInTransaction(storage, () => { throw new Error('rollback'); })).toThrow('rollback');
  });
});

describe('P4 dedupeAdjacent — a re-sent edit does not inflate the context', () => {
  it('drops consecutive identical turns', () => {
    const out = dedupeAdjacent([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
      { role: 'assistant', content: 'hello' },
      { role: 'user', content: 'again' },
    ]);
    expect(out).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
      { role: 'user', content: 'again' },
    ]);
  });

  it('keeps identical turns that are not adjacent', () => {
    const out = dedupeAdjacent([
      { role: 'user', content: 'same' },
      { role: 'assistant', content: 'reply' },
      { role: 'user', content: 'same' },
    ]);
    expect(out.length).toBe(3);
  });

  it('preserves an empty history', () => {
    expect(dedupeAdjacent([])).toEqual([]);
  });
});
