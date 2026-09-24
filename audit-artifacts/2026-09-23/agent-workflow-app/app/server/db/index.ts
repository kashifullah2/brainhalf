import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from '../config.ts';

mkdirSync(dirname(config.databasePath), { recursive: true });
export const database = new DatabaseSync(config.databasePath);
database.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
export function migrate() {
  database.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY)');
  const directory = new URL('./migrations/', import.meta.url);
  for (const name of readdirSync(directory).filter(name => /^\d+_[\w-]+\.sql$/.test(name)).sort()) {
    database.exec('BEGIN IMMEDIATE');
    try {
      if (!database.prepare('SELECT name FROM schema_migrations WHERE name = ?').get(name)) {
        database.exec(readFileSync(new URL(name, directory), 'utf8'));
        database.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run(name);
      }
      database.exec('COMMIT');
    } catch (error) { database.exec('ROLLBACK'); throw error; }
  }
}
