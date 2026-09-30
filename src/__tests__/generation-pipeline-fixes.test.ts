import { describe, it, expect, vi } from 'vitest';

/**
 * agent.ts imports `cloudflare:workers` (tracing) and the `agents` SDK base class,
 * neither of which loads under Node/vitest. Neither is on the extraction path
 * under test, so both are stubbed: the real `ChatAgent` methods are what we exercise.
 */
vi.mock('cloudflare:workers', () => ({
  tracing: { enterSpan: async (_name: string, fn: () => any) => fn() },
}));
vi.mock('agents', () => ({ Agent: class Agent {} }));

import {
  ChatAgent,
  TRUNCATION_RETRY_MESSAGE,
  findUnterminatedBlock,
  isAppFirstBackendPath,
  isBackendWritePath,
} from '../agent';
import { WriteEpoch } from '../lib/concurrency';

/**
 * Drives `extractAndSaveFiles` through a fake SQLite handle, mirroring
 * agent-write-guards.test.ts. `transactionSync` snapshots the file map so the
 * tests can verify the extraction batch is truly atomic, the way the Durable
 * Object's real SQLite transaction is.
 */
function makeAgent(files: Map<string, string>) {
  const agent: any = Object.create(ChatAgent.prototype);
  agent.writeEpoch = new WriteEpoch();
  agent.ctx = {
    storage: {
      transactionSync: <R,>(closure: () => R): R => {
        const snapshot = new Map(files);
        try {
          return closure();
        } catch (error) {
          files.clear();
          for (const [path, content] of snapshot) files.set(path, content);
          throw error;
        }
      },
    },
  };

  agent.sql = (strings: TemplateStringsArray, ...values: any[]) => {
    const stmt = strings.join('?').replace(/\s+/g, ' ').trim();
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
    if (/SELECT 1 FROM project_files/i.test(stmt)) {
      return files.has(values[0]) ? [{ 1: 1 }] : [];
    }
    return [];
  };
  agent.broadcast = () => {};
  agent.backupToR2 = async () => {};

  const events: any[] = [];
  const connection = { id: 'connection', send: (message: string) => events.push(JSON.parse(message)) };
  return { agent, connection, events };
}

describe('findUnterminatedBlock', () => {
  it('detects an unterminated <file> block', () => {
    expect(findUnterminatedBlock('<file path="/src/Big.tsx">partial content')).toBe('file');
  });

  it('ignores a closed <file> block', () => {
    expect(findUnterminatedBlock('<file path="/src/App.tsx">content</file>')).toBeNull();
  });

  it('detects an unterminated <edit> block', () => {
    // Regression: the old check only looked for <file>, so a cut-off <edit>
    // was dropped silently and the requested fix never applied.
    expect(findUnterminatedBlock('<edit path="/src/App.tsx"><search>a</search><replace>b')).toBe('edit');
  });

  it('ignores a closed <edit> block', () => {
    expect(findUnterminatedBlock('<edit path="/src/App.tsx"><search>a</search><replace>b</replace></edit>')).toBeNull();
  });

  it('detects an unterminated <delete> block', () => {
    expect(findUnterminatedBlock('<delete path="/src/Old.tsx">')).toBe('delete');
  });

  it('treats a self-closing <delete/> as closed', () => {
    expect(findUnterminatedBlock('<delete path="/src/Old.tsx" />')).toBeNull();
  });

  it('returns null when there are no blocks', () => {
    expect(findUnterminatedBlock('Just some prose about the app.')).toBeNull();
  });
});

