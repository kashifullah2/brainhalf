import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { AGENT_MIGRATIONS, runMigrations } from '../lib/migrations';
import { ChatAgent } from '../agent';

const databases: DatabaseSync[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });

vi.mock('cloudflare:workers', () => ({ tracing: { enterSpan: async (_name: string, callback: any) => callback({ setAttribute: () => {} }) } }));
vi.mock('agents', () => ({ Agent: class {} }));

function setup() {
  const database = new DatabaseSync(':memory:');
  databases.push(database);
  const transaction = <V,>(work: () => V): V => {
    database.exec('BEGIN');
    try { const r = work(); database.exec('COMMIT'); return r; }
    catch (e) { database.exec('ROLLBACK'); throw e; }
  };
  runMigrations(AGENT_MIGRATIONS, s => database.prepare(s).all(), transaction);

  const budgetEndCalls: Array<{ id: string }> = [];
  const waitUntilPromises: Promise<unknown>[] = [];

  const agent: any = Object.create(ChatAgent.prototype);
  agent.env = {
    REGISTRY: {
      idFromName: (name: string) => name,
      get: () => ({
        fetch: async (req: Request) => {
          const body = await req.json() as { id: string };
          budgetEndCalls.push(body);
          return new Response(JSON.stringify({ ok: true }));
        },
      }),
    },
  };
  agent.ctx = {
    storage: { transactionSync: (cb: () => unknown) => cb() },
    waitUntil: (p: Promise<unknown>) => { waitUntilPromises.push(p); },
  };
  agent.sql = (strings: TemplateStringsArray, ...values: any[]) =>
    database.prepare(strings.join('?')).all(...values);
  agent.erasing = false;
  agent.activeGeneration = null;
  agent.writeEpoch = { accepts: () => true };
  agent.connectionUserIds = new Map();
  agent.turnSavedForEpoch = -1;

  return { agent, database, budgetEndCalls, waitUntilPromises };
}

describe('hibernation recovery', () => {
  it('cleans up an orphaned generation on wake: marks usage failed, releases budget, clears state', async () => {
    const { agent, database, budgetEndCalls, waitUntilPromises } = setup();

    database.prepare(`INSERT INTO generation_usage (id, model, started_at, status) VALUES ('acct-1', 'test-model', ${Date.now()}, 'running')`).run();
    database.prepare(`INSERT INTO active_generation_state (id, generation_session_id, job_id, accounting_id, budget_id, budget_owner, started_at) VALUES (1, 'gen-1', 'acct-1', 'acct-1', 'budget-1', 'user-1', ${Date.now()})`).run();

    agent.recoverOrphanedGeneration();
    await Promise.all(waitUntilPromises);

    const usage = database.prepare("SELECT status, finished_at FROM generation_usage WHERE id='acct-1'").get() as any;
    expect(usage.status).toBe('failed');
    expect(usage.finished_at).toBeGreaterThan(0);

    expect(budgetEndCalls).toHaveLength(1);
    expect(budgetEndCalls[0].id).toBe('budget-1');

    const stateRow = database.prepare('SELECT * FROM active_generation_state WHERE id=1').get();
    expect(stateRow).toBeUndefined();
  });

  it('sweeps stale running generation_usage rows even without an active_generation_state row', () => {
    const { agent, database } = setup();

    database.prepare(`INSERT INTO generation_usage (id, model, started_at, status) VALUES ('orphan-1', 'test', ${Date.now()}, 'running')`).run();
    database.prepare(`INSERT INTO generation_usage (id, model, started_at, status) VALUES ('orphan-2', 'test', ${Date.now()}, 'running')`).run();
    database.prepare(`INSERT INTO generation_usage (id, model, started_at, status) VALUES ('done-1', 'test', ${Date.now()}, 'completed')`).run();

    agent.recoverOrphanedGeneration();

    expect((database.prepare("SELECT status FROM generation_usage WHERE id='orphan-1'").get() as any).status).toBe('failed');
    expect((database.prepare("SELECT status FROM generation_usage WHERE id='orphan-2'").get() as any).status).toBe('failed');
    expect((database.prepare("SELECT status FROM generation_usage WHERE id='done-1'").get() as any).status).toBe('completed');
  });

  it('does not interfere when a generation is actively running', () => {
    const { agent, database } = setup();

    agent.activeGeneration = { id: 'gen-1', epoch: 0, model: 'test', prompt: 'hi', response: '', startedAt: Date.now(), filesChanged: false, truncated: false };
    database.prepare(`INSERT INTO generation_usage (id, model, started_at, status) VALUES ('acct-1', 'test', ${Date.now()}, 'running')`).run();
    database.prepare(`INSERT INTO active_generation_state (id, generation_session_id, job_id, accounting_id, budget_id, budget_owner, started_at) VALUES (1, 'gen-1', 'acct-1', 'acct-1', 'budget-1', 'user-1', ${Date.now()})`).run();

    agent.recoverOrphanedGeneration();

    expect((database.prepare("SELECT status FROM generation_usage WHERE id='acct-1'").get() as any).status).toBe('running');
    expect(database.prepare('SELECT * FROM active_generation_state WHERE id=1').get()).toBeTruthy();
  });

  it('persistActiveGeneration writes and clearActiveGenerationState removes the row', () => {
    const { agent, database } = setup();

    agent.truncationRetries = 2;
    agent.syntaxRepairAttempts = 1;
    agent.finalCompletenessRepairAttempts = 0;
    agent.phantomHookRepairAttempts = 0;
    agent.verifyFileRepairAttempts = 0;
    agent.apiRouteCoverageRepairAttempts = 0;
    agent.appEntryRepairAttempts = 0;
    agent.turnSavedForEpoch = 5;

    agent.persistActiveGeneration('gen-99', 'job-99', 'acct-99', 'budget-99', 'owner-99');

    const row = database.prepare('SELECT * FROM active_generation_state WHERE id=1').get() as any;
    expect(row.generation_session_id).toBe('gen-99');
    expect(row.job_id).toBe('job-99');
    expect(row.accounting_id).toBe('acct-99');
    expect(row.budget_id).toBe('budget-99');
    expect(row.budget_owner).toBe('owner-99');
    expect(row.turn_saved_for_epoch).toBe(5);
    expect(row.truncation_retries).toBe(2);
    expect(row.syntax_repair_attempts).toBe(1);

    agent.clearActiveGenerationState();
    expect(database.prepare('SELECT * FROM active_generation_state WHERE id=1').get()).toBeUndefined();
  });

  it('persistRepairCounters updates the existing row', () => {
    const { agent, database } = setup();

    agent.truncationRetries = 0;
    agent.syntaxRepairAttempts = 0;
    agent.finalCompletenessRepairAttempts = 0;
    agent.phantomHookRepairAttempts = 0;
    agent.verifyFileRepairAttempts = 0;
    agent.apiRouteCoverageRepairAttempts = 0;
    agent.appEntryRepairAttempts = 0;
    agent.turnSavedForEpoch = -1;
    agent.persistActiveGeneration('gen-1', 'job-1', 'acct-1', 'budget-1', 'owner-1');

    agent.truncationRetries = 3;
    agent.syntaxRepairAttempts = 2;
    agent.turnSavedForEpoch = 7;
    agent.persistRepairCounters();

    const row = database.prepare('SELECT truncation_retries, syntax_repair_attempts, turn_saved_for_epoch FROM active_generation_state WHERE id=1').get() as any;
    expect(row.truncation_retries).toBe(3);
    expect(row.syntax_repair_attempts).toBe(2);
    expect(row.turn_saved_for_epoch).toBe(7);
  });
});
