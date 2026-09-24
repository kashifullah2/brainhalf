import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { SourceHistory, SOURCE_HISTORY_SCHEMA, sourceChanges } from '../lib/source-history';
import { boundedConversation, fileContextRank } from '../lib/agent-context';

let db: DatabaseSync | undefined;
afterEach(() => { db?.close(); db = undefined; });
function history() {
  db = new DatabaseSync(':memory:'); for (const sql of SOURCE_HISTORY_SCHEMA) db.exec(sql);
  return new SourceHistory((sql, ...params) => { const statement = db!.prepare(sql); return statement.columns().length ? statement.all(...params) : (statement.run(...params), []); });
}
describe('source recovery and agent context', () => {
  it('versions source while excluding secret configuration and build output', () => {
    const store = history(); const checkpoint = store.save({ '/src/App.tsx': 'old app', '/.env': 'secret', '/.dev.vars': 'secret', '/dist/a.js': 'output' }, 4, 'Working version');
    expect(store.files(checkpoint.id)).toEqual({ '/src/App.tsx': 'old app' });
    expect(store.list()[0]).not.toHaveProperty('files');
    expect(sourceChanges({ '/src/App.tsx': 'new app', '/src/new.ts': 'new' }, store.files(checkpoint.id))).toMatchObject([{ path: '/src/App.tsx', change: 'modify' }, { path: '/src/new.ts', change: 'remove' }]);
  });
  it('caps retained versions and refuses oversized snapshots without saving them', () => {
    const store = history(); const first = store.save({}, 0, 'first');
    for (let i = 0; i < 13; i++) store.save({ '/app.ts': String(i) }, i + 1, 'checkpoint');
    expect(store.list()).toHaveLength(12); expect(() => store.files(first.id)).toThrow('no longer');
    expect(() => store.save({ '/huge.ts': 'x'.repeat(4_000_001) }, 99, 'too big')).toThrow('4 MB');
    expect(store.list()).toHaveLength(12);
  });
  it('prioritizes files referenced in the actual request', () => {
    expect(fileContextRank('/src/components/Checkout.tsx', 'Fix /src/components/Checkout.tsx')).toBeLessThan(fileContextRank('/src/App.tsx', 'Fix checkout'));
  });
  it('bounds large prior messages, summarizes code, and sends the current prompt once', () => {
    const messages = boundedConversation([{ role: 'user', content: 'x'.repeat(50_000) }, { role: 'assistant', content: '<file path="/app.ts">' + 'y'.repeat(80_000) + '</file>' }, { role: 'user', content: '/plan Fix checkout' }], 'Fix checkout');
    expect(messages.filter(message => message.content === 'Fix checkout')).toHaveLength(1);
    expect(messages.map(message => message.content).join('').length).toBeLessThan(29_000);
    expect(messages[1].content).toContain('read current source');
  });
});
