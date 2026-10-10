import { describe, it, expect, vi } from 'vitest';
import { FlipFlopGuard, RepairLog } from '../lib/repair-budget';

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
  agent.name = 'test-project';
  agent.flipFlopGuard = new FlipFlopGuard();
  agent.repairLog = new RepairLog();

  const events: any[] = [];
  const connection = { id: 'connection', send: (message: string) => events.push(JSON.parse(message)) };
  return { agent, statements, connection, events };
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

import { checkShrinkage, isShrinkIntentional, isConfigWriteBlocked, SHRINK_OK_MARKER, estimateUnchangedFraction } from '../lib/write-guard';

describe('write-guard primitives', () => {
  describe('checkShrinkage', () => {
    it('rejects a 772→443 line App.tsx write (audio visualizer regression)', () => {
      const existing = Array.from({ length: 772 }, (_, i) => `// line ${i + 1} padding to reach realistic size`).join('\n');
      const shrunk = Array.from({ length: 443 }, (_, i) => `// line ${i + 1} padding to reach realistic size`).join('\n');
      // 443/772 ≈ 57% — well below the 70% threshold
      expect(checkShrinkage('/src/App.tsx', shrunk, existing)).toBeGreaterThan(0);
    });

    it('always checks /worker/index.ts even when byte count is small', () => {
      const existing = 'export default { fetch() {} }'.repeat(5); // ~145 bytes
      const shrunk = 'export default {};';
      expect(checkShrinkage('/worker/index.ts', shrunk, existing)).toBeGreaterThan(0);
    });

    it('always checks files >200 lines regardless of byte size', () => {
      const existing = Array.from({ length: 210 }, (_, i) => `line${i}`).join('\n');
      const shrunk = 'line0\nline1\n';
      expect(checkShrinkage('/src/big.tsx', shrunk, existing)).toBeGreaterThan(0);
    });

    it('allows a write within 30% of original size', () => {
      const existing = 'x'.repeat(1000);
      const similar = 'x'.repeat(720); // 72% — just above threshold
      expect(checkShrinkage('/src/App.tsx', similar, existing)).toBe(0);
    });

    it('allows empty content (handled by finish_reason check separately)', () => {
      const existing = 'x'.repeat(1000);
      expect(checkShrinkage('/src/App.tsx', '', existing)).toBe(0);
    });

    it('allows writes to new files (no existing)', () => {
      expect(checkShrinkage('/src/App.tsx', 'content', '')).toBe(0);
    });
  });

  describe('isShrinkIntentional', () => {
    it('detects "remove the music player"', () => {
      expect(isShrinkIntentional('remove the music player')).toBe(true);
    });

    it('detects other removal/cleanup keywords', () => {
      expect(isShrinkIntentional('delete the sidebar')).toBe(true);
      expect(isShrinkIntentional('simplify the header')).toBe(true);
      expect(isShrinkIntentional('strip out the analytics')).toBe(true);
      expect(isShrinkIntentional('rewrite the app from scratch')).toBe(true);
    });

    it('returns false for unrelated prompts', () => {
      expect(isShrinkIntentional('add a dark mode toggle')).toBe(false);
      expect(isShrinkIntentional('fix the button color')).toBe(false);
      expect(isShrinkIntentional('')).toBe(false);
    });
  });

  describe('SHRINK_OK_MARKER bypass', () => {
    it('marker string matches expected value', () => {
      expect(SHRINK_OK_MARKER).toBe('/* shrink-ok */');
    });
  });

  describe('isConfigWriteBlocked', () => {
    it('blocks package.json / tsconfig / vite.config when not in prompt', () => {
      expect(isConfigWriteBlocked('/package.json', 'add a dark mode toggle')).toBe(true);
      expect(isConfigWriteBlocked('/tsconfig.json', 'add a dark mode toggle')).toBe(true);
      expect(isConfigWriteBlocked('/vite.config.ts', 'add a dark mode toggle')).toBe(true);
    });

    it('allows when prompt mentions the file by name', () => {
      expect(isConfigWriteBlocked('/package.json', 'update package.json to add react-query')).toBe(false);
      expect(isConfigWriteBlocked('/tsconfig.json', 'fix the tsconfig.json path aliases')).toBe(false);
      expect(isConfigWriteBlocked('/vite.config.ts', 'update vite.config.ts')).toBe(false);
    });

    it('allows package.json when prompt mentions dependencies', () => {
      expect(isConfigWriteBlocked('/package.json', 'add react-query as a dependency')).toBe(false);
      expect(isConfigWriteBlocked('/package.json', 'install the latest version of date-fns')).toBe(false);
    });

    it('allows tsconfig when prompt mentions TypeScript config', () => {
      expect(isConfigWriteBlocked('/tsconfig.json', 'enable strict mode in typescript')).toBe(false);
    });

    it('allows vite.config when prompt mentions the build', () => {
      expect(isConfigWriteBlocked('/vite.config.ts', 'update the vite build config')).toBe(false);
    });

    it('never blocks non-config files', () => {
      expect(isConfigWriteBlocked('/src/App.tsx', 'add a dark mode toggle')).toBe(false);
      expect(isConfigWriteBlocked('/worker/index.ts', 'add a dark mode toggle')).toBe(false);
    });

    it('unblocks when build error context mentions the file', () => {
      expect(isConfigWriteBlocked('/package.json', 'fix the build', 'Cannot find module — check package.json')).toBe(false);
    });
  });
});

