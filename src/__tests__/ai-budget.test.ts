import { describe, expect, it, vi } from 'vitest';
import { AiBudget, AiLedger, AI_ALLOWANCE, meteredModel } from '../lib/ai-budget';
import { budgetRegistry, sqliteStorage } from './helpers/storage';

describe('durable account AI allowance', () => {
  it('shares concurrency across projects and survives object reconstruction', async () => {
    const env = { REGISTRY: budgetRegistry() };
    // Fill all concurrent-generation slots, then verify the next start is rejected.
    const slots = Array.from({ length: AI_ALLOWANCE.concurrentGenerations }, () => new AiBudget(env, 'owner'));
    await Promise.all(slots.map(b => b.start()));
    await expect(new AiBudget(env, 'owner').start()).rejects.toThrow('already running across your projects');
    await expect(new AiBudget(env, 'different-owner').start()).resolves.toBeUndefined();
    const [first, ...rest] = slots;
    await first.end(); await expect(new AiBudget(env, 'owner').start()).resolves.toBeUndefined();
    await Promise.all(rest.map(b => b.end()));
    const storage = sqliteStorage(); let ledger = new AiLedger(storage);
    ledger.start('one'); ledger.reserve('one', 'call', 100);
    ledger = new AiLedger(storage); expect(ledger.usage().calls).toBe(1);
    ledger.reserve('one', 'call', 100); expect(ledger.usage().calls).toBe(1);
  });
  it('tracks provider calls via onCall and forwards options unchanged', async () => {
    // meteredModel no longer reserves budget per step — the generation start
    // reserves once via budget.reserve(). The proxy's only job is counting calls.
    const inference = vi.fn(async (options: { maxOutputTokens?: number }) => ({ ok: true, options }));
    let calls = 0;
    const model = meteredModel({ doStream: inference }, () => { calls++; });
    await model.doStream({ maxOutputTokens: 100 });
    await model.doStream({ maxOutputTokens: 200 });
    expect(inference).toHaveBeenCalledTimes(2);
    expect(calls).toBe(2);
    // Options are forwarded as-is; the proxy no longer rewrites maxOutputTokens.
    expect((inference.mock.calls[0][0] as any).maxOutputTokens).toBe(100);
    expect((inference.mock.calls[1][0] as any).maxOutputTokens).toBe(200);
  });
  it('keeps failed-call reservations charged and enforces the output ceiling', () => {
    const storage = sqliteStorage(); const ledger = new AiLedger(storage); ledger.start('one');
    // Fill up to within one 65536-block of the daily token ceiling.
    // ceil(dailyOutputTokens / 65536) gives the number of full max-token calls that fit.
    const maxCalls = Math.ceil(AI_ALLOWANCE.dailyOutputTokens / 65536);
    for (let i = 0; i < maxCalls - 1; i++) ledger.reserve('one', `call-${i}`, 65536);
    expect(() => ledger.reserve('one', 'over-budget', 65536)).toThrow('daily AI allowance');
    expect(() => ledger.reserve('one', 'invalid', 65537)).toThrow('Invalid');
    expect(ledger.usage().reservedOutputTokens).toBe((maxCalls - 1) * 65536);
    ledger.end('one'); expect(ledger.usage().reservedOutputTokens).toBe((maxCalls - 1) * 65536);
  });
  it('expires interrupted leases and resets the daily allowance at midnight UTC', () => {
    const storage = sqliteStorage(); const ledger = new AiLedger(storage);
    const now = Date.UTC(2026, 8, 23, 23, 59);
    ledger.start('one', now); ledger.reserve('one', 'call', 65536, now);
    expect(ledger.usage(now + 120_000).calls).toBe(0);
    expect(() => ledger.reserve('one', 'expired', 100, now + AI_ALLOWANCE.leaseMs + 1)).toThrow('expired');
    expect(ledger.usage(now + AI_ALLOWANCE.leaseMs + 1).activeGenerations).toBe(0);
  });
  it('distinguishes concurrency-limit from daily-budget exhaustion via error kind', async () => {
    const { AiBudgetError } = await import('../lib/ai-budget');
    type BudgetError = InstanceType<typeof AiBudgetError>;
    // Concurrency: fill all slots, next start throws with kind 'concurrency'.
    const env = { REGISTRY: budgetRegistry() };
    const slots = Array.from({ length: AI_ALLOWANCE.concurrentGenerations }, () => new AiBudget(env, 'owner-kind'));
    await Promise.all(slots.map(b => b.start()));
    try {
      await new AiBudget(env, 'owner-kind').start();
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AiBudgetError);
      expect((err as BudgetError).kind).toBe('concurrency');
      expect((err as BudgetError).status).toBe(429);
    }
    await Promise.all(slots.map(b => b.end()));
    // Daily: exhaust calls, next reserve throws with kind 'daily'.
    const storage = sqliteStorage(); const ledger = new AiLedger(storage);
    ledger.start('daily-kind');
    const maxCalls = Math.ceil(AI_ALLOWANCE.dailyOutputTokens / 65536);
    for (let i = 0; i < maxCalls - 1; i++) ledger.reserve('daily-kind', `dk-${i}`, 65536);
    try {
      ledger.reserve('daily-kind', 'dk-over', 65536);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AiBudgetError);
      expect((err as BudgetError).kind).toBe('daily');
      expect((err as BudgetError).status).toBe(429);
    }
    ledger.end('daily-kind');
  });
});
