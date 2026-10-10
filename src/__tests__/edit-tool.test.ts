/**
 * Tests for the edit-tool enhancement:
 *   1. write_file redirects to edit_file when ≥60% of the file is unchanged
 *   2. edit_file returns { success: false, error } when the search text is not found
 *
 * The tool execute closures live inside `runGeneration`, so we capture them via
 * a spy on the mocked `streamText` — identical pattern to agent-tools-wiring.test.ts.
 */
import { budgetRegistry } from './helpers/storage';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyExactEdits } from '../lib/exact-edits';

const stream = vi.hoisted(() => vi.fn((_opts: any) => ({
  text: Promise.resolve(''),
  totalUsage: Promise.resolve({ inputTokens: 0, outputTokens: 0 }),
})));

vi.mock('cloudflare:workers', () => ({
  tracing: { enterSpan: async (_name: string, fn: (s: { setAttribute: () => void }) => any) => fn({ setAttribute: () => {} }) },
}));
vi.mock('agents', () => ({ Agent: class Agent {} }));
vi.mock('@ai-sdk/anthropic', () => ({ createAnthropic: vi.fn(() => vi.fn(() => ({ provider: 'anthropic' }))) }));
vi.mock('@ai-sdk/amazon-bedrock', () => ({ createAmazonBedrock: vi.fn(() => vi.fn(() => ({ provider: 'aws' }))) }));
vi.mock('@ai-sdk/openai', () => ({ createOpenAI: vi.fn(() => ({ chat: vi.fn(() => ({ provider: 'atria' })) })) }));
vi.mock('ai', () => ({
  streamText: stream,
  tool: (def: unknown) => def,
  isStepCount: (count: number) => ({ count }),
}));

import { ChatAgent } from '../agent';

function makeAgent(files: Map<string, string>) {
  const agent: any = Object.create(ChatAgent.prototype);
  agent.writeEpoch = { accepts: () => true, begin: () => 1, value: 1 };
  agent.broadcast = vi.fn();
  agent.extractAndSaveFiles = vi.fn();
  agent.saveTurn = vi.fn();
  agent.env = { REGISTRY: budgetRegistry(), REQUIRED_MODEL_PROVIDERS: 'aws', AWS_BEARER_TOKEN_BEDROCK: 'test-key' };
  agent.connectionUserIds = new Map([['c1', 'owner']]);
  agent.authCache = new Map();
  agent.runSql = vi.fn((strings: TemplateStringsArray, ...values: any[]) => {
    const stmt = strings.join('?');
    if (/SELECT content FROM project_files WHERE path/i.test(stmt)) {
      const content = files.get(values[0] as string);
      return content !== undefined ? [{ content }] : [];
    }
    return [];
  });
  return agent;
}

/** Returns the tools captured from the last streamText call. */
function capturedTools(): Record<string, any> {
  return (stream as any).mock.calls.at(-1)?.[0]?.tools ?? {};
}

beforeEach(() => stream.mockClear());
afterEach(() => stream.mockClear());

// ---------------------------------------------------------------------------
// write_file 40% guard: a one-line change to a 700-line file is blocked
// ---------------------------------------------------------------------------
describe('write_file: 40% threshold — one-line change to 700-line file is rejected', () => {
  it('returns { success: false } and directs the model to use edit_file', async () => {
    const base = Array.from({ length: 700 }, (_, i) => `const value${i} = ${i};`);
    const original = base.join('\n');
    const updated = [...base.slice(0, 350), 'const value350 = 9999;', ...base.slice(351)].join('\n');

    const files = new Map([['/src/App.tsx', original]]);
    const agent = makeAgent(files);
    const connection = { id: 'c1', send: vi.fn() };

    await agent.runGeneration(connection, { model: 'claude-sonnet-6' }, 'system', 'Fix a bug', 1);

    const tools = capturedTools();
    expect(tools.write_file, 'write_file tool should be in captured tools').toBeDefined();

    const result = await tools.write_file.execute({ path: '/src/App.tsx', content: updated });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/edit_file/i);
    expect(result.error).toMatch(/unchanged/i);
  });
});

// ---------------------------------------------------------------------------
// edit_file: failed match is returned to the model as { success: false, error }
// ---------------------------------------------------------------------------
describe('edit_file: failed search is reported to the model', () => {
  it('returns { success: false, error } containing "did not match" when search text is absent', async () => {
    const existing = 'const x = 1;\nconst y = 2;\nconst z = 3;\n';
    const files = new Map([['/src/util.ts', existing]]);
    const agent = makeAgent(files);
    const connection = { id: 'c1', send: vi.fn() };

    await agent.runGeneration(connection, { model: 'claude-sonnet-6' }, 'system', 'Refactor', 1);

    const tools = capturedTools();
    expect(tools.read_file, 'read_file tool should be in captured tools').toBeDefined();
    expect(tools.edit_file, 'edit_file tool should be in captured tools').toBeDefined();

    // Simulate the model reading the file first (populates inspectedFiles inside the closure)
    await tools.read_file.execute({ path: '/src/util.ts' });

    // Attempt an edit with a search string that does not exist in the file
    const result = await tools.edit_file.execute({
      path: '/src/util.ts',
      edits: [{ search: 'NOT_IN_FILE', replace: 'replacement' }],
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/did not match/i);
  });
});

// ---------------------------------------------------------------------------
// applyExactEdits: unit tests for the core matching logic
// ---------------------------------------------------------------------------
describe('applyExactEdits: exact-match semantics', () => {
  it('throws "did not match" when search text is absent', () => {
    expect(() => applyExactEdits('hello world', [{ search: 'NOT_FOUND', replace: 'x' }]))
      .toThrow('did not match');
  });

  it('throws "ambiguous" when search text appears more than once', () => {
    expect(() => applyExactEdits('dup dup', [{ search: 'dup', replace: 'x' }]))
      .toThrow('ambiguous');
  });

  it('applies a single-line edit correctly', () => {
    const result = applyExactEdits('const x = 1;\nconst y = 2;', [{ search: 'const x = 1;', replace: 'const x = 42;' }]);
    expect(result).toBe('const x = 42;\nconst y = 2;');
  });

  it('applies multiple sequential edits in order', () => {
    const result = applyExactEdits(
      'const a = 1;\nconst b = 2;\n',
      [
        { search: 'const a = 1;', replace: 'const a = 10;' },
        { search: 'const b = 2;', replace: 'const b = 20;' },
      ]
    );
    expect(result).toBe('const a = 10;\nconst b = 20;\n');
  });
});
