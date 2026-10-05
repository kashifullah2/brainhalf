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
  // Include the implicit row id so rows can be edited or deleted. WITHOUT
  // ROWID tables reject the rowid reference — fall back to read-only rows.
  try {
    const rows = await api.query(databaseId, `SELECT rowid AS "__bh_rowid", ${expressions.join(',')} FROM ${name} LIMIT 51 OFFSET ?`, [offset]);
    return { columns, rows: rows.slice(0, 50), hasMore: rows.length > 50, offset, truncatedCells: true, rowIds: true };
  } catch {
    const rows = await api.query(databaseId, `SELECT ${expressions.join(',')} FROM ${name} LIMIT 51 OFFSET ?`, [offset]);
    return { columns, rows: rows.slice(0, 50), hasMore: rows.length > 50, offset, truncatedCells: true, rowIds: false };
  }
}

function rowIdParam(value: unknown): number {
  const rowId = typeof value === 'string' && /^\d{1,15}$/.test(value) ? Number(value) : value;
  if (typeof rowId !== 'number' || !Number.isSafeInteger(rowId) || rowId <= 0) throw new RuntimeError('Choose a row to change.');
  return rowId;
}

/** Prepared DELETE scoped to one row id; callers save a recovery point first. */
export function prepareRowDelete(table: string, rowId: unknown) {
  return { sql: `DELETE FROM ${databaseIdentifier(table)} WHERE rowid = ?`, params: [rowIdParam(rowId)] };
}

function cellValue(value: unknown): string | number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && value.length <= 8000) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'boolean') return Number(value);
  throw new RuntimeError('Use text, finite numbers, booleans or null; each text value is limited to 8,000 characters.');
}

/** Prepared UPDATE of one row by row id; only existing columns may be set. */
export function prepareRowUpdate(table: string, rowId: unknown, values: unknown, allowedColumns: string[]) {
  if (!values || typeof values !== 'object' || Array.isArray(values)) throw new RuntimeError('Send the record fields to update as an object.');
  const entries = Object.entries(values as Record<string, unknown>);
  if (!entries.length || entries.length > 100) throw new RuntimeError('Update between 1 and 100 field values.');
  if (entries.some(([column]) => !allowedColumns.includes(column))) throw new RuntimeError('Only existing columns can be updated.');
  const assignments = entries.map(([column]) => `${databaseIdentifier(column)} = ?`).join(', ');
  const params = [...entries.map(([, value]) => cellValue(value)), rowIdParam(rowId)];
  return { sql: `UPDATE ${databaseIdentifier(table)} SET ${assignments} WHERE rowid = ?`, params };
}

/** Column types offered by the visual schema editor — the portable SQLite set. */
const COLUMN_TYPES = new Set(['TEXT', 'INTEGER', 'REAL', 'BLOB']);

export type ColumnDefinition = {
  name: string;
  type: string;
  primaryKey?: boolean;
  notNull?: boolean;
  defaultValue?: string | number | null;
  /** Foreign key target "table.column" — only allowed at table creation. */
  references?: string;
};

function readColumnDefinition(input: unknown, forAlter: boolean): ColumnDefinition {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new RuntimeError('Every column needs a name and a type.');
  const column = input as Record<string, unknown>;
  const name = databaseIdentifier(column.name);
  const type = typeof column.type === 'string' ? column.type.toUpperCase() : '';
  if (!COLUMN_TYPES.has(type)) throw new RuntimeError('Column type must be TEXT, INTEGER, REAL, or BLOB.');
  const primaryKey = column.primaryKey === true;
  const notNull = column.notNull === true;
  let defaultValue: string | number | null = null;
  if (column.defaultValue !== undefined && column.defaultValue !== null && column.defaultValue !== '') {
    if (typeof column.defaultValue === 'number' && Number.isFinite(column.defaultValue)) defaultValue = column.defaultValue;
    else if (typeof column.defaultValue === 'string' && column.defaultValue.length <= 200) defaultValue = column.defaultValue;
    else throw new RuntimeError('Default values must be short text or finite numbers.');
  }
  if (forAlter) {
    // SQLite cannot add a primary key or a NOT NULL column without a default.
    if (primaryKey) throw new RuntimeError('A primary key can only be set when the table is created.');
    if (notNull && defaultValue === null) throw new RuntimeError('A required new column needs a default value for the existing rows.');
  } else if (column.references !== undefined && column.references !== null && column.references !== '') {
    if (typeof column.references !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,63}\.[A-Za-z][A-Za-z0-9_]{0,63}$/.test(column.references)) {
      throw new RuntimeError('A reference must point at another table column, like users.id.');
    }
    const [refTable, refColumn] = column.references.split('.');
    return { name, type, primaryKey, notNull, defaultValue, references: `${databaseIdentifier(refTable)}(${databaseIdentifier(refColumn)})` };
  }
  return { name, type, primaryKey, notNull, defaultValue };
}

