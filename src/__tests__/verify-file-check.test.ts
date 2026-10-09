/**
 * Tests for the post-generation brainhalf.verify.json validation that
 * mirrors what the publisher runs. Covers all four rules:
 *   1. Missing file with no backend → no repair needed
 *   2. Missing file with worker backend → repair queued
 *   3. Present but schema-invalid file → repair queued with error detail
 *   4. Present and schema-valid file → no repair
 * Each invalid-file case is tested for the specific schema violation it catches.
 */

vi.mock('cloudflare:workers', () => ({
  tracing: { enterSpan: async (_name: string, fn: () => any) => fn() },
}));
vi.mock('agents', () => ({ Agent: class Agent {} }));

import { describe, expect, it, vi } from 'vitest';
import { ChatAgent, VERIFY_FILE_REPAIR_MARKER } from '../agent';
import { WriteEpoch } from '../lib/concurrency';
import { FlipFlopGuard, RepairLog } from '../lib/repair-budget';

const VALID_PRIVATE_PLAN = JSON.stringify({
  version: 1, access: 'private', steps: [
    { type: 'request', name: 'Anonymous denied', path: '/api/notes', as: 'anonymous', status: 401 },
    { type: 'request', name: 'Create note', path: '/api/notes', method: 'POST', body: { text: 'v' }, status: 201, capture: { id: '/note/id' } },
    { type: 'database', name: 'Note persisted', sql: 'SELECT text FROM notes WHERE id=?', params: ['{{id}}'], rows: 1, assertions: [{ pointer: '/0/text', equals: 'v' }] },
  ],
});

const VALID_PUBLIC_PLAN = JSON.stringify({
  version: 1, access: 'public', steps: [
    { type: 'request', name: 'Create item', path: '/api/items', method: 'POST', body: { n: 'x' }, status: 201, capture: { id: '/item/id' } },
    { type: 'database', name: 'Item persisted', sql: 'SELECT n FROM items WHERE id=?', params: ['{{id}}'], rows: 1, assertions: [{ pointer: '/0/n', equals: 'x' }] },
    { type: 'request', name: 'Read item', path: '/api/items/{{id}}', status: 200 },
  ],
});

function makeAgent(files: Record<string, string>) {
  const fileMap = new Map(Object.entries(files));
  const agent: any = Object.create(ChatAgent.prototype);
  agent.writeEpoch = new WriteEpoch();
  agent.verifyFileRepairAttempts = 0;
  agent.ctx = { storage: { transactionSync: <R,>(f: () => R): R => f() } };
  agent.sql = (strings: TemplateStringsArray, ...values: any[]) => {
    const stmt = strings.join('?').replace(/\s+/g, ' ').trim();
    if (/SELECT path, content FROM project_files/i.test(stmt)) {
      return [...fileMap.entries()].map(([path, content]) => ({ path, content }));
    }
    return [];
  };
  agent.flipFlopGuard = new FlipFlopGuard();
  agent.repairLog = new RepairLog();
  const events: any[] = [];
  const connection = { id: 'conn', send: (msg: string) => events.push(JSON.parse(msg)) };
  return { agent, connection, events };
}

function runCheck(agent: any, connection: any) {
  const deferred: Array<() => void> = [];
  const fired = (agent as any).verifyVerificationPlanFile(connection, (fn: () => void) => deferred.push(fn));
  for (const fn of deferred) fn();
  return fired;
}

describe('verifyVerificationPlanFile: no repair when not needed', () => {
  it('returns false when no files exist', () => {
    const { agent, connection } = makeAgent({});
    expect(runCheck(agent, connection)).toBe(false);
  });

  it('returns false for a frontend-only project (no worker backend)', () => {
    const { agent, connection } = makeAgent({ '/src/App.tsx': 'export default () => null;' });
    expect(runCheck(agent, connection)).toBe(false);
  });

  it('returns false when verify.json exists and is valid (private)', () => {
    const { agent, connection } = makeAgent({
      '/worker/index.ts': 'export default {};',
      '/brainhalf.verify.json': VALID_PRIVATE_PLAN,
    });
    expect(runCheck(agent, connection)).toBe(false);
  });

  it('returns false when verify.json exists and is valid (public)', () => {
    const { agent, connection } = makeAgent({
      '/worker/index.ts': 'export default {};',
      '/brainhalf.verify.json': VALID_PUBLIC_PLAN,
    });
    expect(runCheck(agent, connection)).toBe(false);
  });
});

describe('verifyVerificationPlanFile: repair when file is missing', () => {
  it('queues a repair when worker backend exists but brainhalf.verify.json is absent', () => {
    const { agent, connection, events } = makeAgent({ '/worker/index.ts': 'export default {};' });
    expect(runCheck(agent, connection)).toBe(true);
    const autoReply = events.find((e: any) => e.type === 'trigger-auto-reply');
    expect(autoReply).toBeDefined();
    expect(autoReply.message).toContain(VERIFY_FILE_REPAIR_MARKER);
    expect(autoReply.message).toContain('missing');
  });

  it('caps at one repair attempt for a missing file', () => {
    const { agent, connection } = makeAgent({ '/worker/index.ts': 'export default {};' });
    expect(runCheck(agent, connection)).toBe(true);
    expect(runCheck(agent, connection)).toBe(false);
  });
});

