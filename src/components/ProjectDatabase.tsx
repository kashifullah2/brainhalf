import { useEffect, useState } from 'react';
import { Database, Download, KeyRound, Pencil, Plus, RefreshCw, Table2, Trash2, X } from 'lucide-react';
import { runtimeRequest } from '../lib/project-runtime-client';
import type { ProjectEnvironment } from '../runtime/types';

type ColumnSchema = {
  name: string;
  type: string;
  notNull: boolean;
  primaryKey: boolean;
  defaultValue: string | null;
};

type TableSchema = {
  name: string;
  rowCount: number;
  columns: ColumnSchema[];
  indexes?: Array<{ name: string; unique: boolean }>;
};

type TablePage = {
  columns: string[];
  rows: Record<string, unknown>[];
  hasMore: boolean;
  offset: number;
  rowIds: boolean;
};

type RecoveryPoint = {
  id: string;
  label: string;
  createdAt: number;
};

const ROW_ID_FIELD = '__bh_rowid';
const TRUNCATED_MARKERS = new Set(['[binary value]', '[value exceeds 8000 characters]']);

type ColumnDraft = {
  name: string;
  type: 'TEXT' | 'INTEGER' | 'REAL' | 'BLOB';
  primaryKey: boolean;
  notNull: boolean;
  defaultValue: string;
  references: string;
};

const emptyColumnDraft = (): ColumnDraft => ({ name: '', type: 'TEXT', primaryKey: false, notNull: false, defaultValue: '', references: '' });

/** Column payload for the schema API; numeric types parse the default as a number. */
function columnPayload(draft: ColumnDraft) {
  return {
    name: draft.name.trim(),
    type: draft.type,
    primaryKey: draft.primaryKey,
    notNull: draft.notNull,
    defaultValue: draft.defaultValue.trim() === ''
      ? null
      : draft.type === 'INTEGER' || draft.type === 'REAL'
        ? Number(draft.defaultValue)
        : draft.defaultValue,
    references: draft.references.trim() || null,
  };
}

function ColumnDraftEditor({ draft, onChange, allowPrimaryKey, allowReferences, tables, onRemove }: {
  draft: ColumnDraft;
  onChange: (next: ColumnDraft) => void;
  allowPrimaryKey: boolean;
  allowReferences?: boolean;
  tables?: TableSchema[];
  onRemove?: () => void;
}) {
  return (
    <div className="database-column-draft">
      <input
        aria-label="Field name"
        placeholder="name"
        maxLength={64}
        value={draft.name}
        onChange={event => onChange({ ...draft, name: event.target.value })}
      />
      <select aria-label="Field type" value={draft.type} onChange={event => onChange({ ...draft, type: event.target.value as ColumnDraft['type'] })}>
        <option value="TEXT">Text</option>
        <option value="INTEGER">Whole number</option>
        <option value="REAL">Decimal number</option>
        <option value="BLOB">File data</option>
      </select>
      <label className="database-draft-check">
        <input type="checkbox" checked={draft.notNull} onChange={event => onChange({ ...draft, notNull: event.target.checked })} />
        Required
      </label>
      {allowPrimaryKey && (
        <label className="database-draft-check">
          <input type="checkbox" checked={draft.primaryKey} onChange={event => onChange({ ...draft, primaryKey: event.target.checked })} />
          Unique ID
        </label>
      )}
      {allowReferences && tables && tables.length > 0 && (
        <select
          aria-label="Links to another table"
          value={draft.references}
          onChange={event => onChange({ ...draft, references: event.target.value })}
        >
          <option value="">No link</option>
          {tables.map(table => table.columns.filter(column => column.primaryKey).map(column => (
            <option key={`${table.name}.${column.name}`} value={`${table.name}.${column.name}`}>links to {table.name}.{column.name}</option>
          )))}
        </select>
      )}
      <input
        aria-label="Starting value"
        placeholder="starting value (optional)"
        maxLength={200}
        value={draft.defaultValue}
        onChange={event => onChange({ ...draft, defaultValue: event.target.value })}
      />
      {onRemove && <button type="button" aria-label="Remove field" onClick={onRemove}><X size={13} /></button>}
    </div>
  );
}

