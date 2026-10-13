/**
 * RC-2 regression: the accessTimer must use forceRefresh=false so the 30s auth
 * cache absorbs most ticks. A 300s generation with one connection should make
 * at most ~10 live Registry calls (one per AUTH_CACHE_TTL window), not 30.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('cloudflare:workers', () => ({ tracing: { enterSpan: async (_name: string, callback: any) => callback({ setAttribute: () => {} }) } }));
vi.mock('agents', () => ({ Agent: class {} }));

import { AUTH_CACHE_TTL } from '../lib/timeouts';
import { ChatAgent } from '../agent';
import { WriteEpoch } from '../lib/concurrency';

afterEach(() => vi.useRealTimers());

describe('accessTimer auth cache (RC-2)', () => {
  it('uses forceRefresh=false so cached auth absorbs multiple ticks per TTL window', async () => {
    vi.useFakeTimers();
    let liveCalls = 0;
    const fetch = vi.fn(async (url: string) => {
      liveCalls++;
      return url.includes('/sessions/')
        ? Response.json({ userId: 'alice' })
        : Response.json({ ownerId: 'alice' });
    });

    const agent: any = Object.create(ChatAgent.prototype);
    agent.name = 'project';
    agent.env = { REGISTRY: { idFromName: () => 'auth', get: () => ({ fetch }) } };
    agent.connectionUserIds = new Map([['socket', 'alice']]);
    agent.pendingAuth = new Map();
    agent.authCache = new Map();

    const connection = {
      id: 'socket',
      state: { userId: 'alice', sessionHash: 'a'.repeat(64), transientAuthFailures: 0 },
      uri: null,
      setState: vi.fn((s: unknown) => { connection.state = s as typeof connection.state; }),
      close: vi.fn(),
    };

    // One successful auth primes the cache.
    await agent.authorizeConnection(connection, false);
    const callsAfterFirst = liveCalls;
    expect(callsAfterFirst).toBeGreaterThan(0);

    // Repeated calls within the TTL window hit the cache — no new live calls.
    const ticksWithinTTL = Math.floor(AUTH_CACHE_TTL / 10_000) - 1;
    for (let i = 0; i < ticksWithinTTL; i++) {
      await agent.authorizeConnection(connection, false);
    }
    expect(liveCalls).toBe(callsAfterFirst); // cache absorbed all ticks

    // After TTL expires, the next call makes a live Registry call.
    vi.advanceTimersByTime(AUTH_CACHE_TTL + 1);
    await agent.authorizeConnection(connection, false);
    expect(liveCalls).toBeGreaterThan(callsAfterFirst);
  });

  it('300s generation makes at most ~10 live Registry calls (one per TTL window), not 30', async () => {
    vi.useFakeTimers();
    let liveCalls = 0;
    const fetch = vi.fn(async (url: string) => {
      liveCalls++;
      return url.includes('/sessions/')
        ? Response.json({ userId: 'alice' })
        : Response.json({ ownerId: 'alice' });
    });

    const agent: any = Object.create(ChatAgent.prototype);
    agent.name = 'project';
    agent.env = { REGISTRY: { idFromName: () => 'auth', get: () => ({ fetch }) } };
    agent.connectionUserIds = new Map([['socket', 'alice']]);
    agent.pendingAuth = new Map();
    agent.authCache = new Map();

    const connection = {
      id: 'socket',
      state: { userId: 'alice', sessionHash: 'a'.repeat(64), transientAuthFailures: 0 },
      uri: null,
      setState: vi.fn((s: unknown) => { connection.state = s as typeof connection.state; }),
      close: vi.fn(),
    };

    // Simulate 30 ticks of 10s (= 300s) with forceRefresh=false (the accessTimer setting post-RC-2).
    const TICK_MS = 10_000;
    const TICKS = 30;
    for (let tick = 0; tick < TICKS; tick++) {
      vi.advanceTimersByTime(TICK_MS);
      await agent.authorizeConnection(connection, false);
    }

    // Each doAuthorizeConnection makes 2 Registry fetches (session + ownership).
    // With AUTH_CACHE_TTL=30s and a 10s tick interval, each cache miss covers 3 ticks.
    // ~10 cache misses * 2 fetches each = ~20 fetch calls. With forceRefresh=true
    // (old behaviour) it would be 30 * 2 = 60.
    const authMisses = Math.ceil((TICKS * TICK_MS) / AUTH_CACHE_TTL) + 1;
    const maxExpectedFetches = authMisses * 2;
    expect(liveCalls).toBeLessThanOrEqual(maxExpectedFetches);
    // Definitely not one fetch per tick (which would be TICKS * 2 = 60).
    expect(liveCalls).toBeLessThan(TICKS);
  });
});