describe('write-guard: extractAndSaveFiles regression (audio visualizer)', () => {
  it('rejects a 772→443 line App.tsx write and preserves old content', () => {
    const existingLine = '// line content with realistic padding to hit byte threshold   ';
    const existing = Array.from({ length: 772 }, () => existingLine).join('\n');
    const shrunk = Array.from({ length: 443 }, () => existingLine).join('\n');
    const files = new Map([['/src/App.tsx', existing]]);
    const { agent, connection } = makeAgent(files);

    const summary = agent.extractAndSaveFiles(`<file path="/src/App.tsx">${shrunk}</file>`, connection);

    expect(files.get('/src/App.tsx')).toBe(existing); // old content preserved
    expect(summary.hadSyntaxDrops).toBe(true);
  });

  it('allows a 772→443 line write when prompt says "remove the music player" (intentional removal)', () => {
    const existingLine = '// line content with realistic padding to hit byte threshold';
    const existing = Array.from({ length: 772 }, () => existingLine).join('\n');
    const shrunk = Array.from({ length: 443 }, () => existingLine).join('\n');
    const files = new Map([['/src/App.tsx', existing]]);
    const { agent, connection } = makeAgent(files);
    agent.activeGeneration = { prompt: 'remove the music player', id: 'x', model: 'm', response: '', startedAt: 0, filesChanged: false, truncated: false, epoch: 1 };

    agent.extractAndSaveFiles(`<file path="/src/App.tsx">${shrunk}</file>`, connection);

    // shrinkage bypassed — new (shorter) content should be saved
    expect(files.get('/src/App.tsx')).not.toBe(existing);
    expect(files.get('/src/App.tsx')?.split('\n').length).toBeLessThan(772);
  });

  it('allows a shrunk write when SHRINK_OK_MARKER is present in the content', () => {
    const existingLine = '// line content with realistic padding to hit byte threshold';
    const existing = Array.from({ length: 772 }, () => existingLine).join('\n');
    const shrunk = `/* shrink-ok */\n` + Array.from({ length: 443 }, () => existingLine).join('\n');
    const files = new Map([['/src/App.tsx', existing]]);
    const { agent, connection } = makeAgent(files);

    agent.extractAndSaveFiles(`<file path="/src/App.tsx">${shrunk}</file>`, connection);

    // marker present — new content should be saved (not the 772-line original)
    expect(files.get('/src/App.tsx')).not.toBe(existing);
    expect(files.get('/src/App.tsx')).toContain(SHRINK_OK_MARKER);
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

describe('estimateUnchangedFraction — 40% write_file redirect threshold', () => {
  it('returns near 1.0 for a 700-line file with one changed line (triggers write_file redirect)', () => {
    const base = Array.from({ length: 700 }, (_, i) => `const line${i} = ${i};`);
    const original = base.join('\n');
    const updated = [...base.slice(0, 350), 'const line350 = 9999;', ...base.slice(351)].join('\n');
    expect(estimateUnchangedFraction(original, updated)).toBeGreaterThanOrEqual(0.99);
  });

  it('fraction ≥ 0.6 means write_file would redirect to edit_file', () => {
    const base = Array.from({ length: 700 }, (_, i) => `const line${i} = ${i};`);
    const original = base.join('\n');
    const updated = [...base.slice(0, 350), 'const line350 = 9999;', ...base.slice(351)].join('\n');
    // A file with 699/700 unchanged lines is well above the 0.6 threshold
    expect(estimateUnchangedFraction(original, updated)).toBeGreaterThanOrEqual(0.6);
  });

  it('returns below 0.6 when more than 40% of lines change (write_file allowed)', () => {
    // 5 of 10 lines change — 50% changed, 50% unchanged → below 0.6
    const original = ['A', 'B', 'C', 'D', 'E', 'line5', 'line6', 'line7', 'line8', 'line9'].join('\n');
    const updated = ['X', 'Y', 'Z', 'W', 'V', 'line5', 'line6', 'line7', 'line8', 'line9'].join('\n');
    expect(estimateUnchangedFraction(original, updated)).toBeLessThan(0.6);
  });

  it('returns 0 for completely different content', () => {
    const original = Array.from({ length: 10 }, (_, i) => `old${i}`).join('\n');
    const updated = Array.from({ length: 10 }, (_, i) => `new${i}`).join('\n');
    expect(estimateUnchangedFraction(original, updated)).toBe(0);
  });

  it('returns 1 for two empty strings (identical content, nothing changed)', () => {
    expect(estimateUnchangedFraction('', '')).toBe(1);
  });
});
