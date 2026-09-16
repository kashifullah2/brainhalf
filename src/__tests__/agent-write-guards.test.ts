import { describe, it, expect, vi } from 'vitest';

/**
 * agent.ts imports `cloudflare:workers` (tracing) and the `agents` SDK base class,
 * neither of which loads under Node/vitest. Neither is on the write path under
 * test, so both are stubbed: the real `ChatAgent` methods are what we exercise.
 */
vi.mock('cloudflare:workers', () => ({
  tracing: { enterSpan: async (_name: string, fn: () => any) => fn() },
}));
vi.mock('agents', () => ({ Agent: class Agent {} }));

import { ChatAgent } from '../agent';
import { WriteEpoch } from '../lib/concurrency';

/**
 * The P4 guards are primitives in lib/concurrency.ts, but their value comes from
 * being wired into the real write path. These tests drive `extractAndSaveFiles`
 * through a fake SQLite handle so the transaction batching and epoch gate are
 * exercised against agent code, not a reimplementation of it.
 *
 * The instance is built with `Object.create` rather than `new` because the
 * `Agent` base class constructor wants a real DurableObjectState; the methods
 * under test only touch `sql`, `broadcast` and the epoch guard.
 */
function makeAgent(files: Map<string, string>) {
  const agent: any = Object.create(ChatAgent.prototype);
  agent.writeEpoch = new WriteEpoch();
  // extractAndSaveFiles commits through transactionSync; the fake just runs the
  // closure synchronously the way Durable Object SQLite does.
  agent.ctx = { storage: { transactionSync: <R,>(closure: () => R): R => closure() } };

  const statements: string[] = [];
  agent.sql = (strings: TemplateStringsArray, ...values: any[]) => {
    // Record enough of each statement to assert on batching and ordering.
    const stmt = strings.join('?');
    statements.push(stmt.replace(/\s+/g, ' ').trim());
    if (/DELETE FROM project_files WHERE path/i.test(stmt)) {
      files.delete(values[0]);
      return [];
    }
    if (/INSERT INTO project_files/i.test(stmt)) {
      files.set(values[0], values[1]);
      return [];
    }
    if (/SELECT content FROM project_files/i.test(stmt)) {
      return [{ content: files.get(values[0]) ?? null }];
    }
    return [];
  };
  agent.broadcast = () => {};
  agent.backupToR2 = async () => {};

  return { agent, statements };
}

describe('P4 file extraction commits deletes and writes as one batch', () => {
  it('applies a <file> block and a <delete> block in a single transaction', () => {
    const files = new Map([['/src/old.tsx', 'old']]);
    const { agent, statements } = makeAgent(files);

    const text = [
      '<file path="/src/new.tsx">export const x = 1;</file>',
      '<delete path="/src/old.tsx" />',
    ].join('\n');

    agent.extractAndSaveFiles(text, { id: 'c1' });

    expect(files.get('/src/new.tsx')).toBe('export const x = 1;');
    expect(files.has('/src/old.tsx')).toBe(false);

    // The whole batch must sit inside one transactionSync boundary: exactly one
    // DELETE and one INSERT, issued back to back.
    const deletes = statements.filter(s => s.startsWith('DELETE'));
    const inserts = statements.filter(s => s.startsWith('INSERT'));
    expect(deletes).toHaveLength(1);
    expect(inserts).toHaveLength(1);
    expect(statements.indexOf(deletes[0])).toBeLessThan(statements.indexOf(inserts[0]));
  });

  it('chains several <edit> blocks for the same path so the last one wins', () => {
    const files = new Map([['/src/app.tsx', 'const a = 1;\nconst b = 2;\n']]);
    const { agent } = makeAgent(files);

    const text = [
      '<edit path="/src/app.tsx"><search>const a = 1;</search><replace>const a = 10;</replace></edit>',
      '<edit path="/src/app.tsx"><search>const b = 2;</search><replace>const b = 20;</replace></edit>',
    ].join('\n');

    agent.extractAndSaveFiles(text, { id: 'c1' });

    expect(files.get('/src/app.tsx')).toBe('const a = 10;\nconst b = 20;\n');
  });

  it('leaves the workspace untouched when a path would escape the project root', () => {
    const files = new Map([['/src/app.tsx', 'original']]);
    const { agent } = makeAgent(files);

    // normalizePath drops traversal segments, so this must not reach outside the
    // workspace — and must not overwrite the existing file either.
    agent.extractAndSaveFiles(
      '<file path="../../etc/passwd">root:x:0:0</file>',
      { id: 'c1' }
    );

    expect(files.get('/src/app.tsx')).toBe('original');
    expect([...files.keys()]).not.toContain('../../etc/passwd');
  });

  it('writes nothing when the model output contains no file blocks', () => {
    const files = new Map([['/src/app.tsx', 'original']]);
    const { agent, statements } = makeAgent(files);

    agent.extractAndSaveFiles('Here is some prose with no files in it.', { id: 'c1' });

    expect(files.get('/src/app.tsx')).toBe('original');
    expect(statements.filter(s => s.startsWith('INSERT'))).toHaveLength(0);
  });
});

describe('P4 epoch gate — a superseded generation does not clobber', () => {
  it('discards file writes from a generation a newer one has replaced', () => {
    const files = new Map<string, string>();
    const { agent } = makeAgent(files);

    const staleTicket = agent.writeEpoch.begin();
    // The user stopped and re-prompted, or a newer generation simply started.
    agent.writeEpoch.begin();
    expect(agent.writeEpoch.accepts(staleTicket)).toBe(false);

    agent.extractAndSaveFiles('<file path="src/stale.tsx">// stale</file>', { id: 'c1' }, staleTicket);

    expect(files.has('/src/stale.tsx')).toBe(false);
  });
});
