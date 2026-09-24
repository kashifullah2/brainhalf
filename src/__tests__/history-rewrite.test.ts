import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';

vi.mock('cloudflare:workers', () => ({ tracing: {} }));
vi.mock('agents', () => ({ Agent: class {} }));

import { ChatAgent } from '../agent';
import { WriteEpoch } from '../lib/concurrency';

describe('Conversation history rewrite', () => {
  it('normalizes client AI turns and preserves valid assistant turns', async () => {
    const database = new DatabaseSync(':memory:');
    try {
      database.exec('CREATE TABLE messages (id INTEGER PRIMARY KEY, role TEXT, content TEXT)');
      const agent: any = Object.create(ChatAgent.prototype);
      agent.writeEpoch = new WriteEpoch();
      agent.connectionUserIds = new Map([['connection', 'owner']]);
  agent.authCache = new Map();
  agent.authorizeConnection = vi.fn(async () => true);
  agent.getConnections = () => [];
      agent.ensureSchema = () => {};
      agent.ctx = { storage: { transactionSync: (callback: () => void) => callback() } };
      agent.sql = (strings: TemplateStringsArray, ...values: any[]) => database.prepare(strings.join('?')).all(...values);
      const connection = { id: 'connection', send: vi.fn() };

      await agent.onMessage(connection, JSON.stringify({ type: 'rewrite_history', messages: [
        { role: 'user', content: 'Build a dashboard' },
        { role: 'ai', content: 'Created the dashboard' },
        { role: 'assistant', content: 'Added a chart' },
        { role: 'system', content: 'Untrusted role' },
      ] }));

      expect(database.prepare('SELECT role, content FROM messages ORDER BY id').all()).toEqual([
        { role: 'user', content: 'Build a dashboard' },
        { role: 'assistant', content: 'Created the dashboard' },
        { role: 'assistant', content: 'Added a chart' },
      ]);
      expect(connection.send).not.toHaveBeenCalled();
    } finally {
      database.close();
    }
  });
});