function columnSql(column: ColumnDefinition): string {
  const parts = [column.name, column.type];
  if (column.primaryKey) parts.push('PRIMARY KEY');
  if (column.notNull) parts.push('NOT NULL');
  if (column.defaultValue !== null && column.defaultValue !== undefined) {
    parts.push('DEFAULT', typeof column.defaultValue === 'number' ? String(column.defaultValue) : `'${column.defaultValue.replace(/'/g, "''")}'`);
  }
  if (column.references) parts.push(`REFERENCES ${column.references}`);
  return parts.join(' ');
}

/** CREATE TABLE from the visual schema editor; one primary key at most. */
export function prepareCreateTable(table: string, columns: unknown) {
  const identifier = databaseIdentifier(table);
  if (!Array.isArray(columns) || !columns.length || columns.length > 50) throw new RuntimeError('Add between 1 and 50 columns.');
  const definitions = columns.map(column => readColumnDefinition(column, false));
  const names = definitions.map(column => column.name);
  if (new Set(names).size !== names.length) throw new RuntimeError('Every column needs a different name.');
  if (definitions.filter(column => column.primaryKey).length > 1) throw new RuntimeError('Only one column can be the primary key.');
  return { sql: `CREATE TABLE ${identifier} (${definitions.map(columnSql).join(', ')})` };
}

/** ALTER TABLE ADD COLUMN; SQLite rules enforced in readColumnDefinition. */
export function prepareAddColumn(table: string, column: unknown) {
  const definition = readColumnDefinition(column, true);
  return { sql: `ALTER TABLE ${databaseIdentifier(table)} ADD COLUMN ${columnSql(definition)}` };
}

/** ALTER TABLE DROP COLUMN; SQLite rejects primary keys and indexed columns. */
export function prepareDropColumn(table: string, column: unknown) {
  return { sql: `ALTER TABLE ${databaseIdentifier(table)} DROP COLUMN ${databaseIdentifier(column)}` };
}

/** DROP TABLE — the entire table and its rows; callers save a recovery point. */
export function prepareDropTable(table: string) {
  return { sql: `DROP TABLE ${databaseIdentifier(table)}` };
}

/** CREATE INDEX on existing columns of an existing table. */
export function prepareCreateIndex(table: string, name: unknown, columns: unknown, unique: unknown) {
  const indexName = databaseIdentifier(name);
  if (!Array.isArray(columns) || !columns.length || columns.length > 16) throw new RuntimeError('Index between 1 and 16 columns.');
  const columnList = columns.map(column => databaseIdentifier(column));
  if (new Set(columnList).size !== columnList.length) throw new RuntimeError('Every index column needs a different name.');
  return { sql: `CREATE ${unique === true ? 'UNIQUE ' : ''}INDEX ${indexName} ON ${databaseIdentifier(table)} (${columnList.join(', ')})` };
}

export type DatabaseTableSchema = {
  name: string;
  rowCount: number;
  columns: Array<{ name: string; type: string; notNull: boolean; primaryKey: boolean; defaultValue: string | null }>;
  indexes: Array<{ name: string; unique: boolean }>;
};

/** Schema overview for every application table, with row counts. */
export async function readDatabaseSchema(api: CloudflareAPI, databaseId: string): Promise<{ tables: DatabaseTableSchema[] }> {
  const tableRows = await api.query(databaseId, "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT GLOB 'sqlite_*' AND name NOT GLOB '_cf_*' AND name NOT GLOB '_bh_*' ORDER BY name LIMIT 100");
  // Fetch all three per-table queries in parallel to avoid N×3 sequential
  // round-trips (each with a 30s timeout) that could exceed the DO time limit.
  const results = await Promise.all(tableRows.map(async row => {
    const tableName = String(row.name);
    const identifier = databaseIdentifier(tableName);
    const [info, countRows, indexRows] = await Promise.all([
      api.query(databaseId, `PRAGMA table_info(${identifier})`),
      api.query(databaseId, `SELECT COUNT(*) AS count FROM ${identifier}`),
      api.query(databaseId, `PRAGMA index_list(${identifier})`),
    ]);
    return {
      name: tableName,
      rowCount: Number(countRows[0]?.count ?? 0),
      indexes: indexRows
        .filter(index => String(index.origin || '') === 'c')
        .map(index => ({ name: String(index.name), unique: Number(index.unique) === 1 })),
      columns: info.map(column => ({
        name: String(column.name),
        type: String(column.type || ''),
        notNull: column.notnull === 1,
        primaryKey: Number(column.pk) > 0,
        defaultValue: column.dflt_value === null || column.dflt_value === undefined ? null : String(column.dflt_value),
      })),
    } satisfies DatabaseTableSchema;
  }));
  return { tables: results };
}
