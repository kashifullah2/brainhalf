import { contextFileAllowed } from './agent-context';
import { isSafeFilePath, normalizePath } from './utils';

type Query = (sql: string, ...params: (string | number)[]) => Array<Record<string, any>>;
export interface SourceCheckpoint { id: string; label: string; revision: number; createdAt: number; fileCount: number; bytes: number }
export const SOURCE_HISTORY_SCHEMA = [
  'CREATE TABLE IF NOT EXISTS source_checkpoints (id TEXT PRIMARY KEY, label TEXT NOT NULL, revision INTEGER NOT NULL, createdAt INTEGER NOT NULL, fileCount INTEGER NOT NULL, bytes INTEGER NOT NULL, files TEXT NOT NULL)',
  'CREATE INDEX IF NOT EXISTS checkpoints_recent ON source_checkpoints(createdAt DESC)',
];

/** Bounded project-local snapshots. Secret files are never versioned or restored. */
export class SourceHistory {
  constructor(private query: Query) {}
  list(): SourceCheckpoint[] { return this.query('SELECT id,label,revision,createdAt,fileCount,bytes FROM source_checkpoints ORDER BY createdAt DESC, rowid DESC LIMIT 12') as SourceCheckpoint[]; }
  save(input: Record<string, string>, revision: number, label: string): SourceCheckpoint {
    const files = Object.fromEntries(Object.entries(input).filter(([path, content]) => isSafeFilePath(path) && contextFileAllowed(path) && typeof content === 'string').map(([path, content]) => [normalizePath(path), content]));
    const serialized = JSON.stringify(files); const bytes = new TextEncoder().encode(serialized).byteLength;
    if (bytes > 4_000_000 || Object.keys(files).length > 500) throw new Error('Checkpoints support up to 500 source files and 4 MB. Remove build output first.');
    const checkpoint = { id: crypto.randomUUID(), label: label.trim().slice(0, 120) || 'Saved checkpoint', revision, createdAt: Date.now(), fileCount: Object.keys(files).length, bytes };
    this.query('INSERT INTO source_checkpoints(id,label,revision,createdAt,fileCount,bytes,files) VALUES (?,?,?,?,?,?,?)', checkpoint.id, checkpoint.label, revision, checkpoint.createdAt, checkpoint.fileCount, bytes, serialized);
    this.query('DELETE FROM source_checkpoints WHERE id NOT IN (SELECT id FROM source_checkpoints ORDER BY createdAt DESC, rowid DESC LIMIT 12)');
    // Keep at most 20 MB even when several large projects revisions are saved.
    const records = this.list(); let total = 0;
    for (const record of records) { total += record.bytes; if (total > 20_000_000) this.query('DELETE FROM source_checkpoints WHERE id=?', record.id); }
    return checkpoint;
  }
  files(id: string): Record<string, string> {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid checkpoint.');
    const row = this.query('SELECT files FROM source_checkpoints WHERE id=?', id)[0];
    if (!row) throw new Error('Checkpoint no longer available. Refresh the list.');
    return JSON.parse(row.files);
  }
}

export function sourceChanges(current: Record<string, string>, saved: Record<string, string>) {
  return [...new Set([...Object.keys(current), ...Object.keys(saved)])].filter(contextFileAllowed).sort().flatMap(path => current[path] === saved[path] ? [] : [{ path, change: !(path in current) ? 'restore' : !(path in saved) ? 'remove' : 'modify', before: current[path]?.length || 0, after: saved[path]?.length || 0 }]);
}
