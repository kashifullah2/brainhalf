import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { AGENT_MIGRATIONS, runMigrations } from '../lib/migrations';

it('upgrades existing generation records without inventing historical latency and runs only once', () => {
  const database = new DatabaseSync(':memory:');
  const query = (statement: string) => database.prepare(statement).all();
  const transaction = <Value,>(work: () => Value): Value => {
    database.exec('BEGIN');
    try { const result = work(); database.exec('COMMIT'); return result; }
    catch (error) { database.exec('ROLLBACK'); throw error; }
  };
  try {
    runMigrations(AGENT_MIGRATIONS.filter(migration => migration.version < 10), query, transaction);
    database.prepare('INSERT INTO generation_usage(id,model,started_at,status) VALUES (?,?,?,?)').run('old', 'model', 100, 'completed');
    expect(runMigrations(AGENT_MIGRATIONS, query, transaction)).toBe(1);
    expect(database.prepare('SELECT id,status,first_response_at,provider_calls FROM generation_usage').get()).toEqual({ id: 'old', status: 'completed', first_response_at: null, provider_calls: null });
    expect(runMigrations(AGENT_MIGRATIONS, query, transaction)).toBe(0);
  } finally { database.close(); }
});
