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
  it('applies file creation and edits in the order generated', () => {
    const files = new Map<string, string>();
    const { agent } = makeAgent(files);
    agent.extractAndSaveFiles('<file path="/src/data.txt">original</file><edit path="/src/data.txt"><search>original</search><replace>updated</replace></edit>', { id: 'connection' });
    expect(files.get('/src/data.txt')).toBe('updated');
    agent.extractAndSaveFiles('<edit path="/src/data.txt"><search>updated</search><replace>intermediate</replace></edit><file path="/src/data.txt">final</file>', { id: 'connection' });
    expect(files.get('/src/data.txt')).toBe('final');
  });

  it('honors a deletion after a write and a write after a deletion', () => {
    const files = new Map<string, string>();
    const { agent } = makeAgent(files);
    agent.extractAndSaveFiles('<file path="/src/data.txt">new</file><delete path="/src/data.txt" />', { id: 'connection' });
    expect(files.has('/src/data.txt')).toBe(false);
    agent.extractAndSaveFiles('<delete path="/src/data.txt" /><file path="/src/data.txt">restored</file>', { id: 'connection' });
    expect(files.get('/src/data.txt')).toBe('restored');
  });

  it('reports a mismatched edit without committing earlier pairs from that edit block', () => {
    const files = new Map([['/src/data.txt', 'original']]);
    const { agent } = makeAgent(files);
    const send = vi.fn();
    agent.extractAndSaveFiles('<edit path="/src/data.txt"><search>original</search><replace>updated</replace><search>missing</search><replace>new</replace></edit>', { id: 'connection', send });
    expect(files.get('/src/data.txt')).toBe('original');
    expect(send.mock.calls.map(([message]) => JSON.parse(message))).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'error', error: expect.stringContaining('did not match') })]));
  });
  it('saves fenced file contents without treating the opening fence as the end of the file', () => {
    const files = new Map<string, string>();
    const { agent } = makeAgent(files);
    const source = 'export default function App() { return <h1>Ready</h1>; }';
    agent.extractAndSaveFiles(`<file path="/src/App.jsx">\n\`\`\`jsx\n${source}\n\`\`\`\nThe app is ready.\n</file>`, { id: 'connection' });
    expect(files.get('/src/App.jsx')).toBe(source);
  });

  it('keeps adjacent generated files separate when the first closing tag is missing', () => {
    const files = new Map<string, string>();
    const { agent } = makeAgent(files);
    const source = 'export default function App() { return <h1>Ready</h1>; }';
    agent.extractAndSaveFiles(`<file path="/src/App.jsx">${source}\n<file path="/src/styles.css">body { margin: 0; }</file>`, { id: 'connection' });
    expect(files.get('/src/App.jsx')).toBe(source);
    expect(files.get('/src/styles.css')).toBe('body { margin: 0; }');
  });

  it('keeps a literal <file> example inside file content instead of truncating (L10)', () => {
    const files = new Map<string, string>();
    const { agent } = makeAgent(files);
    const guide = 'Here is how you write a file:\n<file path="/src/App.jsx">\nexport default function App() { return <h1>Hi</h1>; }\n</file>\nThat is the whole protocol.';
    agent.extractAndSaveFiles(`<file path="/docs/guide.md">${guide}</file>`, { id: 'connection' });
    // The inner markup is documentation, not a second file operation.
    expect(files.get('/docs/guide.md')).toBe(guide);
    expect(files.has('/src/App.jsx')).toBe(false);
  });

  it('preserves the existing file on truncation and asks for a complete replacement', () => {
    const files = new Map([['/src/App.jsx', 'export default function App() { return <h1>Existing</h1>; }']]);
    const original = files.get('/src/App.jsx');
    const { agent } = makeAgent(files);
    const send = vi.fn();
    const result = agent.extractAndSaveFiles('<file path="/src/App.jsx">export default function App() { return <h1>Partial', { id: 'connection', send });
    expect(files.get('/src/App.jsx')).toBe(original);
    expect(result.wasTruncated).toBe(true);
    expect(send.mock.calls.map(([message]) => JSON.parse(message))).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'trigger-auto-reply', message: expect.stringContaining('FULL FILE CONTENT') })]));
  });

  it('persists intentionally empty files and ignores incomplete edit pairs', () => {
    const files = new Map([['/src/styles.css', 'body { color: red; }'], ['/src/data.txt', 'keep this']]);
    const { agent } = makeAgent(files);
    agent.extractAndSaveFiles('<file path="/src/styles.css"></file><edit path="/src/data.txt"><search>keep this</search></edit>', { id: 'connection' });
    expect(files.get('/src/styles.css')).toBe('');
    expect(files.get('/src/data.txt')).toBe('keep this');
  });

  it('stores explicitly named markdown files consistently with chat rendering', () => {
    const files = new Map<string, string>();
    const { agent } = makeAgent(files);
    agent.extractAndSaveFiles('Here is `src/data.json`:\n```json\n{"name":"Tasks"}\n```', { id: 'connection' });
    expect(files.get('/src/data.json')).toBe('{"name":"Tasks"}');
    expect(files.has('/src/styles.css')).toBe(false);
  });
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