describe('verifyVerificationPlanFile: repair when file is schema-invalid', () => {
  it('queues a repair and includes the validation error when steps < 3', () => {
    const plan = JSON.stringify({
      version: 1, access: 'private', steps: [
        { type: 'request', name: 'A', path: '/api/x', method: 'POST', status: 201 },
        { type: 'database', name: 'B', sql: 'SELECT 1', rows: 0, assertions: [] },
      ],
    });
    const { agent, connection, events } = makeAgent({
      '/worker/index.ts': 'export default {};',
      '/brainhalf.verify.json': plan,
    });
    expect(runCheck(agent, connection)).toBe(true);
    const autoReply = events.find((e: any) => e.type === 'trigger-auto-reply');
    expect(autoReply.message).toContain(VERIFY_FILE_REPAIR_MARKER);
    // Schema error for too few steps
    expect(autoReply.message).toMatch(/at least 3|minimum/i);
  });

  it('queues a repair when there is no successful API write step', () => {
    const plan = JSON.stringify({
      version: 1, access: 'public', steps: [
        { type: 'request', name: 'Read A', path: '/api/notes', status: 200 },
        { type: 'request', name: 'Read B', path: '/api/notes/1', status: 200 },
        { type: 'database', name: 'Check', sql: 'SELECT 1', rows: 0, assertions: [] },
      ],
    });
    const { agent, connection, events } = makeAgent({
      '/worker/index.ts': 'export default {};',
      '/brainhalf.verify.json': plan,
    });
    expect(runCheck(agent, connection)).toBe(true);
    const autoReply = events.find((e: any) => e.type === 'trigger-auto-reply');
    expect(autoReply.message).toContain(VERIFY_FILE_REPAIR_MARKER);
    expect(autoReply.message).toMatch(/write|POST|PUT|PATCH|DELETE/i);
  });

  it('queues a repair when the database step has no assertions (rows 0 and empty assertions)', () => {
    // rows > 0 AND assertions.length required — rows=0, assertions=[] fails that.
    const plan = JSON.stringify({
      version: 1, access: 'public', steps: [
        { type: 'request', name: 'Create', path: '/api/items', method: 'POST', body: {}, status: 201 },
        { type: 'request', name: 'Read', path: '/api/items', status: 200 },
        { type: 'database', name: 'Check', sql: 'SELECT 1', rows: 0, assertions: [] },
      ],
    });
    const { agent, connection, events } = makeAgent({
      '/worker/index.ts': 'export default {};',
      '/brainhalf.verify.json': plan,
    });
    expect(runCheck(agent, connection)).toBe(true);
    const autoReply = events.find((e: any) => e.type === 'trigger-auto-reply');
    expect(autoReply.message).toContain(VERIFY_FILE_REPAIR_MARKER);
    expect(autoReply.message).toMatch(/database assertion|persisted data/i);
  });

  it('queues a repair when a private app has no access-denial step', () => {
    const plan = JSON.stringify({
      version: 1, access: 'private', steps: [
        { type: 'request', name: 'Create', path: '/api/items', method: 'POST', body: {}, status: 201, capture: { id: '/id' } },
        { type: 'database', name: 'Check', sql: 'SELECT id FROM items WHERE id=?', params: ['{{id}}'], rows: 1, assertions: [{ pointer: '/0/id', equals: '{{id}}' }] },
        { type: 'request', name: 'Read', path: '/api/items', status: 200 },
      ],
    });
    const { agent, connection, events } = makeAgent({
      '/worker/index.ts': 'export default {};',
      '/brainhalf.verify.json': plan,
    });
    expect(runCheck(agent, connection)).toBe(true);
    const autoReply = events.find((e: any) => e.type === 'trigger-auto-reply');
    expect(autoReply.message).toContain(VERIFY_FILE_REPAIR_MARKER);
    expect(autoReply.message).toMatch(/access-denial|anonymous|otherUser/i);
  });

  it('caps at one repair attempt for an invalid file', () => {
    const bad = JSON.stringify({ version: 1, access: 'private', steps: [] });
    const { agent, connection } = makeAgent({
      '/worker/index.ts': 'export default {};',
      '/brainhalf.verify.json': bad,
    });
    expect(runCheck(agent, connection)).toBe(true);
    expect(runCheck(agent, connection)).toBe(false);
  });

  it('sends a generation_notice before queuing the repair', () => {
    const { agent, connection, events } = makeAgent({ '/worker/index.ts': 'export default {};' });
    runCheck(agent, connection);
    const notice = events.find((e: any) => e.type === 'generation_notice');
    expect(notice).toBeDefined();
  });
});

describe('verifyVerificationPlanFile: structural coverage', () => {
  it('VERIFY_FILE_REPAIR_MARKER is a distinguishable prefix for resolveCompletenessRepair', () => {
    expect(VERIFY_FILE_REPAIR_MARKER).toMatch(/^\[AUTO-FIX\]/);
    expect(VERIFY_FILE_REPAIR_MARKER.length).toBeGreaterThan(10);
  });
});
