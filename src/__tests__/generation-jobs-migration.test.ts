import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { AGENT_MIGRATIONS, runMigrations } from '../lib/migrations';

it('adds the generation_jobs resume table without touching existing data and runs only once', () => {
  const database = new DatabaseSync(':memory:');
  const query = (statement: string) => database.prepare(statement).all();
  const transaction = <Value,>(work: () => Value): Value => {
    database.exec('BEGIN');
    try { const result = work(); database.exec('COMMIT'); return result; }
    catch (error) { database.exec('ROLLBACK'); throw error; }
  };
  try {
    runMigrations(AGENT_MIGRATIONS.filter(migration => migration.version < 11), query, transaction);
    database.prepare('INSERT INTO generation_usage(id,model,started_at,status) VALUES (?,?,?,?)').run('old', 'model', 100, 'completed');
    expect(runMigrations(AGENT_MIGRATIONS, query, transaction)).toBe(2);
    const tables = database.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='generation_jobs'`).all();
    expect(tables.length).toBe(1);
    // Pre-existing usage rows survive the upgrade untouched.
    expect(database.prepare('SELECT id,status FROM generation_usage').get()).toEqual({ id: 'old', status: 'completed' });
    // The new table accepts a full job row.
    database.prepare(`INSERT INTO generation_jobs(id,prompt,model,status,completed_files,error,resume_count,parent_job_id,started_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run('j1', 'build a shop', 'claude', 'interrupted', '["/src/App.tsx"]', 'dropped', 0, null, 200, 300);
    expect(database.prepare('SELECT status FROM generation_jobs WHERE id=?').get('j1')).toEqual({ status: 'interrupted' });
    expect(runMigrations(AGENT_MIGRATIONS, query, transaction)).toBe(0);
  } finally { database.close(); }
});
