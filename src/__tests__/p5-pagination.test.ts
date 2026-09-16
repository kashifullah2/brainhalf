import { describe, it, expect, vi } from 'vitest';

/**
 * Same stubs as agent-write-guards: agent.ts pulls in `cloudflare:workers` and
 * the `agents` SDK base class, neither of which loads under Node/vitest.
 */
vi.mock('cloudflare:workers', () => ({
  tracing: { enterSpan: async (_name: string, fn: () => any) => fn() },
}));
vi.mock('agents', () => ({ Agent: class Agent {} }));

import { ChatAgent } from '../agent';
import { InMemoryDataStore, executeBackendRequest } from '../lib/backend-runner';

describe('P5 readProjectFilesPage is bounded in rows and bytes', () => {
  /**
   * A fake SQLite that speaks just the two statements readProjectFilesPage uses:
   * a COUNT for the total, and an ordered LIMIT/OFFSET read. It records the
   * bound values so the test can assert the paging contract rather than a guess.
   */
  function makeAgent(files: Array<[string, string]>) {
    const agent: any = Object.create(ChatAgent.prototype);
    const bound: Array<{ limit?: number; offset?: number }> = [];

    agent.sql = (strings: TemplateStringsArray, ...values: any[]) => {
      const stmt = strings.join('?');
      if (/SELECT COUNT\(\*\)/.test(stmt)) {
        return [{ count: files.length }];
      }
      if (/SELECT path, content/.test(stmt)) {
        const limit = values[0];
        const offset = values[1];
        bound.push({ limit, offset });
        return files
          .slice(offset, offset + limit)
          .map(([path, content]) => ({ path, content }));
      }
      return [];
    };

    return { agent, bound };
  }

  it('returns the first page and reports the true total', () => {
    const files: Array<[string, string]> = [];
    for (let i = 0; i < 5; i++) files.push([`/src/f${i}.tsx`, `export const a${i} = ${i};`]);
    const { agent } = makeAgent(files);

    const page = agent.readProjectFilesPage(2, 0);

    expect(Object.keys(page.files)).toEqual(['/src/f0.tsx', '/src/f1.tsx']);
    expect(page.total).toBe(5);
  });

  it('advances the offset so a second page does not repeat the first', () => {
    const files: Array<[string, string]> = [];
    for (let i = 0; i < 5; i++) files.push([`/src/f${i}.tsx`, `export const a${i} = ${i};`]);
    const { agent } = makeAgent(files);

    const first = agent.readProjectFilesPage(2, 0);
    const second = agent.readProjectFilesPage(2, 2);

    expect(Object.keys(first.files)).toEqual(['/src/f0.tsx', '/src/f1.tsx']);
    expect(Object.keys(second.files)).toEqual(['/src/f2.tsx', '/src/f3.tsx']);
    expect([...Object.keys(first.files), ...Object.keys(second.files)]).toHaveLength(4);
  });

  it('stops adding files once the byte ceiling is reached', () => {
    // Each file is ~1MB; a 8MB ceiling must not accumulate all ten.
    const big = 'x'.repeat(1024 * 1024);
    const files: Array<[string, string]> = [];
    for (let i = 0; i < 10; i++) files.push([`/src/big${i}.txt`, big]);
    const { agent } = makeAgent(files);

    const page = agent.readProjectFilesPage(200, 0);

    expect(page.total).toBe(10);
    expect(Object.keys(page.files).length).toBeLessThan(10);
    expect(Object.keys(page.files).length).toBeGreaterThan(0);
  });

  it('reports an empty workspace without touching the row table', () => {
    const { agent, bound } = makeAgent([]);

    const page = agent.readProjectFilesPage(50, 0);

    expect(page.files).toEqual({});
    expect(page.total).toBe(0);
    expect(bound).toHaveLength(0);
  });
});

describe('P5 InMemoryDataStore.create rejects duplicate ids', () => {
  it('throws a 409 instead of silently overwriting an existing row', () => {
    const store = new InMemoryDataStore();
    store.create('users', { id: 'u1', email: 'a@b.co' });

    expect(() => store.create('users', { id: 'u1', email: 'other@b.co' })).toThrow(
      /already exists/
    );
    // The original row survived the attempt.
    expect(store.findById('users', 'u1').email).toBe('a@b.co');
  });

  it('does not let a non-numeric id reset the auto counter', () => {
    const store = new InMemoryDataStore();
    store.create('events', { id: 'evt_abc', label: 'first' });

    // Before the fix, Number('evt_abc') is NaN, so the counter reset to 1 and
    // this auto id collided with nothing — but the *next* one would reuse an id.
    const auto = store.create('events', { label: 'auto' });

    expect(auto.id).toBe(1);
    const auto2 = store.create('events', { label: 'auto2' });
    expect(auto2.id).toBe(2);
  });

  it('advances the auto counter past a caller-supplied numeric id', () => {
    const store = new InMemoryDataStore();
    store.create('events', { id: 5, label: 'explicit' });

    const auto = store.create('events', { label: 'auto' });

    expect(auto.id).toBe(6);
  });

  it('surfaces as a real 409 through executeBackendRequest, not a 500', async () => {
    const store = new InMemoryDataStore();
    const files = {
      '/server/index.js': `
        export default { async fetch(req) { return new Response('ok'); } }
      `,
    };

    await executeBackendRequest(files, { method: 'POST', url: '/api/users', body: { id: 'dup', name: 'first' } }, store);
    const res = await executeBackendRequest(files, { method: 'POST', url: '/api/users', body: { id: 'dup', name: 'second' } }, store);

    expect(res.status).toBe(409);
    expect(res.body?.error).toMatch(/already exists/);
  });
});
