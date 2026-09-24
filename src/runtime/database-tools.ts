import { CloudflareAPI } from './cloudflare-api';
import { RuntimeError } from './types';

export function databaseIdentifier(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(value) || /^(sqlite|_cf|_bh)/i.test(value)) throw new RuntimeError('Choose an application table or column.');
  return `"${value}"`;
}

/** One parameterized INSERT is atomic: a bad row cannot leave a partial import. */
export function prepareRowImport(table: string, input: unknown, allowedColumns: string[]) {
  const identifier = databaseIdentifier(table);
  if (!Array.isArray(input) || !input.length || input.length > 100) throw new RuntimeError('Import a JSON array containing 1 to 100 records.');
  if (!input[0] || typeof input[0] !== 'object' || Array.isArray(input[0])) throw new RuntimeError('Every record must be an object.');
  const columns = Object.keys(input[0]);
  if (!columns.length || columns.length * input.length > 100 || columns.some(column => !allowedColumns.includes(column))) throw new RuntimeError('Import at most 100 field values using existing columns.');
  const params: Array<string | number | null> = [];
  for (const row of input) {
    if (!row || typeof row !== 'object' || Array.isArray(row) || Object.keys(row).length !== columns.length || columns.some(column => !Object.prototype.hasOwnProperty.call(row, column))) throw new RuntimeError('All records must have the same columns.');
    for (const column of columns) {
      const value = row[column];
      if (!(value === null || typeof value === 'string' && value.length <= 8000 || typeof value === 'number' && Number.isFinite(value) || typeof value === 'boolean')) throw new RuntimeError('Use text, finite numbers, booleans or null; each text value is limited to 8,000 characters.');
      params.push(typeof value === 'boolean' ? Number(value) : value);
    }
  }
  return { sql: `INSERT INTO ${identifier} (${columns.map(databaseIdentifier).join(',')}) VALUES ${input.map(() => '(' + columns.map(() => '?').join(',') + ')').join(',')}`, params, count: input.length };
}

export async function readDatabaseTable(api: CloudflareAPI, databaseId: string, table: string, offset = 0) {
  const name = databaseIdentifier(table);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1_000_000) throw new RuntimeError('Invalid page.');
  const schema = await api.query(databaseId, `PRAGMA table_info(${name})`);
  if (!schema.length) throw new RuntimeError('Table no longer exists.', 404);
  // Bounded response for columns containing large text or binary data.
  const columns = schema.map(column => String(column.name));
  const expressions = columns.map(column => {
    const identifier = databaseIdentifier(column);
    return `CASE WHEN typeof(${identifier})='blob' THEN '[binary value]' WHEN length(CAST(${identifier} AS TEXT))>8000 THEN '[value exceeds 8000 characters]' ELSE ${identifier} END AS ${identifier}`;
  });
  const rows = await api.query(databaseId, `SELECT ${expressions.join(',')} FROM ${name} LIMIT 51 OFFSET ?`, [offset]);
  return { columns, rows: rows.slice(0, 50), hasMore: rows.length > 50, offset, truncatedCells: true };
}
