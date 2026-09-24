import { DatabaseSync } from 'node:sqlite';
import { afterEach } from 'vitest';
import { AuthRegistry } from '../../registry';
const databases: DatabaseSync[] = [];
afterEach(() => { for (const database of databases.splice(0)) database.close(); });
export function sqliteStorage() {
  const database = new DatabaseSync(':memory:'); databases.push(database);
  return {
    database,
    sql: { exec(query: string, ...values: any[]) { const rows = database.prepare(query).all(...values); return { toArray: () => rows, [Symbol.iterator]: () => rows[Symbol.iterator]() }; } },
    transactionSync<T>(work: () => T): T { database.exec('BEGIN'); try { const result = work(); database.exec('COMMIT'); return result; } catch (error) { database.exec('ROLLBACK'); throw error; } },
    setAlarm: async (_at: number) => {},
  };
}
export function budgetRegistry() {
  const instances = new Map<string, AuthRegistry>();
  return {
    idFromName: (name: string) => name,
    get(name: string) {
      if (!instances.has(name)) instances.set(name, new AuthRegistry({ storage: sqliteStorage() } as any, {}));
      return { fetch: (input: Request | string, init?: RequestInit) => instances.get(name)!.fetch(typeof input === 'string' ? new Request(input, init) : input) };
    },
  };
}
