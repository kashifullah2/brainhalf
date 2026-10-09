import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';

vi.mock('cloudflare:workers', () => ({ tracing: {} }));
vi.mock('agents', () => ({ Agent: class {} }));

import { ChatAgent } from '../agent';
import { WriteEpoch, BusyLock } from '../lib/concurrency';
import { runMigrations, AGENT_MIGRATIONS } from '../lib/migrations';

/**
 * Build a minimal ChatAgent-like object backed by an in-memory SQLite database.
 * Only the fields and methods exercised by runGeneration's pre-main-try path are
 * provided; everything else stays undefined and will throw if accidentally reached.
 */
function makeAgent(db: DatabaseSync) {
  runMigrations(
    AGENT_MIGRATIONS,
    statement => db.prepare(statement).all() as Array<Record<string, unknown>>,
    <R,>(fn: () => R): R => fn(),
  );

  const agent: any = Object.create(ChatAgent.prototype);
  agent.name = 'test-project';
  agent.erasing = false;
  agent.writeEpoch = new WriteEpoch();
  agent.generationLock = new BusyLock();
  // Idempotency is wired separately by ensureSchema; the early-exit path does
  // not reach it, so a no-op stub is sufficient.
  agent.idempotency = { has: () => false, setSql: () => {}, release: () => {} };
  agent.connectionUserIds = new Map([['conn1', 'user1']]);
  agent.authCache = new Map();
  agent.pendingAuth = new Map();
  agent.pendingCompletenessRepair = null;
  agent.activeGeneration = null;
  agent.activeAccounting = null;
  agent.activeJobId = null;
  agent.currentAbortController = null;
  agent.activeBudget = null;
  agent.pendingBackups = new Set();
  agent.turnSavedForEpoch = -1;
  agent.truncationRetries = 0;
  agent.syntaxRepairAttempts = 0;
  agent.finalCompletenessRepairAttempts = 0;
  agent.generationBranchId = 'main';
  agent.ctx = { storage: { transactionSync: <R,>(fn: () => R): R => fn() } };
  // sql tag mock: reconstruct parameterised SQL from the template strings array.
  agent.sql = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = Array.isArray(strings) ? (strings as string[]).join('?') : String(strings);
    return db.prepare(sql).all(...(values as any[]));
  };
  // env must be present; generation-start queries use it only after the early exit.
  agent.env = {};
  // queueProductOutcome is guarded by measureGeneration; plannerMode=true prevents
  // it from being called, but stub it in case.
  agent.queueProductOutcome = vi.fn().mockResolvedValue(undefined);
  agent.getConnections = () => [];
  agent.ensureSchema = () => {};
  return agent;
}

describe('runGeneration early-exit — stale activeJobId', () => {
  it('clears activeJobId when epoch is superseded before the main try block', async () => {
    const db = new DatabaseSync(':memory:');
    const agent = makeAgent(db);
    const connection = { id: 'conn1', send: vi.fn() };

    // epoch 1 acquired, then immediately bumped to epoch 2 → epoch 1 is stale.
    const staleEpoch = agent.writeEpoch.begin();
    agent.writeEpoch.begin();

    await (agent as any).runGeneration(
      connection,
      { model: null, idempotencyKey: 'idem-1' },
      '',        // systemPrompt — unused before early exit
      'hello',   // actualPrompt
      staleEpoch,
      true,      // plannerMode=true → measureGeneration=false → queueProductOutcome skipped
    );

    expect(agent.activeJobId).toBeNull();
    expect(agent.activeGeneration).toBeNull();
    expect(agent.activeAccounting).toBeNull();
    expect(agent.currentAbortController).toBeNull();
  });

  it('marks the generation_jobs row interrupted on early exit', async () => {
    const db = new DatabaseSync(':memory:');
    const agent = makeAgent(db);
    const connection = { id: 'conn1', send: vi.fn() };

    const staleEpoch = agent.writeEpoch.begin();
    agent.writeEpoch.begin();

    await (agent as any).runGeneration(
      connection,
      { model: null, idempotencyKey: 'idem-2' },
      '', 'hello', staleEpoch, true,
    );

    // The job row must exist (generationJobs.create runs before the epoch check)
    // and must be marked 'interrupted', not left as 'running'.
    const rows = db.prepare(
      "SELECT status FROM generation_jobs ORDER BY started_at DESC LIMIT 1",
    ).all() as Array<{ status: string }>;

    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('interrupted');
  });

  it('does not attribute a post-exit upsertFile to the dead job', async () => {
    const db = new DatabaseSync(':memory:');
    const agent = makeAgent(db);
    const connection = { id: 'conn1', send: vi.fn() };

    const staleEpoch = agent.writeEpoch.begin();
    agent.writeEpoch.begin();

    await (agent as any).runGeneration(
      connection,
      { model: null, idempotencyKey: 'idem-3' },
      '', 'hello', staleEpoch, true,
    );

    // Capture the dead job id before upsertFile runs.
    const deadRows = db.prepare(
      "SELECT id, completed_files FROM generation_jobs ORDER BY started_at DESC LIMIT 1",
    ).all() as Array<{ id: string; completed_files: string }>;

    // Write a file after the early exit — must not be attributed to the dead job.
    (agent as any).upsertFile('/src/App.tsx', 'export default () => null;');

    if (deadRows.length > 0) {
      const after = db.prepare(
        'SELECT completed_files FROM generation_jobs WHERE id = ?',
      ).get(deadRows[0].id) as { completed_files: string } | undefined;
      const files: string[] = JSON.parse(after?.completed_files ?? '[]');
      expect(files).not.toContain('/src/App.tsx');
    }

    // activeJobId being null is the root invariant the fix restores.
    expect(agent.activeJobId).toBeNull();
  });
});