describe('backend write-path classification', () => {
  it('isBackendWritePath covers every backend layout, including /server', () => {
    for (const path of ['/worker/index.ts', '/migrations/0001.sql', '/shared/types.ts', '/server/routes.js', '/server/.env']) {
      expect(isBackendWritePath(path)).toBe(true);
    }
    expect(isBackendWritePath('/src/App.tsx')).toBe(false);
    expect(isBackendWritePath('/src/components/Header.tsx')).toBe(false);
    // Prefix lookalikes must not match.
    expect(isBackendWritePath('/serverless.yml')).toBe(false);
  });

  it('isAppFirstBackendPath exempts inert schema/shared files from the App-first gate', () => {
    expect(isAppFirstBackendPath('/worker/index.ts')).toBe(true);
    expect(isAppFirstBackendPath('/server/routes.js')).toBe(true);
    // The staged pipeline writes these first by design; nothing in the preview
    // or build depends on their write order.
    expect(isAppFirstBackendPath('/migrations/0001.sql')).toBe(false);
    expect(isAppFirstBackendPath('/shared/types.ts')).toBe(false);
    expect(isAppFirstBackendPath('/src/App.tsx')).toBe(false);
  });
});

describe('extractAndSaveFiles truncation handling', () => {
  it('caps consecutive truncation auto-retries, then reports a plain-language error', () => {
    const { agent, connection, events } = makeAgent(new Map());
    agent.truncationRetries = 0;
    const truncated = '<file path="/src/Big.tsx">' + 'x'.repeat(500);

    const summary1 = agent.extractAndSaveFiles(truncated, connection);
    const summary2 = agent.extractAndSaveFiles(truncated, connection);
    expect(summary1.wasTruncated).toBe(true);
    expect(summary2.wasTruncated).toBe(true);
    expect(events.filter(event => event.type === 'trigger-auto-reply').map(event => event.message))
      .toEqual([TRUNCATION_RETRY_MESSAGE, TRUNCATION_RETRY_MESSAGE]);

    // Third consecutive truncation: stop retrying and say so honestly instead
    // of looping forever and burning the user's token budget.
    const summary3 = agent.extractAndSaveFiles(truncated, connection);
    expect(summary3.wasTruncated).toBe(true);
    const terminal = events.find(event => event.type === 'error');
    expect(terminal?.error).toMatch(/too large to finish in one response/);
    expect(events.filter(event => event.type === 'trigger-auto-reply')).toHaveLength(2);
    // The streak resets so a later truncation starts counting from zero again.
    expect(agent.truncationRetries).toBe(0);
  });

  it('treats an unterminated <edit> as truncation instead of dropping it silently', () => {
    const files = new Map([['/src/App.tsx', 'export default () => <h1>Hi</h1>;']]);
    const { agent, connection, events } = makeAgent(files);
    agent.truncationRetries = 0;

    const summary = agent.extractAndSaveFiles(
      'Here is the fix:\n<edit path="/src/App.tsx">\n<search>Hi</search>\n<replace>Hello',
      connection,
    );
    expect(summary.wasTruncated).toBe(true);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'trigger-auto-reply', message: TRUNCATION_RETRY_MESSAGE });
    // The partial edit was not applied half-done.
    expect(files.get('/src/App.tsx')).toBe('export default () => <h1>Hi</h1>;');
  });

  it('fails the extraction batch atomically and names the file when storage rejects a write', () => {
    const files = new Map<string, string>();
    const { agent, connection, events } = makeAgent(files);
    agent.truncationRetries = 0;
    const realUpsert = agent.upsertFile.bind(agent);
    agent.upsertFile = (path: string, content: string) => (path === '/src/Huge.tsx' ? false : realUpsert(path, content));

    const summary = agent.extractAndSaveFiles(
      '<file path="/src/App.tsx">export default () => <h1>Hi</h1>;</file>' +
        '<file path="/src/Huge.tsx">export default () => <h1>Huge</h1>;</file>',
      connection,
    );
    const terminal = events.find(event => event.type === 'error');
    expect(terminal?.error).toContain('/src/Huge.tsx');
    expect(terminal?.error).toMatch(/per-file limit/);
    expect(summary.writtenCount).toBe(0);
    expect(events.some(event => event.type === 'file_updated')).toBe(false);
    // Atomic: the good file was rolled back with the rejected one.
    expect(files.has('/src/App.tsx')).toBe(false);
  });
});
