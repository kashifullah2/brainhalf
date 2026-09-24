import { useEffect, useState } from 'react';
import { Database, Download, RefreshCw } from 'lucide-react';
import { runtimeRequest } from '../lib/project-runtime-client';
import type { ProjectEnvironment } from '../runtime/types';

type TablePage = {
  columns: string[];
  rows: Record<string, unknown>[];
  hasMore: boolean;
  offset: number;
};

type RecoveryPoint = {
  id: string;
  label: string;
  createdAt: number;
};

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
  const [tables, setTables] = useState<string[]>([]);
  const [table, setTable] = useState('');
  const [page, setPage] = useState<TablePage | null>(null);
  const [points, setPoints] = useState<RecoveryPoint[]>([]);
  const [label, setLabel] = useState('');
  const [selected, setSelected] = useState<RecoveryPoint | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [json, setJson] = useState('');
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
      request<{ tables: { name: string }[] }>('', { signal }),
      request<{ points: RecoveryPoint[] }>('/recovery', { signal }),
    ]);
    setTables(database.tables.map(item => item.name));
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
    setPage(data);
    setTable(name);
  }

  return (
    <div className="database-tools">
      {message && <p role="status" className="settings-notice">{message}</p>}

      <div className="settings-actions">
        <label>
          Application table
          <select
            value={table}
            disabled={busy}
            onChange={event => {
              const name = event.target.value;
              if (name) void perform(() => browse(name));
              else {
                setTable('');
                setPage(null);
              }
            }}
          >
            <option value="">Choose a table</option>
            {tables.map(name => <option key={name}>{name}</option>)}
          </select>
        </label>
        <button disabled={busy} onClick={() => void perform(() => refresh())}><RefreshCw size={14} />Refresh</button>
      </div>

      {page && (
        <>
          <div className="settings-table-scroll" role="region" aria-label={`${table} records`} tabIndex={0}>
            <table>
              <thead>
                <tr>{page.columns.map(column => <th key={column}>{column}</th>)}</tr>
              </thead>
              <tbody>
                {page.rows.map((row, index) => (
                  <tr key={index}>
                    {page.columns.map(column => (
                      <td key={column}>{row[column] === null ? <em>null</em> : String(row[column] ?? '')}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!page.rows.length && <p>No records on this page.</p>}
          <div className="settings-actions">
            <button disabled={busy || page.offset === 0} onClick={() => void perform(() => browse(table, Math.max(0, page.offset - 50)))}>Previous</button>
            <span>Rows {page.rows.length ? page.offset + 1 : 0}–{page.offset + page.rows.length}</span>
            <button disabled={busy || !page.hasMore} onClick={() => void perform(() => browse(table, page.offset + 50))}>Next</button>
            <button disabled={!page.rows.length} onClick={() => downloadJson(page.rows, `${table}-page-${page.offset / 50 + 1}.json`)}><Download size={14} />Download displayed rows</button>
          </div>
          <p className="settings-muted">Large values and binary fields are replaced with labels in this view and its download. Recovery points preserve the whole database.</p>
        </>
      )}

      <details>
        <summary>Import records into {table || 'a table'}</summary>
        <p>Append a JSON array with existing column names. Up to 100 field values per import. Duplicate keys or invalid records reject the entire import. A recovery point is saved first.</p>
        <textarea
          aria-label="Records to import as JSON"
          rows={5}
          maxLength={250_000}
          placeholder='[{"title":"First item"}]'
          value={json}
          onChange={event => setJson(event.target.value)}
        />
        <button
          disabled={busy || !table || !json.trim()}
          onClick={() => void perform(async () => {
            let rows: unknown;
            try {
              rows = JSON.parse(json);
            } catch {
              throw new Error('Enter valid JSON before importing.');
            }
            const result = await request<{ imported: number }>('/import', {
              method: 'POST',
              body: JSON.stringify({ table, rows }),
            });
            setJson('');
            await browse(table);
            await refresh();
            setMessage(`${result.imported} records imported.`);
            onChanged();
          })}
        >
          Import records
        </button>
      </details>

      <h4 className="settings-heading-icon"><Database size={15} />Database recovery</h4>
      <p>Save a recovery point before a data change. Points are available here for seven days.</p>

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
          aria-label="Recovery point name"
          maxLength={100}
          placeholder="Before launch"
          value={label}
          onChange={event => setLabel(event.target.value)}
        />
        <button disabled={busy}>Save recovery point</button>
      </form>

      {points.map(point => (
        <div className="settings-job" key={point.id}>
          <span>
            <strong>{point.label}</strong>
            <small>{new Date(point.createdAt).toLocaleString()}</small>
          </span>
          <button disabled={busy} onClick={() => { setSelected(point); setConfirmation(''); }}>Review restore</button>
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
              setMessage('Database restored. A recovery point for undo was saved. Run verification again.');
            });
          }}
        >
          <h4>Restore “{selected.label}”</h4>
          <p>This rewinds the entire {environment} database. In-flight queries may fail. Later records are replaced; a recovery point for undo is saved. Source, users managed by BrainHalf, and uploaded files are separate.</p>
          <label>
            Type RESTORE {environment}
            <input value={confirmation} onChange={event => setConfirmation(event.target.value)} autoComplete="off" />
          </label>
          <div className="settings-actions">
            <button disabled={busy || confirmation !== `RESTORE ${environment}`}>Restore database</button>
            <button type="button" disabled={busy} onClick={() => setSelected(null)}>Cancel</button>
          </div>
        </form>
      )}
    </div>
  );
}