function rowIdOf(row: Record<string, unknown>): number | null {
  const value = row[ROW_ID_FIELD];
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
}

/** Editable field values for the JSON editor; truncated preview markers are omitted. */
function editableValues(row: Record<string, unknown>, columns: string[]): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const column of columns) {
    const value = row[column];
    if (typeof value === 'string' && TRUNCATED_MARKERS.has(value)) continue;
    values[column] = value ?? null;
  }
  return values;
}

function downloadJson(value: unknown, filename: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function ProjectDatabase({ projectId, environment, onChanged }: {
  projectId: string;
  environment: ProjectEnvironment;
  onChanged: () => void;
}) {
  const [tables, setTables] = useState<TableSchema[]>([]);
  const [table, setTable] = useState('');
  const [page, setPage] = useState<TablePage | null>(null);
  const [points, setPoints] = useState<RecoveryPoint[]>([]);
  const [label, setLabel] = useState('');
  const [selected, setSelected] = useState<RecoveryPoint | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [json, setJson] = useState('');
  const [editRow, setEditRow] = useState<{ rowId: number; json: string } | null>(null);
  const [deleteRowId, setDeleteRowId] = useState<number | null>(null);
  const [newTable, setNewTable] = useState<{ name: string; columns: ColumnDraft[] } | null>(null);
  const [addColumn, setAddColumn] = useState<ColumnDraft | null>(null);
  const [dropColumnName, setDropColumnName] = useState<string | null>(null);
  const [dropTableConfirm, setDropTableConfirm] = useState<string | null>(null);
  const [dropTableInput, setDropTableInput] = useState('');
  const [addIndex, setAddIndex] = useState<{ name: string; columns: string[]; unique: boolean } | null>(null);
  const [cellEdit, setCellEdit] = useState<{ rowId: number; column: string; value: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const request = <T,>(path: string, init: RequestInit = {}) => runtimeRequest<T>(
    projectId,
    `/database${path}`,
    environment,
    { ...init, signal: init.signal || AbortSignal.timeout(45_000) },
  );

  async function refresh(signal?: AbortSignal) {
    const [database, recovery] = await Promise.all([
      request<{ tables: TableSchema[] }>('', { signal }),
      request<{ points: RecoveryPoint[] }>('/recovery', { signal }),
    ]);
    if (!Array.isArray(database?.tables) || !Array.isArray(recovery?.points)) {
      throw new Error('Database could not be loaded. Refresh and try again.');
    }
    setTables(database.tables);
    setPoints(recovery.points);
  }

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal).catch(cause => {
      if (!controller.signal.aborted) {
        setMessage(cause instanceof Error ? cause.message : 'Database unavailable.');
      }
    });
    return () => controller.abort();
  }, [projectId, environment]);

  async function perform(action: () => Promise<void>) {
    setBusy(true);
    setMessage('');
    try {
      await action();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Database action failed.');
    } finally {
      setBusy(false);
    }
  }

  async function browse(name: string, offset = 0) {
    const data = await request<TablePage>(`?table=${encodeURIComponent(name)}&offset=${offset}`);
    if (!Array.isArray(data?.columns) || !Array.isArray(data?.rows)) {
      throw new Error('The table could not be loaded. Refresh and try again.');
    }
    setPage(data);
    setTable(name);
    setEditRow(null);
    setDeleteRowId(null);
    setAddColumn(null);
    setDropColumnName(null);
  }

  async function createTable() {
    if (!newTable) return;
    await perform(async () => {
      const name = newTable.name.trim();
      const columns = newTable.columns.filter(column => column.name.trim()).map(columnPayload);
      if (!columns.length) throw new Error('Add at least one named field.');
      await request('/schema/create', {
        method: 'POST',
        body: JSON.stringify({ table: name, columns }),
      });
      setNewTable(null);
      await refresh();
      await browse(name);
      onChanged();
      setMessage(`Table “${name}” created. A backup was saved first.`);
    });
  }

  async function submitAddColumn() {
    if (!addColumn || !table) return;
    await perform(async () => {
      const payload = columnPayload(addColumn);
      await request('/schema/add-column', { method: 'POST', body: JSON.stringify({ table, column: payload }) });
      setAddColumn(null);
      await refresh();
      await browse(table, page?.offset ?? 0);
      onChanged();
      setMessage(`Field “${payload.name}” added to ${table}. A backup was saved first.`);
    });
  }

  async function submitDropColumn() {
    if (!dropColumnName || !table) return;
    await perform(async () => {
      await request('/schema/drop-column', { method: 'POST', body: JSON.stringify({ table, column: dropColumnName }) });
      const dropped = dropColumnName;
      setDropColumnName(null);
      await refresh();
      await browse(table, page?.offset ?? 0);
      onChanged();
      setMessage(`Field “${dropped}” removed from ${table}. A backup was saved first.`);
    });
  }

  async function submitDropTable() {
    if (!dropTableConfirm) return;
    await perform(async () => {
      await request('/schema/drop-table', { method: 'POST', body: JSON.stringify({ table: dropTableConfirm, confirm: `DROP ${dropTableConfirm}` }) });
      const dropped = dropTableConfirm;
      setDropTableConfirm(null);
      setDropTableInput('');
      setTable('');
      setPage(null);
      await refresh();
      onChanged();
      setMessage(`Table “${dropped}” and all its entries were deleted. A backup was saved first.`);
    });
  }

  async function submitAddIndex() {
    if (!addIndex || !table) return;
    await perform(async () => {
      await request('/schema/add-index', { method: 'POST', body: JSON.stringify({ table, name: addIndex.name.trim(), columns: addIndex.columns, unique: addIndex.unique }) });
      setAddIndex(null);
      await refresh();
      onChanged();
      setMessage(`Fast lookup “${addIndex.name.trim()}” created on ${table}. A backup was saved first.`);
    });
  }

  /** Spreadsheet-style cell save: one field of one row via the row update endpoint. */
  async function saveCell() {
    if (!cellEdit || !table || !page) return;
    const { rowId, column, value } = cellEdit;
    const schemaColumn = activeSchema?.columns.find(item => item.name === column);
    let parsed: unknown = value;
    if (value === '') parsed = null;
    else if (schemaColumn && (schemaColumn.type === 'INTEGER' || schemaColumn.type === 'REAL')) {
      const asNumber = Number(value);
      if (!Number.isFinite(asNumber)) { setMessage(`“${value}” is not a number. ${column} expects ${schemaColumn.type === 'INTEGER' ? 'a whole number' : 'a decimal number'}.`); return; }
      parsed = schemaColumn.type === 'INTEGER' ? Math.trunc(asNumber) : asNumber;
    }
    if (schemaColumn?.notNull && parsed === null) { setMessage(`${column} is required — empty values are not allowed.`); return; }
    setCellEdit(null);
    await perform(async () => {
      await request('/rows/update', { method: 'POST', body: JSON.stringify({ table, rowId, values: { [column]: parsed } }) });
      await browse(table, page.offset);
      await refresh();
      onChanged();
    });
  }

  const activeSchema = tables.find(item => item.name === table) || null;

  return (
    <div className="database-tools">
      {message && <p role="status" className="settings-notice">{message}</p>}

      <div className="settings-actions">
        <span className="settings-muted" style={{ alignSelf: 'center' }}>
          {tables.length ? `${tables.length} table${tables.length === 1 ? '' : 's'}` : 'No tables yet — the builder creates them when your app first needs to save something.'}
        </span>
        <button type="button" className="button-primary" disabled={busy} onClick={() => setNewTable(current => current ? null : { name: '', columns: [{ ...emptyColumnDraft(), name: 'id', type: 'INTEGER', primaryKey: true }, emptyColumnDraft()] })}><Plus size={14} />New table</button>
        <button type="button" className="button-secondary" disabled={busy} onClick={() => void perform(() => refresh())}><RefreshCw size={14} />Refresh</button>
      </div>

      {newTable && (
        <form
          className="database-edit-row"
          onSubmit={event => {
            event.preventDefault();
            void createTable();
          }}
        >
          <h4>Create a table</h4>
          <p className="settings-muted">Give the table a name and add its fields. One field can be the unique ID of each entry — the way to tell entries apart. A backup is saved first.</p>
          <input
            aria-label="Table name"
            placeholder="Table name, e.g. products"
            maxLength={64}
            value={newTable.name}
            onChange={event => setNewTable({ ...newTable, name: event.target.value })}
          />
          {newTable.columns.map((column, index) => (
            <ColumnDraftEditor
              key={index}
              draft={column}
              allowPrimaryKey
              allowReferences
              tables={tables}
              onChange={next => setNewTable({ ...newTable, columns: newTable.columns.map((existing, i) => (i === index ? next : existing)) })}
              onRemove={newTable.columns.length > 1 ? () => setNewTable({ ...newTable, columns: newTable.columns.filter((_, i) => i !== index) }) : undefined}
            />
          ))}
          <div className="settings-actions">
            <button type="button" className="button-secondary" disabled={busy || newTable.columns.length >= 50} onClick={() => setNewTable({ ...newTable, columns: [...newTable.columns, emptyColumnDraft()] })}><Plus size={13} />Add field</button>
            <button type="submit" className="button-primary" disabled={busy || !newTable.name.trim() || !newTable.columns.some(column => column.name.trim())}>Create table</button>
            <button type="button" className="button-ghost" disabled={busy} onClick={() => setNewTable(null)}>Cancel</button>
          </div>
        </form>
      )}

      {tables.length > 0 && (
        <div className="database-table-list" aria-label="Application tables">
          {tables.map(item => (
            <button
              type="button"
              key={item.name}
              className={`database-table-card${item.name === table ? ' active' : ''}`}
              disabled={busy}
              onClick={() => void perform(() => browse(item.name))}
            >
              <span className="database-table-name"><Table2 size={13} />{item.name}</span>
              <span className="settings-muted">{item.rowCount?.toLocaleString() ?? '—'} {((item.rowCount ?? 0) === 1 ? 'entry' : 'entries')} · {item.columns.length} {item.columns.length === 1 ? 'field' : 'fields'}</span>
            </button>
          ))}
        </div>
      )}

      {activeSchema && (
        <div className="database-schema" aria-label={`${table} fields`}>
          <h4 className="settings-heading-icon"><Database size={15} />{activeSchema.name} fields</h4>
          <ul className="database-column-list">
            {activeSchema.columns.map(column => (
              <li key={column.name}>
                <code>{column.name}</code>
                <span className="settings-muted">{column.type || 'ANY'}</span>
                {column.primaryKey && <span className="database-badge database-badge-pk"><KeyRound size={10} />unique ID</span>}
                {column.notNull && <span className="database-badge">required</span>}
                {column.defaultValue !== null && <span className="database-badge">starts as {column.defaultValue}</span>}
                {!column.primaryKey && activeSchema.columns.length > 1 && (
                  <button
                    type="button"
                    className="database-column-drop"
                    title={`Remove field ${column.name}`}
                    disabled={busy}
                    onClick={() => setDropColumnName(column.name)}
                  >
                    <Trash2 size={11} />
                  </button>
                )}
              </li>
            ))}
          </ul>
          {dropColumnName && (
            <div className="settings-notice database-confirm-strip" role="alert">
              <span>Remove the field “{dropColumnName}” and all its data from {table}? A backup is saved first, so you can undo.</span>
              <span className="settings-actions">
                <button type="button" className="button-danger" disabled={busy} onClick={() => void submitDropColumn()}><Trash2 size={13} />Remove field</button>
                <button type="button" className="button-ghost" disabled={busy} onClick={() => setDropColumnName(null)}>Cancel</button>
              </span>
            </div>
          )}
          {addColumn ? (
            <form
              className="database-edit-row"
              onSubmit={event => {
                event.preventDefault();
                void submitAddColumn();
              }}
            >
              <h4>Add a field to {table}</h4>
              <p className="settings-muted">Existing entries get the starting value. A required field needs a starting value. A backup is saved first.</p>
              <ColumnDraftEditor draft={addColumn} onChange={setAddColumn} allowPrimaryKey={false} />
              <div className="settings-actions">
                <button type="submit" className="button-primary" disabled={busy || !addColumn.name.trim()}>Add field</button>
                <button type="button" className="button-ghost" disabled={busy} onClick={() => setAddColumn(null)}>Cancel</button>
              </div>
            </form>
          ) : (
            <div className="settings-actions">
              <button type="button" className="button-secondary" disabled={busy} onClick={() => { setDropColumnName(null); setAddColumn(emptyColumnDraft()); }}><Plus size={13} />Add field</button>
            </div>
          )}
          {(activeSchema.indexes ?? []).length > 0 && (
            <p className="settings-muted" style={{ marginTop: 8 }}>
              Fast lookups: {(activeSchema.indexes ?? []).map(index => `${index.name}${index.unique ? ' (unique)' : ''}`).join(', ')}
            </p>
          )}
          {addIndex ? (
            <form
              className="database-edit-row"
              onSubmit={event => {
                event.preventDefault();
                void submitAddIndex();
              }}
            >
              <h4>Add a fast lookup to {table}</h4>
              <p className="settings-muted">Fast lookups help the app find entries quicker. A unique one also blocks duplicate entries. A backup is saved first.</p>
              <input
                aria-label="Fast lookup name"
                placeholder="Name, e.g. items_title"
                maxLength={64}
                value={addIndex.name}
                onChange={event => setAddIndex({ ...addIndex, name: event.target.value })}
              />
              <fieldset className="database-index-columns">
                <legend>Fields to look up</legend>
                {activeSchema.columns.map(column => (
                  <label key={column.name} className="database-draft-check">
                    <input
                      type="checkbox"
                      checked={addIndex.columns.includes(column.name)}
                      onChange={event => setAddIndex({
                        ...addIndex,
                        columns: event.target.checked
                          ? [...addIndex.columns, column.name]
                          : addIndex.columns.filter(name => name !== column.name),
                      })}
                    />
                    {column.name}
                  </label>
                ))}
              </fieldset>
              <label className="database-draft-check">
                <input type="checkbox" checked={addIndex.unique} onChange={event => setAddIndex({ ...addIndex, unique: event.target.checked })} />
                Unique — block duplicate entries
              </label>
              <div className="settings-actions">
                <button type="submit" className="button-primary" disabled={busy || !addIndex.name.trim() || !addIndex.columns.length}>Create fast lookup</button>
                <button type="button" className="button-ghost" disabled={busy} onClick={() => setAddIndex(null)}>Cancel</button>
              </div>
            </form>
          ) : (
            <div className="settings-actions">
              <button type="button" className="button-secondary" disabled={busy} onClick={() => setAddIndex({ name: `${table}_`, columns: [], unique: false })}><Plus size={13} />Add fast lookup</button>
            </div>
          )}
          {dropTableConfirm ? (
            <form
              className="database-edit-row"
              onSubmit={event => {
                event.preventDefault();
                void submitDropTable();
              }}
            >
              <h4>Delete the whole {dropTableConfirm} table</h4>
              <p className="settings-muted">This deletes the table and every entry in it. A backup is saved first, so you can undo.</p>
              <label>
                Type DROP {dropTableConfirm}
                <input value={dropTableInput} onChange={event => setDropTableInput(event.target.value)} autoComplete="off" />
              </label>
              <div className="settings-actions">
                <button type="submit" className="button-danger" disabled={busy || dropTableInput !== `DROP ${dropTableConfirm}`}><Trash2 size={13} />Delete table</button>
                <button type="button" className="button-ghost" disabled={busy} onClick={() => { setDropTableConfirm(null); setDropTableInput(''); }}>Cancel</button>
              </div>
            </form>
          ) : (
            <div className="settings-actions">
              <button type="button" className="button-danger" disabled={busy} onClick={() => { setDropTableConfirm(table); setDropTableInput(''); }}><Trash2 size={13} />Delete table…</button>
            </div>
          )}
        </div>
      )}

      {page && (
        <>
          <div className="settings-table-scroll" role="region" aria-label={`${table} entries`} tabIndex={0}>
            <table>
              <thead>
                <tr>
                  {page.columns.map(column => <th key={column}>{column}</th>)}
                  {page.rowIds && <th aria-label="Row actions" />}
                </tr>
              </thead>
              <tbody>
                {page.rows.map((row, index) => {
                  const rowId = rowIdOf(row);
                  return (
                    <tr key={rowId ?? index}>
                      {page.columns.map(column => {
                        const rawValue = row[column];
                        const truncated = typeof rawValue === 'string' && TRUNCATED_MARKERS.has(rawValue);
                        const editable = page.rowIds && rowId !== null && !truncated;
                        const editing = cellEdit !== null && rowId !== null && cellEdit.rowId === rowId && cellEdit.column === column;
                        return (
                          <td key={column}>
                            {editing ? (
                              <input
                                className="database-cell-input"
                                aria-label={`Edit ${column}`}
                                autoFocus
                                value={cellEdit.value}
                                onChange={event => setCellEdit({ ...cellEdit, value: event.target.value })}
                                onKeyDown={event => {
                                  if (event.key === 'Enter') { event.preventDefault(); void saveCell(); }
                                  if (event.key === 'Escape') setCellEdit(null);
                                }}
                                onBlur={() => void saveCell()}
                              />
                            ) : (
                              <button
                                type="button"
                                className="database-cell"
                                disabled={busy || !editable}
                                title={editable ? `Edit ${column}` : undefined}
                                onClick={() => { if (rowId !== null) { setEditRow(null); setDeleteRowId(null); setCellEdit({ rowId, column, value: rawValue === null ? '' : String(rawValue ?? '') }); } }}
                              >
                                {rawValue === null ? <em>null</em> : String(rawValue ?? '')}
                              </button>
                            )}
                          </td>
                        );
                      })}
                      {page.rowIds && (
                        <td className="database-row-actions">
                          {rowId !== null && (
                            <>
                              <button
                                type="button"
                                title="Edit this entry"
                                disabled={busy}
                                onClick={() => {
                                  setDeleteRowId(null);
                                  setEditRow({ rowId, json: JSON.stringify(editableValues(row, page.columns), null, 2) });
                                }}
                              >
                                <Pencil size={12} />
                              </button>
                              <button
                                type="button"
                                title="Delete this entry"
                                disabled={busy}
                                onClick={() => { setEditRow(null); setDeleteRowId(rowId); }}
                              >
                                <Trash2 size={12} />
                              </button>
                            </>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {!page.rows.length && <p>No entries on this page.</p>}

          {deleteRowId !== null && (
            <div className="settings-notice database-confirm-strip" role="alert">
              <span>Delete entry {deleteRowId} from {table}? A backup is saved first, so you can undo.</span>
              <span className="settings-actions">
                <button
                  type="button"
                  className="button-danger"
                  disabled={busy}
                  onClick={() => void perform(async () => {
                    await request('/rows/delete', { method: 'POST', body: JSON.stringify({ table, rowId: deleteRowId }) });
                    setDeleteRowId(null);
                    await browse(table, page.offset);
                    await refresh();
                    onChanged();
                    setMessage('Entry deleted. A backup was saved.');
                  })}
                >
                  <Trash2 size={13} />Delete entry
                </button>
                <button type="button" className="button-ghost" disabled={busy} onClick={() => setDeleteRowId(null)}>Cancel</button>
              </span>
            </div>
          )}

          {editRow && (
            <form
              className="database-edit-row"
              onSubmit={event => {
                event.preventDefault();
                void perform(async () => {
                  let values: unknown;
                  try {
                    values = JSON.parse(editRow.json);
                  } catch {
                    throw new Error('The entry text is not valid — check it and try again.');
                  }
                  await request('/rows/update', { method: 'POST', body: JSON.stringify({ table, rowId: editRow.rowId, values }) });
                  setEditRow(null);
                  await browse(table, page.offset);
                  await refresh();
                  onChanged();
                  setMessage('Entry saved. A backup was saved.');
                });
              }}
            >
              <h4>Edit entry {editRow.rowId} in {table}</h4>
              <p className="settings-muted">Edit the fields below and save. Very long or file values are left unchanged. A backup is saved first.</p>
              <textarea
                aria-label="Entry fields"
                rows={6}
                maxLength={250_000}
                value={editRow.json}
                onChange={event => setEditRow({ ...editRow, json: event.target.value })}
              />
              <div className="settings-actions">
                <button type="submit" className="button-primary" disabled={busy || !editRow.json.trim()}>Save entry</button>
                <button type="button" className="button-ghost" disabled={busy} onClick={() => setEditRow(null)}>Cancel</button>
              </div>
            </form>
          )}

          <div className="settings-actions">
            <button type="button" className="button-secondary" disabled={busy || page.offset === 0} onClick={() => void perform(() => browse(table, Math.max(0, page.offset - 50)))}>Previous</button>
            <span className="settings-muted">Entries {page.rows.length ? page.offset + 1 : 0}–{page.offset + page.rows.length}</span>
            <button type="button" className="button-secondary" disabled={busy || !page.hasMore} onClick={() => void perform(() => browse(table, page.offset + 50))}>Next</button>
            <button type="button" className="button-secondary" disabled={!page.rows.length} onClick={() => downloadJson(page.rows.map(row => {
              const clean = { ...row };
              delete clean[ROW_ID_FIELD];
              return clean;
            }), `${table}-page-${page.offset / 50 + 1}.json`)}><Download size={14} />Download shown entries</button>
          </div>
          <p className="settings-muted">Click a value to edit it — Enter saves, Escape cancels. Very long or file values show as labels and can't be edited here. Backups keep the whole database safe.</p>
        </>
      )}

      <details>
        <summary>Add entries to {table || 'a table'}</summary>
        <p>Paste a list of entries below using the existing field names. Up to 100 values per import. If any entry is invalid, nothing is added. A backup is saved first.</p>
        <textarea
          aria-label="Entries to add"
          rows={5}
          maxLength={250_000}
          placeholder='[{"title":"First item"}]'
          value={json}
          onChange={event => setJson(event.target.value)}
        />
        <button
          type="button"
          className="button-secondary"
          disabled={busy || !table || !json.trim()}
          onClick={() => void perform(async () => {
            let rows: unknown;
            try {
              rows = JSON.parse(json);
            } catch {
              throw new Error('The pasted text is not valid — check it and try again.');
            }
            const result = await request<{ imported: number }>('/import', {
              method: 'POST',
              body: JSON.stringify({ table, rows }),
            });
            setJson('');
            await browse(table);
            await refresh();
            setMessage(`${result.imported} entries added.`);
            onChanged();
          })}
        >
          Add entries
        </button>
      </details>

      <h4 className="settings-heading-icon"><Database size={15} />Backups</h4>
      <p>Save a backup before changing data. Backups are kept here for 7 days.</p>

      <form
        className="settings-actions"
        onSubmit={event => {
          event.preventDefault();
          void perform(async () => {
            await request('/recovery', { method: 'POST', body: JSON.stringify({ label }) });
            setLabel('');
            await refresh();
          });
        }}
      >
        <input
          aria-label="Backup name"
          maxLength={100}
          placeholder="Before launch"
          value={label}
          onChange={event => setLabel(event.target.value)}
        />
        <button type="submit" className="button-primary" disabled={busy}>Save backup</button>
      </form>

      {points.map(point => (
        <div className="settings-job" key={point.id}>
          <span>
            <strong>{point.label}</strong>
            <small>{new Date(point.createdAt).toLocaleString()}</small>
          </span>
          <button type="button" className="button-secondary" disabled={busy} onClick={() => { setSelected(point); setConfirmation(''); }}>Restore…</button>
        </div>
      ))}

      {selected && (
        <form
          className="database-restore-review"
          onSubmit={event => {
            event.preventDefault();
            void perform(async () => {
              await request('/restore', {
                method: 'POST',
                body: JSON.stringify({ id: selected.id, confirm: confirmation }),
              });
              setSelected(null);
              setPage(null);
              await refresh();
              onChanged();
              setMessage('Database restored from the backup. A fresh backup was saved so you can undo. Run the app checks again.');
            });
          }}
        >
          <h4>Bring back “{selected.label}”</h4>
          <p>This rolls the whole {environment === 'development' ? 'test' : 'live'} database back to this backup. Anything the app is doing right now may fail. Newer entries are replaced, and a fresh backup is saved so you can undo. Your app's files, users, and uploads are not touched.</p>
          <label>
            Type RESTORE {environment}
            <input value={confirmation} onChange={event => setConfirmation(event.target.value)} autoComplete="off" />
          </label>
          <div className="settings-actions">
            <button type="submit" className="button-danger" disabled={busy || confirmation !== `RESTORE ${environment}`}>Restore backup</button>
            <button type="button" className="button-ghost" disabled={busy} onClick={() => setSelected(null)}>Cancel</button>
          </div>
        </form>
      )}
    </div>
  );
}
