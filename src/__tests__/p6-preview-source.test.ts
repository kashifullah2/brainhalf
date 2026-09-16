import { describe, it, expect, vi } from 'vitest';

vi.mock('cloudflare:workers', () => ({
  tracing: { enterSpan: async (_name: string, fn: () => any) => fn() },
}));
vi.mock('agents', () => ({ Agent: class Agent {} }));

import { ChatAgent } from '../agent';

/**
 * The preview error card was extracted into a shared module constant and
 * interpolated into two template literals that are themselves *source text* for
 * the preview runtime. The extraction is only correct if the interpolation
 * survives as literal text: `${this.state.error?.message}` must reach the
 * generated code, not be evaluated where `this` is a ChatAgent. This exercises
 * the observable output — the starter seeded into a fresh workspace — to catch
 * a broken escape, which tsc and vite cannot.
 */
describe('P6 the extracted preview error card survives into generated source', () => {
  function makeAgent(files: Map<string, string>) {
    const agent: any = Object.create(ChatAgent.prototype);
    agent.writeEpoch = undefined;
    agent.ctx = { storage: { transactionSync: <R,>(c: () => R): R => c() } };
    agent.sql = (strings: TemplateStringsArray, ...values: any[]) => {
      const stmt = strings.join('?');
      if (/SELECT COUNT/i.test(stmt)) return [{ count: files.size }];
      // The seed writes the path as a statement literal and binds only the
      // content, so the path comes out of the text, not the bound values.
      const ins = stmt.match(/INSERT (?:OR IGNORE )?INTO project_files \(path, content\) VALUES \('([^']+)', \?\)/);
      if (ins) {
        files.set(ins[1], values[0]);
        return [];
      }
      return [];
    };
    agent.broadcast = () => {};
    agent.backupToR2 = async () => {};
    return agent;
  }

  it('emits the error card with its interpolation intact, not evaluated', () => {
    const files = new Map<string, string>();
    const agent = makeAgent(files);

    agent.seedStarterIfEmpty();

    const main = files.get('/src/main.jsx') ?? files.get('src/main.jsx');
    expect(main).toBeTruthy();

    // The card markup itself.
    expect(main).toContain('>Preview Error<');
    expect(main).toContain('Reload Preview');
    // And — the point of the test — the live interpolation, as text.
    expect(main).toContain('${this.state.error?.message || \'A render error occurred.\'}');
    // A broken escape would have interpolated the ChatAgent's own state.
    expect(main).not.toContain('[object Object]');
  });
});
